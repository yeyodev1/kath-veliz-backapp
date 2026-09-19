/**
 * Carga el contenido de Kath (productos, módulos, lecciones, portadas,
 * descargables y videos) descrito en `content.manifest.json`.
 *
 * Es idempotente: producto por `slug`, módulo por {product, title}, lección por
 * {module, title}. No vuelve a subir una portada, un descargable, un adjunto ni
 * un video que ya esté guardado, y no pisa lo que se haya editado desde el panel.
 *
 * Los videos no pasan por esta máquina: Bunny los descarga directo desde Drive.
 *
 * Uso: pnpm import:content [--no-wait] [--root=<carpeta con los archivos>]
 *   --no-wait  lanza los videos y sale sin esperar a que Bunny termine; al
 *              volver a correr el script se completan las duraciones.
 */
import "dotenv/config";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import axios from "axios";
import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { Coupon } from "../models/coupon.model";
import { Lesson } from "../models/lesson.model";
import { Module } from "../models/module.model";
import { Product } from "../models/product.model";
import * as bunnyService from "../services/bunny.service";
import * as cloudinaryService from "../services/cloudinary.service";
import * as couponService from "../services/coupon.service";

/* ---------- Manifest ---------- */

interface ManifestAttachment {
  name: string;
  path: string;
}

interface ManifestLesson {
  title: string;
  order: number;
  description?: string;
  isPublished: boolean;
  isFreePreview?: boolean;
  /** Id del archivo en Drive: Bunny lo trae desde ahí. */
  driveId?: string;
  /**
   * Ruta del video en disco, relativa a la raíz. Si el archivo existe gana sobre driveId:
   * sirve cuando Drive agota su cuota anónima y los videos se bajan con sesión iniciada.
   */
  videoLocalPath?: string;
  /** Título único del video en Bunny; con él se ubica su guid tras el fetch. */
  bunnyTitle?: string;
  /** guid de un video que ya está en Bunny: se reutiliza, no se vuelve a subir. */
  bunnyVideoId?: string;
  attachments?: ManifestAttachment[];
}

interface ManifestModule {
  title: string;
  order: number;
  description?: string;
  lessons: ManifestLesson[];
}

interface ManifestProduct {
  slug: string;
  type: "course" | "download" | "service" | "free";
  order: number;
  title: string;
  subtitle: string;
  description: string;
  highlights: string[];
  audience: string[];
  faqs: { question: string; answer: string }[];
  priceCents: number;
  saleMode: "open" | "waitlist" | "closed";
  accessDurationDays: number | null;
  isPublished: boolean;
  cover?: string;
  downloadFile?: string;
  surveyQuestions?: { label: string; type: string; options: string[]; required: boolean }[];
  modules: ManifestModule[];
}

interface Manifest {
  localRoot: string;
  products: ManifestProduct[];
}

/* ---------- Utilidades ---------- */

const TMP_DIR = path.resolve(__dirname, "../../tmp/import-content");
const POLL_INTERVAL_MS = 60_000;
const POLL_MAX_MS = 40 * 60_000;
const FAILED_STATUSES = [5, 6];

const counters = { ok: 0, skipped: 0, failed: 0, pending: 0 };
const failures: string[] = [];

function logOk(scope: string, name: string, extra = "") {
  counters.ok++;
  console.log(`[${scope}] ${name}: ok${extra ? ` (${extra})` : ""}`);
}

function logSkipped(scope: string, name: string) {
  counters.skipped++;
  console.log(`[${scope}] ${name}: omitido (ya existe)`);
}

function logFailed(scope: string, name: string, error: unknown) {
  counters.failed++;
  const line = `[${scope}] ${name}: falló: ${reason(error)}`;
  failures.push(line);
  console.log(line);
}

function logPending(scope: string, name: string, extra: string) {
  counters.pending++;
  console.log(`[${scope}] ${name}: pendiente (${extra})`);
}

