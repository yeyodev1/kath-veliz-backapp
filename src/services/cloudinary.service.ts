import { v2 as cloudinary, UploadApiResponse } from "cloudinary";
import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";

let configured = false;

export function isCloudinaryConfigured(): boolean {
  return !!(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

function ensureConfig() {
  if (configured) return;
  if (!isCloudinaryConfigured()) {
    throw new CustomError("Cloudinary no está configurado en el servidor", 503);
  }
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
  });
  configured = true;
}

const DEFAULT_FOLDER = "kath-veliz-backapp";

/** Sube un buffer (multer memoryStorage). */
export function uploadBuffer(
  buffer: Buffer,
  folder = DEFAULT_FOLDER,
): Promise<{ url: string; publicId: string }> {
  ensureConfig();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        transformation: [{ quality: "auto", fetch_format: "auto" }],
      },
      (error, result?: UploadApiResponse) => {
        if (error || !result) return reject(error || new Error("Cloudinary sin respuesta"));
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    stream.end(buffer);
  });
}

/** Sube un data URI base64 o una URL remota. */
export async function uploadImage(
  source: string,
  folder = DEFAULT_FOLDER,
): Promise<{ url: string; publicId: string }> {
  ensureConfig();
  const result = await cloudinary.uploader.upload(source, {
    folder,
    resource_type: "image",
    transformation: [{ quality: "auto", fetch_format: "auto" }],
  });
  return { url: result.secure_url, publicId: result.public_id };
}

export async function deleteImage(publicId: string): Promise<void> {
  ensureConfig();
  await cloudinary.uploader.destroy(publicId);
}

export const PRODUCT_IMAGES_FOLDER = "kath-veliz/productos";
const PRIVATE_FILES_FOLDER = "kath-veliz/descargables";
const PUBLIC_FILES_FOLDER = "kath-veliz/adjuntos";

// Lo justo para que la persona haga clic y empiece la descarga.
const DOWNLOAD_URL_TTL_SECONDS = 10 * 60;

/** Nombre seguro para el public_id. En raw la extensión forma parte del id. */
function safeFilename(filename: string): string {
  const clean = filename
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return clean || "archivo";
}

/**
 * Sube un archivo que no es imagen (Excel, PDF, zip).
 * Los privados quedan como "authenticated": su URL no abre sin firma, así el
 * descargable de pago no se puede compartir con solo copiar el enlace.
 */
export function uploadRaw(
  buffer: Buffer,
  filename: string,
  options: { isPrivate?: boolean } = {},
): Promise<{ url: string; publicId: string; filename: string }> {
  ensureConfig();
  const isPrivate = !!options.isPrivate;
  const safe = safeFilename(filename);
  const dot = safe.lastIndexOf(".");
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: isPrivate ? PRIVATE_FILES_FOLDER : PUBLIC_FILES_FOLDER,
        resource_type: "raw",
        type: isPrivate ? "authenticated" : "upload",
        // Sufijo con la hora: dos archivos con el mismo nombre no se pisan.
        public_id: `${base}-${Date.now()}${ext}`,
      },
      (error, result?: UploadApiResponse) => {
        if (error || !result) return reject(error || new Error("Cloudinary sin respuesta"));
        resolve({ url: result.secure_url, publicId: result.public_id, filename });
      },
    );
    stream.end(buffer);
  });
}

export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"];
export const FILE_EXTENSIONS = [
  ".pdf",
  ".xlsx",
  ".xls",
  ".xlsm",
  ".csv",
  ".docx",
  ".doc",
  ".pptx",
  ".ppt",
  ".zip",
  ".txt",
  ".png",
  ".jpg",
  ".jpeg",
];

export type UploadKind = "image" | "file";

export interface UploadSignature {
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  folder: string;
  resourceType: "image" | "raw";
  type: "upload" | "authenticated";
  publicId?: string;
  allowedFormats?: string;
  uploadUrl: string;
}

/**
 * Firma para que el navegador suba directo a Cloudinary.
 *
 * En Vercel el cuerpo de una petición no pasa de ~4.5 MB, así que el archivo no
 * puede viajar por este servidor. Aquí solo se firma: el secreto no sale nunca,
 * y como carpeta, tipo y public_id van dentro de la firma, el navegador no puede
 * cambiarlos sin que Cloudinary rechace la subida.
 */
export function createUploadSignature(input: {
  kind: UploadKind;
  filename: string;
  isPrivate?: boolean;
}): UploadSignature {
  ensureConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const base = {
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    timestamp,
  };

  if (input.kind === "image") {
    const allowedFormats = IMAGE_EXTENSIONS.map((ext) => ext.slice(1)).join(",");
    const signature = cloudinary.utils.api_sign_request(
      { allowed_formats: allowedFormats, folder: PRODUCT_IMAGES_FOLDER, timestamp },
      env.CLOUDINARY_API_SECRET,
    );
    return {
      ...base,
      signature,
      folder: PRODUCT_IMAGES_FOLDER,
      resourceType: "image",
      type: "upload",
      allowedFormats,
      uploadUrl: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    };
  }

  const isPrivate = !!input.isPrivate;
  const folder = isPrivate ? PRIVATE_FILES_FOLDER : PUBLIC_FILES_FOLDER;
  const type = isPrivate ? "authenticated" : "upload";
  const safe = safeFilename(input.filename);
  const dot = safe.lastIndexOf(".");
  const name = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";
  // Sufijo con la hora: dos archivos con el mismo nombre no se pisan.
  const publicId = `${name}-${Date.now()}${ext}`;
  const signature = cloudinary.utils.api_sign_request(
    { folder, public_id: publicId, timestamp, type },
    env.CLOUDINARY_API_SECRET,
  );
  return {
    ...base,
    signature,
    folder,
    resourceType: "raw",
    type,
    publicId,
    uploadUrl: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/raw/upload`,
  };
}

/**
 * URL firmada y de corta duración para bajar un archivo "authenticated".
 * Cloudinary nombra la descarga según el public_id; `filename` viaja aparte al
 * front para mostrarlo, no cambia la URL.
 */
export function privateDownloadUrl(publicId: string, _filename = ""): string {
  ensureConfig();
  // En raw el formato va dentro del public_id; se pasa vacío para que no lo duplique.
  return cloudinary.utils.private_download_url(publicId, "", {
    resource_type: "raw",
    type: "authenticated",
    expires_at: Math.floor(Date.now() / 1000) + DOWNLOAD_URL_TTL_SECONDS,
    attachment: true,
  });
}

export async function deleteRaw(publicId: string, isPrivate = false): Promise<void> {
  ensureConfig();
  await cloudinary.uploader.destroy(publicId, {
    resource_type: "raw",
    type: isPrivate ? "authenticated" : "upload",
  });
}
