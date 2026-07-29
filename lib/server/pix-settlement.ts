import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  creditPurchases,
  invoices,
  payments,
  pixCharges,
} from "@/db/schema";
import { HttpError } from "./http";

export type VerifiedPixPayment = {
  pixChargeId: string;
  endToEndId: string;
  amountCents: number;
  confirmedAt: string;
  providerEventId?: string;
};

export type PixSettlementResult = {
  paymentId: string;
  invoiceId: string;
  creditPurchaseId: string | null;
  grantedUnits: number;
  idempotent: boolean;
};

function assertVerifiedPaymentInput(input: VerifiedPixPayment) {
  if (!input.pixChargeId || input.pixChargeId.length > 100) {
    throw new HttpError(
      400,
      "invalid_pix_charge",
      "A cobrança Pix confirmada é inválida.",
    );
  }
  if (!input.endToEndId || input.endToEndId.length > 160) {
    throw new HttpError(
      400,
      "invalid_end_to_end_id",
      "O identificador do pagamento Pix é inválido.",
    );
  }
  if (
    !Number.isSafeInteger(input.amountCents) ||
    input.amountCents <= 0 ||
    input.amountCents > 100_000_000
  ) {
    throw new HttpError(
      400,
      "invalid_pix_amount",
      "O valor confirmado pelo Pix é inválido.",
    );
  }
  if (Number.isNaN(Date.parse(input.confirmedAt))) {
    throw new HttpError(
      400,
      "invalid_confirmation_time",
      "O horário da confirmação Pix é inválido.",
    );
  }
}

/**
 * Registra um evento que já foi autenticado pelo adaptador oficial do provedor.
 *
 * Não chame esta função com dados enviados diretamente pelo navegador. O
 * adaptador do webhook deve validar assinatura/mTLS e normalizar o evento antes.
 * O lote D1 é atômico: pagamento, baixa da fatura, concessão de créditos e
 * auditoria são confirmados juntos ou descartados juntos.
 */
