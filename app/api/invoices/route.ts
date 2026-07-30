import { and, eq, inArray } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  appointmentItems,
  appointments,
  customerAccounts,
  dogs,
  tutors,
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

function invoiceNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `FAT-${date}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const body = await readJsonObject(request);
    const rawIds = body.appointmentItemIds;
    if (
      !Array.isArray(rawIds) ||
      rawIds.length < 1 ||
      rawIds.length > 75 ||
      rawIds.some(
        (value) =>
          typeof value !== "string" || !value.trim() || value.length > 80,
      )
    ) {
      throw new HttpError(
        400,
        "invalid_appointment_items",
        "Selecione entre 1 e 75 serviços concluídos.",
      );
    }
    const appointmentItemIds = [...new Set(rawIds as string[])];
    if (appointmentItemIds.length !== rawIds.length) {
      throw new HttpError(
        400,
        "duplicate_appointment_item",
        "Um mesmo serviço não pode aparecer duas vezes na cobrança.",
      );
    }

    const dueDate =
      optionalString(body, "dueDate", 10) ?? todayInSaoPaulo();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      throw new HttpError(
        400,
        "invalid_due_date",
        "A data de vencimento é inválida.",
      );
    }

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const rows = await db
      .select({
        itemId: appointmentItems.id,
        appointmentId: appointments.id,
        accountId: appointments.accountId,
        serviceDate: appointments.startDate,
        appointmentStatus: appointments.status,
        itemStatus: appointmentItems.status,
        paymentPreference: appointmentItems.paymentPreference,
        settlementMethod: appointmentItems.settlementMethod,
        activeInvoiceId: appointmentItems.activeInvoiceId,
        serviceName: appointmentItems.serviceNameSnapshot,
        description: appointmentItems.descriptionSnapshot,
        amountCents: appointmentItems.totalCents,
        dogName: dogs.name,
        customerName: customerAccounts.displayName,
      })
      .from(appointmentItems)
      .innerJoin(
        appointments,
        eq(appointments.id, appointmentItems.appointmentId),
      )
      .innerJoin(dogs, eq(dogs.id, appointments.dogId))
      .innerJoin(
        customerAccounts,
        eq(customerAccounts.id, appointments.accountId),
      )
      .where(
        and(
          eq(appointments.establishmentId, establishmentId),
          inArray(appointmentItems.id, appointmentItemIds),
        ),
      );

    if (rows.length !== appointmentItemIds.length) {
      throw new HttpError(
        404,
        "appointment_item_not_found",
        "Um dos serviços selecionados não foi encontrado.",
      );
    }
    const accountId = rows[0].accountId;
    if (rows.some((row) => row.accountId !== accountId)) {
      throw new HttpError(
        400,
        "mixed_customers",
        "Crie uma cobrança separada para cada cliente.",
      );
    }
    if (
      rows.some(
        (row) =>
          row.appointmentStatus !== "completed" ||
          row.itemStatus !== "completed",
      )
    ) {
      throw new HttpError(
        409,
        "service_not_completed",
        "Somente serviços concluídos podem ser cobrados.",
      );
    }
    if (
      rows.some(
        (row) =>
          row.paymentPreference !== "invoice" ||
          row.settlementMethod !== "unsettled",
      )
    ) {
      throw new HttpError(
        409,
        "service_not_available_for_invoice",
        "Um dos serviços já foi pago ou está configurado para usar crédito.",
      );
    }
    if (rows.some((row) => row.activeInvoiceId)) {
      throw new HttpError(
        409,
        "service_already_invoiced",
        "Um dos serviços já pertence a outra cobrança.",
      );
    }

    const totalCents = rows.reduce(
      (total, row) => total + Math.max(0, row.amountCents),
      0,
    );
    if (totalCents < 1) {
      throw new HttpError(
        400,
        "invoice_total_invalid",
        "O valor total da cobrança precisa ser maior que zero.",
      );
    }

    const [financialContact] = await db
      .select({ email: tutors.email })
      .from(tutors)
      .where(
        and(
          eq(tutors.accountId, accountId),
          eq(tutors.status, "active"),
          eq(tutors.isFinancialContact, true),
        ),
      )
      .limit(1);

    const invoiceId = crypto.randomUUID();
    const number = invoiceNumber();
    const now = new Date().toISOString();
    const placeholders = appointmentItemIds.map(() => "?").join(", ");
    const d1 = getD1Database();
    const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
    const results = await d1.batch([
      d1
        .prepare(
          `UPDATE appointment_items
          SET active_invoice_id = ?, updated_at = ${nowExpression}
          WHERE id IN (${placeholders})
            AND status = 'completed'
            AND payment_preference = 'invoice'
            AND settlement_method = 'unsettled'
            AND active_invoice_id IS NULL
            AND EXISTS (
              SELECT 1
              FROM appointments a
              WHERE a.id = appointment_items.appointment_id
                AND a.establishment_id = ?
                AND a.status = 'completed'
            )`,
        )
        .bind(invoiceId, ...appointmentItemIds, establishmentId),
      d1
        .prepare(
          `INSERT INTO invoices (
            id, establishment_id, account_id, invoice_number,
            recipient_name_snapshot, recipient_email_snapshot, status,
            issued_at, due_date, total_cents, source_type, source_id,
            created_by_user_id
          )
          SELECT ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, 'services', ?, ?
          WHERE (
            SELECT COUNT(*)
            FROM appointment_items ai
            INNER JOIN appointments a ON a.id = ai.appointment_id
            WHERE ai.id IN (${placeholders})
              AND ai.active_invoice_id = ?
              AND a.establishment_id = ?
              AND a.account_id = ?
          ) = ?`,
        )
        .bind(
          invoiceId,
          establishmentId,
          accountId,
          number,
          rows[0].customerName,
          financialContact?.email ?? null,
          now,
          dueDate,
          totalCents,
          invoiceId,
          identity.userId,
          ...appointmentItemIds,
          invoiceId,
          establishmentId,
          accountId,
          appointmentItemIds.length,
        ),
      ...rows.map((row) =>
        d1
          .prepare(
            `INSERT INTO invoice_items (
              id, invoice_id, appointment_item_id, dog_name_snapshot,
              service_name_snapshot, service_date_snapshot,
              description_snapshot, amount_cents
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (
              SELECT 1
              FROM invoices
              WHERE id = ? AND establishment_id = ?
            )`,
          )
          .bind(
            crypto.randomUUID(),
            invoiceId,
            row.itemId,
            row.dogName,
            row.serviceName,
            row.serviceDate,
            row.description || `${row.serviceName} de ${row.dogName}`,
            row.amountCents,
            invoiceId,
            establishmentId,
          ),
      ),
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, result, metadata_json,
            occurred_at
          )
          SELECT ?, ?, ?, ?, 'invoice.created', 'invoice', ?, ?,
            'success', ?, ${nowExpression}
          WHERE EXISTS (
            SELECT 1
            FROM invoices
            WHERE id = ? AND establishment_id = ?
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
            accountId,
            appointmentItemIds,
            totalCents,
          }),
          invoiceId,
          establishmentId,
        ),
      d1
        .prepare(
          `UPDATE appointment_items
          SET active_invoice_id = NULL, updated_at = ${nowExpression}
          WHERE active_invoice_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM invoices WHERE id = ?
            )`,
        )
        .bind(invoiceId, invoiceId),
    ]);

    if (
      (results[0].meta.changes ?? 0) !== appointmentItemIds.length ||
      (results[1].meta.changes ?? 0) !== 1
    ) {
      throw new HttpError(
        409,
        "service_already_invoiced",
        "Um dos serviços foi alterado ou já pertence a outra cobrança. Atualize a página e tente novamente.",
      );
    }

    return json(
      {
        invoice: {
          id: invoiceId,
          invoiceNumber: number,
          accountId,
          customerName: rows[0].customerName,
          status: "issued",
          dueDate,
          totalCents,
          sourceType: "services",
          items: rows.map((row) => ({
            dogNameSnapshot: row.dogName,
            serviceNameSnapshot: row.serviceName,
            serviceDateSnapshot: row.serviceDate,
            descriptionSnapshot:
              row.description || `${row.serviceName} de ${row.dogName}`,
            amountCents: row.amountCents,
          })),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
