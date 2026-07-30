import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import { appUsers } from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import { sendAccessEmail } from "@/lib/server/email";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
} from "@/lib/server/http";
import {
  createOneTimeToken,
  hashSessionToken,
} from "@/lib/server/password-auth";

const RESET_DURATION_SECONDS = 60 * 60;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner"]);
    const { id } = await context.params;
    const [target] = await getDb()
      .select({
        id: appUsers.id,
        email: appUsers.email,
        displayName: appUsers.displayName,
        role: appUsers.role,
      })
      .from(appUsers)
      .where(
        and(
          eq(appUsers.id, id),
          eq(appUsers.establishmentId, identity.establishmentId!),
          eq(appUsers.status, "active"),
        ),
      )
      .limit(1);
    if (!target) {
      throw new HttpError(
        404,
        "user_not_found",
        "A conta ativa não foi encontrada.",
      );
    }

    const resetId = crypto.randomUUID();
    const oneTime = createOneTimeToken(RESET_DURATION_SECONDS);
    const tokenHash = await hashSessionToken(oneTime.token);
    const now = new Date().toISOString();
    const d1 = getD1Database();
    await d1.batch([
      d1
        .prepare(
          `UPDATE password_reset_tokens
          SET status = 'revoked', updated_at = ?
          WHERE user_id = ? AND status = 'pending'`,
        )
        .bind(now, target.id),
      d1
        .prepare(
          `INSERT INTO password_reset_tokens (
            id, user_id, token_hash, status, expires_at, created_at, updated_at
          ) VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .bind(
          resetId,
          target.id,
          tokenHash,
          oneTime.expiresAt,
          now,
          now,
        ),
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, result, metadata_json,
            occurred_at
          ) VALUES (?, ?, ?, ?, 'auth.password_reset_requested_by_admin',
            'app_user', ?, ?, 'success', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          identity.establishmentId,
          identity.userId,
          identity.role,
          target.id,
          requestId,
          JSON.stringify({ targetRole: target.role }),
          now,
        ),
    ]);

    const actionUrl = new URL("/redefinir", request.url);
    actionUrl.searchParams.set("token", oneTime.token);
    const delivery = await sendAccessEmail({
      kind: "password_reset",
      to: target.email,
      name: target.displayName,
      actionUrl: actionUrl.toString(),
      expiresIn: "1 hora",
    });
    return json({
      passwordReset: {
        userId: target.id,
        deliveryStatus: delivery.status,
        deliveryError: delivery.status === "sent" ? null : delivery.error,
        expiresAt: oneTime.expiresAt,
        resetUrl: actionUrl.toString(),
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
