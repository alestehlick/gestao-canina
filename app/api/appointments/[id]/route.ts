import { and, eq, sql } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  appointmentItems,
  appointments,
  auditEvents,
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

const appointmentStatuses = [
  "scheduled",
  "confirmed",
  "in_transit",
  "present",
  "in_service",
  "completed",
  "cancelled",
] as const;

type AppointmentStatus = (typeof appointmentStatuses)[number];

function isAppointmentStatus(value: string): value is AppointmentStatus {
  return appointmentStatuses.includes(value as AppointmentStatus);
}

const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

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
    if (requestedStatus !== null && !isAppointmentStatus(requestedStatus)) {
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
      const paymentPreference =
        body.paymentPreference === undefined
          ? item.paymentPreference
          : body.paymentPreference;
      const priceCents =
        body.priceCents === undefined ? item.totalCents : body.priceCents;

      if (
        !startDate ||
        !endDate ||
        !serviceCatalogId ||
        !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
        (startTime !== null && !/^\d{2}:\d{2}$/.test(startTime)) ||
        (endTime !== null && !/^\d{2}:\d{2}$/.test(endTime)) ||
        (startDate === endDate &&
          startTime &&
          endTime &&
          endTime <= startTime)
      ) {
        throw new HttpError(
          400,
          "invalid_schedule",
          "Revise a data e os horários do serviço.",
        );
      }
      if (
        paymentPreference !== "invoice" &&
        paymentPreference !== "credit"
      ) {
        throw new HttpError(
          400,
          "invalid_payment_preference",
          "Escolha fatura ou crédito para o pagamento.",
        );
      }
      if (
        typeof priceCents !== "number" ||
        !Number.isSafeInteger(priceCents) ||
        priceCents < 0 ||
        priceCents > 100_000_000
      ) {
        throw new HttpError(
          400,
          "invalid_price",
          "O valor do serviço é inválido.",
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
      if (
        paymentPreference === "credit" &&
        !["daycare", "bath", "bath_grooming", "taxi_dog"].includes(service.code)
      ) {
        throw new HttpError(
          400,
          "service_not_credit_eligible",
          "Este serviço não pode ser pago com créditos.",
        );
      }

      const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
      await db.batch([
        db
          .update(appointments)
          .set({
            startDate,
            endDate,
            startTime,
            endTime,
            internalNotes,
            updatedAt: now,
          })
          .where(eq(appointments.id, id)),
        db
          .update(appointmentItems)
          .set({
            serviceCatalogId: service.id,
            serviceNameSnapshot: service.name,
            unitPriceCents: priceCents,
            totalCents: priceCents,
            paymentPreference,
            updatedAt: now,
          })
          .where(eq(appointmentItems.id, item.id)),
        db.insert(auditEvents).values({
          id: crypto.randomUUID(),
          establishmentId,
          actorUserId: identity.userId,
          actorRole: identity.role,
          action: "appointment.updated",
          entityType: "appointment",
          entityId: id,
          requestId,
        }),
      ]);

      return json({
        appointment: {
          id,
          startDate,
          endDate,
          startTime,
          endTime,
          internalNotes,
          serviceCatalogId: service.id,
          serviceName: service.name,
          priceCents,
          paymentPreference,
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

    if (requestedStatus === "completed") {
      const pendingCreditItems = items.filter(
        (item) =>
          item.status === "scheduled" &&
          item.paymentPreference === "credit" &&
          item.settlementMethod !== "credit",
      );
      if (pendingCreditItems.length > 0) {
        throw new HttpError(
          409,
          "credit_settlement_required",
          "Use o crédito disponível antes de concluir este serviço.",
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
