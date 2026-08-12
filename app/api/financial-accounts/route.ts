import { getD1Database, getDb } from "@/db";
import { auditEvents, financialAccounts } from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  optionalString,
  readJsonObject,
  optionalInteger,
  requiredString,
} from "@/lib/server/http";
import { isIsoDate, todayInSaoPaulo } from "@/lib/server/cash";

const kinds = ["checking", "savings", "cash", "other"] as const;
type FinancialAccountKind = (typeof kinds)[number];

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const includeInactive =
      new URL(request.url).searchParams.get("includeInactive") === "true" &&
      identity.role === "owner";
    const establishmentId = identity.establishmentId!;
    const throughDate =
      new URL(request.url).searchParams.get("through") ?? todayInSaoPaulo();
    if (!isIsoDate(throughDate)) {
      throw new HttpError(400, "invalid_account_balance_date", "A data de saldo é inválida.");
    }
    const rows = await getD1Database()
      .prepare(
        `SELECT fa.*,
          CASE WHEN fa.opening_balance_cents IS NULL OR fa.opening_balance_on IS NULL
            THEN NULL
            ELSE fa.opening_balance_cents + COALESCE((
              SELECT SUM(CASE WHEN ce.direction = 'inflow' THEN ce.amount_cents ELSE -ce.amount_cents END)
              FROM cash_entries ce
              WHERE ce.establishment_id = fa.establishment_id
                AND ce.financial_account_id = fa.id
                AND ce.status = 'included'
                AND ce.occurred_on BETWEEN fa.opening_balance_on AND ?
            ), 0)
          END AS calculated_balance_cents,
          (SELECT COUNT(*) FROM invoice_settlements s
            WHERE s.establishment_id = fa.establishment_id
              AND s.financial_account_id = fa.id
              AND s.status = 'scheduled') AS scheduled_settlement_count,
          (SELECT cr.difference_cents FROM cash_reconciliations cr
            WHERE cr.establishment_id = fa.establishment_id
              AND cr.financial_account_id = fa.id
            ORDER BY cr.reconciled_on DESC, cr.created_at DESC
            LIMIT 1) AS last_reconciliation_difference_cents
         FROM financial_accounts fa
         WHERE fa.establishment_id = ? AND (? = 1 OR fa.active = 1)
         ORDER BY fa.display_order, fa.name`,
      )
      .bind(throughDate, establishmentId, includeInactive ? 1 : 0)
      .all<{
        id: string;
        establishment_id: string;
        name: string;
        institution: string | null;
        kind: FinancialAccountKind;
        active: number;
        display_order: number;
        opening_balance_cents: number | null;
        opening_balance_on: string | null;
        reconciled_balance_cents: number | null;
        reconciled_on: string | null;
        reconciled_at: string | null;
        calculated_balance_cents: number | null;
        scheduled_settlement_count: number;
        last_reconciliation_difference_cents: number | null;
      }>();
    return json({
      accounts: rows.results.map((row) => ({
        id: row.id,
        name: row.name,
        institution: row.institution,
        kind: row.kind,
        active: Boolean(row.active),
        displayOrder: row.display_order,
        openingBalanceCents: row.opening_balance_cents,
        openingBalanceOn: row.opening_balance_on,
        reconciledBalanceCents: row.reconciled_balance_cents,
        reconciledOn: row.reconciled_on,
        reconciledAt: row.reconciled_at,
        calculatedBalanceCents: row.calculated_balance_cents,
        scheduledSettlementCount: Number(row.scheduled_settlement_count ?? 0),
        lastReconciliationDifferenceCents: row.last_reconciliation_difference_cents,
      })),
      throughDate,
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
    const name = requiredString(body, "name", 80);
    const institution = optionalString(body, "institution", 80);
    const kind = requiredString(body, "kind", 20) as FinancialAccountKind;
    if (!kinds.includes(kind)) {
      throw new HttpError(400, "invalid_financial_account_kind", "Escolha um tipo de conta válido.");
    }
    const openingBalanceCents = optionalInteger(body, "openingBalanceCents", {
      min: -100_000_000_00,
      max: 100_000_000_00,
    });
    const openingBalanceOn = optionalString(body, "openingBalanceOn", 10);
    if (
      (openingBalanceCents === null) !== (openingBalanceOn === null) ||
      (openingBalanceOn !== null &&
        (!isIsoDate(openingBalanceOn) || openingBalanceOn > todayInSaoPaulo()))
    ) {
      throw new HttpError(
        400,
        "invalid_opening_balance",
        "Informe o saldo inicial e a data de referência juntos.",
      );
    }
    const id = crypto.randomUUID();
    const establishmentId = identity.establishmentId!;
    const db = getDb();
    try {
      await db.batch([
        db.insert(financialAccounts).values({
          id,
          establishmentId,
          name,
          institution,
          kind,
          active: true,
          openingBalanceCents,
          openingBalanceOn,
          createdByUserId: identity.userId,
        }),
        db.insert(auditEvents).values({
          id: crypto.randomUUID(),
          establishmentId,
          actorUserId: identity.userId,
          actorRole: identity.role,
          action: "financial_account.created",
          entityType: "financial_account",
          entityId: id,
          requestId,
          metadataJson: JSON.stringify({ name, institution, kind, openingBalanceCents, openingBalanceOn }),
        }),
      ]);
    } catch (error) {
      if (error instanceof Error && /unique/i.test(error.message)) {
        throw new HttpError(409, "financial_account_duplicate", "Já existe uma conta com este nome.");
      }
      throw error;
    }
    return json({ account: { id, name, institution, kind, active: true, openingBalanceCents, openingBalanceOn } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
