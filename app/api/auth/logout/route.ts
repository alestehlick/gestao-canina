import { getD1Database } from "@/db";
import {
  assertSameOrigin,
  errorResponse,
  json,
} from "@/lib/server/http";
import {
  expiredSessionCookie,
  hashSessionToken,
  readSessionToken,
} from "@/lib/server/password-auth";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const token = readSessionToken(request);
    if (token) {
      const tokenHash = await hashSessionToken(token);
      const now = new Date().toISOString();
      const d1 = getD1Database();
      await d1.batch([
        d1
          .prepare(
            `UPDATE admin_sessions
            SET revoked_at = ?
            WHERE token_hash = ? AND revoked_at IS NULL`,
          )
          .bind(now, tokenHash),
        d1
          .prepare(
            `INSERT INTO audit_events (
              id, establishment_id, actor_user_id, actor_role, action,
              entity_type, entity_id, request_id, result
            )
            SELECT ?, s.establishment_id, s.user_id, u.role,
              'auth.logout', 'admin_session', s.id, ?, 'success'
            FROM admin_sessions s
            INNER JOIN app_users u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.revoked_at = ?`,
          )
          .bind(crypto.randomUUID(), requestId, tokenHash, now),
      ]);
    }

    const response = json({ loggedOut: true });
    response.headers.append("set-cookie", expiredSessionCookie());
    return response;
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
