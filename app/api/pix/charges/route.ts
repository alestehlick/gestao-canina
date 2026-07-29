import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  readJsonObject,
  requiredString,
} from "@/lib/server/http";
import { runtimeValue } from "@/lib/server/runtime";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    await requireIdentity(request, ["owner", "finance"]);
    const body = await readJsonObject(request);
    requiredString(body, "invoiceId", 80);

    if (!runtimeValue("PIX_PROVIDER")) {
      throw new HttpError(
        503,
        "pix_provider_not_configured",
        "O provedor Pix ainda não foi conectado. Nenhuma cobrança foi criada.",
      );
    }

    throw new HttpError(
      501,
      "pix_adapter_required",
      "Configure o adaptador oficial do provedor Pix escolhido.",
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
