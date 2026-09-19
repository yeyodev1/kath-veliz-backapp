import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { isConnected } from "../config/mongo";
import { CustomError } from "../errors/customError.error";
import { User, IUser } from "../models/user.model";
import * as commerceEmail from "./commerceEmail.service";

const TOKEN_TTL = "30d";
const RESET_TTL_MS = 60 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  phone: string;
  documentId: string;
  accountType: string;
}

export function sanitize(user: any): SessionUser {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    phone: user.phone,
    documentId: user.documentId || "",
    accountType: user.accountType,
  };
}

function signToken(user: any): string {
  return jwt.sign(
    { userId: user._id.toString(), email: user.email, accountType: user.accountType },
    env.JWT_SECRET,
    { expiresIn: TOKEN_TTL },
  );
}

function requireDb() {
  if (!isConnected()) throw new CustomError("El servidor no tiene base de datos disponible", 503);
}

export async function login(
  email: string,
  password: string,
): Promise<{ token: string; user: SessionUser }> {
  requireDb();
  if (!email || !password) {
    throw new CustomError("Escribe tu correo y tu contraseña", 400);
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() }).select("+password");

  // Mismo mensaje exista o no la cuenta: el login no sirve para descubrir correos.
  const invalido = new CustomError("Correo o contraseña incorrectos", 401);
  if (!user || !user.isActive) throw invalido;
  if (!(await bcrypt.compare(password, user.password))) throw invalido;

  user.lastLoginAt = new Date();
  await user.save();

  return { token: signToken(user), user: sanitize(user) };
}

export async function findById(id: string): Promise<SessionUser> {
  requireDb();
  const user = await User.findById(id);
  if (!user) throw new CustomError("Usuario no encontrado", 404);
  return sanitize(user);
}

export async function changePassword(
  id: string,
  current: string,
  next: string,
): Promise<SessionUser> {
  requireDb();
  if (next.length < 8) {
    throw new CustomError("La nueva contraseña debe tener al menos 8 caracteres", 400);
  }

  const user = await User.findById(id).select("+password");
  if (!user) throw new CustomError("Usuario no encontrado", 404);
  if (!(await bcrypt.compare(current, user.password))) {
    throw new CustomError("La contraseña actual no es correcta", 401);
  }

  user.password = next;
  await user.save();
  return sanitize(user);
}

/** Alta pública de alumnos. Siempre crea cuentas customer: el rol no viene del body. */
export async function register(input: {
  name: string;
  email: string;
  password: string;
  phone?: string;
}): Promise<{ token: string; user: SessionUser }> {
  requireDb();
  const name = input.name.trim();
  const email = input.email.toLowerCase().trim();
  if (!name) throw new CustomError("Escribe tu nombre", 400);
  if (!EMAIL.test(email)) throw new CustomError("Correo inválido", 400);
  if (input.password.length < 8) {
    throw new CustomError("La contraseña debe tener al menos 8 caracteres", 400);
  }

  if (await User.exists({ email })) {
    throw new CustomError("Ya existe una cuenta con ese correo. Inicia sesión.", 409);
  }

  const user = await User.create({
    email,
    password: input.password,
    name,
    phone: (input.phone || "").trim(),
    accountType: "customer",
    lastLoginAt: new Date(),
  });

  await commerceEmail.sendWelcomeEmail({ email: user.email, name: user.name });
  return { token: signToken(user), user: sanitize(user) };
}

/** Datos de la cuenta. Solo pisa los campos que llegan. */
export async function updateProfile(
  id: string,
  input: { name?: unknown; phone?: unknown; documentId?: unknown },
): Promise<SessionUser> {
  requireDb();
  const user = await User.findById(id);
  if (!user) throw new CustomError("Usuario no encontrado", 404);

  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new CustomError("Escribe tu nombre", 400);
    user.name = name;
  }
  if (input.phone !== undefined) user.phone = String(input.phone).trim();
  if (input.documentId !== undefined) user.documentId = String(input.documentId).trim();

  await user.save();
  return sanitize(user);
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Genera un token para definir o restablecer la contraseña y devuelve el valor
 * en claro, que solo viaja en el correo. En la base queda el hash: quien lea
 * la colección no puede usarlo.
 */
export async function issuePasswordToken(userId: string, ttlMs = RESET_TTL_MS): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await User.updateOne(
    { _id: userId },
    { resetPasswordToken: hashToken(token), resetPasswordExpires: new Date(Date.now() + ttlMs) },
  );
  return token;
}

/** No revela si el correo existe: el controller responde ok en cualquier caso. */
export async function forgotPassword(email: string): Promise<void> {
  requireDb();
  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user || !user.isActive) return;

  const token = await issuePasswordToken(user._id.toString());
  await commerceEmail.sendResetPasswordEmail({ to: user.email, name: user.name, token });
}

export async function resetPassword(
  token: string,
  password: string,
): Promise<{ token: string; user: SessionUser }> {
  requireDb();
  if (!token) throw new CustomError("El enlace no es válido", 400);
  if (password.length < 8) {
    throw new CustomError("La contraseña debe tener al menos 8 caracteres", 400);
  }

  const user = await User.findOne({
    resetPasswordToken: hashToken(token),
    resetPasswordExpires: { $gt: new Date() },
  }).select("+password");
  if (!user || !user.isActive) {
    throw new CustomError("El enlace ya no es válido o venció. Pide uno nuevo.", 400);
  }

  user.password = password;
  user.resetPasswordToken = null;
  user.resetPasswordExpires = null;
  user.lastLoginAt = new Date();
  await user.save();

  return { token: signToken(user), user: sanitize(user) };
}

export async function createUser(input: {
  email: string;
  password: string;
  name?: string;
  phone?: string;
  accountType?: IUser["accountType"];
}): Promise<SessionUser> {
  requireDb();
  const email = input.email.toLowerCase().trim();
  if (!EMAIL.test(email)) throw new CustomError("Correo inválido", 400);
  if (input.password.length < 8) {
    throw new CustomError("La contraseña debe tener al menos 8 caracteres", 400);
  }

  const user = await User.create({
    email,
    password: input.password,
    name: input.name || "",
    phone: input.phone || "",
    accountType: input.accountType || "customer",
  });
  return sanitize(user);
}

/**
 * Crea la cuenta de administración si todavía no existe.
 *
 * Las credenciales salen del entorno para no dejarlas escritas en el repo.
 * Si la cuenta ya está, no se toca: cambiar la contraseña desde acá borraría
 * una que se hubiera cambiado a mano.
 */
export async function seedAdmin(): Promise<void> {
  if (!isConnected()) return;

  if (!env.ADMIN_PASSWORD) {
    console.warn("[auth] ADMIN_PASSWORD no definida — no se crea la cuenta de administración");
    return;
  }

  try {
    const existing = await User.findOne({ email: env.ADMIN_EMAIL });
    if (existing) return;

    await User.create({
      email: env.ADMIN_EMAIL,
      password: env.ADMIN_PASSWORD,
      name: env.ADMIN_NAME,
      accountType: "admin",
    });
    console.log(`[auth] cuenta de administración creada: ${env.ADMIN_EMAIL}`);
  } catch (error) {
    console.error("[auth] no se pudo crear la cuenta de administración:", error);
  }
}
