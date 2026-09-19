import { Types } from "mongoose";
import { CustomError } from "../errors/customError.error";
import { Product } from "../models/product.model";
import { Module } from "../models/module.model";
import { Lesson, ILesson, ILessonAttachment } from "../models/lesson.model";
import { LiveSession } from "../models/liveSession.model";
import { Progress } from "../models/progress.model";
import {
  assertObjectId,
  cleanBoolean,
  cleanInt,
  cleanString,
  cleanUrl,
  has,
  requiredString,
} from "../utils/input";
import * as bunnyService from "./bunny.service";

/* ---------- Serialización ---------- */

export function toAdminModule(module: any) {
  return {
    id: module._id.toString(),
    product: module.product.toString(),
    title: module.title,
    description: module.description,
    order: module.order,
  };
}

export function toAdminLesson(lesson: any, videoStatus = "none") {
  return {
    id: lesson._id.toString(),
    product: lesson.product.toString(),
    module: lesson.module.toString(),
    title: lesson.title,
    description: lesson.description,
    order: lesson.order,
    bunnyVideoId: lesson.bunnyVideoId,
    durationSeconds: lesson.durationSeconds,
    attachments: (lesson.attachments ?? []).map((item: ILessonAttachment) => ({
      name: item.name,
      url: item.url,
      publicId: item.publicId,
    })),
    isFreePreview: lesson.isFreePreview,
    isPublished: lesson.isPublished,
    videoStatus,
    thumbnailUrl: bunnyService.thumbnailUrl(lesson.bunnyVideoId),
  };
}

/* ---------- Temario público ---------- */

export interface PublicOutline {
  modules: {
    id: string;
    title: string;
    description: string;
    lessons: { id: string; title: string; durationSeconds: number; isFreePreview: boolean }[];
  }[];
  lessonCount: number;
  totalDurationSeconds: number;
}

/** Temario que ve cualquiera en la landing: títulos y duraciones, nunca el video. */
export async function getPublicOutline(
  productId: string,
  // En lista de espera el temario planificado es lo que vende: se muestran también las
  // lecciones que aún no tienen video. Son solo títulos; nada de eso es reproducible.
  includePlanned = false,
): Promise<PublicOutline> {
  const lessonFilter = includePlanned
    ? { product: productId }
    : { product: productId, isPublished: true };
  const [modules, lessons] = await Promise.all([
    Module.find({ product: productId }).sort({ order: 1, createdAt: 1 }).lean(),
    Lesson.find(lessonFilter).sort({ order: 1, createdAt: 1 }).lean(),
  ]);

  const outline = modules
    .map((module) => ({
      id: module._id.toString(),
      title: module.title,
      description: module.description,
      lessons: lessons
        .filter((lesson) => lesson.module.toString() === module._id.toString())
        .map((lesson) => ({
          id: lesson._id.toString(),
          title: lesson.title,
          durationSeconds: lesson.durationSeconds,
          isFreePreview: lesson.isPublished && lesson.isFreePreview,
        })),
    }))
    // Un módulo sin lecciones publicadas todavía no existe para el público.
    .filter((module) => module.lessons.length > 0);

  const visible = outline.flatMap((module) => module.lessons);
  return {
    modules: outline,
    lessonCount: visible.length,
    totalDurationSeconds: visible.reduce((sum, lesson) => sum + lesson.durationSeconds, 0),
  };
}

/** Lecciones publicadas y duración total por producto, para las tarjetas del catálogo. */
export async function lessonStatsByProduct(
  productIds: unknown[],
): Promise<Map<string, { lessonCount: number; totalDurationSeconds: number }>> {
  const stats = new Map<string, { lessonCount: number; totalDurationSeconds: number }>();
  if (!productIds.length) return stats;

  // aggregate no castea como find(): los ids tienen que llegar ya como ObjectId.
  const ids = productIds.map((id) => new Types.ObjectId(String(id)));
  const rows = await Lesson.aggregate([
    { $match: { product: { $in: ids }, isPublished: true } },
    {
      $group: {
        _id: "$product",
        lessonCount: { $sum: 1 },
        totalDurationSeconds: { $sum: "$durationSeconds" },
      },
    },
  ]);
  for (const row of rows) {
    stats.set(String(row._id), {
      lessonCount: row.lessonCount,
      totalDurationSeconds: row.totalDurationSeconds,
    });
  }
  return stats;
}

