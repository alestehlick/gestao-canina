import { getD1Database } from "@/db";
import { HttpError } from "./http";
import { hashLoginRateLimitKey } from "./password-auth";

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
const MAX_ATTEMPTS_PER_IP = 30;
const MAX_ATTEMPTS_PER_IP_AND_EMAIL = 6;

type RateLimitCounterRow = {
  attempt_count: number;
  expires_at: string;
};

export type LoginRateLimitResult = {
  allowed: boolean;
  limitedScopes: Array<"ip" | "ip_email">;
  windowExpiresAt: string;
};

function clientIdentifier(request: Request) {
  const value = request.headers.get("cf-connecting-ip")?.trim().toLowerCase();
  if (!value || value.length > 64 || !/^[0-9a-f:.]+$/.test(value)) {
    return "unavailable";
  }
  return value;
}

function rateLimitStatement(
  keyHash: string,
  scope: "ip" | "ip_email",
  nowIso: string,
  expiresAt: string,
) {
  return getD1Database()
    .prepare(
      `INSERT INTO auth_login_rate_limits (
        key_hash, scope, window_started_at, attempt_count, expires_at,
        updated_at
      ) VALUES (?, ?, ?, 1, ?, ?)
      ON CONFLICT(key_hash) DO UPDATE SET
        scope = excluded.scope,
        window_started_at =
          CASE
            WHEN auth_login_rate_limits.expires_at <= ?
              THEN excluded.window_started_at
            ELSE auth_login_rate_limits.window_started_at
          END,
        attempt_count =
          CASE
            WHEN auth_login_rate_limits.expires_at <= ? THEN 1
            ELSE auth_login_rate_limits.attempt_count + 1
          END,
        expires_at =
          CASE
            WHEN auth_login_rate_limits.expires_at <= ?
              THEN excluded.expires_at
            ELSE auth_login_rate_limits.expires_at
          END,
        updated_at = excluded.updated_at
      RETURNING attempt_count, expires_at`,
    )
    .bind(
      keyHash,
      scope,
      nowIso,
      expiresAt,
      nowIso,
      nowIso,
      nowIso,
      nowIso,
    );
}

export async function reserveLoginAttempt(
  request: Request,
  normalizedEmail: string | null,
): Promise<LoginRateLimitResult> {
  const now = new Date();
  const nowIso = now.toISOString();
  const newWindowExpiresAt = new Date(
    now.valueOf() + RATE_LIMIT_WINDOW_MS,
  ).toISOString();
  const ip = clientIdentifier(request);
  const email = normalizedEmail ?? "<invalid>";
  const [ipKeyHash, ipAndEmailKeyHash] = await Promise.all([
    hashLoginRateLimitKey("ip", [ip]),
    hashLoginRateLimitKey("ip_email", [ip, email]),
  ]);
  const d1 = getD1Database();
  const results = await d1.batch<RateLimitCounterRow>([
    rateLimitStatement(ipKeyHash, "ip", nowIso, newWindowExpiresAt),
    rateLimitStatement(
      ipAndEmailKeyHash,
      "ip_email",
      nowIso,
      newWindowExpiresAt,
    ),
    d1
      .prepare(
        `DELETE FROM auth_login_rate_limits
        WHERE expires_at <= ?`,
      )
      .bind(nowIso),
  ]);
  const ipCounter = results[0]?.results[0];
  const ipAndEmailCounter = results[1]?.results[0];
  if (!ipCounter || !ipAndEmailCounter) {
    throw new HttpError(
      503,
      "auth_rate_limit_unavailable",
      "Não foi possível validar o acesso agora.",
    );
  }

  const limitedScopes: Array<"ip" | "ip_email"> = [];
  if (ipCounter.attempt_count > MAX_ATTEMPTS_PER_IP) {
    limitedScopes.push("ip");
  }
  if (
    ipAndEmailCounter.attempt_count > MAX_ATTEMPTS_PER_IP_AND_EMAIL
  ) {
    limitedScopes.push("ip_email");
  }
  return {
    allowed: limitedScopes.length === 0,
    limitedScopes,
    windowExpiresAt:
      ipCounter.expires_at > ipAndEmailCounter.expires_at
        ? ipCounter.expires_at
        : ipAndEmailCounter.expires_at,
  };
}
