import { env } from "../config/env";
import { sendEmail, layout } from "./email.service";

/**
 * Correos del flujo comercial: registro, compra, accesos y contraseñas.
 * Todos devuelven lo que devuelve sendEmail: nunca lanzan.
 */

const DATE_FORMAT = new Intl.DateTimeFormat("es-EC", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "America/Guayaquil",
});

/** "30 de noviembre de 2026", siempre en hora de Ecuador. */
export function formatDate(date: Date): string {
  return DATE_FORMAT.format(date);
}

/** Frase única sobre el vencimiento: la usan el correo de compra y el de acceso otorgado. */
export function accessUntilText(expiresAt: Date | null): string {
  return expiresAt
    ? `Tu acceso está activo hasta el ${formatDate(expiresAt)}.`
    : "Tu acceso no tiene fecha de vencimiento.";
}

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Nombres y títulos vienen de formularios: se escapan antes de entrar al HTML.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function greeting(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first ? `Hola, ${escapeHtml(first)}` : "Hola";
}

function paragraph(html: string): string {
  return `<p style="margin:0 0 16px">${html}</p>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:bold">${label}</a></p>`;
}

function fallbackLink(href: string): string {
  return `<p style="margin:0 0 16px;color:#71717a;font-size:13px">Si el botón no funciona, copia este enlace en tu navegador:<br>${href}</p>`;
}

export function resetPasswordUrl(token: string): string {
  return `${env.FRONTEND_URL}/restablecer?token=${token}`;
}

const MY_COURSES_URL = `${env.FRONTEND_URL}/mis-cursos`;

/** Bienvenida al crear la cuenta. */
export function sendWelcomeEmail(user: { email: string; name: string }): Promise<boolean> {
  const body = [
    paragraph(`${greeting(user.name)}, qué gusto tenerte por aquí.`),
    paragraph(
      "Tu cuenta ya está lista. Desde ella vas a entrar a tus cursos, descargar tus plantillas y retomar cada clase donde la dejaste.",
    ),
    button(MY_COURSES_URL, "Ir a mis cursos"),
    paragraph("Un abrazo,<br>Kath"),
  ].join("");
  return sendEmail(user.email, "Tu cuenta está lista", layout("Bienvenida", body));
}

/** Compra confirmada. El texto cambia según lo que se compró. */
export function sendPurchaseEmail(input: {
  to: string;
  name: string;
  product: { title: string; type: string };
  totalCents: number;
  expiresAt: Date | null;
}): Promise<boolean> {
  const title = escapeHtml(input.product.title);
  const parts = [
    paragraph(`${greeting(input.name)}, tu compra quedó confirmada.`),
    paragraph(`<strong>${title}</strong><br>Total pagado: ${formatMoney(input.totalCents)}`),
  ];

  if (input.product.type === "service") {
    parts.push(
      paragraph(
        "Ya tienes tu lugar reservado. En los próximos días te voy a escribir para coordinar contigo las fechas de nuestras sesiones.",
      ),
      paragraph("Mientras tanto, puedes ver el detalle de tu compra en tu cuenta."),
    );
  } else if (input.product.type === "download") {
    parts.push(
      paragraph(
        "En “Mis cursos” vas a encontrar tu plantilla lista para descargar y el video tutorial donde te explico paso a paso cómo usarla.",
      ),
      paragraph(accessUntilText(input.expiresAt)),
    );
  } else {
    parts.push(
      paragraph("Ya puedes entrar y empezar cuando quieras, a tu ritmo."),
      paragraph(accessUntilText(input.expiresAt)),
    );
  }

  parts.push(
    button(MY_COURSES_URL, "Ir a mis cursos"),
    paragraph("Gracias por confiar en mí,<br>Kath"),
  );
  return sendEmail(
    input.to,
    `Compra confirmada: ${input.product.title}`,
    layout("¡Gracias por tu compra!", parts.join("")),
  );
}

/** Acceso otorgado a mano desde el admin. Dice qué recibió y hasta cuándo. */
export function sendAccessGrantedEmail(input: {
  to: string;
  name: string;
  productTitles: string[];
  expiresAt: Date | null;
}): Promise<boolean> {
  const items = input.productTitles
    .map((title) => `<li style="margin:0 0 6px"><strong>${escapeHtml(title)}</strong></li>`)
    .join("");
  const body = [
    paragraph(`${greeting(input.name)}, ya tienes acceso a:`),
    `<ul style="margin:0 0 16px;padding-left:20px">${items}</ul>`,
    paragraph(accessUntilText(input.expiresAt)),
    button(MY_COURSES_URL, "Ir a mis cursos"),
    paragraph("Un abrazo,<br>Kath"),
  ].join("");
  return sendEmail(input.to, "Ya tienes acceso", layout("Tu acceso está activo", body));
}

/** Cuenta creada por el admin: la persona todavía no tiene contraseña propia. */
export function sendSetPasswordEmail(input: {
  to: string;
  name: string;
  token: string;
}): Promise<boolean> {
  const url = resetPasswordUrl(input.token);
  const body = [
    paragraph(`${greeting(input.name)}, te creamos una cuenta en la plataforma de Kath Veliz.`),
    paragraph(
      `Para entrar solo te falta definir tu contraseña. Tu usuario es este mismo correo: <strong>${escapeHtml(input.to)}</strong>.`,
    ),
    button(url, "Definir mi contraseña"),
    paragraph("El enlace funciona durante 7 días."),
    fallbackLink(url),
  ].join("");
  return sendEmail(input.to, "Define tu contraseña", layout("Define tu contraseña", body));
}

/** Olvidé mi contraseña. */
export function sendResetPasswordEmail(input: {
  to: string;
  name: string;
  token: string;
}): Promise<boolean> {
  const url = resetPasswordUrl(input.token);
  const body = [
    paragraph(`${greeting(input.name)}, recibimos tu pedido para cambiar la contraseña.`),
    button(url, "Crear una contraseña nueva"),
    paragraph(
      "El enlace funciona durante 1 hora. Si no fuiste tú, ignora este correo: tu contraseña sigue igual.",
    ),
    fallbackLink(url),
  ].join("");
  return sendEmail(input.to, "Restablece tu contraseña", layout("Restablece tu contraseña", body));
}
