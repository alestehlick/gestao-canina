export type ActiveCreditServiceType = "daycare" | "bath" | "transport";
export type TaxiDogDistance = "short" | "long";

export type CreditPricingSettings = {
  daycareUnder4UnitCents: number;
  daycare4To7UnitCents: number;
  daycare8To11UnitCents: number;
  daycare12PlusUnitCents: number;
  daycareMultiDogDiscountPercent: number;
  bathUnder4RegularUnitCents: number;
  bathUnder4DaycareUnitCents: number;
  bath4PlusRegularUnitCents: number;
  bath4PlusDaycareUnitCents: number;
  taxiDogShortUnitCents: number;
  taxiDogLongUnitCents: number;
};

export type CreditPricingContext = {
  multiDog?: boolean;
  daycareCustomer?: boolean;
  taxiDistance?: TaxiDogDistance;
};

export const defaultCreditPricing: CreditPricingSettings = {
  daycareUnder4UnitCents: 6_500,
  daycare4To7UnitCents: 6_000,
  daycare8To11UnitCents: 5_800,
  daycare12PlusUnitCents: 5_600,
  daycareMultiDogDiscountPercent: 15,
  bathUnder4RegularUnitCents: 6_000,
  bathUnder4DaycareUnitCents: 5_500,
  bath4PlusRegularUnitCents: 5_500,
  bath4PlusDaycareUnitCents: 5_000,
  taxiDogShortUnitCents: 500,
  taxiDogLongUnitCents: 1_000,
};

export function creditPricingFromEstablishment(
  establishment: Partial<Record<keyof CreditPricingSettings, number | null | undefined>>,
): CreditPricingSettings {
  return Object.fromEntries(
    Object.entries(defaultCreditPricing).map(([key, fallback]) => [
      key,
      establishment[key as keyof CreditPricingSettings] ?? fallback,
    ]),
  ) as CreditPricingSettings;
}

export function suggestedCreditUnitCents(
  settings: CreditPricingSettings,
  serviceType: ActiveCreditServiceType,
  units: number,
  context: CreditPricingContext = {},
) {
  const safeUnits = Math.max(1, Math.trunc(units));
  if (serviceType === "daycare") {
    const base =
      safeUnits < 4
        ? settings.daycareUnder4UnitCents
        : safeUnits < 8
          ? settings.daycare4To7UnitCents
          : safeUnits < 12
            ? settings.daycare8To11UnitCents
            : settings.daycare12PlusUnitCents;
    return context.multiDog
      ? Math.round(base * (1 - settings.daycareMultiDogDiscountPercent / 100))
      : base;
  }
  if (serviceType === "bath") {
    if (safeUnits < 4) {
      return context.daycareCustomer
        ? settings.bathUnder4DaycareUnitCents
        : settings.bathUnder4RegularUnitCents;
    }
    return context.daycareCustomer
      ? settings.bath4PlusDaycareUnitCents
      : settings.bath4PlusRegularUnitCents;
  }
  return context.taxiDistance === "long"
    ? settings.taxiDogLongUnitCents
    : settings.taxiDogShortUnitCents;
}

export function suggestedCreditTotalCents(
  settings: CreditPricingSettings,
  serviceType: ActiveCreditServiceType,
  units: number,
  context: CreditPricingContext = {},
) {
  return suggestedCreditUnitCents(settings, serviceType, units, context) * Math.max(1, Math.trunc(units));
}

export function creditPricingProfile(
  serviceType: ActiveCreditServiceType,
  context: CreditPricingContext = {},
) {
  if (serviceType === "daycare") {
    return context.multiDog ? "daycare_multi_dog" : "daycare_standard";
  }
  if (serviceType === "bath") {
    return context.daycareCustomer ? "bath_daycare_customer" : "bath_regular_customer";
  }
  return context.taxiDistance === "long" ? "taxi_long" : "taxi_short";
}

export function creditPricingProfileLabel(profile: string | null | undefined) {
  if (profile === "daycare_multi_dog") return "Creche · dois ou mais cães";
  if (profile === "daycare_standard") return "Creche · tarifa padrão";
  if (profile === "bath_daycare_customer") return "Banho · cliente de creche";
  if (profile === "bath_regular_customer") return "Banho · cliente regular";
  if (profile === "taxi_long") return "Taxi-dog · distância longa";
  if (profile === "taxi_short") return "Taxi-dog · distância curta";
  return "Tabela anterior";
}

export function taxiDogRegularCents(
  settings: CreditPricingSettings,
  distance: TaxiDogDistance,
  direction: "one_way" | "round_trip",
) {
  const oneWay = distance === "long"
    ? settings.taxiDogLongUnitCents
    : settings.taxiDogShortUnitCents;
  return direction === "round_trip" ? oneWay * 2 : oneWay;
}
