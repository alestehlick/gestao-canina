import { getD1Database } from "@/db";
import { HttpError } from "@/lib/server/http";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

export async function assertCashDateIsOpen(
  establishmentId: string,
  occurredOn: string,
) {
  const closed = await getD1Database()
    .prepare(
      `SELECT id
       FROM cash_periods
       WHERE establishment_id = ? AND status = 'closed'
         AND ? BETWEEN period_start AND period_end
       LIMIT 1`,
    )
    .bind(establishmentId, occurredOn)
    .first<{ id: string }>();
  if (closed) {
    throw new HttpError(
      409,
      "cash_period_closed",
      "Este período está fechado. Um administrador precisa reabri-lo antes de alterar o Caixa.",
    );
  }
}

export async function calculatedAccountBalance(
  establishmentId: string,
  financialAccountId: string,
  throughDate: string,
) {
  const result = await getD1Database()
    .prepare(
      `SELECT
        fa.opening_balance_cents AS opening_balance_cents,
        fa.opening_balance_on AS opening_balance_on,
        COALESCE(SUM(CASE
          WHEN ce.status = 'included' AND ce.direction = 'inflow' THEN ce.amount_cents
          WHEN ce.status = 'included' AND ce.direction = 'outflow' THEN -ce.amount_cents
          ELSE 0
        END), 0) AS movement_cents
       FROM financial_accounts fa
       LEFT JOIN cash_entries ce
         ON ce.financial_account_id = fa.id
        AND ce.establishment_id = fa.establishment_id
        AND ce.occurred_on <= ?
        AND (fa.opening_balance_on IS NULL OR ce.occurred_on >= fa.opening_balance_on)
       WHERE fa.id = ? AND fa.establishment_id = ?
       GROUP BY fa.id`,
    )
    .bind(throughDate, financialAccountId, establishmentId)
    .first<{
      opening_balance_cents: number | null;
      opening_balance_on: string | null;
      movement_cents: number;
    }>();
  if (!result) {
    throw new HttpError(
      404,
      "financial_account_not_found",
      "A conta financeira não foi encontrada.",
    );
  }
  if (result.opening_balance_cents === null || !result.opening_balance_on) {
    return null;
  }
  return Number(result.opening_balance_cents) + Number(result.movement_cents);
}
