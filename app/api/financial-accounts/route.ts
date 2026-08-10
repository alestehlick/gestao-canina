import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, financialAccounts } from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  optionalString,
  readJsonObject,
  requiredString,
} from "@/lib/server/http";

const kinds = ["checking", "savings", "cash", "other"] as const;
type FinancialAccountKind = (typeof kinds)[number];

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const includeInactive =
      new URL(request.url).searchParams.get("includeInactive") === "true" &&
      identity.role === "owner";
    const establishmentId = identity.establishmentId!;
    const rows = await getDb()
      .select()
      .from(financialAccounts)
      .where(
        includeInactive
          ? eq(financialAccounts.establishmentId, establishmentId)
          : and(
              eq(financialAccounts.establishmentId, establishmentId),
              eq(financialAccounts.active, true),
            ),
      )
      .orderBy(asc(financialAccounts.displayOrder), asc(financialAccounts.name));
    return json({ accounts: rows });
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
    const name = requiredString(body, "name", 80);
    const institution = optionalString(body, "institution", 80);
    const kind = requiredString(body, "kind", 20) as FinancialAccountKind;
    if (!kinds.includes(kind)) {
      throw new HttpError(400, "invalid_financial_account_kind", "Escolha um tipo de conta válido.");
    }
    const id = crypto.randomUUID();
    const establishmentId = identity.establishmentId!;
    const db = getDb();
    try {
      await db.batch([
        db.insert(financialAccounts).values({
          id,
          establishmentId,
          name,
          institution,
          kind,
          active: true,
          createdByUserId: identity.userId,
        }),
        db.insert(auditEvents).values({
          id: crypto.randomUUID(),
          establishmentId,
          actorUserId: identity.userId,
          actorRole: identity.role,
          action: "financial_account.created",
          entityType: "financial_account",
          entityId: id,
          requestId,
          metadataJson: JSON.stringify({ name, institution, kind }),
        }),
      ]);
    } catch (error) {
      if (error instanceof Error && /unique/i.test(error.message)) {
        throw new HttpError(409, "financial_account_duplicate", "Já existe uma conta com este nome.");
      }
      throw error;
    }
    return json({ account: { id, name, institution, kind, active: true } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
