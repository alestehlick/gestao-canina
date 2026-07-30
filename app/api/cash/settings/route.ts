import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, establishments } from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  json,
  readJsonObject,
  requiredInteger,
} from "@/lib/server/http";

export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner"]);
    const body = await readJsonObject(request);
    const monthStartDay = requiredInteger(body, "monthStartDay", {
      min: 1,
      max: 28,
    });
    const establishmentId = identity.establishmentId!;
    const now = new Date().toISOString();
    const db = getDb();

    await db.batch([
      db
        .update(establishments)
        .set({ cashMonthStartDay: monthStartDay, updatedAt: now })
        .where(eq(establishments.id, establishmentId)),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "cash.settings_updated",
        entityType: "establishment",
        entityId: establishmentId,
        requestId,
        result: "success",
        metadataJson: JSON.stringify({ monthStartDay }),
      }),
    ]);

    return json({ settings: { monthStartDay } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
