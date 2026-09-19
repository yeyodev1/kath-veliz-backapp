import crypto from "crypto";
import fs from "fs";
import axios, { AxiosInstance } from "axios";
import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";

const API_BASE = "https://video.bunnycdn.com";
const TUS_ENDPOINT = "https://video.bunnycdn.com/tusupload";
const EMBED_BASE = "https://iframe.mediadelivery.net/embed";

// La firma TUS dura lo que puede tardar en subir un video pesado con mala conexión.
const TUS_TTL_SECONDS = 6 * 60 * 60;
// El embed firmado dura más que cualquier clase: no se corta a mitad de la lección.
const EMBED_TTL_SECONDS = 4 * 60 * 60;

/** Estados de Bunny Stream. 4 = listo para reproducir. */
export const BUNNY_STATUS_LABELS: Record<number, string> = {
  0: "created",
  1: "uploaded",
  2: "processing",
  3: "transcoding",
  4: "finished",
  5: "error",
  6: "upload_failed",
  7: "transcribing",
};
export const BUNNY_STATUS_READY = 4;

export function isBunnyConfigured(): boolean {
  return !!(env.BUNNY_LIBRARY_ID && env.BUNNY_STREAM_API_KEY);
}

let client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (!isBunnyConfigured()) {
    throw new CustomError("Bunny Stream no está configurado en el servidor", 503);
  }
  if (!client) {
    client = axios.create({
      baseURL: `${API_BASE}/library/${env.BUNNY_LIBRARY_ID}`,
      headers: { AccessKey: env.BUNNY_STREAM_API_KEY, Accept: "application/json" },
      timeout: 30_000,
    });
  }
  return client;
}

/** Traduce el fallo de axios a un CustomError sin filtrar la llave ni la respuesta cruda. */
function wrap(error: any, action: string): never {
  if (error instanceof CustomError) throw error;
  const status = error?.response?.status;
  if (status === 404) throw new CustomError("El video no existe en Bunny Stream", 404);
  throw new CustomError(`Bunny Stream no pudo ${action}`, 502, {
    status,
    data: error?.response?.data,
    message: error?.message,
  });
}

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export async function createVideo(title: string, collectionId?: string): Promise<{ guid: string }> {
  try {
    const body: Record<string, string> = { title };
    if (collectionId) body.collectionId = collectionId;
    const { data } = await getClient().post("/videos", body);
    return { guid: data.guid };
  } catch (error) {
    wrap(error, "crear el video");
  }
}

export async function getVideo(
  guid: string,
): Promise<{ status: number; length: number; encodeProgress: number; messages: string[] }> {
  try {
    const { data } = await getClient().get(`/videos/${guid}`);
    return {
      status: Number(data.status ?? 0),
      length: Number(data.length ?? 0),
      encodeProgress: Number(data.encodeProgress ?? 0),
      // Bunny explica aquí por qué falló un video; el script de carga lo reporta.
      messages: (data.transcodingMessages ?? []).map((item: any) =>
        [item?.issueCode, item?.message, item?.value].filter(Boolean).join(" "),
      ),
    };
  } catch (error) {
    wrap(error, "consultar el video");
  }
}

/** Todos los videos de la biblioteca en pocas llamadas: evita una consulta por lección. */
export async function listVideos(): Promise<
  { guid: string; title: string; collectionId: string; status: number; length: number }[]
> {
  const videos: {
    guid: string;
    title: string;
    collectionId: string;
    status: number;
    length: number;
  }[] = [];
  try {
    for (let page = 1; page <= 10; page++) {
      const { data } = await getClient().get("/videos", {
        params: { page, itemsPerPage: 1000, orderBy: "date" },
      });
      const items: any[] = data?.items ?? [];
      for (const item of items) {
        videos.push({
          guid: item.guid,
          title: item.title ?? "",
          collectionId: item.collectionId ?? "",
          status: Number(item.status ?? 0),
          length: Number(item.length ?? 0),
        });
      }
      if (!items.length || videos.length >= Number(data?.totalItems ?? 0)) break;
    }
    return videos;
  } catch (error) {
    wrap(error, "listar los videos");
  }
}

export async function deleteVideo(guid: string): Promise<void> {
  try {
    await getClient().delete(`/videos/${guid}`);
  } catch (error: any) {
    // Si ya no existe, el resultado es el que se buscaba.
    if (error?.response?.status === 404) return;
    wrap(error, "borrar el video");
  }
}

