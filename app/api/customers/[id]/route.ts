import { and, eq, or, sql } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  auditEvents,
  customerAccounts,
  customerRequests,
  dogs,
  recurringSchedules,
  tutors,
} from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  optionalString,
  readJsonObject,
} from "@/lib/server/http";

function normalizeLookupText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeEmail(value: string | null) {
  if (!value) return null;
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new HttpError(400, "invalid_email", "Informe um e-mail válido.");
  }
  return email;
}

function normalizeBrazilianPhone(value: string | null) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if (
    (digits.length === 12 || digits.length === 13) &&
    digits.startsWith("55")
  ) {
    return `+${digits}`;
  }
  if (value.trim().startsWith("+") && digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  throw new HttpError(
    400,
    "invalid_phone",
    "Informe um telefone com DDD.",
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "staff"]);
    const { id } = await context.params;
    if (!id || id.length > 80) {
      throw new HttpError(
        400,
        "invalid_customer_id",
        "O cliente informado é inválido.",
      );
    }
    const body = await readJsonObject(request);
    const displayName = optionalString(body, "displayName", 160);
    const fullName = optionalString(body, "fullName", 160);
    const email =
      body.email === undefined
        ? undefined
        : normalizeEmail(optionalString(body, "email", 254));
    const phoneE164 =
      body.phone === undefined
        ? undefined
        : normalizeBrazilianPhone(optionalString(body, "phone", 40));
    const addressLine = optionalString(body, "addressLine", 240);
    const addressCity = optionalString(body, "addressCity", 120);
    const addressRegion = optionalString(body, "addressRegion", 40);
    const addressPostalCode = optionalString(body, "addressPostalCode", 24);
    const cpf = optionalString(body, "cpf", 20);
    const birthDate = optionalString(body, "birthDate", 10);
    if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      throw new HttpError(400, "invalid_birth_date", "A data de nascimento é inválida.");
    }
    if (identity.role !== "owner" && body.cpf !== undefined) {
      throw new HttpError(
        403,
        "permission_denied",
        "Somente administradores podem alterar o CPF.",
      );
    }
    if (body.status !== undefined) {
      if (identity.role !== "owner" || !["active", "archived"].includes(String(body.status))) {
        throw new HttpError(403, "permission_denied", "Somente administradores podem inativar um cadastro.");
      }
    }
    if (
      displayName === null &&
      fullName === null &&
      email === undefined &&
      phoneE164 === undefined &&
      body.whatsappEnabled === undefined &&
      body.addressLine === undefined &&
      body.addressCity === undefined &&
      body.addressRegion === undefined &&
      body.addressPostalCode === undefined &&
      body.cpf === undefined &&
      body.birthDate === undefined &&
      body.status === undefined
    ) {
      throw new HttpError(
        400,
        "no_changes",
        "Informe ao menos um campo para atualizar.",
      );
    }

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [account] = await db
      .select()
      .from(customerAccounts)
      .where(
        and(
          eq(customerAccounts.id, id),
          eq(customerAccounts.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (!account) {
      throw new HttpError(
        404,
        "customer_not_found",
        "O cliente não foi encontrado.",
      );
    }
    if (account.status === "deleted") {
      throw new HttpError(
        410,
        "customer_deleted",
        "Este cadastro foi excluído e não pode mais ser alterado.",
      );
    }
    const contacts = await db
      .select()
      .from(tutors)
      .where(
        and(
          eq(tutors.accountId, id),
          eq(tutors.status, "active"),
        ),
      );
    const contact =
      contacts.find((item) => item.isFinancialContact) ?? contacts[0];
    if (!contact) {
      throw new HttpError(
        409,
        "customer_contact_missing",
        "O cliente não possui um contato ativo para editar.",
      );
    }

    const nextEmail = email === undefined ? contact.email : email;
    const nextPhone = phoneE164 === undefined ? contact.phoneE164 : phoneE164;
    if (!nextEmail && !nextPhone) {
      throw new HttpError(
        400,
        "contact_required",
        "Informe pelo menos um e-mail ou telefone.",
      );
    }
    const whatsappEnabled =
      body.whatsappEnabled === undefined
        ? contact.whatsappEnabled
        : body.whatsappEnabled;
    if (typeof whatsappEnabled !== "boolean") {
      throw new HttpError(
        400,
        "invalid_field",
        "A preferência de WhatsApp é inválida.",
      );
    }
    if (whatsappEnabled && !nextPhone) {
      throw new HttpError(
        400,
        "whatsapp_phone_required",
        "Informe um telefone para ativar o WhatsApp.",
      );
    }

    const duplicateConditions = [];
    if (nextEmail) {
      duplicateConditions.push(eq(tutors.normalizedEmail, nextEmail));
    }
    if (nextPhone) duplicateConditions.push(eq(tutors.phoneE164, nextPhone));
    if (duplicateConditions.length) {
      const duplicates = await db
        .select({ accountId: tutors.accountId })
        .from(tutors)
        .where(
          and(
            eq(tutors.establishmentId, establishmentId),
            or(...duplicateConditions),
          ),
        );
      if (duplicates.some((item) => item.accountId !== id)) {
        throw new HttpError(
          409,
          "customer_contact_exists",
          "Este contato já pertence a outro cliente.",
        );
      }
    }

    const nextDisplayName = displayName ?? account.displayName;
    const nextFullName = fullName ?? displayName ?? contact.fullName;
    const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
    const accountUpdate = db
        .update(customerAccounts)
        .set({
          displayName: nextDisplayName,
          normalizedName: normalizeLookupText(nextDisplayName),
          addressLine: body.addressLine === undefined ? account.addressLine : addressLine,
          addressCity: body.addressCity === undefined ? account.addressCity : addressCity,
          addressRegion: body.addressRegion === undefined ? account.addressRegion : addressRegion,
          addressPostalCode: body.addressPostalCode === undefined ? account.addressPostalCode : addressPostalCode,
          cpf: body.cpf === undefined ? account.cpf : cpf,
          birthDate: body.birthDate === undefined ? account.birthDate : birthDate,
          status:
            body.status === undefined
              ? account.status
              : (body.status as "active" | "archived"),
          updatedAt: now,
        })
        .where(eq(customerAccounts.id, id));
    const tutorUpdate = db
        .update(tutors)
        .set({
          fullName: nextFullName,
          normalizedName: normalizeLookupText(nextFullName),
          email: nextEmail,
          normalizedEmail: nextEmail,
          phoneE164: nextPhone,
          whatsappEnabled,
          updatedAt: now,
        })
        .where(eq(tutors.id, contact.id));
    const auditInsert = db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      establishmentId,
      actorUserId: identity.userId,
      actorRole: identity.role,
      action:
        body.status === "archived"
          ? "customer.archived"
          : body.status === "active" && account.status === "archived"
            ? "customer.reactivated"
          : "customer.updated",
      entityType: "customer",
      entityId: id,
      requestId,
      metadataJson: JSON.stringify({
        name: nextDisplayName,
        previousStatus: account.status,
        nextStatus: body.status ?? account.status,
      }),
    });
    if (body.status === "archived") {
      await db.batch([
        accountUpdate,
        tutorUpdate,
        db
          .update(recurringSchedules)
          .set({
            status: "ended",
            endsOn: sql`coalesce(${recurringSchedules.endsOn}, date('now'))`,
            updatedAt: now,
          })
          .where(
            and(
              eq(recurringSchedules.establishmentId, establishmentId),
              eq(recurringSchedules.status, "active"),
              sql`${recurringSchedules.dogId} in (
                select id from dogs where account_id = ${id}
              )`,
            ),
          ),
        db
          .update(customerRequests)
          .set({
            status: "cancelled",
            responseNote: sql`coalesce(
              ${customerRequests.responseNote},
              'Cadastro do cliente inativado.'
            )`,
            updatedAt: now,
          })
          .where(
            and(
              eq(customerRequests.establishmentId, establishmentId),
              eq(customerRequests.accountId, id),
              eq(customerRequests.status, "pending"),
            ),
          ),
        auditInsert,
      ]);
    } else if (body.status === "active" && account.status === "archived") {
      await db.batch([
        accountUpdate,
        tutorUpdate,
        db
          .update(dogs)
          .set({ status: "active", updatedAt: now })
          .where(
            and(
              eq(dogs.accountId, id),
              eq(dogs.establishmentId, establishmentId),
              eq(dogs.status, "archived"),
            ),
          ),
        auditInsert,
      ]);
    } else {
      await db.batch([accountUpdate, tutorUpdate, auditInsert]);
    }

    return json({
      customer: {
        id,
        displayName: nextDisplayName,
        tutor: {
          id: contact.id,
          fullName: nextFullName,
          email: nextEmail,
          phoneE164: nextPhone,
          whatsappEnabled,
        },
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner"]);
    const { id } = await context.params;
    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [account] = await db
      .select({
        id: customerAccounts.id,
        displayName: customerAccounts.displayName,
        status: customerAccounts.status,
      })
      .from(customerAccounts)
      .where(
        and(
          eq(customerAccounts.id, id),
          eq(customerAccounts.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (!account) {
      throw new HttpError(404, "customer_not_found", "O cliente não foi encontrado.");
    }
    if (account.status === "deleted") {
      throw new HttpError(410, "customer_deleted", "Este cadastro já foi excluído.");
    }
    if (account.status !== "archived") {
      throw new HttpError(
        409,
        "customer_must_be_archived",
        "Inative o cliente antes de excluir o cadastro.",
      );
    }
    const now = new Date().toISOString();
    const d1 = getD1Database();
    const results = await d1.batch([
      d1.prepare(
        `UPDATE admin_sessions
         SET revoked_at = ?
         WHERE revoked_at IS NULL AND user_id IN (
           SELECT au.id FROM app_users au
           INNER JOIN tutors t ON t.id = au.tutor_id
           WHERE t.account_id = ? AND au.establishment_id = ?
         ) AND EXISTS (
           SELECT 1 FROM customer_accounts
           WHERE id = ? AND establishment_id = ? AND status = 'archived'
         )`,
      ).bind(now, id, establishmentId, id, establishmentId),
      d1.prepare(
        `UPDATE password_reset_tokens
         SET status = 'revoked', updated_at = ?
         WHERE status = 'pending' AND user_id IN (
           SELECT au.id FROM app_users au
           INNER JOIN tutors t ON t.id = au.tutor_id
           WHERE t.account_id = ? AND au.establishment_id = ?
         ) AND EXISTS (
           SELECT 1 FROM customer_accounts
           WHERE id = ? AND establishment_id = ? AND status = 'archived'
         )`,
      ).bind(now, id, establishmentId, id, establishmentId),
      d1.prepare(
        `UPDATE app_users
         SET status = 'disabled',
           email = 'deleted+' || id || '@invalid.local',
           normalized_email = 'deleted+' || id || '@invalid.local',
           updated_at = ?
         WHERE establishment_id = ? AND tutor_id IN (
           SELECT id FROM tutors WHERE account_id = ?
         ) AND EXISTS (
           SELECT 1 FROM customer_accounts
           WHERE id = ? AND establishment_id = ? AND status = 'archived'
         )`,
      ).bind(now, establishmentId, id, id, establishmentId),
      d1.prepare(
        `UPDATE account_invitations
         SET status = 'revoked', updated_at = ?
         WHERE establishment_id = ? AND account_id = ? AND status = 'pending'
           AND EXISTS (
             SELECT 1 FROM customer_accounts
             WHERE id = ? AND establishment_id = ? AND status = 'archived'
           )`,
      ).bind(now, establishmentId, id, id, establishmentId),
      d1.prepare(
        `UPDATE customer_requests
         SET status = 'cancelled', response_note = coalesce(
           response_note,
           'Cadastro do cliente excluído.'
         ), updated_at = ?
         WHERE establishment_id = ? AND account_id = ? AND status = 'pending'
           AND EXISTS (
             SELECT 1 FROM customer_accounts
             WHERE id = ? AND establishment_id = ? AND status = 'archived'
           )`,
      ).bind(now, establishmentId, id, id, establishmentId),
      d1.prepare(
        `UPDATE recurring_schedules
         SET status = 'ended', ends_on = coalesce(ends_on, substr(?, 1, 10)),
           updated_at = ?
         WHERE establishment_id = ? AND dog_id IN (
           SELECT id FROM dogs WHERE account_id = ?
         ) AND status = 'active' AND EXISTS (
           SELECT 1 FROM customer_accounts
           WHERE id = ? AND establishment_id = ? AND status = 'archived'
         )`,
      ).bind(now, now, establishmentId, id, id, establishmentId),
      d1.prepare(
        `UPDATE dogs SET status = 'archived', updated_at = ?
         WHERE establishment_id = ? AND account_id = ? AND status = 'active'
           AND EXISTS (
             SELECT 1 FROM customer_accounts
             WHERE id = ? AND establishment_id = ? AND status = 'archived'
           )`,
      ).bind(now, establishmentId, id, id, establishmentId),
      d1.prepare(
        `UPDATE tutors
         SET email = NULL, normalized_email = NULL, phone_e164 = NULL,
           whatsapp_enabled = 0, is_financial_contact = 0,
           status = 'archived', updated_at = ?
         WHERE establishment_id = ? AND account_id = ? AND EXISTS (
           SELECT 1 FROM customer_accounts
           WHERE id = ? AND establishment_id = ? AND status = 'archived'
         )`,
      ).bind(now, establishmentId, id, id, establishmentId),
      d1.prepare(
        `UPDATE customer_accounts
         SET status = 'deleted', address_line = NULL, address_city = NULL,
           address_region = NULL, address_postal_code = NULL, cpf = NULL,
           birth_date = NULL, updated_at = ?
         WHERE id = ? AND establishment_id = ? AND status = 'archived'`,
      ).bind(now, id, establishmentId),
      d1.prepare(
        `INSERT INTO audit_events (
          id, establishment_id, actor_user_id, actor_role, action,
          entity_type, entity_id, request_id, result, metadata_json,
          occurred_at
        ) SELECT ?, ?, ?, ?, 'customer.deleted', 'customer', ?, ?,
          'success', ?, ?
          WHERE EXISTS (
            SELECT 1 FROM customer_accounts
            WHERE id = ? AND establishment_id = ? AND status = 'deleted'
          )`,
      ).bind(
        crypto.randomUUID(),
        establishmentId,
        identity.userId,
        identity.role,
        id,
        requestId,
        JSON.stringify({
          name: account.displayName,
          retainedHistory: true,
          contactReleased: true,
        }),
        now,
        id,
        establishmentId,
      ),
    ]);
    if ((results[8].meta.changes ?? 0) !== 1) {
      throw new HttpError(
        409,
        "customer_delete_conflict",
        "O cadastro mudou enquanto era excluído. Atualize a página e tente novamente.",
      );
    }
    return json({ deleted: true });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
