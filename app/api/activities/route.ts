import { getDb } from "@/db";
import { establishments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireIdentity } from "@/lib/server/auth";
import { loadAuditLog } from "@/lib/server/audit-log";
import { errorResponse, HttpError, json } from "@/lib/server/http";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) /
      86_400_000,
  );
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, ["owner"]);
    const url = new URL(request.url);
    const from = url.searchParams.get("from") ?? "";
    const to = url.searchParams.get("to") ?? "";
    const rangeDays = daysBetween(from, to);
    if (
      !isoDatePattern.test(from) ||
      !isoDatePattern.test(to) ||
      !Number.isFinite(rangeDays) ||
      rangeDays < 0 ||
      rangeDays > 365
    ) {
      throw new HttpError(
        400,
        "invalid_activity_period",
        "Escolha um período válido de até 366 dias.",
      );
    }

    const establishmentId = identity.establishmentId!;
    const [establishment] = await getDb()
      .select({ id: establishments.id })
      .from(establishments)
      .where(eq(establishments.id, establishmentId))
      .limit(1);
    if (!establishment) {
      throw new HttpError(404, "establishment_not_found", "A unidade não foi encontrada.");
    }

    const activities = await loadAuditLog(establishmentId, from, to, 1_000);
    return json({ activities, from, to, truncated: activities.length === 1_000 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
