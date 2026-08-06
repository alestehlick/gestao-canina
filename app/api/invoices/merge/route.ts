import { and, eq, inArray } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  creditPurchases,
  invoiceItems,
  invoicePayments,
  invoiceSettlements,
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

export const dynamic = "force-dynamic";

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

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function invoiceNumber() {
  return `FAT-${todayInSaoPaulo().replaceAll("-", "")}-${crypto.randomUUID()
    .slice(0, 6)
    .toUpperCase()}`;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const body = await readJsonObject(request);
    if (
      !Array.isArray(body.invoiceIds) ||
      body.invoiceIds.length < 2 ||
      body.invoiceIds.length > 20 ||
      body.invoiceIds.some(
        (value) => typeof value !== "string" || !value.trim() || value.length > 80,
      )
    ) {
      throw new HttpError(
        400,
        "invalid_invoice_selection",
        "Selecione entre 2 e 20 faturas para unificar.",
      );
    }
    const invoiceIds = [...new Set(body.invoiceIds as string[])];
    if (invoiceIds.length !== body.invoiceIds.length) {
      throw new HttpError(
        400,
        "duplicate_invoice_selection",
        "A mesma fatura foi selecionada mais de uma vez.",
      );
    }

    const dueDateInput = optionalString(body, "dueDate", 10);
    if (dueDateInput && !isIsoDate(dueDateInput)) {
      throw new HttpError(400, "invalid_due_date", "A data de vencimento é inválida.");
    }

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const sourceInvoices = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.establishmentId, establishmentId),
          inArray(invoices.id, invoiceIds),
        ),
      );
    if (sourceInvoices.length !== invoiceIds.length) {
      throw new HttpError(
        404,
        "invoice_not_found",
        "Uma das faturas selecionadas não foi encontrada.",
      );
    }
    const accountId = sourceInvoices[0].accountId;
    if (sourceInvoices.some((invoice) => invoice.accountId !== accountId)) {
      throw new HttpError(
        400,
        "mixed_customers",
        "Selecione somente faturas do mesmo cliente.",
      );
    }
    if (sourceInvoices.some((invoice) => !["draft", "issued"].includes(invoice.status))) {
      throw new HttpError(
        409,
        "invoice_not_open",
        "Somente faturas abertas e sem pagamento podem ser unificadas.",
      );
    }
    if (sourceInvoices.some((invoice) => invoice.sourceId?.startsWith("invoice-merge:"))) {
      throw new HttpError(
        409,
        "nested_invoice_merge_not_allowed",
        "Desfaça a união existente antes de criar outra.",
      );
    }

    const [payments, settlements, sourceItems, sourceCreditPurchases] = await Promise.all([
      db
        .select({ invoiceId: invoicePayments.invoiceId })
        .from(invoicePayments)
        .where(inArray(invoicePayments.invoiceId, invoiceIds)),
      db
        .select({ invoiceId: invoiceSettlements.invoiceId })
        .from(invoiceSettlements)
        .where(
          and(
            inArray(invoiceSettlements.invoiceId, invoiceIds),
            eq(invoiceSettlements.status, "scheduled"),
          ),
        ),
      db
        .select()
        .from(invoiceItems)
        .where(inArray(invoiceItems.invoiceId, invoiceIds)),
      db
        .select()
        .from(creditPurchases)
        .where(inArray(creditPurchases.invoiceId, invoiceIds)),
    ]);
    if (payments.length || settlements.length) {
      throw new HttpError(
        409,
        "invoice_has_financial_movement",
        "Uma das faturas possui pagamento ou compensação. Cancele essa movimentação antes de unificar.",
      );
    }
    const invoicesWithItems = new Set(sourceItems.map((item) => item.invoiceId));
    const creditPurchaseByInvoice = new Map(
      sourceCreditPurchases.map((purchase) => [purchase.invoiceId, purchase]),
    );
    if (
      sourceInvoices.some((invoice) => {
        if (invoice.sourceType === "credit_package") {
          return creditPurchaseByInvoice.get(invoice.id)?.status !== "awaiting_payment";
        }
        return !invoicesWithItems.has(invoice.id);
      })
    ) {
      throw new HttpError(
        409,
        "invoice_without_mergeable_items",
        "Uma das faturas não possui serviços ou créditos abertos que possam ser transferidos com segurança.",
      );
    }
    const appointmentItemIds = sourceItems.map((item) => item.appointmentItemId);
    if (new Set(appointmentItemIds).size !== appointmentItemIds.length) {
      throw new HttpError(
        409,
        "duplicate_service_across_invoices",
        "As faturas possuem etapas diferentes do mesmo serviço e não podem ser unificadas.",
      );
    }
    const totalCents = sourceInvoices.reduce(
      (total, invoice) => total + invoice.totalCents,
      0,
    );
    const itemTotalCents = sourceItems.reduce(
      (total, item) => total + item.amountCents,
      0,
    ) + sourceCreditPurchases.reduce(
      (total, purchase) => total + purchase.amountCents,
      0,
    );
    if (totalCents <= 0 || totalCents !== itemTotalCents) {
      throw new HttpError(
        409,
        "invoice_total_mismatch",
        "Os totais das faturas precisam ser revisados antes da união.",
      );
    }

    const dueDate =
      dueDateInput ??
      sourceInvoices.map((invoice) => invoice.dueDate).sort().at(-1)!;
    const mergeId = crypto.randomUUID();
    const mergedInvoiceId = crypto.randomUUID();
    const number = invoiceNumber();
    const sourceNumbers = sourceInvoices.map((invoice) => invoice.invoiceNumber);
    const internalNote = sourceInvoices
      .filter((invoice) => invoice.internalNote?.trim())
      .map((invoice) => `#${invoice.invoiceNumber} — ${invoice.internalNote!.trim()}`)
      .join(" · ")
      .slice(0, 1000) || null;
    const placeholders = invoiceIds.map(() => "?").join(", ");
    const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
    const d1 = getD1Database();
    const statements: ReturnType<typeof d1.prepare>[] = [];

    statements.push(
      d1
        .prepare(
          `INSERT INTO invoices (
            id, establishment_id, account_id, invoice_number,
            recipient_name_snapshot, recipient_email_snapshot, status,
            issued_at, delivery_channels_json, internal_note, due_date,
            total_cents, source_type, source_id, created_by_user_id,
            created_at, updated_at
          )
          SELECT ?, ?, ?, ?, ?, ?, 'issued', ${nowExpression}, '[]', ?, ?, ?,
            'services', ?, ?, ${nowExpression}, ${nowExpression}
          WHERE (
            SELECT COUNT(*) FROM invoices
            WHERE id IN (${placeholders}) AND establishment_id = ?
              AND account_id = ? AND status IN ('draft', 'issued')
          ) = ?
          AND (
            SELECT COALESCE(SUM(total_cents), 0) FROM invoices
            WHERE id IN (${placeholders}) AND establishment_id = ?
          ) = ?
          AND NOT EXISTS (
            SELECT 1 FROM invoice_payments WHERE invoice_id IN (${placeholders})
          )
          AND NOT EXISTS (
            SELECT 1 FROM invoice_settlements
            WHERE invoice_id IN (${placeholders}) AND status = 'scheduled'
          )
          AND NOT EXISTS (
            SELECT 1 FROM invoices source_invoice
            WHERE source_invoice.id IN (${placeholders})
              AND source_invoice.source_type = 'credit_package'
              AND NOT EXISTS (
                SELECT 1 FROM credit_purchases purchase
                WHERE purchase.invoice_id = source_invoice.id
                  AND purchase.status = 'awaiting_payment'
              )
          )`,
        )
        .bind(
          mergedInvoiceId,
          establishmentId,
          accountId,
          number,
          sourceInvoices[0].recipientNameSnapshot,
          sourceInvoices[0].recipientEmailSnapshot,
          internalNote,
          dueDate,
          totalCents,
          `invoice-merge:${mergeId}`,
          identity.userId,
          ...invoiceIds,
          establishmentId,
          accountId,
          invoiceIds.length,
          ...invoiceIds,
          establishmentId,
          totalCents,
          ...invoiceIds,
          ...invoiceIds,
          ...invoiceIds,
        ),
      d1
        .prepare(
          `INSERT INTO invoice_merges (
            id, establishment_id, account_id, merged_invoice_id, status,
            created_by_user_id, created_at
          )
          SELECT ?, ?, ?, ?, 'active', ?, ${nowExpression}
          WHERE EXISTS (SELECT 1 FROM invoices WHERE id = ?)` ,
        )
        .bind(
          mergeId,
          establishmentId,
          accountId,
          mergedInvoiceId,
          identity.userId,
          mergedInvoiceId,
        ),
    );
    for (const sourceInvoice of sourceInvoices) {
      statements.push(
        d1
          .prepare(
            `INSERT INTO invoice_merge_members (
              merge_id, source_invoice_id, original_status, original_source_id,
              created_at
            )
            SELECT ?, ?, ?, ?, ${nowExpression}
            WHERE EXISTS (SELECT 1 FROM invoice_merges WHERE id = ?)` ,
          )
          .bind(
            mergeId,
            sourceInvoice.id,
            sourceInvoice.status,
            sourceInvoice.sourceId,
            mergeId,
          ),
      );
    }
    for (const item of sourceItems) {
      statements.push(
        d1
          .prepare(
            `INSERT INTO invoice_items (
              id, invoice_id, appointment_item_id, dog_name_snapshot,
              service_name_snapshot, service_date_snapshot,
              description_snapshot, amount_cents,
              lodging_long_stay_discount_percent,
              lodging_long_stay_discount_cents, created_at
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowExpression}
            WHERE EXISTS (SELECT 1 FROM invoice_merges WHERE id = ?)` ,
          )
          .bind(
            crypto.randomUUID(),
            mergedInvoiceId,
            item.appointmentItemId,
            item.dogNameSnapshot,
            item.serviceNameSnapshot,
            item.serviceDateSnapshot,
            item.descriptionSnapshot,
            item.amountCents,
            item.lodgingLongStayDiscountPercent,
            item.lodgingLongStayDiscountCents,
            mergeId,
          ),
      );
    }
    statements.push(
      d1
        .prepare(
          `UPDATE appointment_items
          SET active_invoice_id = ?, updated_at = ${nowExpression}
          WHERE active_invoice_id IN (${placeholders})
            AND EXISTS (SELECT 1 FROM invoice_merges WHERE id = ?)` ,
        )
        .bind(mergedInvoiceId, ...invoiceIds, mergeId),
      d1
        .prepare(
          `UPDATE invoices
          SET status = 'void', voided_at = ${nowExpression},
            void_reason = ?,
            source_id = CASE
              WHEN source_type IN ('lodging_deposit', 'lodging_balance')
                AND source_id IS NOT NULL
              THEN source_id || ':merged:' || ?
              ELSE source_id
            END,
            updated_at = ${nowExpression}
          WHERE id IN (${placeholders}) AND establishment_id = ?
            AND status IN ('draft', 'issued')
            AND EXISTS (SELECT 1 FROM invoice_merges WHERE id = ?)` ,
        )
        .bind(
          `Unificada na fatura ${number}`,
          mergeId,
          ...invoiceIds,
          establishmentId,
          mergeId,
        ),
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, result, metadata_json,
            occurred_at
          )
          SELECT ?, ?, ?, ?, 'invoice.merged', 'invoice', ?, ?, 'success', ?,
            ${nowExpression}
          WHERE EXISTS (SELECT 1 FROM invoice_merges WHERE id = ?)` ,
        )
        .bind(
          crypto.randomUUID(),
          establishmentId,
          identity.userId,
          identity.role,
          mergedInvoiceId,
          requestId,
          JSON.stringify({
            mergeId,
            sourceInvoiceIds: invoiceIds,
            sourceInvoiceNumbers: sourceNumbers,
            dueDate,
            totalCents,
          }),
          mergeId,
        ),
    );

    const results = await d1.batch(statements);
    if ((results[0].meta.changes ?? 0) !== 1) {
      throw new HttpError(
        409,
        "invoice_merge_conflict",
        "Uma das faturas foi alterada. Atualize a página e tente novamente.",
      );
    }

    return json(
      {
        invoice: {
          id: mergedInvoiceId,
          invoiceNumber: number,
          accountId,
          totalCents,
          dueDate,
        },
        mergeId,
        sourceInvoiceIds: invoiceIds,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
