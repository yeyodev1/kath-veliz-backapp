import { isValidObjectId } from "mongoose";
import { CustomError } from "../errors/customError.error";
import { Access } from "../models/access.model";
import { Lesson } from "../models/lesson.model";
import { LiveSession } from "../models/liveSession.model";
import { Module } from "../models/module.model";
import { Product } from "../models/product.model";
import { Progress } from "../models/progress.model";
import { JwtPayload } from "../types/AuthRequest";
import { accessStatus, isAccessActive } from "./access.service";
import * as bunnyService from "./bunny.service";
import * as cloudinaryService from "./cloudinary.service";
import { toProductCard, toProductDetail } from "./product.service";

interface ProgressSummary {
  completedLessons: number;
  totalLessons: number;
  percent: number;
  lastLessonId: string | null;
}

function summarize(lessonIds: string[], progress: any[]): ProgressSummary {
  const visible = new Set(lessonIds);
  // Solo cuentan las lecciones que siguen publicadas: el avance no puede pasar del 100 %.
  const rows = progress.filter((row) => visible.has(row.lesson.toString()));
  const completedLessons = rows.filter((row) => row.completed).length;
  const last = [...rows].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  )[0];
  return {
    completedLessons,
    totalLessons: lessonIds.length,
    percent: lessonIds.length ? Math.round((completedLessons / lessonIds.length) * 100) : 0,
    lastLessonId: last ? last.lesson.toString() : null,
  };
}

function serializeAccess(access: any) {
  return { status: accessStatus(access), expiresAt: access.expiresAt as Date | null };
}

/**
 * Acceso de quien pide. La administración entra a todo sin un Access propio:
 * necesita ver el curso como lo ve una alumna.
 */
async function requireAccess(user: JwtPayload, productId: unknown) {
  const access = await Access.findOne({ user: user.userId, product: productId }).lean();
  if (isAccessActive(access)) return serializeAccess(access);
  if (user.accountType === "admin") return { status: "vigente" as const, expiresAt: null };

  if (!access) throw new CustomError("Todavía no tienes acceso a este producto", 403);
  throw new CustomError(
    access.revokedAt
      ? "Tu acceso a este producto fue revocado"
      : "Tu acceso a este producto venció",
    403,
  );
}

/** GET /me/products. Los accesos vencidos también salen: el front los muestra bloqueados. */
export async function listMyProducts(userId: string) {
  const accesses = await Access.find({ user: userId }).sort({ createdAt: -1 }).lean();
  if (!accesses.length) return [];

  const productIds = accesses.map((access) => access.product);
  const [products, lessons, progress] = await Promise.all([
    Product.find({ _id: { $in: productIds } }).lean(),
    Lesson.find({ product: { $in: productIds }, isPublished: true })
      .select("product durationSeconds")
      .lean(),
    Progress.find({ user: userId, product: { $in: productIds } }).lean(),
  ]);

  const items = [];
  for (const access of accesses) {
    const product = products.find((item) => item._id.toString() === access.product.toString());
    if (!product) continue;

    const productLessons = lessons.filter(
      (lesson) => lesson.product.toString() === product._id.toString(),
    );
    items.push({
      product: toProductCard(product, {
        lessonCount: productLessons.length,
        totalDurationSeconds: productLessons.reduce(
          (sum, lesson) => sum + lesson.durationSeconds,
          0,
        ),
      }),
      access: serializeAccess(access),
      progress: summarize(
        productLessons.map((lesson) => lesson._id.toString()),
        progress.filter((row) => row.product.toString() === product._id.toString()),
      ),
    });
  }

  // Lo que se puede usar hoy va primero.
  return items.sort(
    (a, b) => Number(b.access.status === "vigente") - Number(a.access.status === "vigente"),
  );
}

