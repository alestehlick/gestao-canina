import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNull,
  inArray,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { getDb } from "@/db";
import {
  appointmentItems,
  appointments,
  cashEntries,
  creditMovements,
  creditPackages,
  creditPurchases,
  creditReceipts,
  customerAccounts,
  dogs,
  dogTutors,
  establishments,
  invoiceItems,
  invoiceMergeMembers,
  invoiceMerges,
  invoicePayments,
  invoiceSettlements,
  invoices,
  serviceCatalog,
  tasks,
  tutors,
} from "@/db/schema";
import { getIdentity } from "@/lib/server/auth";
import { loadAuditLog } from "@/lib/server/audit-log";
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
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)?.value)
    .join("-");
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
      invoiceMergeMemberRows,
      invoicePaymentRows,
      invoiceSettlementRows,
      invoicePaymentSummaryRows,
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
        .where(
          and(
            eq(customerAccounts.establishmentId, establishmentId),
            eq(customerAccounts.status, "active"),
          ),
        )
        .orderBy(asc(customerAccounts.normalizedName)),
      db
        .select()
        .from(tutors)
        .where(
          and(
            eq(tutors.establishmentId, establishmentId),
            eq(tutors.status, "active"),
          ),
        )
        .orderBy(desc(tutors.isFinancialContact), asc(tutors.normalizedName)),
      db
        .select()
        .from(dogs)
        .where(
          and(
            eq(dogs.establishmentId, establishmentId),
            eq(dogs.status, "active"),
          ),
        )
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
        .where(
          and(
            eq(dogs.establishmentId, establishmentId),
            eq(dogs.status, "active"),
          ),
        ),
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
          lodgingRateProfile: appointments.lodgingRateProfile,
          lodgingTableDailyRateCents: appointments.lodgingTableDailyRateCents,
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
          billingPricingProfile: appointmentItems.billingPricingProfile,
          detailsJson: appointmentItems.detailsJson,
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
            or(
              and(
                lte(appointments.startDate, to),
                gte(appointments.endDate, from),
              ),
              and(
                eq(appointments.status, "completed"),
                eq(appointmentItems.settlementMethod, "unsettled"),
                isNull(appointmentItems.activeInvoiceId),
              ),
              and(
                inArray(appointments.status, ["scheduled", "confirmed"]),
                gte(appointments.endDate, addDays(from, -30)),
                lte(appointments.endDate, addDays(from, -1)),
              ),
            ),
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
        .orderBy(desc(invoices.updatedAt))
        .limit(1_000),
      db
        .select({
          id: invoiceItems.id,
          appointmentItemId: invoiceItems.appointmentItemId,
          invoiceId: invoiceItems.invoiceId,
          dogNameSnapshot: invoiceItems.dogNameSnapshot,
          serviceNameSnapshot: invoiceItems.serviceNameSnapshot,
          serviceDateSnapshot: invoiceItems.serviceDateSnapshot,
          descriptionSnapshot: invoiceItems.descriptionSnapshot,
          amountCents: invoiceItems.amountCents,
          serviceCode: serviceCatalog.code,
          lodgingStartDate: appointments.startDate,
          lodgingEndDate: appointments.endDate,
          lodgingNights: appointments.lodgingNights,
          lodgingDailyRateCents: sql<number | null>`case
            when ${appointments.lodgingNights} is null or ${appointments.lodgingNights} = 0 then null
            else round(${appointmentItems.totalCents} * 1.0 / ${appointments.lodgingNights})
          end`,
          lodgingTableDailyRateCents: appointments.lodgingTableDailyRateCents,
          lodgingRateProfile: appointments.lodgingRateProfile,
          lodgingLongStayDiscountPercent:
            invoiceItems.lodgingLongStayDiscountPercent,
          lodgingLongStayDiscountCents:
            invoiceItems.lodgingLongStayDiscountCents,
          depositPercent: appointments.depositPercent,
        })
        .from(invoiceItems)
        .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
        .innerJoin(
          appointmentItems,
          eq(appointmentItems.id, invoiceItems.appointmentItemId),
        )
        .innerJoin(
          appointments,
          eq(appointments.id, appointmentItems.appointmentId),
        )
        .innerJoin(
          serviceCatalog,
          eq(serviceCatalog.id, appointmentItems.serviceCatalogId),
        )
        .where(eq(invoices.establishmentId, establishmentId))
        .orderBy(desc(invoices.createdAt), asc(invoiceItems.serviceDateSnapshot))
        .limit(5_000),
      db
        .select({
          mergedInvoiceId: invoiceMerges.mergedInvoiceId,
          sourceInvoiceId: invoiceMergeMembers.sourceInvoiceId,
        })
        .from(invoiceMergeMembers)
        .innerJoin(
          invoiceMerges,
          eq(invoiceMerges.id, invoiceMergeMembers.mergeId),
        )
        .where(
          and(
            eq(invoiceMerges.establishmentId, establishmentId),
            eq(invoiceMerges.status, "active"),
          ),
        )
        .limit(1_000),
      db
        .select({
          invoiceId: invoicePayments.invoiceId,
          paidAt: invoicePayments.paidAt,
          cashEntryId: cashEntries.id,
          cashStatus: cashEntries.status,
        })
        .from(invoicePayments)
        .leftJoin(
          cashEntries,
          eq(cashEntries.sourcePaymentId, invoicePayments.id),
        )
        .where(
          and(
            eq(invoicePayments.establishmentId, establishmentId),
            eq(invoicePayments.status, "active"),
          ),
        )
        .orderBy(desc(invoicePayments.createdAt))
        .limit(2_000),
      db
        .select({
          invoiceId: invoiceSettlements.invoiceId,
          status: invoiceSettlements.status,
          availableOn: invoiceSettlements.availableOn,
        })
        .from(invoiceSettlements)
        .where(
          and(
            eq(invoiceSettlements.establishmentId, establishmentId),
            eq(invoiceSettlements.status, "scheduled"),
          ),
        )
        .limit(1_000),
      db
        .select({
          amountCents: sql<number>`coalesce(sum(${invoicePayments.amountCents}), 0)`,
          paymentCount: sql<number>`count(*)`,
        })
        .from(invoicePayments)
        .where(
          and(
            eq(invoicePayments.establishmentId, establishmentId),
            eq(invoicePayments.status, "active"),
            gte(invoicePayments.paidAt, `${addDays(defaultFrom, -29)}T00:00:00.000Z`),
            lte(invoicePayments.paidAt, `${defaultFrom}T23:59:59.999Z`),
          ),
        ),
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
        .orderBy(desc(creditPurchases.updatedAt))
        .limit(1_000),
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
      loadAuditLog(
        establishmentId,
        addDays(defaultFrom, -4),
        defaultFrom,
        500,
      ),
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

    const paymentByInvoice = new Map(
      invoicePaymentRows.map((payment) => [payment.invoiceId, payment]),
    );
    const settlementByInvoice = new Map(
      invoiceSettlementRows
        .filter((settlement) => settlement.status === "scheduled")
        .map((settlement) => [settlement.invoiceId, settlement]),
    );
    const itemsByInvoice = new Map<
      string,
      (typeof invoiceItemRows)[number][]
    >();
    for (const item of invoiceItemRows) {
      const items = itemsByInvoice.get(item.invoiceId) ?? [];
      items.push(item);
      itemsByInvoice.set(item.invoiceId, items);
    }
    const mergedSourcesByInvoice = new Map<string, string[]>();
    for (const member of invoiceMergeMemberRows) {
      const sourceIds = mergedSourcesByInvoice.get(member.mergedInvoiceId) ?? [];
      sourceIds.push(member.sourceInvoiceId);
      mergedSourcesByInvoice.set(member.mergedInvoiceId, sourceIds);
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
      | "billingPricingProfile"
      | "detailsJson"
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
        billingPricingProfile: string | null;
        detailsJson: string | null;
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
          lodgingRateProfile: row.lodgingRateProfile,
          lodgingTableDailyRateCents: row.lodgingTableDailyRateCents,
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
          billingPricingProfile: row.billingPricingProfile,
          detailsJson: row.detailsJson,
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
        receivedLast30DaysCents: Number(
          invoicePaymentSummaryRows[0]?.amountCents ?? 0,
        ),
        receivedLast30DaysCount: Number(
          invoicePaymentSummaryRows[0]?.paymentCount ?? 0,
        ),
        invoices:
          identity.role === "staff"
            ? []
            : invoiceRows.map((invoice) => ({
                ...invoice,
                paidAt:
                  paymentByInvoice.get(invoice.id)?.paidAt ?? null,
                cashEntryId:
                  paymentByInvoice.get(invoice.id)?.cashEntryId ?? null,
                cashIncluded:
                  paymentByInvoice.get(invoice.id)?.cashStatus === "included",
                compensationAvailableOn:
                  settlementByInvoice.get(invoice.id)?.availableOn ?? null,
                items: itemsByInvoice.get(invoice.id) ?? [],
                mergedSourceInvoiceIds:
                  mergedSourcesByInvoice.get(invoice.id) ?? [],
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
