import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, dogs } from "@/db/schema";
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
