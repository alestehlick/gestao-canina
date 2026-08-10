import { and, eq, inArray } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  creditPurchases,
  invoiceItems,
  invoiceMergeMembers,
  invoiceMerges,
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
  return `FAT-${todayInSaoPaulo().replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
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
      body.invoiceIds.length > 75 ||
      body.invoiceIds.some((value) => typeof value !== "string" || !value.trim() || value.length > 80)
    ) {
      throw new HttpError(400, "invalid_invoice_selection", "Selecione entre 2 e 75 faturas para unificar.");
    }
    const selectedIds = [...new Set(body.invoiceIds as string[])];
    if (selectedIds.length !== body.invoiceIds.length) {
      throw new HttpError(400, "duplicate_invoice_selection", "A mesma fatura foi selecionada mais de uma vez.");
    }
    const dueDateInput = optionalString(body, "dueDate", 10);
    if (dueDateInput && !isIsoDate(dueDateInput)) {
      throw new HttpError(400, "invalid_due_date", "A data de vencimento é inválida.");
    }

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const selectedInvoices = await db.select().from(invoices).where(and(
      eq(invoices.establishmentId, establishmentId),
      inArray(invoices.id, selectedIds),
    ));
    if (selectedInvoices.length !== selectedIds.length) {
      throw new HttpError(404, "invoice_not_found", "Uma das faturas selecionadas não foi encontrada.");
    }
    const accountId = selectedInvoices[0].accountId;
    if (selectedInvoices.some((invoice) => invoice.accountId !== accountId)) {
      throw new HttpError(400, "mixed_customers", "Selecione somente faturas do mesmo cliente.");
    }
    if (selectedInvoices.some((invoice) => !["draft", "issued"].includes(invoice.status))) {
      throw new HttpError(409, "invoice_not_open", "Somente faturas abertas e sem pagamento podem ser unificadas.");
    }
    const [payments, settlements] = await Promise.all([
      db.select({ invoiceId: invoicePayments.invoiceId }).from(invoicePayments).where(and(
        inArray(invoicePayments.invoiceId, selectedIds),
        eq(invoicePayments.status, "active"),
      )),
      db.select({ invoiceId: invoiceSettlements.invoiceId }).from(invoiceSettlements).where(and(
        inArray(invoiceSettlements.invoiceId, selectedIds),
        eq(invoiceSettlements.status, "scheduled"),
      )),
    ]);
    if (payments.length || settlements.length) {
      throw new HttpError(409, "invoice_has_financial_movement", "Uma das faturas possui pagamento ou compensação e não pode ser unificada.");
    }

    const selectedMergedIds = selectedInvoices
      .filter((invoice) => invoice.sourceId?.startsWith("invoice-merge:"))
      .map((invoice) => invoice.id);
    const previousMergeRows = selectedMergedIds.length
      ? await db.select({
          mergeId: invoiceMerges.id,
          mergedInvoiceId: invoiceMerges.mergedInvoiceId,
          sourceInvoiceId: invoiceMergeMembers.sourceInvoiceId,
          originalStatus: invoiceMergeMembers.originalStatus,
          originalSourceId: invoiceMergeMembers.originalSourceId,
        }).from(invoiceMerges).innerJoin(invoiceMergeMembers, eq(invoiceMergeMembers.mergeId, invoiceMerges.id)).where(and(
          eq(invoiceMerges.establishmentId, establishmentId),
          eq(invoiceMerges.status, "active"),
          inArray(invoiceMerges.mergedInvoiceId, selectedMergedIds),
        ))
      : [];
    const representedMergedIds = new Set(previousMergeRows.map((row) => row.mergedInvoiceId));
    if (selectedMergedIds.some((id) => !representedMergedIds.has(id))) {
      throw new HttpError(409, "invoice_merge_lineage_missing", "Uma união anterior não possui histórico íntegro. Desfaça-a antes de continuar.");
    }

    const leafMetadata = new Map<string, { originalStatus: "draft" | "issued"; originalSourceId: string | null }>();
    for (const invoice of selectedInvoices) {
      if (!selectedMergedIds.includes(invoice.id)) {
        leafMetadata.set(invoice.id, {
          originalStatus: invoice.status as "draft" | "issued",
          originalSourceId: invoice.sourceId,
        });
      }
    }
    for (const row of previousMergeRows) {
      const current = leafMetadata.get(row.sourceInvoiceId);
      const next = {
        originalStatus: row.originalStatus,
        originalSourceId: row.originalSourceId,
      };
      if (current && (current.originalStatus !== next.originalStatus || current.originalSourceId !== next.originalSourceId)) {
        throw new HttpError(409, "invoice_merge_lineage_conflict", "As uniões anteriores possuem históricos incompatíveis.");
      }
      leafMetadata.set(row.sourceInvoiceId, next);
    }
    const leafIds = [...leafMetadata.keys()];
    if (!leafIds.length || leafIds.length > 75) {
      throw new HttpError(409, "invoice_merge_too_large", "A união reúne faturas demais. Divida-a em grupos menores.");
    }

    const [leafInvoices, leafItems, leafPurchases] = await Promise.all([
      db.select().from(invoices).where(and(
        eq(invoices.establishmentId, establishmentId),
        inArray(invoices.id, leafIds),
      )),
      db.select().from(invoiceItems).where(inArray(invoiceItems.invoiceId, leafIds)),
      db.select().from(creditPurchases).where(inArray(creditPurchases.invoiceId, leafIds)),
    ]);
    if (leafInvoices.length !== leafIds.length) {
      throw new HttpError(409, "invoice_merge_lineage_missing", "Uma fatura original da união não foi encontrada.");
    }
    const purchaseByInvoice = new Map(leafPurchases.map((purchase) => [purchase.invoiceId, purchase]));
    const invoicesWithItems = new Set(leafItems.map((item) => item.invoiceId));
    if (leafInvoices.some((invoice) =>
      invoice.sourceType === "credit_package"
        ? purchaseByInvoice.get(invoice.id)?.status !== "awaiting_payment"
        : !invoicesWithItems.has(invoice.id)
    )) {
      throw new HttpError(409, "invoice_without_mergeable_items", "Uma fatura não possui serviços ou créditos abertos que possam ser transferidos.");
    }
    const appointmentItemIds = leafItems.map((item) => item.appointmentItemId);
    if (new Set(appointmentItemIds).size !== appointmentItemIds.length) {
      throw new HttpError(409, "duplicate_service_across_invoices", "Há etapas repetidas do mesmo serviço nas faturas selecionadas.");
    }
    const totalCents = selectedInvoices.reduce((total, invoice) => total + invoice.totalCents, 0);
    const leafTotalCents = leafInvoices.reduce((total, invoice) => total + invoice.totalCents, 0);
    const itemTotalCents = leafItems.reduce((total, item) => total + item.amountCents, 0) +
      leafPurchases.reduce((total, purchase) => total + purchase.amountCents, 0);
    if (totalCents <= 0 || totalCents !== leafTotalCents || totalCents !== itemTotalCents) {
      throw new HttpError(409, "invoice_total_mismatch", "Os totais precisam ser revisados antes da união.");
    }

    const dueDate = dueDateInput ?? selectedInvoices.map((invoice) => invoice.dueDate).sort().at(-1)!;
    const mergeId = crypto.randomUUID();
    const mergedInvoiceId = crypto.randomUUID();
    const number = invoiceNumber();
    const previousMergeIds = [...new Set(previousMergeRows.map((row) => row.mergeId))];
    const internalNote = selectedInvoices
      .filter((invoice) => invoice.internalNote?.trim())
      .map((invoice) => `#${invoice.invoiceNumber} — ${invoice.internalNote!.trim()}`)
      .join(" · ").slice(0, 1000) || null;
    const selectedPlaceholders = selectedIds.map(() => "?").join(", ");
    const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
    const d1 = getD1Database();
    const statements: ReturnType<typeof d1.prepare>[] = [];
    statements.push(d1.prepare(`INSERT INTO invoices (
      id, establishment_id, account_id, invoice_number, recipient_name_snapshot,
      recipient_email_snapshot, status, issued_at, delivery_channels_json,
      internal_note, due_date, total_cents, source_type, source_id,
      created_by_user_id, created_at, updated_at
    ) SELECT ?, ?, ?, ?, ?, ?, 'issued', ${nowExpression}, '[]', ?, ?, ?,
      'services', ?, ?, ${nowExpression}, ${nowExpression}
    WHERE (SELECT COUNT(*) FROM invoices WHERE id IN (${selectedPlaceholders})
      AND establishment_id = ? AND account_id = ? AND status IN ('draft','issued')) = ?
      AND (SELECT COALESCE(SUM(total_cents),0) FROM invoices WHERE id IN (${selectedPlaceholders})) = ?
      AND NOT EXISTS (SELECT 1 FROM invoice_payments WHERE invoice_id IN (${selectedPlaceholders}) AND status='active')
      AND NOT EXISTS (SELECT 1 FROM invoice_settlements WHERE invoice_id IN (${selectedPlaceholders}) AND status='scheduled')`).bind(
        mergedInvoiceId, establishmentId, accountId, number,
        selectedInvoices[0].recipientNameSnapshot, selectedInvoices[0].recipientEmailSnapshot,
        internalNote, dueDate, totalCents, `invoice-merge:${mergeId}`, identity.userId,
        ...selectedIds, establishmentId, accountId, selectedIds.length,
        ...selectedIds, totalCents, ...selectedIds, ...selectedIds,
      ));
    statements.push(d1.prepare(`INSERT INTO invoice_merges (
      id, establishment_id, account_id, merged_invoice_id, status,
      created_by_user_id, created_at
    ) SELECT ?, ?, ?, ?, 'active', ?, ${nowExpression}
      WHERE EXISTS (SELECT 1 FROM invoices WHERE id=?)`).bind(
        mergeId, establishmentId, accountId, mergedInvoiceId, identity.userId, mergedInvoiceId,
      ));
    for (const leafInvoice of leafInvoices) {
      const metadata = leafMetadata.get(leafInvoice.id)!;
      statements.push(d1.prepare(`INSERT INTO invoice_merge_members (
        merge_id, source_invoice_id, original_status, original_source_id, created_at
      ) SELECT ?, ?, ?, ?, ${nowExpression}
        WHERE EXISTS (SELECT 1 FROM invoice_merges WHERE id=?)`).bind(
          mergeId, leafInvoice.id, metadata.originalStatus, metadata.originalSourceId, mergeId,
        ));
    }
    for (const item of leafItems) {
      statements.push(d1.prepare(`INSERT INTO invoice_items (
        id, invoice_id, appointment_item_id, dog_name_snapshot,
        service_name_snapshot, service_date_snapshot, description_snapshot,
        amount_cents, lodging_long_stay_discount_percent,
        lodging_long_stay_discount_cents, created_at
      ) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowExpression}
        WHERE EXISTS (SELECT 1 FROM invoice_merges WHERE id=?)`).bind(
          crypto.randomUUID(), mergedInvoiceId, item.appointmentItemId,
          item.dogNameSnapshot, item.serviceNameSnapshot, item.serviceDateSnapshot,
          item.descriptionSnapshot, item.amountCents,
          item.lodgingLongStayDiscountPercent, item.lodgingLongStayDiscountCents, mergeId,
        ));
    }
    statements.push(d1.prepare(`UPDATE appointment_items
      SET active_invoice_id=?, updated_at=${nowExpression}
      WHERE active_invoice_id IN (${selectedPlaceholders})
        AND EXISTS (SELECT 1 FROM invoice_merges WHERE id=?)`).bind(
          mergedInvoiceId, ...selectedIds, mergeId,
        ));
    statements.push(d1.prepare(`UPDATE invoices SET status='void',
      voided_at=${nowExpression}, void_reason=?,
      source_id=CASE WHEN source_type IN ('lodging_deposit','lodging_balance')
        AND source_id IS NOT NULL THEN source_id || ':merged:' || ? ELSE source_id END,
      updated_at=${nowExpression}
      WHERE id IN (${selectedPlaceholders}) AND establishment_id=?
        AND status IN ('draft','issued')
        AND EXISTS (SELECT 1 FROM invoice_merges WHERE id=?)`).bind(
          `Unificada na fatura ${number}`, mergeId, ...selectedIds, establishmentId, mergeId,
        ));
    for (const previousMergeId of previousMergeIds) {
      statements.push(d1.prepare(`UPDATE invoice_merges SET status='reversed',
        reversed_by_user_id=?, reversed_at=${nowExpression}
        WHERE id=? AND establishment_id=? AND status='active'
          AND EXISTS (SELECT 1 FROM invoice_merges WHERE id=?)`).bind(
            identity.userId, previousMergeId, establishmentId, mergeId,
          ));
    }
    statements.push(d1.prepare(`INSERT INTO audit_events (
      id, establishment_id, actor_user_id, actor_role, action, entity_type,
      entity_id, request_id, result, metadata_json, occurred_at
    ) SELECT ?, ?, ?, ?, 'invoice.merged', 'invoice', ?, ?, 'success', ?, ${nowExpression}
      WHERE EXISTS (SELECT 1 FROM invoice_merges WHERE id=?)`).bind(
        crypto.randomUUID(), establishmentId, identity.userId, identity.role,
        mergedInvoiceId, requestId, JSON.stringify({
          mergeId,
          selectedInvoiceIds: selectedIds,
          originalInvoiceIds: leafIds,
          previousMergeIds,
          dueDate,
          totalCents,
        }), mergeId,
      ));

    const results = await d1.batch(statements);
    if ((results[0].meta.changes ?? 0) !== 1) {
      throw new HttpError(409, "invoice_merge_conflict", "Uma das faturas foi alterada. Atualize a página e tente novamente.");
    }
    return json({
      invoice: { id: mergedInvoiceId, invoiceNumber: number, accountId, totalCents, dueDate },
      mergeId,
      sourceInvoiceIds: leafIds,
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
