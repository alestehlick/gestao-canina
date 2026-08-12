import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, invoices } from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  optionalString,
  readJsonObject,
} from "@/lib/server/http";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const { id } = await context.params;
    const body = await readJsonObject(request);
    const internalNote = optionalString(body, "note", 1_000);
    const followUpOn = optionalString(body, "followUpOn", 10);
    if (followUpOn && !/^\d{4}-\d{2}-\d{2}$/.test(followUpOn)) {
      throw new HttpError(400, "invalid_follow_up_date", "Revise a data do lembrete.");
    }
    const establishmentId = identity.establishmentId!;
    const db = getDb();

    const [invoice] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.id, id),
          eq(invoices.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (!invoice) {
      throw new HttpError(404, "invoice_not_found", "A fatura não foi encontrada.");
    }

    await db.batch([
      db
        .update(invoices)
        .set({
          internalNote,
          followUpOn,
          updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        })
        .where(
          and(
            eq(invoices.id, id),
            eq(invoices.establishmentId, establishmentId),
          ),
        ),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "invoice.note_updated",
        entityType: "invoice",
        entityId: id,
        requestId,
        metadataJson: JSON.stringify({
          hasNote: Boolean(internalNote),
          followUpOn,
        }),
      }),
    ]);

    return json({ invoice: { id, internalNote, followUpOn } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
