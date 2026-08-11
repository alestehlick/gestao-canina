import { and, eq, inArray, sql } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  appointmentItems,
  appointments,
  auditEvents,
  establishments,
  invoices,
  serviceCatalog,
} from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  optionalString,
  readJsonObject,
  requiredString,
} from "@/lib/server/http";
import {
  canTransitionAppointment,
  isCanonicalAppointmentStatus,
  taxiDogPriceCents,
  todayInSaoPaulo,
  type CanonicalAppointmentStatus,
} from "@/lib/service-rules";

const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
const operationalTimePattern = /^(?:\d{2}:\d{2}|manha|tarde|noite)$/;
const lodgingRateProfiles = [
  "standard",
  "daycare",
  "additional_dog",
  "daycare_additional_dog",
] as const;
type LodgingRateProfile = (typeof lodgingRateProfiles)[number];

function isLodgingRateProfile(value: unknown): value is LodgingRateProfile {
  return typeof value === "string" && lodgingRateProfiles.includes(value as LodgingRateProfile);
}

function lodgingDailyRateCents(
  establishment: typeof establishments.$inferSelect,
  profile: LodgingRateProfile,
) {
  switch (profile) {
    case "daycare":
      return establishment.hotelDaycareDailyRateCents;
    case "additional_dog":
      return establishment.hotelAdditionalDogDailyRateCents;
    case "daycare_additional_dog":
      return establishment.hotelDaycareAdditionalDogDailyRateCents;
    default:
      return establishment.hotelStandardDailyRateCents;
  }
}

