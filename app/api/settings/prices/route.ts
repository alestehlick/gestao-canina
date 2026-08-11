import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditEvents, establishments, serviceCatalog } from "@/db/schema";
import { requireIdentity } from "@/lib/server/auth";
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  readJsonObject,
} from "@/lib/server/http";
import {
  creditPricingFromEstablishment,
  type CreditPricingSettings,
} from "@/lib/credit-pricing";

const editableServiceCodes = [
  "hotel",
  "daycare",
  "bath",
  "bath_grooming",
  "taxi_dog",
] as const;

type EditableServiceCode = (typeof editableServiceCodes)[number];

function isEditableServiceCode(value: string): value is EditableServiceCode {
  return editableServiceCodes.includes(value as EditableServiceCode);
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const identity = await requireIdentity(request, ["owner"]);
    const db = getDb();
    const services = await db
      .select({
        id: serviceCatalog.id,
        code: serviceCatalog.code,
        name: serviceCatalog.name,
        unit: serviceCatalog.unit,
        priceCents: serviceCatalog.basePriceCents,
        updatedAt: serviceCatalog.updatedAt,
      })
      .from(serviceCatalog)
      .where(
        and(
          eq(serviceCatalog.establishmentId, identity.establishmentId!),
          inArray(serviceCatalog.code, editableServiceCodes),
        ),
      )
      .orderBy(asc(serviceCatalog.name));
    const [establishment] = await db
      .select({
        daycareStartTime: establishments.daycareStartTime,
        daycareEndTime: establishments.daycareEndTime,
        hotelStandardDailyRateCents: establishments.hotelStandardDailyRateCents,
        hotelDaycareDailyRateCents: establishments.hotelDaycareDailyRateCents,
        hotelAdditionalDogDailyRateCents:
          establishments.hotelAdditionalDogDailyRateCents,
        hotelDaycareAdditionalDogDailyRateCents:
          establishments.hotelDaycareAdditionalDogDailyRateCents,
        hotelLongStayDiscountPercent:
          establishments.hotelLongStayDiscountPercent,
        daycareUnder4UnitCents: establishments.daycareUnder4UnitCents,
        daycare4To7UnitCents: establishments.daycare4To7UnitCents,
        daycare8To11UnitCents: establishments.daycare8To11UnitCents,
        daycare12PlusUnitCents: establishments.daycare12PlusUnitCents,
        daycareMultiDogDiscountPercent:
          establishments.daycareMultiDogDiscountPercent,
        bathUnder4RegularUnitCents: establishments.bathUnder4RegularUnitCents,
        bathUnder4DaycareUnitCents: establishments.bathUnder4DaycareUnitCents,
        bath4PlusRegularUnitCents: establishments.bath4PlusRegularUnitCents,
        bath4PlusDaycareUnitCents: establishments.bath4PlusDaycareUnitCents,
        bathGroomingAddonCents: establishments.bathGroomingAddonCents,
        taxiDogShortUnitCents: establishments.taxiDogShortUnitCents,
        taxiDogLongUnitCents: establishments.taxiDogLongUnitCents,
      })
      .from(establishments)
      .where(eq(establishments.id, identity.establishmentId!))
      .limit(1);

    return json({
      prices: services,
      daycareHours: establishment ?? {
        daycareStartTime: "07:30",
        daycareEndTime: "19:30",
      },
      lodgingPricing: establishment
        ? {
            standardDailyRateCents: establishment.hotelStandardDailyRateCents,
            daycareDailyRateCents: establishment.hotelDaycareDailyRateCents,
            additionalDogDailyRateCents:
              establishment.hotelAdditionalDogDailyRateCents,
            daycareAdditionalDogDailyRateCents:
              establishment.hotelDaycareAdditionalDogDailyRateCents,
            longStayDiscountPercent:
              establishment.hotelLongStayDiscountPercent,
          }
        : {
            standardDailyRateCents: 11_000,
            daycareDailyRateCents: 10_000,
            additionalDogDailyRateCents: 9_900,
            daycareAdditionalDogDailyRateCents: 9_000,
            longStayDiscountPercent: 5,
          },
      creditPricing: creditPricingFromEstablishment(establishment ?? {}),
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}

export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(request);
    const identity = await requireIdentity(request, ["owner"]);
    const body = await readJsonObject(request);
    const rawPrices = body.prices;
    if (!rawPrices || typeof rawPrices !== "object" || Array.isArray(rawPrices)) {
      throw new HttpError(
        400,
        "invalid_field",
        "Informe os preços que deseja atualizar.",
      );
    }

    const updates = Object.entries(rawPrices).map(([code, value]) => {
      if (
        !isEditableServiceCode(code) ||
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > 100_000_000
      ) {
        throw new HttpError(
          400,
          "invalid_price",
          `O preço informado para ${code} é inválido.`,
        );
      }
      return { code, priceCents: value };
    });
    if (updates.length === 0) {
      throw new HttpError(
        400,
        "empty_update",
        "Informe ao menos um preço para atualizar.",
      );
    }
    const rawLodgingPricing = body.lodgingPricing;
    if (
      !rawLodgingPricing ||
      typeof rawLodgingPricing !== "object" ||
      Array.isArray(rawLodgingPricing)
    ) {
      throw new HttpError(
        400,
        "invalid_lodging_pricing",
        "Informe todos os valores da hospedagem.",
      );
    }
    const lodgingPricing = rawLodgingPricing as Record<string, unknown>;
    const lodgingRateFields = [
      "standardDailyRateCents",
      "daycareDailyRateCents",
      "additionalDogDailyRateCents",
      "daycareAdditionalDogDailyRateCents",
    ] as const;
    for (const field of lodgingRateFields) {
      const value = lodgingPricing[field];
      if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > 100_000_000
      ) {
        throw new HttpError(
          400,
          "invalid_lodging_rate",
          "Um dos valores de diária da hospedagem é inválido.",
        );
      }
    }
    const longStayDiscountPercent = lodgingPricing.longStayDiscountPercent;
    if (
      typeof longStayDiscountPercent !== "number" ||
      !Number.isInteger(longStayDiscountPercent) ||
      longStayDiscountPercent < 0 ||
      longStayDiscountPercent > 99
    ) {
      throw new HttpError(
        400,
        "invalid_lodging_discount",
        "Informe um desconto de longa estadia entre 0% e 99%.",
      );
    }
    const rawCreditPricing = body.creditPricing;
    if (
      !rawCreditPricing ||
      typeof rawCreditPricing !== "object" ||
      Array.isArray(rawCreditPricing)
    ) {
      throw new HttpError(
        400,
        "invalid_credit_pricing",
        "Informe todos os valores dos pacotes de créditos.",
      );
    }
    const creditPricing = rawCreditPricing as Record<string, unknown>;
    const creditMoneyFields: (keyof CreditPricingSettings)[] = [
      "daycareUnder4UnitCents",
      "daycare4To7UnitCents",
      "daycare8To11UnitCents",
      "daycare12PlusUnitCents",
      "bathUnder4RegularUnitCents",
      "bathUnder4DaycareUnitCents",
      "bath4PlusRegularUnitCents",
      "bath4PlusDaycareUnitCents",
      "taxiDogShortUnitCents",
      "taxiDogLongUnitCents",
    ];
    for (const field of creditMoneyFields) {
      const value = creditPricing[field];
      if (
        typeof value !== "number" ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > 100_000_000
      ) {
        throw new HttpError(
          400,
          "invalid_credit_price",
          "Um dos valores da tabela de créditos é inválido.",
        );
      }
    }
    const daycareMultiDogDiscountPercent =
      creditPricing.daycareMultiDogDiscountPercent;
    if (
      typeof daycareMultiDogDiscountPercent !== "number" ||
      !Number.isInteger(daycareMultiDogDiscountPercent) ||
      daycareMultiDogDiscountPercent < 0 ||
      daycareMultiDogDiscountPercent > 99
    ) {
      throw new HttpError(
        400,
        "invalid_credit_discount",
        "Informe um desconto para dois ou mais cães entre 0% e 99%.",
      );
    }
    const daycareStartTime =
      typeof body.daycareStartTime === "string"
        ? body.daycareStartTime
        : "07:30";
    const daycareEndTime =
      typeof body.daycareEndTime === "string"
        ? body.daycareEndTime
        : "19:30";
    const bathGroomingAddonCents = body.bathGroomingAddonCents;
    if (
      typeof bathGroomingAddonCents !== "number" ||
      !Number.isSafeInteger(bathGroomingAddonCents) ||
      bathGroomingAddonCents < 1 ||
      bathGroomingAddonCents > 100_000_000
    ) {
      throw new HttpError(
        400,
        "invalid_grooming_addon_price",
        "Informe um valor válido para a tosa junto ao banho.",
      );
    }
    if (
      !/^\d{2}:\d{2}$/.test(daycareStartTime) ||
      !/^\d{2}:\d{2}$/.test(daycareEndTime) ||
      daycareEndTime <= daycareStartTime
    ) {
      throw new HttpError(
        400,
        "invalid_daycare_hours",
        "Informe um horário final de creche posterior ao horário inicial.",
      );
    }

    const establishmentId = identity.establishmentId!;
    const normalizedCreditPricing = creditPricingFromEstablishment(
      creditPricing as Partial<Record<keyof CreditPricingSettings, number>>,
    );
    const taxiUpdate = updates.find((update) => update.code === "taxi_dog");
    if (taxiUpdate) {
      taxiUpdate.priceCents = normalizedCreditPricing.taxiDogShortUnitCents;
    }
    const db = getDb();
    const existing = await db
      .select({ code: serviceCatalog.code })
      .from(serviceCatalog)
      .where(
        and(
          eq(serviceCatalog.establishmentId, establishmentId),
          inArray(
            serviceCatalog.code,
            updates.map(({ code }) => code),
          ),
        ),
      );
    if (existing.length !== updates.length) {
      throw new HttpError(
        409,
        "service_catalog_incomplete",
        "Um dos serviços padrão ainda não existe no catálogo.",
      );
    }

    const priceUpdateStatements = updates.map(({ code, priceCents }) =>
        db
          .update(serviceCatalog)
          .set({
            basePriceCents: priceCents,
            updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
          })
          .where(
            and(
              eq(serviceCatalog.establishmentId, establishmentId),
              eq(serviceCatalog.code, code),
            ),
          ),
      );
    await db.batch([
      priceUpdateStatements[0]!,
      ...priceUpdateStatements.slice(1),
      db
        .update(establishments)
        .set({
          daycareStartTime,
          daycareEndTime,
          hotelStandardDailyRateCents: lodgingPricing.standardDailyRateCents as number,
          hotelDaycareDailyRateCents: lodgingPricing.daycareDailyRateCents as number,
          hotelAdditionalDogDailyRateCents:
            lodgingPricing.additionalDogDailyRateCents as number,
          hotelDaycareAdditionalDogDailyRateCents:
            lodgingPricing.daycareAdditionalDogDailyRateCents as number,
          hotelLongStayDiscountPercent: longStayDiscountPercent,
          bathGroomingAddonCents,
          ...normalizedCreditPricing,
          updatedAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        })
        .where(eq(establishments.id, establishmentId)),
      db.insert(auditEvents).values({
        id: crypto.randomUUID(),
        establishmentId,
        actorUserId: identity.userId,
        actorRole: identity.role,
        action: "service_prices.updated",
        entityType: "service_catalog",
        entityId: establishmentId,
        requestId,
        metadataJson: JSON.stringify({
          updates,
          daycareStartTime,
          daycareEndTime,
          lodgingPricing,
          creditPricing: normalizedCreditPricing,
          bathGroomingAddonCents,
        }),
      }),
    ]);

    return json({
      prices: Object.fromEntries(
        updates.map(({ code, priceCents }) => [code, priceCents]),
      ),
      daycareHours: { daycareStartTime, daycareEndTime },
      lodgingPricing,
      creditPricing: normalizedCreditPricing,
      bathGroomingAddonCents,
    });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
