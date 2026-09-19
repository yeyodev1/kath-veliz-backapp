import { CustomError } from "../errors/customError.error";
import {
  Product,
  IProduct,
  IProductFile,
  ISurveyQuestion,
  PRODUCT_TYPES,
  SALE_MODES,
  SURVEY_QUESTION_TYPES,
} from "../models/product.model";
import { LiveSession } from "../models/liveSession.model";
import { Access } from "../models/access.model";
import { slugify } from "../utils/slugify";
import {
  assertObjectId,
  cleanBoolean,
  cleanInt,
  cleanNullableInt,
  cleanString,
  cleanStringList,
  cleanUrl,
  has,
  requiredString,
} from "../utils/input";
import * as contentService from "./content.service";

/* ---------- Serialización ---------- */

interface LessonStats {
  lessonCount: number;
  totalDurationSeconds: number;
}

/**
 * Tarjeta del catálogo. Solo lo que se puede mostrar a cualquiera: ni archivos,
 * ni enlaces de recursos, ni nada que sea parte de lo que se vende.
 */
export function toProductCard(product: any, stats?: LessonStats) {
  return {
    id: product._id.toString(),
    type: product.type,
    slug: product.slug,
    title: product.title,
    subtitle: product.subtitle,
    cover: product.cover ? { url: product.cover.url, publicId: product.cover.publicId } : null,
    priceCents: product.priceCents,
    compareAtPriceCents: product.compareAtPriceCents,
    saleMode: product.saleMode,
    accessDurationDays: product.accessDurationDays,
    order: product.order,
    lessonCount: stats?.lessonCount ?? 0,
    totalDurationSeconds: stats?.totalDurationSeconds ?? 0,
  };
}

/** Detalle público de la landing. Nunca incluye bunnyVideoId ni URLs de archivos. */
export async function toProductDetail(product: any) {
  const productId = product._id.toString();
  const [outline, sessions] = await Promise.all([
    contentService.getPublicOutline(productId),
    LiveSession.find({ product: productId, startsAt: { $gte: new Date() } })
      .sort({ startsAt: 1 })
      .limit(10)
      .lean(),
  ]);

  return {
    ...toProductCard(product, outline),
    description: product.description,
    highlights: product.highlights ?? [],
    audience: product.audience ?? [],
    faqs: (product.faqs ?? []).map((faq: any) => ({ question: faq.question, answer: faq.answer })),
    surveyQuestions: (product.surveyQuestions ?? []).map((question: ISurveyQuestion) => ({
      label: question.label,
      type: question.type,
      options: question.options ?? [],
      required: !!question.required,
    })),
    hasDownload: !!product.downloadFile?.publicId,
    hasInfoPdf: !!product.infoPdf?.publicId,
    modules: outline.modules,
    // El enlace de Meet es parte de lo que se paga: aquí solo fecha y tema.
    nextLiveSessions: sessions.map((session) => ({
      id: session._id.toString(),
      title: session.title,
      description: session.description,
      startsAt: session.startsAt,
    })),
  };
}