/** Motivo legible sin volcar objetos enteros (ni cabeceras con llaves) al log. */
function reason(error: unknown): string {
  if (typeof error === "string") return error;
  const err = error as any;
  const details = err?.details;
  const parts = [err?.message || err?.error?.message || "error desconocido"];
  if (details?.status) parts.push(`HTTP ${details.status}`);
  if (details?.data) parts.push(JSON.stringify(details.data).slice(0, 300));
  else if (details?.message) parts.push(String(details.message));
  return parts.join(" · ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function driveDownloadUrl(driveId: string): string {
  return `https://drive.usercontent.google.com/download?id=${driveId}&export=download&confirm=t`;
}

/**
 * Pide el archivo a Drive como lo hará Bunny y corta apenas llegan las cabeceras.
 * Si Drive responde HTML (cuota de descargas excedida, archivo sin compartir),
 * Bunny guardaría esa página y el video moriría con "Invalid file": mejor no pedirlo.
 */
async function assertDriveServesVideo(driveId: string): Promise<void> {
  const controller = new AbortController();
  try {
    const response = await axios.get(driveDownloadUrl(driveId), {
      responseType: "stream",
      signal: controller.signal,
      timeout: 30_000,
      validateStatus: () => true,
    });
    // Al cortar la descarga el stream emite un error que aquí no interesa.
    response.data.on("error", () => undefined);
    const contentType = String(response.headers["content-type"] ?? "");
    let body = "";
    if (contentType.includes("text/html")) {
      for await (const chunk of response.data) {
        body += chunk.toString();
        if (body.length > 4000) break;
      }
    }
    if (response.status !== 200 || !/^(video|application\/octet-stream)/.test(contentType)) {
      const why = /quota exceeded/i.test(body)
        ? "cuota de descargas de Drive excedida para este archivo (Google la libera en hasta 24 h)"
        : `respondió HTTP ${response.status} ${contentType || "sin content-type"}`;
      throw new Error(`Drive no entrega el archivo: ${why}`);
    }
  } finally {
    controller.abort();
  }
}

function statusLabel(status: number): string {
  return `${status} ${bunnyService.BUNNY_STATUS_LABELS[status] ?? "desconocido"}`;
}

/** Cloudinary rechaza imágenes de más de 10 MB y los originales pesan 12-20 MB. */
function resizeImage(source: string, slug: string): string {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const output = path.join(TMP_DIR, `${slug}-cover.jpg`);
  execFileSync(
    "sips",
    ["-s", "format", "jpeg", "-s", "formatOptions", "80", "-Z", "1800", source, "--out", output],
    { stdio: "ignore" },
  );
  return output;
}

/* ---------- Producto ---------- */

async function importProduct(entry: ManifestProduct, root: string) {
  let product = await Product.findOne({ slug: entry.slug });
  if (product) {
    logSkipped("producto", entry.slug);
  } else {
    product = await Product.create({
      type: entry.type,
      slug: entry.slug,
      title: entry.title,
      subtitle: entry.subtitle,
      description: entry.description,
      highlights: entry.highlights,
      audience: entry.audience,
      faqs: entry.faqs,
      priceCents: entry.priceCents,
      saleMode: entry.saleMode,
      accessDurationDays: entry.accessDurationDays,
      isPublished: entry.isPublished,
      order: entry.order,
      surveyQuestions: entry.surveyQuestions ?? [],
    });
    logOk("producto", entry.slug);
  }

  if (entry.cover) {
    const name = `${entry.slug} ← ${path.basename(entry.cover)}`;
    if (product.cover?.publicId) {
      logSkipped("portada", name);
    } else {
      try {
        const source = path.join(root, entry.cover);
        if (!fs.existsSync(source)) throw new Error(`no existe el archivo ${source}`);
        const resized = resizeImage(source, entry.slug);
        const image = await cloudinaryService.uploadImage(
          resized,
          cloudinaryService.PRODUCT_IMAGES_FOLDER,
        );
        product.cover = image;
        await product.save();
        logOk("portada", name, image.publicId);
      } catch (error) {
        logFailed("portada", name, error);
      }
    }
  }

  if (entry.downloadFile) {
    const name = `${entry.slug} ← ${path.basename(entry.downloadFile)}`;
    if (product.downloadFile?.publicId) {
      logSkipped("descargable", name);
    } else {
      try {
        const source = path.join(root, entry.downloadFile);
        if (!fs.existsSync(source)) throw new Error(`no existe el archivo ${source}`);
        const file = await cloudinaryService.uploadRaw(
          fs.readFileSync(source),
          path.basename(entry.downloadFile),
          { isPrivate: true },
        );
        product.downloadFile = file;
        await product.save();
        logOk("descargable", name, `privado · ${file.publicId}`);
      } catch (error) {
        logFailed("descargable", name, error);
      }
    }
  }

  // Quien se anota a la lista de espera recibe este cupón: se deja creado de una vez.
  if (entry.saleMode === "waitlist") {
    const code = couponService.waitlistCode(entry.slug);
    try {
      if (await Coupon.exists({ code })) {
        logSkipped("cupón", code);
      } else {
        await couponService.ensureWaitlistCoupon({ _id: product._id, slug: entry.slug });
        logOk("cupón", code);
      }
    } catch (error) {
      logFailed("cupón", code, error);
    }
  }

  return product;
}

/* ---------- Módulos, lecciones y adjuntos ---------- */

async function importModules(
  entry: ManifestProduct,
  productId: mongoose.Types.ObjectId,
  root: string,
) {
  for (const moduleEntry of entry.modules) {
    const moduleName = `${entry.slug} / ${moduleEntry.title}`;
    let moduleDoc = await Module.findOne({ product: productId, title: moduleEntry.title });
    try {
      if (moduleDoc) {
        logSkipped("módulo", moduleName);
      } else {
        moduleDoc = await Module.create({
          product: productId,
          title: moduleEntry.title,
          description: moduleEntry.description ?? "",
          order: moduleEntry.order,
        });
        logOk("módulo", moduleName);
      }
    } catch (error) {
      logFailed("módulo", moduleName, error);
      continue;
    }

    for (const lessonEntry of moduleEntry.lessons) {
      const lessonName = `${moduleName} / ${lessonEntry.title}`;
      let lesson = await Lesson.findOne({ module: moduleDoc._id, title: lessonEntry.title });
      try {
        if (lesson) {
          logSkipped("lección", lessonName);
        } else {
          // Sin video confirmado la lección nace oculta; se publica cuando Bunny
          // confirma que el video existe (ver attachVideos).
          const hasVideoSource = !!(lessonEntry.driveId || lessonEntry.bunnyVideoId);
          lesson = await Lesson.create({
            product: productId,
            module: moduleDoc._id,
            title: lessonEntry.title,
            description: lessonEntry.description ?? "",
            order: lessonEntry.order,
            bunnyVideoId: "",
            durationSeconds: 0,
            isFreePreview: !!lessonEntry.isFreePreview,
            isPublished: hasVideoSource ? false : lessonEntry.isPublished,
          });
          logOk("lección", lessonName, hasVideoSource ? "video por asignar" : "sin video");
        }
      } catch (error) {
        logFailed("lección", lessonName, error);
        continue;
      }

      for (const attachment of lessonEntry.attachments ?? []) {
        const attachmentName = `${lessonName} ← ${attachment.name}`;
        if (lesson.attachments.some((item) => item.name === attachment.name)) {
          logSkipped("adjunto", attachmentName);
          continue;
        }
        try {
          const source = path.join(root, attachment.path);
          if (!fs.existsSync(source)) throw new Error(`no existe el archivo ${source}`);
          const file = await cloudinaryService.uploadRaw(fs.readFileSync(source), attachment.name);
          lesson.attachments.push({
            name: attachment.name,
            url: file.url,
            publicId: file.publicId,
          });
          await lesson.save();
          logOk("adjunto", attachmentName, file.publicId);
        } catch (error) {
          logFailed("adjunto", attachmentName, error);
        }
      }
    }
  }
}

/* ---------- Videos ---------- */

type BunnyVideo = Awaited<ReturnType<typeof bunnyService.listVideos>>[number];

async function ensureCollection(slug: string): Promise<string> {
  const collections = await bunnyService.listCollections();
  const existing = collections.find((collection) => collection.name === slug);
  if (existing) {
    logSkipped("colección", slug);
    return existing.guid;
  }
  const created = await bunnyService.createCollection(slug);
  logOk("colección", slug, created.guid);
  return created.guid;
}

/** El fetch de Bunny no devuelve el guid: se busca por el título único que se le dio. */
async function findVideoByTitle(title: string, attempts: number): Promise<BunnyVideo | null> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const videos = await bunnyService.listVideos();
    const found = videos.find((video) => video.title === title);
    if (found) return found;
    if (attempt < attempts) await sleep(5_000);
  }
  return null;
}

