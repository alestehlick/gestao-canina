import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, cashPeriods } from "@/db/schema";
import { isIsoDate, todayInSaoPaulo } from "@/lib/server/cash";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  optionalString,
  readJsonObject,
  requiredInteger,
  requiredString,
} from "@/lib/server/http";

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner"]);
    const body = await readJsonObject(request);
    const action = requiredString(body, "action", 20);
    if (action !== "close" && action !== "reopen") {
      throw new HttpError(400, "invalid_cash_period_action", "A ação solicitada é inválida.");
    }
    const periodStart = requiredString(body, "periodStart", 10);
    const periodEnd = requiredString(body, "periodEnd", 10);
    if (!isIsoDate(periodStart) || !isIsoDate(periodEnd) || periodEnd < periodStart) {
      throw new HttpError(400, "invalid_cash_period", "O período financeiro é inválido.");
    }
    const expectedEnd = new Date(`${periodStart}T00:00:00.000Z`);
    expectedEnd.setUTCMonth(expectedEnd.getUTCMonth() + 1);
    expectedEnd.setUTCDate(expectedEnd.getUTCDate() - 1);
    if (expectedEnd.toISOString().slice(0, 10) !== periodEnd) {
      throw new HttpError(400, "invalid_cash_period", "O intervalo não corresponde a um mês financeiro completo.");
    }
    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [existing] = await db
      .select()
      .from(cashPeriods)
      .where(
        and(
          eq(cashPeriods.establishmentId, establishmentId),
          eq(cashPeriods.periodStart, periodStart),
          eq(cashPeriods.periodEnd, periodEnd),
        ),
      )
      .limit(1);
    const now = new Date().toISOString();
    if (action === "close") {
      if (periodEnd > todayInSaoPaulo()) {
        throw new HttpError(409, "cash_period_in_progress", "Este período ainda não terminou e não pode ser fechado.");
      }
      const closeNote = optionalString(body, "note", 500);
      if (existing?.status === "closed") {
        return json({ period: existing, idempotent: true });
      }
      const id = existing?.id ?? crypto.randomUUID();
      if (existing) {
        const expectedVersion = requiredInteger(body, "expectedVersion", { min: 1 });
        const result = await db
          .update(cashPeriods)
          .set({
            status: "closed",
            closeNote,
            closedByUserId: identity.userId,
            closedAt: now,
            reopenedByUserId: null,
            reopenedAt: null,
            reopenReason: null,
            updatedAt: now,
            version: expectedVersion + 1,
          })
          .where(
            and(
              eq(cashPeriods.id, id),
              eq(cashPeriods.establishmentId, establishmentId),
              eq(cashPeriods.version, expectedVersion),
              eq(cashPeriods.status, "open"),
            ),
          );
        if ((result.meta.changes ?? 0) !== 1) {
          throw new HttpError(409, "cash_period_conflict", "O período foi alterado. Atualize e tente novamente.");
        }
      } else {
        await db.insert(cashPeriods).values({
          id,
          establishmentId,
          periodStart,
          periodEnd,
          status: "closed",
          closeNote,
          closedByUserId: identity.userId,
          closedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
      await db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "cash.period_closed",
        entityType: "cash_period",
        entityId: id,
        requestId,
        result: "success",
        metadataJson: JSON.stringify({ periodStart, periodEnd, closeNote }),
      });
      return json({ period: { id, periodStart, periodEnd, status: "closed", version: (existing?.version ?? 0) + 1 } });
    }

    if (!existing || existing.status !== "closed") {
      throw new HttpError(409, "cash_period_not_closed", "Este período não está fechado.");
    }
    const expectedVersion = requiredInteger(body, "expectedVersion", { min: 1 });
    const reason = requiredString(body, "reason", 500);
    const result = await db
      .update(cashPeriods)
      .set({
        status: "open",
        reopenedByUserId: identity.userId,
        reopenedAt: now,
        reopenReason: reason,
        updatedAt: now,
        version: expectedVersion + 1,
      })
      .where(
        and(
          eq(cashPeriods.id, existing.id),
          eq(cashPeriods.establishmentId, establishmentId),
          eq(cashPeriods.version, expectedVersion),
          eq(cashPeriods.status, "closed"),
        ),
      );
    if ((result.meta.changes ?? 0) !== 1) {
      throw new HttpError(409, "cash_period_conflict", "O período foi alterado. Atualize e tente novamente.");
    }
    await db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      establishmentId,
      actorUserId: identity.userId,
      actorRole: identity.role,
      action: "cash.period_reopened",
      entityType: "cash_period",
      entityId: existing.id,
      requestId,
      reason,
      result: "success",
      metadataJson: JSON.stringify({ periodStart, periodEnd }),
    });
    return json({
      period: {
        id: existing.id,
        periodStart,
        periodEnd,
        status: "open",
        version: expectedVersion + 1,
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
