import {
  and,
  asc,
  desc,
  eq,
  gte,
  lte,
  sql,
} from "drizzle-orm";
import { getDb } from "@/db";
import {
  appUsers,
  appointmentItems,
  appointments,
  auditEvents,
  creditMovements,
  creditPackages,
  creditPurchases,
  creditReceipts,
  customerAccounts,
  dogs,
  dogTutors,
  establishments,
  invoiceItems,
  invoices,
  serviceCatalog,
  tasks,
  tutors,
} from "@/db/schema";
import { getIdentity } from "@/lib/server/auth";
import { errorResponse, HttpError, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(value: string) {
  if (!isoDatePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function todayInTimeZone(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(date: string, days: number) {
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

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await getIdentity(request);
    if (!identity) {
      throw new HttpError(
        401,
        "authentication_required",
        "Entre para continuar.",
      );
    }
    if (!["owner", "staff", "finance"].includes(identity.role)) {
      throw new HttpError(
        403,
        "permission_denied",
        "Sua conta não tem permissão para abrir a área administrativa.",
      );
    }

    if (!identity.establishmentId) {
      return json({
        status: "onboarding",
        identity: {
          email: identity.email,
          displayName: identity.displayName,
          role: identity.role,
        },
        onboarding: {
          required: true,
          canInitialize: identity.role === "owner",
        },
      });
    }

    const establishmentId = identity.establishmentId;
    const db = getDb();
    const [establishment] = await db
      .select()
      .from(establishments)
      .where(eq(establishments.id, establishmentId))
      .limit(1);
    if (!establishment) {
      throw new HttpError(
        404,
        "establishment_not_found",
        "A unidade ligada à sua conta não foi encontrada.",
      );
    }

    const url = new URL(request.url);
    const defaultFrom = todayInTimeZone(establishment.timezone);
    const from = url.searchParams.get("from") ?? defaultFrom;
    const to = url.searchParams.get("to") ?? addDays(from, 30);
    if (!isIsoDate(from) || !isIsoDate(to)) {
      throw new HttpError(
        400,
        "invalid_date_range",
        "Informe as datas no formato YYYY-MM-DD.",
      );
    }
    const rangeDays = daysBetween(from, to);
    if (rangeDays < 0 || rangeDays > 93) {
      throw new HttpError(
        400,
        "invalid_date_range",
        "Consulte um período de até 94 dias.",
      );
    }

    const [
      services,
      accounts,
      contactRows,
      dogRows,
      dogTutorRows,
      scheduleRows,
      taskRows,
      invoiceRows,
      invoiceItemRows,
      packageRows,
      purchaseRows,
      balanceRows,
      receiptRows,
      activityRows,
    ] = await Promise.all([
      db
        .select()
        .from(serviceCatalog)
        .where(eq(serviceCatalog.establishmentId, establishmentId))
        .orderBy(asc(serviceCatalog.name)),
      db
        .select()
        .from(customerAccounts)
        .where(eq(customerAccounts.establishmentId, establishmentId))
        .orderBy(asc(customerAccounts.normalizedName)),
      db
        .select()
        .from(tutors)
        .where(eq(tutors.establishmentId, establishmentId))
        .orderBy(desc(tutors.isFinancialContact), asc(tutors.normalizedName)),
      db
        .select()
        .from(dogs)
        .where(eq(dogs.establishmentId, establishmentId))
        .orderBy(asc(dogs.normalizedName)),
      db
        .select({
          dogId: dogTutors.dogId,
          tutorId: dogTutors.tutorId,
          isPrimary: dogTutors.isPrimary,
          emergencyContact: dogTutors.emergencyContact,
          pickupAuthorized: dogTutors.pickupAuthorized,
          portalVisible: dogTutors.portalVisible,
        })
        .from(dogTutors)
        .innerJoin(dogs, eq(dogs.id, dogTutors.dogId))
        .where(eq(dogs.establishmentId, establishmentId)),
      db
        .select({
          id: appointments.id,
          accountId: appointments.accountId,
          dogId: appointments.dogId,
          startDate: appointments.startDate,
          endDate: appointments.endDate,
          startTime: appointments.startTime,
          endTime: appointments.endTime,
          lodgingNights: appointments.lodgingNights,
          depositPercent: appointments.depositPercent,
          status: appointments.status,
          source: appointments.source,
          recurringScheduleId: appointments.recurringScheduleId,
          occurrenceDate: appointments.occurrenceDate,
          internalNotes: appointments.internalNotes,
          cancellationReason: appointments.cancellationReason,
          createdAt: appointments.createdAt,
          updatedAt: appointments.updatedAt,
          dogName: dogs.name,
          customerName: customerAccounts.displayName,
          itemId: appointmentItems.id,
          serviceCatalogId: appointmentItems.serviceCatalogId,
          serviceName: appointmentItems.serviceNameSnapshot,
          description: appointmentItems.descriptionSnapshot,
          unitPriceCents: appointmentItems.unitPriceCents,
          quantity: appointmentItems.quantity,
          totalCents: appointmentItems.totalCents,
          itemStatus: appointmentItems.status,
          paymentPreference: appointmentItems.paymentPreference,
          settlementMethod: appointmentItems.settlementMethod,
          settledAt: appointmentItems.settledAt,
          activeInvoiceId: appointmentItems.activeInvoiceId,
        })
        .from(appointments)
        .innerJoin(dogs, eq(dogs.id, appointments.dogId))
        .innerJoin(
          customerAccounts,
          eq(customerAccounts.id, appointments.accountId),
        )
        .leftJoin(
          appointmentItems,
          eq(appointmentItems.appointmentId, appointments.id),
        )
        .where(
          and(
            eq(appointments.establishmentId, establishmentId),
            gte(appointments.startDate, from),
            lte(appointments.startDate, to),
          ),
        )
        .orderBy(
          asc(appointments.startDate),
          asc(appointments.startTime),
          asc(dogs.normalizedName),
        ),
      db
        .select()
        .from(tasks)
        .where(eq(tasks.establishmentId, establishmentId))
        .orderBy(
          asc(tasks.status),
          asc(tasks.scheduledDate),
          asc(tasks.scheduledTime),
        )
        .limit(500),
      db
        .select()
        .from(invoices)
        .where(eq(invoices.establishmentId, establishmentId))
        .orderBy(desc(invoices.createdAt))
        .limit(300),
      db
        .select({
          id: invoiceItems.id,
          invoiceId: invoiceItems.invoiceId,
          dogNameSnapshot: invoiceItems.dogNameSnapshot,
          serviceNameSnapshot: invoiceItems.serviceNameSnapshot,
          serviceDateSnapshot: invoiceItems.serviceDateSnapshot,
          descriptionSnapshot: invoiceItems.descriptionSnapshot,
          amountCents: invoiceItems.amountCents,
        })
        .from(invoiceItems)
        .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
        .where(eq(invoices.establishmentId, establishmentId))
        .orderBy(asc(invoiceItems.serviceDateSnapshot)),
      db
        .select({
          id: creditPackages.id,
          serviceCatalogId: creditPackages.serviceCatalogId,
          serviceCode: serviceCatalog.code,
          name: creditPackages.name,
          creditUnits: creditPackages.creditUnits,
          packagePriceCents: creditPackages.packagePriceCents,
          active: creditPackages.active,
          createdAt: creditPackages.createdAt,
          updatedAt: creditPackages.updatedAt,
        })
        .from(creditPackages)
        .innerJoin(
          serviceCatalog,
          eq(serviceCatalog.id, creditPackages.serviceCatalogId),
        )
        .where(eq(creditPackages.establishmentId, establishmentId))
        .orderBy(desc(creditPackages.active), asc(creditPackages.name)),
      db
        .select()
        .from(creditPurchases)
        .where(eq(creditPurchases.establishmentId, establishmentId))
        .orderBy(desc(creditPurchases.createdAt))
        .limit(300),
      db
        .select({
          accountId: creditMovements.accountId,
          serviceCatalogId: creditMovements.serviceCatalogId,
          availableUnits: sql<number>`coalesce(sum(${creditMovements.deltaUnits}), 0)`,
        })
        .from(creditMovements)
        .where(eq(creditMovements.establishmentId, establishmentId))
        .groupBy(
          creditMovements.accountId,
          creditMovements.serviceCatalogId,
        ),
      db
        .select()
        .from(creditReceipts)
        .where(eq(creditReceipts.establishmentId, establishmentId))
        .orderBy(desc(creditReceipts.issuedAt))
        .limit(300),
      db
        .select({
          id: auditEvents.id,
          actorRole: auditEvents.actorRole,
          actorName: appUsers.displayName,
          action: auditEvents.action,
          entityType: auditEvents.entityType,
          entityId: auditEvents.entityId,
          reason: auditEvents.reason,
          result: auditEvents.result,
          metadataJson: auditEvents.metadataJson,
          occurredAt: auditEvents.occurredAt,
        })
        .from(auditEvents)
        .leftJoin(appUsers, eq(appUsers.id, auditEvents.actorUserId))
        .where(eq(auditEvents.establishmentId, establishmentId))
        .orderBy(desc(auditEvents.occurredAt))
        .limit(200),
    ]);

    const tutorsByAccount = new Map<
      string,
      (typeof contactRows)[number][]
    >();
    for (const tutor of contactRows) {
      const list = tutorsByAccount.get(tutor.accountId) ?? [];
      list.push(tutor);
      tutorsByAccount.set(tutor.accountId, list);
    }

    const linksByDog = new Map<
      string,
      (typeof dogTutorRows)[number][]
    >();
    for (const link of dogTutorRows) {
      const list = linksByDog.get(link.dogId) ?? [];
      list.push(link);
      linksByDog.set(link.dogId, list);
    }

    type ScheduleRow = (typeof scheduleRows)[number];
    type AppointmentPayload = Omit<
      ScheduleRow,
      | "itemId"
      | "serviceCatalogId"
      | "serviceName"
      | "description"
      | "unitPriceCents"
      | "quantity"
      | "totalCents"
      | "itemStatus"
      | "paymentPreference"
      | "settlementMethod"
      | "settledAt"
      | "activeInvoiceId"
    > & {
      items: Array<{
        id: string;
        serviceCatalogId: string;
        serviceName: string;
        description: string | null;
        unitPriceCents: number;
        quantity: number;
        totalCents: number;
        status: "scheduled" | "completed" | "cancelled";
        paymentPreference: "invoice" | "credit";
        settlementMethod: "unsettled" | "invoice" | "credit";
        settledAt: string | null;
        activeInvoiceId: string | null;
      }>;
    };
    const agendaById = new Map<string, AppointmentPayload>();
    for (const row of scheduleRows) {
      let appointment = agendaById.get(row.id);
      if (!appointment) {
        appointment = {
          id: row.id,
          accountId: row.accountId,
          dogId: row.dogId,
          startDate: row.startDate,
          endDate: row.endDate,
          startTime: row.startTime,
          endTime: row.endTime,
          lodgingNights: row.lodgingNights,
          depositPercent: row.depositPercent,
          status: row.status,
          source: row.source,
          recurringScheduleId: row.recurringScheduleId,
          occurrenceDate: row.occurrenceDate,
          internalNotes: row.internalNotes,
          cancellationReason: row.cancellationReason,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          dogName: row.dogName,
          customerName: row.customerName,
          items: [],
        };
        agendaById.set(row.id, appointment);
      }
      if (
        row.itemId &&
        row.serviceCatalogId &&
        row.serviceName &&
        row.unitPriceCents !== null &&
        row.quantity !== null &&
        row.totalCents !== null &&
        row.itemStatus &&
        row.paymentPreference &&
        row.settlementMethod
      ) {
        appointment.items.push({
          id: row.itemId,
          serviceCatalogId: row.serviceCatalogId,
          serviceName: row.serviceName,
          description: row.description,
          unitPriceCents: row.unitPriceCents,
          quantity: row.quantity,
          totalCents: row.totalCents,
          status: row.itemStatus,
          paymentPreference: row.paymentPreference,
          settlementMethod: row.settlementMethod,
          settledAt: row.settledAt,
          activeInvoiceId: row.activeInvoiceId,
        });
      }
    }

    return json({
      status: "ready",
      identity: {
        email: identity.email,
        displayName: identity.displayName,
        role: identity.role,
      },
      establishment,
      range: { from, to },
      serviceCatalog: services,
      customers: accounts.map((account) => ({
        ...account,
        cpf: identity.role === "owner" ? account.cpf : null,
        tutors: tutorsByAccount.get(account.id) ?? [],
      })),
      dogs: dogRows.map((dog) => ({
        ...dog,
        tutors: linksByDog.get(dog.id) ?? [],
      })),
      agenda: [...agendaById.values()],
      tasks: taskRows,
      billing: {
        invoices:
          identity.role === "staff"
            ? []
            : invoiceRows.map((invoice) => ({
                ...invoice,
                items: invoiceItemRows.filter(
                  (item) => item.invoiceId === invoice.id,
                ),
              })),
        creditPackages: identity.role === "staff" ? [] : packageRows,
        creditPurchases: identity.role === "staff" ? [] : purchaseRows,
        creditBalances: balanceRows.map((balance) => ({
          ...balance,
          availableUnits: Number(balance.availableUnits),
        })),
        creditReceipts:
          identity.role === "staff"
            ? []
            : receiptRows.map((receipt) => ({
                ...receipt,
                deliveryChannels: JSON.parse(
                  receipt.deliveryChannelsJson,
                ) as unknown,
              })),
      },
      activities: identity.role === "owner" ? activityRows : [],
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