/** Producto completo para el panel. */
export function toAdminProduct(product: any, stats?: LessonStats) {
  const file = (value: IProductFile | null | undefined) =>
    value ? { url: value.url, publicId: value.publicId, filename: value.filename } : null;
  return {
    ...toProductCard(product, stats),
    description: product.description,
    highlights: product.highlights ?? [],
    audience: product.audience ?? [],
    faqs: (product.faqs ?? []).map((faq: any) => ({ question: faq.question, answer: faq.answer })),
    isPublished: product.isPublished,
    downloadFile: file(product.downloadFile),
    freeResourceUrl: product.freeResourceUrl,
    infoPdf: file(product.infoPdf),
    surveyQuestions: (product.surveyQuestions ?? []).map((question: ISurveyQuestion) => ({
      label: question.label,
      type: question.type,
      options: question.options ?? [],
      required: !!question.required,
    })),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

/* ---------- Catálogo público ---------- */

export async function listPublicProducts(type?: string) {
  const filter: Record<string, unknown> = { isPublished: true };
  if (type) {
    if (!PRODUCT_TYPES.includes(type as any)) {
      throw new CustomError("Ese tipo de producto no existe", 400);
    }
    filter.type = type;
  }

  const products = await Product.find(filter).sort({ order: 1, createdAt: 1 }).lean();
  const stats = await contentService.lessonStatsByProduct(products.map((product) => product._id));
  return products.map((product) => toProductCard(product, stats.get(product._id.toString())));
}

/** Producto publicado por slug. Lo usan las rutas públicas (leads, cupones, asesoría). */
export async function findPublishedBySlug(slug: unknown) {
  const clean = cleanString(slug, 200).toLowerCase();
  if (!clean) throw new CustomError("Falta indicar el producto", 400);
  const product = await Product.findOne({ slug: clean, isPublished: true }).lean();
  if (!product) throw new CustomError("Producto no encontrado", 404);
  return product;
}

export async function getPublicProduct(slug: string) {
  return toProductDetail(await findPublishedBySlug(slug));
}

/* ---------- Panel ---------- */

export async function listAdminProducts() {
  const products = await Product.find().sort({ order: 1, createdAt: 1 }).lean();
  const stats = await contentService.lessonStatsByProduct(products.map((product) => product._id));
  return products.map((product) => toAdminProduct(product, stats.get(product._id.toString())));
}

/** Slug único: si choca se le agrega -2, -3… */
async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  const root = slugify(base).replace(/^-+|-+$/g, "");
  if (!root) throw new CustomError("El título necesita al menos una letra o un número", 400);

  let candidate = root;
  for (let suffix = 2; suffix < 200; suffix++) {
    const taken = await Product.exists({
      slug: candidate,
      ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    });
    if (!taken) return candidate;
    candidate = `${root}-${suffix}`;
  }
  throw new CustomError("No se pudo generar un enlace único para este producto", 409);
}

function parseImage(value: unknown): IProduct["cover"] {
  if (value === null || value === "") return null;
  const image = value as any;
  const url = cleanUrl(image?.url, "La portada");
  if (!url) throw new CustomError("La portada necesita la URL de la imagen", 400);
  return { url, publicId: cleanString(image?.publicId, 500) };
}

function parseFile(value: unknown, label: string): IProductFile | null {
  if (value === null || value === "") return null;
  const file = value as any;
  const publicId = cleanString(file?.publicId, 500);
  if (!publicId) throw new CustomError(`${label} necesita el archivo subido`, 400);
  return {
    url: cleanUrl(file?.url, label),
    publicId,
    filename: cleanString(file?.filename, 300),
  };
}

function parseFaqs(value: unknown): IProduct["faqs"] {
  if (!Array.isArray(value))
    throw new CustomError("Las preguntas frecuentes deben ser una lista", 400);
  return value.map((item) => ({
    question: requiredString(item?.question, "Cada pregunta frecuente necesita su pregunta", 500),
    answer: cleanString(item?.answer),
  }));
}

function parseSurveyQuestions(value: unknown): ISurveyQuestion[] {
  if (!Array.isArray(value))
    throw new CustomError("Las preguntas de la encuesta deben ser una lista", 400);
  return value.map((item) => {
    const type = cleanString(item?.type, 20) || "text";
    if (!SURVEY_QUESTION_TYPES.includes(type as any)) {
      throw new CustomError("El tipo de pregunta debe ser text, textarea o select", 400);
    }
    const options =
      item?.options === undefined ? [] : cleanStringList(item.options, "Las opciones");
    if (type === "select" && options.length < 2) {
      throw new CustomError("Una pregunta de selección necesita al menos dos opciones", 400);
    }
    return {
      label: requiredString(item?.label, "Cada pregunta de la encuesta necesita su texto", 500),
      type: type as ISurveyQuestion["type"],
      options,
      required: item?.required === undefined ? false : cleanBoolean(item.required, "Obligatoria"),
    };
  });
}

function parseProductInput(body: any, partial: boolean): Partial<IProduct> {
  const data: Partial<IProduct> = {};

  if (!partial || has(body, "type")) {
    const type = cleanString(body?.type, 20);
    if (!PRODUCT_TYPES.includes(type as any)) {
      throw new CustomError("El tipo debe ser course, download, service o free", 400);
    }
    data.type = type as IProduct["type"];
  }
  if (!partial || has(body, "title")) {
    data.title = requiredString(body?.title, "Escribe el título del producto", 200);
  }
  if (has(body, "subtitle")) data.subtitle = cleanString(body.subtitle, 500);
  if (has(body, "description")) data.description = cleanString(body.description, 20000);
  if (has(body, "highlights")) data.highlights = cleanStringList(body.highlights, "Lo que incluye");
  if (has(body, "audience")) data.audience = cleanStringList(body.audience, "Para quién es");
  if (has(body, "faqs")) data.faqs = parseFaqs(body.faqs);
  if (has(body, "cover")) data.cover = parseImage(body.cover);
  if (has(body, "priceCents")) data.priceCents = cleanInt(body.priceCents, "El precio en centavos");
  if (has(body, "compareAtPriceCents")) {
    data.compareAtPriceCents = cleanNullableInt(body.compareAtPriceCents, "El precio anterior");
  }
  if (has(body, "saleMode")) {
    const saleMode = cleanString(body.saleMode, 20);
    if (!SALE_MODES.includes(saleMode as any)) {
      throw new CustomError("El modo de venta debe ser open, waitlist o closed", 400);
    }
    data.saleMode = saleMode as IProduct["saleMode"];
  }
  if (has(body, "accessDurationDays")) {
    data.accessDurationDays = cleanNullableInt(body.accessDurationDays, "Los días de acceso", 1);
  }
  if (has(body, "isPublished")) data.isPublished = cleanBoolean(body.isPublished, "Publicado");
  if (has(body, "order")) data.order = cleanInt(body.order, "El orden");
  if (has(body, "downloadFile")) data.downloadFile = parseFile(body.downloadFile, "El descargable");
  if (has(body, "freeResourceUrl")) {
    data.freeResourceUrl = cleanUrl(body.freeResourceUrl, "El enlace del recurso");
  }
  if (has(body, "infoPdf")) data.infoPdf = parseFile(body.infoPdf, "El PDF informativo");
  if (has(body, "surveyQuestions")) {
    data.surveyQuestions = parseSurveyQuestions(body.surveyQuestions);
  }

  return data;
}

/** Un producto publicado tiene que poder cumplir lo que promete su landing. */
function assertPublishable(product: Partial<IProduct>) {
  if (!product.isPublished) return;
  if (product.type === "free" && !product.freeResourceUrl) {
    throw new CustomError(
      "Para publicar un recurso gratuito agrega el enlace que se envía por correo",
      400,
    );
  }
  if (product.type === "download" && !product.downloadFile?.publicId) {
    throw new CustomError("Para publicar un descargable primero sube el archivo", 400);
  }
  if (
    product.compareAtPriceCents !== null &&
    product.compareAtPriceCents !== undefined &&
    product.compareAtPriceCents <= (product.priceCents ?? 0)
  ) {
    throw new CustomError("El precio anterior debe ser mayor que el precio actual", 400);
  }
}

export async function createProduct(body: any) {
  const data = parseProductInput(body, false);
  data.slug = await uniqueSlug(cleanString(body?.slug, 200) || data.title!);
  if (data.order === undefined) data.order = await Product.countDocuments();
  assertPublishable(data);

  const product = await Product.create(data);
  return toAdminProduct(product);
}

export async function updateProduct(id: string, body: any) {
  assertObjectId(id, "El producto");
  const product = await Product.findById(id);
  if (!product) throw new CustomError("Producto no encontrado", 404);

  const data = parseProductInput(body, true);
  // El slug solo cambia si lo piden: cambiarlo al editar el título rompería enlaces ya compartidos.
  if (has(body, "slug")) {
    const requested = cleanString(body.slug, 200);
    if (requested && slugify(requested) !== product.slug) {
      data.slug = await uniqueSlug(requested, id);
    }
  }

  product.set(data);
  assertPublishable(product.toObject());
  await product.save();

  const stats = await contentService.lessonStatsByProduct([product._id]);
  return toAdminProduct(product, stats.get(product._id.toString()));
}

export async function deleteProduct(id: string): Promise<{ ok: true }> {
  assertObjectId(id, "El producto");
  const product = await Product.findById(id);
  if (!product) throw new CustomError("Producto no encontrado", 404);

  // Borrarlo dejaría a gente que pagó sin su curso. Para retirarlo de la venta está despublicar.
  const accesses = await Access.countDocuments({ product: id });
  if (accesses > 0) {
    throw new CustomError(
      "Este producto tiene alumnos con acceso. Despublícalo en lugar de borrarlo.",
      409,
    );
  }

  await contentService.deleteProductContent(id);
  await product.deleteOne();
  return { ok: true };
}