export async function settleVerifiedPixPayment(
  input: VerifiedPixPayment,
): Promise<PixSettlementResult> {
  assertVerifiedPaymentInput(input);
  const db = getDb();
  const [existingPayment] = await db
    .select({
      id: payments.id,
      invoiceId: payments.invoiceId,
    })
    .from(payments)
    .where(eq(payments.endToEndId, input.endToEndId))
    .limit(1);
  if (existingPayment) {
    const [purchase] = await db
      .select({
        id: creditPurchases.id,
        creditUnits: creditPurchases.creditUnits,
      })
      .from(creditPurchases)
      .where(eq(creditPurchases.invoiceId, existingPayment.invoiceId))
      .limit(1);
    return {
      paymentId: existingPayment.id,
      invoiceId: existingPayment.invoiceId,
      creditPurchaseId: purchase?.id ?? null,
      grantedUnits: purchase?.creditUnits ?? 0,
      idempotent: true,
    };
  }

  const [charge] = await db
    .select({
      id: pixCharges.id,
      establishmentId: pixCharges.establishmentId,
      invoiceId: pixCharges.invoiceId,
      chargeAmountCents: pixCharges.amountCents,
      chargeStatus: pixCharges.status,
      invoiceStatus: invoices.status,
      invoiceAmountCents: invoices.totalCents,
      sourceType: invoices.sourceType,
      sourceId: invoices.sourceId,
    })
    .from(pixCharges)
    .innerJoin(invoices, eq(invoices.id, pixCharges.invoiceId))
    .where(eq(pixCharges.id, input.pixChargeId))
    .limit(1);
  if (!charge) {
    throw new HttpError(
      404,
      "pix_charge_not_found",
      "A cobrança Pix confirmada não foi encontrada.",
    );
  }
  if (charge.chargeStatus !== "pending" || charge.invoiceStatus === "void") {
    throw new HttpError(
      409,
      "pix_charge_not_pending",
      "A cobrança Pix não está aguardando pagamento.",
    );
  }
  if (
    charge.chargeAmountCents !== input.amountCents ||
    charge.invoiceAmountCents !== input.amountCents
  ) {
    throw new HttpError(
      409,
      "pix_amount_mismatch",
      "O valor confirmado não corresponde ao valor da cobrança.",
    );
  }

  let purchase: typeof creditPurchases.$inferSelect | null = null;
  if (charge.sourceType === "credit_package") {
    [purchase] = await db
      .select()
      .from(creditPurchases)
      .where(
        and(
          eq(creditPurchases.invoiceId, charge.invoiceId),
          eq(creditPurchases.id, charge.sourceId!),
        ),
      )
      .limit(1);
    if (!purchase || purchase.status !== "awaiting_payment") {
      throw new HttpError(
        409,
        "credit_purchase_not_pending",
        "A compra de créditos não está aguardando pagamento.",
      );
    }
  }

  const paymentId = crypto.randomUUID();
  const grantMovementId = purchase ? crypto.randomUUID() : null;
  const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
  const d1 = getD1Database();
  const results = await d1.batch([
    d1
      .prepare(
        `INSERT INTO payments (
          id, establishment_id, invoice_id, pix_charge_id, kind,
          amount_cents, end_to_end_id, confirmed_at, created_at
        )
        SELECT ?, pc.establishment_id, pc.invoice_id, pc.id, 'receipt',
          ?, ?, ?, ${nowExpression}
        FROM pix_charges pc
        INNER JOIN invoices i ON i.id = pc.invoice_id
        WHERE pc.id = ?
          AND pc.status = 'pending'
          AND pc.amount_cents = ?
          AND i.status <> 'void'
          AND i.total_cents = ?
          AND NOT EXISTS (
            SELECT 1 FROM payments WHERE end_to_end_id = ?
          )`,
      )
      .bind(
        paymentId,
        input.amountCents,
        input.endToEndId,
        input.confirmedAt,
        input.pixChargeId,
        input.amountCents,
        input.amountCents,
        input.endToEndId,
      ),
    d1
      .prepare(
        `UPDATE pix_charges
        SET status = 'paid', paid_at = ?, updated_at = ${nowExpression}
        WHERE id = ?
          AND EXISTS (SELECT 1 FROM payments WHERE id = ?)`,
      )
      .bind(input.confirmedAt, input.pixChargeId, paymentId),
    d1
      .prepare(
        `UPDATE invoices
        SET status = 'paid', updated_at = ${nowExpression}
        WHERE id = ?
          AND EXISTS (SELECT 1 FROM payments WHERE id = ?)`,
      )
      .bind(charge.invoiceId, paymentId),
    d1
      .prepare(
        `INSERT INTO credit_movements (
          id, establishment_id, account_id, dog_id, service_catalog_id,
          appointment_item_id, credit_purchase_id, reversed_movement_id,
          movement_type, delta_units, reason, idempotency_key, actor_user_id,
          occurred_at
        )
        SELECT ?, cp.establishment_id, cp.account_id, NULL,
          cp.service_catalog_id, NULL, cp.id, NULL, 'grant',
          cp.credit_units, 'Compra de pacote paga por Pix',
          'credit-purchase:' || cp.id, NULL, ?
        FROM credit_purchases cp
        WHERE cp.invoice_id = ?
          AND cp.status = 'awaiting_payment'
          AND EXISTS (SELECT 1 FROM payments WHERE id = ?)
          AND NOT EXISTS (
            SELECT 1
            FROM credit_movements
            WHERE credit_purchase_id = cp.id
          )`,
      )
      .bind(
        grantMovementId,
        input.confirmedAt,
        charge.invoiceId,
        paymentId,
      ),
    d1
      .prepare(
        `UPDATE credit_purchases
        SET status = 'paid', grant_movement_id = ?, paid_at = ?,
          updated_at = ${nowExpression}
        WHERE invoice_id = ?
          AND EXISTS (
            SELECT 1 FROM credit_movements WHERE id = ?
          )`,
      )
      .bind(
        grantMovementId,
        input.confirmedAt,
        charge.invoiceId,
        grantMovementId,
      ),
    d1
      .prepare(
        `INSERT INTO audit_events (
          id, establishment_id, actor_user_id, actor_role, action,
          entity_type, entity_id, request_id, result, metadata_json,
          occurred_at
        )
        SELECT ?, ?, NULL, 'pix_provider', 'pix.payment_confirmed',
          'pix_charge', ?, ?, 'success', ?, ${nowExpression}
        WHERE EXISTS (SELECT 1 FROM payments WHERE id = ?)`,
      )
      .bind(
        crypto.randomUUID(),
        charge.establishmentId,
        input.pixChargeId,
        input.providerEventId ?? input.endToEndId,
        JSON.stringify({
          paymentId,
          invoiceId: charge.invoiceId,
          creditPurchaseId: purchase?.id ?? null,
          grantMovementId,
          amountCents: input.amountCents,
          endToEndId: input.endToEndId,
        }),
        paymentId,
      ),
  ]);

  if ((results[0].meta.changes ?? 0) !== 1) {
    const [concurrentPayment] = await db
      .select({
        id: payments.id,
        invoiceId: payments.invoiceId,
      })
      .from(payments)
      .where(eq(payments.endToEndId, input.endToEndId))
      .limit(1);
    if (concurrentPayment) {
      return {
        paymentId: concurrentPayment.id,
        invoiceId: concurrentPayment.invoiceId,
        creditPurchaseId: purchase?.id ?? null,
        grantedUnits: purchase?.creditUnits ?? 0,
        idempotent: true,
      };
    }
    throw new HttpError(
      409,
      "pix_settlement_conflict",
      "A cobrança Pix foi alterada por outra operação.",
    );
  }

  return {
    paymentId,
    invoiceId: charge.invoiceId,
    creditPurchaseId: purchase?.id ?? null,
    grantedUnits: purchase?.creditUnits ?? 0,
    idempotent: false,
  };
}
