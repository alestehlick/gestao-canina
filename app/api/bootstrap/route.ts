import { count } from "drizzle-orm";
import { getDb } from "@/db";
import {
  appUsers,
  establishments,
  serviceCatalog,
} from "@/db/schema";
import { requireBootstrapOwner } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
  requiredString,
} from "@/lib/server/http";

const defaultServices = [
  ["daycare", "Creche", "day", 7000, "daycare"],
  ["hotel", "Hospedagem", "night", 18000, "hotel"],
  ["bath", "Banho", "service", 9500, "bath"],
  [
    "hygienic_grooming",
    "Tosa higiênica",
    "service",
    5500,
    "grooming",
  ],
  ["transport", "Transporte", "leg", 3500, "transport"],
  ["other", "Outro", "service", 5000, "other"],
] as const;

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireBootstrapOwner(request);
    const body = await readJsonObject(request);
    const establishmentName = requiredString(body, "establishmentName", 120);
    const db = getDb();
    const [existing] = await db
      .select({ value: count() })
      .from(establishments);
    if ((existing?.value ?? 0) > 0) {
      throw new HttpError(
        409,
        "already_initialized",
        "Este ambiente já foi inicializado.",
      );
    }

    const establishmentId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    await db.batch([
      db.insert(establishments).values({
        id: establishmentId,
        name: establishmentName,
      }),
      db.insert(appUsers).values({
        id: userId,
        establishmentId,
        externalSubject: identity.subject,
        email: identity.email,
        normalizedEmail: identity.email,
        displayName: identity.displayName,
        role: "owner",
      }),
      ...defaultServices.map(([code, name, unit, basePriceCents, colorToken]) =>
        db.insert(serviceCatalog).values({
          id: crypto.randomUUID(),
          establishmentId,
          code,
          name,
          unit,
          basePriceCents,
          colorToken,
        }),
      ),
    ]);

    return json(
      {
        establishment: { id: establishmentId, name: establishmentName },
        owner: { id: userId, email: identity.email },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
