import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  auditEvents,
  cashReconciliations,
  financialAccounts,
} from "@/db/schema";
import { calculatedAccountBalance, isIsoDate, todayInSaoPaulo } from "@/lib/server/cash";
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

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const accountId = new URL(request.url).searchParams.get("accountId");
    if (!accountId) {
      throw new HttpError(400, "financial_account_required", "Escolha uma conta financeira.");
    }
    const rows = await getDb()
      .select()
      .from(cashReconciliations)
      .where(
        and(
          eq(cashReconciliations.establishmentId, identity.establishmentId!),
          eq(cashReconciliations.financialAccountId, accountId),
        ),
      )
      .orderBy(desc(cashReconciliations.reconciledOn), desc(cashReconciliations.createdAt))
      .limit(12);
    return json({ reconciliations: rows });
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
    const financialAccountId = requiredString(body, "financialAccountId", 80);
    const reconciledOn = requiredString(body, "reconciledOn", 10);
    if (!isIsoDate(reconciledOn) || reconciledOn > todayInSaoPaulo()) {
      throw new HttpError(
        400,
        "invalid_reconciliation_date",
        "A conciliação deve usar uma data válida que não esteja no futuro.",
      );
    }
    const statementBalanceCents = requiredInteger(body, "statementBalanceCents", {
      min: -100_000_000_00,
      max: 100_000_000_00,
    });
    const note = optionalString(body, "note", 500);
    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [account] = await db
      .select({ id: financialAccounts.id, name: financialAccounts.name })
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.id, financialAccountId),
          eq(financialAccounts.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (!account) {
      throw new HttpError(404, "financial_account_not_found", "A conta financeira não foi encontrada.");
    }
    const systemBalanceCents = await calculatedAccountBalance(
      establishmentId,
      financialAccountId,
      reconciledOn,
    );
    if (systemBalanceCents === null) {
      throw new HttpError(
        409,
        "opening_balance_required",
        "Defina o saldo inicial desta conta antes de conciliá-la.",
      );
    }
    const differenceCents = statementBalanceCents - systemBalanceCents;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.batch([
      db.insert(cashReconciliations).values({
        id,
        establishmentId,
        financialAccountId,
        reconciledOn,
        statementBalanceCents,
        systemBalanceCents,
        differenceCents,
        note,
        createdByUserId: identity.userId,
        createdAt: now,
      }),
      db
        .update(financialAccounts)
        .set({
          reconciledBalanceCents: statementBalanceCents,
          reconciledOn,
          reconciledAt: now,
          reconciledByUserId: identity.userId,
          updatedAt: now,
        })
        .where(
          and(
            eq(financialAccounts.id, financialAccountId),
            eq(financialAccounts.establishmentId, establishmentId),
          ),
        ),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "cash.account_reconciled",
        entityType: "financial_account",
        entityId: financialAccountId,
        requestId,
        result: "success",
        metadataJson: JSON.stringify({
          accountName: account.name,
          reconciledOn,
          statementBalanceCents,
          systemBalanceCents,
          differenceCents,
        }),
      }),
    ]);
    return json(
      {
        reconciliation: {
          id,
          financialAccountId,
          reconciledOn,
          statementBalanceCents,
          systemBalanceCents,
          differenceCents,
          note,
          createdAt: now,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