/** GET /me/products/:slug. Todo lo que el reproductor necesita, menos el video. */
export async function getMyProduct(user: JwtPayload, slug: string) {
  const product = await Product.findOne({ slug: slug.toLowerCase().trim() }).lean();
  if (!product) throw new CustomError("Producto no encontrado", 404);
  const access = await requireAccess(user, product._id);

  const [detail, modules, lessons, progress, sessions] = await Promise.all([
    toProductDetail(product),
    Module.find({ product: product._id }).sort({ order: 1, createdAt: 1 }).lean(),
    Lesson.find({ product: product._id, isPublished: true })
      .sort({ order: 1, createdAt: 1 })
      .lean(),
    Progress.find({ user: user.userId, product: product._id }).lean(),
    LiveSession.find({ product: product._id }).sort({ startsAt: 1 }).lean(),
  ]);

  const progressByLesson = new Map(progress.map((row) => [row.lesson.toString(), row]));

  return {
    product: detail,
    access,
    modules: modules
      .map((module) => ({
        id: module._id.toString(),
        title: module.title,
        description: module.description,
        lessons: lessons
          .filter((lesson) => lesson.module.toString() === module._id.toString())
          .map((lesson) => {
            const row = progressByLesson.get(lesson._id.toString());
            return {
              id: lesson._id.toString(),
              title: lesson.title,
              description: lesson.description,
              durationSeconds: lesson.durationSeconds,
              hasVideo: !!lesson.bunnyVideoId,
              attachments: (lesson.attachments ?? []).map((item) => ({
                name: item.name,
                url: item.url,
              })),
              completed: !!row?.completed,
              positionSeconds: row?.positionSeconds ?? 0,
            };
          }),
      }))
      .filter((module) => module.lessons.length > 0),
    // Acá sí va el enlace de Meet: ya se comprobó el acceso.
    liveSessions: sessions.map((session) => ({
      id: session._id.toString(),
      title: session.title,
      description: session.description,
      startsAt: session.startsAt,
      meetUrl: session.meetUrl,
      recordingLessonId: session.recordingLesson ? session.recordingLesson.toString() : null,
    })),
    hasDownload: !!product.downloadFile?.publicId,
    progress: summarize(
      lessons.map((lesson) => lesson._id.toString()),
      progress,
    ),
  };
}

async function findLesson(lessonId: string) {
  const lesson = isValidObjectId(lessonId) ? await Lesson.findById(lessonId).lean() : null;
  if (!lesson || !lesson.isPublished) throw new CustomError("Clase no encontrada", 404);
  return lesson;
}

/** GET /lessons/:id/playback. La clase de muestra no exige acceso ni sesión. */
export async function getPlayback(user: JwtPayload | undefined, lessonId: string) {
  const lesson = await findLesson(lessonId);

  if (lesson.isFreePreview) {
    // Una muestra solo es pública mientras el producto esté publicado.
    const product = await Product.findById(lesson.product).select("isPublished").lean();
    if (!product?.isPublished && user?.accountType !== "admin") {
      throw new CustomError("Clase no encontrada", 404);
    }
  } else {
    if (!user) throw new CustomError("Inicia sesión para ver esta clase", 401);
    await requireAccess(user, lesson.product);
  }

  if (!lesson.bunnyVideoId) throw new CustomError("Esta clase todavía no tiene video", 404);

  const progress = user
    ? await Progress.findOne({ user: user.userId, lesson: lesson._id }).lean()
    : null;
  const { embedUrl, signed } = bunnyService.buildEmbedUrl(lesson.bunnyVideoId);
  return { embedUrl, positionSeconds: progress?.positionSeconds ?? 0, signed };
}

/** POST /lessons/:id/progress */
export async function saveProgress(
  user: JwtPayload,
  lessonId: string,
  input: { positionSeconds?: unknown; completed?: unknown },
): Promise<{ ok: true }> {
  const lesson = await findLesson(lessonId);
  if (!lesson.isFreePreview) await requireAccess(user, lesson.product);

  const position = Math.floor(Number(input.positionSeconds));
  const update: Record<string, unknown> = { product: lesson.product };
  if (Number.isFinite(position) && position >= 0) update.positionSeconds = position;
  // Solo se toca `completed` si llega: el guardado periódico de posición no debe desmarcar una clase.
  if (typeof input.completed === "boolean") update.completed = input.completed;

  await Progress.updateOne(
    { user: user.userId, lesson: lesson._id },
    { $set: update },
    { upsert: true, setDefaultsOnInsert: true },
  );
  return { ok: true };
}

/** GET /me/products/:slug/download. URL firmada de corta duración; nunca la URL fija. */
export async function getDownload(user: JwtPayload, slug: string) {
  const product = await Product.findOne({ slug: slug.toLowerCase().trim() }).lean();
  if (!product) throw new CustomError("Producto no encontrado", 404);
  await requireAccess(user, product._id);

  const file = product.downloadFile;
  if (!file?.publicId) throw new CustomError("Este producto no tiene archivo para descargar", 404);

  return {
    url: cloudinaryService.privateDownloadUrl(file.publicId, file.filename),
    filename: file.filename,
  };
}
