import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  appointmentItems,
  appointments,
  customerAccounts,
  dogs,
  serviceCatalog,
} from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
  requiredInteger,
} from "@/lib/server/http";

const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const { id } = await context.params;
    if (!id || id.length > 80) {
      throw new HttpError(400, "invalid_appointment_item", "O serviço informado é inválido.");
    }
    const body = await readJsonObject(request);
    const amountCents = requiredInteger(body, "amountCents", {
      min: 1,
      max: 100_000_000,
    });
    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [item] = await db
      .select({
        id: appointmentItems.id,
        previousAmountCents: appointmentItems.totalCents,
        appointmentId: appointments.id,
        appointmentStatus: appointments.status,
        depositPercent: appointments.depositPercent,
        itemStatus: appointmentItems.status,
        activeInvoiceId: appointmentItems.activeInvoiceId,
        settlementMethod: appointmentItems.settlementMethod,
        dogName: dogs.name,
        customerName: customerAccounts.displayName,
        serviceName: serviceCatalog.name,
        serviceCode: serviceCatalog.code,
      })
      .from(appointmentItems)
      .innerJoin(appointments, eq(appointments.id, appointmentItems.appointmentId))
      .innerJoin(dogs, eq(dogs.id, appointments.dogId))
      .innerJoin(customerAccounts, eq(customerAccounts.id, appointments.accountId))
      .innerJoin(serviceCatalog, eq(serviceCatalog.id, appointmentItems.serviceCatalogId))
      .where(and(
        eq(appointmentItems.id, id),
        eq(appointments.establishmentId, establishmentId),
      ))
      .limit(1);
    if (!item) {
      throw new HttpError(404, "appointment_item_not_found", "O serviço concluído não foi encontrado.");
    }
    const isLodgingDeposit = body.billingKind === "lodging_deposit";
    const operationallyReady = isLodgingDeposit
      ? item.serviceCode === "hotel" &&
        ["confirmed", "completed"].includes(item.appointmentStatus) &&
        ["scheduled", "completed"].includes(item.itemStatus) &&
        Boolean(item.depositPercent && item.depositPercent > 0 && item.depositPercent < 100)
      : item.appointmentStatus === "completed" && item.itemStatus === "completed";
    if (
      !operationallyReady ||
      item.activeInvoiceId ||
      item.settlementMethod !== "unsettled"
    ) {
      throw new HttpError(
        409,
        "billing_item_locked",
        "Este serviço não está disponível para definir uma cobrança regular.",
      );
    }

    const d1 = getD1Database();
    const results = await d1.batch([
      d1.prepare(
        `UPDATE appointment_items
         SET unit_price_cents = ?, total_cents = ?, payment_preference = 'invoice',
           updated_at = ${nowExpression}
         WHERE id = ? AND active_invoice_id IS NULL
           AND settlement_method = 'unsettled'
           AND EXISTS (
             SELECT 1 FROM appointments a
             INNER JOIN service_catalog sc ON sc.id = appointment_items.service_catalog_id
             WHERE a.id = appointment_items.appointment_id
               AND a.establishment_id = ?
               AND (
                 (? = 1 AND a.status IN ('confirmed', 'completed')
                   AND appointment_items.status IN ('scheduled', 'completed')
                   AND sc.code = 'hotel' AND a.deposit_percent BETWEEN 1 AND 99)
                 OR
                 (? = 0 AND a.status = 'completed' AND appointment_items.status = 'completed')
               )
           )`,
      ).bind(
        amountCents,
        amountCents,
        id,
        establishmentId,
        isLodgingDeposit ? 1 : 0,
        isLodgingDeposit ? 1 : 0,
      ),
      d1.prepare(
        `INSERT INTO audit_events (
          id, establishment_id, actor_user_id, actor_role, action, entity_type,
          entity_id, request_id, result, metadata_json, occurred_at
        ) SELECT ?, ?, ?, ?, 'billing.regular_selected', 'appointment_item',
          ?, ?, 'success', ?, ${nowExpression}
        WHERE EXISTS (
          SELECT 1 FROM appointment_items ai
          INNER JOIN appointments a ON a.id = ai.appointment_id
          WHERE ai.id = ? AND ai.total_cents = ?
            AND ai.payment_preference = 'invoice'
            AND ai.active_invoice_id IS NULL
            AND ai.settlement_method = 'unsettled'
            AND a.establishment_id = ?
            AND (
              (? = 1 AND a.status IN ('confirmed', 'completed')
                AND ai.status IN ('scheduled', 'completed'))
              OR
              (? = 0 AND a.status = 'completed' AND ai.status = 'completed')
            )
        )`,
      ).bind(
        crypto.randomUUID(),
        establishmentId,
        identity.userId,
        identity.role,
        id,
        requestId,
        JSON.stringify({
          appointmentId: item.appointmentId,
          dogName: item.dogName,
          customerName: item.customerName,
          serviceName: item.serviceName,
          previousAmountCents: item.previousAmountCents,
          amountCents,
        }),
        id,
        amountCents,
        establishmentId,
        isLodgingDeposit ? 1 : 0,
        isLodgingDeposit ? 1 : 0,
      ),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) {
      throw new HttpError(
        409,
        "billing_item_changed",
        "O serviço foi alterado. Atualize a página e tente novamente.",
      );
    }
    return json({ item: { id, amountCents, paymentPreference: "invoice" } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
