import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, customerRequests } from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  optionalString,
  readJsonObject,
  requiredString,
} from "@/lib/server/http";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "staff"]);
    const { id } = await context.params;
    const body = await readJsonObject(request);
    const status = requiredString(body, "status", 20);
    if (status !== "approved" && status !== "rejected") {
      throw new HttpError(
        400,
        "invalid_request_status",
        "Escolha aprovar ou não aprovar o pedido.",
      );
    }
    const responseNote = optionalString(body, "responseNote", 1_000);
    const db = getDb();
    const [current] = await db
      .select()
      .from(customerRequests)
      .where(
        and(
          eq(customerRequests.id, id),
          eq(
            customerRequests.establishmentId,
            identity.establishmentId!,
          ),
        ),
      )
      .limit(1);
    if (!current) {
      throw new HttpError(
        404,
        "customer_request_not_found",
        "O pedido não foi encontrado.",
      );
    }
    if (current.status !== "pending") {
      throw new HttpError(
        409,
        "customer_request_already_reviewed",
        "Este pedido já foi analisado.",
      );
    }
    const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
    await db.batch([
      db
        .update(customerRequests)
        .set({
          status,
          reviewedByUserId: identity.userId,
          reviewedAt: now,
          responseNote,
          updatedAt: now,
        })
        .where(eq(customerRequests.id, id)),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId: identity.establishmentId!,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: `customer_request.${status}`,
        entityType: "customer_request",
        entityId: id,
        requestId,
        metadataJson: JSON.stringify({
          accountId: current.accountId,
          type: current.type,
        }),
      }),
    ]);
    return json({ request: { id, status, responseNote } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