/**
 * Deja cada lección con su guid de Bunny. No espera el procesamiento: eso lo
 * hace waitForVideos, así todos los fetch corren en paralelo del lado de Bunny.
 */
async function attachVideos(
  entry: ManifestProduct,
  productId: mongoose.Types.ObjectId,
  root: string,
) {
  const withVideo = entry.modules.flatMap((moduleEntry) =>
    moduleEntry.lessons
      .filter((lessonEntry) => lessonEntry.driveId || lessonEntry.bunnyVideoId)
      .map((lessonEntry) => ({ moduleEntry, lessonEntry })),
  );
  if (!withVideo.length) return;

  if (!bunnyService.isBunnyConfigured()) {
    logFailed("videos", entry.slug, "Bunny Stream no está configurado en el .env");
    return;
  }

  let collectionId = "";
  try {
    collectionId = await ensureCollection(entry.slug);
  } catch (error) {
    logFailed("colección", entry.slug, error);
  }

  for (const { moduleEntry, lessonEntry } of withVideo) {
    const name = `${entry.slug} / ${moduleEntry.title} / ${lessonEntry.title}`;
    try {
      const moduleDoc = await Module.findOne({ product: productId, title: moduleEntry.title });
      const lesson = moduleDoc
        ? await Lesson.findOne({ module: moduleDoc._id, title: lessonEntry.title })
        : null;
      if (!lesson) throw new Error("la lección no existe en la base");

      if (lesson.bunnyVideoId) {
        // La duración en 0 significa que Bunny aún procesaba: lo retoma waitForVideos.
        if (lesson.durationSeconds > 0) logSkipped("video", name);
        continue;
      }

      let guid = lessonEntry.bunnyVideoId ?? "";

      if (guid) {
        // Video que ya estaba en Bunny: se confirma que existe antes de enlazarlo.
        const video = await bunnyService.getVideo(guid);
        if (FAILED_STATUSES.includes(video.status)) {
          throw new Error(`el video ${guid} está en Bunny con estado ${statusLabel(video.status)}`);
        }
        if (collectionId) {
          const listed = (await bunnyService.listVideos()).find((item) => item.guid === guid);
          if (listed && listed.collectionId !== collectionId) {
            await bunnyService.moveVideoToCollection(guid, collectionId);
            console.log(`[video] ${name}: movido a la colección ${entry.slug}`);
          }
        }
      } else {
        const title = lessonEntry.bunnyTitle || `${entry.slug} | ${lessonEntry.title}`;
        let found = await findVideoByTitle(title, 1);
        if (found && FAILED_STATUSES.includes(found.status)) {
          // Intento anterior fallido: se limpia para no dejar dos videos con el mismo título.
          await bunnyService.deleteVideo(found.guid);
          console.log(`[video] ${name}: se borró el intento fallido ${found.guid}`);
          found = null;
        }
        const localFile = lessonEntry.videoLocalPath
          ? path.resolve(root, lessonEntry.videoLocalPath)
          : "";
        if (!found && localFile && fs.existsSync(localFile)) {
          const created = await bunnyService.createVideo(title, collectionId || undefined);
          console.log(`[video] ${name}: subiendo desde disco ${path.basename(localFile)}…`);
          await bunnyService.uploadVideoFile(created.guid, localFile);
          found = { guid: created.guid, title, collectionId, status: 1, length: 0 };
        }
        if (!found) {
          await assertDriveServesVideo(lessonEntry.driveId as string);
          const fetched = await bunnyService.fetchVideoFromUrl(
            driveDownloadUrl(lessonEntry.driveId as string),
            title,
            collectionId || undefined,
          );
          found = fetched.guid
            ? { guid: fetched.guid, title, collectionId, status: 0, length: 0 }
            : await findVideoByTitle(title, 6);
        }
        if (!found) throw new Error("Bunny aceptó el fetch pero el video no aparece por título");
        guid = found.guid;
      }

      lesson.bunnyVideoId = guid;
      lesson.isPublished = lessonEntry.isPublished;
      await lesson.save();
      console.log(`[video] ${name}: enlazado a ${guid}, a la espera de Bunny`);
    } catch (error) {
      logFailed("video", name, error);
    }
  }
}