/* ---------- Contenido para el panel ---------- */

export async function getAdminContent(productId: string) {
  assertObjectId(productId, "El producto");
  const product = await Product.findById(productId).lean();
  if (!product) throw new CustomError("Producto no encontrado", 404);

  const [modules, lessons] = await Promise.all([
    Module.find({ product: productId }).sort({ order: 1, createdAt: 1 }).lean(),
    Lesson.find({ product: productId }).sort({ order: 1, createdAt: 1 }).lean(),
  ]);

  const statuses = await videoStatusMap(lessons.some((lesson) => !!lesson.bunnyVideoId));

  return {
    modules: modules.map((module) => ({
      ...toAdminModule(module),
      lessons: lessons
        .filter((lesson) => lesson.module.toString() === module._id.toString())
        .map((lesson) => toAdminLesson(lesson, resolveStatus(lesson.bunnyVideoId, statuses))),
    })),
  };
}

/**
 * Una sola consulta a Bunny para todo el curso. Si Bunny falla, el panel igual
 * tiene que abrir: el estado queda como "unknown" y se puede editar el resto.
 */
async function videoStatusMap(needed: boolean): Promise<Map<string, string> | null> {
  if (!needed || !bunnyService.isBunnyConfigured()) return null;
  try {
    const videos = await bunnyService.listVideos();
    return new Map(
      videos.map((video) => [
        video.guid,
        bunnyService.BUNNY_STATUS_LABELS[video.status] ?? "processing",
      ]),
    );
  } catch (error) {
    console.error("[content] no se pudo consultar el estado de los videos:", error);
    return null;
  }
}

function resolveStatus(videoId: string, statuses: Map<string, string> | null): string {
  if (!videoId) return "none";
  if (!statuses) return "unknown";
  return statuses.get(videoId) ?? "missing";
}

/* ---------- Módulos ---------- */

function parseModuleInput(body: any, partial: boolean) {
  const data: Record<string, unknown> = {};
  if (!partial || has(body, "title")) {
    data.title = requiredString(body?.title, "Escribe el título del módulo", 200);
  }
  if (has(body, "description")) data.description = cleanString(body.description);
  if (has(body, "order")) data.order = cleanInt(body.order, "El orden");
  return data;
}

export async function createModule(productId: string, body: any) {
  assertObjectId(productId, "El producto");
  const product = await Product.findById(productId).lean();
  if (!product) throw new CustomError("Producto no encontrado", 404);

  const data = parseModuleInput(body, false);
  if (data.order === undefined) data.order = await Module.countDocuments({ product: productId });

  const module = await Module.create({ ...data, product: productId });
  return { ...toAdminModule(module), lessons: [] };
}

export async function updateModule(id: string, body: any) {
  assertObjectId(id, "El módulo");
  const module = await Module.findByIdAndUpdate(id, parseModuleInput(body, true), {
    new: true,
    runValidators: true,
  });
  if (!module) throw new CustomError("Módulo no encontrado", 404);
  return toAdminModule(module);
}

export async function deleteModule(id: string): Promise<{ ok: true }> {
  assertObjectId(id, "El módulo");
  const module = await Module.findById(id);
  if (!module) throw new CustomError("Módulo no encontrado", 404);

  const lessons = await Lesson.find({ module: id }).lean();
  await removeLessons(lessons);
  await module.deleteOne();
  return { ok: true };
}

/* ---------- Lecciones ---------- */

function parseAttachments(value: unknown): ILessonAttachment[] {
  if (!Array.isArray(value)) throw new CustomError("Los adjuntos deben ser una lista", 400);
  return value.map((item) => {
    const url = cleanUrl(item?.url, "El enlace del adjunto");
    if (!url) throw new CustomError("Cada adjunto necesita su enlace", 400);
    return {
      name: requiredString(item?.name, "Cada adjunto necesita un nombre", 200),
      url,
      publicId: cleanString(item?.publicId, 500),
    };
  });
}

