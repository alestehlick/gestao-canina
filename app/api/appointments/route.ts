import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  appointmentItems,
  appointments,
  auditEvents,
  dogs,
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
    const paymentPreference =
      body.paymentPreference === undefined ? "pix" : body.paymentPreference;
    if (
      paymentPreference !== "pix" &&
      paymentPreference !== "credit"
    ) {
      throw new HttpError(
        400,
        "invalid_payment_preference",
        "Escolha fatura ou crédito para o pagamento.",
      );
    }
    const customPriceCents =
      body.priceCents === undefined ? null : body.priceCents;
    if (
      customPriceCents !== null &&
      (typeof customPriceCents !== "number" ||
        !Number.isSafeInteger(customPriceCents) ||
        customPriceCents < 0 ||
        customPriceCents > 100_000_000)
    ) {
      throw new HttpError(
        400,
        "invalid_price",
        "O valor do serviço é inválido.",
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      throw new HttpError(400, "invalid_date", "A data informada é inválida.");
    }
    if (startTime && !/^\d{2}:\d{2}$/.test(startTime)) {
      throw new HttpError(400, "invalid_time", "O horário inicial é inválido.");
    }
    if (endTime && !/^\d{2}:\d{2}$/.test(endTime)) {
      throw new HttpError(400, "invalid_time", "O horário final é inválido.");
    }
    if (startDate === endDate && startTime && endTime && endTime <= startTime) {
      throw new HttpError(
        400,
        "invalid_time_range",
        "O horário final deve ser posterior ao inicial.",
      );
    }

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [[dog], [service]] = await Promise.all([
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
    ]);
    if (!dog || !service) {
      throw new HttpError(
        404,
        "record_not_found",
        "Cão ou serviço não encontrado.",
      );
    }
    if (
      paymentPreference === "credit" &&
      !["daycare", "bath", "hygienic_grooming", "transport"].includes(service.code)
    ) {
      throw new HttpError(
        400,
        "service_not_credit_eligible",
        "Este serviço não pode ser pago com créditos.",
      );
    }

    const lodgingNights = typeof body.lodgingNights === "number" ? body.lodgingNights : null;
    const depositPercent = typeof body.depositPercent === "number" ? body.depositPercent : null;
    if (service.code === "hotel") {
      if (lodgingNights === null || !Number.isFinite(lodgingNights) || lodgingNights < 0.5 || lodgingNights > 365 || Math.round(lodgingNights * 2) !== lodgingNights * 2) {
        throw new HttpError(400, "invalid_lodging_nights", "Informe o número de diárias em múltiplos de meio dia.");
      }
      if (depositPercent !== null && (!Number.isInteger(depositPercent) || depositPercent < 1 || depositPercent > 99)) {
        throw new HttpError(400, "invalid_deposit_percent", "Informe um sinal entre 1% e 99%.");
      }
    }
    const direction = body.transportDirection === "round_trip" ? "round_trip" : "one_way";
    const appointmentId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    const auditId = crypto.randomUUID();
    const priceCents = customPriceCents ?? (service.code === "transport" ? (direction === "round_trip" ? 1_000 : 500) : service.code === "hotel" ? service.basePriceCents * (lodgingNights ?? 1) : service.basePriceCents);
    await db.batch([
      db.insert(appointments).values({
        id: appointmentId,
        establishmentId,
        accountId: dog.accountId,
        dogId: dog.id,
        startDate,
        endDate,
        startTime,
        endTime,
        lodgingNights: service.code === "hotel" ? lodgingNights : null,
        depositPercent: service.code === "hotel" ? depositPercent : null,
        internalNotes,
        createdByUserId: identity.userId,
      }),
      db.insert(appointmentItems).values({
        id: itemId,
        appointmentId,
        serviceCatalogId: service.id,
        serviceNameSnapshot: service.name,
        unitPriceCents: priceCents,
        quantity: 1,
        totalCents: priceCents,
        descriptionSnapshot: service.code === "transport" ? (direction === "round_trip" ? "Ida e volta" : "Ida") : service.code === "hotel" && depositPercent ? `Sinal de ${depositPercent}% no check-in; saldo no check-out.` : null,
        paymentPreference,
      }),
      db.insert(auditEvents).values({
        id: auditId,
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "appointment.created",
        entityType: "appointment",
        entityId: appointmentId,
        requestId,
        metadataJson: JSON.stringify({
          dogId: dog.id,
          serviceCatalogId: service.id,
          paymentPreference,
          transportDirection: service.code === "transport" ? direction : null,
          lodgingNights: service.code === "hotel" ? lodgingNights : null,
          depositPercent: service.code === "hotel" ? depositPercent : null,
        }),
      }),
    ]);

    return json(
      {
        appointment: {
          id: appointmentId,
          itemId,
          dogId: dog.id,
          dogName: dog.name,
          serviceName: service.name,
          priceCents,
          startDate,
          endDate,
          startTime,
          endTime,
          status: "scheduled",
          paymentPreference,
          settlementMethod: "unsettled",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
