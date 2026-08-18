import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  appUsers,
  creditMovements,
  creditPurchases,
  customerAccounts,
  invoiceItems,
  invoiceMergeMembers,
  invoiceMerges,
  invoicePayments,
  invoices,
  serviceCatalog,
  tutors,
} from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import { errorResponse, HttpError, json } from "@/lib/server/http";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: string | null) {
  if (!value || !datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function dateOnly(value: string | null | undefined) {
  return value?.slice(0, 10) ?? "";
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, ["owner", "finance", "customer"]);
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!validDate(from) || !validDate(to) || from! > to!) {
      throw new HttpError(400, "invalid_statement_period", "Escolha um período válido para o extrato.");
    }
    const span = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
    if (span > 366) {
      throw new HttpError(400, "statement_period_too_long", "Consulte no máximo 12 meses por extrato.");
    }

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    let accountId = url.searchParams.get("accountId");
    if (identity.role === "customer") {
      const [context] = await db
        .select({ accountId: tutors.accountId })
        .from(appUsers)
        .innerJoin(tutors, eq(tutors.id, appUsers.tutorId))
        .innerJoin(customerAccounts, eq(customerAccounts.id, tutors.accountId))
        .where(and(
          eq(appUsers.id, identity.userId!),
          eq(appUsers.establishmentId, establishmentId),
          eq(appUsers.status, "active"),
          eq(tutors.status, "active"),
          eq(customerAccounts.status, "active"),
        ))
        .limit(1);
      if (!context) throw new HttpError(403, "customer_link_missing", "A conta de cliente não está disponível.");
      accountId = context.accountId;
    }
    if (!accountId || accountId.length > 80) {
      throw new HttpError(400, "statement_customer_required", "Escolha o cliente do extrato.");
    }
    const [account] = await db.select({
      id: customerAccounts.id,
      name: customerAccounts.displayName,
    }).from(customerAccounts).where(and(
      eq(customerAccounts.id, accountId),
      eq(customerAccounts.establishmentId, establishmentId),
    )).limit(1);
    if (!account) throw new HttpError(404, "customer_not_found", "O cliente não foi encontrado.");

    const [invoiceRows, paymentRows, creditRows, creditBalanceRows] = await Promise.all([
      db.select().from(invoices).where(and(
        eq(invoices.establishmentId, establishmentId),
        eq(invoices.accountId, accountId),
        inArray(invoices.status, ["issued", "paid"]),
      )).orderBy(asc(invoices.issuedAt), asc(invoices.createdAt)),
      db.select({
        id: invoicePayments.id,
        invoiceId: invoicePayments.invoiceId,
        amountCents: invoicePayments.amountCents,
        paidAt: invoicePayments.paidAt,
        invoiceNumber: invoices.invoiceNumber,
      }).from(invoicePayments).innerJoin(invoices, eq(invoices.id, invoicePayments.invoiceId)).where(and(
        eq(invoicePayments.establishmentId, establishmentId),
        eq(invoicePayments.status, "active"),
        eq(invoices.accountId, accountId),
        inArray(invoices.status, ["issued", "paid"]),
      )).orderBy(asc(invoicePayments.paidAt)),
      db.select({
        id: creditMovements.id,
        occurredAt: creditMovements.occurredAt,
        deltaUnits: creditMovements.deltaUnits,
        reason: creditMovements.reason,
        serviceName: serviceCatalog.name,
      }).from(creditMovements).innerJoin(serviceCatalog, eq(serviceCatalog.id, creditMovements.serviceCatalogId)).where(and(
        eq(creditMovements.establishmentId, establishmentId),
        eq(creditMovements.accountId, accountId),
      )).orderBy(asc(creditMovements.occurredAt)),
      db.select({
        serviceName: serviceCatalog.name,
        units: sql<number>`coalesce(sum(${creditMovements.deltaUnits}), 0)`,
      }).from(creditMovements).innerJoin(serviceCatalog, eq(serviceCatalog.id, creditMovements.serviceCatalogId)).where(and(
        eq(creditMovements.establishmentId, establishmentId),
        eq(creditMovements.accountId, accountId),
      )).groupBy(serviceCatalog.name).orderBy(asc(serviceCatalog.name)),
    ]);

    const invoiceIds = invoiceRows.map((invoice) => invoice.id);
    const [itemRows, mergeMemberRows] = invoiceIds.length
      ? await Promise.all([db.select({
          invoiceId: invoiceItems.invoiceId,
          dogName: invoiceItems.dogNameSnapshot,
          serviceName: invoiceItems.serviceNameSnapshot,
          serviceDate: invoiceItems.serviceDateSnapshot,
        }).from(invoiceItems).where(inArray(invoiceItems.invoiceId, invoiceIds)).orderBy(asc(invoiceItems.serviceDateSnapshot)),
        db.select({
          mergedInvoiceId: invoiceMerges.mergedInvoiceId,
          sourceInvoiceId: invoiceMergeMembers.sourceInvoiceId,
        }).from(invoiceMergeMembers).innerJoin(
          invoiceMerges,
          eq(invoiceMerges.id, invoiceMergeMembers.mergeId),
        ).where(and(
          eq(invoiceMerges.establishmentId, establishmentId),
          eq(invoiceMerges.status, "active"),
          inArray(invoiceMerges.mergedInvoiceId, invoiceIds),
        )),
      ])
      : [[], []];
    const itemsByInvoice = new Map<string, typeof itemRows>();
    for (const item of itemRows) {
      const items = itemsByInvoice.get(item.invoiceId) ?? [];
      items.push(item);
      itemsByInvoice.set(item.invoiceId, items);
    }
    const mergedTargetBySource = new Map(
      mergeMemberRows.map((row) => [row.sourceInvoiceId, row.mergedInvoiceId]),
    );
    const purchaseInvoiceIds = [...new Set([
      ...invoiceIds,
      ...mergeMemberRows.map((row) => row.sourceInvoiceId),
    ])];
    const purchaseRows = purchaseInvoiceIds.length
      ? await db.select({
          invoiceId: creditPurchases.invoiceId,
          units: creditPurchases.creditUnits,
          serviceName: serviceCatalog.name,
        }).from(creditPurchases).innerJoin(
          serviceCatalog,
          eq(serviceCatalog.id, creditPurchases.serviceCatalogId),
        ).where(inArray(creditPurchases.invoiceId, purchaseInvoiceIds))
      : [];
    const purchasesByInvoice = new Map<string, typeof purchaseRows>();
    for (const purchase of purchaseRows) {
      const targetInvoiceId = mergedTargetBySource.get(purchase.invoiceId) ?? purchase.invoiceId;
      const items = purchasesByInvoice.get(targetInvoiceId) ?? [];
      items.push(purchase);
      purchasesByInvoice.set(targetInvoiceId, items);
    }

    const charges = invoiceRows.map((invoice) => ({
      id: `invoice:${invoice.id}`,
      date: dateOnly(invoice.issuedAt ?? invoice.createdAt),
      type: "invoice" as const,
      reference: invoice.invoiceNumber,
      dueDate: invoice.dueDate,
      description: [
        ...(itemsByInvoice.get(invoice.id) ?? [])
          .map((item) => `${item.dogName} · ${item.serviceName}`),
        ...(purchasesByInvoice.get(invoice.id) ?? [])
          .map((purchase) => `${purchase.units} créditos de ${purchase.serviceName}`),
      ]
        .filter((value, index, values) => values.indexOf(value) === index)
        .join("; ") || "Fatura emitida",
      debitCents: invoice.totalCents,
      creditCents: 0,
    }));
    const payments = paymentRows.map((payment) => ({
      id: `payment:${payment.id}`,
      date: dateOnly(payment.paidAt),
      type: "payment" as const,
      reference: payment.invoiceNumber,
      dueDate: null,
      description: `Pagamento da fatura ${payment.invoiceNumber}`,
      debitCents: 0,
      creditCents: payment.amountCents,
    }));
    const allEntries = [...charges, ...payments].sort((left, right) =>
      `${left.date}-${left.type}-${left.reference}`.localeCompare(`${right.date}-${right.type}-${right.reference}`),
    );
    const openingBalanceCents = allEntries
      .filter((entry) => entry.date < from!)
      .reduce((balance, entry) => balance + entry.debitCents - entry.creditCents, 0);
    let runningBalanceCents = openingBalanceCents;
    const entries = allEntries
      .filter((entry) => entry.date >= from! && entry.date <= to!)
      .map((entry) => {
        runningBalanceCents += entry.debitCents - entry.creditCents;
        return { ...entry, runningBalanceCents };
      });
    const chargesInPeriodCents = entries.reduce(
      (total, entry) => total + entry.debitCents,
      0,
    );
    const paymentsInPeriodCents = entries.reduce(
      (total, entry) => total + entry.creditCents,
      0,
    );
    const creditMovementsInPeriod = creditRows
      .filter((movement) => dateOnly(movement.occurredAt) >= from! && dateOnly(movement.occurredAt) <= to!)
      .map((movement) => ({
        id: movement.id,
        date: dateOnly(movement.occurredAt),
        serviceName: movement.serviceName,
        deltaUnits: movement.deltaUnits,
        reason: movement.reason,
      }));

    return json({
      customer: account,
      period: { from, to },
      openingBalanceCents,
      closingBalanceCents: runningBalanceCents,
      summary: {
        openingAmountDueCents: Math.max(0, openingBalanceCents),
        openingCustomerCreditCents: Math.max(0, -openingBalanceCents),
        chargesInPeriodCents,
        paymentsInPeriodCents,
        amountDueCents: Math.max(0, runningBalanceCents),
        customerCreditCents: Math.max(0, -runningBalanceCents),
      },
      entries,
      creditMovements: creditMovementsInPeriod,
      creditBalances: creditBalanceRows
        .map((row) => ({
          serviceName: row.serviceName,
          units: Number(row.units),
        }))
        .filter((row) => row.units !== 0),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
