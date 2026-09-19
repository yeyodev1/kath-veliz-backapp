import axios from "axios";
import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";
import { Lead, LEAD_KINDS, LeadKind } from "../models/lead.model";
import { cleanEmail, cleanString, parsePage, requiredString } from "../utils/input";
import * as couponService from "./coupon.service";
import * as leadEmail from "./leadEmail.service";
import * as productService from "./product.service";

const PAGE_SIZE = 25;
const EXPORT_LIMIT = 20000;

function toLead(lead: any) {
  const product = lead.product;
  const populated = product && typeof product === "object" && "title" in product;
  return {
    id: lead._id.toString(),
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    source: lead.source,
    kind: lead.kind,
    couponCode: lead.couponCode,
    product: product ? (populated ? product._id.toString() : product.toString()) : null,
    productTitle: populated ? product.title : "",
    createdAt: lead.createdAt,
  };
}

/**
 * Aviso al CRM (GoHighLevel). Todavía no hay credenciales.
 * TODO: cuando exista, agregar GHL_WEBHOOK_URL a src/config/env.ts; esta función
 * ya la toma de ahí y empieza a enviar sin más cambios.
 */
export async function notifyCrm(lead: {
  name: string;
  email: string;
  phone: string;
  source: string;
  kind: string;
  couponCode: string;
}): Promise<void> {
  const url = String((env as Record<string, unknown>).GHL_WEBHOOK_URL ?? "");
  if (!url) return;

  try {
    await axios.post(
      url,
      {
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        source: lead.source,
        kind: lead.kind,
        couponCode: lead.couponCode,
      },
      { timeout: 8000 },
    );
  } catch (error: any) {
    // El CRM es secundario: si no responde, el lead ya quedó guardado.
    console.error("[lead] no se pudo avisar al CRM:", error?.message);
  }
}

export async function createLead(body: any): Promise<{ ok: true; message: string }> {
  const kind = cleanString(body?.kind, 30) as LeadKind;
  if (!LEAD_KINDS.includes(kind)) {
    throw new CustomError("El tipo debe ser free-resource, waitlist o newsletter", 400);
  }
  const email = cleanEmail(body?.email);
  const name =
    kind === "newsletter"
      ? cleanString(body?.name, 120)
      : requiredString(body?.name, "Escribe tu nombre", 120);
  const phone = cleanString(body?.phone, 30);
  const productSlug = cleanString(body?.productSlug, 200);
  const source = cleanString(body?.source, 200).toLowerCase() || productSlug || "footer";

  let product: Awaited<ReturnType<typeof productService.findPublishedBySlug>> | null = null;
  if (kind !== "newsletter" || productSlug) {
    product = await productService.findPublishedBySlug(productSlug);
  }

  let couponCode = "";
  if (kind === "free-resource") {
    if (!product || product.type !== "free" || !product.freeResourceUrl) {
      throw new CustomError("Este recurso no está disponible por ahora", 400);
    }
  }
  if (kind === "waitlist") {
    if (!product || product.saleMode !== "waitlist") {
      throw new CustomError("Este producto no tiene lista de espera abierta", 400);
    }
    couponCode = await couponService.ensureWaitlistCoupon(product);
  }

  // Upsert por { email, source }: quien vuelve a dejar su correo actualiza sus datos, no se duplica.
  const update: Record<string, unknown> = { kind, product: product?._id ?? null, couponCode };
  if (name) update.name = name;
  if (phone) update.phone = phone;
  const lead = await Lead.findOneAndUpdate(
    { email, source },
    { $set: update, $setOnInsert: { email, source } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  const contact = { name: lead?.name || name, email };
  let message = "Listo. Ya quedaste en la lista.";
  // El correo se reenvía también a quien ya estaba: casi siempre vuelve porque lo perdió.
  if (kind === "free-resource" && product) {
    await leadEmail.sendFreeResourceEmail(contact, product);
    message = "Listo. Revisa tu correo: ahí te llegó el enlace.";
  } else if (kind === "waitlist" && product) {
    await leadEmail.sendWaitlistEmail(contact, product, couponCode);
    message = "Ya estás en la lista de espera. Te envié tu cupón del 10% al correo.";
  } else {
    await leadEmail.sendNewsletterWelcomeEmail(contact);
    message = "Gracias por sumarte. Te escribo pronto.";
  }

  await notifyCrm({
    name: contact.name,
    email,
    phone: lead?.phone || phone,
    source,
    kind,
    couponCode,
  });

  return { ok: true, message };
}

/* ---------- Panel ---------- */

function buildFilter(query: any): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const source = cleanString(query?.source, 200).toLowerCase();
  const kind = cleanString(query?.kind, 30);
  if (source) filter.source = source;
  if (kind) {
    if (!LEAD_KINDS.includes(kind as LeadKind)) {
      throw new CustomError("El tipo debe ser free-resource, waitlist o newsletter", 400);
    }
    filter.kind = kind;
  }
  return filter;
}

export async function listLeads(query: any) {
  const filter = buildFilter(query);
  const page = parsePage(query?.page);

  const [items, total] = await Promise.all([
    Lead.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .populate("product", "title")
      .lean(),
    Lead.countDocuments(filter),
  ]);

  return {
    items: items.map(toLead),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/**
 * Celda de CSV. Además de las comillas, neutraliza fórmulas: un nombre que
 * empiece con "=" se ejecutaría al abrir el archivo en Excel.
 */
function csvCell(value: unknown): string {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function exportLeadsCsv(query: any): Promise<string> {
  const leads = await Lead.find(buildFilter(query))
    .sort({ createdAt: -1 })
    .limit(EXPORT_LIMIT)
    .populate("product", "title")
    .lean();

  const header = ["Nombre", "Correo", "Teléfono", "Origen", "Tipo", "Producto", "Cupón", "Fecha"];
  const rows = leads.map((lead) => {
    const item = toLead(lead);
    return [
      item.name,
      item.email,
      item.phone,
      item.source,
      item.kind,
      item.productTitle,
      item.couponCode,
      item.createdAt ? new Date(item.createdAt).toISOString() : "",
    ]
      .map(csvCell)
      .join(",");
  });

  // BOM: sin él Excel abre los acentos como símbolos raros.
  return "﻿" + [header.map(csvCell).join(","), ...rows].join("\r\n");
}
