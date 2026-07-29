import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, creditPackages } from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
} from "@/lib/server/http";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const { id } = await context.params;
    if (!id || id.length > 80) {
      throw new HttpError(
        400,
        "invalid_package_id",
        "O pacote informado é inválido.",
      );
    }
    const body = await readJsonObject(request);
    const updates: {
      name?: string;
      creditUnits?: number;
      packagePriceCents?: number;
      active?: boolean;
      updatedAt: ReturnType<typeof sql>;
    } = {
      updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    };
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120) {
        throw new HttpError(400, "invalid_field", "O nome do pacote é inválido.");
      }
      updates.name = body.name.trim();
    }
    if (body.creditUnits !== undefined) {
      if (
        typeof body.creditUnits !== "number" ||
        !Number.isSafeInteger(body.creditUnits) ||
        body.creditUnits < 1 ||
        body.creditUnits > 10_000
      ) {
        throw new HttpError(
          400,
          "invalid_field",
          "A quantidade de créditos é inválida.",
        );
      }
      updates.creditUnits = body.creditUnits;
    }
    if (body.packagePriceCents !== undefined) {
      if (
        typeof body.packagePriceCents !== "number" ||
        !Number.isSafeInteger(body.packagePriceCents) ||
        body.packagePriceCents < 1 ||
        body.packagePriceCents > 100_000_000
      ) {
        throw new HttpError(
          400,
          "invalid_field",
          "O preço do pacote é inválido.",
        );
      }
      updates.packagePriceCents = body.packagePriceCents;
    }
    if (body.active !== undefined) {
      if (typeof body.active !== "boolean") {
        throw new HttpError(
          400,
          "invalid_field",
          "A situação do pacote é inválida.",
        );
      }
      updates.active = body.active;
    }
    if (Object.keys(updates).length === 1) {
      throw new HttpError(
        400,
        "empty_update",
        "Informe ao menos uma alteração.",
      );
    }

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [existing] = await db
      .select({ id: creditPackages.id })
      .from(creditPackages)
      .where(
        and(
          eq(creditPackages.id, id),
          eq(creditPackages.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new HttpError(
        404,
        "credit_package_not_found",
        "O pacote de créditos não foi encontrado.",
      );
    }

    await db.batch([
      db
        .update(creditPackages)
        .set(updates)
        .where(
          and(
            eq(creditPackages.id, id),
            eq(creditPackages.establishmentId, establishmentId),
          ),
        ),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "credit_package.updated",
        entityType: "credit_package",
        entityId: id,
        requestId,
        metadataJson: JSON.stringify(body),
      }),
    ]);

    return json({ package: { id, ...body } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
