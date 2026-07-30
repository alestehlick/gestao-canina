import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, dogs } from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import { getRuntimeBindings } from "@/lib/server/runtime";
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

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, ["owner", "staff", "finance"]);
    const { id } = await context.params;
    if (new URL(request.url).searchParams.get("photo") !== "1") {
      throw new HttpError(404, "not_found", "Recurso não encontrado.");
    }
    const [dog] = await getDb().select().from(dogs).where(and(eq(dogs.id, id), eq(dogs.establishmentId, identity.establishmentId!))).limit(1);
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
    const identity = await requireIdentity(request, ["owner", "staff"]);
    const { id } = await context.params;
    const photo = (await request.formData()).get("photo");
    if (!(photo instanceof File) || !photo.size || photo.size > 5_000_000 || !/^image\/(jpeg|png|webp)$/i.test(photo.type)) {
      throw new HttpError(400, "invalid_photo", "Envie uma foto JPG, PNG ou WebP de até 5 MB.");
    }
    const storage = getRuntimeBindings().FILES;
    if (!storage) throw new HttpError(503, "photo_storage_unavailable", "O armazenamento de fotos não está disponível.");
    const [dog] = await getDb().select({
      id: dogs.id,
      photoObjectKey: dogs.photoObjectKey,
    }).from(dogs).where(and(eq(dogs.id, id), eq(dogs.establishmentId, identity.establishmentId!))).limit(1);
    if (!dog) throw new HttpError(404, "dog_not_found", "O cão não foi encontrado.");
    const key = `dogs/${identity.establishmentId}/${id}/${crypto.randomUUID()}`;
    await storage.put(key, photo.stream(), { httpMetadata: { contentType: photo.type } });
    await getDb().update(dogs).set({ photoObjectKey: key }).where(eq(dogs.id, id));
    if (dog.photoObjectKey && dog.photoObjectKey !== key) {
      await storage.delete(dog.photoObjectKey);
    }
    return json({ photoUrl: `/api/dogs/${id}?photo=1` });
  } catch (error) { return errorResponse(error, requestId); }
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
      if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
        throw new HttpError(
          400,
          "invalid_birth_date",
          "A data de nascimento é inválida.",
        );
      }
      updates.birthDate = birthDate;
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
      if (!Array.isArray(body.vaccines) || body.vaccines.length > 30 || body.vaccines.some((item) => !item || typeof item !== "object" || typeof (item as { name?: unknown }).name !== "string" || typeof (item as { expiresOn?: unknown }).expiresOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test((item as { expiresOn: string }).expiresOn))) {
        throw new HttpError(400, "invalid_vaccines", "Informe nome e vencimento de cada vacina.");
      }
      updates.vaccinesJson = JSON.stringify(body.vaccines.map((item) => ({ name: (item as { name: string }).name.trim(), expiresOn: (item as { expiresOn: string }).expiresOn })));
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
    const [dog] = await db
      .select({ id: dogs.id })
      .from(dogs)
      .where(
        and(
          eq(dogs.id, id),
          eq(dogs.establishmentId, establishmentId),
          eq(dogs.status, "active"),
        ),
      )
      .limit(1);
    if (!dog) {
      throw new HttpError(
        404,
        "dog_not_found",
        "O cão não foi encontrado.",
      );
    }

    await db.batch([
      db.update(dogs).set(updates).where(eq(dogs.id, id)),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "dog.updated",
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
