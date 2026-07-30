import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  accountInvitations,
  customerAccounts,
  tutors,
} from "@/db/schema";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
  requiredString,
} from "@/lib/server/http";
import {
  createOpaqueSession,
  createPasswordRecord,
  hashSessionToken,
  sessionCookie,
  validateNewPassword,
} from "@/lib/server/password-auth";

function readToken(value: string | null) {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new HttpError(
      400,
      "invalid_invitation",
      "Este convite é inválido.",
    );
  }
  return value;
}

async function findInvitation(token: string) {
  const tokenHash = await hashSessionToken(token);
  const [invitation] = await getDb()
    .select({
      id: accountInvitations.id,
      establishmentId: accountInvitations.establishmentId,
      email: accountInvitations.email,
      normalizedEmail: accountInvitations.normalizedEmail,
      role: accountInvitations.role,
      accountId: accountInvitations.accountId,
      customerName: customerAccounts.displayName,
      status: accountInvitations.status,
      expiresAt: accountInvitations.expiresAt,
      tokenHash: accountInvitations.tokenHash,
    })
    .from(accountInvitations)
    .leftJoin(
      customerAccounts,
      eq(customerAccounts.id, accountInvitations.accountId),
    )
    .where(eq(accountInvitations.tokenHash, tokenHash))
    .limit(1);
  if (!invitation) {
    throw new HttpError(
      404,
      "invitation_not_found",
      "Este convite não foi encontrado.",
    );
  }
  if (invitation.status !== "pending") {
    throw new HttpError(
      409,
      "invitation_unavailable",
      invitation.status === "accepted"
        ? "Este convite já foi utilizado."
        : "Este convite não está mais disponível.",
    );
  }
  if (invitation.expiresAt <= new Date().toISOString()) {
    await getD1Database()
      .prepare(
        `UPDATE account_invitations
        SET status = 'expired', updated_at = ?
        WHERE id = ? AND status = 'pending'`,
      )
      .bind(new Date().toISOString(), invitation.id)
      .run();
    throw new HttpError(
      410,
      "invitation_expired",
      "Este convite expirou. Peça ao administrador para reenviá-lo.",
    );
  }
  return invitation;
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const token = readToken(new URL(request.url).searchParams.get("token"));
    const invitation = await findInvitation(token);
    return json({
      invitation: {
        email: invitation.email,
        role: invitation.role,
        customerName: invitation.customerName,
        expiresAt: invitation.expiresAt,
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const body = await readJsonObject(request);
    const token = readToken(requiredString(body, "token", 100));
    const displayName = requiredString(body, "displayName", 120);
    const password = validateNewPassword(body.password);
    const invitation = await findInvitation(token);
    if (invitation.role === "customer" && !invitation.accountId) {
      throw new HttpError(
        409,
        "customer_link_missing",
        "O convite não está ligado a um cadastro de cliente.",
      );
    }

    const passwordRecord = await createPasswordRecord(password);
    const db = getDb();
    const [existingTutor] =
      invitation.role === "customer" && invitation.accountId
        ? await db
            .select({ id: tutors.id })
            .from(tutors)
            .where(
              and(
                eq(tutors.establishmentId, invitation.establishmentId),
                eq(tutors.accountId, invitation.accountId),
                eq(tutors.normalizedEmail, invitation.normalizedEmail),
              ),
            )
            .limit(1)
        : [undefined];
    const userId = crypto.randomUUID();
    const tutorId =
      invitation.role === "customer"
        ? existingTutor?.id ?? crypto.randomUUID()
        : null;
    const session = createOpaqueSession();
    const sessionId = crypto.randomUUID();
    const sessionTokenHash = await hashSessionToken(session.token);
    const now = new Date().toISOString();
    const d1 = getD1Database();
    const statements = [];
    if (
      invitation.role === "customer" &&
      invitation.accountId &&
      !existingTutor
    ) {
      statements.push(
        d1
          .prepare(
            `INSERT INTO tutors (
              id, establishment_id, account_id, full_name, normalized_name,
              email, normalized_email, whatsapp_enabled,
              is_financial_contact, status, created_at, updated_at
            )
            SELECT ?, establishment_id, account_id, ?, lower(?), email,
              normalized_email, 0, 0, 'active', ?, ?
            FROM account_invitations
            WHERE id = ? AND token_hash = ? AND status = 'pending'
              AND expires_at > ?`,
          )
          .bind(
            tutorId,
            displayName,
            displayName,
            now,
            now,
            invitation.id,
            invitation.tokenHash,
            now,
          ),
      );
    }
    const userResultIndex = statements.length;
    statements.push(
      d1
        .prepare(
          `INSERT INTO app_users (
            id, establishment_id, external_subject, email, normalized_email,
            display_name, role, tutor_id, status, created_at, updated_at
          )
          SELECT ?, establishment_id, ?, email, normalized_email, ?, role, ?,
            'active', ?, ?
          FROM account_invitations
          WHERE id = ? AND token_hash = ? AND status = 'pending'
            AND expires_at > ?
            AND NOT EXISTS (
              SELECT 1 FROM app_users
              WHERE establishment_id = account_invitations.establishment_id
                AND normalized_email = account_invitations.normalized_email
            )`,
        )
        .bind(
          userId,
          `password:${userId}`,
          displayName,
          tutorId,
          now,
          now,
          invitation.id,
          invitation.tokenHash,
          now,
        ),
      d1
        .prepare(
          `INSERT INTO admin_credentials (
            user_id, password_algorithm, password_hash, password_salt,
            password_iterations, password_changed_at, created_at, updated_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM app_users WHERE id = ?)`,
        )
        .bind(
          userId,
          passwordRecord.algorithm,
          passwordRecord.hash,
          passwordRecord.salt,
          passwordRecord.iterations,
          now,
          now,
          now,
          userId,
        ),
      d1
        .prepare(
          `UPDATE account_invitations
          SET status = 'accepted', accepted_at = ?, accepted_user_id = ?,
            updated_at = ?
          WHERE id = ? AND token_hash = ? AND status = 'pending'
            AND expires_at > ?
            AND EXISTS (
              SELECT 1 FROM admin_credentials WHERE user_id = ?
            )`,
        )
        .bind(
          now,
          userId,
          now,
          invitation.id,
          invitation.tokenHash,
          now,
          userId,
        ),
      d1
        .prepare(
          `INSERT INTO admin_sessions (
            id, user_id, establishment_id, token_hash, expires_at,
            last_seen_at, created_at
          )
          SELECT ?, ?, establishment_id, ?, ?, ?, ?
          FROM account_invitations
          WHERE id = ? AND status = 'accepted' AND accepted_user_id = ?`,
        )
        .bind(
          sessionId,
          userId,
          sessionTokenHash,
          session.expiresAt,
          now,
          now,
          invitation.id,
          userId,
        ),
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, result, metadata_json,
            occurred_at
          )
          SELECT ?, establishment_id, ?, role, 'account.invitation_accepted',
            'app_user', ?, ?, 'success', ?, ?
          FROM app_users WHERE id = ?`,
        )
        .bind(
          crypto.randomUUID(),
          userId,
          userId,
          requestId,
          JSON.stringify({
            invitationId: invitation.id,
            email: invitation.email,
            role: invitation.role,
          }),
          now,
          userId,
        ),
    );
    const results = await d1.batch(statements);
    if ((results[userResultIndex].meta.changes ?? 0) !== 1) {
      throw new HttpError(
        409,
        "invitation_conflict",
        "Este convite já foi utilizado ou a conta já existe.",
      );
    }

    const response = json(
      {
        authenticated: true,
        identity: {
          email: invitation.email,
          displayName,
          role: invitation.role,
        },
        sessionExpiresAt: session.expiresAt,
        destination: invitation.role === "customer" ? "/portal" : "/",
      },
      { status: 201 },
    );
    response.headers.append(
      "set-cookie",
      sessionCookie(session.token, session.expiresAt),
    );
    return response;
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
