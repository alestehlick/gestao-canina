import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, serviceCatalog } from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
} from "@/lib/server/http";

const editableServiceCodes = [
  "hotel",
  "daycare",
  "bath",
  "hygienic_grooming",
] as const;

type EditableServiceCode = (typeof editableServiceCodes)[number];

function isEditableServiceCode(value: string): value is EditableServiceCode {
  return editableServiceCodes.includes(value as EditableServiceCode);
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, ["owner"]);
    const db = getDb();
    const services = await db
      .select({
        id: serviceCatalog.id,
        code: serviceCatalog.code,
        name: serviceCatalog.name,
        unit: serviceCatalog.unit,
        priceCents: serviceCatalog.basePriceCents,
        updatedAt: serviceCatalog.updatedAt,
      })
      .from(serviceCatalog)
      .where(
        and(
          eq(serviceCatalog.establishmentId, identity.establishmentId!),
          inArray(serviceCatalog.code, editableServiceCodes),
        ),
      )
      .orderBy(asc(serviceCatalog.name));

    return json({ prices: services });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner"]);
    const body = await readJsonObject(request);
    const rawPrices = body.prices;
    if (!rawPrices || typeof rawPrices !== "object" || Array.isArray(rawPrices)) {
      throw new HttpError(
        400,
        "invalid_field",
        "Informe os preços que deseja atualizar.",
      );
    }

    const updates = Object.entries(rawPrices).map(([code, value]) => {
      if (
        !isEditableServiceCode(code) ||
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > 100_000_000
      ) {
        throw new HttpError(
          400,
          "invalid_price",
          `O preço informado para ${code} é inválido.`,
        );
      }
      return { code, priceCents: value };
    });
    if (updates.length === 0) {
      throw new HttpError(
        400,
        "empty_update",
        "Informe ao menos um preço para atualizar.",
      );
    }

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const existing = await db
      .select({ code: serviceCatalog.code })
      .from(serviceCatalog)
      .where(
        and(
          eq(serviceCatalog.establishmentId, establishmentId),
          inArray(
            serviceCatalog.code,
            updates.map(({ code }) => code),
          ),
        ),
      );
    if (existing.length !== updates.length) {
      throw new HttpError(
        409,
        "service_catalog_incomplete",
        "Um dos serviços padrão ainda não existe no catálogo.",
      );
    }

    const priceUpdateStatements = updates.map(({ code, priceCents }) =>
        db
          .update(serviceCatalog)
          .set({
            basePriceCents: priceCents,
            updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
          })
          .where(
            and(
              eq(serviceCatalog.establishmentId, establishmentId),
              eq(serviceCatalog.code, code),
            ),
          ),
      );
    await db.batch([
      priceUpdateStatements[0]!,
      ...priceUpdateStatements.slice(1),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "service_prices.updated",
        entityType: "service_catalog",
        entityId: establishmentId,
        requestId,
        metadataJson: JSON.stringify({ updates }),
      }),
    ]);

    return json({
      prices: Object.fromEntries(
        updates.map(({ code, priceCents }) => [code, priceCents]),
      ),
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
