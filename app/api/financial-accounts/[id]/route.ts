import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import { financialAccounts } from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  optionalInteger,
  optionalString,
  readJsonObject,
  requiredString,
} from "@/lib/server/http";
import { isIsoDate, todayInSaoPaulo } from "@/lib/server/cash";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner"]);
    const { id } = await context.params;
    const body = await readJsonObject(request);
    const action = requiredString(body, "action", 20);
    if (action !== "activate" && action !== "archive" && action !== "configure") {
      throw new HttpError(400, "invalid_action", "Escolha uma ação válida.");
    }
    const establishmentId = identity.establishmentId!;
    const [account] = await getDb().select().from(financialAccounts).where(and(
      eq(financialAccounts.id, id),
      eq(financialAccounts.establishmentId, establishmentId),
    )).limit(1);
    if (!account) throw new HttpError(404, "financial_account_not_found", "A conta não foi encontrada.");
    if (action === "configure") {
      const openingBalanceCents = optionalInteger(body, "openingBalanceCents", {
        min: -100_000_000_00,
        max: 100_000_000_00,
      });
      const openingBalanceOn = optionalString(body, "openingBalanceOn", 10);
      if (
        openingBalanceCents === null ||
        !openingBalanceOn ||
        !isIsoDate(openingBalanceOn) ||
        openingBalanceOn > todayInSaoPaulo()
      ) {
        throw new HttpError(
          400,
          "invalid_opening_balance",
          "Informe o saldo inicial e a data de referência.",
        );
      }
      const now = new Date().toISOString();
      const d1 = getD1Database();
      await d1.batch([
        d1
          .prepare(
            `UPDATE financial_accounts
             SET opening_balance_cents = ?, opening_balance_on = ?, updated_at = ?
             WHERE id = ? AND establishment_id = ?`,
          )
          .bind(openingBalanceCents, openingBalanceOn, now, id, establishmentId),
        d1
          .prepare(
            `INSERT INTO audit_events (
              id, establishment_id, actor_user_id, actor_role, action, entity_type,
              entity_id, request_id, result, metadata_json, occurred_at
            ) VALUES (?, ?, ?, ?, 'financial_account.configured', 'financial_account', ?, ?, 'success', ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            establishmentId,
            identity.userId,
            identity.role,
            id,
            requestId,
            JSON.stringify({
              name: account.name,
              previousOpeningBalanceCents: account.openingBalanceCents,
              previousOpeningBalanceOn: account.openingBalanceOn,
              openingBalanceCents,
              openingBalanceOn,
            }),
            now,
          ),
      ]);
      return json({
        account: { ...account, openingBalanceCents, openingBalanceOn },
      });
    }
    const active = action === "activate";
    if (!active) {
      const remaining = await getD1Database().prepare(
        "SELECT COUNT(*) AS total FROM financial_accounts WHERE establishment_id = ? AND active = 1 AND id <> ?",
      ).bind(establishmentId, id).first<{ total: number }>();
      if (Number(remaining?.total ?? 0) < 1) {
        throw new HttpError(409, "last_financial_account", "Mantenha ao menos uma conta de recebimento ativa.");
      }
      const scheduled = await getD1Database()
        .prepare(
          `SELECT COUNT(*) AS total FROM invoice_settlements
           WHERE establishment_id = ? AND financial_account_id = ? AND status = 'scheduled'`,
        )
        .bind(establishmentId, id)
        .first<{ total: number }>();
      if (Number(scheduled?.total ?? 0) > 0) {
        throw new HttpError(
          409,
          "financial_account_has_settlements",
          "Esta conta possui valores em compensação. Confirme ou transfira esses recebimentos antes de inativá-la.",
        );
      }
    }
    const now = new Date().toISOString();
    const d1 = getD1Database();
    await d1.batch([
      d1.prepare("UPDATE financial_accounts SET active = ?, updated_at = ? WHERE id = ? AND establishment_id = ?")
        .bind(active ? 1 : 0, now, id, establishmentId),
      d1.prepare(`INSERT INTO audit_events (
        id, establishment_id, actor_user_id, actor_role, action, entity_type,
        entity_id, request_id, result, metadata_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, 'financial_account', ?, ?, 'success', ?, ?)`).bind(
        crypto.randomUUID(), establishmentId, identity.userId, identity.role,
        active ? "financial_account.activated" : "financial_account.archived",
        id, requestId, JSON.stringify({ name: account.name }), now,
      ),
    ]);
    return json({ account: { ...account, active } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
