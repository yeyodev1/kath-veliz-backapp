import { CustomError } from "../errors/customError.error";
import { Coupon, ICoupon } from "../models/coupon.model";
import { Product } from "../models/product.model";
import {
  assertObjectId,
  cleanBoolean,
  cleanInt,
  cleanNullableDate,
  cleanNullableInt,
  has,
} from "../utils/input";

const WAITLIST_PERCENT_OFF = 10;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,59}$/;

export interface CouponResult {
  code: string;
  percentOff: number;
  discountCents: number;
  totalCents: number;
}

export function normalizeCode(code: unknown): string {
  return String(code ?? "")
    .trim()
    .toUpperCase();
}

/** Código del cupón de lista de espera de un producto: ESPERA10-<SLUG>. */
export function waitlistCode(slug: string): string {
  return `ESPERA${WAITLIST_PERCENT_OFF}-${slug.toUpperCase()}`;
}

function toCoupon(coupon: any) {
  const product = coupon.product;
  const populated = product && typeof product === "object" && "title" in product;
  return {
    id: coupon._id.toString(),
    code: coupon.code,
    percentOff: coupon.percentOff,
    product: product ? (populated ? product._id.toString() : product.toString()) : null,
    productTitle: populated ? product.title : "",
    expiresAt: coupon.expiresAt,
    maxUses: coupon.maxUses,
    usedCount: coupon.usedCount,
    isActive: coupon.isActive,
    createdAt: coupon.createdAt,
  };
}

/**
 * Valida el cupón contra un producto y calcula el total. La usan la ruta
 * pública y la creación de la orden: el descuento se calcula en un solo lugar.
 */
export async function validateCoupon(
  code: unknown,
  product: { _id: unknown; priceCents: number },
): Promise<CouponResult> {
  const clean = normalizeCode(code);
  if (!clean) throw new CustomError("Escribe el código del cupón", 400);

  const coupon = await Coupon.findOne({ code: clean }).lean();
  // Mismo mensaje para "no existe" y "está apagado": no se revelan códigos desactivados.
  if (!coupon || !coupon.isActive) throw new CustomError("Ese cupón no existe", 404);

  if (coupon.product && coupon.product.toString() !== String(product._id)) {
    throw new CustomError("Ese cupón no aplica para este producto", 400);
  }
  if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= Date.now()) {
    throw new CustomError("Ese cupón ya venció", 400);
  }
  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    throw new CustomError("Ese cupón ya alcanzó su límite de usos", 400);
  }

  const discountCents = Math.round((product.priceCents * coupon.percentOff) / 100);
  return {
    code: coupon.code,
    percentOff: coupon.percentOff,
    discountCents,
    totalCents: Math.max(0, product.priceCents - discountCents),
  };
}

/** Suma un uso. Se llama una sola vez, cuando la orden queda pagada. */
export async function registerCouponUse(code: string): Promise<void> {
  const clean = normalizeCode(code);
  if (!clean) return;
  await Coupon.updateOne({ code: clean }, { $inc: { usedCount: 1 } });
}

/**
 * Cupón del 10% para quien entra a la lista de espera. Se crea la primera vez
 * y después se reutiliza: todas las personas de la lista reciben el mismo código.
 */
export async function ensureWaitlistCoupon(product: {
  _id: unknown;
  slug: string;
}): Promise<string> {
  const code = waitlistCode(product.slug);
  // Upsert: dos personas anotándose a la vez no chocan con el índice único.
  await Coupon.updateOne(
    { code },
    {
      $setOnInsert: {
        code,
        percentOff: WAITLIST_PERCENT_OFF,
        product: product._id,
        expiresAt: null,
        maxUses: null,
        usedCount: 0,
        isActive: true,
      },
    },
    { upsert: true },
  );
  return code;
}

/* ---------- Panel ---------- */

export async function listCoupons() {
  const coupons = await Coupon.find().sort({ createdAt: -1 }).populate("product", "title").lean();
  return coupons.map(toCoupon);
}

async function parseCouponInput(body: any, partial: boolean): Promise<Partial<ICoupon>> {
  const data: Partial<ICoupon> = {};

  if (!partial || has(body, "code")) {
    const code = normalizeCode(body?.code);
    if (!CODE_PATTERN.test(code)) {
      throw new CustomError(
        "El código debe tener de 3 a 60 caracteres: letras, números, guion o guion bajo",
        400,
      );
    }
    data.code = code;
  }
  if (!partial || has(body, "percentOff")) {
    const percentOff = cleanInt(body?.percentOff, "El porcentaje de descuento", 1);
    if (percentOff > 100) throw new CustomError("El descuento no puede pasar del 100%", 400);
    data.percentOff = percentOff;
  }
  if (has(body, "product")) {
    if (body.product === null || body.product === "") {
      data.product = null;
    } else {
      const productId = assertObjectId(body.product, "El producto");
      const product = await Product.findById(productId).select("_id").lean();
      if (!product) throw new CustomError("Producto no encontrado", 404);
      data.product = product._id;
    }
  }
  if (has(body, "expiresAt")) {
    data.expiresAt = cleanNullableDate(body.expiresAt, "La fecha de vencimiento");
  }
  if (has(body, "maxUses")) data.maxUses = cleanNullableInt(body.maxUses, "El máximo de usos", 1);
  if (has(body, "isActive")) data.isActive = cleanBoolean(body.isActive, "Activo");

  return data;
}

export async function createCoupon(body: any) {
  const data = await parseCouponInput(body, false);
  if (await Coupon.exists({ code: data.code })) {
    throw new CustomError("Ya existe un cupón con ese código", 409);
  }
  const coupon = await Coupon.create(data);
  return toCoupon(await coupon.populate("product", "title"));
}

export async function updateCoupon(id: string, body: any) {
  assertObjectId(id, "El cupón");
  const data = await parseCouponInput(body, true);
  if (data.code && (await Coupon.exists({ code: data.code, _id: { $ne: id } }))) {
    throw new CustomError("Ya existe un cupón con ese código", 409);
  }

  const coupon = await Coupon.findByIdAndUpdate(id, data, { new: true, runValidators: true })
    .populate("product", "title")
    .lean();
  if (!coupon) throw new CustomError("Cupón no encontrado", 404);
  return toCoupon(coupon);
}

export async function deleteCoupon(id: string): Promise<{ ok: true }> {
  assertObjectId(id, "El cupón");
  const coupon = await Coupon.findByIdAndDelete(id);
  if (!coupon) throw new CustomError("Cupón no encontrado", 404);
  return { ok: true };
}
