import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  auditEvents,
  cashEntries,
  establishments,
  financialAccounts,
} from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import { assertCashDateIsOpen, isIsoDate, todayInSaoPaulo } from "@/lib/server/cash";
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
const directions = new Set(["inflow", "outflow"]);

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
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const establishmentId = identity.establishmentId!;
    const searchParams = new URL(request.url).searchParams;
    const anchorMonth = searchParams.get("month") ?? todayInSaoPaulo().slice(0, 7);
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
    const accountId = searchParams.get("accountId") || null;
    if (accountId) {
      const [account] = await db
        .select({ id: financialAccounts.id })
        .from(financialAccounts)
        .where(
          and(
            eq(financialAccounts.id, accountId),
            eq(financialAccounts.establishmentId, establishmentId),
          ),
        )
        .limit(1);
      if (!account) {
        throw new HttpError(404, "financial_account_not_found", "A conta financeira não foi encontrada.");
      }
    }

    const directionFilter = searchParams.get("direction") ?? "all";
    const statusFilter = searchParams.get("status") ?? "included";
    const originFilter = searchParams.get("origin") ?? "all";
    const categoryFilter = searchParams.get("category")?.trim() || null;
    const query = searchParams.get("q")?.trim().slice(0, 120) || null;
    if (!["all", "inflow", "outflow"].includes(directionFilter)) {
      throw new HttpError(400, "invalid_cash_filter", "O filtro de movimentação é inválido.");
    }
    if (!["all", "included", "excluded"].includes(statusFilter)) {
      throw new HttpError(400, "invalid_cash_filter", "O filtro de situação é inválido.");
    }
    if (!["all", "automatic", "manual", "transfer"].includes(originFilter)) {
      throw new HttpError(400, "invalid_cash_filter", "O filtro de origem é inválido.");
    }
    const exportMode = searchParams.get("export") === "1";
    const page = exportMode
      ? 1
      : Math.max(1, Math.min(10_000, Number(searchParams.get("page") ?? 1) || 1));
    const pageSize = exportMode ? 5_000 : 50;
    const offset = (page - 1) * pageSize;

    const entryConditions = [
      "ce.establishment_id = ?",
      "ce.occurred_on BETWEEN ? AND ?",
    ];
    const entryBindings: Array<string | number> = [establishmentId, period.start, period.end];
    if (accountId) {
      entryConditions.push("ce.financial_account_id = ?");
      entryBindings.push(accountId);
    }
    if (directionFilter !== "all") {
      entryConditions.push("ce.direction = ?");
      entryBindings.push(directionFilter);
    }
    if (statusFilter !== "all") {
      entryConditions.push("ce.status = ?");
      entryBindings.push(statusFilter);
    }
    if (originFilter === "automatic") entryConditions.push("ce.origin = 'invoice_payment'");
    if (originFilter === "manual") entryConditions.push("ce.origin = 'manual' AND ce.transfer_id IS NULL");
    if (originFilter === "transfer") entryConditions.push("ce.transfer_id IS NOT NULL");
    if (categoryFilter) {
      entryConditions.push("ce.category = ?");
      entryBindings.push(categoryFilter);
    }
    if (query) {
      entryConditions.push(
        "(ce.description LIKE ? OR ce.category LIKE ? OR COALESCE(ce.note, '') LIKE ? OR COALESCE(i.invoice_number, '') LIKE ? OR COALESCE(i.recipient_name_snapshot, '') LIKE ?)",
      );
      const likeQuery = `%${query}%`;
      entryBindings.push(likeQuery, likeQuery, likeQuery, likeQuery, likeQuery);
    }
    const entryWhere = entryConditions.join(" AND ");
    const accountClause = accountId ? "AND ce.financial_account_id = ?" : "";
    const accountBindings = accountId ? [accountId] : [];

    const previousPeriod = periodFor(
      shiftAnchorMonth(anchorMonth, -1),
      monthStartDay,
    );
    const d1 = getD1Database();
    const [
      entryResult,
      entryCountResult,
      totalsResult,
      serviceResult,
      previousResult,
      receivableResult,
      creditSalesResult,
      creditResult,
      dailyResult,
      expenseResult,
      categoryResult,
      periodResult,
    ] =
      await d1.batch([
        d1
          .prepare(
            `SELECT ce.id, ce.direction, ce.origin, ce.source_payment_id,
              ce.transfer_id, ce.financial_account_id, fa.name AS financial_account_name,
              ce.occurred_on, ce.amount_cents, ce.category, ce.description, ce.note,
              ce.status, ce.exclusion_reason, ce.created_at, ce.updated_at, ce.version,
              ip.invoice_id, i.invoice_number, i.recipient_name_snapshot AS customer_name,
              ct.version AS transfer_version, ct.status AS transfer_status,
              (SELECT display_name FROM app_users WHERE id = ce.created_by_user_id) AS created_by_name,
              (SELECT display_name FROM app_users WHERE id = ce.updated_by_user_id) AS updated_by_name,
              (SELECT display_name FROM app_users WHERE id = ce.excluded_by_user_id) AS excluded_by_name,
              (SELECT original_name FROM private_files pf
                WHERE pf.establishment_id = ce.establishment_id
                  AND pf.owner_type = 'cash_entry' AND pf.owner_id = ce.id
                  AND pf.status = 'ready' LIMIT 1) AS receipt_name
             FROM cash_entries ce
             LEFT JOIN invoice_payments ip ON ip.id = ce.source_payment_id
             LEFT JOIN invoices i ON i.id = ip.invoice_id
             LEFT JOIN financial_accounts fa ON fa.id = ce.financial_account_id
             LEFT JOIN cash_transfers ct ON ct.id = ce.transfer_id
             WHERE ${entryWhere}
             ORDER BY ce.occurred_on DESC, ce.created_at DESC
             LIMIT ? OFFSET ?`,
          )
          .bind(...entryBindings, pageSize, offset),
        d1
          .prepare(
            `SELECT COUNT(*) AS total
             FROM cash_entries ce
             LEFT JOIN invoice_payments ip ON ip.id = ce.source_payment_id
             LEFT JOIN invoices i ON i.id = ip.invoice_id
             WHERE ${entryWhere}`,
          )
          .bind(...entryBindings),
        d1
          .prepare(
            `SELECT
              COALESCE(SUM(CASE WHEN ce.status = 'included' AND ce.transfer_id IS NULL AND ce.direction = 'inflow' THEN ce.amount_cents ELSE 0 END), 0) AS received_cents,
              COALESCE(SUM(CASE WHEN ce.status = 'included' AND ce.transfer_id IS NULL AND ce.direction = 'outflow' THEN ce.amount_cents ELSE 0 END), 0) AS paid_cents,
              COALESCE(SUM(CASE WHEN ce.status = 'included' AND ce.direction = 'inflow' THEN ce.amount_cents WHEN ce.status = 'included' THEN -ce.amount_cents ELSE 0 END), 0) AS account_movement_cents,
              COALESCE(SUM(CASE WHEN ce.status = 'included' AND ce.origin = 'invoice_payment' THEN ce.amount_cents ELSE 0 END), 0) AS automatic_inflow_cents,
              COALESCE(SUM(CASE WHEN ce.status = 'included' AND ce.origin = 'manual' AND ce.transfer_id IS NULL AND ce.direction = 'inflow' THEN ce.amount_cents ELSE 0 END), 0) AS manual_inflow_cents,
              COALESCE(SUM(CASE WHEN ce.status = 'included' AND ce.transfer_id IS NOT NULL AND ce.direction = 'inflow' THEN ce.amount_cents ELSE 0 END), 0) AS transfer_inflow_cents,
              COALESCE(SUM(CASE WHEN ce.status = 'included' AND ce.transfer_id IS NOT NULL AND ce.direction = 'outflow' THEN ce.amount_cents ELSE 0 END), 0) AS transfer_outflow_cents,
              COALESCE(SUM(CASE WHEN ce.status = 'excluded' THEN 1 ELSE 0 END), 0) AS excluded_count
             FROM cash_entries ce
             WHERE ce.establishment_id = ? AND ce.occurred_on BETWEEN ? AND ? ${accountClause}`,
          )
          .bind(establishmentId, period.start, period.end, ...accountBindings),
        d1
          .prepare(
            `SELECT CASE
                WHEN sc.code = 'bath'
                  AND json_extract(ai.details_json, '$.groomingAddon') = 1
                  THEN 'bath_grooming'
                ELSE sc.code
              END AS service_code,
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
              AND ip.status = 'active'
              AND ce.status = 'included'
              AND ce.occurred_on BETWEEN ? AND ?
              ${accountClause}`,
          )
          .bind(establishmentId, period.start, period.end, ...accountBindings),
        d1
          .prepare(
            `SELECT
              COALESCE(SUM(CASE WHEN direction = 'inflow' AND status = 'included' THEN amount_cents ELSE 0 END), 0) AS inflow_cents,
              COALESCE(SUM(CASE WHEN direction = 'outflow' AND status = 'included' THEN amount_cents ELSE 0 END), 0) AS outflow_cents
            FROM cash_entries ce
            WHERE ce.establishment_id = ? AND ce.occurred_on BETWEEN ? AND ?
              AND ce.transfer_id IS NULL ${accountClause}`,
          )
          .bind(establishmentId, previousPeriod.start, previousPeriod.end, ...accountBindings),
        d1
          .prepare(
            `SELECT COUNT(*) AS invoice_count,
              COALESCE(SUM(total_cents), 0) AS total_cents
            FROM invoices i
            WHERE i.establishment_id = ? AND i.status = 'issued'
              AND i.due_date < ?
              AND NOT EXISTS (
                SELECT 1 FROM invoice_settlements s
                WHERE s.invoice_id = i.id AND s.status = 'scheduled'
              )`,
          )
          .bind(establishmentId, todayInSaoPaulo()),
        d1
          .prepare(
            `SELECT sc.code AS service_code,
              COALESCE(SUM(cp.credit_units), 0) AS credit_units,
              COALESCE(SUM(cp.amount_cents), 0) AS credit_sold_cents
            FROM credit_purchases cp
            INNER JOIN service_catalog sc ON sc.id = cp.service_catalog_id
            LEFT JOIN invoice_merge_members imm
              ON imm.source_invoice_id = cp.invoice_id
            LEFT JOIN invoice_merges im
              ON im.id = imm.merge_id AND im.status = 'active'
            INNER JOIN invoice_payments ip
              ON ip.invoice_id = COALESCE(im.merged_invoice_id, cp.invoice_id)
            INNER JOIN cash_entries ce ON ce.source_payment_id = ip.id
            WHERE cp.establishment_id = ?
              AND cp.status = 'paid'
              AND ip.status = 'active'
              AND ce.status = 'included'
              AND ce.occurred_on BETWEEN ? AND ?
              ${accountClause}
            GROUP BY sc.code`,
          )
          .bind(establishmentId, period.start, period.end, ...accountBindings),
        d1
          .prepare(
            `SELECT sc.code AS service_code,
              COALESCE(SUM(CASE WHEN cm.movement_type = 'consume'
                AND date(cm.occurred_at, '-3 hours') BETWEEN ? AND ?
                THEN -cm.delta_units ELSE 0 END), 0) AS used_units,
              COALESCE(SUM(cm.delta_units), 0) AS available_units
             FROM credit_movements cm
             INNER JOIN service_catalog sc ON sc.id = cm.service_catalog_id
             WHERE cm.establishment_id = ?
             GROUP BY sc.code`,
          )
          .bind(period.start, period.end, establishmentId),
        d1
          .prepare(
            `SELECT ce.occurred_on AS date,
              COALESCE(SUM(CASE WHEN ce.direction = 'inflow' THEN ce.amount_cents ELSE 0 END), 0) AS inflow_cents,
              COALESCE(SUM(CASE WHEN ce.direction = 'outflow' THEN ce.amount_cents ELSE 0 END), 0) AS outflow_cents
             FROM cash_entries ce
             WHERE ce.establishment_id = ? AND ce.status = 'included'
               AND ce.transfer_id IS NULL AND ce.occurred_on BETWEEN ? AND ? ${accountClause}
             GROUP BY ce.occurred_on ORDER BY ce.occurred_on`,
          )
          .bind(establishmentId, period.start, period.end, ...accountBindings),
        d1
          .prepare(
            `SELECT ce.category, COALESCE(SUM(ce.amount_cents), 0) AS amount_cents
             FROM cash_entries ce
             WHERE ce.establishment_id = ? AND ce.status = 'included'
               AND ce.direction = 'outflow' AND ce.transfer_id IS NULL
               AND ce.occurred_on BETWEEN ? AND ? ${accountClause}
             GROUP BY ce.category ORDER BY amount_cents DESC`,
          )
          .bind(establishmentId, period.start, period.end, ...accountBindings),
        d1
          .prepare(
            `SELECT category, COUNT(*) AS uses
             FROM cash_entries
             WHERE establishment_id = ? AND transfer_id IS NULL
             GROUP BY category ORDER BY uses DESC, category LIMIT 60`,
          )
          .bind(establishmentId),
        d1
          .prepare(
            `SELECT id, status, close_note, closed_at, reopened_at, reopen_reason, version
             FROM cash_periods
             WHERE establishment_id = ? AND period_start = ? AND period_end = ?
             LIMIT 1`,
          )
          .bind(establishmentId, period.start, period.end),
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
    type EntryRow = {
      id: string;
      direction: "inflow" | "outflow";
      origin: "invoice_payment" | "manual";
      source_payment_id: string | null;
      transfer_id: string | null;
      financial_account_id: string | null;
      financial_account_name: string | null;
      occurred_on: string;
      amount_cents: number;
      category: string;
      description: string;
      note: string | null;
      status: "included" | "excluded";
      exclusion_reason: string | null;
      invoice_id: string | null;
      invoice_number: string | null;
      customer_name: string | null;
      created_at: string;
      updated_at: string;
      version: number;
      transfer_version: number | null;
      transfer_status: "included" | "excluded" | null;
      created_by_name: string | null;
      updated_by_name: string | null;
      excluded_by_name: string | null;
      receipt_name: string | null;
    };
    const entries = (entryResult.results as EntryRow[]).map((entry) => ({
      id: entry.id,
      direction: entry.direction,
      origin: entry.transfer_id ? "transfer" : entry.origin,
      sourcePaymentId: entry.source_payment_id,
      transferId: entry.transfer_id,
      financialAccountId: entry.financial_account_id,
      financialAccountName: entry.financial_account_name,
      occurredOn: entry.occurred_on,
      amountCents: Number(entry.amount_cents),
      category: entry.category,
      description: entry.description,
      note: entry.note,
      status: entry.status,
      exclusionReason: entry.exclusion_reason,
      invoiceId: entry.invoice_id,
      invoiceNumber: entry.invoice_number,
      customerName: entry.customer_name,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
      version: Number(entry.version),
      transferVersion: entry.transfer_version === null ? null : Number(entry.transfer_version),
      createdByName: entry.created_by_name,
      updatedByName: entry.updated_by_name,
      excludedByName: entry.excluded_by_name,
      receiptName: entry.receipt_name,
      receiptUrl: entry.receipt_name ? `/api/cash/${entry.id}/receipt` : null,
    }));
    const serviceRows = serviceResult.results as ServiceRow[];
    const creditSales = creditSalesResult.results as CreditSaleRow[];
    const serviceCodes = [
      ["bath", "Banho"],
      ["bath_grooming", "Banho e tosa"],
      ["daycare", "Creche"],
      ["hotel", "Hospedagem"],
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
    let cumulativeCents = 0;
    const dailyCash = (
      dailyResult.results as Array<{
        date: string;
        inflow_cents: number;
        outflow_cents: number;
      }>
    ).map((day) => {
        const inflowCents = Number(day.inflow_cents);
        const outflowCents = Number(day.outflow_cents);
        cumulativeCents += inflowCents - outflowCents;
        return { date: day.date, inflowCents, outflowCents, cumulativeCents };
      });
    const allocatedAutomaticInflowCents = serviceStats.reduce(
      (total, service) => total + service.receivedCents,
      0,
    );
    const totals = totalsResult.results[0] as {
      received_cents?: number;
      paid_cents?: number;
      account_movement_cents?: number;
      automatic_inflow_cents?: number;
      manual_inflow_cents?: number;
      transfer_inflow_cents?: number;
      transfer_outflow_cents?: number;
      excluded_count?: number;
    } | undefined;
    const receivedCents = Number(totals?.received_cents ?? 0);
    const paidCents = Number(totals?.paid_cents ?? 0);
    const automaticInflowCents = Number(totals?.automatic_inflow_cents ?? 0);
    const creditUsage = creditResult.results as Array<{
      service_code: string;
      used_units: number;
      available_units: number;
    }>;
    const periodRecord = periodResult.results[0] as
      | {
          id: string;
          status: "open" | "closed";
          close_note: string | null;
          closed_at: string | null;
          reopened_at: string | null;
          reopen_reason: string | null;
          version: number;
        }
      | undefined;
    const entryCount = Number(
      (entryCountResult.results[0] as { total?: number } | undefined)?.total ?? 0,
    );

    return json({
      anchorMonth,
      monthStartDay,
      period,
      periodState: periodRecord
        ? {
            id: periodRecord.id,
            status: periodRecord.status,
            closeNote: periodRecord.close_note,
            closedAt: periodRecord.closed_at,
            reopenedAt: periodRecord.reopened_at,
            reopenReason: periodRecord.reopen_reason,
            version: Number(periodRecord.version),
          }
        : { status: "open", version: 0 },
      totals: {
        receivedCents,
        paidCents,
        resultCents: receivedCents - paidCents,
        accountMovementCents: Number(totals?.account_movement_cents ?? 0),
        overdueReceivableCents: Number(receivable?.total_cents ?? 0),
        overdueReceivableCount: Number(receivable?.invoice_count ?? 0),
        excludedCount: Number(totals?.excluded_count ?? 0),
        transferInflowCents: Number(totals?.transfer_inflow_cents ?? 0),
        transferOutflowCents: Number(totals?.transfer_outflow_cents ?? 0),
      },
      analytics: {
        serviceStats,
        previousTotals: {
          inflowCents: Number(previous?.inflow_cents ?? 0),
          outflowCents: Number(previous?.outflow_cents ?? 0),
        },
        automaticInflowCents,
        manualInflowCents: Number(totals?.manual_inflow_cents ?? 0),
        unallocatedAutomaticCents:
          automaticInflowCents - allocatedAutomaticInflowCents,
        credits: {
          soldUnits: creditSales.reduce(
            (total, sale) => total + Number(sale.credit_units),
            0,
          ),
          soldCents: creditSales.reduce(
            (total, sale) => total + Number(sale.credit_sold_cents),
            0,
          ),
          byService: ["daycare", "bath", "taxi_dog"].map((code) => {
            const usage = creditUsage.find((item) => item.service_code === code);
            const sale = creditSales.find((item) => item.service_code === code);
            return {
              code,
              label: code === "daycare" ? "Creche" : code === "bath" ? "Banho" : "Taxi-dog",
              soldUnits: Number(sale?.credit_units ?? 0),
              usedUnits: Number(usage?.used_units ?? 0),
              availableUnits: Number(usage?.available_units ?? 0),
            };
          }),
        },
        dailyCash,
        expenseCategories: (
          expenseResult.results as Array<{ category: string; amount_cents: number }>
        ).map((item) => ({ category: item.category, amountCents: Number(item.amount_cents) })),
      },
      categories: (categoryResult.results as Array<{ category: string }>).map(
        (item) => item.category,
      ),
      entries,
      pagination: {
        page,
        pageSize,
        total: entryCount,
        hasMore: offset + entries.length < entryCount,
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
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
    if (!isIsoDate(occurredOn) || occurredOn > todayInSaoPaulo()) {
      throw new HttpError(
        400,
        "invalid_cash_date",
        "A data do lançamento deve ser válida e não pode estar no futuro.",
      );
    }
    const amountCents = requiredInteger(body, "amountCents", {
      min: 1,
      max: 100_000_000_00,
    });
    const category = requiredString(body, "category", 60);
    const description = requiredString(body, "description", 160);
    const note = optionalString(body, "note", 500);
    const idempotencyKey = requiredString(body, "idempotencyKey", 100);
    const requestedFinancialAccountId = optionalString(
      body,
      "financialAccountId",
      80,
    );
    const id = crypto.randomUUID();
    const establishmentId = identity.establishmentId!;
    await assertCashDateIsOpen(establishmentId, occurredOn);
    const db = getDb();
    const [existing] = await db
      .select({ id: cashEntries.id })
      .from(cashEntries)
      .where(
        and(
          eq(cashEntries.establishmentId, establishmentId),
          eq(cashEntries.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) return json({ entry: existing, idempotent: true });
    const availableAccounts = await db
      .select({ id: financialAccounts.id })
      .from(financialAccounts)
      .where(
        requestedFinancialAccountId
          ? and(
              eq(financialAccounts.id, requestedFinancialAccountId),
              eq(financialAccounts.establishmentId, establishmentId),
              eq(financialAccounts.active, true),
            )
          : and(
              eq(financialAccounts.establishmentId, establishmentId),
              eq(financialAccounts.active, true),
            ),
      )
      .limit(requestedFinancialAccountId ? 1 : 2);
    const financialAccount = availableAccounts.length === 1 ? availableAccounts[0] : null;
    if (!financialAccount) {
      throw new HttpError(
        409,
        "financial_account_required",
        availableAccounts.length > 1
          ? "Escolha explicitamente a conta desta movimentação."
          : "Cadastre ou escolha uma conta financeira ativa.",
      );
    }

    await db.batch([
      db.insert(cashEntries).values({
        id,
        establishmentId,
        direction: direction as "inflow" | "outflow",
        origin: "manual",
        idempotencyKey,
        financialAccountId: financialAccount.id,
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
          financialAccountId: financialAccount.id,
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
          version: 1,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
