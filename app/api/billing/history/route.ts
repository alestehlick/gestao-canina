import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  lte,
  sql,
} from "drizzle-orm";
import { getDb } from "@/db";
import {
  appointmentItems,
  appointments,
  cashEntries,
  creditPurchases,
  invoiceItems,
  invoiceMergeMembers,
  invoiceMerges,
  invoicePayments,
  invoices,
  serviceCatalog,
} from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import { errorResponse, HttpError, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string | null): value is string {
  if (!value || !isoDatePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function daysBetween(from: string, to: string) {
  return Math.round(
    (new Date(`${to}T00:00:00.000Z`).valueOf() -
      new Date(`${from}T00:00:00.000Z`).valueOf()) /
      86_400_000,
  );
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!validDate(from) || !validDate(to) || daysBetween(from, to) < 0 || daysBetween(from, to) > 366) {
      throw new HttpError(400, "invalid_history_period", "Consulte um período de até 367 dias.");
    }

    const establishmentId = identity.establishmentId!;
    const fromTimestamp = `${from}T00:00:00.000Z`;
    const toTimestamp = `${to}T23:59:59.999Z`;
    const db = getDb();
    const invoiceColumns = getTableColumns(invoices);

    const [paidRows, voidRows] = await Promise.all([
      db
        .select({
          ...invoiceColumns,
          paidAt: invoicePayments.paidAt,
          cashEntryId: cashEntries.id,
          cashStatus: cashEntries.status,
        })
        .from(invoices)
        .innerJoin(
          invoicePayments,
          and(
            eq(invoicePayments.invoiceId, invoices.id),
            eq(invoicePayments.status, "active"),
          ),
        )
        .leftJoin(cashEntries, eq(cashEntries.sourcePaymentId, invoicePayments.id))
        .where(
          and(
            eq(invoices.establishmentId, establishmentId),
            eq(invoices.status, "paid"),
            gte(invoicePayments.paidAt, fromTimestamp),
            lte(invoicePayments.paidAt, toTimestamp),
          ),
        )
        .orderBy(desc(invoicePayments.paidAt))
        .limit(1_000),
      db
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.establishmentId, establishmentId),
            eq(invoices.status, "void"),
            gte(invoices.voidedAt, fromTimestamp),
            lte(invoices.voidedAt, toTimestamp),
          ),
        )
        .orderBy(desc(invoices.voidedAt))
        .limit(1_000),
    ]);

    const invoiceRows = [
      ...paidRows.map((row) => ({
        ...row,
        cashIncluded: row.cashEntryId ? row.cashStatus === "included" : undefined,
      })),
      ...voidRows.map((row) => ({
        ...row,
        paidAt: null,
        cashEntryId: null,
        cashIncluded: undefined,
      })),
    ];
    const invoiceIds = [...new Set(invoiceRows.map((invoice) => invoice.id))];
    if (!invoiceIds.length) {
      return json({ invoices: [], creditPurchases: [] });
    }

    const [itemRows, mergeRows] = await Promise.all([
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
          lodgingLongStayDiscountPercent: invoiceItems.lodgingLongStayDiscountPercent,
          lodgingLongStayDiscountCents: invoiceItems.lodgingLongStayDiscountCents,
          depositPercent: appointments.depositPercent,
        })
        .from(invoiceItems)
        .innerJoin(appointmentItems, eq(appointmentItems.id, invoiceItems.appointmentItemId))
        .innerJoin(appointments, eq(appointments.id, appointmentItems.appointmentId))
        .innerJoin(serviceCatalog, eq(serviceCatalog.id, appointmentItems.serviceCatalogId))
        .where(inArray(invoiceItems.invoiceId, invoiceIds))
        .orderBy(asc(invoiceItems.serviceDateSnapshot)),
      db
        .select({
          mergedInvoiceId: invoiceMerges.mergedInvoiceId,
          sourceInvoiceId: invoiceMergeMembers.sourceInvoiceId,
        })
        .from(invoiceMergeMembers)
        .innerJoin(invoiceMerges, eq(invoiceMerges.id, invoiceMergeMembers.mergeId))
        .where(
          and(
            eq(invoiceMerges.establishmentId, establishmentId),
            inArray(invoiceMerges.mergedInvoiceId, invoiceIds),
          ),
        ),
    ]);

    const itemsByInvoice = new Map<string, typeof itemRows>();
    for (const item of itemRows) {
      const items = itemsByInvoice.get(item.invoiceId) ?? [];
      items.push(item);
      itemsByInvoice.set(item.invoiceId, items);
    }
    const sourcesByInvoice = new Map<string, string[]>();
    for (const member of mergeRows) {
      const ids = sourcesByInvoice.get(member.mergedInvoiceId) ?? [];
      ids.push(member.sourceInvoiceId);
      sourcesByInvoice.set(member.mergedInvoiceId, ids);
    }
    const purchaseInvoiceIds = [
      ...invoiceIds,
      ...mergeRows.map((member) => member.sourceInvoiceId),
    ];
    const purchaseRows = purchaseInvoiceIds.length
      ? await db
          .select()
          .from(creditPurchases)
          .where(
            and(
              eq(creditPurchases.establishmentId, establishmentId),
              inArray(creditPurchases.invoiceId, purchaseInvoiceIds),
            ),
          )
      : [];

    return json({
      invoices: invoiceRows.map((invoice) => ({
        ...invoice,
        items: itemsByInvoice.get(invoice.id) ?? [],
        mergedSourceInvoiceIds: sourcesByInvoice.get(invoice.id) ?? [],
        compensationAvailableOn: null,
      })),
      creditPurchases: purchaseRows,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
