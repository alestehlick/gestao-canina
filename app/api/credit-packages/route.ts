import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  auditEvents,
  creditPackages,
  serviceCatalog,
} from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
  requiredInteger,
  requiredString,
} from "@/lib/server/http";

const creditServiceCodes = [
  "daycare",
  "bath",
  "bath_grooming",
  "taxi_dog",
] as const;

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, [
      "owner",
      "staff",
      "finance",
    ]);
    const includeInactive =
      new URL(request.url).searchParams.get("includeInactive") === "true" &&
      identity.role !== "staff";
    const conditions = [
      eq(creditPackages.establishmentId, identity.establishmentId!),
    ];
    if (!includeInactive) conditions.push(eq(creditPackages.active, true));

    const db = getDb();
    const packages = await db
      .select({
        id: creditPackages.id,
        name: creditPackages.name,
        serviceCatalogId: serviceCatalog.id,
        serviceCode: serviceCatalog.code,
        serviceName: serviceCatalog.name,
        creditUnits: creditPackages.creditUnits,
        packagePriceCents: creditPackages.packagePriceCents,
        basePriceCents: serviceCatalog.basePriceCents,
        active: creditPackages.active,
        updatedAt: creditPackages.updatedAt,
      })
      .from(creditPackages)
      .innerJoin(
        serviceCatalog,
        eq(serviceCatalog.id, creditPackages.serviceCatalogId),
      )
      .where(and(...conditions))
      .orderBy(asc(serviceCatalog.name), asc(creditPackages.creditUnits));

    return json({
      packages: packages.map((item) => {
        const standardValueCents = item.basePriceCents * item.creditUnits;
        return {
          ...item,
          standardValueCents,
          savingsCents: Math.max(
            0,
            standardValueCents - item.packagePriceCents,
          ),
        };
      }),
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const body = await readJsonObject(request);
    const name = requiredString(body, "name", 120);
    const serviceCode = requiredString(body, "serviceCode", 40);
    const creditUnits = requiredInteger(body, "creditUnits", {
      min: 1,
      max: 10_000,
    });
    const packagePriceCents = requiredInteger(body, "packagePriceCents", {
      min: 1,
      max: 100_000_000,
    });
    if (
      !creditServiceCodes.includes(
        serviceCode as (typeof creditServiceCodes)[number],
      )
    ) {
      throw new HttpError(
        400,
        "service_not_credit_eligible",
        "Créditos podem ser criados somente para creche, banho e tosa ou Taxi-dog.",
      );
    }

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [service] = await db
      .select()
      .from(serviceCatalog)
      .where(
        and(
          eq(serviceCatalog.establishmentId, establishmentId),
          eq(
            serviceCatalog.code,
            serviceCode as (typeof creditServiceCodes)[number],
          ),
          eq(serviceCatalog.active, true),
        ),
      )
      .limit(1);
    if (!service) {
      throw new HttpError(
        404,
        "service_not_found",
        "O serviço selecionado não foi encontrado.",
      );
    }

    const id = crypto.randomUUID();
    await db.batch([
      db.insert(creditPackages).values({
        id,
        establishmentId,
        serviceCatalogId: service.id,
        name,
        creditUnits,
        packagePriceCents,
        createdByUserId: identity.userId,
      }),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "credit_package.created",
        entityType: "credit_package",
        entityId: id,
        requestId,
        metadataJson: JSON.stringify({
          serviceCode: service.code,
          creditUnits,
          packagePriceCents,
        }),
      }),
    ]);

    const standardValueCents = service.basePriceCents * creditUnits;
    return json(
      {
        package: {
          id,
          name,
          serviceCatalogId: service.id,
          serviceCode: service.code,
          serviceName: service.name,
          creditUnits,
          packagePriceCents,
          standardValueCents,
          savingsCents: Math.max(0, standardValueCents - packagePriceCents),
          active: true,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
