import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  customerAccounts,
  customerRequests,
  dogs,
  serviceCatalog,
} from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import { errorResponse, json } from "@/lib/server/http";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, ["owner", "staff"]);
    const db = getDb();
    const requests = await db
      .select({
        id: customerRequests.id,
        type: customerRequests.type,
        status: customerRequests.status,
        accountId: customerRequests.accountId,
        customerName: customerAccounts.displayName,
        dogId: customerRequests.dogId,
        dogName: dogs.name,
        appointmentId: customerRequests.appointmentId,
        serviceCatalogId: customerRequests.serviceCatalogId,
        serviceName: serviceCatalog.name,
        requestedDate: customerRequests.requestedDate,
        requestedEndDate: customerRequests.requestedEndDate,
        requestedStartTime: customerRequests.requestedStartTime,
        requestedEndTime: customerRequests.requestedEndTime,
        detailsJson: customerRequests.detailsJson,
        notes: customerRequests.notes,
        responseNote: customerRequests.responseNote,
        createdAt: customerRequests.createdAt,
      })
      .from(customerRequests)
      .innerJoin(
        customerAccounts,
        eq(customerAccounts.id, customerRequests.accountId),
      )
      .leftJoin(dogs, eq(dogs.id, customerRequests.dogId))
      .leftJoin(
        serviceCatalog,
        eq(serviceCatalog.id, customerRequests.serviceCatalogId),
      )
      .where(
        and(
          eq(
            customerRequests.establishmentId,
            identity.establishmentId!,
          ),
        ),
      )
      .orderBy(desc(customerRequests.createdAt))
      .limit(250);
    return json({ requests });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
