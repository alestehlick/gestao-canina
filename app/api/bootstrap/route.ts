import {
  assertSameOrigin,
  errorResponse,
  HttpError,
} from "@/lib/server/http";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    throw new HttpError(
      410,
      "bootstrap_replaced",
      "Use a configuração inicial segura da tela de acesso.",
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
