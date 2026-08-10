import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  creditPurchases,
  financialAccounts,
  invoiceMergeMembers,
  invoiceMerges,
  invoices,
  invoiceSettlements,
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

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)?.value)
    .join("-");
}

function validIsoDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
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
    const settlementMode = body.settlementMode ?? "immediate";
    if (
      settlementMode !== "immediate" &&
      settlementMode !== "schedule" &&
      settlementMode !== "confirm_scheduled"
    ) {
      throw new HttpError(400, "invalid_settlement_mode", "A forma de recebimento é inválida.");
    }
    const rawPaidAt = optionalString(body, "paidAt", 10);
    if (
      settlementMode !== "schedule" &&
      validIsoDate(rawPaidAt) &&
      rawPaidAt! > todayInSaoPaulo()
    ) {
      throw new HttpError(
        400,
        "future_paid_date",
        "Use a compensação para valores que ainda não estão disponíveis na conta.",
      );
    }
    const paidAt = paidAtTimestamp(rawPaidAt);
    const note = optionalString(body, "note", 500);
    const establishmentId = identity.establishmentId!;
    const db = getDb();

    const requestedFinancialAccountId = optionalString(
      body,
      "financialAccountId",
      80,
    );
    const [selectedFinancialAccount] = await db
      .select({ id: financialAccounts.id, name: financialAccounts.name })
      .from(financialAccounts)
      .where(
        requestedFinancialAccountId
          ? and(
              eq(financialAccounts.id, requestedFinancialAccountId),
              eq(financialAccounts.establishmentId, establishmentId),
              eq(financialAccounts.active, true),
            )
          : and(
              eq(financialAccounts.establishmentId, establishmentId),
              eq(financialAccounts.active, true),
            ),
      )
      .limit(1);
    if (!selectedFinancialAccount) {
      throw new HttpError(
        409,
        "financial_account_required",
        "Cadastre ou escolha uma conta de recebimento ativa.",
      );
    }

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

    const [scheduledSettlement] = await db
      .select()
      .from(invoiceSettlements)
      .where(
        and(
          eq(invoiceSettlements.invoiceId, invoiceId),
          eq(invoiceSettlements.establishmentId, establishmentId),
          eq(invoiceSettlements.status, "scheduled"),
        ),
      )
      .limit(1);
    const usedFinancialAccount =
      scheduledSettlement?.financialAccountId &&
      scheduledSettlement.financialAccountId !== selectedFinancialAccount.id
        ? (await db
            .select({ id: financialAccounts.id, name: financialAccounts.name })
            .from(financialAccounts)
            .where(and(
              eq(financialAccounts.id, scheduledSettlement.financialAccountId),
              eq(financialAccounts.establishmentId, establishmentId),
            ))
            .limit(1))[0] ?? selectedFinancialAccount
        : selectedFinancialAccount;

    if (settlementMode === "schedule") {
      const availableOn = optionalString(body, "availableOn", 10);
      if (!validIsoDate(availableOn) || availableOn! < todayInSaoPaulo()) {
        throw new HttpError(
          400,
          "invalid_compensation_date",
          "Informe uma data futura ou de hoje para a disponibilidade do valor.",
        );
      }
      if (scheduledSettlement) {
        throw new HttpError(
          409,
          "settlement_already_scheduled",
          "Esta fatura já está em compensação.",
        );
      }
      const settlementId = crypto.randomUUID();
      const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
      const d1 = getD1Database();
      const results = await d1.batch([
        d1
          .prepare(
            `INSERT INTO invoice_settlements (
              id, establishment_id, invoice_id, financial_account_id, amount_cents, available_on,
              note, status, created_by_user_id, created_at, updated_at
            )
            SELECT ?, ?, id, ?, total_cents, ?, ?, 'scheduled', ?, ${nowExpression}, ${nowExpression}
            FROM invoices
            WHERE id = ? AND establishment_id = ? AND status = 'issued'
              AND NOT EXISTS (
                SELECT 1 FROM invoice_payments
                WHERE invoice_id = ? AND status = 'active'
              )
              AND NOT EXISTS (
                SELECT 1 FROM invoice_settlements WHERE invoice_id = ? AND status = 'scheduled'
              )`,
          )
          .bind(
            settlementId,
            establishmentId,
            selectedFinancialAccount.id,
            availableOn,
            note,
            identity.userId,
            invoiceId,
            establishmentId,
            invoiceId,
            invoiceId,
          ),
        d1
          .prepare(
            `INSERT INTO audit_events (
              id, establishment_id, actor_user_id, actor_role, action,
              entity_type, entity_id, request_id, result, metadata_json, occurred_at
            )
            SELECT ?, ?, ?, ?, 'invoice.settlement_scheduled', 'invoice', ?, ?,
              'success', ?, ${nowExpression}
            WHERE EXISTS (
              SELECT 1 FROM invoice_settlements WHERE id = ? AND status = 'scheduled'
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
              availableOn,
              amountCents: invoice.totalCents,
              note,
              financialAccountId: selectedFinancialAccount.id,
              financialAccountName: selectedFinancialAccount.name,
            }),
            settlementId,
          ),
      ]);
      if ((results[0].meta.changes ?? 0) !== 1) {
        throw new HttpError(409, "settlement_conflict", "A fatura foi alterada. Atualize a página e tente novamente.");
      }
      return json({
        invoice: { id: invoiceId, invoiceNumber: invoice.invoiceNumber, status: "issued", totalCents: invoice.totalCents },
        settlement: { id: settlementId, availableOn, status: "scheduled" },
      });
    }

    if (settlementMode === "confirm_scheduled" && !scheduledSettlement) {
      throw new HttpError(
        409,
        "settlement_not_found",
        "Esta fatura não possui um recebimento em compensação para confirmar.",
      );
    }
    if (settlementMode === "immediate" && scheduledSettlement) {
      throw new HttpError(
        409,
        "settlement_pending",
        "Confirme o valor em compensação quando ele estiver disponível.",
      );
    }

    const paymentAmountCents = invoice.totalCents;

    const [directPurchase] =
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
    if (invoice.sourceType === "credit_package" && !directPurchase) {
      throw new HttpError(
        409,
        "credit_purchase_missing",
        "O pacote ligado a esta fatura não foi encontrado.",
      );
    }
    let mergedCreditPurchases: Array<{
      id: string;
      invoiceId: string;
      creditUnits: number;
      status: "awaiting_payment" | "paid" | "cancelled" | "refunded";
    }> = [];
    if (invoice.sourceId?.startsWith("invoice-merge:")) {
      const [creditSourceInvoices, creditPurchaseRows] = await Promise.all([
        db
          .select({ id: invoices.id })
          .from(invoiceMergeMembers)
          .innerJoin(
            invoiceMerges,
            eq(invoiceMerges.id, invoiceMergeMembers.mergeId),
          )
          .innerJoin(
            invoices,
            eq(invoices.id, invoiceMergeMembers.sourceInvoiceId),
          )
          .where(
            and(
              eq(invoiceMerges.mergedInvoiceId, invoiceId),
              eq(invoiceMerges.establishmentId, establishmentId),
              eq(invoiceMerges.status, "active"),
              eq(invoices.sourceType, "credit_package"),
            ),
          ),
        db
          .select({
            id: creditPurchases.id,
            invoiceId: creditPurchases.invoiceId,
            creditUnits: creditPurchases.creditUnits,
            status: creditPurchases.status,
          })
          .from(creditPurchases)
          .innerJoin(
            invoiceMergeMembers,
            eq(invoiceMergeMembers.sourceInvoiceId, creditPurchases.invoiceId),
          )
          .innerJoin(
            invoiceMerges,
            eq(invoiceMerges.id, invoiceMergeMembers.mergeId),
          )
          .where(
            and(
              eq(invoiceMerges.mergedInvoiceId, invoiceId),
              eq(invoiceMerges.establishmentId, establishmentId),
              eq(invoiceMerges.status, "active"),
            ),
          ),
      ]);
      if (
        creditPurchaseRows.length !== creditSourceInvoices.length ||
        creditPurchaseRows.some(
          (creditPurchase) => creditPurchase.status !== "awaiting_payment",
        )
      ) {
        throw new HttpError(
          409,
          "merged_credit_purchase_changed",
          "Um pacote de créditos desta fatura foi alterado. Desfaça a união e revise as faturas originais.",
        );
      }
      mergedCreditPurchases = creditPurchaseRows;
    }
    const purchasesToGrant = directPurchase
      ? [{
          id: directPurchase.id,
          invoiceId: directPurchase.invoiceId,
          creditUnits: directPurchase.creditUnits,
        }]
      : mergedCreditPurchases.map(({ id, invoiceId: sourceInvoiceId, creditUnits }) => ({
          id,
          invoiceId: sourceInvoiceId,
          creditUnits,
        }));

    const paymentId = crypto.randomUUID();
    const creditGrants = purchasesToGrant.map((purchase) => ({
      purchase,
      movementId: crypto.randomUUID(),
    }));
    const creditPurchasePlaceholders = purchasesToGrant
      .map(() => "?")
      .join(", ");
    const creditPurchaseGuard = purchasesToGrant.length
      ? `AND (
          SELECT COUNT(*) FROM credit_purchases
          WHERE id IN (${creditPurchasePlaceholders})
            AND status = 'awaiting_payment'
        ) = ?`
      : "";
    const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
    const d1 = getD1Database();
    const statements = [] as ReturnType<typeof d1.prepare>[];
    let settlementConfirmationIndex: number | null = null;
    if (scheduledSettlement) {
      settlementConfirmationIndex = statements.length;
      statements.push(
        d1
          .prepare(
            `UPDATE invoice_settlements
            SET status = 'confirmed', confirmed_at = ${nowExpression},
              confirmed_by_user_id = ?, updated_at = ${nowExpression}
            WHERE id = ? AND establishment_id = ? AND status = 'scheduled'`,
          )
          .bind(identity.userId, scheduledSettlement.id, establishmentId),
      );
    }
    const paymentStatementIndex = statements.length;
    statements.push(
      d1
        .prepare(
          `INSERT INTO invoice_payments (
            id, establishment_id, invoice_id, financial_account_id, amount_cents, method, status, note,
            paid_at, recorded_by_user_id, created_at
          )
          SELECT ?, ?, id, ?, ?, 'manual', 'active', ?, ?, ?, ${nowExpression}
          FROM invoices
          WHERE id = ? AND establishment_id = ? AND status = 'issued'
            AND NOT EXISTS (
              SELECT 1 FROM invoice_payments
              WHERE invoice_id = ? AND status = 'active'
            )
            ${creditPurchaseGuard}`,
        )
        .bind(
          paymentId,
          establishmentId,
          usedFinancialAccount.id,
          paymentAmountCents,
          note,
          paidAt,
          identity.userId,
          invoiceId,
          establishmentId,
          invoiceId,
          ...purchasesToGrant.map((purchase) => purchase.id),
          ...(purchasesToGrant.length ? [purchasesToGrant.length] : []),
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
            id, establishment_id, direction, origin, source_payment_id, financial_account_id,
            occurred_on, amount_cents, category, description, note, status,
            exclusion_reason, created_by_user_id, updated_by_user_id,
            excluded_by_user_id, excluded_at, created_at, updated_at
          )
          SELECT ?, ip.establishment_id, 'inflow', 'invoice_payment', ip.id, ip.financial_account_id,
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

    for (const { purchase, movementId } of creditGrants) {
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
            purchase.invoiceId,
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
          .bind(
            movementId,
            paidAt,
            purchase.id,
            purchase.invoiceId,
            movementId,
          ),
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
            settledFromCompensation: Boolean(scheduledSettlement),
            releasedCreditPurchaseIds: purchasesToGrant.map(
              (purchase) => purchase.id,
            ),
            financialAccountId:
              usedFinancialAccount.id,
            financialAccountName: usedFinancialAccount.name,
          }),
          paymentId,
        ),
    );

    const results = await d1.batch(statements);
    if (
      (settlementConfirmationIndex !== null &&
        (results[settlementConfirmationIndex].meta.changes ?? 0) !== 1) ||
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
      creditsGranted: purchasesToGrant.reduce(
        (total, purchase) => total + purchase.creditUnits,
        0,
      ),
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
