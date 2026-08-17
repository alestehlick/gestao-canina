import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { creditReceipts } from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  errorResponse,
  HttpError,
  json,
} from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const accountId = new URL(request.url).searchParams.get("accountId");
    if (accountId && accountId.length > 80) {
      throw new HttpError(
        400,
        "invalid_account_id",
        "O cliente informado é inválido.",
      );
    }
    const conditions = [
      eq(creditReceipts.establishmentId, identity.establishmentId!),
    ];
    if (accountId) conditions.push(eq(creditReceipts.accountId, accountId));

    const db = getDb();
    const receipts = await db
      .select()
      .from(creditReceipts)
      .where(and(...conditions))
      .orderBy(desc(creditReceipts.issuedAt));
    return json({
      receipts: receipts.map((receipt) => ({
        ...receipt,
        deliveryChannels: JSON.parse(receipt.deliveryChannelsJson) as unknown,
      })),
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
