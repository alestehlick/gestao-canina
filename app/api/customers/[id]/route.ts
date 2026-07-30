import { and, eq, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  auditEvents,
  customerAccounts,
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
    if (
      displayName === null &&
      fullName === null &&
      email === undefined &&
      phoneE164 === undefined &&
      body.whatsappEnabled === undefined
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
    await db.batch([
      db
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
          updatedAt: now,
        })
        .where(eq(customerAccounts.id, id)),
      db
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
        .where(eq(tutors.id, contact.id)),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "customer.updated",
        entityType: "customer",
        entityId: id,
        requestId,
      }),
    ]);

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
