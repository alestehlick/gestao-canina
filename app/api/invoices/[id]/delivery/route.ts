import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, invoices } from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
} from "@/lib/server/http";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const { id } = await context.params;
    const body = await readJsonObject(request);
    const channel = body.channel;
    if (channel !== "whatsapp" && channel !== "email") {
      throw new HttpError(
        400,
        "invalid_delivery_channel",
        "Informe WhatsApp ou e-mail como canal de envio.",
      );
    }

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [invoice] = await db
      .select({
        id: invoices.id,
        status: invoices.status,
        deliveryChannelsJson: invoices.deliveryChannelsJson,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.id, id),
          eq(invoices.establishmentId, establishmentId),
        ),
      )
      .limit(1);
    if (!invoice || invoice.status === "void") {
      throw new HttpError(404, "invoice_not_found", "A fatura não foi encontrada.");
    }

    let previousChannels: unknown = [];
    try {
      previousChannels = JSON.parse(invoice.deliveryChannelsJson);
    } catch {
      previousChannels = [];
    }
    const channels = [
      ...new Set([
        ...(Array.isArray(previousChannels)
          ? previousChannels.filter(
              (item): item is "whatsapp" | "email" =>
                item === "whatsapp" || item === "email",
            )
          : []),
        channel,
      ]),
    ];
    const sentAt = new Date().toISOString();

    await db.batch([
      db
        .update(invoices)
        .set({
          deliveryChannelsJson: JSON.stringify(channels),
          lastSentAt: sentAt,
          updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        })
        .where(
          and(
            eq(invoices.id, id),
            eq(invoices.establishmentId, establishmentId),
          ),
        ),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "invoice.sent",
        entityType: "invoice",
        entityId: id,
        requestId,
        metadataJson: JSON.stringify({ channel }),
      }),
    ]);

    return json({ invoice: { id, sentBy: channels, lastSentAt: sentAt } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
