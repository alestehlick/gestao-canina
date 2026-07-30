import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  json,
  optionalString,
  readJsonObject,
} from "@/lib/server/http";
import { createLodgingInvoice } from "@/lib/server/lodging-invoice";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const body = await readJsonObject(request);
    const { id } = await context.params;
    const result = await createLodgingInvoice({
      appointmentId: id,
      kind: "balance",
      identity,
      requestId,
      dueDate: optionalString(body, "dueDate", 10),
    });
    return json(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
