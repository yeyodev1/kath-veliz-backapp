import { Types } from "mongoose";
import { CustomError } from "../errors/customError.error";

/**
 * Validación de entrada a mano. Cada helper lanza un 400 con un mensaje que la
 * persona entiende, en vez de dejar que Mongoose responda con un 500 críptico.
 */

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function assertObjectId(value: unknown, label = "El identificador"): string {
  const id = String(value ?? "");
  if (!Types.ObjectId.isValid(id)) throw new CustomError(`${label} no es válido`, 400);
  return id;
}

export function cleanString(value: unknown, maxLength = 5000): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") {
    throw new CustomError("Se esperaba un texto", 400);
  }
  return String(value).trim().slice(0, maxLength);
}

export function requiredString(value: unknown, message: string, maxLength = 5000): string {
  const text = cleanString(value, maxLength);
  if (!text) throw new CustomError(message, 400);
  return text;
}

export function cleanEmail(value: unknown): string {
  const email = cleanString(value, 200).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new CustomError("Escribe un correo válido", 400);
  return email;
}

export function cleanBoolean(value: unknown, label: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new CustomError(`${label} debe ser verdadero o falso`, 400);
}

/** Entero no negativo. Los centavos y las duraciones nunca llevan decimales. */
export function cleanInt(value: unknown, label: string, min = 0): number {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isInteger(number) || number < min) {
    throw new CustomError(`${label} debe ser un número entero mayor o igual a ${min}`, 400);
  }
  return number;
}

export function cleanNullableInt(value: unknown, label: string, min = 0): number | null {
  if (value === null || value === "") return null;
  return cleanInt(value, label, min);
}

export function cleanStringList(value: unknown, label: string, maxLength = 500): string[] {
  if (!Array.isArray(value)) throw new CustomError(`${label} debe ser una lista`, 400);
  return value.map((item) => cleanString(item, maxLength)).filter(Boolean);
}

/** Fecha ISO obligatoria. Para aceptar null está cleanNullableDate. */
export function cleanDate(value: unknown, label: string): Date {
  const date = new Date(String(value ?? ""));
  if (!value || Number.isNaN(date.getTime())) {
    throw new CustomError(`${label} no es una fecha válida`, 400);
  }
  return date;
}

export function cleanNullableDate(value: unknown, label: string): Date | null {
  if (value === null || value === "") return null;
  return cleanDate(value, label);
}

export function cleanUrl(value: unknown, label: string): string {
  const url = cleanString(value, 2000);
  if (!url) return "";
  if (!/^https?:\/\/\S+$/i.test(url)) {
    throw new CustomError(`${label} debe ser un enlace que empiece con http:// o https://`, 400);
  }
  return url;
}

export function parsePage(value: unknown): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function has(body: unknown, key: string): boolean {
  return !!body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, key);
}
