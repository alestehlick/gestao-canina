import { and, eq } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  accountInvitations,
  customerAccounts,
} from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import { sendAccessEmail } from "@/lib/server/email";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
  requiredString,
} from "@/lib/server/http";
import {
  createOneTimeToken,
  hashSessionToken,
} from "@/lib/server/password-auth";

const INVITATION_DURATION_SECONDS = 48 * 60 * 60;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner"]);
    const { id } = await context.params;
    const action = requiredString(await readJsonObject(request), "action", 20);
    if (action !== "revoke" && action !== "resend") {
      throw new HttpError(400, "invalid_action", "A ação é inválida.");
    }
    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [invitation] = await db
      .select({
        id: accountInvitations.id,
        email: accountInvitations.email,
        role: accountInvitations.role,
        accountId: accountInvitations.accountId,
        status: accountInvitations.status,
        customerName: customerAccounts.displayName,
      })
      .from(accountInvitations)
      .leftJoin(
        customerAccounts,
        eq(customerAccounts.id, accountInvitations.accountId),
      )
      .where(
        and(
          eq(accountInvitations.id, id),
          eq(accountInvitations.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (!invitation) {
      throw new HttpError(
        404,
        "invitation_not_found",
        "O convite não foi encontrado.",
      );
    }
    if (invitation.status === "accepted") {
      throw new HttpError(
        409,
        "invitation_already_accepted",
        "Este convite já foi utilizado.",
      );
    }

    const d1 = getD1Database();
    const now = new Date().toISOString();
    if (action === "revoke") {
      const result = await d1.batch([
        d1
          .prepare(
            `UPDATE account_invitations
            SET status = 'revoked', updated_at = ?
            WHERE id = ? AND establishment_id = ?
              AND status IN ('pending', 'expired')`,
          )
          .bind(now, id, establishmentId),
        d1
          .prepare(
            `INSERT INTO audit_events (
              id, establishment_id, actor_user_id, actor_role, action,
              entity_type, entity_id, request_id, result, metadata_json,
              occurred_at
            ) VALUES (?, ?, ?, ?, 'account.invitation_revoked',
              'account_invitation', ?, ?, 'success', ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            establishmentId,
            identity.userId,
            identity.role,
            id,
            requestId,
            JSON.stringify({ email: invitation.email, role: invitation.role }),
            now,
          ),
      ]);
      if ((result[0].meta.changes ?? 0) !== 1) {
        throw new HttpError(
          409,
          "invitation_conflict",
          "Este convite já foi alterado.",
        );
      }
      return json({ invitation: { id, status: "revoked" } });
    }

    const oneTime = createOneTimeToken(INVITATION_DURATION_SECONDS);
    const tokenHash = await hashSessionToken(oneTime.token);
    const update = await d1
      .prepare(
        `UPDATE account_invitations
        SET token_hash = ?, status = 'pending', delivery_status = 'pending',
          delivery_message_id = NULL, delivery_error = NULL, expires_at = ?,
          sent_at = NULL, updated_at = ?
        WHERE id = ? AND establishment_id = ?
          AND status IN ('pending', 'expired', 'revoked')`,
      )
      .bind(tokenHash, oneTime.expiresAt, now, id, establishmentId)
      .run();
    if ((update.meta.changes ?? 0) !== 1) {
      throw new HttpError(
        409,
        "invitation_conflict",
        "Este convite já foi alterado.",
      );
    }
    const actionUrl = new URL("/convite", request.url);
    actionUrl.searchParams.set("token", oneTime.token);
    const delivery = await sendAccessEmail({
      kind: "invitation",
      to: invitation.email,
      name: invitation.customerName,
      actionUrl: actionUrl.toString(),
      expiresIn: "48 horas",
    });
    await d1.batch([
      d1
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
          id,
          establishmentId,
        ),
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, result, metadata_json,
            occurred_at
          ) VALUES (?, ?, ?, ?, 'account.invitation_resent',
            'account_invitation', ?, ?, 'success', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          establishmentId,
          identity.userId,
          identity.role,
          id,
          requestId,
          JSON.stringify({
            email: invitation.email,
            role: invitation.role,
            deliveryStatus: delivery.status,
          }),
          new Date().toISOString(),
        ),
    ]);
    return json({
      invitation: {
        id,
        status: "pending",
        deliveryStatus: delivery.status,
        deliveryError: delivery.status === "sent" ? null : delivery.error,
        expiresAt: oneTime.expiresAt,
        inviteUrl: actionUrl.toString(),
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
