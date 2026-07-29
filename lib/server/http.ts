export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(
  body: unknown,
  init: ResponseInit & { status?: number } = {},
) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  return Response.json(body, { ...init, headers });
}

export function errorResponse(error: unknown, requestId: string) {
  if (error instanceof HttpError) {
    return json(
      {
        error: {
          code: error.code,
          message: error.message,
          requestId,
        },
      },
      { status: error.status },
    );
  }

  console.error("request_failed", { requestId, error });
  return json(
    {
      error: {
        code: "internal_error",
        message: "Não foi possível concluir a operação.",
        requestId,
      },
    },
    { status: 500 },
  );
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expectedOrigin = new URL(request.url).origin;
  if (origin !== expectedOrigin) {
    throw new HttpError(
      403,
      "invalid_origin",
      "A origem da solicitação não foi aceita.",
    );
  }
}

export async function readJsonObject(
  request: Request,
  maxBytes = 32_768,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(
      415,
      "unsupported_media_type",
      "Envie os dados no formato JSON.",
    );
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) {
    throw new HttpError(413, "payload_too_large", "A solicitação é muito grande.");
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) {
    throw new HttpError(413, "payload_too_large", "A solicitação é muito grande.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "invalid_json", "O conteúdo JSON é inválido.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "invalid_body", "O corpo da solicitação é inválido.");
  }
  return parsed as Record<string, unknown>;
}

export function requiredString(
  body: Record<string, unknown>,
  key: string,
  maxLength = 200,
) {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "invalid_field", `O campo ${key} é obrigatório.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpError(400, "invalid_field", `O campo ${key} é muito longo.`);
  }
  return normalized;
}

export function optionalString(
  body: Record<string, unknown>,
  key: string,
  maxLength = 2_000,
) {
  const value = body[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maxLength) {
    throw new HttpError(400, "invalid_field", `O campo ${key} é inválido.`);
  }
  return value.trim();
}
