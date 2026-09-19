import axios from "axios";
import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";

const CONFIRM_URL = "https://paymentbox.payphonetodoesposible.com/api/confirm";

export const PAYPHONE_APPROVED = 3;
export const PAYPHONE_CANCELED = 2;

/** Lo que usamos de la respuesta de Payphone. El resto se guarda tal cual en la orden. */
export interface PayphoneConfirmation {
  statusCode?: number;
  transactionStatus?: string;
  transactionId?: number;
  clientTransactionId?: string;
  amount?: number;
  message?: string;
  errorCode?: number;
  [key: string]: unknown;
}

export function isPayphoneConfigured(): boolean {
  return Boolean(env.PAYPHONE_TOKEN && env.PAYPHONE_STORE_ID);
}

/**
 * Confirma la transacción contra Payphone. Si nadie confirma en los primeros
 * 5 minutos, Payphone reversa el cobro: por eso el front llama apenas carga
 * la página de respuesta.
 *
 * Un rechazo de Payphone ({ message, errorCode }) se devuelve como dato para
 * guardarlo en la orden. Solo lanza cuando Payphone no respondió.
 */
export async function confirmPayment(
  id: number | string,
  clientTransactionId: string,
): Promise<PayphoneConfirmation> {
  if (!env.PAYPHONE_TOKEN) {
    throw new CustomError("Los pagos todavía no están configurados", 503);
  }

  try {
    const { data } = await axios.post<PayphoneConfirmation>(
      CONFIRM_URL,
      { id: Number(id), clientTxId: clientTransactionId },
      { headers: { Authorization: `Bearer ${env.PAYPHONE_TOKEN}` }, timeout: 20000 },
    );
    return data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data && error.response.status < 500) {
      const data = error.response.data;
      return typeof data === "object" ? (data as PayphoneConfirmation) : { message: String(data) };
    }
    console.error("[payphone] la confirmación no respondió:", error);
    throw new CustomError("No pudimos confirmar el pago con Payphone. Intenta de nuevo.", 502);
  }
}

// Payphone espera el celular con código de país.
function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("593")) return `+${digits}`;
  if (digits.startsWith("0")) return `+593${digits.slice(1)}`;
  return digits;
}

/**
 * Configuración de la Cajita de Pagos. El token termina en el navegador por
 * diseño de Payphone; se entrega desde acá para que rotarlo no exija redeploy
 * del front. Correo, celular y cédula son siempre los del comprador.
 */
export function buildBoxConfig(
  order: { clientTransactionId: string; totalCents: number; items: { title: string }[] },
  user: { email: string; phone: string; documentId: string },
) {
  if (!isPayphoneConfigured()) {
    throw new CustomError("Los pagos todavía no están configurados", 503);
  }

  const reference = `Kath Veliz - ${order.items.map((item) => item.title).join(", ")}`;
  return {
    token: env.PAYPHONE_TOKEN,
    storeId: env.PAYPHONE_STORE_ID,
    clientTransactionId: order.clientTransactionId,
    amount: order.totalCents,
    // No se desglosa IVA: todo el monto va sin impuesto para que la suma cuadre.
    amountWithoutTax: order.totalCents,
    currency: "USD" as const,
    reference: reference.slice(0, 100),
    email: user.email,
    phoneNumber: normalizePhone(user.phone),
    documentId: user.documentId,
  };
}
