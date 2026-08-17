import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, creditReceipts } from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
} from "@/lib/server/http";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const { id } = await context.params;
    if (!id || id.length > 80) {
      throw new HttpError(
        400,
        "invalid_receipt_id",
        "O recibo informado é inválido.",
      );
    }
    const body = await readJsonObject(request);
    const deliveryStatus = body.deliveryStatus;
    if (deliveryStatus !== "sent" && deliveryStatus !== "failed") {
      throw new HttpError(
        400,
        "invalid_delivery_status",
        "Informe se o recibo foi enviado ou se o envio falhou.",
      );
    }
    const rawChannels = body.channels;
    if (
      !Array.isArray(rawChannels) ||
      rawChannels.length === 0 ||
      rawChannels.some(
        (channel) => channel !== "email" && channel !== "whatsapp",
      )
    ) {
      throw new HttpError(
        400,
        "invalid_delivery_channels",
        "Informe email e/ou WhatsApp como canal do recibo.",
      );
    }
    const channels = [...new Set(rawChannels as ("email" | "whatsapp")[])];

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [existing] = await db
      .select({ id: creditReceipts.id })
      .from(creditReceipts)
      .where(
        and(
          eq(creditReceipts.id, id),
          eq(creditReceipts.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new HttpError(
        404,
        "credit_receipt_not_found",
        "O recibo não foi encontrado.",
      );
    }

    const now = new Date().toISOString();
    await db.batch([
      db
        .update(creditReceipts)
        .set({
          deliveryStatus,
          deliveryChannelsJson: JSON.stringify(channels),
          sentAt: deliveryStatus === "sent" ? now : null,
          updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        })
        .where(
          and(
            eq(creditReceipts.id, id),
            eq(creditReceipts.establishmentId, establishmentId),
          ),
        ),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: `credit_receipt.${deliveryStatus}`,
        entityType: "credit_receipt",
        entityId: id,
        requestId,
        metadataJson: JSON.stringify({ channels }),
      }),
    ]);

    return json({
      receipt: {
        id,
        deliveryStatus,
        deliveryChannels: channels,
        sentAt: deliveryStatus === "sent" ? now : null,
      },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
