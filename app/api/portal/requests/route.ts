import { and, eq, inArray, sql } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  appUsers,
  appointments,
  customerRequests,
  dogs,
  dogTutors,
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
  requiredString,
} from "@/lib/server/http";
import { todayInSaoPaulo } from "@/lib/service-rules";

const operationalTimePattern = /^(?:\d{2}:\d{2}|manha|tarde|noite)$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function uniqueIds(value: unknown, maximum: number, label: string) {
  if (!Array.isArray(value) || !value.length || value.length > maximum) {
    throw new HttpError(400, `invalid_${label}`, `Revise a seleção de ${label}.`);
  }
  const ids = value.map((item) =>
    typeof item === "string" ? item.trim() : "",
  );
  if (
    ids.some((id) => !id || id.length > 80) ||
    new Set(ids).size !== ids.length
  ) {
    throw new HttpError(
      400,
      `invalid_${label}`,
      `A seleção de ${label} contém itens inválidos ou repetidos.`,
    );
  }
  return ids;
}

function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) -
      Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000,
  );
}

function requestDetails(body: Record<string, unknown>, serviceCode: string) {
  const groomingAddon = serviceCode === "bath" && body.groomingAddon === true;
  const transportDirection =
    serviceCode === "taxi_dog" && body.transportDirection === "round_trip"
      ? "round_trip"
      : "one_way";
  const transportDistance =
    serviceCode === "taxi_dog" && body.transportDistance === "long"
      ? "long"
      : "short";
  return { groomingAddon, transportDirection, transportDistance };
}

