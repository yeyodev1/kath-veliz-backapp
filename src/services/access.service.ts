import crypto from "crypto";
import { Types, isValidObjectId } from "mongoose";
import { CustomError } from "../errors/customError.error";
import { Access, AccessSource, IAccess } from "../models/access.model";
import { Product } from "../models/product.model";
import { User } from "../models/user.model";
import { issuePasswordToken } from "./auth.service";
import * as commerceEmail from "./commerceEmail.service";

const PAGE_SIZE = 20;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SET_PASSWORD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const ACCESS_STATUSES = ["vigente", "vencido", "revocado"] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

type AccessDates = Pick<IAccess, "expiresAt" | "revokedAt">;

/**
 * La única definición de "acceso vigente". El reproductor, "Mis cursos", el
 * checkout y el panel preguntan acá: no repitas la condición en otro lado.
 */
export function isAccessActive(access: AccessDates | null | undefined, now = new Date()): boolean {
  if (!access) return false;
  if (access.revokedAt) return false;
  return !access.expiresAt || new Date(access.expiresAt).getTime() > now.getTime();
}

export function accessStatus(access: AccessDates, now = new Date()): AccessStatus {
  if (access.revokedAt) return "revocado";
  return isAccessActive(access, now) ? "vigente" : "vencido";
}

export async function hasActiveAccess(
  userId: string | Types.ObjectId,
  productId: string | Types.ObjectId,
): Promise<boolean> {
  const access = await Access.findOne({ user: userId, product: productId }).lean();
  return isAccessActive(access);
}

/** La misma regla de isAccessActive, como filtro de Mongo, para listados y conteos. */
export function statusFilter(status: AccessStatus, now = new Date()): Record<string, unknown> {
  if (status === "revocado") return { revokedAt: { $ne: null } };
  if (status === "vencido") return { revokedAt: null, expiresAt: { $ne: null, $lte: now } };
  return { revokedAt: null, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] };
}

/**
 * El vencimiento se decide siempre a propósito: fecha futura o `null` explícito.
 * Un default silencioso termina regalando acceso de por vida, o cortándolo,
 * sin que nadie lo haya decidido.
 */
export function parseExpiresAt(value: unknown): Date | null {
  if (value === undefined) {
    throw new CustomError(
      "Debes indicar si el acceso se revoca en una fecha o si no se revoca",
      400,
    );
  }
  if (value === null) return null;

  if (typeof value !== "string" || !value.trim()) {
    throw new CustomError("La fecha de vencimiento no es válida", 400);
  }
  // Una fecha sin hora vale hasta el final de ese día en Ecuador, no hasta la medianoche UTC.
  const raw = value.trim();
  const date = new Date(DATE_ONLY.test(raw) ? `${raw}T23:59:59-05:00` : raw);
  if (Number.isNaN(date.getTime())) {
    throw new CustomError("La fecha de vencimiento no es válida", 400);
  }
  if (date.getTime() <= Date.now()) {
    throw new CustomError("La fecha de vencimiento debe ser futura", 400);
  }
  return date;
}

