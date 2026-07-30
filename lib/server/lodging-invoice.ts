import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  appointmentItems,
  appointments,
  customerAccounts,
  dogs,
  invoices,
  serviceCatalog,
  tutors,
} from "@/db/schema";
import type { Identity } from "@/lib/server/auth";
import { HttpError } from "@/lib/server/http";

export type LodgingInvoiceKind = "deposit" | "balance";

function invoiceNumber(kind: LodgingInvoiceKind) {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const prefix = kind === "deposit" ? "FAT-SIN" : "FAT-SAL";
  return `${prefix}-${stamp}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function createLodgingInvoice(input: {
  appointmentId: string;
  kind: LodgingInvoiceKind;
  identity: Identity;
  requestId: string;
  dueDate?: string | null;
}) {
  const { appointmentId, kind, identity, requestId } = input;
  const establishmentId = identity.establishmentId!;
  const dueDate = input.dueDate ?? todayInSaoPaulo();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new HttpError(
      400,
      "invalid_due_date",
      "A data de vencimento é inválida.",
    );
  }

  const db = getDb();
  const [lodging] = await db
    .select({
      appointmentId: appointments.id,
      accountId: appointments.accountId,
      startDate: appointments.startDate,
      endDate: appointments.endDate,
      lodgingNights: appointments.lodgingNights,
      depositPercent: appointments.depositPercent,
      appointmentStatus: appointments.status,
      itemId: appointmentItems.id,
      itemStatus: appointmentItems.status,
      settlementMethod: appointmentItems.settlementMethod,
      activeInvoiceId: appointmentItems.activeInvoiceId,
      totalCents: appointmentItems.totalCents,
      dogName: dogs.name,
      customerName: customerAccounts.displayName,
    })
    .from(appointments)
    .innerJoin(
      appointmentItems,
      eq(appointmentItems.appointmentId, appointments.id),
    )
    .innerJoin(
      serviceCatalog,
      eq(serviceCatalog.id, appointmentItems.serviceCatalogId),
    )
    .innerJoin(dogs, eq(dogs.id, appointments.dogId))
    .innerJoin(
      customerAccounts,
      eq(customerAccounts.id, appointments.accountId),
    )
    .where(
      and(
        eq(appointments.id, appointmentId),
        eq(appointments.establishmentId, establishmentId),
        eq(serviceCatalog.code, "hotel"),
      ),
    )
    .limit(1);
  if (!lodging) {
    throw new HttpError(
      404,
      "lodging_not_found",
      "A hospedagem não foi encontrada.",
    );
  }

  const [existing] = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.establishmentId, establishmentId),
        eq(
          invoices.sourceType,
          kind === "deposit" ? "lodging_deposit" : "lodging_balance",
        ),
        eq(invoices.sourceId, appointmentId),
      ),
    )
    .limit(1);
  if (existing && existing.status !== "void") {
    return { invoice: existing, idempotent: true };
  }
  if (existing?.status === "void") {
    throw new HttpError(
      409,
      "lodging_invoice_was_voided",
      "Esta etapa já teve uma fatura cancelada. Crie uma nova hospedagem ou peça suporte para corrigir o histórico.",
    );
  }

  let amountCents: number;
  let serviceName: string;
  let description: string;
  if (kind === "deposit") {
    if (
      !["confirmed", "present", "in_service"].includes(
        lodging.appointmentStatus,
      )
    ) {
      throw new HttpError(
        409,
        "lodging_not_confirmed",
        "Confirme a hospedagem antes de gerar a fatura do sinal.",
      );
    }
    const percent = lodging.depositPercent;
    if (!percent || percent <= 0 || percent >= 100) {
      throw new HttpError(
        409,
        "deposit_not_configured",
        "Esta hospedagem não possui sinal configurado.",
      );
    }
    amountCents = Math.round((lodging.totalCents * percent) / 100);
    serviceName = "Sinal da hospedagem";
    description = `Sinal de ${percent}% da hospedagem de ${lodging.dogName}, de ${lodging.startDate} a ${lodging.endDate}`;
  } else {
    if (lodging.appointmentStatus !== "completed") {
      throw new HttpError(
        409,
        "lodging_not_completed",
        "Faça o checkout e conclua a hospedagem antes de gerar a fatura do saldo.",
      );
    }
    if (lodging.settlementMethod !== "unsettled") {
      throw new HttpError(
        409,
        "lodging_already_paid",
        "Esta hospedagem já está marcada como paga.",
      );
    }
    const [depositInvoice] = await db
      .select()
      .from(invoices)
      .where(
        and(
          eq(invoices.establishmentId, establishmentId),
          eq(invoices.sourceType, "lodging_deposit"),
          eq(invoices.sourceId, appointmentId),
        ),
      )
      .limit(1);
    if (depositInvoice?.status === "issued") {
      throw new HttpError(
        409,
        "deposit_payment_pending",
        "Registre o pagamento do sinal ou cancele essa fatura antes de gerar o saldo.",
      );
    }
    const depositPaidCents =
      depositInvoice?.status === "paid" ? depositInvoice.totalCents : 0;
    amountCents = lodging.totalCents - depositPaidCents;
    if (amountCents < 1) {
      throw new HttpError(
        409,
        "lodging_has_no_balance",
        "Não há saldo restante para esta hospedagem.",
      );
    }
    serviceName = "Saldo da hospedagem";
    description = `Saldo da hospedagem de ${lodging.dogName}, de ${lodging.startDate} a ${lodging.endDate}${
      depositPaidCents > 0
        ? `, com sinal de R$ ${(depositPaidCents / 100).toFixed(2).replace(".", ",")} já abatido`
        : ""
    }`;
  }

  const [financialContact] = await db
    .select({ email: tutors.email })
    .from(tutors)
    .where(
      and(
        eq(tutors.accountId, lodging.accountId),
        eq(tutors.status, "active"),
        eq(tutors.isFinancialContact, true),
      ),
    )
    .limit(1);

  const invoiceId = crypto.randomUUID();
  const number = invoiceNumber(kind);
  const now = new Date().toISOString();
  const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
  const sourceType =
    kind === "deposit" ? "lodging_deposit" : "lodging_balance";
  const d1 = getD1Database();
  const statements = [];

  if (kind === "balance") {
    statements.push(
      d1
        .prepare(
          `UPDATE appointment_items
          SET active_invoice_id = ?, updated_at = ${nowExpression}
          WHERE id = ? AND settlement_method = 'unsettled'
            AND active_invoice_id IS NULL`,
        )
        .bind(invoiceId, lodging.itemId),
    );
  }

  statements.push(
    d1
      .prepare(
        `INSERT INTO invoices (
          id, establishment_id, account_id, invoice_number,
          recipient_name_snapshot, recipient_email_snapshot, status,
          issued_at, due_date, total_cents, source_type, source_id,
          created_by_user_id
        )
        SELECT ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM invoices
          WHERE establishment_id = ? AND source_type = ? AND source_id = ?
        )
        ${kind === "balance" ? "AND EXISTS (SELECT 1 FROM appointment_items WHERE id = ? AND active_invoice_id = ?)" : ""}`,
      )
      .bind(
        invoiceId,
        establishmentId,
        lodging.accountId,
        number,
        lodging.customerName,
        financialContact?.email ?? null,
        now,
        dueDate,
        amountCents,
        sourceType,
        appointmentId,
        identity.userId,
        establishmentId,
        sourceType,
        appointmentId,
        ...(kind === "balance" ? [lodging.itemId, invoiceId] : []),
      ),
    d1
      .prepare(
        `INSERT INTO invoice_items (
          id, invoice_id, appointment_item_id, dog_name_snapshot,
          service_name_snapshot, service_date_snapshot,
          description_snapshot, amount_cents
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM invoices WHERE id = ? AND establishment_id = ?
        )`,
      )
      .bind(
        crypto.randomUUID(),
        invoiceId,
        lodging.itemId,
        lodging.dogName,
        serviceName,
        lodging.startDate,
        description,
        amountCents,
        invoiceId,
        establishmentId,
      ),
    d1
      .prepare(
        `INSERT INTO audit_events (
          id, establishment_id, actor_user_id, actor_role, action,
          entity_type, entity_id, request_id, result, metadata_json,
          occurred_at
        )
        SELECT ?, ?, ?, ?, 'invoice.created', 'invoice', ?, ?, 'success', ?,
          ${nowExpression}
        WHERE EXISTS (
          SELECT 1 FROM invoices WHERE id = ? AND establishment_id = ?
        )`,
      )
      .bind(
        crypto.randomUUID(),
        establishmentId,
        identity.userId,
        identity.role,
        invoiceId,
        requestId,
        JSON.stringify({ appointmentId, sourceType, amountCents }),
        invoiceId,
        establishmentId,
      ),
  );
  if (kind === "balance") {
    statements.push(
      d1
        .prepare(
          `UPDATE appointment_items
          SET active_invoice_id = NULL, updated_at = ${nowExpression}
          WHERE id = ? AND active_invoice_id = ?
            AND NOT EXISTS (SELECT 1 FROM invoices WHERE id = ?)`,
        )
        .bind(lodging.itemId, invoiceId, invoiceId),
    );
  }

  const results = await d1.batch(statements);
  const invoiceResultIndex = kind === "balance" ? 1 : 0;
  if ((results[invoiceResultIndex].meta.changes ?? 0) !== 1) {
    throw new HttpError(
      409,
      "lodging_invoice_conflict",
      "A hospedagem foi alterada ou esta fatura já existe. Atualize a página e tente novamente.",
    );
  }

  return {
    invoice: {
      id: invoiceId,
      establishmentId,
      accountId: lodging.accountId,
      invoiceNumber: number,
      recipientNameSnapshot: lodging.customerName,
      recipientEmailSnapshot: financialContact?.email ?? null,
      status: "issued" as const,
      issuedAt: now,
      dueDate,
      totalCents: amountCents,
      sourceType,
      sourceId: appointmentId,
      voidedAt: null,
      voidReason: null,
      createdByUserId: identity.userId,
      createdAt: now,
      updatedAt: now,
      items: [
        {
          dogNameSnapshot: lodging.dogName,
          serviceNameSnapshot: serviceName,
          serviceDateSnapshot: lodging.startDate,
          descriptionSnapshot: description,
          amountCents,
        },
      ],
    },
    idempotent: false,
  };
}
