import crypto from "crypto";
import { isValidObjectId } from "mongoose";
import { CustomError } from "../errors/customError.error";
import { Order, OrderStatus, ORDER_STATUSES } from "../models/order.model";
import { Product, IProduct } from "../models/product.model";
import { ServiceRequest } from "../models/serviceRequest.model";
import { User } from "../models/user.model";
import { grantAccess, hasActiveAccess } from "./access.service";
import * as commerceEmail from "./commerceEmail.service";
import { validateCoupon, registerCouponUse } from "./coupon.service";
import * as payphoneService from "./payphone.service";

const PAGE_SIZE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Único por intento y dentro del límite de 50 caracteres de Payphone. */
function newClientTransactionId(): string {
  return `kv-${Date.now().toString(36)}-${crypto.randomBytes(10).toString("hex")}`;
}

function refId(value: any): string | null {
  if (!value) return null;
  return (value._id ?? value).toString();
}

/** Orden tal como la ve su dueña. La respuesta cruda de Payphone no sale de acá. */
export function serializeOrder(order: any) {
  return {
    id: order._id.toString(),
    items: (order.items ?? []).map((item: any) => {
      const product = item.product && item.product.slug ? item.product : null;
      return {
        product: refId(item.product),
        slug: product ? product.slug : undefined,
        type: product ? product.type : undefined,
        title: item.title,
        priceCents: item.priceCents,
      };
    }),
    subtotalCents: order.subtotalCents,
    discountCents: order.discountCents,
    totalCents: order.totalCents,
    coupon: order.coupon,
    clientTransactionId: order.clientTransactionId,
    status: order.status as OrderStatus,
    serviceRequest: refId(order.serviceRequest),
    paidAt: order.paidAt,
    createdAt: order.createdAt,
  };
}

function productSummary(product: Pick<IProduct, "slug" | "title" | "type">) {
  return { slug: product.slug, title: product.title, type: product.type };
}

/** El vencimiento de una compra lo define el producto. null = de por vida. */
function purchaseExpiry(product: Pick<IProduct, "accessDurationDays">): Date | null {
  const days = product.accessDurationDays;
  return days && days > 0 ? new Date(Date.now() + days * DAY_MS) : null;
}

/**
 * Entrega lo comprado. Solo la llama quien acaba de pasar la orden a `paid`,
 * así que corre una vez por orden aunque la confirmación llegue repetida.
 */
async function fulfillOrder(order: any, product: IProduct, user: any): Promise<void> {
  const expiresAt = purchaseExpiry(product);
  await grantAccess({
    userId: order.user,
    productId: product._id,
    source: "purchase",
    orderId: order._id,
    expiresAt,
  });

  if (order.serviceRequest) {
    await ServiceRequest.updateOne(
      { _id: order.serviceRequest },
      { $set: { status: "paid", order: order._id, user: order.user } },
    );
  }

  if (order.coupon) {
    // El cupón ya se cobró con descuento: si el conteo falla no se deshace la venta.
    await registerCouponUse(order.coupon).catch((error: unknown) =>
      console.error("[orders] no se pudo registrar el uso del cupón:", error),
    );
  }

  await commerceEmail.sendPurchaseEmail({
    to: user.email,
    name: user.name,
    product: { title: product.title, type: product.type },
    totalCents: order.totalCents,
    expiresAt,
  });
}

/** POST /orders. El monto se calcula acá: del front solo llegan el slug y el cupón. */
export async function createOrder(
  userId: string,
  input: {
    productSlug?: unknown;
    couponCode?: unknown;
    phone?: unknown;
    documentId?: unknown;
    serviceRequestId?: unknown;
  },
) {
  const user = await User.findById(userId);
  if (!user || !user.isActive) throw new CustomError("No autorizado", 401);

  // Payphone exige celular y cédula reales del comprador en cada cobro.
  const phone = String(input.phone ?? "").trim();
  const documentId = String(input.documentId ?? "").trim();
  if (phone.replace(/\D/g, "").length < 9) {
    throw new CustomError("Escribe tu número de celular", 400);
  }
  if (!/^[A-Za-z0-9]{5,20}$/.test(documentId)) {
    throw new CustomError("Escribe tu número de cédula", 400);
  }

  const slug = String(input.productSlug ?? "")
    .toLowerCase()
    .trim();
  const product = slug ? await Product.findOne({ slug, isPublished: true }).lean() : null;
  if (!product) throw new CustomError("Producto no encontrado", 404);
  if (product.type === "free") {
    throw new CustomError("Este recurso es gratuito: no necesitas comprarlo", 400);
  }
  if (product.saleMode !== "open") {
    throw new CustomError("Este producto no está disponible para la compra en este momento", 400);
  }

  if (await hasActiveAccess(user._id, product._id)) {
    throw new CustomError("Ya tienes acceso a este producto. Lo encuentras en Mis cursos.", 409);
  }

  // La asesoría solo se paga con una solicitud que Kath aprobó para ese mismo correo.
  let serviceRequestId: string | null = null;
  if (product.type === "service") {
    const rawId = String(input.serviceRequestId ?? "");
    const request = isValidObjectId(rawId)
      ? await ServiceRequest.findOne({ _id: rawId, product: product._id }).lean()
      : null;
    if (!request) {
      throw new CustomError("Para pagar la asesoría necesitas una solicitud aprobada", 403);
    }
    if (request.email !== user.email) {
      throw new CustomError(
        "Esta solicitud pertenece a otro correo. Inicia sesión con el correo con el que la enviaste.",
        403,
      );
    }
    if (request.status === "paid") {
      throw new CustomError("Esta asesoría ya está pagada", 409);
    }
    if (request.status !== "approved") {
      throw new CustomError("Tu solicitud todavía no está aprobada", 403);
    }
    serviceRequestId = request._id.toString();
  }

  const subtotalCents = product.priceCents;
  let discountCents = 0;
  let totalCents = subtotalCents;
  let coupon = "";
  const couponCode = String(input.couponCode ?? "").trim();
  if (couponCode) {
    const result = await validateCoupon(couponCode, product);
    coupon = result.code;
    discountCents = result.discountCents;
    totalCents = result.totalCents;
  }

  user.phone = phone;
  user.documentId = documentId;
  await user.save();

  const isFree = totalCents <= 0;
  // Se valida antes de crear la orden para no dejar órdenes pendientes imposibles de pagar.
  if (!isFree && !payphoneService.isPayphoneConfigured()) {
    throw new CustomError("Los pagos todavía no están configurados", 503);
  }

  const order = await Order.create({
    user: user._id,
    items: [{ product: product._id, title: product.title, priceCents: product.priceCents }],
    subtotalCents,
    discountCents,
    totalCents: Math.max(0, totalCents),
    coupon,
    clientTransactionId: newClientTransactionId(),
    serviceRequest: serviceRequestId,
    // Cupón del 100 %: no hay nada que cobrar, Payphone no interviene.
    status: isFree ? "paid" : "pending",
    paidAt: isFree ? new Date() : null,
  });

  if (isFree) {
    await fulfillOrder(order, product, user);
    return { order: serializeOrder(order), payphone: null, product: productSummary(product) };
  }

  return {
    order: serializeOrder(order),
    payphone: payphoneService.buildBoxConfig(order, user),
    product: productSummary(product),
  };
}