export async function createCollection(name: string): Promise<{ guid: string }> {
  try {
    const { data } = await getClient().post("/collections", { name });
    return { guid: data.guid };
  } catch (error) {
    wrap(error, "crear la colección");
  }
}

export async function listCollections(): Promise<
  { guid: string; name: string; videoCount: number }[]
> {
  try {
    const { data } = await getClient().get("/collections", {
      params: { page: 1, itemsPerPage: 1000, orderBy: "date" },
    });
    return (data?.items ?? []).map((item: any) => ({
      guid: item.guid,
      name: item.name ?? "",
      videoCount: Number(item.videoCount ?? 0),
    }));
  } catch (error) {
    wrap(error, "listar las colecciones");
  }
}

/**
 * Sube el archivo por stream. Solo para scripts locales: en Vercel no hay disco
 * ni tiempo para esto, el panel sube directo por TUS.
 */
export async function uploadVideoFile(guid: string, filePath: string): Promise<void> {
  if (!fs.existsSync(filePath)) throw new CustomError(`No existe el archivo ${filePath}`, 400);
  try {
    const { size } = fs.statSync(filePath);
    await getClient().put(`/videos/${guid}`, fs.createReadStream(filePath), {
      headers: { "Content-Type": "application/octet-stream", "Content-Length": String(size) },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 0,
    });
  } catch (error) {
    wrap(error, "recibir el archivo del video");
  }
}

/** Mueve un video que ya existe a una colección. */
export async function moveVideoToCollection(guid: string, collectionId: string): Promise<void> {
  try {
    await getClient().post(`/videos/${guid}`, { collectionId });
  } catch (error) {
    wrap(error, "mover el video a la colección");
  }
}

/**
 * Bunny descarga el video desde una URL pública (por ejemplo un enlace directo de Drive).
 * El endpoint no siempre devuelve el guid: si llega vacío, quien llama lo ubica
 * por título con `listVideos()`.
 */
export async function fetchVideoFromUrl(
  url: string,
  title: string,
  collectionId?: string,
): Promise<{ guid: string }> {
  try {
    const { data } = await getClient().post(
      "/videos/fetch",
      { url, title },
      { params: collectionId ? { collectionId } : undefined },
    );
    return { guid: data?.id || data?.guid || "" };
  } catch (error) {
    wrap(error, "traer el video desde la URL");
  }
}

/** Firma para que el navegador suba directo a Bunny por TUS sin conocer la llave. */
export function buildTusSignature(videoId: string): {
  endpoint: string;
  signature: string;
  expire: number;
  libraryId: string;
  videoId: string;
} {
  if (!isBunnyConfigured()) {
    throw new CustomError("Bunny Stream no está configurado en el servidor", 503);
  }
  const expire = Math.floor(Date.now() / 1000) + TUS_TTL_SECONDS;
  const signature = sha256(env.BUNNY_LIBRARY_ID + env.BUNNY_STREAM_API_KEY + expire + videoId);
  return { endpoint: TUS_ENDPOINT, signature, expire, libraryId: env.BUNNY_LIBRARY_ID, videoId };
}

/**
 * URL del reproductor. Con BUNNY_TOKEN_AUTH_KEY va firmada y caduca; sin la
 * llave sale sin token (sirve mientras la biblioteca no exija autenticación).
 */
export function buildEmbedUrl(videoId: string): { embedUrl: string; signed: boolean } {
  if (!env.BUNNY_LIBRARY_ID) {
    throw new CustomError("Bunny Stream no está configurado en el servidor", 503);
  }
  const base = `${EMBED_BASE}/${env.BUNNY_LIBRARY_ID}/${videoId}`;
  if (!env.BUNNY_TOKEN_AUTH_KEY) return { embedUrl: base, signed: false };

  const expires = Math.floor(Date.now() / 1000) + EMBED_TTL_SECONDS;
  const token = sha256(env.BUNNY_TOKEN_AUTH_KEY + videoId + expires);
  return { embedUrl: `${base}?token=${token}&expires=${expires}`, signed: true };
}

export function thumbnailUrl(guid: string): string {
  if (!env.BUNNY_CDN_HOSTNAME || !guid) return "";
  const host = env.BUNNY_CDN_HOSTNAME.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${host}/${guid}/thumbnail.jpg`;
}
