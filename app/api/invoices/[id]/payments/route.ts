import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  creditPurchases,
  invoices,
} from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  optionalString,
  readJsonObject,
} from "@/lib/server/http";

function paidAtTimestamp(value: string | null) {
  if (!value) return new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(
      400,
      "invalid_paid_date",
      "A data do pagamento é inválida.",
    );
  }
  return `${value}T12:00:00.000Z`;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const { id: invoiceId } = await context.params;
    const body = await readJsonObject(request);
    const paidAt = paidAtTimestamp(optionalString(body, "paidAt", 10));
    const note = optionalString(body, "note", 500);
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
      throw new HttpError(
        404,
        "invoice_not_found",
        "A fatura não foi encontrada.",
      );
    }
    if (invoice.status === "void") {
      throw new HttpError(
        409,
        "invoice_void",
        "Uma fatura cancelada não pode receber pagamento.",
      );
    }
    if (invoice.status === "paid") {
      return json({ invoice: { ...invoice, status: "paid" }, idempotent: true });
    }
    if (invoice.status !== "issued") {
      throw new HttpError(
        409,
        "invoice_not_issued",
        "Emita a fatura antes de registrar o pagamento.",
      );
    }

    const paymentAmountCents = invoice.totalCents;

    const [purchase] =
      invoice.sourceType === "credit_package"
        ? await db
            .select()
            .from(creditPurchases)
            .where(
              and(
                eq(creditPurchases.invoiceId, invoiceId),
                eq(creditPurchases.establishmentId, establishmentId),
              ),
            )
            .limit(1)
        : [undefined];
    if (invoice.sourceType === "credit_package" && !purchase) {
      throw new HttpError(
        409,
        "credit_purchase_missing",
        "O pacote ligado a esta fatura não foi encontrado.",
      );
    }

    const paymentId = crypto.randomUUID();
    const movementId = purchase ? crypto.randomUUID() : null;
    const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
    const d1 = getD1Database();
    const statements = [] as ReturnType<typeof d1.prepare>[];
    const paymentStatementIndex = statements.length;
    statements.push(
      d1
        .prepare(
          `INSERT INTO invoice_payments (
            id, establishment_id, invoice_id, amount_cents, method, note,
            paid_at, recorded_by_user_id, created_at
          )
          SELECT ?, ?, id, ?, 'manual', ?, ?, ?, ${nowExpression}
          FROM invoices
          WHERE id = ? AND establishment_id = ? AND status = 'issued'
            AND NOT EXISTS (
              SELECT 1 FROM invoice_payments WHERE invoice_id = ?
            )`,
        )
        .bind(
          paymentId,
          establishmentId,
          paymentAmountCents,
          note,
          paidAt,
          identity.userId,
          invoiceId,
          establishmentId,
          invoiceId,
        ),
    );
    const paidStatementIndex = statements.length;
    statements.push(
      d1
        .prepare(
          `UPDATE invoices
          SET status = 'paid', updated_at = ${nowExpression}
          WHERE id = ? AND establishment_id = ? AND status = 'issued'
            AND EXISTS (
              SELECT 1 FROM invoice_payments
              WHERE id = ? AND invoice_id = invoices.id
            )`,
        )
        .bind(invoiceId, establishmentId, paymentId),
    );

    const cashEntryId = crypto.randomUUID();
    const cashEntryStatementIndex = statements.length;
    statements.push(
      d1
        .prepare(
          `INSERT INTO cash_entries (
            id, establishment_id, direction, origin, source_payment_id,
            occurred_on, amount_cents, category, description, note, status,
            exclusion_reason, created_by_user_id, updated_by_user_id,
            excluded_by_user_id, excluded_at, created_at, updated_at
          )
          SELECT ?, ip.establishment_id, 'inflow', 'invoice_payment', ip.id,
            substr(ip.paid_at, 1, 10), ip.amount_cents,
            CASE i.source_type
              WHEN 'credit_package' THEN 'Créditos'
              WHEN 'lodging_deposit' THEN 'Hospedagem'
              WHEN 'lodging_balance' THEN 'Hospedagem'
              ELSE 'Serviços'
            END,
            'Recebimento da fatura ' || i.invoice_number,
            ip.note, 'included', NULL, ?, ?, NULL, NULL,
            ${nowExpression}, ${nowExpression}
          FROM invoice_payments ip
          INNER JOIN invoices i ON i.id = ip.invoice_id
          WHERE ip.id = ? AND ip.establishment_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM cash_entries WHERE source_payment_id = ip.id
            )`,
        )
        .bind(
          cashEntryId,
          identity.userId,
          identity.userId,
          paymentId,
          establishmentId,
        ),
    );

    if (
      invoice.sourceType === "services" ||
      invoice.sourceType === "lodging_balance"
    ) {
      statements.push(
        d1
          .prepare(
            `UPDATE appointment_items
            SET settlement_method = 'invoice',
              settled_at = ?,
              updated_at = ${nowExpression}
            WHERE id IN (
              SELECT appointment_item_id
              FROM invoice_items
              WHERE invoice_id = ?
                AND service_name_snapshot <> 'Sinal da hospedagem'
            )
              AND settlement_method = 'unsettled'
              AND EXISTS (
                SELECT 1 FROM invoices
                WHERE id = ? AND status = 'paid'
              )`,
          )
          .bind(paidAt, invoiceId, invoiceId),
      );
    }

    if (purchase && movementId) {
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
              NULL, id, NULL, 'grant', credit_units,
              'Créditos liberados após pagamento da fatura', ?, ?, ?
            FROM credit_purchases
            WHERE id = ? AND invoice_id = ? AND status = 'awaiting_payment'
              AND EXISTS (
                SELECT 1 FROM invoices
                WHERE id = ? AND status = 'paid'
              )`,
          )
          .bind(
            movementId,
            `credit-purchase:${purchase.id}:paid`,
            identity.userId,
            paidAt,
            purchase.id,
            invoiceId,
            invoiceId,
          ),
        d1
          .prepare(
            `UPDATE credit_purchases
            SET status = 'paid', grant_movement_id = ?, paid_at = ?,
              updated_at = ${nowExpression}
            WHERE id = ? AND invoice_id = ? AND status = 'awaiting_payment'
              AND EXISTS (
                SELECT 1 FROM credit_movements WHERE id = ?
              )`,
          )
          .bind(movementId, paidAt, purchase.id, invoiceId, movementId),
      );
    }

    statements.push(
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, result, metadata_json,
            occurred_at
          )
          SELECT ?, ?, ?, ?, 'invoice.payment_recorded', 'invoice', ?, ?,
            'success', ?, ${nowExpression}
          WHERE EXISTS (
            SELECT 1 FROM invoice_payments WHERE id = ?
          )`,
        )
        .bind(
          crypto.randomUUID(),
          establishmentId,
          identity.userId,
          identity.role,
          invoiceId,
          requestId,
          JSON.stringify({
            amountCents: paymentAmountCents,
            paidAt,
            note,
          }),
          paymentId,
        ),
    );

    const results = await d1.batch(statements);
    if (
      (results[paymentStatementIndex].meta.changes ?? 0) !== 1 ||
      (results[paidStatementIndex].meta.changes ?? 0) !== 1 ||
      (results[cashEntryStatementIndex].meta.changes ?? 0) !== 1
    ) {
      throw new HttpError(
        409,
        "invoice_payment_conflict",
        "A fatura foi alterada. Atualize a página e tente novamente.",
      );
    }

    return json({
      invoice: {
        id: invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        status: "paid",
        totalCents: paymentAmountCents,
        paidAt,
      },
      payment: { id: paymentId, amountCents: paymentAmountCents, paidAt, note },
      creditsGranted: purchase?.creditUnits ?? 0,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
