import { and, desc, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  accountInvitations,
  appUsers,
  customerAccounts,
} from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  emailDeliveryConfigured,
  sendAccessEmail,
} from "@/lib/server/email";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  optionalString,
  readJsonObject,
  requiredString,
} from "@/lib/server/http";
import {
  createOneTimeToken,
  hashSessionToken,
  validateAuthEmail,
} from "@/lib/server/password-auth";

const INVITATION_DURATION_SECONDS = 48 * 60 * 60;

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, ["owner"]);
    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [users, invitations] = await Promise.all([
      db
        .select({
          id: appUsers.id,
          email: appUsers.email,
          displayName: appUsers.displayName,
          role: appUsers.role,
          tutorId: appUsers.tutorId,
          status: appUsers.status,
          createdAt: appUsers.createdAt,
          updatedAt: appUsers.updatedAt,
        })
        .from(appUsers)
        .where(eq(appUsers.establishmentId, establishmentId))
        .orderBy(desc(appUsers.createdAt)),
      db
        .select({
          id: accountInvitations.id,
          email: accountInvitations.email,
          role: accountInvitations.role,
          accountId: accountInvitations.accountId,
          customerName: customerAccounts.displayName,
          status: accountInvitations.status,
          deliveryStatus: accountInvitations.deliveryStatus,
          deliveryError: accountInvitations.deliveryError,
          expiresAt: accountInvitations.expiresAt,
          sentAt: accountInvitations.sentAt,
          createdAt: accountInvitations.createdAt,
        })
        .from(accountInvitations)
        .leftJoin(
          customerAccounts,
          eq(customerAccounts.id, accountInvitations.accountId),
        )
        .where(eq(accountInvitations.establishmentId, establishmentId))
        .orderBy(desc(accountInvitations.createdAt))
        .limit(100),
    ]);
    const now = new Date().toISOString();
    return json({
      users,
      invitations: invitations.map((invitation) => ({
        ...invitation,
        status:
          invitation.status === "pending" && invitation.expiresAt <= now
            ? "expired"
            : invitation.status,
      })),
      emailConfigured: emailDeliveryConfigured(),
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner"]);
    const body = await readJsonObject(request);
    const email = validateAuthEmail(body.email);
    const role = requiredString(body, "role", 20);
    if (role !== "staff" && role !== "customer") {
      throw new HttpError(
        400,
        "invalid_role",
        "Escolha Funcionário ou Cliente.",
      );
    }
    const accountId = optionalString(body, "accountId", 80);
    if (role === "customer" && !accountId) {
      throw new HttpError(
        400,
        "customer_required",
        "Escolha o cadastro do cliente ligado a este acesso.",
      );
    }
    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [existingUser] = await db
      .select({ id: appUsers.id })
      .from(appUsers)
      .where(
        and(
          eq(appUsers.establishmentId, establishmentId),
          eq(appUsers.normalizedEmail, email),
        ),
      )
      .limit(1);
    if (existingUser) {
      throw new HttpError(
        409,
        "user_already_exists",
        "Já existe uma conta com este e-mail.",
      );
    }

    let customerName: string | null = null;
    if (role === "customer" && accountId) {
      const [customer] = await db
        .select({ displayName: customerAccounts.displayName })
        .from(customerAccounts)
        .where(
          and(
            eq(customerAccounts.id, accountId),
            eq(customerAccounts.establishmentId, establishmentId),
            eq(customerAccounts.status, "active"),
          ),
        )
        .limit(1);
      if (!customer) {
        throw new HttpError(
          404,
          "customer_not_found",
          "O cadastro do cliente não foi encontrado.",
        );
      }
      customerName = customer.displayName;
    }

    const invitationId = crypto.randomUUID();
    const oneTime = createOneTimeToken(INVITATION_DURATION_SECONDS);
    const tokenHash = await hashSessionToken(oneTime.token);
    const now = new Date().toISOString();
    const d1 = getD1Database();
    const results = await d1.batch([
      d1
        .prepare(
          `UPDATE account_invitations
          SET status = 'revoked', updated_at = ?
          WHERE establishment_id = ? AND normalized_email = ?
            AND status = 'pending'`,
        )
        .bind(now, establishmentId, email),
      d1
        .prepare(
          `INSERT INTO account_invitations (
            id, establishment_id, normalized_email, email, role, account_id,
            token_hash, status, delivery_status, expires_at,
            invited_by_user_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', ?, ?, ?, ?)`,
        )
        .bind(
          invitationId,
          establishmentId,
          email,
          email,
          role,
          role === "customer" ? accountId : null,
          tokenHash,
          oneTime.expiresAt,
          identity.userId,
          now,
          now,
        ),
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, result, metadata_json,
            occurred_at
          ) VALUES (?, ?, ?, ?, 'account.invited', 'account_invitation', ?,
            ?, 'success', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          establishmentId,
          identity.userId,
          identity.role,
          invitationId,
          requestId,
          JSON.stringify({ email, role, accountId }),
          now,
        ),
    ]);
    if ((results[1].meta.changes ?? 0) !== 1) {
      throw new HttpError(
        409,
        "invitation_conflict",
        "Não foi possível reservar este convite. Tente novamente.",
      );
    }

    const actionUrl = new URL("/convite", request.url);
    actionUrl.searchParams.set("token", oneTime.token);
    const delivery = await sendAccessEmail({
      kind: "invitation",
      to: email,
      name: customerName,
      actionUrl: actionUrl.toString(),
      expiresIn: "48 horas",
    });
    await d1
      .prepare(
        `UPDATE account_invitations
        SET delivery_status = ?, delivery_message_id = ?,
          delivery_error = ?, sent_at = ?, updated_at = ?
        WHERE id = ? AND establishment_id = ? AND status = 'pending'`,
      )
      .bind(
        delivery.status,
        delivery.status === "sent" ? delivery.messageId : null,
        delivery.status === "sent" ? null : delivery.error,
        delivery.status === "sent" ? new Date().toISOString() : null,
        new Date().toISOString(),
        invitationId,
        establishmentId,
      )
      .run();

    return json(
      {
        invitation: {
          id: invitationId,
          email,
          role,
          accountId: role === "customer" ? accountId : null,
          customerName,
          status: "pending",
          deliveryStatus: delivery.status,
          deliveryError: delivery.status === "sent" ? null : delivery.error,
          expiresAt: oneTime.expiresAt,
          inviteUrl: actionUrl.toString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
