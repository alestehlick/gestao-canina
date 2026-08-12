import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, cashEntries, privateFiles } from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import { getRuntimeBindings } from "@/lib/server/runtime";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
} from "@/lib/server/http";

const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

async function cashEntry(
  establishmentId: string,
  id: string,
) {
  return (
    await getDb()
      .select({ id: cashEntries.id })
      .from(cashEntries)
      .where(
        and(
          eq(cashEntries.id, id),
          eq(cashEntries.establishmentId, establishmentId),
        ),
      )
      .limit(1)
  )[0];
}

async function receiptFile(establishmentId: string, ownerId: string) {
  return (
    await getDb()
      .select()
      .from(privateFiles)
      .where(
        and(
          eq(privateFiles.establishmentId, establishmentId),
          eq(privateFiles.ownerType, "cash_entry"),
          eq(privateFiles.ownerId, ownerId),
          eq(privateFiles.status, "ready"),
        ),
      )
      .limit(1)
  )[0];
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const { id } = await context.params;
    const establishmentId = identity.establishmentId!;
    if (!(await cashEntry(establishmentId, id))) {
      throw new HttpError(404, "cash_entry_not_found", "O lançamento não foi encontrado.");
    }
    const file = await receiptFile(establishmentId, id);
    if (!file) throw new HttpError(404, "cash_receipt_not_found", "O comprovante não foi encontrado.");
    const object = await getRuntimeBindings().FILES?.get(file.objectKey);
    if (!object) throw new HttpError(404, "cash_receipt_not_found", "O comprovante não foi encontrado.");
    return new Response(object.body, {
      headers: {
        "content-type": file.contentType,
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  let newObjectKey: string | null = null;
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const { id } = await context.params;
    const establishmentId = identity.establishmentId!;
    if (!(await cashEntry(establishmentId, id))) {
      throw new HttpError(404, "cash_entry_not_found", "O lançamento não foi encontrado.");
    }
    const file = (await request.formData()).get("receipt");
    if (
      !(file instanceof File) ||
      !file.size ||
      file.size > 8_000_000 ||
      !allowedTypes.has(file.type)
    ) {
      throw new HttpError(
        400,
        "invalid_cash_receipt",
        "Envie uma imagem ou PDF de até 8 MB.",
      );
    }
    const storage = getRuntimeBindings().FILES;
    if (!storage) {
      throw new HttpError(503, "cash_receipt_storage_unavailable", "O armazenamento de comprovantes não está disponível.");
    }
    const bytes = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    newObjectKey = `cash/${establishmentId}/${id}/${crypto.randomUUID()}`;
    await storage.put(newObjectKey, bytes, {
      httpMetadata: { contentType: file.type },
    });
    const existing = await receiptFile(establishmentId, id);
    const fileId = crypto.randomUUID();
    const now = new Date().toISOString();
    const db = getDb();
    const insertFile = db.insert(privateFiles).values({
      id: fileId,
      establishmentId,
      ownerType: "cash_entry",
      ownerId: id,
      objectKey: newObjectKey,
      originalName: file.name.slice(0, 180) || "comprovante",
      contentType: file.type,
      sizeBytes: file.size,
      sha256,
      visibility: "staff",
      status: "ready",
      createdByUserId: identity.userId,
      createdAt: now,
      updatedAt: now,
    });
    const insertAudit = db.insert(auditEvents).values({
      id: crypto.randomUUID(),
      establishmentId,
      actorUserId: identity.userId,
      actorRole: identity.role,
      action: existing ? "cash.receipt_replaced" : "cash.receipt_attached",
      entityType: "cash_entry",
      entityId: id,
      requestId,
      result: "success",
      metadataJson: JSON.stringify({
        originalName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      }),
    });
    if (existing) {
      await db.batch([
        db
          .delete(privateFiles)
          .where(
            and(
              eq(privateFiles.id, existing.id),
              eq(privateFiles.establishmentId, establishmentId),
            ),
          ),
        insertFile,
        insertAudit,
      ]);
    } else {
      await db.batch([insertFile, insertAudit]);
    }
    if (existing) await storage.delete(existing.objectKey);
    return json(
      {
        receipt: {
          id: fileId,
          name: file.name,
          contentType: file.type,
          url: `/api/cash/${id}/receipt`,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (newObjectKey) {
      await getRuntimeBindings().FILES?.delete(newObjectKey).catch(() => undefined);
    }
    return errorResponse(error, requestId);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const { id } = await context.params;
    const establishmentId = identity.establishmentId!;
    const file = await receiptFile(establishmentId, id);
    if (!file) return json({ removed: false, idempotent: true });
    const db = getDb();
    await db.batch([
      db
        .delete(privateFiles)
        .where(
          and(
            eq(privateFiles.id, file.id),
            eq(privateFiles.establishmentId, establishmentId),
          ),
        ),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "cash.receipt_removed",
        entityType: "cash_entry",
        entityId: id,
        requestId,
        result: "success",
        metadataJson: JSON.stringify({ originalName: file.originalName }),
      }),
    ]);
    await getRuntimeBindings().FILES?.delete(file.objectKey);
    return json({ removed: true });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
