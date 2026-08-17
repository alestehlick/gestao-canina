import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  appUsers,
  appointments,
  auditEvents,
  dogs,
  dogTutors,
  recurringSchedules,
  tutors,
} from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import { getRuntimeBindings } from "@/lib/server/runtime";
import { todayInSaoPaulo } from "@/lib/service-rules";
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

async function authorizedDog(
  identity: Awaited<ReturnType<typeof requireIdentity>>,
  id: string,
) {
  const db = getDb();
  if (identity.role !== "customer") {
    const [dog] = await db
      .select({
        id: dogs.id,
        accountId: dogs.accountId,
        photoObjectKey: dogs.photoObjectKey,
      })
      .from(dogs)
      .where(
        and(
          eq(dogs.id, id),
          eq(dogs.establishmentId, identity.establishmentId!),
        ),
      )
      .limit(1);
    return dog;
  }
  const [dog] = await db
    .select({
      id: dogs.id,
      accountId: dogs.accountId,
      photoObjectKey: dogs.photoObjectKey,
    })
    .from(dogs)
    .innerJoin(dogTutors, eq(dogTutors.dogId, dogs.id))
    .innerJoin(tutors, eq(tutors.id, dogTutors.tutorId))
    .innerJoin(appUsers, eq(appUsers.tutorId, tutors.id))
    .where(
      and(
        eq(dogs.id, id),
        eq(dogs.establishmentId, identity.establishmentId!),
        eq(dogs.status, "active"),
        eq(dogTutors.portalVisible, true),
        eq(tutors.status, "active"),
        eq(appUsers.id, identity.userId!),
        eq(appUsers.status, "active"),
        eq(appUsers.role, "customer"),
        eq(appUsers.establishmentId, identity.establishmentId!),
        eq(tutors.accountId, dogs.accountId),
      ),
    )
    .limit(1);
  return dog;
}

