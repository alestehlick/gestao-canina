import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import { invoices } from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
  requiredString,
} from "@/lib/server/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const { id } = await context.params;
    const reason = requiredString(await readJsonObject(request), "reason", 500);
    const establishmentId = identity.establishmentId!;
    const [invoice] = await getDb()
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, id),
          eq(invoices.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (!invoice) {
      throw new HttpError(
        404,
        "invoice_not_found",
        "A fatura não foi encontrada.",
      );
    }
    if (invoice.status === "paid") {
      throw new HttpError(
        409,
        "paid_invoice_cannot_be_voided",
        "Uma fatura paga não pode ser cancelada. Faça uma correção registrada fora desta fatura.",
      );
    }
    if (invoice.status === "void") {
      return json({ invoice, idempotent: true });
    }

    const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
    const d1 = getD1Database();
    const results = await d1.batch([
      d1
        .prepare(
          `UPDATE invoices
          SET status = 'void', voided_at = ${nowExpression}, void_reason = ?,
            source_id = CASE
              WHEN source_type IN ('lodging_deposit', 'lodging_balance')
                AND source_id IS NOT NULL
              THEN source_id || ':void:' || id
              ELSE source_id
            END,
            updated_at = ${nowExpression}
          WHERE id = ? AND establishment_id = ?
            AND status IN ('draft', 'issued')`,
        )
        .bind(reason, id, establishmentId),
      d1
        .prepare(
          `UPDATE appointment_items
          SET active_invoice_id = NULL, updated_at = ${nowExpression}
          WHERE active_invoice_id = ?
            AND EXISTS (
              SELECT 1 FROM invoices
              WHERE id = ? AND status = 'void'
            )`,
        )
        .bind(id, id),
      d1
        .prepare(
          `UPDATE credit_purchases
          SET status = 'cancelled', cancelled_at = ${nowExpression},
            updated_at = ${nowExpression}
          WHERE invoice_id = ? AND status = 'awaiting_payment'
            AND EXISTS (
              SELECT 1 FROM invoices
              WHERE id = ? AND status = 'void'
            )`,
        )
        .bind(id, id),
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, reason, result, occurred_at
          )
          SELECT ?, ?, ?, ?, 'invoice.voided', 'invoice', ?, ?, ?, 'success',
            ${nowExpression}
          WHERE EXISTS (
            SELECT 1 FROM invoices
            WHERE id = ? AND status = 'void'
          )`,
        )
        .bind(
          crypto.randomUUID(),
          establishmentId,
          identity.userId,
          identity.role,
          id,
          requestId,
          reason,
          id,
        ),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) {
      throw new HttpError(
        409,
        "invoice_void_conflict",
        "A fatura foi alterada. Atualize a página e tente novamente.",
      );
    }
    return json({
      invoice: { ...invoice, status: "void", voidReason: reason },
      idempotent: false,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
