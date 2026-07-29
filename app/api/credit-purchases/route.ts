import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  auditEvents,
  creditPackages,
  creditPurchases,
  customerAccounts,
  invoices,
  serviceCatalog,
  tutors,
} from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  optionalString,
  readJsonObject,
  requiredInteger,
  requiredString,
} from "@/lib/server/http";

const creditServiceCodes = [
  "daycare",
  "bath",
  "hygienic_grooming",
] as const;

type CreditServiceCode = (typeof creditServiceCodes)[number];

function isCreditServiceCode(value: string): value is CreditServiceCode {
  return creditServiceCodes.includes(value as CreditServiceCode);
}

function todayInTimeZone(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function invoiceNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `CRED-${stamp}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, [
      "owner",
      "staff",
      "finance",
    ]);
    const url = new URL(request.url);
    const accountId = url.searchParams.get("accountId");
    const establishmentId = identity.establishmentId!;
    const conditions = [
      eq(creditPurchases.establishmentId, establishmentId),
    ];
    if (accountId) conditions.push(eq(creditPurchases.accountId, accountId));

    const db = getDb();
    const purchases = await db
      .select({
        id: creditPurchases.id,
        accountId: creditPurchases.accountId,
        customerName: customerAccounts.displayName,
        packageId: creditPurchases.packageId,
        packageName: creditPurchases.packageNameSnapshot,
        serviceCatalogId: creditPurchases.serviceCatalogId,
        serviceCode: serviceCatalog.code,
        serviceName: serviceCatalog.name,
        creditUnits: creditPurchases.creditUnits,
        standardValueCents: creditPurchases.standardValueCents,
        amountCents: creditPurchases.amountCents,
        status: creditPurchases.status,
        invoiceId: creditPurchases.invoiceId,
        invoiceNumber: invoices.invoiceNumber,
        invoiceStatus: invoices.status,
        paidAt: creditPurchases.paidAt,
        createdAt: creditPurchases.createdAt,
      })
      .from(creditPurchases)
      .innerJoin(
        customerAccounts,
        eq(customerAccounts.id, creditPurchases.accountId),
      )
      .innerJoin(
        serviceCatalog,
        eq(serviceCatalog.id, creditPurchases.serviceCatalogId),
      )
      .innerJoin(invoices, eq(invoices.id, creditPurchases.invoiceId))
      .where(and(...conditions))
      .orderBy(desc(creditPurchases.createdAt));

    return json({
      purchases: purchases.map((purchase) => ({
        ...purchase,
        savingsCents: Math.max(
          0,
          purchase.standardValueCents - purchase.amountCents,
        ),
      })),
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner", "finance"]);
    const body = await readJsonObject(request);
    const accountId = requiredString(body, "accountId", 80);
    const packageId = optionalString(body, "packageId", 80);
    const dueDateInput = optionalString(body, "dueDate", 10);
    if (dueDateInput && !/^\d{4}-\d{2}-\d{2}$/.test(dueDateInput)) {
      throw new HttpError(
        400,
        "invalid_date",
        "A data de vencimento é inválida.",
      );
    }

    const establishmentId = identity.establishmentId!;
    const db = getDb();
    const [account] = await db
      .select()
      .from(customerAccounts)
      .where(
        and(
          eq(customerAccounts.id, accountId),
          eq(customerAccounts.establishmentId, establishmentId),
          eq(customerAccounts.status, "active"),
        ),
      )
      .limit(1);
    if (!account) {
      throw new HttpError(
        404,
        "customer_not_found",
        "O cliente não foi encontrado.",
      );
    }

    let selectedPackage: typeof creditPackages.$inferSelect | null = null;
    let serviceCode: CreditServiceCode;
    let creditUnits: number;
    let amountCents: number;
    let packageName: string;

    if (packageId) {
      [selectedPackage] = await db
        .select()
        .from(creditPackages)
        .where(
          and(
            eq(creditPackages.id, packageId),
            eq(creditPackages.establishmentId, establishmentId),
            eq(creditPackages.active, true),
          ),
        )
        .limit(1);
      if (!selectedPackage) {
        throw new HttpError(
          404,
          "credit_package_not_found",
          "O pacote de créditos não foi encontrado ou está inativo.",
        );
      }
      const [packageService] = await db
        .select()
        .from(serviceCatalog)
        .where(
          and(
            eq(serviceCatalog.id, selectedPackage.serviceCatalogId),
            eq(serviceCatalog.establishmentId, establishmentId),
            eq(serviceCatalog.active, true),
          ),
        )
        .limit(1);
      if (!packageService || !isCreditServiceCode(packageService.code)) {
        throw new HttpError(
          409,
          "service_not_credit_eligible",
          "O serviço deste pacote não aceita créditos.",
        );
      }
      serviceCode = packageService.code;
      creditUnits =
        body.creditUnits === undefined
          ? selectedPackage.creditUnits
          : requiredInteger(body, "creditUnits", { min: 1, max: 10_000 });
      amountCents =
        body.amountCents === undefined
          ? selectedPackage.packagePriceCents
          : requiredInteger(body, "amountCents", {
              min: 1,
              max: 100_000_000,
            });
      packageName =
        optionalString(body, "packageName", 120) ?? selectedPackage.name;
    } else {
      const rawServiceCode = requiredString(body, "serviceCode", 40);
      if (!isCreditServiceCode(rawServiceCode)) {
        throw new HttpError(
          400,
          "service_not_credit_eligible",
          "Créditos podem ser vendidos somente para creche, banho ou tosa higiênica.",
        );
      }
      serviceCode = rawServiceCode;
      creditUnits = requiredInteger(body, "creditUnits", {
        min: 1,
        max: 10_000,
      });
      amountCents = requiredInteger(body, "amountCents", {
        min: 1,
        max: 100_000_000,
      });
      packageName =
        optionalString(body, "packageName", 120) ??
        `Pacote de ${creditUnits} créditos`;
    }

    const [service] = await db
      .select()
      .from(serviceCatalog)
      .where(
        and(
          eq(serviceCatalog.establishmentId, establishmentId),
          eq(serviceCatalog.code, serviceCode),
          eq(serviceCatalog.active, true),
        ),
      )
      .limit(1);
    if (!service) {
      throw new HttpError(
        404,
        "service_not_found",
        "O serviço selecionado não foi encontrado.",
      );
    }
    if (service.basePriceCents < 1) {
      throw new HttpError(
        409,
        "default_price_required",
        "Defina um preço padrão maior que zero para este serviço antes de vender créditos.",
      );
    }

    const [financialContact] = await db
      .select({ email: tutors.email })
      .from(tutors)
      .where(
        and(
          eq(tutors.accountId, accountId),
          eq(tutors.status, "active"),
          eq(tutors.isFinancialContact, true),
        ),
      )
      .orderBy(desc(tutors.createdAt))
      .limit(1);

    const purchaseId = crypto.randomUUID();
    const invoiceId = crypto.randomUUID();
    const number = invoiceNumber();
    const dueDate =
      dueDateInput ?? todayInTimeZone("America/Sao_Paulo");
    const standardValueCents = service.basePriceCents * creditUnits;
    await db.batch([
      db.insert(invoices).values({
        id: invoiceId,
        establishmentId,
        accountId,
        invoiceNumber: number,
        recipientNameSnapshot: account.displayName,
        recipientEmailSnapshot: financialContact?.email ?? null,
        status: "issued",
        issuedAt: new Date().toISOString(),
        dueDate,
        totalCents: amountCents,
        sourceType: "credit_package",
        sourceId: purchaseId,
        createdByUserId: identity.userId,
      }),
      db.insert(creditPurchases).values({
        id: purchaseId,
        establishmentId,
        accountId,
        packageId: selectedPackage?.id ?? null,
        serviceCatalogId: service.id,
        invoiceId,
        packageNameSnapshot: packageName,
        creditUnits,
        standardValueCents,
        amountCents,
        createdByUserId: identity.userId,
      }),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "credit_purchase.created",
        entityType: "credit_purchase",
        entityId: purchaseId,
        requestId,
        metadataJson: JSON.stringify({
          accountId,
          packageId: selectedPackage?.id ?? null,
          serviceCode: service.code,
          creditUnits,
          standardValueCents,
          amountCents,
          invoiceId,
        }),
      }),
    ]);

    return json(
      {
        purchase: {
          id: purchaseId,
          accountId,
          customerName: account.displayName,
          packageId: selectedPackage?.id ?? null,
          packageName,
          serviceCatalogId: service.id,
          serviceCode: service.code,
          serviceName: service.name,
          creditUnits,
          standardValueCents,
          amountCents,
          savingsCents: Math.max(0, standardValueCents - amountCents),
          status: "awaiting_payment",
        },
        invoice: {
          id: invoiceId,
          invoiceNumber: number,
          status: "issued",
          dueDate,
          totalCents: amountCents,
        },
        nextAction: {
          method: "pix",
          createChargeAt: "/api/pix/charges",
          body: { invoiceId },
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
