import { and, asc, count, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  appointmentItems,
  appointments,
  customerAccounts,
  dogs,
  invoices,
  tasks,
} from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import { errorResponse, HttpError, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, [
      "owner",
      "staff",
      "finance",
    ]);
    const date = new URL(request.url).searchParams.get("date");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new HttpError(
        400,
        "invalid_date",
        "Informe a data no formato YYYY-MM-DD.",
      );
    }
    const establishmentId = identity.establishmentId!;
    const db = getDb();

    const [schedule, openTasks, openInvoices, customerCount] =
      await Promise.all([
        db
          .select({
            id: appointments.id,
            startTime: appointments.startTime,
            endTime: appointments.endTime,
            status: appointments.status,
            dogId: dogs.id,
            dogName: dogs.name,
            accountId: customerAccounts.id,
            customerName: customerAccounts.displayName,
            serviceName: appointmentItems.serviceNameSnapshot,
            priceCents: appointmentItems.totalCents,
          })
          .from(appointments)
          .innerJoin(dogs, eq(dogs.id, appointments.dogId))
          .innerJoin(
            customerAccounts,
            eq(customerAccounts.id, appointments.accountId),
          )
          .leftJoin(
            appointmentItems,
            eq(appointmentItems.appointmentId, appointments.id),
          )
          .where(
            and(
              eq(appointments.establishmentId, establishmentId),
              eq(appointments.startDate, date),
            ),
          )
          .orderBy(asc(appointments.startTime)),
        db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.establishmentId, establishmentId),
              eq(tasks.status, "open"),
            ),
          )
          .orderBy(asc(tasks.scheduledTime)),
        db
          .select()
          .from(invoices)
          .where(
            and(
              eq(invoices.establishmentId, establishmentId),
              inArray(invoices.status, ["issued", "draft"]),
            ),
          )
          .orderBy(asc(invoices.dueDate)),
        db
          .select({ value: count() })
          .from(customerAccounts)
          .where(
            and(
              eq(customerAccounts.establishmentId, establishmentId),
              eq(customerAccounts.status, "active"),
            ),
          ),
      ]);

    return json({
      date,
      schedule,
      tasks: openTasks,
      invoices: openInvoices,
      counts: { customers: customerCount[0]?.value ?? 0 },
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
