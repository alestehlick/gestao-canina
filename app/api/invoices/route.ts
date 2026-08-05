import { and, eq, inArray } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  appointmentItems,
  appointments,
  customerAccounts,
  dogs,
  invoiceItems,
  invoices,
  serviceCatalog,
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
  const date = todayInSaoPaulo().replaceAll("-", "");
  return `FAT-${date}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
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

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const body = await readJsonObject(request);
    const rawEntries = body.billingEntries;
    if (
      !Array.isArray(rawEntries) ||
      rawEntries.length < 1 ||
      rawEntries.length > 75 ||
      rawEntries.some(
        (value) =>
          !value ||
          typeof value !== "object" ||
          typeof value.appointmentItemId !== "string" ||
          !value.appointmentItemId.trim() ||
          value.appointmentItemId.length > 80 ||
          !["service", "lodging_deposit", "lodging_balance"].includes(
            value.kind,
          ),
      )
    ) {
      throw new HttpError(
        400,
        "invalid_appointment_items",
        "Selecione entre 1 e 75 serviços concluídos.",
      );
    }
    const billingEntries = rawEntries as Array<{
      appointmentItemId: string;
      kind: "service" | "lodging_deposit" | "lodging_balance";
    }>;
    const appointmentItemIds = [
      ...new Set(billingEntries.map((entry) => entry.appointmentItemId)),
    ];
    if (appointmentItemIds.length !== billingEntries.length) {
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
        serviceCode: serviceCatalog.code,
        serviceName: appointmentItems.serviceNameSnapshot,
        description: appointmentItems.descriptionSnapshot,
        amountCents: appointmentItems.totalCents,
        startDate: appointments.startDate,
        endDate: appointments.endDate,
        lodgingNights: appointments.lodgingNights,
        depositPercent: appointments.depositPercent,
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
        serviceCatalog,
        eq(serviceCatalog.id, appointmentItems.serviceCatalogId),
      )
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
    const entryByItemId = new Map(
      billingEntries.map((entry) => [entry.appointmentItemId, entry.kind]),
    );
    const selectedRows = rows.map((row) => ({
      ...row,
      billingKind: entryByItemId.get(row.itemId)!,
    }));
    const accountId = rows[0].accountId;
    if (rows.some((row) => row.accountId !== accountId)) {
      throw new HttpError(
        400,
        "mixed_customers",
        "Crie uma cobrança separada para cada cliente.",
      );
    }
    if (
      selectedRows.some(
        (row) =>
          row.billingKind === "lodging_deposit"
            ? row.serviceCode !== "hotel" ||
              !["confirmed", "present", "in_service", "completed"].includes(
                row.appointmentStatus,
              ) ||
              !row.depositPercent ||
              row.depositPercent <= 0 ||
              row.depositPercent >= 100
            : row.appointmentStatus !== "completed" ||
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
    if (
      selectedRows.some(
        (row) =>
          row.billingKind !== "lodging_deposit" && row.activeInvoiceId,
      )
    ) {
      throw new HttpError(
        409,
        "service_already_invoiced",
        "Um dos serviços já pertence a outra cobrança.",
      );
    }

    if (
      selectedRows.some(
        (row) =>
          row.billingKind.startsWith("lodging_") &&
          row.serviceCode !== "hotel",
      )
    ) {
      throw new HttpError(
        400,
        "invalid_lodging_entry",
        "Uma das etapas de hospedagem selecionadas é inválida.",
      );
    }

    const lodgingAppointmentIds = selectedRows
      .filter((row) => row.serviceCode === "hotel")
      .map((row) => row.appointmentId);
    const depositInvoices = lodgingAppointmentIds.length
      ? await db
          .select()
          .from(invoices)
          .where(
            and(
              eq(invoices.establishmentId, establishmentId),
              eq(invoices.sourceType, "lodging_deposit"),
              inArray(invoices.sourceId, lodgingAppointmentIds),
            ),
          )
      : [];
    const depositByAppointment = new Map<
      string,
      { status: "draft" | "issued" | "paid" | "void"; totalCents: number }
    >(
      depositInvoices
        .filter((invoice) => invoice.sourceId && invoice.status !== "void")
        .map((invoice) => [invoice.sourceId!, invoice]),
    );
    const combinedDepositRows = await db
      .select({
        appointmentItemId: invoiceItems.appointmentItemId,
        status: invoices.status,
        totalCents: invoiceItems.amountCents,
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
      .where(
        and(
          eq(invoices.establishmentId, establishmentId),
          inArray(invoiceItems.appointmentItemId, appointmentItemIds),
          eq(invoiceItems.serviceNameSnapshot, "Sinal da hospedagem"),
        ),
      );
    const appointmentByItemId = new Map(
      selectedRows.map((row) => [row.itemId, row.appointmentId]),
    );
    for (const deposit of combinedDepositRows) {
      const appointmentId = appointmentByItemId.get(deposit.appointmentItemId);
      if (appointmentId && deposit.status !== "void") {
        depositByAppointment.set(appointmentId, deposit);
      }
    }

    const duplicateDeposit = selectedRows.find(
      (row) =>
        row.billingKind === "lodging_deposit" &&
        depositByAppointment.has(row.appointmentId),
    );
    if (duplicateDeposit) {
      throw new HttpError(
        409,
        "lodging_deposit_already_invoiced",
        `O sinal da hospedagem de ${duplicateDeposit.dogName} já pertence a uma fatura.`,
      );
    }

    const pendingDeposit = selectedRows.find(
      (row) =>
        row.billingKind === "lodging_balance" &&
        depositByAppointment.get(row.appointmentId)?.status === "issued",
    );
    if (pendingDeposit) {
      throw new HttpError(
        409,
        "lodging_deposit_pending",
        `Registre o pagamento ou cancele a fatura do sinal da hospedagem de ${pendingDeposit.dogName} antes de incluí-la em outra fatura.`,
      );
    }
    const missingRequiredDeposit = selectedRows.find(
      (row) =>
        row.billingKind === "lodging_balance" &&
        Boolean(row.depositPercent) &&
        !depositByAppointment.has(row.appointmentId),
    );
    if (missingRequiredDeposit) {
      throw new HttpError(
        409,
        "lodging_deposit_required",
        `Fature e registre o sinal da hospedagem de ${missingRequiredDeposit.dogName} antes de cobrar o saldo.`,
      );
    }

    const effectiveRows = selectedRows.map((row) => {
      if (row.billingKind === "service") {
        return {
          ...row,
          invoiceAmountCents: row.amountCents,
          invoiceServiceName: row.serviceName,
          invoiceDescription:
            row.description || `${row.serviceName} de ${row.dogName}`,
        };
      }
      if (row.billingKind === "lodging_deposit") {
        const percent = row.depositPercent!;
        return {
          ...row,
          invoiceAmountCents: Math.round((row.amountCents * percent) / 100),
          invoiceServiceName: "Sinal da hospedagem",
          invoiceDescription: `Sinal de ${percent}% da hospedagem de ${row.dogName}, ${row.startDate} a ${row.endDate}`,
        };
      }
      const depositInvoice = depositByAppointment.get(row.appointmentId);
      const paidDepositCents =
        depositInvoice?.status === "paid" ? depositInvoice.totalCents : 0;
      const invoiceAmountCents = Math.max(0, row.amountCents - paidDepositCents);
      const period = `${row.startDate} a ${row.endDate}`;
      return {
        ...row,
        invoiceAmountCents,
        invoiceServiceName:
          paidDepositCents > 0 ? "Saldo da hospedagem" : row.serviceName,
        invoiceDescription:
          paidDepositCents > 0
            ? `Saldo da hospedagem de ${row.dogName}, ${period}, com sinal já abatido`
            : `Hospedagem de ${row.dogName}, ${period}, ${row.lodgingNights ?? 0} diárias`,
      };
    });

    const totalCents = effectiveRows.reduce(
      (total, row) => total + Math.max(0, row.invoiceAmountCents),
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
    const d1 = getD1Database();
    const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
    const lockedItemIds = selectedRows
      .filter((row) => row.billingKind !== "lodging_deposit")
      .map((row) => row.itemId);
    const depositItemIds = selectedRows
      .filter((row) => row.billingKind === "lodging_deposit")
      .map((row) => row.itemId);
    const lockedPlaceholders = lockedItemIds.map(() => "?").join(", ");
    const depositPlaceholders = depositItemIds.map(() => "?").join(", ");
    const statements: ReturnType<typeof d1.prepare>[] = [];
    let lockResultIndex: number | null = null;

    if (lockedItemIds.length) {
      lockResultIndex = statements.length;
      statements.push(
        d1
        .prepare(
          `UPDATE appointment_items
          SET active_invoice_id = ?, updated_at = ${nowExpression}
          WHERE id IN (${lockedPlaceholders})
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
        .bind(invoiceId, ...lockedItemIds, establishmentId),
      );
    }

    const lockCondition = lockedItemIds.length
      ? `(SELECT COUNT(*)
          FROM appointment_items ai
          INNER JOIN appointments a ON a.id = ai.appointment_id
          WHERE ai.id IN (${lockedPlaceholders})
            AND ai.active_invoice_id = ?
            AND a.establishment_id = ?
            AND a.account_id = ?) = ?`
      : "1 = 1";
    const depositCondition = depositItemIds.length
      ? `AND NOT EXISTS (
          SELECT 1
          FROM invoice_items existing_item
          INNER JOIN invoices existing_invoice
            ON existing_invoice.id = existing_item.invoice_id
          WHERE existing_item.appointment_item_id IN (${depositPlaceholders})
            AND existing_item.service_name_snapshot = 'Sinal da hospedagem'
            AND existing_invoice.status <> 'void'
        )`
      : "";
    const invoiceResultIndex = statements.length;
    statements.push(
      d1
        .prepare(
          `INSERT INTO invoices (
            id, establishment_id, account_id, invoice_number,
            recipient_name_snapshot, recipient_email_snapshot, status,
            issued_at, due_date, total_cents, source_type, source_id,
            created_by_user_id
          )
          SELECT ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, 'services', ?, ?
          WHERE ${lockCondition}
          ${depositCondition}`,
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
          ...(lockedItemIds.length
            ? [
                ...lockedItemIds,
                invoiceId,
                establishmentId,
                accountId,
                lockedItemIds.length,
              ]
            : []),
          ...depositItemIds,
        ),
      ...effectiveRows.map((row) =>
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
            row.invoiceServiceName,
            row.serviceDate,
            row.invoiceDescription,
            row.invoiceAmountCents,
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
    );
    const results = await d1.batch(statements);

    if (
      (lockResultIndex !== null &&
        (results[lockResultIndex].meta.changes ?? 0) !==
          lockedItemIds.length) ||
      (results[invoiceResultIndex].meta.changes ?? 0) !== 1
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
          items: effectiveRows.map((row) => ({
            dogNameSnapshot: row.dogName,
            serviceNameSnapshot: row.invoiceServiceName,
            serviceDateSnapshot: row.serviceDate,
            descriptionSnapshot: row.invoiceDescription,
            amountCents: row.invoiceAmountCents,
            lodging:
              row.serviceCode === "hotel" && row.lodgingNights !== null
                ? {
                    checkInDate: row.startDate,
                    checkOutDate: row.endDate,
                    nights: row.lodgingNights,
                  }
                : null,
          })),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
