import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import { auditEvents, cashEntries, financialAccounts } from "@/db/schema";
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

const directions = new Set(["inflow", "outflow"]);

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
    const expectedVersion = requiredInteger(body, "expectedVersion", { min: 1 });
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
    if (entry.transferId) {
      throw new HttpError(
        409,
        "cash_transfer_locked",
        "Altere esta movimentação pela transferência original para manter as duas contas consistentes.",
      );
    }
    await assertCashDateIsOpen(establishmentId, entry.occurredOn);

    if (action === "exclude") {
      if (entry.status === "excluded") {
        return json({ entry: { id, status: "excluded", version: entry.version }, idempotent: true });
      }
      const reason = requiredString(body, "reason", 240);
      const now = new Date().toISOString();
      const results = await getD1Database().batch([
        getD1Database().prepare(
          `UPDATE cash_entries SET status = 'excluded', exclusion_reason = ?,
            excluded_by_user_id = ?, excluded_at = ?, updated_by_user_id = ?,
            updated_at = ?, version = version + 1
           WHERE id = ? AND establishment_id = ? AND status = 'included' AND version = ?`,
        ).bind(reason, identity.userId, now, identity.userId, now, id, establishmentId, expectedVersion),
        getD1Database().prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action, entity_type,
            entity_id, request_id, reason, result, metadata_json, occurred_at
           ) SELECT ?, ?, ?, ?, 'cash.entry_excluded', 'cash_entry', ?, ?, ?, 'success', ?, ?
           WHERE EXISTS (
             SELECT 1 FROM cash_entries WHERE id = ? AND establishment_id = ?
               AND status = 'excluded' AND version = ? AND updated_at = ?
           )`,
        ).bind(
          crypto.randomUUID(), establishmentId, identity.userId, identity.role,
          id, requestId, reason,
          JSON.stringify({ origin: entry.origin, amountCents: entry.amountCents }),
          now, id, establishmentId, expectedVersion + 1, now,
        ),
      ]);
      if ((results[0].meta.changes ?? 0) !== 1 || (results[1].meta.changes ?? 0) !== 1) {
        throw new HttpError(409, "cash_entry_conflict", "O lançamento foi alterado. Atualize o Caixa e tente novamente.");
      }
      return json({ entry: { id, status: "excluded", version: expectedVersion + 1 } });
    }

    if (action === "restore") {
      if (entry.status === "included") {
        return json({ entry: { id, status: "included", version: entry.version }, idempotent: true });
      }
      const now = new Date().toISOString();
      const results = await getD1Database().batch([
        getD1Database().prepare(
          `UPDATE cash_entries SET status = 'included', exclusion_reason = NULL,
            excluded_by_user_id = NULL, excluded_at = NULL, updated_by_user_id = ?,
            updated_at = ?, version = version + 1
           WHERE id = ? AND establishment_id = ? AND status = 'excluded' AND version = ?`,
        ).bind(identity.userId, now, id, establishmentId, expectedVersion),
        getD1Database().prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action, entity_type,
            entity_id, request_id, result, metadata_json, occurred_at
           ) SELECT ?, ?, ?, ?, 'cash.entry_restored', 'cash_entry', ?, ?, 'success', ?, ?
           WHERE EXISTS (
             SELECT 1 FROM cash_entries WHERE id = ? AND establishment_id = ?
               AND status = 'included' AND version = ? AND updated_at = ?
           )`,
        ).bind(
          crypto.randomUUID(), establishmentId, identity.userId, identity.role,
          id, requestId,
          JSON.stringify({ origin: entry.origin, amountCents: entry.amountCents }),
          now, id, establishmentId, expectedVersion + 1, now,
        ),
      ]);
      if ((results[0].meta.changes ?? 0) !== 1 || (results[1].meta.changes ?? 0) !== 1) {
        throw new HttpError(409, "cash_entry_conflict", "O lançamento foi alterado. Atualize o Caixa e tente novamente.");
      }
      return json({ entry: { id, status: "included", version: expectedVersion + 1 } });
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
    if (!isIsoDate(occurredOn) || occurredOn > todayInSaoPaulo()) {
      throw new HttpError(
        400,
        "invalid_cash_date",
        "A data do lançamento deve ser válida e não pode estar no futuro.",
      );
    }
    if (occurredOn !== entry.occurredOn) {
      await assertCashDateIsOpen(establishmentId, occurredOn);
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

    const result = await db
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
          version: expectedVersion + 1,
        })
        .where(
          and(
            eq(cashEntries.id, id),
            eq(cashEntries.establishmentId, establishmentId),
            eq(cashEntries.version, expectedVersion),
          ),
        );
    if ((result.meta.changes ?? 0) !== 1) {
      throw new HttpError(409, "cash_entry_conflict", "O lançamento foi alterado. Atualize o Caixa e tente novamente.");
    }
    await db.insert(auditEvents).values({
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
      });

    return json({ entry: { id, status: entry.status, version: expectedVersion + 1 } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
