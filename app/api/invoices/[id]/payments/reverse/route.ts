import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import { invoicePayments, invoices } from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import { assertCashDateIsOpen } from "@/lib/server/cash";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
  requiredString,
} from "@/lib/server/http";

type ReversibleCreditPurchase = {
  id: string;
  invoice_id: string;
  account_id: string;
  service_catalog_id: string;
  credit_units: number;
  grant_movement_id: string;
  available_units: number;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner"]);
    const { id: invoiceId } = await context.params;
    const reason = requiredString(
      await readJsonObject(request),
      "reason",
      500,
    );
    const establishmentId = identity.establishmentId!;
    const db = getDb();

    const [invoice] = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.id, invoiceId),
          eq(invoices.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (!invoice) {
      throw new HttpError(404, "invoice_not_found", "A fatura não foi encontrada.");
    }

    const [payment] = await db
      .select()
      .from(invoicePayments)
      .where(
        and(
          eq(invoicePayments.invoiceId, invoiceId),
          eq(invoicePayments.establishmentId, establishmentId),
          eq(invoicePayments.status, "active"),
        ),
      )
      .limit(1);
    if (!payment) {
      if (invoice.status !== "paid") {
        return json({ reversed: true, idempotent: true });
      }
      throw new HttpError(
        409,
        "active_payment_missing",
        "O pagamento ativo desta fatura não foi encontrado.",
      );
    }
    if (invoice.status !== "paid") {
      throw new HttpError(
        409,
        "invoice_payment_state_conflict",
        "A situação da fatura mudou. Atualize a página e tente novamente.",
      );
    }
    await assertCashDateIsOpen(establishmentId, payment.paidAt.slice(0, 10));

    const d1 = getD1Database();
    const creditPurchaseResult = await d1
      .prepare(
        `SELECT cp.id, cp.invoice_id, cp.account_id, cp.service_catalog_id,
          cp.credit_units, cp.grant_movement_id,
          (
            SELECT COALESCE(SUM(cm.delta_units), 0)
            FROM credit_movements cm
            WHERE cm.establishment_id = cp.establishment_id
              AND cm.account_id = cp.account_id
              AND cm.service_catalog_id = cp.service_catalog_id
          ) AS available_units
        FROM credit_purchases cp
        WHERE cp.establishment_id = ? AND cp.status = 'paid'
          AND (
            cp.invoice_id = ? OR cp.invoice_id IN (
              SELECT imm.source_invoice_id
              FROM invoice_merge_members imm
              INNER JOIN invoice_merges im ON im.id = imm.merge_id
              WHERE im.merged_invoice_id = ? AND im.status = 'active'
            )
          )`,
      )
      .bind(establishmentId, invoiceId, invoiceId)
      .all<ReversibleCreditPurchase>();
    const creditPurchases = creditPurchaseResult.results;
    const unavailablePurchase = creditPurchases.find(
      (purchase) =>
        !purchase.grant_movement_id ||
        Number(purchase.available_units) < Number(purchase.credit_units),
    );
    if (unavailablePurchase) {
      throw new HttpError(
        409,
        "granted_credits_already_used",
        "Não é seguro estornar: parte dos créditos liberados por esta fatura já foi utilizada. Revise o extrato de créditos antes de corrigir o pagamento.",
      );
    }

    const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
    const statements = [] as ReturnType<typeof d1.prepare>[];
    const paymentStatementIndex = statements.length;
    statements.push(
      d1
        .prepare(
          `UPDATE invoice_payments
          SET status = 'reversed', reversed_at = ${nowExpression},
            reversal_reason = ?, reversed_by_user_id = ?
          WHERE id = ? AND establishment_id = ? AND invoice_id = ?
            AND status = 'active'`,
        )
        .bind(reason, identity.userId, payment.id, establishmentId, invoiceId),
      d1
        .prepare(
          `UPDATE invoices
          SET status = 'issued', updated_at = ${nowExpression}
          WHERE id = ? AND establishment_id = ? AND status = 'paid'
            AND EXISTS (
              SELECT 1 FROM invoice_payments
              WHERE id = ? AND status = 'reversed'
            )`,
        )
        .bind(invoiceId, establishmentId, payment.id),
      d1
        .prepare(
          `UPDATE cash_entries
          SET status = 'excluded', exclusion_reason = ?,
            excluded_by_user_id = ?, excluded_at = ${nowExpression},
            updated_by_user_id = ?, updated_at = ${nowExpression}
          WHERE source_payment_id = ? AND establishment_id = ?
            AND status = 'included'`,
        )
        .bind(
          `Pagamento estornado: ${reason}`,
          identity.userId,
          identity.userId,
          payment.id,
          establishmentId,
        ),
      d1
        .prepare(
          `UPDATE appointment_items
          SET settlement_method = 'unsettled', settled_at = NULL,
            updated_at = ${nowExpression}
          WHERE settlement_method = 'invoice'
            AND id IN (
              SELECT appointment_item_id FROM invoice_items
              WHERE invoice_id = ?
                AND service_name_snapshot <> 'Sinal da hospedagem'
            )
            AND EXISTS (
              SELECT 1 FROM invoices WHERE id = ? AND status = 'issued'
            )`,
        )
        .bind(invoiceId, invoiceId),
    );

    for (const purchase of creditPurchases) {
      const reversalMovementId = crypto.randomUUID();
      statements.push(
        d1
          .prepare(
            `INSERT INTO credit_movements (
              id, establishment_id, account_id, dog_id, service_catalog_id,
              appointment_item_id, credit_purchase_id, reversed_movement_id,
              movement_type, delta_units, reason, idempotency_key,
              actor_user_id, occurred_at
            )
            SELECT ?, establishment_id, account_id, NULL, service_catalog_id,
              NULL, NULL, grant_movement_id, 'adjust', -credit_units, ?, ?, ?,
              ${nowExpression}
            FROM credit_purchases
            WHERE id = ? AND status = 'paid' AND grant_movement_id = ?
              AND EXISTS (
                SELECT 1 FROM invoice_payments
                WHERE id = ? AND status = 'reversed'
              )`,
          )
          .bind(
            reversalMovementId,
            `Pagamento estornado: ${reason}`,
            `credit-purchase:${purchase.id}:payment-reversed:${payment.id}`,
            identity.userId,
            purchase.id,
            purchase.grant_movement_id,
            payment.id,
          ),
        d1
          .prepare(
            `UPDATE credit_movements
            SET credit_purchase_id = NULL,
              idempotency_key = ?
            WHERE id = ? AND credit_purchase_id = ?
              AND EXISTS (
                SELECT 1 FROM credit_movements WHERE id = ?
              )`,
          )
          .bind(
            `archived:credit-purchase:${purchase.id}:payment-reversed:${payment.id}`,
            purchase.grant_movement_id,
            purchase.id,
            reversalMovementId,
          ),
        d1
          .prepare(
            `UPDATE credit_purchases
            SET status = 'awaiting_payment', grant_movement_id = NULL,
              paid_at = NULL, updated_at = ${nowExpression}
            WHERE id = ? AND status = 'paid'
              AND EXISTS (
                SELECT 1 FROM credit_movements WHERE id = ?
              )`,
          )
          .bind(purchase.id, reversalMovementId),
      );
    }

    statements.push(
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, reason, result, metadata_json,
            occurred_at
          )
          SELECT ?, ?, ?, ?, 'invoice.payment_reversed', 'invoice', ?, ?, ?,
            'success', ?, ${nowExpression}
          WHERE EXISTS (
            SELECT 1 FROM invoice_payments WHERE id = ? AND status = 'reversed'
          )`,
        )
        .bind(
          crypto.randomUUID(),
          establishmentId,
          identity.userId,
          identity.role,
          invoiceId,
          requestId,
          reason,
          JSON.stringify({
            paymentId: payment.id,
            amountCents: payment.amountCents,
            creditPurchaseIds: creditPurchases.map((purchase) => purchase.id),
          }),
          payment.id,
        ),
    );

    const results = await d1.batch(statements);
    if ((results[paymentStatementIndex].meta.changes ?? 0) !== 1) {
      throw new HttpError(
        409,
        "payment_reversal_conflict",
        "O pagamento foi alterado. Atualize a página e tente novamente.",
      );
    }

    return json({
      reversed: true,
      idempotent: false,
      invoice: { id: invoiceId, status: "issued" },
      payment: { id: payment.id, status: "reversed" },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