function parseLessonInput(body: any, partial: boolean) {
  const data: Partial<ILesson> = {};
  if (!partial || has(body, "title")) {
    data.title = requiredString(body?.title, "Escribe el título de la lección", 200);
  }
  if (has(body, "description")) data.description = cleanString(body.description);
  if (has(body, "order")) data.order = cleanInt(body.order, "El orden");
  if (has(body, "bunnyVideoId")) data.bunnyVideoId = cleanString(body.bunnyVideoId, 100);
  if (has(body, "durationSeconds")) {
    data.durationSeconds = cleanInt(body.durationSeconds, "La duración");
  }
  if (has(body, "attachments")) data.attachments = parseAttachments(body.attachments);
  if (has(body, "isFreePreview")) {
    data.isFreePreview = cleanBoolean(body.isFreePreview, "La vista previa gratuita");
  }
  if (has(body, "isPublished")) data.isPublished = cleanBoolean(body.isPublished, "Publicada");
  return data;
}

export async function createLesson(moduleId: string, body: any) {
  assertObjectId(moduleId, "El módulo");
  const module = await Module.findById(moduleId).lean();
  if (!module) throw new CustomError("Módulo no encontrado", 404);

  const data = parseLessonInput(body, false);
  if (data.order === undefined) data.order = await Lesson.countDocuments({ module: moduleId });

  const lesson = await Lesson.create({ ...data, module: module._id, product: module.product });
  return toAdminLesson(lesson, lesson.bunnyVideoId ? "unknown" : "none");
}

export async function updateLesson(id: string, body: any) {
  assertObjectId(id, "La lección");
  const lesson = await Lesson.findById(id);
  if (!lesson) throw new CustomError("Lección no encontrada", 404);

  const data = parseLessonInput(body, true);

  // Mover la lección a otro módulo, siempre dentro del mismo producto.
  if (has(body, "module")) {
    const moduleId = assertObjectId(body.module, "El módulo");
    const target = await Module.findById(moduleId).lean();
    if (!target || target.product.toString() !== lesson.product.toString()) {
      throw new CustomError("Ese módulo no pertenece a este producto", 400);
    }
    lesson.module = target._id;
  }

  lesson.set(data);
  await lesson.save();
  return toAdminLesson(lesson, lesson.bunnyVideoId ? "unknown" : "none");
}

export async function deleteLesson(id: string): Promise<{ ok: true }> {
  assertObjectId(id, "La lección");
  const lesson = await Lesson.findById(id).lean();
  if (!lesson) throw new CustomError("Lección no encontrada", 404);
  await removeLessons([lesson]);
  return { ok: true };
}

/**
 * Borra lecciones con todo lo que cuelga de ellas. El video de Bunny se borra
 * sin bloquear: si Bunny falla queda un huérfano allá, pero el panel no se traba.
 */
async function removeLessons(lessons: { _id: unknown; bunnyVideoId: string }[]): Promise<void> {
  if (!lessons.length) return;
  const ids = lessons.map((lesson) => lesson._id);

  await Promise.all([
    Lesson.deleteMany({ _id: { $in: ids } }),
    Progress.deleteMany({ lesson: { $in: ids } }),
    LiveSession.updateMany({ recordingLesson: { $in: ids } }, { $set: { recordingLesson: null } }),
  ]);

  if (!bunnyService.isBunnyConfigured()) return;
  await Promise.all(
    lessons
      .filter((lesson) => !!lesson.bunnyVideoId)
      .map((lesson) =>
        bunnyService
          .deleteVideo(lesson.bunnyVideoId)
          .catch((error) => console.error("[content] no se pudo borrar el video:", error)),
      ),
  );
}

/** Borra todo el contenido de un producto. Lo usa el borrado del producto. */
export async function deleteProductContent(productId: string): Promise<void> {
  const lessons = await Lesson.find({ product: productId }).lean();
  await removeLessons(lessons);
  await Promise.all([
    Module.deleteMany({ product: productId }),
    LiveSession.deleteMany({ product: productId }),
    Progress.deleteMany({ product: productId }),
  ]);
}

/* ---------- Reordenar ---------- */

/**
 * Recibe el árbol completo tal como quedó en pantalla. El índice en cada lista
 * es el nuevo `order`; una lección puede haber cambiado de módulo.
 */
