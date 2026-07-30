import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  appUsers,
  appointments,
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
  optionalString,
  readJsonObject,
  requiredString,
} from "@/lib/server/http";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["customer"]);
    const establishmentId = identity.establishmentId!;
    const body = await readJsonObject(request);
    const type = requiredString(body, "type", 30);
    if (
      type !== "service" &&
      type !== "cancellation" &&
      type !== "profile_update"
    ) {
      throw new HttpError(400, "invalid_request_type", "O pedido é inválido.");
    }
    const dogId = optionalString(body, "dogId", 80);
    const appointmentId = optionalString(body, "appointmentId", 80);
    const serviceCatalogId = optionalString(body, "serviceCatalogId", 80);
    const requestedDate = optionalString(body, "requestedDate", 10);
    const requestedEndDate = optionalString(body, "requestedEndDate", 10);
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
    const today = new Date().toISOString().slice(0, 10);
    if (type === "service" && requestedDate && requestedDate < today) {
      throw new HttpError(
        400,
        "request_date_in_past",
        "Escolha uma data futura para o serviço.",
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
    if (serviceCatalogId) {
      const [service] = await getDb()
        .select({ id: serviceCatalog.id })
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
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const d1 = getD1Database();
    await d1.batch([
      d1
        .prepare(
          `INSERT INTO customer_requests (
            id, establishment_id, account_id, requested_by_user_id, type,
            status, dog_id, appointment_id, service_catalog_id,
            requested_date, requested_end_date, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          requestedEndDate,
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
          }),
          now,
        ),
    ]);
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
          requestedEndDate,
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