function operationalTimeOrder(value: string) {
  if (value === "manha") return 8 * 60;
  if (value === "tarde") return 14 * 60;
  if (value === "noite") return 19 * 60;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function invalidTimeRange(start: string, end: string) {
  const bothPeriods = !start.includes(":") && !end.includes(":");
  return bothPeriods
    ? operationalTimeOrder(end) < operationalTimeOrder(start)
    : operationalTimeOrder(end) <= operationalTimeOrder(start);
}

async function hasActiveInvoiceBilling(
  appointmentId: string,
  establishmentId: string,
) {
  const d1 = getD1Database();
  const result = await d1
    .prepare(
      `SELECT 1 AS found
      FROM appointment_items ai
      LEFT JOIN invoice_items ii ON ii.appointment_item_id = ai.id
      LEFT JOIN invoices i ON i.id = ii.invoice_id
      INNER JOIN appointments a ON a.id = ai.appointment_id
      WHERE ai.appointment_id = ?
        AND a.establishment_id = ?
        AND (
          ai.active_invoice_id IS NOT NULL
          OR ai.settlement_method = 'invoice'
          OR (i.id IS NOT NULL AND i.status <> 'void')
        )
      LIMIT 1`,
    )
    .bind(appointmentId, establishmentId)
    .first<{ found: number }>();
  return Boolean(result?.found);
}

async function cancelRecurringSeries({
  appointment,
  cancellationReason,
  recurrenceScope,
  establishmentId,
  identity,
  requestId,
}: {
  appointment: typeof appointments.$inferSelect;
  cancellationReason: string;
  recurrenceScope: "future" | "series";
  establishmentId: string;
  identity: Awaited<ReturnType<typeof requireIdentity>>;
  requestId: string;
}) {
  if (!appointment.recurringScheduleId) {
    throw new HttpError(
      400,
      "appointment_is_not_recurring",
      "Este agendamento não pertence a uma recorrência.",
    );
  }

  const d1 = getD1Database();
  const cancellationFrom =
    recurrenceScope === "future" ? appointment.startDate : "0000-00-00";
  const seriesRows = await d1
    .prepare(
      `SELECT a.id
      FROM appointments a
      WHERE a.establishment_id = ?
        AND a.recurring_schedule_id = ?
        AND a.start_date >= ?
        AND a.status NOT IN ('completed', 'cancelled')
      ORDER BY a.start_date, a.start_time`,
    )
    .bind(
      establishmentId,
      appointment.recurringScheduleId,
      cancellationFrom,
    )
    .all<{ id: string }>();
  const appointmentIds = seriesRows.results.map((row) => row.id);
  if (appointmentIds.length === 0) {
    return {
      appointment,
      items: [],
      cancelledAppointmentIds: [],
      idempotent: true,
    };
  }

  const auditId = crypto.randomUUID();
  const guardInsert = d1
    .prepare(
      `INSERT INTO audit_events (
        id, establishment_id, actor_user_id, actor_role, action,
        entity_type, entity_id, request_id, result, reason, metadata_json,
        occurred_at
      )
      SELECT ?, rs.establishment_id, ?, ?,
        'recurring_schedule.cancelled', 'recurring_schedule', rs.id, ?,
        'success', ?, ?, ${nowExpression}
      FROM recurring_schedules rs
      WHERE rs.id = ?
        AND rs.establishment_id = ?
        AND EXISTS (
          SELECT 1
          FROM appointments open_a
          WHERE open_a.recurring_schedule_id = rs.id
            AND open_a.establishment_id = rs.establishment_id
            AND open_a.start_date >= ?
            AND open_a.status NOT IN ('completed', 'cancelled')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM appointments locked_a
          INNER JOIN appointment_items locked_ai
            ON locked_ai.appointment_id = locked_a.id
          LEFT JOIN invoice_items locked_ii
            ON locked_ii.appointment_item_id = locked_ai.id
          LEFT JOIN invoices locked_i
            ON locked_i.id = locked_ii.invoice_id
          WHERE locked_a.recurring_schedule_id = rs.id
            AND locked_a.establishment_id = rs.establishment_id
            AND locked_a.start_date >= ?
            AND locked_a.status NOT IN ('completed', 'cancelled')
            AND (
              locked_ai.active_invoice_id IS NOT NULL
              OR locked_ai.settlement_method <> 'unsettled'
              OR (locked_i.id IS NOT NULL AND locked_i.status <> 'void')
            )
        )`,
    )
    .bind(
      auditId,
      identity.userId,
      identity.role,
      requestId,
      cancellationReason,
      JSON.stringify({
        appointmentIds,
        occurrenceCount: appointmentIds.length,
        recurrenceScope,
      }),
      appointment.recurringScheduleId,
      establishmentId,
      cancellationFrom,
      cancellationFrom,
    );
  const results = await d1.batch([
    guardInsert,
    d1
      .prepare(
        `UPDATE appointment_items
        SET status = 'cancelled',
          updated_at = ${nowExpression}
        WHERE status = 'scheduled'
          AND appointment_id IN (
            SELECT a.id
            FROM appointments a
            WHERE a.establishment_id = ?
              AND a.recurring_schedule_id = ?
              AND a.start_date >= ?
              AND a.status NOT IN ('completed', 'cancelled')
          )
          AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`,
      )
      .bind(
        establishmentId,
        appointment.recurringScheduleId,
        cancellationFrom,
        auditId,
      ),
    d1
      .prepare(
        `UPDATE appointments
        SET status = 'cancelled',
          cancellation_reason = ?,
          updated_at = ${nowExpression}
        WHERE establishment_id = ?
          AND recurring_schedule_id = ?
          AND start_date >= ?
          AND status NOT IN ('completed', 'cancelled')
          AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`,
      )
      .bind(
        cancellationReason,
        establishmentId,
        appointment.recurringScheduleId,
        cancellationFrom,
        auditId,
      ),
    d1
      .prepare(
        `UPDATE recurring_schedules
        SET status = 'ended',
          updated_at = ${nowExpression}
        WHERE id = ?
          AND establishment_id = ?
          AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)`,
      )
      .bind(appointment.recurringScheduleId, establishmentId, auditId),
  ]);

  if ((results[0].meta.changes ?? 0) !== 1) {
    const locked = await Promise.all(
      appointmentIds.map((candidateId) =>
        hasActiveInvoiceBilling(candidateId, establishmentId),
      ),
    );
    if (locked.some(Boolean)) {
      throw new HttpError(
        409,
        "recurring_schedule_has_payment",
        "Há uma ocorrência desta recorrência com fatura ou pagamento. Resolva a parte financeira antes de cancelar toda a série.",
      );
    }
    throw new HttpError(
      409,
      "recurring_schedule_cancel_conflict",
      "A recorrência foi alterada por outra operação. Atualize a agenda e tente novamente.",
    );
  }

  const db = getDb();
  const [[updatedAppointment], updatedItems] = await Promise.all([
    db
      .select()
      .from(appointments)
      .where(eq(appointments.id, appointment.id))
      .limit(1),
    db
      .select()
      .from(appointmentItems)
      .where(eq(appointmentItems.appointmentId, appointment.id)),
  ]);
  return {
    appointment: updatedAppointment,
    items: updatedItems,
    cancelledAppointmentIds: appointmentIds,
    idempotent: false,
  };
}

async function reopenCompletedAppointment({
  appointmentId,
  establishmentId,
  identity,
  requestId,
  items,
}: {
  appointmentId: string;
  establishmentId: string;
  identity: Awaited<ReturnType<typeof requireIdentity>>;
  requestId: string;
  items: (typeof appointmentItems.$inferSelect)[];
}) {
  if (await hasActiveInvoiceBilling(appointmentId, establishmentId)) {
    throw new HttpError(
      409,
      "appointment_has_invoice",
      "Este atendimento possui fatura ou pagamento e não pode ser reaberto. Anule a fatura primeiro.",
    );
  }

  const creditItems = items.filter(
    (item) => item.settlementMethod === "credit",
  );
  if (
    creditItems.some(
      (item) => item.status !== "completed" || !item.creditMovementId,
    )
  ) {
    throw new HttpError(
      409,
      "credit_settlement_inconsistent",
      "O consumo de crédito deste atendimento está incompleto. Revise o histórico financeiro antes de reabrir.",
    );
  }

  const d1 = getD1Database();
  const guardAuditId = crypto.randomUUID();
  const creditPairGuards = creditItems
    .map(
      () =>
        `AND EXISTS (
          SELECT 1
          FROM appointment_items guarded_ai
          INNER JOIN credit_movements guarded_cm
            ON guarded_cm.id = guarded_ai.credit_movement_id
          INNER JOIN credit_receipts guarded_cr
            ON guarded_cr.appointment_item_id = guarded_ai.id
            AND guarded_cr.credit_movement_id = guarded_cm.id
          WHERE guarded_ai.id = ?
            AND guarded_ai.appointment_id = a.id
            AND guarded_ai.status = 'completed'
            AND guarded_ai.settlement_method = 'credit'
            AND guarded_ai.credit_movement_id = ?
            AND guarded_ai.active_invoice_id IS NULL
            AND guarded_cm.movement_type = 'consume'
            AND guarded_cm.delta_units < 0
            AND guarded_cm.appointment_item_id = guarded_ai.id
            AND NOT EXISTS (
              SELECT 1
              FROM credit_movements guarded_reversal
              WHERE guarded_reversal.reversed_movement_id = guarded_cm.id
            )
        )`,
    )
    .join("\n");
  const guardBindings = creditItems.flatMap((item) => [
    item.id,
    item.creditMovementId!,
  ]);
  const statements = [
    d1
      .prepare(
        `INSERT INTO audit_events (
          id, establishment_id, actor_user_id, actor_role, action,
          entity_type, entity_id, request_id, result, metadata_json,
          occurred_at
        )
        SELECT ?, a.establishment_id, ?, ?, 'appointment.reopened',
          'appointment', a.id, ?, 'success', ?, ${nowExpression}
        FROM appointments a
        WHERE a.id = ?
          AND a.establishment_id = ?
          AND a.status = 'completed'
          AND (
            SELECT COUNT(*)
            FROM appointment_items counted_ai
            WHERE counted_ai.appointment_id = a.id
          ) = ?
          AND (
            SELECT COUNT(*)
            FROM appointment_items counted_credit_ai
            WHERE counted_credit_ai.appointment_id = a.id
              AND counted_credit_ai.settlement_method = 'credit'
          ) = ?
          AND NOT EXISTS (
            SELECT 1
            FROM appointment_items invalid_ai
            WHERE invalid_ai.appointment_id = a.id
              AND (
                invalid_ai.active_invoice_id IS NOT NULL
                OR invalid_ai.settlement_method = 'invoice'
                OR (
                  invalid_ai.status <> 'completed'
                  AND invalid_ai.status <> 'cancelled'
                )
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM appointment_items billed_ai
            INNER JOIN invoice_items billed_ii
              ON billed_ii.appointment_item_id = billed_ai.id
            INNER JOIN invoices billed_i ON billed_i.id = billed_ii.invoice_id
            WHERE billed_ai.appointment_id = a.id
              AND billed_i.status <> 'void'
          )
          ${creditPairGuards}`,
      )
      .bind(
        guardAuditId,
        identity.userId,
        identity.role,
        requestId,
        JSON.stringify({
          previousStatus: "completed",
          status: "scheduled",
          reversedCreditItems: creditItems.map((item) => item.id),
          receiptHandling: "archived_in_audit",
        }),
        appointmentId,
        establishmentId,
        items.length,
        creditItems.length,
        ...guardBindings,
      ),
  ];

  for (const item of creditItems) {
    const movementId = item.creditMovementId!;
    const reversalMovementId = crypto.randomUUID();
    const receiptAuditId = crypto.randomUUID();
    const archivedIdempotencyKey = `archived-credit-consume:${movementId}`;
    const reversalIdempotencyKey =
      `credit-reopen:${item.id}:${movementId}`;

    statements.push(
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, result, metadata_json,
            occurred_at
          )
          SELECT ?, cr.establishment_id, ?, ?,
            'credit_receipt.invalidated', 'credit_receipt', cr.id, ?,
            'success',
            json_object(
              'reason', 'appointment_reopened',
              'appointmentId', ?,
              'appointmentItemId', cr.appointment_item_id,
              'creditMovementId', cr.credit_movement_id,
              'receiptNumber', cr.receipt_number,
              'customerNameSnapshot', cr.customer_name_snapshot,
              'dogNameSnapshot', cr.dog_name_snapshot,
              'serviceNameSnapshot', cr.service_name_snapshot,
              'serviceDateSnapshot', cr.service_date_snapshot,
              'creditUnits', cr.credit_units,
              'deliveryStatus', cr.delivery_status,
              'deliveryChannelsJson', cr.delivery_channels_json,
              'issuedAt', cr.issued_at,
              'sentAt', cr.sent_at,
              'createdAt', cr.created_at,
              'updatedAt', cr.updated_at
            ),
            ${nowExpression}
          FROM credit_receipts cr
          WHERE cr.appointment_item_id = ?
            AND cr.credit_movement_id = ?
            AND EXISTS (
              SELECT 1 FROM audit_events WHERE id = ?
            )`,
        )
        .bind(
          receiptAuditId,
          identity.userId,
          identity.role,
          requestId,
          appointmentId,
          item.id,
          movementId,
          guardAuditId,
        ),
      d1
        .prepare(
          `INSERT INTO credit_movements (
            id, establishment_id, account_id, dog_id, service_catalog_id,
            appointment_item_id, credit_purchase_id, reversed_movement_id,
            movement_type, delta_units, reason, idempotency_key,
            actor_user_id, occurred_at
          )
          SELECT ?, cm.establishment_id, cm.account_id, cm.dog_id,
            cm.service_catalog_id, NULL, NULL, cm.id, 'refund',
            -cm.delta_units, 'Estorno por reabertura do atendimento', ?, ?,
            ${nowExpression}
          FROM credit_movements cm
          WHERE cm.id = ?
            AND cm.movement_type = 'consume'
            AND cm.delta_units < 0
            AND EXISTS (
              SELECT 1 FROM audit_events WHERE id = ?
            )
            AND NOT EXISTS (
              SELECT 1
              FROM credit_movements reversal
              WHERE reversal.reversed_movement_id = cm.id
            )`,
        )
        .bind(
          reversalMovementId,
          reversalIdempotencyKey,
          identity.userId,
          movementId,
          guardAuditId,
        ),
      d1
        .prepare(
          `UPDATE credit_movements
          SET appointment_item_id = NULL,
            idempotency_key = ?
          WHERE id = ?
            AND appointment_item_id = ?
            AND EXISTS (
              SELECT 1 FROM credit_movements WHERE id = ?
            )
            AND EXISTS (
              SELECT 1 FROM audit_events WHERE id = ?
            )`,
        )
        .bind(
          archivedIdempotencyKey,
          movementId,
          item.id,
          reversalMovementId,
          guardAuditId,
        ),
      d1
        .prepare(
          `DELETE FROM credit_receipts
          WHERE appointment_item_id = ?
            AND credit_movement_id = ?
            AND EXISTS (
              SELECT 1 FROM audit_events WHERE id = ?
            )
            AND EXISTS (
              SELECT 1 FROM credit_movements WHERE id = ?
            )`,
        )
        .bind(
          item.id,
          movementId,
          receiptAuditId,
          reversalMovementId,
        ),
    );
  }

  statements.push(
    d1
      .prepare(
        `UPDATE appointment_items
        SET status = CASE
            WHEN status = 'completed' THEN 'scheduled'
            ELSE status
          END,
          settlement_method = CASE
            WHEN settlement_method = 'credit' THEN 'unsettled'
            ELSE settlement_method
          END,
          credit_movement_id = CASE
            WHEN settlement_method = 'credit' THEN NULL
            ELSE credit_movement_id
          END,
          settled_at = CASE
            WHEN settlement_method = 'credit' THEN NULL
            ELSE settled_at
          END,
          updated_at = ${nowExpression}
        WHERE appointment_id = ?
          AND EXISTS (
            SELECT 1 FROM audit_events WHERE id = ?
          )`,
      )
      .bind(appointmentId, guardAuditId),
    d1
      .prepare(
        `UPDATE appointment_items
        SET status = 'cancelled',
          updated_at = ${nowExpression}
        WHERE appointment_id = ?
          AND json_extract(details_json, '$.source') =
            'grooming_addon_after_bath_credit'
          AND EXISTS (
            SELECT 1 FROM audit_events WHERE id = ?
          )`,
      )
      .bind(appointmentId, guardAuditId),
    d1
      .prepare(
        `UPDATE appointments
        SET status = 'scheduled',
          cancellation_reason = NULL,
          updated_at = ${nowExpression}
        WHERE id = ?
          AND establishment_id = ?
          AND status = 'completed'
          AND EXISTS (
            SELECT 1 FROM audit_events WHERE id = ?
          )`,
      )
      .bind(appointmentId, establishmentId, guardAuditId),
  );

  const results = await d1.batch(statements);
  if ((results[0].meta.changes ?? 0) !== 1) {
    const db = getDb();
    const [currentAppointment] = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.id, appointmentId),
          eq(appointments.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (currentAppointment?.status === "scheduled") {
      const currentItems = await db
        .select()
        .from(appointmentItems)
        .where(eq(appointmentItems.appointmentId, appointmentId));
      return {
        appointment: {
          ...currentAppointment,
          items: currentItems,
        },
        idempotent: true,
        reversedCredits: 0,
      };
    }
    if (await hasActiveInvoiceBilling(appointmentId, establishmentId)) {
      throw new HttpError(
        409,
        "appointment_has_invoice",
        "Este atendimento passou a ter uma fatura ou pagamento e não pode ser reaberto.",
      );
    }
    throw new HttpError(
      409,
      "appointment_reopen_conflict",
      "O atendimento foi alterado por outra operação. Atualize a agenda e tente novamente.",
    );
  }

  const db = getDb();
  const [[updatedAppointment], updatedItems] = await Promise.all([
    db
      .select()
      .from(appointments)
      .where(eq(appointments.id, appointmentId))
      .limit(1),
    db
      .select()
      .from(appointmentItems)
      .where(eq(appointmentItems.appointmentId, appointmentId)),
  ]);
  return {
    appointment: {
      ...updatedAppointment,
      items: updatedItems,
    },
    idempotent: false,
    reversedCredits: creditItems.length,
  };
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
    if (!id || id.length > 80) {
      throw new HttpError(
        400,
        "invalid_appointment_id",
        "O agendamento informado é inválido.",
      );
    }

    const body = await readJsonObject(request);
    const requestedStatus =
      body.status === undefined
        ? null
        : requiredString(body, "status", 30);
    if (requestedStatus !== null && !isCanonicalAppointmentStatus(requestedStatus)) {
      throw new HttpError(
        400,
        "invalid_status",
        "Escolha um status válido para o agendamento.",
      );
    }
    const cancellationReason = optionalString(
      body,
      "cancellationReason",
      500,
    );
    const recurrenceScope =
      body.recurrenceScope === undefined
        ? "occurrence"
        : requiredString(body, "recurrenceScope", 20);
    if (
      recurrenceScope !== "occurrence" &&
      recurrenceScope !== "future" &&
      recurrenceScope !== "series"
    ) {
      throw new HttpError(
        400,
        "invalid_recurrence_scope",
        "Escolha cancelar este dia, deste dia em diante ou toda a recorrência.",
      );
    }
    if (requestedStatus === "cancelled" && !cancellationReason) {
      throw new HttpError(
        400,
        "cancellation_reason_required",
        "Informe o motivo do cancelamento.",
      );
    }

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [appointment] = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.id, id),
          eq(appointments.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (!appointment) {
      throw new HttpError(
        404,
        "appointment_not_found",
        "O agendamento não foi encontrado.",
      );
    }

    const items = await db
      .select()
      .from(appointmentItems)
      .where(eq(appointmentItems.appointmentId, id));

    if (requestedStatus === null) {
      if (
        appointment.status === "completed" ||
        appointment.status === "cancelled"
      ) {
        throw new HttpError(
          409,
          "appointment_is_final",
          "Um agendamento concluído ou cancelado não pode ser editado.",
        );
      }
      if (items.length !== 1) {
        throw new HttpError(
          409,
          "appointment_items_not_editable",
          "Este agendamento possui vários serviços e precisa de revisão individual.",
        );
      }
      const item = items[0];
      if (item.activeInvoiceId || item.settlementMethod !== "unsettled") {
        throw new HttpError(
          409,
          "appointment_has_payment",
          "Este serviço já possui cobrança ou pagamento e não pode ser editado.",
        );
      }

      const startDate =
        body.startDate === undefined
          ? appointment.startDate
          : optionalString(body, "startDate", 10);
      const endDate =
        body.endDate === undefined
          ? appointment.endDate
          : optionalString(body, "endDate", 10);
      const startTime =
        body.startTime === undefined
          ? appointment.startTime
          : optionalString(body, "startTime", 5);
      const endTime =
        body.endTime === undefined
          ? appointment.endTime
          : optionalString(body, "endTime", 5);
      const internalNotes =
        body.internalNotes === undefined
          ? appointment.internalNotes
          : optionalString(body, "internalNotes", 2_000);
      const serviceCatalogId =
        body.serviceCatalogId === undefined
          ? item.serviceCatalogId
          : optionalString(body, "serviceCatalogId", 80);

      if (
        !startDate ||
        !endDate ||
        !serviceCatalogId ||
        !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
        (startTime !== null && !operationalTimePattern.test(startTime)) ||
        (endTime !== null && !operationalTimePattern.test(endTime)) ||
        (startDate === endDate &&
          startTime &&
          endTime &&
          invalidTimeRange(startTime, endTime))
      ) {
        throw new HttpError(
          400,
          "invalid_schedule",
          "Revise a data e os horários do serviço.",
        );
      }
      const [service] = await db
        .select()
        .from(serviceCatalog)
        .where(
          and(
            eq(serviceCatalog.id, serviceCatalogId),
            eq(serviceCatalog.establishmentId, establishmentId),
            eq(serviceCatalog.active, true),
          ),
        )
        .limit(1);
      if (!service) {
        throw new HttpError(
          404,
          "service_not_found",
          "O serviço selecionado não foi encontrado.",
        );
      }
      if (service.code === "bath_grooming") {
        throw new HttpError(
          400,
          "service_not_schedulable",
          "Escolha banho e marque a opção de incluir tosa.",
        );
      }
      if (body.groomingAddon !== undefined && typeof body.groomingAddon !== "boolean") {
        throw new HttpError(400, "invalid_grooming_addon", "Revise a opção de tosa.");
      }
      const groomingAddon =
        service.code === "bath" && body.groomingAddon === true;
      const direction =
        body.transportDirection === "round_trip"
          ? "round_trip"
          : "one_way";
      const lodgingNights: number | null =
        service.code === "hotel"
          ? body.lodgingNights === undefined
            ? appointment.lodgingNights
            : typeof body.lodgingNights === "number"
              ? body.lodgingNights
              : Number.NaN
          : null;
      const depositPercent: number | null =
        service.code === "hotel"
          ? body.depositPercent === undefined
            ? appointment.depositPercent
            : body.depositPercent === null
              ? null
              : typeof body.depositPercent === "number"
                ? body.depositPercent
                : Number.NaN
          : null;
      const lodgingRateProfile: LodgingRateProfile | null =
        service.code === "hotel"
          ? body.lodgingRateProfile === undefined
            ? (appointment.lodgingRateProfile ?? "standard") as LodgingRateProfile
            : isLodgingRateProfile(body.lodgingRateProfile)
              ? body.lodgingRateProfile
              : null
          : null;
      if (service.code === "hotel") {
        const calendarDays = Math.round(
          (Date.parse(`${endDate}T00:00:00.000Z`) -
            Date.parse(`${startDate}T00:00:00.000Z`)) /
            86_400_000,
        );
        if (
          typeof lodgingNights !== "number" ||
          !Number.isFinite(lodgingNights) ||
          lodgingNights < 1 ||
          lodgingNights > 365 ||
          Math.round(lodgingNights * 2) !== lodgingNights * 2 ||
          calendarDays < 1 ||
          lodgingNights < calendarDays ||
          lodgingNights > calendarDays + 0.5
        ) {
          throw new HttpError(
            400,
            "invalid_lodging_nights",
            "Revise a saída e informe as diárias em múltiplos de meio dia.",
          );
        }
        if (
          depositPercent !== null &&
          (typeof depositPercent !== "number" ||
            !Number.isInteger(depositPercent) ||
            depositPercent < 1 ||
            depositPercent > 99)
        ) {
          throw new HttpError(
            400,
            "invalid_deposit_percent",
            "Informe um sinal entre 1% e 99%.",
          );
        }
        if (!lodgingRateProfile) {
          throw new HttpError(
            400,
            "invalid_lodging_rate_profile",
            "Escolha uma condição de diária válida para a hospedagem.",
          );
        }
      }
      const [establishment] = await db
        .select()
        .from(establishments)
        .where(eq(establishments.id, establishmentId))
        .limit(1);
      if (!establishment) {
        throw new HttpError(404, "establishment_not_found", "A unidade não foi encontrada.");
      }
      const catalogPriceCents =
        service.code === "hotel"
          ? Math.round(
              lodgingDailyRateCents(establishment, lodgingRateProfile!) *
                (lodgingNights ?? 1),
            )
          : service.code === "taxi_dog"
            ? taxiDogPriceCents(service.basePriceCents, direction)
            : service.basePriceCents +
              (groomingAddon ? establishment.bathGroomingAddonCents : 0);
      const priceCents =
        item.serviceCatalogId !== service.id ||
        service.code === "hotel" ||
        service.code === "taxi_dog" ||
        service.code === "bath"
          ? catalogPriceCents
          : item.totalCents;
      const duplicate = await getD1Database()
        .prepare(
          `SELECT 1 AS found
          FROM appointments a
          INNER JOIN appointment_items ai ON ai.appointment_id = a.id
          WHERE a.establishment_id = ? AND a.dog_id = ?
            AND a.id <> ? AND a.status <> 'cancelled'
            AND a.start_date = ? AND ai.service_catalog_id = ?
          LIMIT 1`,
        )
        .bind(establishmentId, appointment.dogId, id, startDate, service.id)
        .first<{ found: number }>();
      if (duplicate) {
        throw new HttpError(
          409,
          "duplicate_appointment",
          `Já existe um agendamento de ${service.name} para este cão nessa data.`,
        );
      }
      if (service.code === "hotel") {
        const lodgingOverlap = await getD1Database()
          .prepare(
            `SELECT a.id
            FROM appointments a
            INNER JOIN appointment_items ai ON ai.appointment_id = a.id
            INNER JOIN service_catalog sc ON sc.id = ai.service_catalog_id
            WHERE a.establishment_id = ? AND a.dog_id = ?
              AND a.id <> ? AND a.status <> 'cancelled' AND sc.code = 'hotel'
              AND a.start_date <= ? AND a.end_date >= ?
            LIMIT 1`,
          )
          .bind(
            establishmentId,
            appointment.dogId,
            id,
            endDate,
            startDate,
          )
          .first<{ id: string }>();
        if (lodgingOverlap) {
          throw new HttpError(
            409,
            "lodging_overlap",
            "Este cão já possui uma hospedagem que se sobrepõe ao período escolhido.",
          );
        }
      }

      const removingLodgingDeposit =
        service.code === "hotel" &&
        appointment.depositPercent !== null &&
        depositPercent === null;
      const openDepositInvoiceIds: string[] = [];
      if (removingLodgingDeposit) {
        const linkedInvoices = await getD1Database()
          .prepare(
            `SELECT DISTINCT i.id, i.status, i.source_type AS sourceType,
              EXISTS (
                SELECT 1 FROM invoice_payments ip
                WHERE ip.invoice_id = i.id AND ip.status = 'active'
              ) AS hasPayment,
              EXISTS (
                SELECT 1 FROM invoice_settlements s
                WHERE s.invoice_id = i.id AND s.status = 'scheduled'
              ) AS hasSettlement
            FROM invoice_items ii
            INNER JOIN invoices i ON i.id = ii.invoice_id
            WHERE ii.appointment_item_id = ?
              AND i.establishment_id = ?
              AND i.status <> 'void'`,
          )
          .bind(item.id, establishmentId)
          .all<{
            id: string;
            status: string;
            sourceType: string;
            hasPayment: number;
            hasSettlement: number;
          }>();
        for (const linked of linkedInvoices.results) {
          if (
            linked.status === "paid" ||
            linked.hasPayment ||
            linked.hasSettlement ||
            linked.sourceType !== "lodging_deposit"
          ) {
            throw new HttpError(
              409,
              "lodging_deposit_already_billed",
              "O sinal já participa de uma cobrança. Cancele ou desfaça essa cobrança antes de removê-lo da hospedagem.",
            );
          }
          openDepositInvoiceIds.push(linked.id);
        }
      }

      const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
      const updateStatements = [
        db
          .update(appointments)
          .set({
            startDate,
            endDate,
            startTime,
            endTime,
            lodgingNights,
            depositPercent,
            lodgingRateProfile,
            lodgingTableDailyRateCents:
              service.code === "hotel"
                ? establishment.hotelStandardDailyRateCents
                : null,
            internalNotes,
            updatedAt: now,
          })
          .where(eq(appointments.id, id)),
        db
          .update(appointmentItems)
          .set({
            serviceCatalogId: service.id,
            serviceNameSnapshot: groomingAddon ? "Banho e tosa" : service.name,
            unitPriceCents: priceCents,
            totalCents: priceCents,
            descriptionSnapshot:
              service.code === "taxi_dog"
                ? direction === "round_trip"
                  ? "Ida e volta"
                  : "Ida"
                : groomingAddon
                  ? "Com tosa"
                : service.code === "hotel" && depositPercent
                  ? `Sinal de ${depositPercent}% no check-in; saldo no check-out.`
                  : null,
            detailsJson: groomingAddon
              ? JSON.stringify({ groomingAddon: true })
              : null,
            updatedAt: now,
          })
          .where(eq(appointmentItems.id, item.id)),
        ...(openDepositInvoiceIds.length
          ? [db
              .update(invoices)
              .set({
                status: "void" as const,
                voidedAt: now,
                voidReason: "Sinal removido do agendamento antes do pagamento",
                updatedAt: now,
              })
              .where(inArray(invoices.id, openDepositInvoiceIds))]
          : []),
        db.insert(auditEvents).values({
          id: crypto.randomUUID(),
          establishmentId,
          actorUserId: identity.userId,
          actorRole: identity.role,
          action: "appointment.updated",
          entityType: "appointment",
          entityId: id,
          requestId,
          metadataJson: JSON.stringify({
            serviceName: service.name,
            dogId: appointment.dogId,
            startDate,
            endDate,
            depositPercent,
            groomingAddon,
            voidedDepositInvoiceIds: openDepositInvoiceIds,
          }),
        }),
      ] as const;
      await db.batch(updateStatements);

      return json({
        appointment: {
          id,
          startDate,
          endDate,
          startTime,
          endTime,
          internalNotes,
          lodgingNights,
          depositPercent,
          lodgingRateProfile,
          serviceCatalogId: service.id,
          serviceName: groomingAddon ? "Banho e tosa" : service.name,
          priceCents,
          paymentPreference: item.paymentPreference,
          transportDirection:
            service.code === "taxi_dog" ? direction : null,
          groomingAddon,
        },
      });
    }

    if (appointment.status === requestedStatus) {
      return json({
        appointment: {
          ...appointment,
          items,
        },
        idempotent: true,
      });
    }

    if (
      !canTransitionAppointment(
        appointment.status as CanonicalAppointmentStatus,
        requestedStatus as CanonicalAppointmentStatus,
      )
    ) {
      throw new HttpError(
        409,
        "invalid_status_transition",
        "A situação deste atendimento mudou. Atualize a Agenda antes de continuar.",
      );
    }
    if (
      appointment.status === "completed" &&
      requestedStatus === "scheduled"
    ) {
      return json(
        await reopenCompletedAppointment({
          appointmentId: id,
          establishmentId,
          identity,
          requestId,
          items,
        }),
      );
    }
    if (
      appointment.status === "completed" ||
      appointment.status === "cancelled"
    ) {
      throw new HttpError(
        409,
        "appointment_is_final",
        "Um agendamento concluído ou cancelado não pode ter o status alterado.",
      );
    }

    if (
      requestedStatus === "cancelled" &&
      (recurrenceScope === "series" || recurrenceScope === "future")
    ) {
      const result = await cancelRecurringSeries({
        appointment,
        cancellationReason: cancellationReason!,
        recurrenceScope,
        establishmentId,
        identity,
        requestId,
      });
      return json({
        appointment: {
          ...result.appointment,
          items: result.items,
        },
        cancelledAppointmentIds: result.cancelledAppointmentIds,
        recurrenceScope,
        idempotent: result.idempotent,
      });
    }

    if (requestedStatus === "completed") {
      const lodging = await getD1Database()
        .prepare(
          `SELECT 1 AS found
          FROM appointment_items ai
          INNER JOIN service_catalog sc ON sc.id = ai.service_catalog_id
          WHERE ai.appointment_id = ? AND sc.code = 'hotel'
          LIMIT 1`,
        )
        .bind(id)
        .first<{ found: number }>();
      if (lodging && appointment.endDate > todayInSaoPaulo()) {
        throw new HttpError(
          409,
          "lodging_checkout_not_reached",
          "A hospedagem só pode ser concluída no dia do checkout. Para uma saída antecipada, edite primeiro a data de saída e as diárias.",
        );
      }
    }

    if (requestedStatus === "cancelled") {
      const financiallyLocked = items.some(
        (item) =>
          item.settlementMethod !== "unsettled" ||
          item.activeInvoiceId !== null,
      );
      if (financiallyLocked) {
        throw new HttpError(
          409,
          "appointment_has_payment",
          "Este agendamento já possui pagamento ou cobrança. Resolva a parte financeira antes de cancelar.",
        );
      }
    }

    const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
    const appointmentUpdate = db
      .update(appointments)
      .set({
        status: requestedStatus,
        cancellationReason:
          requestedStatus === "cancelled" ? cancellationReason : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(appointments.id, id),
          eq(appointments.establishmentId, establishmentId),
          eq(appointments.status, appointment.status),
        ),
      );
    const auditInsert = db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      establishmentId,
      actorUserId: identity.userId,
      actorRole: identity.role,
      action:
        requestedStatus === "cancelled"
          ? "appointment.cancelled"
          : "appointment.status_changed",
      entityType: "appointment",
      entityId: id,
      requestId,
      reason:
        requestedStatus === "cancelled" ? cancellationReason : null,
      metadataJson: JSON.stringify({
        previousStatus: appointment.status,
        status: requestedStatus,
      }),
    });

    if (
      requestedStatus === "completed" ||
      requestedStatus === "cancelled"
    ) {
      await db.batch([
        appointmentUpdate,
        db
          .update(appointmentItems)
          .set({
            status:
              requestedStatus === "completed"
                ? "completed"
                : "cancelled",
            updatedAt: now,
          })
          .where(
            and(
              eq(appointmentItems.appointmentId, id),
              eq(appointmentItems.status, "scheduled"),
            ),
          ),
        auditInsert,
      ]);
    } else {
      await db.batch([appointmentUpdate, auditInsert]);
    }

    const [updatedAppointment, updatedItems] = await Promise.all([
      db
        .select()
        .from(appointments)
        .where(eq(appointments.id, id))
        .limit(1),
      db
        .select()
        .from(appointmentItems)
        .where(eq(appointmentItems.appointmentId, id)),
    ]);

    return json({
      appointment: {
        ...updatedAppointment[0],
        items: updatedItems,
      },
      idempotent: false,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
