import { and, eq, or } from "drizzle-orm";
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
  requiredString,
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
    throw new HttpError(
      400,
      "invalid_email",
      "Informe um e-mail válido.",
    );
  }
  return email;
}

function normalizeBrazilianPhone(value: string | null) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }
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

function optionalBoolean(
  body: Record<string, unknown>,
  key: string,
  fallback: boolean,
) {
  const value = body[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") {
    throw new HttpError(
      400,
      "invalid_field",
      `O campo ${key} é inválido.`,
    );
  }
  return value;
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "staff"]);
    const body = await readJsonObject(request);
    const displayName = requiredString(body, "displayName", 160);
    const fullName =
      optionalString(body, "fullName", 160) ?? displayName;
    const email = normalizeEmail(optionalString(body, "email", 254));
    const phoneE164 = normalizeBrazilianPhone(
      optionalString(body, "phone", 40),
    );
    if (!email && !phoneE164) {
      throw new HttpError(
        400,
        "contact_required",
        "Informe pelo menos um e-mail ou telefone.",
      );
    }

    const addressLine = optionalString(body, "addressLine", 240);
    const addressCity = optionalString(body, "addressCity", 120);
    const addressRegion =
      optionalString(body, "addressRegion", 40) ?? "SP";
    const addressPostalCode = optionalString(
      body,
      "addressPostalCode",
      24,
    );
    const cpf = optionalString(body, "cpf", 20);
    const birthDate = optionalString(body, "birthDate", 10);
    if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      throw new HttpError(400, "invalid_birth_date", "Informe uma data de nascimento válida.");
    }
    const whatsappEnabled = optionalBoolean(
      body,
      "whatsappEnabled",
      Boolean(phoneE164),
    );
    if (whatsappEnabled && !phoneE164) {
      throw new HttpError(
        400,
        "whatsapp_phone_required",
        "Informe um telefone para ativar o WhatsApp.",
      );
    }
    const isFinancialContact = optionalBoolean(
      body,
      "isFinancialContact",
      true,
    );

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const duplicateConditions = [];
    if (email) duplicateConditions.push(eq(tutors.normalizedEmail, email));
    if (phoneE164) duplicateConditions.push(eq(tutors.phoneE164, phoneE164));
    if (duplicateConditions.length > 0) {
      const [duplicate] = await db
        .select({
          accountId: tutors.accountId,
          fullName: tutors.fullName,
        })
        .from(tutors)
        .where(
          and(
            eq(tutors.establishmentId, establishmentId),
            or(...duplicateConditions),
          ),
        )
        .limit(1);
      if (duplicate) {
        throw new HttpError(
          409,
          "customer_contact_exists",
          "Este contato já pertence a um cliente. Abra o cadastro existente para adicionar outro cão.",
        );
      }
    }

    const accountId = crypto.randomUUID();
    const tutorId = crypto.randomUUID();
    await db.batch([
      db.insert(customerAccounts).values({
        id: accountId,
        establishmentId,
        displayName,
        normalizedName: normalizeLookupText(displayName),
        addressLine,
        addressCity,
        addressRegion,
        addressPostalCode,
        cpf,
        birthDate,
      }),
      db.insert(tutors).values({
        id: tutorId,
        establishmentId,
        accountId,
        fullName,
        normalizedName: normalizeLookupText(fullName),
        email,
        normalizedEmail: email,
        phoneE164,
        whatsappEnabled,
        isFinancialContact,
      }),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "customer.created",
        entityType: "customer_account",
        entityId: accountId,
        requestId,
        metadataJson: JSON.stringify({
          tutorId,
          hasEmail: Boolean(email),
          hasPhone: Boolean(phoneE164),
        }),
      }),
    ]);

    return json(
      {
        customer: {
          id: accountId,
          displayName,
          addressLine,
          addressCity,
          addressRegion,
          addressPostalCode,
          status: "active",
          tutors: [
            {
              id: tutorId,
              fullName,
              email,
              phoneE164,
              whatsappEnabled,
              isFinancialContact,
              status: "active",
            },
          ],
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
