import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import { invoiceSettlements, invoices } from "@/db/schema";
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
import { todayInSaoPaulo } from "@/lib/service-rules";

function isIsoDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const { id: invoiceId } = await context.params;
    const body = await readJsonObject(request);
    const action = requiredString(body, "action", 20);
    if (action !== "update" && action !== "cancel") {
      throw new HttpError(400, "invalid_action", "A ação informada é inválida.");
    }
    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [settlement] = await db
      .select({
        id: invoiceSettlements.id,
        availableOn: invoiceSettlements.availableOn,
        amountCents: invoiceSettlements.amountCents,
        invoiceStatus: invoices.status,
      })
      .from(invoiceSettlements)
      .innerJoin(invoices, eq(invoices.id, invoiceSettlements.invoiceId))
      .where(
        and(
          eq(invoiceSettlements.invoiceId, invoiceId),
          eq(invoiceSettlements.establishmentId, establishmentId),
          eq(invoiceSettlements.status, "scheduled"),
        ),
      )
      .limit(1);
    if (!settlement) {
      throw new HttpError(
        404,
        "settlement_not_found",
        "O recebimento em compensação não foi encontrado.",
      );
    }
    if (settlement.invoiceStatus !== "issued") {
      throw new HttpError(
        409,
        "invoice_not_open",
        "Somente uma fatura em aberto pode ter a compensação alterada.",
      );
    }

    const d1 = getD1Database();
    const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
    let metadata: Record<string, unknown>;
    let reason: string | null = null;
    let statement: ReturnType<typeof d1.prepare>;
    if (action === "update") {
      const availableOn = optionalString(body, "availableOn", 10);
      const note = optionalString(body, "note", 500);
      if (!isIsoDate(availableOn) || availableOn! < todayInSaoPaulo()) {
        throw new HttpError(
          400,
          "invalid_compensation_date",
          "Informe uma data de disponibilidade igual ou posterior a hoje.",
        );
      }
      metadata = {
        previousAvailableOn: settlement.availableOn,
        availableOn,
        note,
      };
      statement = d1
        .prepare(
          `UPDATE invoice_settlements
          SET available_on = ?, note = ?, updated_at = ${nowExpression}
          WHERE id = ? AND establishment_id = ? AND status = 'scheduled'`,
        )
        .bind(availableOn, note, settlement.id, establishmentId);
    } else {
      reason = requiredString(body, "reason", 500);
      metadata = { availableOn: settlement.availableOn };
      statement = d1
        .prepare(
          `UPDATE invoice_settlements
          SET status = 'cancelled', cancelled_at = ${nowExpression},
            cancelled_by_user_id = ?, cancellation_reason = ?,
            updated_at = ${nowExpression}
          WHERE id = ? AND establishment_id = ? AND status = 'scheduled'`,
        )
        .bind(identity.userId, reason, settlement.id, establishmentId);
    }

    const results = await d1.batch([
      statement,
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, reason, result, metadata_json,
            occurred_at
          )
          SELECT ?, ?, ?, ?, ?, 'invoice', ?, ?, ?, 'success', ?,
            ${nowExpression}
          WHERE EXISTS (
            SELECT 1 FROM invoice_settlements
            WHERE id = ? AND establishment_id = ? AND status = ?
          )`,
        )
        .bind(
          crypto.randomUUID(),
          establishmentId,
          identity.userId,
          identity.role,
          action === "update"
            ? "invoice.settlement_updated"
            : "invoice.settlement_cancelled",
          invoiceId,
          requestId,
          reason,
          JSON.stringify(metadata),
          settlement.id,
          establishmentId,
          action === "update" ? "scheduled" : "cancelled",
        ),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) {
      throw new HttpError(
        409,
        "settlement_conflict",
        "A compensação foi alterada. Atualize a página e tente novamente.",
      );
    }
    return json({
      settlement: {
        id: settlement.id,
        status: action === "update" ? "scheduled" : "cancelled",
        availableOn:
          action === "update"
            ? optionalString(body, "availableOn", 10)
            : settlement.availableOn,
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
