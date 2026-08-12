import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  auditEvents,
  cashEntries,
  cashTransfers,
  financialAccounts,
} from "@/db/schema";
import { assertCashDateIsOpen, isIsoDate, todayInSaoPaulo } from "@/lib/server/cash";
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

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const body = await readJsonObject(request);
    const fromFinancialAccountId = requiredString(body, "fromFinancialAccountId", 80);
    const toFinancialAccountId = requiredString(body, "toFinancialAccountId", 80);
    if (fromFinancialAccountId === toFinancialAccountId) {
      throw new HttpError(400, "transfer_accounts_equal", "Escolha duas contas diferentes.");
    }
    const occurredOn = requiredString(body, "occurredOn", 10);
    if (!isIsoDate(occurredOn) || occurredOn > todayInSaoPaulo()) {
      throw new HttpError(
        400,
        "invalid_transfer_date",
        "A transferência deve usar uma data válida que não esteja no futuro.",
      );
    }
    const amountCents = requiredInteger(body, "amountCents", {
      min: 1,
      max: 100_000_000_00,
    });
    const description = optionalString(body, "description", 160) ?? "Transferência entre contas";
    const note = optionalString(body, "note", 500);
    const idempotencyKey = requiredString(body, "idempotencyKey", 100);
    const establishmentId = identity.establishmentId!;
    await assertCashDateIsOpen(establishmentId, occurredOn);
    const db = getDb();
    const [existing] = await db
      .select({ id: cashTransfers.id })
      .from(cashTransfers)
      .where(
        and(
          eq(cashTransfers.establishmentId, establishmentId),
          eq(cashTransfers.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    if (existing) return json({ transfer: existing, idempotent: true });

    const accounts = await db
      .select({ id: financialAccounts.id, name: financialAccounts.name })
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.establishmentId, establishmentId),
          eq(financialAccounts.active, true),
          inArray(financialAccounts.id, [fromFinancialAccountId, toFinancialAccountId]),
        ),
      );
    if (accounts.length !== 2) {
      throw new HttpError(
        409,
        "transfer_account_unavailable",
        "As duas contas precisam estar ativas para registrar a transferência.",
      );
    }
    const fromAccount = accounts.find((account) => account.id === fromFinancialAccountId)!;
    const toAccount = accounts.find((account) => account.id === toFinancialAccountId)!;
    const transferId = crypto.randomUUID();
    const outflowId = crypto.randomUUID();
    const inflowId = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.batch([
      db.insert(cashTransfers).values({
        id: transferId,
        establishmentId,
        fromFinancialAccountId,
        toFinancialAccountId,
        occurredOn,
        amountCents,
        description,
        note,
        status: "included",
        idempotencyKey,
        createdByUserId: identity.userId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(cashEntries).values({
        id: outflowId,
        establishmentId,
        direction: "outflow",
        origin: "manual",
        transferId,
        idempotencyKey: `${idempotencyKey}:out`,
        financialAccountId: fromFinancialAccountId,
        occurredOn,
        amountCents,
        category: "Transferência interna",
        description: `${description} · para ${toAccount.name}`,
        note,
        status: "included",
        createdByUserId: identity.userId,
        updatedByUserId: identity.userId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(cashEntries).values({
        id: inflowId,
        establishmentId,
        direction: "inflow",
        origin: "manual",
        transferId,
        idempotencyKey: `${idempotencyKey}:in`,
        financialAccountId: toFinancialAccountId,
        occurredOn,
        amountCents,
        category: "Transferência interna",
        description: `${description} · de ${fromAccount.name}`,
        note,
        status: "included",
        createdByUserId: identity.userId,
        updatedByUserId: identity.userId,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "cash.transfer_created",
        entityType: "cash_transfer",
        entityId: transferId,
        requestId,
        result: "success",
        metadataJson: JSON.stringify({
          fromFinancialAccountId,
          fromAccountName: fromAccount.name,
          toFinancialAccountId,
          toAccountName: toAccount.name,
          occurredOn,
          amountCents,
        }),
      }),
    ]);
    return json(
      {
        transfer: {
          id: transferId,
          fromFinancialAccountId,
          toFinancialAccountId,
          occurredOn,
          amountCents,
          description,
          status: "included",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
