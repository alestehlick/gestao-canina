import { and, eq, inArray } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
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
    if (!id || id.length > 80) {
      throw new HttpError(400, "invalid_invoice_id", "A fatura informada é inválida.");
    }

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [merge] = await db
      .select({
        id: invoiceMerges.id,
        mergedInvoiceId: invoiceMerges.mergedInvoiceId,
        status: invoiceMerges.status,
        invoiceNumber: invoices.invoiceNumber,
        invoiceStatus: invoices.status,
      })
      .from(invoiceMerges)
      .innerJoin(invoices, eq(invoices.id, invoiceMerges.mergedInvoiceId))
      .where(
        and(
          eq(invoiceMerges.mergedInvoiceId, id),
          eq(invoiceMerges.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (!merge) {
      throw new HttpError(
        404,
        "invoice_merge_not_found",
        "Esta fatura não corresponde a uma união ativa.",
      );
    }
    if (merge.status === "reversed") {
      return json({ reversed: true, idempotent: true });
    }
    if (!["draft", "issued"].includes(merge.invoiceStatus)) {
      throw new HttpError(
        409,
        "merged_invoice_not_open",
        "Uma fatura unificada paga ou cancelada não pode ser desfeita.",
      );
    }

    const [payments, settlements, members] = await Promise.all([
      db
        .select({ id: invoicePayments.id })
        .from(invoicePayments)
        .where(eq(invoicePayments.invoiceId, id)),
      db
        .select({ id: invoiceSettlements.id })
        .from(invoiceSettlements)
        .where(
          and(
            eq(invoiceSettlements.invoiceId, id),
            eq(invoiceSettlements.status, "scheduled"),
          ),
        ),
      db
        .select({ sourceInvoiceId: invoiceMergeMembers.sourceInvoiceId })
        .from(invoiceMergeMembers)
        .where(eq(invoiceMergeMembers.mergeId, merge.id)),
    ]);
    if (payments.length || settlements.length) {
      throw new HttpError(
        409,
        "merged_invoice_has_financial_movement",
        "Remova o pagamento ou a compensação da fatura unificada antes de desfazer a união.",
      );
    }
    if (members.length < 2) {
      throw new HttpError(
        409,
        "invoice_merge_incomplete",
        "O histórico desta união está incompleto e precisa de revisão administrativa.",
      );
    }
    const sourceInvoices = await db
      .select({ id: invoices.id, status: invoices.status })
      .from(invoices)
      .where(
        and(
          eq(invoices.establishmentId, establishmentId),
          inArray(invoices.id, members.map((member) => member.sourceInvoiceId)),
        ),
      );
    if (
      sourceInvoices.length !== members.length ||
      sourceInvoices.some((invoice) => invoice.status !== "void")
    ) {
      throw new HttpError(
        409,
        "invoice_merge_sources_changed",
        "Uma fatura original foi alterada e a união não pode ser desfeita automaticamente.",
      );
    }

    const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
    const d1 = getD1Database();
    const results = await d1.batch([
      d1
        .prepare(
          `UPDATE invoices
          SET status = 'void', voided_at = ${nowExpression},
            void_reason = 'União desfeita; faturas originais restauradas',
            updated_at = ${nowExpression}
          WHERE id = ? AND establishment_id = ? AND status IN ('draft', 'issued')
            AND NOT EXISTS (SELECT 1 FROM invoice_payments WHERE invoice_id = ?)
            AND NOT EXISTS (
              SELECT 1 FROM invoice_settlements
              WHERE invoice_id = ? AND status = 'scheduled'
            )`,
        )
        .bind(id, establishmentId, id, id),
      d1
        .prepare(
          `UPDATE invoices
          SET status = (
              SELECT imm.original_status FROM invoice_merge_members imm
              WHERE imm.merge_id = ? AND imm.source_invoice_id = invoices.id
            ),
            source_id = (
              SELECT imm.original_source_id FROM invoice_merge_members imm
              WHERE imm.merge_id = ? AND imm.source_invoice_id = invoices.id
            ),
            voided_at = NULL, void_reason = NULL, updated_at = ${nowExpression}
          WHERE id IN (
            SELECT source_invoice_id FROM invoice_merge_members WHERE merge_id = ?
          ) AND status = 'void'
            AND EXISTS (SELECT 1 FROM invoices merged WHERE merged.id = ? AND merged.status = 'void')`,
        )
        .bind(merge.id, merge.id, merge.id, id),
      d1
        .prepare(
          `UPDATE appointment_items
          SET active_invoice_id = (
              SELECT ii.invoice_id
              FROM invoice_items ii
              INNER JOIN invoice_merge_members imm
                ON imm.source_invoice_id = ii.invoice_id
              WHERE imm.merge_id = ?
                AND ii.appointment_item_id = appointment_items.id
              LIMIT 1
            ),
            updated_at = ${nowExpression}
          WHERE active_invoice_id = ?
            AND EXISTS (SELECT 1 FROM invoices WHERE id = ? AND status = 'void')`,
        )
        .bind(merge.id, id, id),
      d1
        .prepare(
          `UPDATE invoice_merges
          SET status = 'reversed', reversed_by_user_id = ?,
            reversed_at = ${nowExpression}
          WHERE id = ? AND status = 'active'
            AND EXISTS (SELECT 1 FROM invoices WHERE id = ? AND status = 'void')`,
        )
        .bind(identity.userId, merge.id, id),
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, result, metadata_json,
            occurred_at
          )
          SELECT ?, ?, ?, ?, 'invoice.merge_reversed', 'invoice', ?, ?,
            'success', ?, ${nowExpression}
          WHERE EXISTS (
            SELECT 1 FROM invoice_merges WHERE id = ? AND status = 'reversed'
          )`,
        )
        .bind(
          crypto.randomUUID(),
          establishmentId,
          identity.userId,
          identity.role,
          id,
          requestId,
          JSON.stringify({
            mergeId: merge.id,
            mergedInvoiceNumber: merge.invoiceNumber,
            restoredInvoiceIds: members.map((member) => member.sourceInvoiceId),
          }),
          merge.id,
        ),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) {
      throw new HttpError(
        409,
        "invoice_unmerge_conflict",
        "A fatura foi alterada. Atualize a página e tente novamente.",
      );
    }

    return json({
      reversed: true,
      idempotent: false,
      restoredInvoiceIds: members.map((member) => member.sourceInvoiceId),
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
