import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import { appUsers } from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
  requiredString,
} from "@/lib/server/http";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner"]);
    const { id } = await context.params;
    const status = requiredString(await readJsonObject(request), "status", 20);
    if (status !== "active" && status !== "disabled") {
      throw new HttpError(400, "invalid_status", "A situação é inválida.");
    }
    if (id === identity.userId) {
      throw new HttpError(
        409,
        "cannot_change_own_access",
        "Você não pode suspender a própria conta.",
      );
    }
    const establishmentId = identity.establishmentId!;
    const [target] = await getDb()
      .select({
        id: appUsers.id,
        email: appUsers.email,
        role: appUsers.role,
        currentStatus: appUsers.status,
      })
      .from(appUsers)
      .where(
        and(
          eq(appUsers.id, id),
          eq(appUsers.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (!target) {
      throw new HttpError(404, "user_not_found", "A conta não foi encontrada.");
    }
    if (target.role === "owner") {
      throw new HttpError(
        409,
        "owner_access_protected",
        "As duas contas administradoras são protegidas nesta versão.",
      );
    }
    if (target.currentStatus === status) {
      return json({ user: { ...target, status }, idempotent: true });
    }

    const now = new Date().toISOString();
    const d1 = getD1Database();
    const results = await d1.batch([
      d1
        .prepare(
          `UPDATE app_users SET status = ?, updated_at = ?
          WHERE id = ? AND establishment_id = ? AND role <> 'owner'`,
        )
        .bind(status, now, id, establishmentId),
      d1
        .prepare(
          `UPDATE admin_sessions
          SET revoked_at = CASE WHEN ? = 'disabled' THEN ? ELSE revoked_at END
          WHERE user_id = ? AND revoked_at IS NULL`,
        )
        .bind(status, now, id),
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, result, metadata_json,
            occurred_at
          ) VALUES (?, ?, ?, ?, ?, 'app_user', ?, ?, 'success', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          establishmentId,
          identity.userId,
          identity.role,
          status === "disabled" ? "account.disabled" : "account.reactivated",
          id,
          requestId,
          JSON.stringify({
            email: target.email,
            role: target.role,
            previousStatus: target.currentStatus,
            status,
          }),
          now,
        ),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) {
      throw new HttpError(
        409,
        "user_status_conflict",
        "A conta foi alterada. Atualize a página e tente novamente.",
      );
    }
    return json({
      user: { id, email: target.email, role: target.role, status },
      idempotent: false,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
