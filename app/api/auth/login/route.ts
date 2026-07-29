import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  adminCredentials,
  appUsers,
} from "@/db/schema";
import { getAdminConfigurationState } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
} from "@/lib/server/http";
import { reserveLoginAttempt } from "@/lib/server/login-rate-limit";
import {
  createOpaqueSession,
  hashSessionToken,
  performDummyPasswordCheck,
  readLoginPassword,
  sessionCookie,
  validateAuthEmail,
  verifyPassword,
} from "@/lib/server/password-auth";

function invalidCredentials(): never {
  throw new HttpError(
    401,
    "invalid_credentials",
    "E-mail ou senha inválidos.",
  );
}

async function recordLoginDenial(input: {
  userId: string;
  establishmentId: string;
  role: string;
  requestId: string;
  action: "auth.login_failed" | "auth.login_rate_limited";
  metadata?: Record<string, unknown>;
}) {
  const d1 = getD1Database();
  await d1
    .prepare(
      `INSERT INTO audit_events (
        id, establishment_id, actor_user_id, actor_role, action,
        entity_type, entity_id, request_id, result, metadata_json
      ) VALUES (?, ?, ?, ?, ?, 'app_user', ?, ?, 'denied', ?)`,
    )
    .bind(
      crypto.randomUUID(),
      input.establishmentId,
      input.userId,
      input.role,
      input.action,
      input.userId,
      input.requestId,
      input.metadata ? JSON.stringify(input.metadata) : null,
    )
    .run();
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const configuration = await getAdminConfigurationState();
    if (!configuration.valid) {
      throw new HttpError(
        503,
        "auth_configuration_incomplete",
        "A configuração de acesso está incompleta.",
      );
    }
    const body = await readJsonObject(request);
    const password = readLoginPassword(body.password);
    let email: string | null = null;
    try {
      email = validateAuthEmail(body.email);
    } catch {
      // A resposta de login é deliberadamente genérica.
    }

    const db = getDb();
    const candidates = email
      ? await db
          .select({
            userId: appUsers.id,
            establishmentId: appUsers.establishmentId,
            email: appUsers.normalizedEmail,
            displayName: appUsers.displayName,
            role: appUsers.role,
            passwordAlgorithm: adminCredentials.passwordAlgorithm,
            passwordHash: adminCredentials.passwordHash,
            passwordSalt: adminCredentials.passwordSalt,
            passwordIterations: adminCredentials.passwordIterations,
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
          .limit(2)
      : [];
    const rateLimit = await reserveLoginAttempt(request, email);
    if (!rateLimit.allowed) {
      if (candidates.length === 1) {
        const candidate = candidates[0];
        await recordLoginDenial({
          userId: candidate.userId,
          establishmentId: candidate.establishmentId,
          role: candidate.role,
          requestId,
          action: "auth.login_rate_limited",
          metadata: {
            limitedScopes: rateLimit.limitedScopes,
            windowExpiresAt: rateLimit.windowExpiresAt,
          },
        });
      }
      invalidCredentials();
    }
    if (!email || candidates.length !== 1) {
      await performDummyPasswordCheck(password);
      invalidCredentials();
    }
    const candidate = candidates[0];
    if (candidate.passwordAlgorithm !== "pbkdf2-sha256") {
      throw new HttpError(
        503,
        "unsupported_password_record",
        "A credencial armazenada precisa ser atualizada.",
      );
    }

    const passwordMatches = await verifyPassword(
      password,
      candidate.passwordHash,
      candidate.passwordSalt,
      candidate.passwordIterations,
    );
    if (!passwordMatches) {
      await recordLoginDenial({
        userId: candidate.userId,
        establishmentId: candidate.establishmentId,
        role: candidate.role,
        requestId,
        action: "auth.login_failed",
      });
      invalidCredentials();
    }

    const nowIso = new Date().toISOString();
    const session = createOpaqueSession();
    const sessionId = crypto.randomUUID();
    const tokenHash = await hashSessionToken(session.token);
    const d1 = getD1Database();
    const results = await d1.batch([
      d1
        .prepare(
          `UPDATE admin_credentials
          SET failed_login_attempts = 0, locked_until = NULL,
            last_failed_at = NULL, last_login_at = ?, updated_at = ?
          WHERE user_id = ?`,
        )
        .bind(nowIso, nowIso, candidate.userId),
      d1
        .prepare(
          `INSERT INTO admin_sessions (
            id, user_id, establishment_id, token_hash, expires_at
          )
          SELECT ?, au.id, au.establishment_id, ?, ?
          FROM app_users au
          INNER JOIN admin_credentials ac ON ac.user_id = au.id
          WHERE au.id = ?
            AND au.status = 'active'`,
        )
        .bind(
          sessionId,
          tokenHash,
          session.expiresAt,
          candidate.userId,
        ),
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, result
          )
          SELECT ?, ?, ?, ?, 'auth.login_succeeded', 'admin_session', ?,
            ?, 'success'
          WHERE EXISTS (
            SELECT 1 FROM admin_sessions WHERE id = ?
          )`,
        )
        .bind(
          crypto.randomUUID(),
          candidate.establishmentId,
          candidate.userId,
          candidate.role,
          sessionId,
          requestId,
          sessionId,
        ),
    ]);
    if ((results[1].meta.changes ?? 0) !== 1) {
      invalidCredentials();
    }

    const response = json({
      setupRequired: false,
      authenticated: true,
      identity: {
        email: candidate.email,
        displayName: candidate.displayName,
        role: candidate.role,
      },
      sessionExpiresAt: session.expiresAt,
    });
    response.headers.append(
      "set-cookie",
      sessionCookie(session.token, session.expiresAt),
    );
    return response;
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