/** Sondea Bunny hasta que cada video pendiente termine, falle o se acabe el tiempo. */
async function waitForVideos(productIds: mongoose.Types.ObjectId[], wait: boolean) {
  const startedAt = Date.now();

  while (true) {
    const pendingLessons = await Lesson.find({
      product: { $in: productIds },
      bunnyVideoId: { $ne: "" },
      durationSeconds: 0,
    });
    if (!pendingLessons.length) return;

    const stillProcessing: { name: string; detail: string }[] = [];
    for (const lesson of pendingLessons) {
      const name = `${lesson.title} (${lesson.bunnyVideoId})`;
      try {
        const video = await bunnyService.getVideo(lesson.bunnyVideoId);
        if (video.status === bunnyService.BUNNY_STATUS_READY && video.length > 0) {
          lesson.durationSeconds = video.length;
          await lesson.save();
          logOk("video", name, `estado ${statusLabel(video.status)} · ${video.length} s`);
        } else if (FAILED_STATUSES.includes(video.status)) {
          const why = video.messages.length ? video.messages.join("; ") : "Bunny no dio detalle";
          // El video fallido se deja en Bunny como evidencia; la lección queda sin video y oculta.
          const failedGuid = lesson.bunnyVideoId;
          lesson.bunnyVideoId = "";
          lesson.isPublished = false;
          await lesson.save();
          logFailed(
            "video",
            `${lesson.title} (${failedGuid})`,
            `estado ${statusLabel(video.status)} · ${why}`,
          );
        } else {
          stillProcessing.push({
            name,
            detail: `estado ${statusLabel(video.status)} · ${video.encodeProgress}%`,
          });
        }
      } catch (error) {
        stillProcessing.push({ name, detail: `no se pudo consultar (${reason(error)})` });
      }
    }

    if (!stillProcessing.length) return;

    const elapsed = Date.now() - startedAt;
    if (!wait || elapsed + POLL_INTERVAL_MS > POLL_MAX_MS) {
      for (const item of stillProcessing) {
        logPending("video", item.name, `${item.detail} · vuelve a correr pnpm import:content`);
      }
      return;
    }

    console.log(
      `… ${stillProcessing.length} video(s) en proceso (${Math.round(elapsed / 60_000)} min):`,
    );
    for (const item of stillProcessing) console.log(`    ${item.name}: ${item.detail}`);
    await sleep(POLL_INTERVAL_MS);
  }
}

