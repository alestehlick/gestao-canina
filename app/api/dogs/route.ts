import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  auditEvents,
  customerAccounts,
  dogs,
  dogTutors,
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

function optionalNullableBoolean(
  body: Record<string, unknown>,
  key: string,
) {
  const value = body[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") {
    throw new HttpError(
      400,
      "invalid_field",
      `O campo ${key} é inválido.`,
    );
  }
  return value;
}

function readWeightGrams(body: Record<string, unknown>) {
  if (body.weightGrams !== undefined && body.weightGrams !== null) {
    if (
      typeof body.weightGrams !== "number" ||
      !Number.isSafeInteger(body.weightGrams) ||
      body.weightGrams < 0 ||
      body.weightGrams > 200_000
    ) {
      throw new HttpError(
        400,
        "invalid_weight",
        "Informe um peso válido.",
      );
    }
    return body.weightGrams;
  }
  if (body.weightKg !== undefined && body.weightKg !== null) {
    if (
      typeof body.weightKg !== "number" ||
      !Number.isFinite(body.weightKg) ||
      body.weightKg < 0 ||
      body.weightKg > 200
    ) {
      throw new HttpError(
        400,
        "invalid_weight",
        "Informe um peso válido.",
      );
    }
    return Math.round(body.weightKg * 1_000);
  }
  return null;
}

function isValidPastOrPresentDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value &&
    value <= new Date().toISOString().slice(0, 10)
  );
}

function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
  );
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "staff"]);
    const body = await readJsonObject(request);
    const accountId = requiredString(body, "accountId", 80);
    const name = requiredString(body, "name", 120);
    const breed = optionalString(body, "breed", 120);
    const birthDate = optionalString(body, "birthDate", 10);
    if (birthDate && !isValidPastOrPresentDate(birthDate)) {
      throw new HttpError(
        400,
        "invalid_birth_date",
        "Informe uma data de nascimento válida.",
      );
    }
    const sex = body.sex === undefined ? "unknown" : body.sex;
    if (!["female", "male", "unknown"].includes(String(sex))) {
      throw new HttpError(
        400,
        "invalid_sex",
        "Informe fêmea, macho ou não informado.",
      );
    }
    const weightGrams = readWeightGrams(body);
    const neutered = optionalNullableBoolean(body, "neutered");
    const vaccinesCurrent = optionalNullableBoolean(
      body,
      "vaccinesCurrent",
    );
    const feedingNotes = optionalString(body, "feedingNotes", 2_000);
    const temperamentNotes = optionalString(
      body,
      "temperamentNotes",
      2_000,
    );
    const healthNotes = optionalString(body, "healthNotes", 2_000);
    const emergencyNotes = optionalString(body, "emergencyNotes", 2_000);
    const medicationNotes = optionalString(body, "medicationNotes", 2_000);
    const vaccinesJson = JSON.stringify(readVaccines(body.vaccines));
    const requestedTutorId = optionalString(body, "primaryTutorId", 80);

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [account] = await db
      .select({
        id: customerAccounts.id,
        displayName: customerAccounts.displayName,
      })
      .from(customerAccounts)
      .where(
        and(
          eq(customerAccounts.id, accountId),
          eq(customerAccounts.establishmentId, establishmentId),
          eq(customerAccounts.status, "active"),
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

    const [duplicate] = await db
      .select({ id: dogs.id })
      .from(dogs)
      .where(
        and(
          eq(dogs.accountId, accountId),
          eq(dogs.normalizedName, normalizeLookupText(name)),
          eq(dogs.status, "active"),
        ),
      )
      .limit(1);
    if (duplicate) {
      throw new HttpError(
        409,
        "dog_already_exists",
        "Já existe um cão com este nome para o cliente.",
      );
    }

    let primaryTutor:
      | { id: string; fullName: string }
      | undefined;
    if (requestedTutorId) {
      [primaryTutor] = await db
        .select({ id: tutors.id, fullName: tutors.fullName })
        .from(tutors)
        .where(
          and(
            eq(tutors.id, requestedTutorId),
            eq(tutors.establishmentId, establishmentId),
            eq(tutors.accountId, accountId),
            eq(tutors.status, "active"),
          ),
        )
        .limit(1);
      if (!primaryTutor) {
        throw new HttpError(
          404,
          "tutor_not_found",
          "O responsável escolhido não pertence a este cliente.",
        );
      }
    } else {
      [primaryTutor] = await db
        .select({ id: tutors.id, fullName: tutors.fullName })
        .from(tutors)
        .where(
          and(
            eq(tutors.establishmentId, establishmentId),
            eq(tutors.accountId, accountId),
            eq(tutors.status, "active"),
          ),
        )
        .orderBy(desc(tutors.isFinancialContact), desc(tutors.createdAt))
        .limit(1);
    }

    const dogId = crypto.randomUUID();
    const dogInsert = db.insert(dogs).values({
      id: dogId,
      establishmentId,
      accountId,
      name,
      normalizedName: normalizeLookupText(name),
      breed,
      birthDate,
      sex: sex as "female" | "male" | "unknown",
      weightGrams,
      neutered,
      vaccinesCurrent,
      feedingNotes,
      temperamentNotes,
      healthNotes,
      emergencyNotes,
      medicationNotes,
      vaccinesJson,
    });
    const auditInsert = db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      establishmentId,
      actorUserId: identity.userId,
      actorRole: identity.role,
      action: "dog.created",
      entityType: "dog",
      entityId: dogId,
      requestId,
      metadataJson: JSON.stringify({
        accountId,
        primaryTutorId: primaryTutor?.id ?? null,
      }),
    });
    if (primaryTutor) {
      await db.batch([
        dogInsert,
        db.insert(dogTutors).values({
          dogId,
          tutorId: primaryTutor.id,
          isPrimary: true,
          emergencyContact: true,
          pickupAuthorized: true,
          portalVisible: true,
        }),
        auditInsert,
      ]);
    } else {
      await db.batch([dogInsert, auditInsert]);
    }

    return json(
      {
        dog: {
          id: dogId,
          accountId,
          customerName: account.displayName,
          name,
          breed,
          birthDate,
          sex,
          weightGrams,
          neutered,
          vaccinesCurrent,
          feedingNotes,
          temperamentNotes,
          healthNotes,
          emergencyNotes,
          status: "active",
          primaryTutor: primaryTutor ?? null,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

function readVaccines(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError(400, "invalid_vaccines", "Informe as vacinas corretamente.");
  return value.map((item) => {
    if (!item || typeof item !== "object" || typeof (item as { name?: unknown }).name !== "string" || !String((item as { name: string }).name).trim() || String((item as { name: string }).name).trim().length > 120 || typeof (item as { expiresOn?: unknown }).expiresOn !== "string" || !isValidIsoDate((item as { expiresOn: string }).expiresOn)) {
      throw new HttpError(400, "invalid_vaccines", "Informe nome e vencimento de cada vacina.");
    }
    return { name: (item as { name: string }).name.trim(), expiresOn: (item as { expiresOn: string }).expiresOn };
  });
}
