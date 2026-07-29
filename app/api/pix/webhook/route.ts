import { errorResponse, HttpError } from "@/lib/server/http";
import { runtimeValue } from "@/lib/server/runtime";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const provider = runtimeValue("PIX_PROVIDER");
    const webhookSecret = runtimeValue("PIX_WEBHOOK_SECRET");
    if (!provider || !webhookSecret) {
      throw new HttpError(
        503,
        "pix_webhook_not_configured",
        "O recebimento automático de Pix ainda não foi configurado.",
      );
    }

    // Cada provedor possui um mecanismo próprio (assinatura ou mTLS).
    // O corpo não é lido até o adaptador oficial validar a autenticidade.
    void request;
    throw new HttpError(
      501,
      "pix_webhook_adapter_required",
      "Configure a verificação oficial do provedor antes de receber eventos.",
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
