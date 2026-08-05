import { and, between, desc, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  auditEvents,
  cashEntries,
  establishments,
  invoicePayments,
  invoices,
} from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  optionalString,
  readJsonObject,
  requiredInteger,
  requiredString,
} from "@/lib/server/http";

export const dynamic = "force-dynamic";

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const directions = new Set(["inflow", "outflow"]);

function validIsoDate(value: string) {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function periodFor(anchorMonth: string, startDay: number) {
  const [year, month] = anchorMonth.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, startDay));
  const nextStart = new Date(Date.UTC(year, month, startDay));
  const end = new Date(nextStart);
  end.setUTCDate(end.getUTCDate() - 1);
  return { start: isoDate(start), end: isoDate(end) };
}

function shiftAnchorMonth(anchorMonth: string, delta: number) {
  const [year, month] = anchorMonth.split("-").map(Number);
  return isoDate(new Date(Date.UTC(year, month - 1 + delta, 1))).slice(0, 7);
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, ["owner"]);
    const establishmentId = identity.establishmentId!;
    const anchorMonth =
      new URL(request.url).searchParams.get("month") ??
      new Date().toISOString().slice(0, 7);
    if (!monthPattern.test(anchorMonth)) {
      throw new HttpError(
        400,
        "invalid_cash_month",
        "O mês selecionado é inválido.",
      );
    }

    const db = getDb();
    const [establishment] = await db
      .select({
        monthStartDay: establishments.cashMonthStartDay,
      })
      .from(establishments)
      .where(eq(establishments.id, establishmentId))
      .limit(1);
    if (!establishment) {
      throw new HttpError(
        404,
        "establishment_not_found",
        "A unidade não foi encontrada.",
      );
    }
    const monthStartDay = Math.min(
      28,
      Math.max(1, establishment.monthStartDay),
    );
    const period = periodFor(anchorMonth, monthStartDay);
    const entries = await db
      .select({
        id: cashEntries.id,
        direction: cashEntries.direction,
        origin: cashEntries.origin,
        sourcePaymentId: cashEntries.sourcePaymentId,
        occurredOn: cashEntries.occurredOn,
        amountCents: cashEntries.amountCents,
        category: cashEntries.category,
        description: cashEntries.description,
        note: cashEntries.note,
        status: cashEntries.status,
        exclusionReason: cashEntries.exclusionReason,
        invoiceId: invoicePayments.invoiceId,
        invoiceNumber: invoices.invoiceNumber,
        customerName: invoices.recipientNameSnapshot,
        createdAt: cashEntries.createdAt,
        updatedAt: cashEntries.updatedAt,
      })
      .from(cashEntries)
      .leftJoin(
        invoicePayments,
        eq(invoicePayments.id, cashEntries.sourcePaymentId),
      )
      .leftJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
      .where(
        and(
          eq(cashEntries.establishmentId, establishmentId),
          between(cashEntries.occurredOn, period.start, period.end),
        ),
      )
      .orderBy(desc(cashEntries.occurredOn), desc(cashEntries.createdAt))
      .limit(1_000);

    const included = entries.filter((entry) => entry.status === "included");
    const inflowCents = included
      .filter((entry) => entry.direction === "inflow")
      .reduce((total, entry) => total + entry.amountCents, 0);
    const outflowCents = included
      .filter((entry) => entry.direction === "outflow")
      .reduce((total, entry) => total + entry.amountCents, 0);

    const previousPeriod = periodFor(
      shiftAnchorMonth(anchorMonth, -1),
      monthStartDay,
    );
    const d1 = getD1Database();
    const [serviceResult, previousResult, receivableResult, creditSalesResult, creditResult] =
      await d1.batch([
        d1
          .prepare(
            `SELECT sc.code AS service_code,
              ii.appointment_item_id AS item_id,
              ai.appointment_id AS appointment_id,
              a.account_id AS account_id,
              a.dog_id AS dog_id,
              a.lodging_nights AS lodging_nights,
              ii.amount_cents AS amount_cents,
              ip.id AS payment_id
            FROM invoice_items ii
            INNER JOIN invoices i ON i.id = ii.invoice_id
            INNER JOIN appointment_items ai ON ai.id = ii.appointment_item_id
            INNER JOIN appointments a ON a.id = ai.appointment_id
            INNER JOIN service_catalog sc ON sc.id = ai.service_catalog_id
            INNER JOIN invoice_payments ip ON ip.invoice_id = i.id
            INNER JOIN cash_entries ce ON ce.source_payment_id = ip.id
            WHERE i.establishment_id = ?
              AND ce.status = 'included'
              AND ce.occurred_on BETWEEN ? AND ?`,
          )
          .bind(establishmentId, period.start, period.end),
        d1
          .prepare(
            `SELECT
              COALESCE(SUM(CASE WHEN direction = 'inflow' AND status = 'included' THEN amount_cents ELSE 0 END), 0) AS inflow_cents,
              COALESCE(SUM(CASE WHEN direction = 'outflow' AND status = 'included' THEN amount_cents ELSE 0 END), 0) AS outflow_cents
            FROM cash_entries
            WHERE establishment_id = ? AND occurred_on BETWEEN ? AND ?`,
          )
          .bind(establishmentId, previousPeriod.start, previousPeriod.end),
        d1
          .prepare(
            `SELECT COUNT(*) AS invoice_count,
              COALESCE(SUM(total_cents), 0) AS total_cents
            FROM invoices
            WHERE establishment_id = ? AND status = 'issued'`,
          )
          .bind(establishmentId),
        d1
          .prepare(
            `SELECT sc.code AS service_code,
              COALESCE(SUM(cp.credit_units), 0) AS credit_units,
              COALESCE(SUM(cp.amount_cents), 0) AS credit_sold_cents
            FROM credit_purchases cp
            INNER JOIN service_catalog sc ON sc.id = cp.service_catalog_id
            INNER JOIN invoice_payments ip ON ip.invoice_id = cp.invoice_id
            INNER JOIN cash_entries ce ON ce.source_payment_id = ip.id
            WHERE cp.establishment_id = ?
              AND cp.status = 'paid'
              AND ce.status = 'included'
              AND ce.occurred_on BETWEEN ? AND ?
            GROUP BY sc.code`,
          )
          .bind(establishmentId, period.start, period.end),
        d1
          .prepare(
            `SELECT
              (SELECT COALESCE(-SUM(delta_units), 0) FROM credit_movements
                WHERE establishment_id = ? AND movement_type = 'consume'
                  AND date(occurred_at, '-3 hours') BETWEEN ? AND ?) AS used_units,
              (SELECT COALESCE(SUM(delta_units), 0) FROM credit_movements
                WHERE establishment_id = ?) AS available_units`,
          )
          .bind(
            establishmentId,
            period.start,
            period.end,
            establishmentId,
          ),
      ]);

    type ServiceRow = {
      service_code: string;
      item_id: string;
      appointment_id: string;
      account_id: string;
      dog_id: string;
      lodging_nights: number | null;
      amount_cents: number;
      payment_id: string;
    };
    type CreditSaleRow = {
      service_code: string;
      credit_units: number;
      credit_sold_cents: number;
    };
    const serviceRows = serviceResult.results as ServiceRow[];
    const creditSales = creditSalesResult.results as CreditSaleRow[];
    const serviceCodes = [
      ["bath", "Banho"],
      ["bath_grooming", "Banho e tosa"],
      ["daycare", "Creche"],
      ["lodging", "Hospedagem"],
      ["taxi_dog", "Taxi-dog"],
    ] as const;
    const serviceStats = serviceCodes.map(([code, label]) => {
      const rows = serviceRows.filter((row) => row.service_code === code);
      const creditSale = creditSales.find(
        (sale) => sale.service_code === code,
      );
      const uniqueItems = new Set(rows.map((row) => row.item_id));
      const standaloneReceivedCents = rows.reduce(
        (total, row) => total + row.amount_cents,
        0,
      );
      const creditSoldCents = Number(creditSale?.credit_sold_cents ?? 0);
      return {
        code,
        label,
        creditUnits: Number(creditSale?.credit_units ?? 0),
        creditSoldCents,
        standaloneCount: uniqueItems.size,
        standaloneReceivedCents,
        receivedCents: creditSoldCents + standaloneReceivedCents,
      };
    });
    const previous = previousResult.results[0] as
      | { inflow_cents?: number; outflow_cents?: number }
      | undefined;
    const receivable = receivableResult.results[0] as
      | { invoice_count?: number; total_cents?: number }
      | undefined;
    const credits = creditResult.results[0] as
      | {
          used_units?: number;
          available_units?: number;
        }
      | undefined;
    const dailyMap = new Map<
      string,
      { date: string; inflowCents: number; outflowCents: number }
    >();
    const expenseMap = new Map<string, number>();
    for (const entry of included) {
      const day = dailyMap.get(entry.occurredOn) ?? {
        date: entry.occurredOn,
        inflowCents: 0,
        outflowCents: 0,
      };
      if (entry.direction === "inflow") day.inflowCents += entry.amountCents;
      else {
        day.outflowCents += entry.amountCents;
        expenseMap.set(
          entry.category,
          (expenseMap.get(entry.category) ?? 0) + entry.amountCents,
        );
      }
      dailyMap.set(entry.occurredOn, day);
    }
    let cumulativeCents = 0;
    const dailyCash = [...dailyMap.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((day) => {
        cumulativeCents += day.inflowCents - day.outflowCents;
        return { ...day, cumulativeCents };
      });
    const automaticInflowCents = serviceStats.reduce(
      (total, service) => total + service.receivedCents,
      0,
    );

    return json({
      anchorMonth,
      monthStartDay,
      period,
      totals: {
        inflowCents,
        outflowCents,
        balanceCents: inflowCents - outflowCents,
        receivableCents: Number(receivable?.total_cents ?? 0),
        receivableCount: Number(receivable?.invoice_count ?? 0),
        excludedCount: entries.length - included.length,
      },
      analytics: {
        serviceStats,
        previousTotals: {
          inflowCents: Number(previous?.inflow_cents ?? 0),
          outflowCents: Number(previous?.outflow_cents ?? 0),
        },
        automaticInflowCents,
        otherInflowCents: Math.max(0, inflowCents - automaticInflowCents),
        credits: {
          soldUnits: creditSales.reduce(
            (total, sale) => total + Number(sale.credit_units),
            0,
          ),
          soldCents: creditSales.reduce(
            (total, sale) => total + Number(sale.credit_sold_cents),
            0,
          ),
          usedUnits: Number(credits?.used_units ?? 0),
          availableUnits: Number(credits?.available_units ?? 0),
        },
        dailyCash,
        expenseCategories: [...expenseMap.entries()]
          .map(([category, amountCents]) => ({ category, amountCents }))
          .sort((a, b) => b.amountCents - a.amountCents),
      },
      entries,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner"]);
    const body = await readJsonObject(request);
    const direction = requiredString(body, "direction", 20);
    if (!directions.has(direction)) {
      throw new HttpError(
        400,
        "invalid_cash_direction",
        "Escolha entrada ou saída.",
      );
    }
    const occurredOn = requiredString(body, "occurredOn", 10);
    if (!validIsoDate(occurredOn)) {
      throw new HttpError(
        400,
        "invalid_cash_date",
        "A data do lançamento é inválida.",
      );
    }
    const amountCents = requiredInteger(body, "amountCents", {
      min: 1,
      max: 100_000_000_00,
    });
    const category = requiredString(body, "category", 60);
    const description = requiredString(body, "description", 160);
    const note = optionalString(body, "note", 500);
    const id = crypto.randomUUID();
    const establishmentId = identity.establishmentId!;
    const db = getDb();

    await db.batch([
      db.insert(cashEntries).values({
        id,
        establishmentId,
        direction: direction as "inflow" | "outflow",
        origin: "manual",
        occurredOn,
        amountCents,
        category,
        description,
        note,
        status: "included",
        createdByUserId: identity.userId,
        updatedByUserId: identity.userId,
      }),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "cash.entry_created",
        entityType: "cash_entry",
        entityId: id,
        requestId,
        result: "success",
        metadataJson: JSON.stringify({
          direction,
          occurredOn,
          amountCents,
          category,
        }),
      }),
    ]);

    return json(
      {
        entry: {
          id,
          direction,
          origin: "manual",
          occurredOn,
          amountCents,
          category,
          description,
          note,
          status: "included",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
