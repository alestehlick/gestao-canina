import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  appUsers,
  appointmentItems,
  appointments,
  creditMovements,
  creditReceipts,
  customerAccounts,
  customerRequests,
  dogs,
  dogTutors,
  invoiceItems,
  invoicePayments,
  invoiceSettlements,
  invoices,
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
} from "@/lib/server/http";
import { todayInSaoPaulo } from "@/lib/service-rules";

function normalizeLookupText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeCpf(value: string | null) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11) {
    throw new HttpError(400, "invalid_cpf", "Informe um CPF com 11 dígitos.");
  }
  return digits;
}

function normalizeBrazilianPhone(value: string | null) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if (
    (digits.length === 12 || digits.length === 13) &&
    digits.startsWith("55")
  ) {
    return `+${digits}`;
  }
  if (value.trim().startsWith("+") && digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  throw new HttpError(400, "invalid_phone", "Informe um telefone com DDD.");
}

async function getCustomerContext(userId: string, establishmentId: string) {
  const [context] = await getDb()
    .select({
      userId: appUsers.id,
      tutorId: tutors.id,
      accountId: tutors.accountId,
    })
    .from(appUsers)
    .innerJoin(tutors, eq(tutors.id, appUsers.tutorId))
    .innerJoin(customerAccounts, eq(customerAccounts.id, tutors.accountId))
    .where(
      and(
        eq(appUsers.id, userId),
        eq(appUsers.establishmentId, establishmentId),
        eq(appUsers.role, "customer"),
        eq(appUsers.status, "active"),
        eq(tutors.status, "active"),
        eq(customerAccounts.status, "active"),
      ),
    )
    .limit(1);
  if (!context) {
    throw new HttpError(
      403,
      "customer_link_missing",
      "Sua conta ainda não está ligada a um cadastro de cliente.",
    );
  }
  return context;
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, ["customer"]);
    const establishmentId = identity.establishmentId!;
    const context = await getCustomerContext(identity.userId!, establishmentId);
    const db = getDb();
    const oldestDate = new Date();
    oldestDate.setUTCFullYear(oldestDate.getUTCFullYear() - 2);
    const from = oldestDate.toISOString().slice(0, 10);

    const [
      accountRows,
      tutorRows,
      dogRows,
      appointmentRows,
      invoiceRows,
      invoicePaymentRows,
      invoiceSettlementRows,
      invoiceItemRows,
      balanceRows,
      receiptRows,
      requestRows,
      services,
    ] = await Promise.all([
      db
        .select()
        .from(customerAccounts)
        .where(
          and(
            eq(customerAccounts.id, context.accountId),
            eq(customerAccounts.establishmentId, establishmentId),
          ),
        )
        .limit(1),
      db
        .select({
          id: tutors.id,
          fullName: tutors.fullName,
          email: tutors.email,
          phoneE164: tutors.phoneE164,
          isFinancialContact: tutors.isFinancialContact,
        })
        .from(tutors)
        .where(
          and(
            eq(tutors.accountId, context.accountId),
            eq(tutors.status, "active"),
          ),
        )
        .orderBy(desc(tutors.isFinancialContact), asc(tutors.fullName)),
      db
        .select({
          id: dogs.id,
          name: dogs.name,
          breed: dogs.breed,
          birthDate: dogs.birthDate,
          sex: dogs.sex,
          weightGrams: dogs.weightGrams,
          neutered: dogs.neutered,
          photoObjectKey: dogs.photoObjectKey,
          feedingNotes: dogs.feedingNotes,
          temperamentNotes: dogs.temperamentNotes,
          healthNotes: dogs.healthNotes,
          medicationNotes: dogs.medicationNotes,
          vaccinesJson: dogs.vaccinesJson,
          emergencyNotes: dogs.emergencyNotes,
          vaccinesCurrent: dogs.vaccinesCurrent,
          status: dogs.status,
          updatedAt: dogs.updatedAt,
        })
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
          ),
        )
        .orderBy(asc(dogs.normalizedName)),
      db
        .select({
          id: appointments.id,
          dogId: appointments.dogId,
          dogName: dogs.name,
          startDate: appointments.startDate,
          endDate: appointments.endDate,
          startTime: appointments.startTime,
          endTime: appointments.endTime,
          lodgingNights: appointments.lodgingNights,
          depositPercent: appointments.depositPercent,
          status: appointments.status,
          serviceName: appointmentItems.serviceNameSnapshot,
          serviceCode: serviceCatalog.code,
          description: appointmentItems.descriptionSnapshot,
          totalCents: appointmentItems.totalCents,
          settlementMethod: appointmentItems.settlementMethod,
        })
        .from(appointments)
        .innerJoin(dogs, eq(dogs.id, appointments.dogId))
        .innerJoin(
          dogTutors,
          and(
            eq(dogTutors.dogId, appointments.dogId),
            eq(dogTutors.tutorId, context.tutorId),
            eq(dogTutors.portalVisible, true),
          ),
        )
        .leftJoin(
          appointmentItems,
          eq(appointmentItems.appointmentId, appointments.id),
        )
        .leftJoin(
          serviceCatalog,
          eq(serviceCatalog.id, appointmentItems.serviceCatalogId),
        )
        .where(
          and(
            eq(appointments.establishmentId, establishmentId),
            eq(appointments.accountId, context.accountId),
            gte(appointments.startDate, from),
          ),
        )
        .orderBy(desc(appointments.startDate))
        .limit(250),
      db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.establishmentId, establishmentId),
            eq(invoices.accountId, context.accountId),
            sql`${invoices.status} <> 'draft'`,
          ),
        )
        .orderBy(desc(invoices.createdAt))
        .limit(100),
      db
        .select({
          invoiceId: invoicePayments.invoiceId,
          paidAt: invoicePayments.paidAt,
        })
        .from(invoicePayments)
        .innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
        .where(
          and(
            eq(invoices.establishmentId, establishmentId),
            eq(invoices.accountId, context.accountId),
            eq(invoicePayments.status, "active"),
          ),
        ),
      db
        .select({
          invoiceId: invoiceSettlements.invoiceId,
          availableOn: invoiceSettlements.availableOn,
        })
        .from(invoiceSettlements)
        .innerJoin(invoices, eq(invoices.id, invoiceSettlements.invoiceId))
        .where(
          and(
            eq(invoices.establishmentId, establishmentId),
            eq(invoices.accountId, context.accountId),
            eq(invoiceSettlements.status, "scheduled"),
          ),
        ),
      db
        .select({
          id: invoiceItems.id,
          invoiceId: invoiceItems.invoiceId,
          dogName: invoiceItems.dogNameSnapshot,
          serviceName: invoiceItems.serviceNameSnapshot,
          serviceDate: invoiceItems.serviceDateSnapshot,
          description: invoiceItems.descriptionSnapshot,
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
        .where(
          and(
            eq(invoices.establishmentId, establishmentId),
            eq(invoices.accountId, context.accountId),
          ),
        )
        .orderBy(asc(invoiceItems.serviceDateSnapshot)),
      db
        .select({
          serviceCatalogId: creditMovements.serviceCatalogId,
          serviceName: serviceCatalog.name,
          serviceCode: serviceCatalog.code,
          availableUnits: sql<number>`coalesce(sum(${creditMovements.deltaUnits}), 0)`,
        })
        .from(creditMovements)
        .innerJoin(
          serviceCatalog,
          eq(serviceCatalog.id, creditMovements.serviceCatalogId),
        )
        .where(
          and(
            eq(creditMovements.establishmentId, establishmentId),
            eq(creditMovements.accountId, context.accountId),
          ),
        )
        .groupBy(
          creditMovements.serviceCatalogId,
          serviceCatalog.name,
          serviceCatalog.code,
        ),
      db
        .select({
          id: creditReceipts.id,
          receiptNumber: creditReceipts.receiptNumber,
          dogName: creditReceipts.dogNameSnapshot,
          serviceName: creditReceipts.serviceNameSnapshot,
          serviceDate: creditReceipts.serviceDateSnapshot,
          creditUnits: creditReceipts.creditUnits,
          issuedAt: creditReceipts.issuedAt,
        })
        .from(creditReceipts)
        .where(
          and(
            eq(creditReceipts.establishmentId, establishmentId),
            eq(creditReceipts.accountId, context.accountId),
          ),
        )
        .orderBy(desc(creditReceipts.issuedAt))
        .limit(100),
      db
        .select()
        .from(customerRequests)
        .where(
          and(
            eq(customerRequests.establishmentId, establishmentId),
            eq(customerRequests.accountId, context.accountId),
          ),
        )
        .orderBy(desc(customerRequests.createdAt))
        .limit(100),
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
            sql`${serviceCatalog.code} <> 'bath_grooming'`,
          ),
        )
        .orderBy(asc(serviceCatalog.name)),
    ]);

    const account = accountRows[0];
    if (!account) {
      throw new HttpError(
        404,
        "customer_not_found",
        "O cadastro ligado à conta não foi encontrado.",
      );
    }
    const paymentByInvoice = new Map(
      invoicePaymentRows.map((payment) => [payment.invoiceId, payment.paidAt]),
    );
    const settlementByInvoice = new Map(
      invoiceSettlementRows.map((settlement) => [
        settlement.invoiceId,
        settlement.availableOn,
      ]),
    );
    return json({
      identity: {
        email: identity.email,
        displayName: identity.displayName,
        role: identity.role,
        tutorId: context.tutorId,
      },
      account,
      tutors: tutorRows,
      dogs: dogRows.map((dog) => ({
        ...dog,
        photoUrl: dog.photoObjectKey
          ? `/api/dogs/${dog.id}?photo=1&v=${encodeURIComponent(dog.updatedAt)}`
          : null,
        vaccines: JSON.parse(dog.vaccinesJson || "[]") as unknown,
      })),
      appointments: appointmentRows,
      invoices: invoiceRows.map((invoice) => ({
        ...invoice,
        paidAt: paymentByInvoice.get(invoice.id) ?? null,
        compensationAvailableOn: settlementByInvoice.get(invoice.id) ?? null,
        items: invoiceItemRows.filter((item) => item.invoiceId === invoice.id),
      })),
      credits: balanceRows.map((balance) => ({
        ...balance,
        availableUnits: Number(balance.availableUnits),
      })),
      receipts: receiptRows,
      requests: requestRows,
      services,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["customer"]);
    const establishmentId = identity.establishmentId!;
    const context = await getCustomerContext(identity.userId!, establishmentId);
    const body = await readJsonObject(request);
    const displayName = optionalString(body, "displayName", 160);
    if (body.displayName !== undefined && !displayName) {
      throw new HttpError(400, "invalid_name", "Informe seu nome completo.");
    }
    const phone = normalizeBrazilianPhone(optionalString(body, "phone", 40));
    const addressLine = optionalString(body, "addressLine", 300);
    const addressCity = optionalString(body, "addressCity", 120);
    const addressRegion = optionalString(body, "addressRegion", 40);
    const addressPostalCode = optionalString(body, "addressPostalCode", 20);
    const cpf =
      body.cpf === undefined
        ? undefined
        : normalizeCpf(optionalString(body, "cpf", 20));
    const birthDate = optionalString(body, "birthDate", 10);
    if (
      birthDate &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ||
        birthDate > todayInSaoPaulo())
    ) {
      throw new HttpError(
        400,
        "invalid_birth_date",
        "Informe uma data de nascimento válida.",
      );
    }
    const [currentAccount] = await getDb()
      .select({
        displayName: customerAccounts.displayName,
        cpf: customerAccounts.cpf,
        birthDate: customerAccounts.birthDate,
      })
      .from(customerAccounts)
      .where(
        and(
          eq(customerAccounts.id, context.accountId),
          eq(customerAccounts.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (!currentAccount) {
      throw new HttpError(404, "customer_not_found", "Seu cadastro não foi encontrado.");
    }
    const nextDisplayName = displayName ?? currentAccount.displayName;
    const now = new Date().toISOString();
    const d1 = getD1Database();
    await d1.batch([
      d1
        .prepare(
          `UPDATE tutors
          SET full_name = ?, normalized_name = ?, phone_e164 = ?,
            whatsapp_enabled = ?, updated_at = ?
          WHERE id = ? AND account_id = ?`,
        )
        .bind(
          nextDisplayName,
          normalizeLookupText(nextDisplayName),
          phone,
          Boolean(phone) ? 1 : 0,
          now,
          context.tutorId,
          context.accountId,
        ),
      d1
        .prepare(
          `UPDATE customer_accounts
          SET display_name = ?, normalized_name = ?, address_line = ?,
            address_city = ?, address_region = ?, address_postal_code = ?,
            cpf = ?, birth_date = ?, updated_at = ?
          WHERE id = ? AND establishment_id = ?`,
        )
        .bind(
          nextDisplayName,
          normalizeLookupText(nextDisplayName),
          addressLine,
          addressCity,
          addressRegion,
          addressPostalCode,
          cpf === undefined ? currentAccount.cpf : cpf,
          body.birthDate === undefined ? currentAccount.birthDate : birthDate,
          now,
          context.accountId,
          establishmentId,
        ),
      d1
        .prepare(
          `UPDATE app_users
          SET display_name = ?, updated_at = ?
          WHERE id = ? AND establishment_id = ? AND role = 'customer'`,
        )
        .bind(nextDisplayName, now, identity.userId, establishmentId),
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, result, metadata_json,
            occurred_at
          ) VALUES (?, ?, ?, ?, 'customer.profile_updated',
            'customer_account', ?, ?, 'success', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          establishmentId,
          identity.userId,
          identity.role,
          context.accountId,
          requestId,
          JSON.stringify({
            changedFields: [
              "phone",
              "displayName",
              "addressLine",
              "addressCity",
              "addressRegion",
              "addressPostalCode",
              "cpf",
              "birthDate",
            ],
          }),
          now,
        ),
    ]);
    return json({ updated: true });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