export async function reorderContent(productId: string, body: any) {
  assertObjectId(productId, "El producto");
  if (!Array.isArray(body?.modules)) {
    throw new CustomError("Envía la lista de módulos con sus lecciones", 400);
  }

  const moduleOps: any[] = [];
  const lessonOps: any[] = [];

  body.modules.forEach((item: any, moduleIndex: number) => {
    const moduleId = assertObjectId(item?.id, "El módulo");
    moduleOps.push({
      // El filtro por producto impide reordenar contenido ajeno con ids sueltos.
      updateOne: {
        filter: { _id: moduleId, product: productId },
        update: { $set: { order: moduleIndex } },
      },
    });

    if (item.lessons !== undefined && !Array.isArray(item.lessons)) {
      throw new CustomError("Las lecciones de cada módulo deben ser una lista", 400);
    }
    (item.lessons ?? []).forEach((lessonId: unknown, lessonIndex: number) => {
      lessonOps.push({
        updateOne: {
          filter: { _id: assertObjectId(lessonId, "La lección"), product: productId },
          update: { $set: { order: lessonIndex, module: moduleId } },
        },
      });
    });
  });

  // Un módulo de otro producto haría que sus lecciones quedaran colgando de él.
  const moduleIds = body.modules.map((item: any) => item.id);
  const owned = await Module.countDocuments({ _id: { $in: moduleIds }, product: productId });
  if (owned !== new Set(moduleIds.map(String)).size) {
    throw new CustomError("Hay módulos que no pertenecen a este producto", 400);
  }

  if (moduleOps.length) await Module.bulkWrite(moduleOps);
  if (lessonOps.length) await Lesson.bulkWrite(lessonOps);

  return getAdminContent(productId);
}

/* ---------- Video ---------- */

/** Una colección de Bunny por producto, para que la biblioteca no sea un cajón. */
async function ensureCollection(productId: string): Promise<string | undefined> {
  try {
    const product = await Product.findById(productId).select("slug").lean();
    if (!product) return undefined;
    const collections = await bunnyService.listCollections();
    const existing = collections.find((collection) => collection.name === product.slug);
    if (existing) return existing.guid;
    return (await bunnyService.createCollection(product.slug)).guid;
  } catch (error) {
    // La colección es orden, no requisito: sin ella el video se sube igual.
    console.error("[content] no se pudo preparar la colección de Bunny:", error);
    return undefined;
  }
}

/**
 * Crea el video vacío en Bunny y devuelve la firma TUS: el navegador sube el
 * archivo directo a Bunny, así no pasa por el límite de tamaño de Vercel.
 */
export async function createLessonVideo(lessonId: string, body: any) {
  assertObjectId(lessonId, "La lección");
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new CustomError("Lección no encontrada", 404);

  const title = cleanString(body?.title, 200) || lesson.title;
  const collectionId = await ensureCollection(lesson.product.toString());
  const { guid } = await bunnyService.createVideo(title, collectionId);

  const previous = lesson.bunnyVideoId;
  lesson.bunnyVideoId = guid;
  lesson.durationSeconds = 0;
  await lesson.save();

  if (previous && previous !== guid) {
    bunnyService
      .deleteVideo(previous)
      .catch((error) => console.error("[content] no se pudo borrar el video anterior:", error));
  }

  const tus = bunnyService.buildTusSignature(guid);
  return {
    videoId: guid,
    libraryId: tus.libraryId,
    tus: { endpoint: tus.endpoint, signature: tus.signature, expire: tus.expire },
  };
}

export async function getLessonVideoStatus(lessonId: string) {
  assertObjectId(lessonId, "La lección");
  const lesson = await Lesson.findById(lessonId);
  if (!lesson) throw new CustomError("Lección no encontrada", 404);
  if (!lesson.bunnyVideoId) return { status: "none", ready: false, durationSeconds: 0 };

  const video = await bunnyService.getVideo(lesson.bunnyVideoId);
  const ready = video.status === bunnyService.BUNNY_STATUS_READY;

  if (ready && video.length > 0 && lesson.durationSeconds !== video.length) {
    lesson.durationSeconds = video.length;
    await lesson.save();
  }

  return {
    status: bunnyService.BUNNY_STATUS_LABELS[video.status] ?? "processing",
    ready,
    durationSeconds: ready ? video.length : lesson.durationSeconds,
  };
}
