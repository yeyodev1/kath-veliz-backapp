import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";
import {
  ServiceRequest,
  SERVICE_REQUEST_STATUSES,
  ServiceRequestStatus,
} from "../models/serviceRequest.model";
import { Product } from "../models/product.model";
import { assertObjectId, cleanEmail, cleanString, has, requiredString } from "../utils/input";
import * as leadEmail from "./leadEmail.service";
import * as productService from "./product.service";

function toServiceRequest(request: any) {
  const product = request.product;
  const populated = product && typeof product === "object" && "title" in product;
  return {
    id: request._id.toString(),
    // El panel pinta el nombre: la referencia viaja poblada cuando se pudo poblar.
    product: populated
      ? { id: product._id.toString(), title: product.title, slug: product.slug }
      : product.toString(),
    productTitle: populated ? product.title : "",
    productSlug: populated ? product.slug : "",
    user: request.user ? request.user.toString() : null,
    name: request.name,
    email: request.email,
    phone: request.phone,
    answers: (request.answers ?? []).map((item: any) => ({
      question: item.question,
      answer: item.answer,
    })),
    status: request.status,
    adminNote: request.adminNote,
    order: request.order ? request.order.toString() : null,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

/** Enlace de pago que recibe la persona aprobada. */
export function paymentUrl(slug: string, requestId: string): string {
  return `${env.FRONTEND_URL.replace(/\/+$/, "")}/checkout/${slug}?solicitud=${requestId}`;
}

function parseAnswers(value: unknown, product: { surveyQuestions?: any[] }) {
  if (value !== undefined && !Array.isArray(value)) {
    throw new CustomError("Las respuestas deben ser una lista", 400);
  }
  const answers = ((value as any[]) ?? [])
    .map((item) => ({
      question: cleanString(item?.question, 500),
      answer: cleanString(item?.answer, 5000),
    }))
    .filter((item) => item.question);

  // Las obligatorias se comprueban contra la encuesta real del producto, no contra lo que mande el front.
  for (const question of product.surveyQuestions ?? []) {
    if (!question.required) continue;
    const answered = answers.find((item) => item.question === question.label);
    if (!answered?.answer) {
      throw new CustomError(`Falta responder: ${question.label}`, 400);
    }
  }
  return answers;
}

export async function createServiceRequest(body: any): Promise<{ ok: true }> {
  const product = await productService.findPublishedBySlug(body?.productSlug);
  if (product.type !== "service") {
    throw new CustomError("Este producto no recibe solicitudes", 400);
  }
  if (product.saleMode === "closed") {
    throw new CustomError("Por ahora no estoy recibiendo solicitudes nuevas", 400);
  }

  const name = requiredString(body?.name, "Escribe tu nombre", 120);
  const email = cleanEmail(body?.email);
  const phone = requiredString(body?.phone, "Escribe tu número de teléfono", 30);
  const answers = parseAnswers(body?.answers, product);

  const pending = await ServiceRequest.exists({ product: product._id, email, status: "pending" });
  if (pending) {
    throw new CustomError(
      "Ya tengo una solicitud tuya en revisión. Te respondo pronto a tu correo.",
      409,
    );
  }

  const request = await ServiceRequest.create({
    product: product._id,
    name,
    email,
    phone,
    answers,
  });

  await Promise.all([
    leadEmail.sendServiceRequestReceivedEmail(request, product, product.infoPdf?.url ?? ""),
    leadEmail.sendServiceRequestAdminEmail(request, product),
  ]);

  return { ok: true };
}

/* ---------- Panel ---------- */

export async function listServiceRequests(query: any) {
  const filter: Record<string, unknown> = {};
  const status = cleanString(query?.status, 20);
  if (status) {
    if (!SERVICE_REQUEST_STATUSES.includes(status as ServiceRequestStatus)) {
      throw new CustomError("El estado debe ser pending, approved, rejected o paid", 400);
    }
    filter.status = status;
  }

  const requests = await ServiceRequest.find(filter)
    .sort({ createdAt: -1 })
    .populate("product", "title slug")
    .lean();
  return requests.map(toServiceRequest);
}

async function loadForDecision(id: string) {
  assertObjectId(id, "La solicitud");
  const request = await ServiceRequest.findById(id);
  if (!request) throw new CustomError("Solicitud no encontrada", 404);
  if (request.status === "paid") {
    throw new CustomError("Esta solicitud ya está pagada: no se puede cambiar", 409);
  }
  const product = await Product.findById(request.product).select("title slug").lean();
  if (!product) throw new CustomError("El producto de esta solicitud ya no existe", 404);
  return { request, product };
}

export async function approveServiceRequest(id: string, body: any) {
  const { request, product } = await loadForDecision(id);

  request.status = "approved";
  if (has(body, "adminNote")) request.adminNote = cleanString(body.adminNote, 2000);
  await request.save();

  // adminNote es una nota interna de Kath: se guarda, no viaja en el correo.
  const emailSent = await leadEmail.sendServiceRequestApprovedEmail(
    request,
    product,
    paymentUrl(product.slug, request._id.toString()),
  );

  return {
    ...toServiceRequest(request),
    productTitle: product.title,
    productSlug: product.slug,
    emailSent,
  };
}

export async function rejectServiceRequest(id: string, body: any) {
  const { request, product } = await loadForDecision(id);

  request.status = "rejected";
  if (has(body, "adminNote")) request.adminNote = cleanString(body.adminNote, 2000);
  await request.save();

  const emailSent = await leadEmail.sendServiceRequestRejectedEmail(request, product);

  return {
    ...toServiceRequest(request),
    productTitle: product.title,
    productSlug: product.slug,
    emailSent,
  };
}