/** Otorga o renueva: si ya había un acceso se actualiza y se limpia la revocación. */
export async function grantAccess(input: {
  userId: string | Types.ObjectId;
  productId: string | Types.ObjectId;
  source: AccessSource;
  orderId?: string | Types.ObjectId | null;
  grantedBy?: string | Types.ObjectId | null;
  note?: string;
  expiresAt: Date | null;
}) {
  return Access.findOneAndUpdate(
    { user: input.userId, product: input.productId },
    {
      $set: {
        source: input.source,
        order: input.orderId ?? null,
        grantedBy: input.grantedBy ?? null,
        note: input.note ?? "",
        expiresAt: input.expiresAt,
        revokedAt: null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

function serialize(access: any) {
  const user = access.user && access.user.email ? access.user : null;
  const product = access.product && access.product.slug ? access.product : null;
  const grantedBy = access.grantedBy && access.grantedBy.email ? access.grantedBy : null;
  return {
    id: access._id.toString(),
    user: user
      ? { id: user._id.toString(), email: user.email, name: user.name, phone: user.phone }
      : null,
    product: product
      ? {
          id: product._id.toString(),
          slug: product.slug,
          title: product.title,
          type: product.type,
        }
      : null,
    source: access.source,
    note: access.note,
    order: access.order ? access.order.toString() : null,
    grantedBy: grantedBy
      ? { id: grantedBy._id.toString(), email: grantedBy.email, name: grantedBy.name }
      : null,
    status: accessStatus(access),
    expiresAt: access.expiresAt,
    revokedAt: access.revokedAt,
    createdAt: access.createdAt,
    updatedAt: access.updatedAt,
  };
}

function findPopulated(id: unknown) {
  return Access.findById(id)
    .populate("user", "email name phone")
    .populate("product", "slug title type")
    .populate("grantedBy", "email name")
    .lean();
}

/** Acceso manual desde el panel. Crea la cuenta si el correo todavía no existe. */
export async function grantManual(input: {
  email: unknown;
  name?: unknown;
  productIds: unknown;
  expiresAt: unknown;
  note?: unknown;
  adminId: string;
}) {
  // Primero el vencimiento: es la regla que más se olvida y la que más cuesta si falla.
  const expiresAt = parseExpiresAt(input.expiresAt);

  const email = String(input.email ?? "")
    .toLowerCase()
    .trim();
  if (!EMAIL.test(email)) throw new CustomError("Escribe un correo válido", 400);

  const productIds = Array.isArray(input.productIds)
    ? [...new Set(input.productIds.map((id) => String(id)))]
    : [];
  if (!productIds.length) throw new CustomError("Elige al menos un producto", 400);
  if (!productIds.every((id) => isValidObjectId(id))) {
    throw new CustomError("Alguno de los productos no es válido", 400);
  }
  const products = await Product.find({ _id: { $in: productIds } })
    .select("title")
    .lean();
  if (products.length !== productIds.length) {
    throw new CustomError("Alguno de los productos ya no existe", 404);
  }

  const name = String(input.name ?? "").trim();
  const note = String(input.note ?? "").trim();

  let user = await User.findOne({ email });
  let created = false;
  if (!user) {
    // Contraseña que nadie conoce: la persona define la suya con el enlace del correo.
    user = await User.create({
      email,
      name,
      password: crypto.randomBytes(24).toString("hex"),
      accountType: "customer",
    });
    created = true;
  } else if (!user.isActive) {
    throw new CustomError("Esa cuenta está desactivada", 409);
  }

  const accesses = [];
  for (const product of products) {
    const access = await grantAccess({
      userId: user._id,
      productId: product._id,
      source: "manual",
      grantedBy: input.adminId,
      note,
      expiresAt,
    });
    accesses.push(await findPopulated(access._id));
  }

  if (created) {
    const token = await issuePasswordToken(user._id.toString(), SET_PASSWORD_TTL_MS);
    await commerceEmail.sendSetPasswordEmail({ to: user.email, name: user.name, token });
  }
  await commerceEmail.sendAccessGrantedEmail({
    to: user.email,
    name: user.name,
    productTitles: products.map((product) => product.title),
    expiresAt,
  });

  return {
    created,
    user: { id: user._id.toString(), email: user.email, name: user.name },
    accesses: accesses.filter(Boolean).map(serialize),
  };
}

export async function listAccesses(query: {
  product?: unknown;
  user?: unknown;
  status?: unknown;
  page?: unknown;
}) {
  const filter: Record<string, unknown> = {};

  if (query.status) {
    const status = String(query.status) as AccessStatus;
    if (!ACCESS_STATUSES.includes(status)) throw new CustomError("Estado no válido", 400);
    Object.assign(filter, statusFilter(status));
  }

  if (query.product) {
    if (!isValidObjectId(query.product)) throw new CustomError("Producto no válido", 400);
    filter.product = query.product;
  }

  if (query.user) {
    const value = String(query.user).trim();
    if (isValidObjectId(value)) {
      filter.user = value;
    } else {
      // También sirve para buscar por correo o nombre desde el panel.
      const pattern = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const users = await User.find({ $or: [{ email: pattern }, { name: pattern }] })
        .select("_id")
        .limit(200)
        .lean();
      filter.user = { $in: users.map((user: any) => user._id) };
    }
  }

  const page = Math.max(1, Number(query.page) || 1);
  const [items, total] = await Promise.all([
    Access.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .populate("user", "email name phone")
      .populate("product", "slug title type")
      .populate("grantedBy", "email name")
      .lean(),
    Access.countDocuments(filter),
  ]);

  return {
    items: items.map(serialize),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/** Cambia o quita el vencimiento. No toca la revocación: para eso está volver a otorgar. */
export async function updateExpiry(id: string, rawExpiresAt: unknown) {
  if (!isValidObjectId(id)) throw new CustomError("Acceso no encontrado", 404);
  const expiresAt = parseExpiresAt(rawExpiresAt);

  const access = await Access.findByIdAndUpdate(id, { $set: { expiresAt } });
  if (!access) throw new CustomError("Acceso no encontrado", 404);
  return serialize(await findPopulated(id));
}

/** Revoca ahora. El documento queda: el historial sirve para soporte. */
export async function revokeAccess(id: string) {
  if (!isValidObjectId(id)) throw new CustomError("Acceso no encontrado", 404);

  const access = await Access.findById(id);
  if (!access) throw new CustomError("Acceso no encontrado", 404);
  if (!access.revokedAt) {
    access.revokedAt = new Date();
    await access.save();
  }
  return serialize(await findPopulated(id));
}
