import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  adminCredentials,
  appUsers,
  passwordResetTokens,
} from "@/db/schema";
import { sendAccessEmail } from "@/lib/server/email";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
} from "@/lib/server/http";
import {
  createOneTimeToken,
  createPasswordRecord,
  hashSessionToken,
  validateAuthEmail,
  validateNewPassword,
} from "@/lib/server/password-auth";

const RESET_DURATION_SECONDS = 60 * 60;

function readResetToken(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new HttpError(
      400,
      "invalid_reset",
      "Este link de redefinição é inválido.",
    );
  }
  return value;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    let email: string | null = null;
    try {
      email = validateAuthEmail(body.email);
    } catch {
      // A resposta é sempre idêntica para não revelar contas existentes.
    }
    if (email) {
      const [user] = await getDb()
        .select({
          id: appUsers.id,
          establishmentId: appUsers.establishmentId,
          email: appUsers.email,
          displayName: appUsers.displayName,
          role: appUsers.role,
        })
        .from(appUsers)
        .innerJoin(
          adminCredentials,
          eq(adminCredentials.userId, appUsers.id),
        )
        .where(
          and(
            eq(appUsers.normalizedEmail, email),
            eq(appUsers.status, "active"),
          ),
        )
        .limit(1);
      if (user) {
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
            .bind(now, user.id),
          d1
            .prepare(
              `INSERT INTO password_reset_tokens (
                id, user_id, token_hash, status, expires_at, created_at,
                updated_at
              ) VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
            )
            .bind(
              resetId,
              user.id,
              tokenHash,
              oneTime.expiresAt,
              now,
              now,
            ),
          d1
            .prepare(
              `INSERT INTO audit_events (
                id, establishment_id, actor_user_id, actor_role, action,
                entity_type, entity_id, request_id, result, occurred_at
              ) VALUES (?, ?, ?, ?, 'auth.password_reset_requested',
                'app_user', ?, ?, 'success', ?)`,
            )
            .bind(
              crypto.randomUUID(),
              user.establishmentId,
              user.id,
              user.role,
              user.id,
              requestId,
              now,
            ),
        ]);
        const actionUrl = new URL("/redefinir", request.url);
        actionUrl.searchParams.set("token", oneTime.token);
        await sendAccessEmail({
          kind: "password_reset",
          to: user.email,
          name: user.displayName,
          actionUrl: actionUrl.toString(),
          expiresIn: "1 hora",
        });
      }
    }
    return json(
      {
        accepted: true,
        message:
          "Se existir uma conta ativa com este e-mail, enviaremos as instruções.",
      },
      { status: 202 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    const token = readResetToken(body.token);
    const password = validateNewPassword(body.password);
    const tokenHash = await hashSessionToken(token);
    const db = getDb();
    const [reset] = await db
      .select({
        id: passwordResetTokens.id,
        userId: appUsers.id,
        establishmentId: appUsers.establishmentId,
        role: appUsers.role,
        status: passwordResetTokens.status,
        expiresAt: passwordResetTokens.expiresAt,
      })
      .from(passwordResetTokens)
      .innerJoin(appUsers, eq(appUsers.id, passwordResetTokens.userId))
      .where(eq(passwordResetTokens.tokenHash, tokenHash))
      .limit(1);
    if (!reset || reset.status !== "pending") {
      throw new HttpError(
        409,
        "reset_unavailable",
        "Este link não está mais disponível.",
      );
    }
    const now = new Date().toISOString();
    if (reset.expiresAt <= now) {
      await getD1Database()
        .prepare(
          `UPDATE password_reset_tokens
          SET status = 'expired', updated_at = ?
          WHERE id = ? AND status = 'pending'`,
        )
        .bind(now, reset.id)
        .run();
      throw new HttpError(
        410,
        "reset_expired",
        "Este link expirou. Solicite uma nova redefinição.",
      );
    }
    const passwordRecord = await createPasswordRecord(password);
    const d1 = getD1Database();
    const results = await d1.batch([
      d1
        .prepare(
          `UPDATE admin_credentials
          SET password_algorithm = ?, password_hash = ?, password_salt = ?,
            password_iterations = ?, password_changed_at = ?,
            failed_login_attempts = 0, locked_until = NULL,
            last_failed_at = NULL, updated_at = ?
          WHERE user_id = ?
            AND EXISTS (
              SELECT 1 FROM password_reset_tokens
              WHERE id = ? AND status = 'pending' AND expires_at > ?
            )`,
        )
        .bind(
          passwordRecord.algorithm,
          passwordRecord.hash,
          passwordRecord.salt,
          passwordRecord.iterations,
          now,
          now,
          reset.userId,
          reset.id,
          now,
        ),
      d1
        .prepare(
          `UPDATE password_reset_tokens
          SET status = 'used', used_at = ?, updated_at = ?
          WHERE id = ? AND status = 'pending'
            AND EXISTS (
              SELECT 1 FROM admin_credentials
              WHERE user_id = ?
            )`,
        )
        .bind(now, now, reset.id, reset.userId),
      d1
        .prepare(
          `UPDATE admin_sessions
          SET revoked_at = ?
          WHERE user_id = ? AND revoked_at IS NULL`,
        )
        .bind(now, reset.userId),
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, result, occurred_at
          )
          SELECT ?, ?, ?, ?, 'auth.password_reset_completed', 'app_user', ?,
            ?, 'success', ?
          WHERE EXISTS (
            SELECT 1 FROM password_reset_tokens
            WHERE id = ? AND status = 'used'
          )`,
        )
        .bind(
          crypto.randomUUID(),
          reset.establishmentId,
          reset.userId,
          reset.role,
          reset.userId,
          requestId,
          now,
          reset.id,
        ),
    ]);
    if (
      (results[0].meta.changes ?? 0) !== 1 ||
      (results[1].meta.changes ?? 0) !== 1
    ) {
      throw new HttpError(
        409,
        "reset_conflict",
        "Este link já foi utilizado.",
      );
    }
    return json({ passwordReset: true });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
