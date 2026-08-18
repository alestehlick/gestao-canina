import { and, eq, inArray, sql } from "drizzle-orm";
import { getD1Database, getDb } from "@/db";
import {
  creditMovements,
  customerAccounts,
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

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner"]);
    const body = await readJsonObject(request);
    const accountId = requiredString(body, "accountId", 80);
    const serviceCode = requiredString(body, "serviceCode", 40);
    const targetUnits = requiredInteger(body, "targetUnits", {
      min: -10_000,
      max: 10_000,
    });
    const reason = requiredString(body, "reason", 500).trim();
    if (!creditServiceCodes.includes(serviceCode as (typeof creditServiceCodes)[number])) {
      throw new HttpError(
        400,
        "service_not_credit_eligible",
        "Escolha um serviço que aceite créditos.",
      );
    }
    const typedServiceCode = serviceCode as (typeof creditServiceCodes)[number];
    if (reason.length < 3) {
      throw new HttpError(
        400,
        "credit_adjustment_reason_required",
        "Informe um motivo breve para o ajuste.",
      );
    }

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [account, service] = await Promise.all([
      db
        .select({ id: customerAccounts.id })
        .from(customerAccounts)
        .where(
          and(
            eq(customerAccounts.id, accountId),
            eq(customerAccounts.establishmentId, establishmentId),
            eq(customerAccounts.status, "active"),
          ),
        )
        .limit(1),
      db
        .select({ id: serviceCatalog.id, name: serviceCatalog.name })
        .from(serviceCatalog)
        .where(
          and(
            eq(serviceCatalog.establishmentId, establishmentId),
            eq(serviceCatalog.code, typedServiceCode),
            eq(serviceCatalog.active, true),
          ),
        )
        .limit(1),
    ]);
    if (!account[0]) {
      throw new HttpError(404, "customer_not_found", "O cliente não foi encontrado.");
    }
    if (!service[0]) {
      throw new HttpError(404, "service_not_found", "O serviço não foi encontrado.");
    }

    const movementId = crypto.randomUUID();
    const nowExpression = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";
    const d1 = getD1Database();
    const results = await d1.batch([
      d1
        .prepare(
          `INSERT INTO credit_movements (
            id, establishment_id, account_id, dog_id, service_catalog_id,
            appointment_item_id, credit_purchase_id, reversed_movement_id,
            movement_type, delta_units, reason, idempotency_key, actor_user_id,
            occurred_at
          )
          SELECT ?, ?, ?, NULL, ?, NULL, NULL, NULL, 'adjust',
            ? - COALESCE((
              SELECT SUM(delta_units) FROM credit_movements
              WHERE establishment_id = ? AND account_id = ? AND service_catalog_id = ?
            ), 0),
            ?, ?, ?, ${nowExpression}
          WHERE ? <> COALESCE((
            SELECT SUM(delta_units) FROM credit_movements
            WHERE establishment_id = ? AND account_id = ? AND service_catalog_id = ?
          ), 0)`,
        )
        .bind(
          movementId,
          establishmentId,
          accountId,
          service[0].id,
          targetUnits,
          establishmentId,
          accountId,
          service[0].id,
          reason,
          crypto.randomUUID(),
          identity.userId,
          targetUnits,
          establishmentId,
          accountId,
          service[0].id,
        ),
      d1
        .prepare(
          `INSERT INTO audit_events (
            id, establishment_id, actor_user_id, actor_role, action,
            entity_type, entity_id, request_id, result, metadata_json, occurred_at
          )
          SELECT ?, ?, ?, ?, 'credit.adjusted', 'credit_movement', ?, ?,
            'success', ?, ${nowExpression}
          WHERE EXISTS (SELECT 1 FROM credit_movements WHERE id = ?)`,
        )
        .bind(
          crypto.randomUUID(),
          establishmentId,
          identity.userId,
          identity.role,
          movementId,
          requestId,
          JSON.stringify({ accountId, serviceCode, targetUnits, reason }),
          movementId,
        ),
    ]);
    if ((results[0].meta.changes ?? 0) !== 1) {
      throw new HttpError(
        409,
        "credit_balance_unchanged",
        "Este saldo já está no valor informado.",
      );
    }

    return json({
      movementId,
      accountId,
      serviceCode,
      serviceName: service[0].name,
      targetUnits,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
