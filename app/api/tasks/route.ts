import { getDb } from "@/db";
import { auditEvents, tasks } from "@/db/schema";
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

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "staff"]);
    const body = await readJsonObject(request);
    const title = requiredString(body, "title", 180);
    const description = optionalString(body, "description", 2_000);
    const scheduledDate = optionalString(body, "scheduledDate", 10);
    const scheduledTime = optionalString(body, "scheduledTime", 5);
    const priority = body.priority === "high" ? "high" : body.priority === "low" ? "low" : "normal";
    if (scheduledDate && !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
      throw new HttpError(400, "invalid_date", "A data informada é inválida.");
    }
    if (scheduledTime && !/^\d{2}:\d{2}$/.test(scheduledTime)) {
      throw new HttpError(400, "invalid_time", "O horário informado é inválido.");
    }

    const id = crypto.randomUUID();
    const establishmentId = identity.establishmentId!;
    const db = getDb();
    await db.batch([
      db.insert(tasks).values({
        id,
        establishmentId,
        title,
        description,
        scheduledDate,
        scheduledTime,
        priority,
        assignedUserId: identity.userId,
      }),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "task.created",
        entityType: "task",
        entityId: id,
        requestId,
      }),
    ]);

    return json({ task: { id, title, scheduledDate, scheduledTime, priority } }, { status: 201 });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
