import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, tasks } from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
  requiredString,
} from "@/lib/server/http";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "staff"]);
    const { id } = await context.params;
    if (!id || id.length > 80) {
      throw new HttpError(
        400,
        "invalid_task_id",
        "A tarefa informada é inválida.",
      );
    }

    const body = await readJsonObject(request);
    const status = requiredString(body, "status", 20);
    if (status !== "open" && status !== "completed") {
      throw new HttpError(
        400,
        "invalid_status",
        "Escolha concluir ou reabrir a tarefa.",
      );
    }

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [task] = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.id, id),
          eq(tasks.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (!task) {
      throw new HttpError(
        404,
        "task_not_found",
        "A tarefa não foi encontrada.",
      );
    }
    if (task.status === "cancelled") {
      throw new HttpError(
        409,
        "task_cancelled",
        "Uma tarefa cancelada não pode ser reaberta por esta ação.",
      );
    }
    if (task.status === status) {
      return json({ task, idempotent: true });
    }

    const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
    await db.batch([
      db
        .update(tasks)
        .set({
          status,
          completedAt: status === "completed" ? now : null,
          updatedAt: now,
        })
        .where(
          and(
            eq(tasks.id, id),
            eq(tasks.establishmentId, establishmentId),
            eq(tasks.status, task.status),
          ),
        ),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action:
          status === "completed"
            ? "task.completed"
            : "task.reopened",
        entityType: "task",
        entityId: id,
        requestId,
        metadataJson: JSON.stringify({
          previousStatus: task.status,
          status,
        }),
      }),
    ]);

    const [updatedTask] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id))
      .limit(1);
    return json({ task: updatedTask, idempotent: false });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
