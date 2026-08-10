import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, cashEntries, financialAccounts } from "@/db/schema";
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const { id } = await context.params;
    const body = await readJsonObject(request);
    const action = requiredString(body, "action", 20);
    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [entry] = await db
      .select()
      .from(cashEntries)
      .where(
        and(
          eq(cashEntries.id, id),
          eq(cashEntries.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (!entry) {
      throw new HttpError(
        404,
        "cash_entry_not_found",
        "O lançamento não foi encontrado.",
      );
    }

    if (action === "exclude") {
      if (entry.status === "excluded") {
        return json({ entry: { id, status: "excluded" }, idempotent: true });
      }
      const reason = requiredString(body, "reason", 240);
      await db.batch([
        db
          .update(cashEntries)
          .set({
            status: "excluded",
            exclusionReason: reason,
            excludedByUserId: identity.userId,
            excludedAt: new Date().toISOString(),
            updatedByUserId: identity.userId,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(cashEntries.id, id),
              eq(cashEntries.establishmentId, establishmentId),
            ),
          ),
        db.insert(auditEvents).values({
          id: crypto.randomUUID(),
          establishmentId,
          actorUserId: identity.userId,
          actorRole: identity.role,
          action: "cash.entry_excluded",
          entityType: "cash_entry",
          entityId: id,
          requestId,
          reason,
          result: "success",
          metadataJson: JSON.stringify({
            origin: entry.origin,
            amountCents: entry.amountCents,
          }),
        }),
      ]);
      return json({ entry: { id, status: "excluded" } });
    }

    if (action === "restore") {
      if (entry.status === "included") {
        return json({ entry: { id, status: "included" }, idempotent: true });
      }
      await db.batch([
        db
          .update(cashEntries)
          .set({
            status: "included",
            exclusionReason: null,
            excludedByUserId: null,
            excludedAt: null,
            updatedByUserId: identity.userId,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(cashEntries.id, id),
              eq(cashEntries.establishmentId, establishmentId),
            ),
          ),
        db.insert(auditEvents).values({
          id: crypto.randomUUID(),
          establishmentId,
          actorUserId: identity.userId,
          actorRole: identity.role,
          action: "cash.entry_restored",
          entityType: "cash_entry",
          entityId: id,
          requestId,
          result: "success",
          metadataJson: JSON.stringify({
            origin: entry.origin,
            amountCents: entry.amountCents,
          }),
        }),
      ]);
      return json({ entry: { id, status: "included" } });
    }

    if (action !== "update") {
      throw new HttpError(
        400,
        "invalid_cash_action",
        "A ação solicitada é inválida.",
      );
    }
    if (entry.origin !== "manual") {
      throw new HttpError(
        409,
        "automatic_cash_entry_locked",
        "Corrija o recebimento na cobrança original.",
      );
    }

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
    const requestedFinancialAccountId = optionalString(body, "financialAccountId", 80);
    const financialAccountId = requestedFinancialAccountId ?? entry.financialAccountId;
    if (!financialAccountId) {
      throw new HttpError(400, "financial_account_required", "Escolha a conta de entrada ou saída.");
    }
    const [financialAccount] = await db
      .select({ id: financialAccounts.id, name: financialAccounts.name })
      .from(financialAccounts)
      .where(and(
        eq(financialAccounts.id, financialAccountId),
        eq(financialAccounts.establishmentId, establishmentId),
        eq(financialAccounts.active, true),
      ))
      .limit(1);
    if (!financialAccount) {
      throw new HttpError(404, "financial_account_not_found", "A conta selecionada não está ativa.");
    }
    const now = new Date().toISOString();

    await db.batch([
      db
        .update(cashEntries)
        .set({
          direction: direction as "inflow" | "outflow",
          occurredOn,
          amountCents,
          category,
          description,
          note,
          financialAccountId,
          updatedByUserId: identity.userId,
          updatedAt: now,
        })
        .where(
          and(
            eq(cashEntries.id, id),
            eq(cashEntries.establishmentId, establishmentId),
          ),
        ),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "cash.entry_updated",
        entityType: "cash_entry",
        entityId: id,
        requestId,
        result: "success",
        metadataJson: JSON.stringify({
          before: {
            direction: entry.direction,
            occurredOn: entry.occurredOn,
            amountCents: entry.amountCents,
            category: entry.category,
          },
          after: { direction, occurredOn, amountCents, category, financialAccountId, financialAccountName: financialAccount.name },
        }),
      }),
    ]);

    return json({ entry: { id, status: entry.status } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
