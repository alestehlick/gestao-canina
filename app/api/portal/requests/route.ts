import { and, eq, sql } from "drizzle-orm";
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
