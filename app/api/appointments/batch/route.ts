import { and, eq, inArray } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import { dogs, serviceCatalog } from "@/db/schema";
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

const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:\d{2}:\d{2}|manha|tarde|noite)$/;

function timeOrder(value: string) {
  if (value === "manha") return 8 * 60;
  if (value === "tarde") return 14 * 60;
  if (value === "noite") return 19 * 60;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
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
    const startTime = optionalString(body, "startTime", 5);
    const endTime = optionalString(body, "endTime", 5);
    if ((startTime && !timePattern.test(startTime)) || (endTime && !timePattern.test(endTime))) {
      throw new HttpError(400, "invalid_time", "Revise os horários ou períodos informados.");
    }
    if (startTime && endTime && timeOrder(endTime) <= timeOrder(startTime)) {
      throw new HttpError(400, "invalid_time_range", "O fim deve ser posterior ao início.");
    }
    const internalNotes = optionalString(body, "internalNotes", 2_000);
    const direction = body.transportDirection === "round_trip" ? "round_trip" : "one_way";
    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [dogRows, serviceRows] = await Promise.all([
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
    ]);
    if (dogRows.length !== dogIds.length || serviceRows.length !== serviceCatalogIds.length) {
      throw new HttpError(404, "batch_records_not_found", "Um cão ou serviço não está mais disponível.");
    }
    if (new Set(dogRows.map((dog) => dog.accountId)).size !== 1) {
      throw new HttpError(400, "mixed_customers", "Selecione somente cães do mesmo cliente.");
    }
    if (serviceRows.some((service) => service.code === "hotel")) {
      throw new HttpError(400, "lodging_requires_individual_booking", "Hospedagens devem ser criadas individualmente para preservar diárias, sinal e condições de preço.");
    }

    const d1 = getD1Database();
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
      const dog = dogRows.find((item) => item.id === duplicate.dogId);
      const service = serviceRows.find((item) => item.id === duplicate.serviceCatalogId);
      throw new HttpError(409, "duplicate_appointment", `Já existe ${service?.name ?? "este serviço"} para ${dog?.name ?? "este cão"} nessa data.`);
    }

    const records = dogRows.flatMap((dog) => serviceRows.map((service) => ({
      appointmentId: crypto.randomUUID(),
      itemId: crypto.randomUUID(),
      dog,
      service,
      priceCents: service.code === "taxi_dog"
        ? taxiDogPriceCents(service.basePriceCents, direction)
        : service.basePriceCents,
    })));
    const statements: ReturnType<typeof d1.prepare>[] = [];
    for (const record of records) {
      const recordStartTime = record.service.code === "taxi_dog" ? null : startTime;
      const recordEndTime = record.service.code === "taxi_dog" ? null : endTime;
      statements.push(d1.prepare(
        `INSERT INTO appointments (
          id, establishment_id, account_id, dog_id, start_date, end_date,
          start_time, end_time, status, source, internal_notes,
          created_by_user_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', 'manual', ?, ?, ${nowExpression}, ${nowExpression})`,
      ).bind(
        record.appointmentId, establishmentId, record.dog.accountId, record.dog.id,
        date, date, recordStartTime, recordEndTime, internalNotes, identity.userId,
      ));
      statements.push(d1.prepare(
        `INSERT INTO appointment_items (
          id, appointment_id, service_catalog_id, service_name_snapshot,
          description_snapshot, unit_price_cents, quantity, total_cents,
          status, payment_preference, settlement_method, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'scheduled', 'invoice', 'unsettled', ${nowExpression}, ${nowExpression})`,
      ).bind(
        record.itemId, record.appointmentId, record.service.id, record.service.name,
        record.service.code === "taxi_dog" ? (direction === "round_trip" ? "Ida e volta" : "Ida") : null,
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
        transportDirection: serviceRows.some((service) => service.code === "taxi_dog") ? direction : null,
      }),
    ));
    await d1.batch(statements);
    return json({
      created: records.length,
      appointmentIds: records.map((record) => record.appointmentId),
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