/**
 * POST /orders/confirm. La llama la página de respuesta apenas carga, y la
 * gente recarga esa página más de lo que uno cree: tiene que ser idempotente.
 */
export async function confirmOrder(
  userId: string,
  input: { id?: unknown; clientTransactionId?: unknown },
) {
  const clientTransactionId = String(input.clientTransactionId ?? "").trim();
  const payphoneId = Number(input.id);
  if (!clientTransactionId || !Number.isFinite(payphoneId) || payphoneId <= 0) {
    throw new CustomError("Faltan los datos del pago para confirmarlo", 400);
  }

  const order = await Order.findOne({ clientTransactionId, user: userId });
  if (!order) throw new CustomError("No encontramos esa orden", 404);

  const product = await Product.findById(order.items[0]?.product).lean();
  if (!product) throw new CustomError("El producto de esta orden ya no existe", 404);

  const respond = (current: any) => ({
    status: current.status as OrderStatus,
    order: serializeOrder(current),
    product: productSummary(product),
  });

  // Estados finales: se responde lo mismo sin volver a Payphone ni duplicar nada.
  if (order.status === "paid" || order.status === "canceled") return respond(order);

  const confirmation = await payphoneService.confirmPayment(payphoneId, clientTransactionId);
  const payphoneTransactionId = String(confirmation.transactionId ?? payphoneId);

  if (confirmation.statusCode === payphoneService.PAYPHONE_APPROVED) {
    // Payphone cobró otro monto que el de la orden: no se entrega nada.
    if (Number(confirmation.amount) !== order.totalCents) {
      console.error(
        `[orders] monto distinto en ${clientTransactionId}: orden ${order.totalCents}, payphone ${confirmation.amount}`,
      );
      order.status = "failed";
      order.payphoneTransactionId = payphoneTransactionId;
      order.payphoneResponse = confirmation;
      await order.save();
      return respond(order);
    }

    // El cambio a `paid` es atómico: si dos confirmaciones llegan juntas, solo una entrega.
    const paid = await Order.findOneAndUpdate(
      { _id: order._id, status: { $ne: "paid" } },
      {
        $set: {
          status: "paid",
          paidAt: new Date(),
          payphoneTransactionId,
          payphoneResponse: confirmation,
        },
      },
      { new: true },
    );
    if (!paid) return respond((await Order.findById(order._id)) ?? order);

    const user = await User.findById(order.user);
    if (user) await fulfillOrder(paid, product, user);
    return respond(paid);
  }

  order.status =
    confirmation.statusCode === payphoneService.PAYPHONE_CANCELED ? "canceled" : "failed";
  order.payphoneTransactionId = payphoneTransactionId;
  order.payphoneResponse = confirmation;
  await order.save();
  return respond(order);
}

/** GET /me/orders */
export async function listMyOrders(userId: string) {
  const orders = await Order.find({ user: userId })
    .sort({ createdAt: -1 })
    .populate("items.product", "slug type")
    .lean();
  return orders.map(serializeOrder);
}

/** GET /admin/orders?status=&page= */
export async function listOrders(query: { status?: unknown; page?: unknown }) {
  const filter: Record<string, unknown> = {};
  if (query.status) {
    const status = String(query.status) as OrderStatus;
    if (!ORDER_STATUSES.includes(status)) throw new CustomError("Estado no válido", 400);
    filter.status = status;
  }

  const page = Math.max(1, Number(query.page) || 1);
  const [orders, total] = await Promise.all([
    Order.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .populate("user", "email name phone documentId")
      .populate("items.product", "slug type")
      .lean(),
    Order.countDocuments(filter),
  ]);

  return {
    items: orders.map((order: any) => {
      const user = order.user && order.user.email ? order.user : null;
      return {
        ...serializeOrder(order),
        user: user
          ? {
              id: user._id.toString(),
              email: user.email,
              name: user.name,
              phone: user.phone,
              documentId: user.documentId,
            }
          : null,
        payphoneTransactionId: order.payphoneTransactionId,
      };
    }),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}
