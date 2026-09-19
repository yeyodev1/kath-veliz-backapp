import { env } from "../config/env";
import { sendEmail, layout } from "./email.service";

/**
 * Correos de captación: recursos gratis, lista de espera, asesoría y avisos de
 * clases en vivo. Los de compra y acceso viven en otro servicio.
 */

/** Todo lo que escribe una persona pasa por aquí antes de entrar al HTML. */
export function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstName(name: string): string {
  return escapeHtml((name || "").trim().split(/\s+/)[0] || "");
}

function greeting(name: string): string {
  const first = firstName(name);
  return `<p style="margin:0 0 16px">${first ? `Hola, ${first}:` : "Hola:"}</p>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 16px">${text}</p>`;
}

function button(label: string, url: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:bold">${escapeHtml(label)}</a></p>`;
}

function fallbackLink(url: string): string {
  return `<p style="margin:0 0 16px;color:#71717a;font-size:13px">Si el botón no abre, copia este enlace en tu navegador:<br>${escapeHtml(url)}</p>`;
}

function signature(): string {
  return `<p style="margin:24px 0 0">Un abrazo,<br><strong>Kath</strong></p>`;
}

function multiline(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br>");
}

/** Las clases son para Ecuador: la hora siempre se muestra en la de Guayaquil. */
function formatDate(date: Date): string {
  const text = new Intl.DateTimeFormat("es-EC", {
    timeZone: "America/Guayaquil",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${text} (hora de Ecuador)`;
}

function productUrl(slug: string): string {
  return `${env.FRONTEND_URL.replace(/\/+$/, "")}/p/${slug}`;
}

export function sendFreeResourceEmail(
  lead: { name: string; email: string },
  product: { title: string; freeResourceUrl: string },
): Promise<boolean> {
  const title = escapeHtml(product.title);
  const body = [
    greeting(lead.name),
    paragraph(`Aquí tienes <strong>${title}</strong>, tal como te lo prometí.`),
    button("Abrir mi recurso", product.freeResourceUrl),
    fallbackLink(product.freeResourceUrl),
    paragraph(
      "Guárdalo y dedícale un rato tranquilo esta semana. Ordenar tu dinero empieza con pasos pequeños, y este es uno de ellos.",
    ),
    signature(),
  ].join("");
  return sendEmail(lead.email, `Tu recurso gratuito: ${product.title}`, layout("Ya es tuyo", body));
}

export function sendWaitlistEmail(
  lead: { name: string; email: string },
  product: { title: string; slug: string },
  couponCode: string,
): Promise<boolean> {
  const title = escapeHtml(product.title);
  const body = [
    greeting(lead.name),
    paragraph(`Ya estás en la lista de espera de <strong>${title}</strong>.`),
    paragraph(
      "Vas a ser de las primeras personas en enterarte cuando abra la inscripción. Y por haberte anotado antes, tienes un 10% de descuento con este código:",
    ),
    `<p style="margin:0 0 16px;padding:16px;background:#f4f4f5;border-radius:12px;text-align:center;font-size:20px;font-weight:bold;letter-spacing:1px">${escapeHtml(couponCode)}</p>`,
    paragraph("Guárdalo: lo escribes al momento de pagar y el descuento se aplica solo."),
    button("Ver el curso", productUrl(product.slug)),
    signature(),
  ].join("");
  return sendEmail(
    lead.email,
    `Estás en la lista de espera de ${product.title}`,
    layout("Tu lugar está guardado", body),
  );
}

export function sendNewsletterWelcomeEmail(lead: {
  name: string;
  email: string;
}): Promise<boolean> {
  const body = [
    greeting(lead.name),
    paragraph(
      "Gracias por sumarte. Por aquí te voy a escribir con ideas simples para ordenar tu dinero, novedades de los cursos y recursos que sí se pueden aplicar.",
    ),
    paragraph("Nada de spam: si un día ya no te sirve, me lo dices y listo."),
    button("Ver los recursos gratuitos", `${env.FRONTEND_URL.replace(/\/+$/, "")}/recursos`),
    signature(),
  ].join("");
  return sendEmail(
    lead.email,
    "Te doy la bienvenida a la comunidad",
    layout("Qué bueno tenerte aquí", body),
  );
}

export function sendServiceRequestReceivedEmail(
  request: { name: string; email: string },
  product: { title: string },
  infoPdfUrl: string,
): Promise<boolean> {
  const title = escapeHtml(product.title);
  const body = [
    greeting(request.name),
    paragraph(
      `Recibí tu solicitud para <strong>${title}</strong>. Gracias por contarme tu situación.`,
    ),
    infoPdfUrl
      ? paragraph(
          "Mientras la reviso, te dejo el PDF con toda la información: cómo funciona, qué incluye y cuál es la inversión.",
        ) +
        button("Ver el PDF informativo", infoPdfUrl) +
        fallbackLink(infoPdfUrl)
      : "",
    paragraph(
      "Leo cada solicitud personalmente, porque solo tomo los casos en los que de verdad puedo ayudar. En los próximos días te escribo a este correo con la respuesta.",
    ),
    signature(),
  ].join("");
  return sendEmail(
    request.email,
    `Recibí tu solicitud de ${product.title}`,
    layout("Tu solicitud llegó", body),
  );
}

export function sendServiceRequestAdminEmail(
  request: {
    name: string;
    email: string;
    phone: string;
    answers: { question: string; answer: string }[];
  },
  product: { title: string },
): Promise<boolean> {
  const answers = request.answers
    .map(
      (item) =>
        `<p style="margin:0 0 12px"><strong>${escapeHtml(item.question)}</strong><br>${multiline(item.answer) || "—"}</p>`,
    )
    .join("");
  const body = [
    paragraph(`Llegó una solicitud nueva para <strong>${escapeHtml(product.title)}</strong>.`),
    paragraph(
      `<strong>Nombre:</strong> ${escapeHtml(request.name)}<br><strong>Correo:</strong> ${escapeHtml(request.email)}<br><strong>Teléfono:</strong> ${escapeHtml(request.phone) || "—"}`,
    ),
    answers,
    button("Revisar en el panel", `${env.FRONTEND_URL.replace(/\/+$/, "")}/admin`),
  ].join("");
  return sendEmail(
    env.ADMIN_EMAIL,
    `Nueva solicitud de asesoría: ${request.name}`,
    layout("Nueva solicitud de asesoría", body),
  );
}

export function sendServiceRequestApprovedEmail(
  request: { name: string; email: string },
  product: { title: string },
  paymentUrl: string,
  // Mensaje pensado para la persona. La nota interna del panel no va aquí.
  personalNote = "",
): Promise<boolean> {
  const body = [
    greeting(request.name),
    paragraph(
      `Revisé tu solicitud y sí: puedo acompañarte con <strong>${escapeHtml(product.title)}</strong>. Me alegra mucho.`,
    ),
    personalNote ? paragraph(multiline(personalNote)) : "",
    paragraph(
      "Para reservar tu lugar, completa el pago en este enlace. Necesitas iniciar sesión (o crear tu cuenta) con este mismo correo.",
    ),
    button("Pagar mi asesoría", paymentUrl),
    fallbackLink(paymentUrl),
    paragraph(
      "Apenas se confirme el pago te escribo para coordinar las sesiones. Todo es 100% remoto.",
    ),
    signature(),
  ].join("");
  return sendEmail(
    request.email,
    "Tu asesoría fue aprobada",
    layout("Tu solicitud fue aprobada", body),
  );
}

export function sendServiceRequestRejectedEmail(
  request: { name: string; email: string },
  product: { title: string },
  // Mensaje pensado para la persona. La nota interna del panel no va aquí.
  personalNote = "",
): Promise<boolean> {
  const body = [
    greeting(request.name),
    paragraph(
      `Gracias por tu interés en <strong>${escapeHtml(product.title)}</strong> y por la confianza de contarme tu situación.`,
    ),
    paragraph(
      "Después de revisarla, siento que en este momento la asesoría no es el formato con el que mejor te puedo ayudar, y prefiero decírtelo con honestidad antes que cobrarte por algo que no te va a servir.",
    ),
    personalNote ? paragraph(multiline(personalNote)) : "",
    paragraph(
      "Lo que sí te puede servir hoy son los cursos y los recursos gratuitos: están pensados para avanzar a tu ritmo.",
    ),
    button("Ver cursos y recursos", `${env.FRONTEND_URL.replace(/\/+$/, "")}/cursos`),
    signature(),
  ].join("");
  return sendEmail(
    request.email,
    `Sobre tu solicitud de ${product.title}`,
    layout("Sobre tu solicitud", body),
  );
}

export function sendLiveSessionEmail(
  student: { name: string; email: string },
  product: { title: string; slug: string },
  session: { title: string; description: string; startsAt: Date; meetUrl: string },
): Promise<boolean> {
  const classroomUrl = `${env.FRONTEND_URL.replace(/\/+$/, "")}/aprender/${product.slug}`;
  const body = [
    greeting(student.name),
    paragraph(
      `Tenemos clase en vivo de <strong>${escapeHtml(product.title)}</strong>: <strong>${escapeHtml(session.title)}</strong>.`,
    ),
    paragraph(`<strong>Cuándo:</strong> ${escapeHtml(formatDate(session.startsAt))}`),
    session.description ? paragraph(multiline(session.description)) : "",
    session.meetUrl
      ? button("Entrar a la clase por Google Meet", session.meetUrl) + fallbackLink(session.meetUrl)
      : paragraph("El enlace de Google Meet lo vas a encontrar dentro del curso."),
    paragraph(
      `Si no puedes conectarte, no pasa nada: la grabación queda después <a href="${escapeHtml(classroomUrl)}" style="color:#111">dentro del curso</a>.`,
    ),
    signature(),
  ].join("");
  return sendEmail(
    student.email,
    `Clase en vivo: ${session.title}`,
    layout("Nos vemos en la clase en vivo", body),
  );
}
