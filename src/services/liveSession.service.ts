import { CustomError } from "../errors/customError.error";
import { LiveSession, ILiveSession } from "../models/liveSession.model";
import { Lesson } from "../models/lesson.model";
import { Product } from "../models/product.model";
import { Access } from "../models/access.model";
import {
  assertObjectId,
  cleanDate,
  cleanString,
  cleanUrl,
  has,
  requiredString,
} from "../utils/input";
import { isAccessActive } from "./access.service";
import { sendEmailBatch } from "./email.service";
import { buildLiveSessionEmail } from "./leadEmail.service";

function toLiveSession(session: any) {
  const product = session.product;
  const populated = product && typeof product === "object" && "title" in product;
  return {
    id: session._id.toString(),
    // El panel pinta el nombre: la referencia viaja poblada cuando se pudo poblar.
    product: populated
      ? { id: product._id.toString(), title: product.title, slug: product.slug }
      : product.toString(),
    productTitle: populated ? product.title : "",
    productSlug: populated ? product.slug : "",
    title: session.title,
    description: session.description,
    startsAt: session.startsAt,
    meetUrl: session.meetUrl,
    recordingLesson: session.recordingLesson ? session.recordingLesson.toString() : null,
  };
}

export async function listLiveSessions(productId?: unknown) {
  const filter: Record<string, unknown> = {};
  if (productId) filter.product = assertObjectId(productId, "El producto");

  const sessions = await LiveSession.find(filter)
    .sort({ startsAt: -1 })
    .populate("product", "title slug")
    .lean();
  return sessions.map(toLiveSession);
}

async function parseInput(body: any, partial: boolean, productId?: string) {
  const data: Partial<ILiveSession> = {};

  if (!partial || has(body, "title")) {
    data.title = requiredString(body?.title, "Escribe el título de la clase", 200);
  }
  if (has(body, "description")) data.description = cleanString(body.description);
  if (!partial || has(body, "startsAt")) {
    data.startsAt = cleanDate(body?.startsAt, "La fecha de la clase");
  }
  if (has(body, "meetUrl")) data.meetUrl = cleanUrl(body.meetUrl, "El enlace de Meet");

  if (has(body, "recordingLesson")) {
    if (body.recordingLesson === null || body.recordingLesson === "") {
      data.recordingLesson = null;
    } else {
      const lessonId = assertObjectId(body.recordingLesson, "La lección de la grabación");
      const lesson = await Lesson.findById(lessonId).select("product").lean();
      if (!lesson) throw new CustomError("La lección de la grabación no existe", 404);
      if (productId && lesson.product.toString() !== productId) {
        throw new CustomError("La grabación debe ser una lección del mismo producto", 400);
      }
      data.recordingLesson = lesson._id;
    }
  }

  return data;
}

export async function createLiveSession(body: any) {
  const productId = assertObjectId(body?.product, "El producto");
  const product = await Product.findById(productId).select("_id").lean();
  if (!product) throw new CustomError("Producto no encontrado", 404);

  const data = await parseInput(body, false, productId);
  const session = await LiveSession.create({ ...data, product: product._id });
  return toLiveSession(await session.populate("product", "title slug"));
}

export async function updateLiveSession(id: string, body: any) {
  assertObjectId(id, "La clase");
  const session = await LiveSession.findById(id);
  if (!session) throw new CustomError("Clase en vivo no encontrada", 404);

  session.set(await parseInput(body, true, session.product.toString()));
  await session.save();
  return toLiveSession(await session.populate("product", "title slug"));
}

export async function deleteLiveSession(id: string): Promise<{ ok: true }> {
  assertObjectId(id, "La clase");
  const session = await LiveSession.findByIdAndDelete(id);
  if (!session) throw new CustomError("Clase en vivo no encontrada", 404);
  return { ok: true };
}

/** Avisa de la clase a todas las personas con acceso vigente al producto. */
export async function notifyLiveSession(id: string): Promise<{ sent: number; failed: number }> {
  assertObjectId(id, "La clase");
  const session = await LiveSession.findById(id).lean();
  if (!session) throw new CustomError("Clase en vivo no encontrada", 404);

  const product = await Product.findById(session.product).select("title slug").lean();
  if (!product) throw new CustomError("Producto no encontrado", 404);

  const accesses = await Access.find({ product: session.product })
    .populate("user", "name email isActive")
    .lean();

  // Un correo por persona aunque hubiera accesos repetidos.
  const recipients = new Map<string, { name: string; email: string }>();
  for (const access of accesses) {
    const user = access.user as any;
    if (!isAccessActive(access) || !user?.email || user.isActive === false) continue;
    recipients.set(user.email, { name: user.name ?? "", email: user.email });
  }

  // Por lotes (API batch de Resend): de uno en uno, 100+ alumnas no caben en los 60 s de Vercel.
  const messages = [...recipients.values()].map((student) =>
    buildLiveSessionEmail(student, product, session),
  );
  return sendEmailBatch(messages);
}
