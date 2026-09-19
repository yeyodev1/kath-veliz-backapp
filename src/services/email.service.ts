import { Resend } from "resend";
import { env } from "../config/env";

let resend: Resend | null = null;

function getClient(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(env.RESEND_API_KEY);
  return resend;
}

/**
 * Envía un correo. Nunca lanza: el fallo de un correo no debe romper el
 * flujo que lo disparó (una compra, un registro). Devuelve si Resend lo aceptó.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const client = getClient();
  if (!client) {
    console.warn(`[email] RESEND_API_KEY no definida — no se envió "${subject}" a ${to}`);
    return false;
  }

  try {
    const { error } = await client.emails.send({ from: env.RESEND_FROM_EMAIL, to, subject, html });
    if (error) {
      console.error("[email] Resend rechazó el envío:", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[email] send failed:", error);
    return false;
  }
}

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

// Tope de la API batch de Resend por llamada.
const BATCH_SIZE = 100;
// Resend acepta 2 llamadas por segundo: entre lotes se respira un poco.
const BATCH_PAUSE_MS = 600;

/**
 * Envío masivo con la API batch de Resend: hasta 100 correos por llamada.
 *
 * Mandarlos de uno en uno obliga a esperar entre envíos por el límite de Resend,
 * y con 100+ alumnas la función de Vercel (60 s) muere a medio camino. Con batch,
 * 500 correos son 5 llamadas. Nunca lanza; devuelve cuántos aceptó Resend.
 */
export async function sendEmailBatch(
  messages: EmailMessage[],
): Promise<{ sent: number; failed: number }> {
  if (messages.length === 0) return { sent: 0, failed: 0 };

  const client = getClient();
  if (!client) {
    console.warn(`[email] RESEND_API_KEY no definida — no se enviaron ${messages.length} correos`);
    return { sent: 0, failed: messages.length };
  }

  let sent = 0;
  let failed = 0;
  for (let index = 0; index < messages.length; index += BATCH_SIZE) {
    const chunk = messages.slice(index, index + BATCH_SIZE);
    try {
      // "permissive": un correo mal escrito no tumba a los otros 99 del lote.
      const { data, error } = await client.batch.send(
        chunk.map((message) => ({ from: env.RESEND_FROM_EMAIL, ...message })),
        { batchValidation: "permissive" },
      );
      if (error) {
        console.error("[email] Resend rechazó el lote:", error);
        failed += chunk.length;
      } else {
        const rejected = data?.errors ?? [];
        if (rejected.length) console.error("[email] correos rechazados en el lote:", rejected);
        const accepted = Math.min(data?.data?.length ?? chunk.length, chunk.length);
        sent += accepted;
        failed += chunk.length - accepted;
      }
    } catch (error) {
      console.error("[email] batch failed:", error);
      failed += chunk.length;
    }
    if (index + BATCH_SIZE < messages.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
    }
  }
  return { sent, failed };
}

/** Plantilla base: tarjeta blanca centrada con encabezado de marca. */
export function layout(title: string, body: string): string {
  return `
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;font-family:Arial,Helvetica,sans-serif">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden">
        <tr><td style="background:#111;color:#fff;padding:20px 32px;font-size:18px;font-weight:bold">Kath Veliz</td></tr>
        <tr><td style="padding:32px;color:#111;font-size:15px;line-height:1.6">
          <h1 style="margin:0 0 16px;font-size:22px">${title}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:16px 32px;color:#71717a;font-size:12px">© ${new Date().getFullYear()} Kath Veliz</td></tr>
      </table>
    </td></tr>
  </table>`;
}
