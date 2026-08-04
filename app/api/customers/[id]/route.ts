import { and, eq, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  appointments,
  auditEvents,
  creditMovements,
  creditPurchases,
  customerAccounts,
  dogs,
  invoices,
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
          : "customer.updated",
      entityType: "customer",
      entityId: id,
      requestId,
    });
    if (body.status === "archived") {
      await db.batch([
        accountUpdate,
        tutorUpdate,
        db
          .update(dogs)
          .set({ status: "archived", updatedAt: now })
          .where(
            and(
              eq(dogs.accountId, id),
              eq(dogs.establishmentId, establishmentId),
              eq(dogs.status, "active"),
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
      .select({ id: customerAccounts.id })
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
    const references = await Promise.all([
      db.select({ id: dogs.id }).from(dogs).where(eq(dogs.accountId, id)).limit(1),
      db.select({ id: appointments.id }).from(appointments).where(eq(appointments.accountId, id)).limit(1),
      db.select({ id: invoices.id }).from(invoices).where(eq(invoices.accountId, id)).limit(1),
      db.select({ id: creditPurchases.id }).from(creditPurchases).where(eq(creditPurchases.accountId, id)).limit(1),
      db.select({ id: creditMovements.id }).from(creditMovements).where(eq(creditMovements.accountId, id)).limit(1),
    ]);
    if (references.some((items) => items.length > 0)) {
      throw new HttpError(
        409,
        "customer_has_history",
        "Este cliente possui histórico operacional. Use Inativar para preservar os registros.",
      );
    }
    await db.batch([
      db.delete(tutors).where(eq(tutors.accountId, id)),
      db.delete(customerAccounts).where(eq(customerAccounts.id, id)),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "customer.deleted",
        entityType: "customer",
        entityId: id,
        requestId,
      }),
    ]);
    return json({ deleted: true });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