async function createBatchServiceRequests({
  body,
  identity,
  requestId,
}: {
  body: Record<string, unknown>;
  identity: Awaited<ReturnType<typeof requireIdentity>>;
  requestId: string;
}) {
  const dogIds = uniqueIds(body.dogIds, 12, "cães");
  const serviceCatalogIds = uniqueIds(body.serviceCatalogIds, 4, "serviços");
  if (dogIds.length * serviceCatalogIds.length > 48) {
    throw new HttpError(
      400,
      "request_batch_too_large",
      "Envie no máximo 48 solicitações de uma vez.",
    );
  }

  const requestedDate = requiredString(body, "requestedDate", 10);
  const requestedEndDate = optionalString(body, "requestedEndDate", 10);
  const requestedStartTime = optionalString(body, "requestedStartTime", 10);
  const requestedEndTime = optionalString(body, "requestedEndTime", 10);
  const notes = optionalString(body, "notes", 2_000);
  if (
    !datePattern.test(requestedDate) ||
    (requestedEndDate && !datePattern.test(requestedEndDate))
  ) {
    throw new HttpError(400, "invalid_request_dates", "Revise as datas desejadas.");
  }
  if (requestedDate < todayInSaoPaulo()) {
    throw new HttpError(
      400,
      "request_date_in_past",
      "Escolha hoje ou uma data futura para o serviço.",
    );
  }
  if (
    (requestedStartTime && !operationalTimePattern.test(requestedStartTime)) ||
    (requestedEndTime && !operationalTimePattern.test(requestedEndTime))
  ) {
    throw new HttpError(
      400,
      "invalid_request_time",
      "Revise o período ou horário desejado.",
    );
  }

  const establishmentId = identity.establishmentId!;
  const db = getDb();
  const [context] = await db
    .select({
      accountId: tutors.accountId,
      tutorId: tutors.id,
    })
    .from(appUsers)
    .innerJoin(tutors, eq(tutors.id, appUsers.tutorId))
    .where(
      and(
        eq(appUsers.id, identity.userId!),
        eq(appUsers.establishmentId, establishmentId),
        eq(appUsers.status, "active"),
      ),
    )
    .limit(1);
  if (!context) {
    throw new HttpError(
      403,
      "customer_link_missing",
      "Sua conta não está ligada a um cadastro de cliente.",
    );
  }

  const [dogRows, serviceRows] = await Promise.all([
    db
      .select({ id: dogs.id, name: dogs.name })
      .from(dogs)
      .innerJoin(
        dogTutors,
        and(
          eq(dogTutors.dogId, dogs.id),
          eq(dogTutors.tutorId, context.tutorId),
          eq(dogTutors.portalVisible, true),
        ),
      )
      .where(
        and(
          eq(dogs.accountId, context.accountId),
          eq(dogs.establishmentId, establishmentId),
          eq(dogs.status, "active"),
          inArray(dogs.id, dogIds),
        ),
      ),
    db
      .select({
        id: serviceCatalog.id,
        code: serviceCatalog.code,
        name: serviceCatalog.name,
      })
      .from(serviceCatalog)
      .where(
        and(
          eq(serviceCatalog.establishmentId, establishmentId),
          eq(serviceCatalog.active, true),
          inArray(serviceCatalog.id, serviceCatalogIds),
        ),
      ),
  ]);
  if (
    dogRows.length !== dogIds.length ||
    serviceRows.length !== serviceCatalogIds.length
  ) {
    throw new HttpError(
      404,
      "request_records_not_found",
      "Um cão ou serviço selecionado não está mais disponível.",
    );
  }
  if (serviceRows.some((service) => ["bath_grooming", "other"].includes(service.code))) {
    throw new HttpError(
      400,
      "service_not_requestable",
      "Um dos serviços selecionados não está disponível para pedidos pelo portal.",
    );
  }

  const lodgingService = serviceRows.find((service) => service.code === "hotel");
  if (lodgingService && serviceRows.length !== 1) {
    throw new HttpError(
      400,
      "lodging_must_be_separate",
      "Solicite a hospedagem separadamente dos serviços realizados em um único dia.",
    );
  }
  const durationDays = requestedEndDate
    ? daysBetween(requestedDate, requestedEndDate)
    : 0;
  const lodgingNights =
    lodgingService && typeof body.lodgingNights === "number"
      ? body.lodgingNights
      : null;
  if (
    lodgingService &&
    (!requestedEndDate ||
      durationDays < 1 ||
      durationDays > 365 ||
      lodgingNights === null ||
      !Number.isFinite(lodgingNights) ||
      Math.round(lodgingNights * 2) !== lodgingNights * 2 ||
      (lodgingNights !== durationDays && lodgingNights !== durationDays + 0.5))
  ) {
    throw new HttpError(
      400,
      "invalid_lodging_period",
      "Revise a saída e escolha o período em dias ou acrescido de meia diária.",
    );
  }

  const orderedDogs = dogIds.map(
    (dogId) => dogRows.find((dog) => dog.id === dogId)!,
  );
  const orderedServices = serviceCatalogIds.map(
    (serviceId) => serviceRows.find((service) => service.id === serviceId)!,
  );
  const d1 = getD1Database();

  if (lodgingService) {
    const overlap = await d1
      .prepare(
        `SELECT cr.dog_id AS dogId
         FROM customer_requests cr
         WHERE cr.establishment_id = ? AND cr.account_id = ?
           AND cr.type = 'service' AND cr.status = 'pending'
           AND cr.service_catalog_id = ?
           AND cr.dog_id IN (${dogIds.map(() => "?").join(",")})
           AND cr.requested_date <= ?
           AND coalesce(cr.requested_end_date, cr.requested_date) >= ?
         LIMIT 1`,
      )
      .bind(
        establishmentId,
        context.accountId,
        lodgingService.id,
        ...dogIds,
        requestedEndDate!,
        requestedDate,
      )
      .first<{ dogId: string }>();
    if (overlap) {
      const dog = orderedDogs.find((item) => item.id === overlap.dogId);
      throw new HttpError(
        409,
        "duplicate_customer_request",
        `Já existe um pedido de hospedagem de ${dog?.name ?? "um dos cães"} aguardando análise nesse período.`,
      );
    }
  } else {
    const duplicate = await d1
      .prepare(
        `SELECT cr.dog_id AS dogId, cr.service_catalog_id AS serviceCatalogId
         FROM customer_requests cr
         WHERE cr.establishment_id = ? AND cr.account_id = ?
           AND cr.type = 'service' AND cr.status = 'pending'
           AND cr.requested_date = ?
           AND cr.dog_id IN (${dogIds.map(() => "?").join(",")})
           AND cr.service_catalog_id IN (${serviceCatalogIds.map(() => "?").join(",")})
         LIMIT 1`,
      )
      .bind(
        establishmentId,
        context.accountId,
        requestedDate,
        ...dogIds,
        ...serviceCatalogIds,
      )
      .first<{ dogId: string; serviceCatalogId: string }>();
    if (duplicate) {
      const dog = orderedDogs.find((item) => item.id === duplicate.dogId);
      const service = orderedServices.find(
        (item) => item.id === duplicate.serviceCatalogId,
      );
      throw new HttpError(
        409,
        "duplicate_customer_request",
        `Já existe um pedido de ${service?.name ?? "serviço"} para ${dog?.name ?? "este cão"} nessa data.`,
      );
    }
  }

  const records = orderedDogs.flatMap((dog) =>
    orderedServices.map((service) => ({
      id: crypto.randomUUID(),
      dog,
      service,
    })),
  );
  const requestGroupId = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements: ReturnType<typeof d1.prepare>[] = [];
  for (const record of records) {
    const details = {
      ...requestDetails(body, record.service.code),
      requestGroupId,
      requestGroupSize: records.length,
      ...(record.service.code === "hotel" ? { lodgingNights } : {}),
    };
    statements.push(
      d1
        .prepare(
          `INSERT INTO customer_requests (
            id, establishment_id, account_id, requested_by_user_id, type,
            status, dog_id, service_catalog_id, requested_date,
            requested_end_date, requested_start_time, requested_end_time,
            details_json, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'service', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          record.id,
          establishmentId,
          context.accountId,
          identity.userId,
          record.dog.id,
          record.service.id,
          requestedDate,
          record.service.code === "hotel" ? requestedEndDate : null,
          record.service.code === "taxi_dog" ? null : requestedStartTime,
          record.service.code === "taxi_dog" ? null : requestedEndTime,
          JSON.stringify(details),
          notes,
          now,
          now,
        ),
    );
  }
  statements.push(
    d1
      .prepare(
        `INSERT INTO audit_events (
          id, establishment_id, actor_user_id, actor_role, action,
          entity_type, entity_id, request_id, result, metadata_json,
          occurred_at
        ) VALUES (?, ?, ?, ?, 'customer.requests_batch_created',
          'customer_request_batch', ?, ?, 'success', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        establishmentId,
        identity.userId,
        identity.role,
        requestGroupId,
        requestId,
        JSON.stringify({
          requestIds: records.map((record) => record.id),
          dogIds,
          serviceCatalogIds,
          requestedDate,
          requestedEndDate: lodgingService ? requestedEndDate : null,
          lodgingNights: lodgingService ? lodgingNights : null,
        }),
        now,
      ),
  );
  try {
    await d1.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("customer_requests_pending_service_unique") ||
      message.includes("customer_request_lodging_overlap") ||
      message.includes(
        "customer_requests.establishment_id, customer_requests.dog_id, customer_requests.service_catalog_id, customer_requests.requested_date",
      )
    ) {
      throw new HttpError(
        409,
        "duplicate_customer_request",
        "Um destes pedidos já está aguardando análise. Atualize a página e confira a lista.",
      );
    }
    throw error;
  }

  return json(
    {
      created: records.length,
      requestGroupId,
      requests: records.map((record) => ({
        id: record.id,
        type: "service",
        status: "pending",
        dogId: record.dog.id,
        serviceCatalogId: record.service.id,
        requestedDate,
        requestedEndDate:
          record.service.code === "hotel" ? requestedEndDate : null,
        createdAt: now,
      })),
    },
    { status: 201 },
  );
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["customer"]);
    const establishmentId = identity.establishmentId!;
    const body = await readJsonObject(request);
    const type = requiredString(body, "type", 30);
    if (type !== "service" && type !== "cancellation") {
      throw new HttpError(400, "invalid_request_type", "O pedido é inválido.");
    }
    if (
      type === "service" &&
      (Array.isArray(body.dogIds) || Array.isArray(body.serviceCatalogIds))
    ) {
      return await createBatchServiceRequests({ body, identity, requestId });
    }
    const dogId = optionalString(body, "dogId", 80);
    const appointmentId = optionalString(body, "appointmentId", 80);
    const serviceCatalogId = optionalString(body, "serviceCatalogId", 80);
    const requestedDate = optionalString(body, "requestedDate", 10);
    const requestedEndDate = optionalString(body, "requestedEndDate", 10);
    const requestedStartTime = optionalString(body, "requestedStartTime", 10);
    const requestedEndTime = optionalString(body, "requestedEndTime", 10);
    const notes = optionalString(body, "notes", 2_000);
    if (
      (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) ||
      (requestedEndDate &&
        !/^\d{4}-\d{2}-\d{2}$/.test(requestedEndDate)) ||
      (requestedDate &&
        requestedEndDate &&
        requestedEndDate < requestedDate)
    ) {
      throw new HttpError(
        400,
        "invalid_request_dates",
        "Revise as datas desejadas.",
      );
    }
    const today = todayInSaoPaulo();
    if (type === "service" && requestedDate && requestedDate < today) {
      throw new HttpError(
        400,
        "request_date_in_past",
        "Escolha hoje ou uma data futura para o serviço.",
      );
    }
    if (type === "service" && (!dogId || !serviceCatalogId || !requestedDate)) {
      throw new HttpError(
        400,
        "service_request_incomplete",
        "Escolha o cão, serviço e data desejada.",
      );
    }
    if (type === "cancellation" && !appointmentId) {
      throw new HttpError(
        400,
        "cancellation_request_incomplete",
        "Escolha o serviço que deseja cancelar.",
      );
    }
    const [context] = await getDb()
      .select({
        accountId: tutors.accountId,
        tutorId: tutors.id,
      })
      .from(appUsers)
      .innerJoin(tutors, eq(tutors.id, appUsers.tutorId))
      .where(
        and(
          eq(appUsers.id, identity.userId!),
          eq(appUsers.establishmentId, establishmentId),
          eq(appUsers.status, "active"),
        ),
      )
      .limit(1);
    if (!context) {
      throw new HttpError(
        403,
        "customer_link_missing",
        "Sua conta não está ligada a um cadastro de cliente.",
      );
    }
    if (dogId) {
      const [dog] = await getDb()
        .select({ id: dogs.id })
        .from(dogs)
        .innerJoin(
          dogTutors,
          and(
            eq(dogTutors.dogId, dogs.id),
            eq(dogTutors.tutorId, context.tutorId),
            eq(dogTutors.portalVisible, true),
          ),
        )
        .where(
          and(
            eq(dogs.id, dogId),
            eq(dogs.accountId, context.accountId),
            eq(dogs.establishmentId, establishmentId),
          ),
        )
        .limit(1);
      if (!dog) {
        throw new HttpError(404, "dog_not_found", "O cão não foi encontrado.");
      }
    }
    if (appointmentId) {
      const [appointment] = await getDb()
        .select({ id: appointments.id, status: appointments.status })
        .from(appointments)
        .innerJoin(
          dogTutors,
          and(
            eq(dogTutors.dogId, appointments.dogId),
            eq(dogTutors.tutorId, context.tutorId),
            eq(dogTutors.portalVisible, true),
          ),
        )
        .where(
          and(
            eq(appointments.id, appointmentId),
            eq(appointments.accountId, context.accountId),
            eq(appointments.establishmentId, establishmentId),
          ),
        )
        .limit(1);
      if (!appointment) {
        throw new HttpError(
          404,
          "appointment_not_found",
          "O atendimento não foi encontrado.",
        );
      }
      if (
        appointment.status === "completed" ||
        appointment.status === "cancelled"
      ) {
        throw new HttpError(
          409,
          "appointment_not_cancellable",
          "Este atendimento não pode mais ser cancelado pelo portal.",
        );
      }
    }
    let selectedService: { id: string; code: string; name: string } | undefined;
    if (serviceCatalogId) {
      const [service] = await getDb()
        .select({
          id: serviceCatalog.id,
          code: serviceCatalog.code,
          name: serviceCatalog.name,
        })
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
          "O serviço não foi encontrado.",
        );
      }
      if (service.code === "bath_grooming") {
        throw new HttpError(
          400,
          "service_not_requestable",
          "Solicite um banho e marque a opção de incluir tosa.",
        );
      }
      if (service.code === "other") {
        throw new HttpError(
          400,
          "service_not_requestable",
          "Este tipo de serviço não está disponível para pedidos pelo portal.",
        );
      }
      selectedService = service;
    }

    let normalizedEndDate = requestedEndDate;
    let normalizedStartTime = requestedStartTime;
    let normalizedEndTime = requestedEndTime;
    let details: ReturnType<typeof requestDetails> | null = null;
    if (type === "service" && selectedService && requestedDate) {
      if (selectedService.code === "hotel") {
        if (!requestedEndDate || daysBetween(requestedDate, requestedEndDate) < 1) {
          throw new HttpError(
            400,
            "lodging_dates_required",
            "Informe uma data de saída posterior à entrada.",
          );
        }
        if (daysBetween(requestedDate, requestedEndDate) > 365) {
          throw new HttpError(
            400,
            "lodging_too_long",
            "O período de hospedagem deve ter no máximo 365 dias.",
          );
        }
      } else {
        normalizedEndDate = null;
      }
      if (selectedService.code === "taxi_dog") {
        normalizedStartTime = null;
        normalizedEndTime = null;
      }
      if (
        (normalizedStartTime && !operationalTimePattern.test(normalizedStartTime)) ||
        (normalizedEndTime && !operationalTimePattern.test(normalizedEndTime))
      ) {
        throw new HttpError(
          400,
          "invalid_request_time",
          "Revise o período ou horário desejado.",
        );
      }
      details = requestDetails(body, selectedService.code);

      const duplicate = await getDb()
        .select({ id: customerRequests.id })
        .from(customerRequests)
        .where(
          and(
            eq(customerRequests.establishmentId, establishmentId),
            eq(customerRequests.accountId, context.accountId),
            eq(customerRequests.type, "service"),
            eq(customerRequests.status, "pending"),
            eq(customerRequests.dogId, dogId!),
            eq(customerRequests.serviceCatalogId, serviceCatalogId!),
            selectedService.code === "hotel"
              ? sql`${customerRequests.requestedDate} <= ${requestedEndDate} and coalesce(${customerRequests.requestedEndDate}, ${customerRequests.requestedDate}) >= ${requestedDate}`
              : eq(customerRequests.requestedDate, requestedDate),
          ),
        )
        .limit(1);
      if (duplicate[0]) {
        throw new HttpError(
          409,
          "duplicate_customer_request",
          "Este pedido já está aguardando análise.",
        );
      }
    }

    if (type === "cancellation" && appointmentId) {
      const [pendingCancellation] = await getDb()
        .select({ id: customerRequests.id })
        .from(customerRequests)
        .where(
          and(
            eq(customerRequests.establishmentId, establishmentId),
            eq(customerRequests.type, "cancellation"),
            eq(customerRequests.status, "pending"),
            eq(customerRequests.appointmentId, appointmentId),
          ),
        )
        .limit(1);
      if (pendingCancellation) {
        throw new HttpError(
          409,
          "duplicate_cancellation_request",
          "O cancelamento deste serviço já está aguardando análise.",
        );
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const d1 = getD1Database();
    try {
      await d1.batch([
        d1
        .prepare(
          `INSERT INTO customer_requests (
            id, establishment_id, account_id, requested_by_user_id, type,
            status, dog_id, appointment_id, service_catalog_id,
            requested_date, requested_end_date, requested_start_time,
            requested_end_time, details_json, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          establishmentId,
          context.accountId,
          identity.userId,
          type,
          dogId,
          appointmentId,
          serviceCatalogId,
          requestedDate,
          normalizedEndDate,
          normalizedStartTime,
          normalizedEndTime,
          details ? JSON.stringify(details) : null,
          notes,
          now,
          now,
        ),
        d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, result, metadata_json,
            occurred_at
          ) VALUES (?, ?, ?, ?, 'customer.request_created',
            'customer_request', ?, ?, 'success', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          establishmentId,
          identity.userId,
          identity.role,
          id,
          requestId,
          JSON.stringify({
            type,
            accountId: context.accountId,
            dogId,
            appointmentId,
            serviceCatalogId,
            requestedDate,
            requestedEndDate: normalizedEndDate,
            requestedStartTime: normalizedStartTime,
            requestedEndTime: normalizedEndTime,
            details,
          }),
          now,
        ),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes("customer_requests_pending_service_unique") ||
        message.includes("customer_requests_pending_cancellation_unique") ||
        message.includes("customer_request_lodging_overlap") ||
        message.includes("customer_requests.appointment_id") ||
        message.includes(
          "customer_requests.establishment_id, customer_requests.dog_id, customer_requests.service_catalog_id, customer_requests.requested_date",
        )
      ) {
        throw new HttpError(
          409,
          "duplicate_customer_request",
          "Este pedido já está aguardando análise.",
        );
      }
      throw error;
    }
    return json(
      {
        request: {
          id,
          type,
          status: "pending",
          dogId,
          appointmentId,
          serviceCatalogId,
          requestedDate,
          requestedEndDate: normalizedEndDate,
          requestedStartTime: normalizedStartTime,
          requestedEndTime: normalizedEndTime,
          details,
          notes,
          createdAt: now,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
