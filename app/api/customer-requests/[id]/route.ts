import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  appointmentItems,
  appointments,
  customerRequests,
  dogs,
  establishments,
  serviceCatalog,
} from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import { rethrowAppointmentConflict } from "@/lib/server/appointment-conflicts";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  optionalString,
  readJsonObject,
  requiredString,
} from "@/lib/server/http";
import { taxiDogPriceCents, todayInSaoPaulo } from "@/lib/service-rules";

const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
const operationalTimePattern = /^(?:\d{2}:\d{2}|manha|tarde|noite)$/;

type RequestDetails = {
  groomingAddon?: boolean;
  transportDirection?: "one_way" | "round_trip";
  transportDistance?: "short" | "long";
};

function parseDetails(value: string | null): RequestDetails {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as RequestDetails;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) -
      Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000,
  );
}

function assertRequestedTime(value: string | null) {
  if (value && !operationalTimePattern.test(value)) {
    throw new HttpError(
      400,
      "invalid_request_time",
      "O pedido contém um período ou horário inválido.",
    );
  }
}

async function rejectRequest({
  id,
  responseNote,
  identity,
  requestId,
}: {
  id: string;
  responseNote: string | null;
  identity: Awaited<ReturnType<typeof requireIdentity>>;
  requestId: string;
}) {
  const d1 = getD1Database();
  const auditId = crypto.randomUUID();
  const results = await d1.batch([
    d1
      .prepare(
        `INSERT INTO audit_events (
          id, establishment_id, actor_user_id, actor_role, action,
          entity_type, entity_id, request_id, result, metadata_json,
          occurred_at
        )
        SELECT ?, cr.establishment_id, ?, ?, 'customer_request.rejected',
          'customer_request', cr.id, ?, 'success', ?, ${nowExpression}
        FROM customer_requests cr
        WHERE cr.id = ? AND cr.establishment_id = ? AND cr.status = 'pending'`,
      )
      .bind(
        auditId,
        identity.userId,
        identity.role,
        requestId,
        JSON.stringify({ responseNote }),
        id,
        identity.establishmentId,
      ),
    d1
      .prepare(
        `UPDATE customer_requests
        SET status = 'rejected', reviewed_by_user_id = ?,
          reviewed_at = ${nowExpression}, response_note = ?,
          updated_at = ${nowExpression}
        WHERE id = ? AND establishment_id = ? AND status = 'pending'
          AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`,
      )
      .bind(
        identity.userId,
        responseNote,
        id,
        identity.establishmentId,
        auditId,
      ),
  ]);
  if (
    (results[0].meta.changes ?? 0) !== 1 ||
    (results[1].meta.changes ?? 0) !== 1
  ) {
    throw new HttpError(
      409,
      "customer_request_already_reviewed",
      "Este pedido já foi analisado. Atualize a lista.",
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "staff"]);
    const { id } = await context.params;
    const body = await readJsonObject(request);
    const status = requiredString(body, "status", 20);
    if (status !== "approved" && status !== "rejected") {
      throw new HttpError(
        400,
        "invalid_request_status",
        "Escolha aprovar ou não aprovar o pedido.",
      );
    }
    const responseNote = optionalString(body, "responseNote", 1_000);
    const db = getDb();
    const [current] = await db
      .select()
      .from(customerRequests)
      .where(
        and(
          eq(customerRequests.id, id),
          eq(customerRequests.establishmentId, identity.establishmentId!),
        ),
      )
      .limit(1);
    if (!current) {
      throw new HttpError(
        404,
        "customer_request_not_found",
        "O pedido não foi encontrado.",
      );
    }
    if (current.status !== "pending") {
      throw new HttpError(
        409,
        "customer_request_already_reviewed",
        "Este pedido já foi analisado. Atualize a lista.",
      );
    }
    if (status === "rejected") {
      await rejectRequest({ id, responseNote, identity, requestId });
      return json({ request: { id, status, responseNote }, action: "rejected" });
    }
    if (current.type === "profile_update") {
      throw new HttpError(
        409,
        "profile_request_has_no_structured_change",
        "Este pedido antigo não contém alterações estruturadas. Não o aprove; confira a observação e faça a alteração no cadastro.",
      );
    }

    const establishmentId = identity.establishmentId!;
    if (current.type === "cancellation") {
      if (!current.appointmentId) {
        throw new HttpError(
          409,
          "cancellation_without_appointment",
          "O pedido não está ligado a um serviço da agenda.",
        );
      }
      const [[appointment], items] = await Promise.all([
        db
          .select()
          .from(appointments)
          .where(
            and(
              eq(appointments.id, current.appointmentId),
              eq(appointments.establishmentId, establishmentId),
              eq(appointments.accountId, current.accountId),
            ),
          )
          .limit(1),
        db
          .select()
          .from(appointmentItems)
          .where(eq(appointmentItems.appointmentId, current.appointmentId)),
      ]);
      if (!appointment) {
        throw new HttpError(
          404,
          "appointment_not_found",
          "O serviço ligado ao pedido não foi encontrado.",
        );
      }
      if (appointment.status === "completed" || appointment.status === "cancelled") {
        throw new HttpError(
          409,
          "appointment_not_cancellable",
          "Este serviço já foi concluído ou cancelado.",
        );
      }
      if (
        items.some(
          (item) =>
            item.settlementMethod !== "unsettled" || item.activeInvoiceId !== null,
        )
      ) {
        throw new HttpError(
          409,
          "appointment_has_payment",
          "Este serviço já possui pagamento ou cobrança. Resolva a parte financeira antes de aprovar o cancelamento.",
        );
      }

      const d1 = getD1Database();
      const auditId = crypto.randomUUID();
      const cancellationReason =
        current.notes || responseNote || "Cancelamento solicitado pelo cliente";
      const results = await d1.batch([
        d1
          .prepare(
            `INSERT INTO audit_events (
              id, establishment_id, actor_user_id, actor_role, action,
              entity_type, entity_id, request_id, reason, result,
              metadata_json, occurred_at
            )
            SELECT ?, cr.establishment_id, ?, ?,
              'customer_request.approved_and_cancelled', 'customer_request',
              cr.id, ?, ?, 'success', ?, ${nowExpression}
            FROM customer_requests cr
            INNER JOIN appointments a ON a.id = cr.appointment_id
            WHERE cr.id = ? AND cr.establishment_id = ?
              AND cr.status = 'pending'
              AND a.status NOT IN ('completed', 'cancelled')
              AND NOT EXISTS (
                SELECT 1 FROM appointment_items locked
                WHERE locked.appointment_id = a.id
                  AND (locked.settlement_method <> 'unsettled'
                    OR locked.active_invoice_id IS NOT NULL)
              )`,
          )
          .bind(
            auditId,
            identity.userId,
            identity.role,
            requestId,
            cancellationReason,
            JSON.stringify({ appointmentId: current.appointmentId }),
            id,
            establishmentId,
          ),
        d1
          .prepare(
            `UPDATE appointments
            SET status = 'cancelled', cancellation_reason = ?,
              updated_at = ${nowExpression}
            WHERE id = ? AND establishment_id = ?
              AND status NOT IN ('completed', 'cancelled')
              AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`,
          )
          .bind(cancellationReason, current.appointmentId, establishmentId, auditId),
        d1
          .prepare(
            `UPDATE appointment_items
            SET status = 'cancelled', updated_at = ${nowExpression}
            WHERE appointment_id = ? AND status = 'scheduled'
              AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`,
          )
          .bind(current.appointmentId, auditId),
        d1
          .prepare(
            `UPDATE customer_requests
            SET status = 'approved', reviewed_by_user_id = ?,
              reviewed_at = ${nowExpression}, response_note = ?,
              updated_at = ${nowExpression}
            WHERE id = ? AND status = 'pending'
              AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`,
          )
          .bind(identity.userId, responseNote, id, auditId),
      ]);
      if (
        (results[0].meta.changes ?? 0) !== 1 ||
        (results[1].meta.changes ?? 0) !== 1 ||
        (results[3].meta.changes ?? 0) !== 1
      ) {
        throw new HttpError(
          409,
          "customer_request_conflict",
          "O pedido ou o serviço foi alterado. Atualize a lista e confira novamente.",
        );
      }
      return json({
        request: { id, status: "approved", responseNote },
        action: "appointment_cancelled",
        appointmentId: current.appointmentId,
      });
    }

    if (!current.dogId || !current.serviceCatalogId || !current.requestedDate) {
      throw new HttpError(
        409,
        "service_request_incomplete",
        "O pedido não contém cão, serviço e data suficientes para entrar na agenda.",
      );
    }
    const [[dog], [service], [establishment]] = await Promise.all([
      db
        .select()
        .from(dogs)
        .where(
          and(
            eq(dogs.id, current.dogId),
            eq(dogs.accountId, current.accountId),
            eq(dogs.establishmentId, establishmentId),
            eq(dogs.status, "active"),
          ),
        )
        .limit(1),
      db
        .select()
        .from(serviceCatalog)
        .where(
          and(
            eq(serviceCatalog.id, current.serviceCatalogId),
            eq(serviceCatalog.establishmentId, establishmentId),
            eq(serviceCatalog.active, true),
          ),
        )
        .limit(1),
      db
        .select()
        .from(establishments)
        .where(eq(establishments.id, establishmentId))
        .limit(1),
    ]);
    if (!dog || !service || !establishment) {
      throw new HttpError(
        409,
        "request_record_unavailable",
        "O cão ou serviço deste pedido não está mais disponível.",
      );
    }
    if (service.code === "bath_grooming") {
      throw new HttpError(
        409,
        "service_not_schedulable",
        "Este serviço antigo não pode ser agendado diretamente. Não aprove o pedido e solicite um banho com tosa.",
      );
    }
    if (current.requestedDate < todayInSaoPaulo()) {
      throw new HttpError(
        409,
        "requested_date_passed",
        "A data pedida já passou. Não aprove; combine uma nova data com o cliente.",
      );
    }
    assertRequestedTime(current.requestedStartTime);
    assertRequestedTime(current.requestedEndTime);
    const details = parseDetails(current.detailsJson);
    const startDate = current.requestedDate;
    const endDate = service.code === "hotel" ? current.requestedEndDate : startDate;
    const lodgingNights =
      service.code === "hotel" && endDate ? daysBetween(startDate, endDate) : null;
    if (service.code === "hotel" && (!endDate || !lodgingNights || lodgingNights < 1)) {
      throw new HttpError(
        409,
        "lodging_request_incomplete",
        "A hospedagem precisa de uma data de saída posterior à entrada.",
      );
    }
    const groomingAddon = service.code === "bath" && details.groomingAddon === true;
    const transportDirection =
      service.code === "taxi_dog" && details.transportDirection === "round_trip"
        ? "round_trip"
        : "one_way";
    const transportDistance =
      service.code === "taxi_dog" && details.transportDistance === "long"
        ? "long"
        : "short";
    const taxiOneWayCents =
      transportDistance === "long"
        ? establishment.taxiDogLongUnitCents
        : establishment.taxiDogShortUnitCents;
    const totalCents =
      service.code === "hotel"
        ? Math.round(establishment.hotelStandardDailyRateCents * lodgingNights!)
        : service.code === "taxi_dog"
          ? taxiDogPriceCents(taxiOneWayCents, transportDirection)
          : service.basePriceCents +
            (groomingAddon ? establishment.bathGroomingAddonCents : 0);
    const serviceName = groomingAddon ? "Banho e tosa" : service.name;
    const description =
      service.code === "taxi_dog"
        ? transportDirection === "round_trip"
          ? "Ida e volta"
          : "Ida"
        : groomingAddon
          ? "Com tosa"
          : null;
    const appointmentId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    const appointmentDetails = JSON.stringify({
      customerRequestId: id,
      requestedByCustomer: true,
      ...(groomingAddon ? { groomingAddon: true } : {}),
      ...(service.code === "taxi_dog"
        ? { transportDirection, transportDistance }
        : {}),
    });
    const d1 = getD1Database();
    try {
      const results = await d1.batch([
        d1
          .prepare(
            `INSERT INTO audit_events (
              id, establishment_id, actor_user_id, actor_role, action,
              entity_type, entity_id, request_id, result, metadata_json,
              occurred_at
            )
            SELECT ?, cr.establishment_id, ?, ?,
              'customer_request.approved_and_scheduled',
              'customer_request', cr.id, ?, 'success', ?, ${nowExpression}
            FROM customer_requests cr
            WHERE cr.id = ? AND cr.establishment_id = ? AND cr.status = 'pending'`,
          )
          .bind(
            auditId,
            identity.userId,
            identity.role,
            requestId,
            JSON.stringify({
              appointmentId,
              dogId: dog.id,
              dogName: dog.name,
              serviceCatalogId: service.id,
              serviceName,
              startDate,
              endDate,
            }),
            id,
            establishmentId,
          ),
        d1
          .prepare(
            `INSERT INTO appointments (
              id, establishment_id, account_id, dog_id,
              primary_service_catalog_id, start_date, end_date,
              start_time, end_time, lodging_nights, deposit_percent,
              lodging_rate_profile, lodging_table_daily_rate_cents,
              status, source, internal_notes, created_by_user_id,
              created_at, updated_at
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?,
              'scheduled', 'manual', ?, ?, ${nowExpression}, ${nowExpression}
            WHERE EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`,
          )
          .bind(
            appointmentId,
            establishmentId,
            dog.accountId,
            dog.id,
            service.id,
            startDate,
            endDate,
            service.code === "taxi_dog" ? null : current.requestedStartTime,
            service.code === "taxi_dog" ? null : current.requestedEndTime,
            lodgingNights,
            service.code === "hotel"
              ? establishment.hotelStandardDailyRateCents
              : null,
            current.notes,
            identity.userId,
            auditId,
          ),
        d1
          .prepare(
            `INSERT INTO appointment_items (
              id, appointment_id, service_catalog_id, service_name_snapshot,
              description_snapshot, details_json, unit_price_cents, quantity,
              total_cents, status, payment_preference, settlement_method,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'scheduled', 'invoice',
              'unsettled', ${nowExpression}, ${nowExpression})`,
          )
          .bind(
            itemId,
            appointmentId,
            service.id,
            serviceName,
            description,
            appointmentDetails,
            totalCents,
            totalCents,
          ),
        d1
          .prepare(
            `UPDATE customer_requests
            SET status = 'approved', appointment_id = ?,
              reviewed_by_user_id = ?, reviewed_at = ${nowExpression},
              response_note = ?, updated_at = ${nowExpression}
            WHERE id = ? AND status = 'pending'
              AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`,
          )
          .bind(appointmentId, identity.userId, responseNote, id, auditId),
      ]);
      if (
        (results[0].meta.changes ?? 0) !== 1 ||
        (results[1].meta.changes ?? 0) !== 1 ||
        (results[2].meta.changes ?? 0) !== 1 ||
        (results[3].meta.changes ?? 0) !== 1
      ) {
        throw new HttpError(
          409,
          "customer_request_conflict",
          "O pedido foi alterado. Atualize a lista antes de tentar novamente.",
        );
      }
    } catch (error) {
      rethrowAppointmentConflict(error);
    }
    return json({
      request: { id, status: "approved", responseNote, appointmentId },
      action: "appointment_created",
      appointment: {
        id: appointmentId,
        dogId: dog.id,
        dogName: dog.name,
        serviceName,
        startDate,
        endDate,
        status: "scheduled",
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
