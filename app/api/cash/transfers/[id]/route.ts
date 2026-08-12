import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import { cashTransfers } from "@/db/schema";
import { assertCashDateIsOpen } from "@/lib/server/cash";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
  requiredInteger,
  requiredString,
} from "@/lib/server/http";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const { id } = await context.params;
    const body = await readJsonObject(request);
    const action = requiredString(body, "action", 20);
    if (action !== "exclude" && action !== "restore") {
      throw new HttpError(400, "invalid_transfer_action", "A ação solicitada é inválida.");
    }
    const expectedVersion = requiredInteger(body, "expectedVersion", { min: 1 });
    const establishmentId = identity.establishmentId!;
    const [transfer] = await getDb()
      .select()
      .from(cashTransfers)
      .where(
        and(
          eq(cashTransfers.id, id),
          eq(cashTransfers.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (!transfer) {
      throw new HttpError(404, "cash_transfer_not_found", "A transferência não foi encontrada.");
    }
    const targetStatus = action === "exclude" ? "excluded" : "included";
    if (transfer.status === targetStatus) {
      return json({ transfer: { id, status: targetStatus, version: transfer.version }, idempotent: true });
    }
    await assertCashDateIsOpen(establishmentId, transfer.occurredOn);
    const reason =
      action === "exclude"
        ? requiredString(body, "reason", 240)
        : "Transferência restaurada";
    const now = new Date().toISOString();
    const d1 = getD1Database();
    const results = await d1.batch([
      d1
        .prepare(
          `UPDATE cash_transfers
           SET status = ?, exclusion_reason = ?, excluded_by_user_id = ?, excluded_at = ?,
             updated_at = ?, version = version + 1
           WHERE id = ? AND establishment_id = ? AND version = ? AND status = ?`,
        )
        .bind(
          targetStatus,
          action === "exclude" ? reason : null,
          action === "exclude" ? identity.userId : null,
          action === "exclude" ? now : null,
          now,
          id,
          establishmentId,
          expectedVersion,
          action === "exclude" ? "included" : "excluded",
        ),
      d1
        .prepare(
          `UPDATE cash_entries
           SET status = ?, exclusion_reason = ?, excluded_by_user_id = ?, excluded_at = ?,
             updated_by_user_id = ?, updated_at = ?, version = version + 1
           WHERE transfer_id = ? AND establishment_id = ?
             AND EXISTS (
               SELECT 1 FROM cash_transfers
               WHERE id = ? AND establishment_id = ? AND version = ? AND status = ?
             )`,
        )
        .bind(
          targetStatus,
          action === "exclude" ? reason : null,
          action === "exclude" ? identity.userId : null,
          action === "exclude" ? now : null,
          identity.userId,
          now,
          id,
          establishmentId,
          id,
          establishmentId,
          expectedVersion + 1,
          targetStatus,
        ),
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action, entity_type,
            entity_id, request_id, reason, result, metadata_json, occurred_at
          )
          SELECT ?, ?, ?, ?, ?, 'cash_transfer', ?, ?, ?, 'success', ?, ?
          WHERE EXISTS (SELECT 1 FROM cash_transfers WHERE id = ? AND version = ?)`,
        )
        .bind(
          crypto.randomUUID(),
          establishmentId,
          identity.userId,
          identity.role,
          action === "exclude" ? "cash.transfer_excluded" : "cash.transfer_restored",
          id,
          requestId,
          action === "exclude" ? reason : null,
          JSON.stringify({ amountCents: transfer.amountCents, occurredOn: transfer.occurredOn }),
          now,
          id,
          expectedVersion + 1,
        ),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1 || (results[1].meta.changes ?? 0) !== 2) {
      throw new HttpError(
        409,
        "cash_transfer_conflict",
        "A transferência foi alterada por outra pessoa. Atualize o Caixa e tente novamente.",
      );
    }
    return json({ transfer: { id, status: targetStatus, version: expectedVersion + 1 } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
