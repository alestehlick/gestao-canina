import { and, between, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  auditEvents,
  cashEntries,
  establishments,
  invoicePayments,
  invoices,
} from "@/db/schema";
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

export const dynamic = "force-dynamic";

const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const directions = new Set(["inflow", "outflow"]);

function validIsoDate(value: string) {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function periodFor(anchorMonth: string, startDay: number) {
  const [year, month] = anchorMonth.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, startDay));
  const nextStart = new Date(Date.UTC(year, month, startDay));
  const end = new Date(nextStart);
  end.setUTCDate(end.getUTCDate() - 1);
  return { start: isoDate(start), end: isoDate(end) };
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, ["owner"]);
    const establishmentId = identity.establishmentId!;
    const anchorMonth =
      new URL(request.url).searchParams.get("month") ??
      new Date().toISOString().slice(0, 7);
    if (!monthPattern.test(anchorMonth)) {
      throw new HttpError(
        400,
        "invalid_cash_month",
        "O mês selecionado é inválido.",
      );
    }

    const db = getDb();
    const [establishment] = await db
      .select({
        monthStartDay: establishments.cashMonthStartDay,
      })
      .from(establishments)
      .where(eq(establishments.id, establishmentId))
      .limit(1);
    if (!establishment) {
      throw new HttpError(
        404,
        "establishment_not_found",
        "A unidade não foi encontrada.",
      );
    }
    const monthStartDay = Math.min(
      28,
      Math.max(1, establishment.monthStartDay),
    );
    const period = periodFor(anchorMonth, monthStartDay);
    const entries = await db
      .select({
        id: cashEntries.id,
        direction: cashEntries.direction,
        origin: cashEntries.origin,
        sourcePaymentId: cashEntries.sourcePaymentId,
        occurredOn: cashEntries.occurredOn,
        amountCents: cashEntries.amountCents,
        category: cashEntries.category,
        description: cashEntries.description,
        note: cashEntries.note,
        status: cashEntries.status,
        exclusionReason: cashEntries.exclusionReason,
        invoiceId: invoicePayments.invoiceId,
        invoiceNumber: invoices.invoiceNumber,
        customerName: invoices.recipientNameSnapshot,
        createdAt: cashEntries.createdAt,
        updatedAt: cashEntries.updatedAt,
      })
      .from(cashEntries)
      .leftJoin(
        invoicePayments,
        eq(invoicePayments.id, cashEntries.sourcePaymentId),
      )
      .leftJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
      .where(
        and(
          eq(cashEntries.establishmentId, establishmentId),
          between(cashEntries.occurredOn, period.start, period.end),
        ),
      )
      .orderBy(desc(cashEntries.occurredOn), desc(cashEntries.createdAt))
      .limit(1_000);

    const included = entries.filter((entry) => entry.status === "included");
    const inflowCents = included
      .filter((entry) => entry.direction === "inflow")
      .reduce((total, entry) => total + entry.amountCents, 0);
    const outflowCents = included
      .filter((entry) => entry.direction === "outflow")
      .reduce((total, entry) => total + entry.amountCents, 0);

    return json({
      anchorMonth,
      monthStartDay,
      period,
      totals: {
        inflowCents,
        outflowCents,
        balanceCents: inflowCents - outflowCents,
        excludedCount: entries.length - included.length,
      },
      entries,
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
    const direction = requiredString(body, "direction", 20);
    if (!directions.has(direction)) {
      throw new HttpError(
        400,
        "invalid_cash_direction",
        "Escolha entrada ou saída.",
      );
    }
    const occurredOn = requiredString(body, "occurredOn", 10);
    if (!validIsoDate(occurredOn)) {
      throw new HttpError(
        400,
        "invalid_cash_date",
        "A data do lançamento é inválida.",
      );
    }
    const amountCents = requiredInteger(body, "amountCents", {
      min: 1,
      max: 100_000_000_00,
    });
    const category = requiredString(body, "category", 60);
    const description = requiredString(body, "description", 160);
    const note = optionalString(body, "note", 500);
    const id = crypto.randomUUID();
    const establishmentId = identity.establishmentId!;
    const db = getDb();

    await db.batch([
      db.insert(cashEntries).values({
        id,
        establishmentId,
        direction: direction as "inflow" | "outflow",
        origin: "manual",
        occurredOn,
        amountCents,
        category,
        description,
        note,
        status: "included",
        createdByUserId: identity.userId,
        updatedByUserId: identity.userId,
      }),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "cash.entry_created",
        entityType: "cash_entry",
        entityId: id,
        requestId,
        result: "success",
        metadataJson: JSON.stringify({
          direction,
          occurredOn,
          amountCents,
          category,
        }),
      }),
    ]);

    return json(
      {
        entry: {
          id,
          direction,
          origin: "manual",
          occurredOn,
          amountCents,
          category,
          description,
          note,
          status: "included",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
