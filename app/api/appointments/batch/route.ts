import { and, eq, inArray } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  customerAccounts,
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
import { taxiDogPriceCents } from "@/lib/service-rules";

const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:\d{2}:\d{2}|manha|tarde|noite)$/;
type LodgingRateProfile =
  | "standard"
  | "daycare"
  | "additional_dog"
  | "daycare_additional_dog";

function timeOrder(value: string) {
  if (value === "manha") return 8 * 60;
  if (value === "tarde") return 14 * 60;
  if (value === "noite") return 19 * 60;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) -
      Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000,
  );
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

function uniqueIds(value: unknown, maximum: number, field: string) {
  if (!Array.isArray(value) || !value.length || value.length > maximum) {
    throw new HttpError(400, `invalid_${field}`, `Revise a seleção de ${field === "dogIds" ? "cães" : "serviços"}.`);
  }
  const ids = value.map((item) => typeof item === "string" ? item.trim() : "");
  if (ids.some((id) => !id || id.length > 80) || new Set(ids).size !== ids.length) {
    throw new HttpError(400, `invalid_${field}`, `A seleção de ${field === "dogIds" ? "cães" : "serviços"} contém itens inválidos ou repetidos.`);
  }
  return ids;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "staff"]);
    const body = await readJsonObject(request);
    const dogIds = uniqueIds(body.dogIds, 12, "dogIds");
    const serviceCatalogIds = uniqueIds(body.serviceCatalogIds, 4, "serviceCatalogIds");
    if (dogIds.length * serviceCatalogIds.length > 48) {
      throw new HttpError(400, "batch_too_large", "Crie no máximo 48 atendimentos de uma vez.");
    }
    const date = requiredString(body, "date", 10);
    if (!datePattern.test(date)) {
      throw new HttpError(400, "invalid_date", "A data do agendamento é inválida.");
    }
    const requestedEndDate = optionalString(body, "endDate", 10);
    if (requestedEndDate && !datePattern.test(requestedEndDate)) {
      throw new HttpError(400, "invalid_end_date", "A data de saída é inválida.");
    }
    const startTime = optionalString(body, "startTime", 5);
    const endTime = optionalString(body, "endTime", 5);
    if ((startTime && !timePattern.test(startTime)) || (endTime && !timePattern.test(endTime))) {
      throw new HttpError(400, "invalid_time", "Revise os horários ou períodos informados.");
    }
    const internalNotes = optionalString(body, "internalNotes", 2_000);
    const direction = body.transportDirection === "round_trip" ? "round_trip" : "one_way";
    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [dogRows, serviceRows, [establishment]] = await Promise.all([
      db.select().from(dogs).where(and(
        eq(dogs.establishmentId, establishmentId),
        eq(dogs.status, "active"),
        inArray(dogs.id, dogIds),
      )),
      db.select().from(serviceCatalog).where(and(
        eq(serviceCatalog.establishmentId, establishmentId),
        eq(serviceCatalog.active, true),
        inArray(serviceCatalog.id, serviceCatalogIds),
      )),
      db
        .select()
        .from(establishments)
        .where(eq(establishments.id, establishmentId))
        .limit(1),
    ]);
    if (
      dogRows.length !== dogIds.length ||
      serviceRows.length !== serviceCatalogIds.length ||
      !establishment
    ) {
      throw new HttpError(404, "batch_records_not_found", "Um cão ou serviço não está mais disponível.");
    }
    if (new Set(dogRows.map((dog) => dog.accountId)).size !== 1) {
      throw new HttpError(400, "mixed_customers", "Selecione somente cães do mesmo cliente.");
    }
    const accountId = dogRows[0].accountId;
    const [activeAccount] = await db
      .select({ id: customerAccounts.id })
      .from(customerAccounts)
      .where(
        and(
          eq(customerAccounts.id, accountId),
          eq(customerAccounts.establishmentId, establishmentId),
          eq(customerAccounts.status, "active"),
        ),
      )
      .limit(1);
    if (!activeAccount) {
      throw new HttpError(
        409,
        "customer_inactive",
        "Reative o cliente antes de criar novos serviços.",
      );
    }
    const lodgingService = serviceRows.find((service) => service.code === "hotel");
    const includesLodging = Boolean(lodgingService);
    if (includesLodging && serviceRows.length !== 1) {
      throw new HttpError(
        400,
        "lodging_must_be_separate",
        "Crie a hospedagem separadamente dos serviços realizados em um único dia.",
      );
    }
    if (!includesLodging && startTime && endTime && timeOrder(endTime) <= timeOrder(startTime)) {
      throw new HttpError(400, "invalid_time_range", "O fim deve ser posterior ao início.");
    }

    const endDate = includesLodging ? requestedEndDate : date;
    const durationDays = endDate ? daysBetween(date, endDate) : 0;
    const lodgingNights =
      includesLodging && typeof body.lodgingNights === "number"
        ? body.lodgingNights
        : null;
    const depositPercent =
      includesLodging && typeof body.depositPercent === "number"
        ? body.depositPercent
        : null;
    if (
      body.lodgingDaycareCustomer !== undefined &&
      typeof body.lodgingDaycareCustomer !== "boolean"
    ) {
      throw new HttpError(
        400,
        "invalid_lodging_daycare_customer",
        "Revise a condição de cliente de creche.",
      );
    }
    const lodgingDaycareCustomer = body.lodgingDaycareCustomer === true;
    if (
      includesLodging &&
      (!endDate ||
        durationDays < 1 ||
        lodgingNights === null ||
        !Number.isFinite(lodgingNights) ||
        lodgingNights > 365 ||
        Math.round(lodgingNights * 2) !== lodgingNights * 2 ||
        (lodgingNights !== durationDays && lodgingNights !== durationDays + 0.5))
    ) {
      throw new HttpError(
        400,
        "invalid_lodging_period",
        "Revise a saída e escolha o período em dias ou acrescido de meia diária.",
      );
    }
    if (
      includesLodging &&
      depositPercent !== null &&
      (!Number.isInteger(depositPercent) || depositPercent < 1 || depositPercent > 99)
    ) {
      throw new HttpError(
        400,
        "invalid_deposit_percent",
        "Informe um sinal entre 1% e 99%.",
      );
    }

    const orderedDogs = dogIds.map(
      (dogId) => dogRows.find((dog) => dog.id === dogId)!,
    );
    const d1 = getD1Database();
    if (includesLodging) {
      const overlap = await d1
        .prepare(
          `SELECT a.dog_id AS dogId
           FROM appointments a
           INNER JOIN appointment_items ai ON ai.appointment_id = a.id
           INNER JOIN service_catalog sc
             ON sc.id = ai.service_catalog_id
           WHERE a.establishment_id = ? AND a.status <> 'cancelled'
             AND sc.code = 'hotel'
             AND a.dog_id IN (${dogIds.map(() => "?").join(",")})
             AND a.start_date <= ? AND a.end_date >= ?
           LIMIT 1`,
        )
        .bind(establishmentId, ...dogIds, endDate!, date)
        .first<{ dogId: string }>();
      if (overlap) {
        const dog = orderedDogs.find((item) => item.id === overlap.dogId);
        throw new HttpError(
          409,
          "lodging_overlap",
          `${dog?.name ?? "Um dos cães"} já possui uma hospedagem que se sobrepõe ao período escolhido.`,
        );
      }
    } else {
      const existing = await d1.prepare(
        `SELECT a.dog_id AS dogId, ai.service_catalog_id AS serviceCatalogId
         FROM appointments a
         INNER JOIN appointment_items ai ON ai.appointment_id = a.id
         WHERE a.establishment_id = ? AND a.status <> 'cancelled'
           AND a.start_date = ?
           AND a.dog_id IN (${dogIds.map(() => "?").join(",")})
           AND ai.service_catalog_id IN (${serviceCatalogIds.map(() => "?").join(",")})`,
      ).bind(establishmentId, date, ...dogIds, ...serviceCatalogIds).all<{
        dogId: string;
        serviceCatalogId: string;
      }>();
      if (existing.results.length) {
        const duplicate = existing.results[0];
        const dog = orderedDogs.find((item) => item.id === duplicate.dogId);
        const service = serviceRows.find((item) => item.id === duplicate.serviceCatalogId);
        throw new HttpError(409, "duplicate_appointment", `Já existe ${service?.name ?? "este serviço"} para ${dog?.name ?? "este cão"} nessa data.`);
      }
    }

    const records = orderedDogs.flatMap((dog, dogIndex) =>
      serviceRows.map((service) => {
        const lodgingRateProfile: LodgingRateProfile | null =
          service.code === "hotel" && depositPercent !== null
            ? lodgingDaycareCustomer
              ? dogIndex === 0
                ? "daycare"
                : "daycare_additional_dog"
              : dogIndex === 0
                ? "standard"
                : "additional_dog"
            : null;
        const priceCents =
          service.code === "taxi_dog"
            ? taxiDogPriceCents(service.basePriceCents, direction)
            : service.code === "hotel"
              ? Math.round(
                  lodgingDailyRateCents(
                    establishment,
                    lodgingRateProfile ?? "standard",
                  ) * lodgingNights!,
                )
              : service.basePriceCents;
        return {
          appointmentId: crypto.randomUUID(),
          itemId: crypto.randomUUID(),
          dog,
          service,
          lodgingRateProfile,
          priceCents,
        };
      }),
    );
    const statements: ReturnType<typeof d1.prepare>[] = [];
    for (const record of records) {
      const recordStartTime = record.service.code === "taxi_dog" ? null : startTime;
      const recordEndTime = record.service.code === "taxi_dog" ? null : endTime;
      const recordEndDate = record.service.code === "hotel" ? endDate! : date;
      statements.push(d1.prepare(
        `INSERT INTO appointments (
          id, establishment_id, account_id, dog_id, primary_service_catalog_id, start_date, end_date,
          start_time, end_time, lodging_nights, deposit_percent,
          lodging_rate_profile, lodging_table_daily_rate_cents,
          status, source, internal_notes,
          created_by_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 'manual', ?, ?, ${nowExpression}, ${nowExpression})`,
      ).bind(
        record.appointmentId, establishmentId, record.dog.accountId, record.dog.id,
        record.service.id,
        date, recordEndDate, recordStartTime, recordEndTime,
        record.service.code === "hotel" ? lodgingNights : null,
        record.service.code === "hotel" ? depositPercent : null,
        record.service.code === "hotel" ? record.lodgingRateProfile : null,
        record.service.code === "hotel"
          ? establishment.hotelStandardDailyRateCents
          : null,
        internalNotes, identity.userId,
      ));
      statements.push(d1.prepare(
        `INSERT INTO appointment_items (
          id, appointment_id, service_catalog_id, service_name_snapshot,
          description_snapshot, unit_price_cents, quantity, total_cents,
          status, payment_preference, settlement_method, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'scheduled', 'invoice', 'unsettled', ${nowExpression}, ${nowExpression})`,
      ).bind(
        record.itemId, record.appointmentId, record.service.id, record.service.name,
        record.service.code === "taxi_dog"
          ? direction === "round_trip" ? "Ida e volta" : "Ida"
          : record.service.code === "hotel" && depositPercent
            ? `Sinal de ${depositPercent}% no check-in; saldo no check-out.`
            : null,
        record.priceCents, record.priceCents,
      ));
    }
    statements.push(d1.prepare(
      `INSERT INTO audit_events (
        id, establishment_id, actor_user_id, actor_role, action, entity_type,
        entity_id, request_id, result, metadata_json, occurred_at
      ) VALUES (?, ?, ?, ?, 'appointments.batch_created', 'appointment_batch', ?, ?, 'success', ?, ${nowExpression})`,
    ).bind(
      crypto.randomUUID(), establishmentId, identity.userId, identity.role,
      records[0].appointmentId, requestId, JSON.stringify({
        appointmentIds: records.map((record) => record.appointmentId),
        dogIds,
        serviceCatalogIds,
        date,
        endDate: includesLodging ? endDate : null,
        lodgingNights: includesLodging ? lodgingNights : null,
        depositPercent: includesLodging ? depositPercent : null,
        lodgingDaycareCustomer: includesLodging
          ? lodgingDaycareCustomer
          : null,
        lodgingRateProfiles: includesLodging
          ? records.map((record) => ({
              dogId: record.dog.id,
              profile: record.lodgingRateProfile,
            }))
          : null,
        transportDirection: serviceRows.some((service) => service.code === "taxi_dog") ? direction : null,
      }),
    ));
    try {
      await d1.batch(statements);
    } catch (error) {
      rethrowAppointmentConflict(error);
    }
    return json({
      created: records.length,
      appointmentIds: records.map((record) => record.appointmentId),
      lodging: includesLodging
        ? {
            checkInDate: date,
            checkOutDate: endDate,
            nights: lodgingNights,
            depositPercent,
          }
        : null,
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
