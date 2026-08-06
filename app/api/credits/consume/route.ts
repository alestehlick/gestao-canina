import { and, eq, sql } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  appointmentItems,
  appointments,
  creditMovements,
  creditReceipts,
  customerAccounts,
  dogs,
  serviceCatalog,
  tutors,
} from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
  requiredString,
} from "@/lib/server/http";
import { creditUnitsForServiceCode } from "@/lib/service-rules";

const creditServiceCodes = new Set([
  "daycare",
  "bath",
  "bath_grooming",
  "taxi_dog",
]);

function receiptNumber() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const stamp = ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)?.value)
    .join("");
  return `REC-${stamp}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "staff"]);
    const body = await readJsonObject(request);
    const appointmentItemId = requiredString(body, "appointmentItemId", 80);
    const establishmentId = identity.establishmentId!;
    const db = getDb();

    const [item] = await db
      .select({
        id: appointmentItems.id,
        itemStatus: appointmentItems.status,
        paymentPreference: appointmentItems.paymentPreference,
        settlementMethod: appointmentItems.settlementMethod,
        activeInvoiceId: appointmentItems.activeInvoiceId,
        appointmentId: appointments.id,
        appointmentStatus: appointments.status,
        accountId: appointments.accountId,
        dogId: appointments.dogId,
        serviceCatalogId: appointmentItems.serviceCatalogId,
        serviceCode: serviceCatalog.code,
        serviceName: appointmentItems.serviceNameSnapshot,
        description: appointmentItems.descriptionSnapshot,
        serviceDate: appointments.startDate,
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
      .innerJoin(
        serviceCatalog,
        eq(serviceCatalog.id, appointmentItems.serviceCatalogId),
      )
      .where(
        and(
          eq(appointmentItems.id, appointmentItemId),
          eq(appointments.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (!item) {
      throw new HttpError(
        404,
        "appointment_item_not_found",
        "O serviço agendado não foi encontrado.",
      );
    }

    if (item.settlementMethod === "credit") {
      const [existingReceipt] = await db
        .select()
        .from(creditReceipts)
        .where(eq(creditReceipts.appointmentItemId, appointmentItemId))
        .limit(1);
      return json({
        consumed: true,
        idempotent: true,
        receipt: existingReceipt ?? null,
      });
    }
    if (
      item.itemStatus !== "completed" ||
      item.appointmentStatus !== "completed"
    ) {
      throw new HttpError(
        409,
        "service_not_completed",
        "Conclua o atendimento antes de decidir usar créditos.",
      );
    }
    if (item.activeInvoiceId || item.settlementMethod === "invoice") {
      throw new HttpError(
        409,
        "service_already_invoiced",
        "Este serviço já está vinculado a uma fatura.",
      );
    }
    if (!creditServiceCodes.has(item.serviceCode)) {
      throw new HttpError(
        400,
        "service_not_credit_eligible",
        "Este serviço não pode ser pago com créditos.",
      );
    }

    const creditUnits = creditUnitsForServiceCode(
      item.serviceCode,
      item.description,
    );

    const contacts = await db
      .select({
        email: tutors.email,
        phoneE164: tutors.phoneE164,
        whatsappEnabled: tutors.whatsappEnabled,
        isFinancialContact: tutors.isFinancialContact,
      })
      .from(tutors)
      .where(
        and(
          eq(tutors.accountId, item.accountId),
          eq(tutors.status, "active"),
        ),
      );
    const channels = new Set<string>();
    for (const contact of contacts) {
      if (contact.email) channels.add("email");
      if (contact.phoneE164 && contact.whatsappEnabled) {
        channels.add("whatsapp");
      }
    }

    const movementId = crypto.randomUUID();
    const newReceiptId = crypto.randomUUID();
    const newReceiptNumber = receiptNumber();
    const idempotencyKey = `credit-consume:${appointmentItemId}`;
    const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
    const d1 = getD1Database();
    const results = await d1.batch([
      d1
        .prepare(
          `INSERT INTO credit_movements (
            id, establishment_id, account_id, dog_id, service_catalog_id,
            appointment_item_id, credit_purchase_id, reversed_movement_id,
            movement_type, delta_units, reason, idempotency_key, actor_user_id,
            occurred_at
          )
          SELECT ?, a.establishment_id, a.account_id, a.dog_id,
            ai.service_catalog_id, ai.id, NULL, NULL, 'consume', ?,
            'Serviço concluído com crédito pré-pago', ?, ?, ${nowExpression}
          FROM appointment_items ai
          INNER JOIN appointments a ON a.id = ai.appointment_id
          WHERE ai.id = ?
            AND a.establishment_id = ?
            AND ai.status = 'completed'
            AND a.status = 'completed'
            AND ai.settlement_method = 'unsettled'
            AND ai.active_invoice_id IS NULL
            AND (
              SELECT COALESCE(SUM(cm.delta_units), 0)
              FROM credit_movements cm
              WHERE cm.establishment_id = a.establishment_id
                AND cm.account_id = a.account_id
                AND cm.service_catalog_id = ai.service_catalog_id
            ) >= ?`,
        )
        .bind(
          movementId,
          -creditUnits,
          idempotencyKey,
          identity.userId,
          appointmentItemId,
          establishmentId,
          creditUnits,
        ),
      d1
        .prepare(
          `UPDATE appointment_items
          SET settlement_method = 'credit',
            credit_movement_id = ?,
            settled_at = ${nowExpression},
            updated_at = ${nowExpression}
          WHERE id = ?
            AND EXISTS (
              SELECT 1 FROM credit_movements WHERE id = ?
            )`,
        )
        .bind(movementId, appointmentItemId, movementId),
      d1
        .prepare(
          `INSERT INTO credit_receipts (
            id, establishment_id, account_id, dog_id, appointment_item_id,
            credit_movement_id, receipt_number, customer_name_snapshot,
            dog_name_snapshot, service_name_snapshot, service_date_snapshot,
            credit_units, delivery_status, delivery_channels_json, issued_at,
            created_at, updated_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?,
            ${nowExpression}, ${nowExpression}, ${nowExpression}
          WHERE EXISTS (
            SELECT 1 FROM credit_movements WHERE id = ?
          )`,
        )
        .bind(
          newReceiptId,
          establishmentId,
          item.accountId,
          item.dogId,
          appointmentItemId,
          movementId,
          newReceiptNumber,
          item.customerName,
          item.dogName,
          item.serviceName,
          item.serviceDate,
          creditUnits,
          JSON.stringify([...channels]),
          movementId,
        ),
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, result, metadata_json,
            occurred_at
          )
          SELECT ?, ?, ?, ?, 'credit.consumed', 'appointment_item', ?, ?,
            'success', ?, ${nowExpression}
          WHERE EXISTS (
            SELECT 1 FROM credit_movements WHERE id = ?
          )`,
        )
        .bind(
          crypto.randomUUID(),
          establishmentId,
          identity.userId,
          identity.role,
          appointmentItemId,
          requestId,
          JSON.stringify({
            movementId,
            receiptId: newReceiptId,
            serviceCatalogId: item.serviceCatalogId,
            accountId: item.accountId,
            creditUnits,
          }),
          movementId,
        ),
    ]);

    if ((results[0].meta.changes ?? 0) !== 1) {
      const [balance] = await db
        .select({
          value: sql<number>`coalesce(sum(${creditMovements.deltaUnits}), 0)`,
        })
        .from(creditMovements)
        .where(
          and(
            eq(creditMovements.establishmentId, establishmentId),
            eq(creditMovements.accountId, item.accountId),
            eq(
              creditMovements.serviceCatalogId,
              item.serviceCatalogId,
            ),
          ),
        );
      throw new HttpError(
        409,
        Number(balance?.value ?? 0) < creditUnits
          ? "insufficient_credits"
          : "service_settlement_conflict",
        Number(balance?.value ?? 0) < creditUnits
          ? `O cliente precisa de ${creditUnits} ${creditUnits === 1 ? "crédito" : "créditos"} disponível${creditUnits === 1 ? "" : "is"} para este serviço.`
          : "O pagamento deste serviço foi alterado por outra operação.",
      );
    }

    const [[receipt], [remaining]] = await Promise.all([
      db
        .select()
        .from(creditReceipts)
        .where(eq(creditReceipts.id, newReceiptId))
        .limit(1),
      db
        .select({
          value: sql<number>`coalesce(sum(${creditMovements.deltaUnits}), 0)`,
        })
        .from(creditMovements)
        .where(
          and(
            eq(creditMovements.establishmentId, establishmentId),
            eq(creditMovements.accountId, item.accountId),
            eq(
              creditMovements.serviceCatalogId,
              item.serviceCatalogId,
            ),
          ),
        ),
    ]);

    return json({
      consumed: true,
      idempotent: false,
      remainingUnits: Number(remaining?.value ?? 0),
      receipt,
      chargeCreated: false,
      nextAction: {
        type: "deliver_receipt",
        channels: [...channels],
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