/* ---------- Main ---------- */

async function main() {
  const args = process.argv.slice(2);
  const wait = !args.includes("--no-wait");
  const rootArg = args.find((arg) => arg.startsWith("--root="));

  const manifest: Manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "content.manifest.json"), "utf8"),
  );
  const root = rootArg ? rootArg.slice("--root=".length) : manifest.localRoot;

  console.log("Conectando a MongoDB...");
  await dbConnect();

  const productIds: mongoose.Types.ObjectId[] = [];
  for (const entry of manifest.products) {
    console.log(`\n=== ${entry.slug} ===`);
    try {
      const product = await importProduct(entry, root);
      productIds.push(product._id);
      await importModules(entry, product._id, root);
      await attachVideos(entry, product._id, root);
    } catch (error) {
      logFailed("producto", entry.slug, error);
    }
  }

  console.log("\n=== Videos en Bunny ===");
  await waitForVideos(productIds, wait);

  const expected = {
    products: manifest.products.length,
    modules: manifest.products.reduce((sum, product) => sum + product.modules.length, 0),
    lessons: manifest.products.reduce(
      (sum, product) => sum + product.modules.reduce((n, module) => n + module.lessons.length, 0),
      0,
    ),
  };
  const [products, modules, lessons, lessonsWithVideo] = await Promise.all([
    Product.countDocuments({ _id: { $in: productIds } }),
    Module.countDocuments({ product: { $in: productIds } }),
    Lesson.countDocuments({ product: { $in: productIds } }),
    Lesson.countDocuments({ product: { $in: productIds }, bunnyVideoId: { $ne: "" } }),
  ]);

  console.log("\n=== Resumen ===");
  console.log(`Productos: ${products}/${expected.products}`);
  console.log(`Módulos:   ${modules}/${expected.modules}`);
  console.log(`Lecciones: ${lessons}/${expected.lessons} (${lessonsWithVideo} con video)`);
  console.log(
    `Log: ${counters.ok} ok · ${counters.skipped} omitidos · ${counters.pending} pendientes · ${counters.failed} fallos`,
  );
  for (const line of failures) console.log(`  ${line}`);

  await mongoose.disconnect();
  process.exit(counters.failed ? 1 : 0);
}

main().catch((error) => {
  console.error("✖ Falló la carga:", reason(error));
  process.exit(1);
});
