import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  dogs,
  establishments,
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
import { taxiDogPriceCents } from "@/lib/service-rules";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
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
  const bothPeriods =
    !start.includes(":") && !end.includes(":");
  return bothPeriods
    ? operationalTimeOrder(end) < operationalTimeOrder(start)
    : operationalTimeOrder(end) <= operationalTimeOrder(start);
}

function shiftIsoDate(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) -
      Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000,
  );
}

function chunksOf<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "staff"]);
    const body = await readJsonObject(request);
    const dogId = requiredString(body, "dogId", 80);
    const serviceCatalogId = requiredString(body, "serviceCatalogId", 80);
    const startDate = requiredString(body, "startDate", 10);
    const endDate =
      optionalString(body, "endDate", 10) ?? startDate;
    const startTime = optionalString(body, "startTime", 5);
    const endTime = optionalString(body, "endTime", 5);
    const internalNotes = optionalString(body, "internalNotes", 2_000);
    const recurrence =
      body.recurrence === undefined ? "none" : body.recurrence;
    if (recurrence !== "none" && recurrence !== "weekly") {
      throw new HttpError(
        400,
        "invalid_recurrence",
        "Escolha uma recorrência válida.",
      );
    }
    const recurrenceCount =
      recurrence === "weekly"
        ? body.recurrenceCount === undefined
          ? 12
          : body.recurrenceCount
        : 1;
    if (
      typeof recurrenceCount !== "number" ||
      !Number.isSafeInteger(recurrenceCount) ||
      recurrenceCount < 1 ||
      recurrenceCount > 52
    ) {
      throw new HttpError(
        400,
        "invalid_recurrence_count",
        "Informe uma duração entre 1 e 52 semanas.",
      );
    }
    if (!isoDatePattern.test(startDate) || !isoDatePattern.test(endDate)) {
      throw new HttpError(400, "invalid_date", "A data informada é inválida.");
    }
    const durationDays = daysBetween(startDate, endDate);
    if (durationDays < 0) {
      throw new HttpError(
        400,
        "invalid_date_range",
        "A data final deve ser igual ou posterior à inicial.",
      );
    }
    if (startTime && !operationalTimePattern.test(startTime)) {
      throw new HttpError(400, "invalid_time", "O horário inicial é inválido.");
    }
    if (endTime && !operationalTimePattern.test(endTime)) {
      throw new HttpError(400, "invalid_time", "O horário final é inválido.");
    }
    if (
      startDate === endDate &&
      startTime &&
      endTime &&
      invalidTimeRange(startTime, endTime)
    ) {
      throw new HttpError(
        400,
        "invalid_time_range",
        "O horário final deve ser posterior ao inicial.",
      );
    }

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [[dog], [service], [establishment]] = await Promise.all([
      db
        .select()
        .from(dogs)
        .where(
          and(
            eq(dogs.id, dogId),
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
            eq(serviceCatalog.id, serviceCatalogId),
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
        404,
        "record_not_found",
        "Cão ou serviço não encontrado.",
      );
    }
    if (service.code === "bath_grooming") {
      throw new HttpError(
        400,
        "service_not_schedulable",
        "Agende um banho e marque a opção de incluir tosa.",
      );
    }
    if (body.groomingAddon !== undefined && typeof body.groomingAddon !== "boolean") {
      throw new HttpError(400, "invalid_grooming_addon", "Revise a opção de tosa.");
    }
    const groomingAddon = service.code === "bath" && body.groomingAddon === true;
    if (recurrence === "weekly" && service.code === "hotel") {
      throw new HttpError(
        400,
        "lodging_recurrence_not_supported",
        "Hospedagens devem ser agendadas individualmente para preservar datas, diárias e valores.",
      );
    }

    const lodgingNights = typeof body.lodgingNights === "number" ? body.lodgingNights : null;
    const depositPercent = typeof body.depositPercent === "number" ? body.depositPercent : null;
    const lodgingRateProfile: LodgingRateProfile | null =
      service.code === "hotel" && depositPercent !== null
        ? body.lodgingRateProfile === undefined
          ? "standard"
          : isLodgingRateProfile(body.lodgingRateProfile)
            ? body.lodgingRateProfile
            : null
        : null;
    if (service.code === "hotel") {
      if (
        lodgingNights === null ||
        !Number.isFinite(lodgingNights) ||
        durationDays < 1 ||
        lodgingNights > 365 ||
        Math.round(lodgingNights * 2) !== lodgingNights * 2 ||
        (lodgingNights !== durationDays &&
          lodgingNights !== durationDays + 0.5)
      ) {
        throw new HttpError(
          400,
          "invalid_lodging_nights",
          "Escolha o período em dias ou o período acrescido de meia diária.",
        );
      }
      if (depositPercent !== null && (!Number.isInteger(depositPercent) || depositPercent < 1 || depositPercent > 99)) {
        throw new HttpError(400, "invalid_deposit_percent", "Informe um sinal entre 1% e 99%.");
      }
      if (depositPercent !== null && !lodgingRateProfile) {
        throw new HttpError(
          400,
          "invalid_lodging_rate_profile",
          "Escolha uma condição de diária válida para a hospedagem.",
        );
      }
    }
    const direction = body.transportDirection === "round_trip" ? "round_trip" : "one_way";
    const catalogPriceCents =
      service.code === "taxi_dog"
        ? taxiDogPriceCents(service.basePriceCents, direction)
        : service.code === "hotel"
          ? Math.round(
              lodgingDailyRateCents(establishment, lodgingRateProfile ?? "standard") *
                (lodgingNights ?? 1),
            )
          : service.basePriceCents +
            (groomingAddon ? establishment.bathGroomingAddonCents : 0);
    // O agendamento preserva o valor de referência. Eventuais ajustes são
    // decididos somente após a conclusão, no fluxo de cobrança regular.
    const priceCents = catalogPriceCents;
    const recurringScheduleId =
      recurrence === "weekly" ? crypto.randomUUID() : null;
    const occurrenceDates = Array.from(
      { length: recurrenceCount },
      (_, index) => shiftIsoDate(startDate, index * 7),
    );
    const createdAppointments = occurrenceDates.map((occurrenceStartDate) => ({
      id: crypto.randomUUID(),
      itemId: crypto.randomUUID(),
      startDate: occurrenceStartDate,
      endDate: shiftIsoDate(occurrenceStartDate, durationDays),
    }));

    const existingDuplicate = await getD1Database()
      .prepare(
        `SELECT a.start_date AS startDate
        FROM appointments a
        INNER JOIN appointment_items ai ON ai.appointment_id = a.id
        WHERE a.establishment_id = ?
          AND a.dog_id = ?
          AND ai.service_catalog_id = ?
          AND a.status <> 'cancelled'
          AND a.start_date IN (${occurrenceDates.map(() => "?").join(", ")})
        LIMIT 1`,
      )
      .bind(establishmentId, dog.id, service.id, ...occurrenceDates)
      .first<{ startDate: string }>();
    if (existingDuplicate) {
      throw new HttpError(
        409,
        "duplicate_appointment",
        `Já existe um agendamento de ${service.name} para este cão nessa data. Revise a Agenda antes de continuar.`,
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
            AND a.status <> 'cancelled' AND sc.code = 'hotel'
            AND a.start_date <= ? AND a.end_date >= ?
          LIMIT 1`,
        )
        .bind(establishmentId, dog.id, endDate, startDate)
        .first<{ id: string }>();
      if (lodgingOverlap) {
        throw new HttpError(
          409,
          "lodging_overlap",
          "Este cão já possui uma hospedagem que se sobrepõe ao período escolhido.",
        );
      }
    }
    const description =
      service.code === "taxi_dog"
        ? direction === "round_trip"
          ? "Ida e volta"
          : "Ida"
        : groomingAddon
          ? "Com tosa"
        : service.code === "hotel" && depositPercent
          ? `Sinal de ${depositPercent}% no check-in; saldo no check-out.`
          : null;
    const serviceName = groomingAddon ? "Banho e tosa" : service.name;
    const detailsJson = groomingAddon
      ? JSON.stringify({ groomingAddon: true })
      : null;
    const d1 = getD1Database();
    const statements = [];

    if (recurringScheduleId) {
      const weekday = new Date(`${startDate}T12:00:00.000Z`).getUTCDay();
      statements.push(
        d1
          .prepare(
            `INSERT INTO recurring_schedules (
              id, establishment_id, dog_id, service_catalog_id,
              weekdays_mask, starts_on, ends_on, start_time, end_time,
              fixed_price_cents, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active',
              ${nowExpression}, ${nowExpression})`,
          )
          .bind(
            recurringScheduleId,
            establishmentId,
            dog.id,
            service.id,
            1 << weekday,
            startDate,
            occurrenceDates.at(-1)!,
            startTime,
            endTime,
            priceCents,
          ),
      );
    }

    for (const appointmentChunk of chunksOf(createdAppointments, 5)) {
      const placeholders = appointmentChunk
        .map(
          () =>
            `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?,
              ${nowExpression}, ${nowExpression})`,
        )
        .join(", ");
      statements.push(
        d1
          .prepare(
            `INSERT INTO appointments (
              id, establishment_id, account_id, dog_id, start_date, end_date,
              start_time, end_time, lodging_nights, deposit_percent,
              lodging_rate_profile, lodging_table_daily_rate_cents, status,
              source, recurring_schedule_id, occurrence_date, internal_notes,
              created_by_user_id, created_at, updated_at
            ) VALUES ${placeholders}`,
          )
          .bind(
            ...appointmentChunk.flatMap((created) => [
              created.id,
              establishmentId,
              dog.accountId,
              dog.id,
              created.startDate,
              created.endDate,
              startTime,
              endTime,
              service.code === "hotel" ? lodgingNights : null,
              service.code === "hotel" ? depositPercent : null,
              service.code === "hotel" ? lodgingRateProfile : null,
              service.code === "hotel"
                ? establishment.hotelStandardDailyRateCents
                : null,
              recurringScheduleId ? "recurring" : "manual",
              recurringScheduleId,
              recurringScheduleId ? created.startDate : null,
              internalNotes,
              identity.userId,
            ]),
          ),
      );
    }

    for (const itemChunk of chunksOf(createdAppointments, 10)) {
      const placeholders = itemChunk
        .map(
          () =>
            `(?, ?, ?, ?, ?, ?, ?, 1, ?, 'scheduled', ?, 'unsettled',
              ${nowExpression}, ${nowExpression})`,
        )
        .join(", ");
      statements.push(
        d1
          .prepare(
            `INSERT INTO appointment_items (
              id, appointment_id, service_catalog_id, service_name_snapshot,
              description_snapshot, details_json, unit_price_cents, quantity, total_cents,
              status, payment_preference, settlement_method, created_at,
              updated_at
            ) VALUES ${placeholders}`,
          )
          .bind(
            ...itemChunk.flatMap((created) => [
              created.itemId,
              created.id,
              service.id,
              serviceName,
              description,
              detailsJson,
              priceCents,
              priceCents,
              "invoice",
            ]),
          ),
      );
    }

    const auditId = crypto.randomUUID();
    statements.push(
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, result, metadata_json,
            occurred_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'success', ?, ${nowExpression})`,
        )
        .bind(
          auditId,
          establishmentId,
          identity.userId,
          identity.role,
          recurringScheduleId
            ? "recurring_schedule.created"
            : "appointment.created",
          recurringScheduleId ? "recurring_schedule" : "appointment",
          recurringScheduleId ?? createdAppointments[0].id,
          requestId,
          JSON.stringify({
            appointmentIds: createdAppointments.map((item) => item.id),
            occurrenceCount: createdAppointments.length,
            dogId: dog.id,
            serviceCatalogId: service.id,
            transportDirection:
              service.code === "taxi_dog" ? direction : null,
            groomingAddon,
            lodgingNights:
              service.code === "hotel" ? lodgingNights : null,
            depositPercent:
              service.code === "hotel" ? depositPercent : null,
            lodgingRateProfile:
              service.code === "hotel" ? lodgingRateProfile : null,
          }),
        ),
    );
    await d1.batch(statements);

    return json(
      {
        appointment: {
          id: createdAppointments[0].id,
          itemId: createdAppointments[0].itemId,
          dogId: dog.id,
          dogName: dog.name,
          serviceName,
          priceCents,
          startDate: createdAppointments[0].startDate,
          endDate: createdAppointments[0].endDate,
          startTime,
          endTime,
          status: "scheduled",
          paymentPreference: "invoice",
          settlementMethod: "unsettled",
          recurringScheduleId,
          groomingAddon,
        },
        appointments: createdAppointments.map((item) => ({
          ...item,
          recurringScheduleId,
        })),
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
