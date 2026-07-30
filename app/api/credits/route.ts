import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  creditMovements,
  customerAccounts,
  serviceCatalog,
} from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  errorResponse,
  HttpError,
  json,
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
    const accountId = new URL(request.url).searchParams.get("accountId");
    if (!accountId || accountId.length > 80) {
      throw new HttpError(
        400,
        "invalid_account_id",
        "Informe o cliente para consultar os créditos.",
      );
    }

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

    const services = await db
      .select({
        serviceCatalogId: serviceCatalog.id,
        serviceCode: serviceCatalog.code,
        serviceName: serviceCatalog.name,
        basePriceCents: serviceCatalog.basePriceCents,
      })
      .from(serviceCatalog)
      .where(
        and(
          eq(serviceCatalog.establishmentId, establishmentId),
          inArray(serviceCatalog.code, creditServiceCodes),
          eq(serviceCatalog.active, true),
        ),
      );
    const movements = await db
      .select({
        serviceCatalogId: creditMovements.serviceCatalogId,
        balance: sql<number>`coalesce(sum(${creditMovements.deltaUnits}), 0)`,
      })
      .from(creditMovements)
      .where(
        and(
          eq(creditMovements.establishmentId, establishmentId),
          eq(creditMovements.accountId, accountId),
        ),
      )
      .groupBy(creditMovements.serviceCatalogId);
    const balanceByService = new Map(
      movements.map((movement) => [
        movement.serviceCatalogId,
        Number(movement.balance),
      ]),
    );

    return json({
      account,
      balances: services.map((service) => ({
        ...service,
        availableUnits:
          balanceByService.get(service.serviceCatalogId) ?? 0,
      })),
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