function readVaccines(value: unknown) {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "invalid_vaccines", "Informe as vacinas corretamente.");
  }
  return value.map((item) => {
    const name =
      item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string"
        ? (item as { name: string }).name.trim()
        : "";
    const expiresOn =
      item && typeof item === "object" && typeof (item as { expiresOn?: unknown }).expiresOn === "string"
        ? (item as { expiresOn: string }).expiresOn
        : "";
    const parsedExpiry = new Date(`${expiresOn}T00:00:00.000Z`);
    if (
      !name ||
      name.length > 120 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) ||
      Number.isNaN(parsedExpiry.valueOf()) ||
      parsedExpiry.toISOString().slice(0, 10) !== expiresOn
    ) {
      throw new HttpError(
        400,
        "invalid_vaccines",
        "Informe nome e vencimento de cada vacina.",
      );
    }
    return { name, expiresOn };
  });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, ["owner", "staff", "finance", "customer"]);
    const { id } = await context.params;
    if (new URL(request.url).searchParams.get("photo") !== "1") {
      throw new HttpError(404, "not_found", "Recurso não encontrado.");
    }
    const dog = await authorizedDog(identity, id);
    if (!dog?.photoObjectKey) throw new HttpError(404, "photo_not_found", "A foto não foi encontrada.");
    const object = await getRuntimeBindings().FILES?.get(dog.photoObjectKey);
    if (!object) throw new HttpError(404, "photo_not_found", "A foto não foi encontrada.");
    return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType || "image/jpeg", "cache-control": "private, max-age=3600" } });
  } catch (error) { return errorResponse(error, requestId); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "staff", "customer"]);
    const { id } = await context.params;
    const photo = (await request.formData()).get("photo");
    if (!(photo instanceof File) || !photo.size || photo.size > 5_000_000 || !/^image\/(jpeg|png|webp)$/i.test(photo.type)) {
      throw new HttpError(400, "invalid_photo", "Envie uma foto JPG, PNG ou WebP de até 5 MB.");
    }
    const storage = getRuntimeBindings().FILES;
    if (!storage) throw new HttpError(503, "photo_storage_unavailable", "O armazenamento de fotos não está disponível.");
    const dog = await authorizedDog(identity, id);
    if (!dog) throw new HttpError(404, "dog_not_found", "O cão não foi encontrado.");
    const key = `dogs/${identity.establishmentId}/${id}/${crypto.randomUUID()}`;
    const updatedAt = new Date().toISOString();
    await storage.put(key, photo.stream(), { httpMetadata: { contentType: photo.type } });
    await getDb().batch([
      getDb()
        .update(dogs)
        .set({ photoObjectKey: key, updatedAt })
        .where(eq(dogs.id, id)),
      getDb().insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId: identity.establishmentId!,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "dog.photo_updated",
        entityType: "dog",
        entityId: id,
        requestId,
      }),
    ]);
    if (dog.photoObjectKey && dog.photoObjectKey !== key) {
      await storage.delete(dog.photoObjectKey);
    }
    return json({
      photoUrl: `/api/dogs/${id}?photo=1&v=${encodeURIComponent(updatedAt)}`,
    });
  } catch (error) { return errorResponse(error, requestId); }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "staff", "customer"]);
    const { id } = await context.params;
    if (!id || id.length > 80) {
      throw new HttpError(
        400,
        "invalid_dog_id",
        "O cão informado é inválido.",
      );
    }
    const body = await readJsonObject(request);
    const updates: Partial<typeof dogs.$inferInsert> = {
      updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` as unknown as string,
    };
    let changeCount = 0;

    if (body.name !== undefined) {
      if (
        typeof body.name !== "string" ||
        !body.name.trim() ||
        body.name.trim().length > 120
      ) {
        throw new HttpError(
          400,
          "invalid_name",
          "Informe o nome do cão.",
        );
      }
      updates.name = body.name.trim();
      updates.normalizedName = normalizeLookupText(body.name);
      changeCount += 1;
    }

    for (const [key, limit] of [
      ["breed", 120],
      ["feedingNotes", 2_000],
      ["temperamentNotes", 2_000],
      ["healthNotes", 2_000],
      ["medicationNotes", 2_000],
      ["emergencyNotes", 2_000],
    ] as const) {
      if (body[key] !== undefined) {
        updates[key] = optionalString(body, key, limit);
        changeCount += 1;
      }
    }

    if (body.birthDate !== undefined) {
      const birthDate = optionalString(body, "birthDate", 10);
      if (
        birthDate &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ||
          birthDate > todayInSaoPaulo())
      ) {
        throw new HttpError(
          400,
          "invalid_birth_date",
          "A data de nascimento é inválida.",
        );
      }
      updates.birthDate = birthDate;
      changeCount += 1;
    }

    if (body.sex !== undefined) {
      if (!["female", "male", "unknown"].includes(String(body.sex))) {
        throw new HttpError(400, "invalid_sex", "Informe fêmea, macho ou não informado.");
      }
      updates.sex = body.sex as "female" | "male" | "unknown";
      changeCount += 1;
    }

    if (body.neutered !== undefined) {
      if (body.neutered !== null && typeof body.neutered !== "boolean") {
        throw new HttpError(400, "invalid_neutered", "A informação de castração é inválida.");
      }
      updates.neutered = body.neutered;
      changeCount += 1;
    }

    if (body.weightGrams !== undefined) {
      if (
        body.weightGrams !== null &&
        (typeof body.weightGrams !== "number" ||
          !Number.isSafeInteger(body.weightGrams) ||
          body.weightGrams < 0 ||
          body.weightGrams > 200_000)
      ) {
        throw new HttpError(400, "invalid_weight", "Informe um peso válido.");
      }
      updates.weightGrams = body.weightGrams;
      changeCount += 1;
    }

    if (body.status !== undefined) {
      if (identity.role !== "owner") {
        throw new HttpError(403, "permission_denied", "Somente administradores podem inativar um cadastro.");
      }
      if (!["active", "archived", "deceased"].includes(String(body.status))) {
        throw new HttpError(400, "invalid_status", "A situação do cadastro é inválida.");
      }
      updates.status = body.status as "active" | "archived" | "deceased";
      changeCount += 1;
    }

    if (body.vaccinesCurrent !== undefined) {
      if (
        body.vaccinesCurrent !== null &&
        typeof body.vaccinesCurrent !== "boolean"
      ) {
        throw new HttpError(
          400,
          "invalid_vaccines",
          "A situação das vacinas é inválida.",
        );
      }
      updates.vaccinesCurrent = body.vaccinesCurrent;
      changeCount += 1;
    }
    if (body.vaccines !== undefined) {
      updates.vaccinesJson = JSON.stringify(readVaccines(body.vaccines));
      changeCount += 1;
    }

    if (changeCount === 0) {
      throw new HttpError(
        400,
        "no_changes",
        "Informe ao menos um campo para atualizar.",
      );
    }

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const dog = await authorizedDog(identity, id);
    if (!dog) {
      throw new HttpError(
        404,
        "dog_not_found",
        "O cão não foi encontrado.",
      );
    }

    if (updates.normalizedName) {
      const [duplicate] = await db
        .select({ id: dogs.id })
        .from(dogs)
        .where(
          and(
            eq(dogs.accountId, dog.accountId),
            eq(dogs.normalizedName, updates.normalizedName),
            eq(dogs.status, "active"),
            sql`${dogs.id} <> ${id}`,
          ),
        )
        .limit(1);
      if (duplicate) {
        throw new HttpError(
          409,
          "dog_already_exists",
          "Já existe um cão com este nome neste cadastro.",
        );
      }
    }

    await db.batch([
      db.update(dogs).set(updates).where(eq(dogs.id, id)),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: body.status === "archived" ? "dog.archived" : "dog.updated",
        entityType: "dog",
        entityId: id,
        requestId,
      }),
    ]);

    const [updated] = await db
      .select()
      .from(dogs)
      .where(eq(dogs.id, id))
      .limit(1);
    return json({ dog: updated });
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
    const [dog] = await db
      .select({ id: dogs.id, name: dogs.name, photoObjectKey: dogs.photoObjectKey })
      .from(dogs)
      .where(
        and(
          eq(dogs.id, id),
          eq(dogs.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (!dog) {
      throw new HttpError(404, "dog_not_found", "O cão não foi encontrado.");
    }
    const [appointment] = await db
      .select({ id: appointments.id })
      .from(appointments)
      .where(eq(appointments.dogId, id))
      .limit(1);
    const [recurrence] = await db
      .select({ id: recurringSchedules.id })
      .from(recurringSchedules)
      .where(eq(recurringSchedules.dogId, id))
      .limit(1);
    if (appointment || recurrence) {
      throw new HttpError(
        409,
        "dog_has_history",
        "Este cão possui histórico operacional. Use Inativar para preservar os registros.",
      );
    }
    await db.batch([
      db.delete(dogs).where(eq(dogs.id, id)),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "dog.deleted",
        entityType: "dog",
        entityId: id,
        requestId,
        metadataJson: JSON.stringify({ name: dog.name }),
      }),
    ]);
    if (dog.photoObjectKey) {
      await getRuntimeBindings().FILES?.delete(dog.photoObjectKey);
    }
    return json({ deleted: true });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
