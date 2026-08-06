export const canonicalAppointmentStatuses = [
  "scheduled",
  "confirmed",
  "completed",
  "cancelled",
] as const;

export type CanonicalAppointmentStatus =
  (typeof canonicalAppointmentStatuses)[number];

export function isCanonicalAppointmentStatus(
  value: unknown,
): value is CanonicalAppointmentStatus {
  return (
    typeof value === "string" &&
    canonicalAppointmentStatuses.includes(value as CanonicalAppointmentStatus)
  );
}

export function canTransitionAppointment(
  from: CanonicalAppointmentStatus,
  to: CanonicalAppointmentStatus,
) {
  if (from === to) return true;
  if (from === "scheduled") return to === "confirmed" || to === "cancelled";
  if (from === "confirmed") return to === "completed" || to === "cancelled";
  if (from === "completed") return to === "scheduled";
  return false;
}

export function taxiDogPriceCents(
  oneWayPriceCents: number,
  direction: "one_way" | "round_trip",
) {
  return Math.max(0, oneWayPriceCents) * (direction === "round_trip" ? 2 : 1);
}

export function creditUnitsForServiceCode(
  serviceCode: string,
  description?: string | null,
) {
  return serviceCode === "taxi_dog" && description === "Ida e volta" ? 2 : 1;
}

export function todayInSaoPaulo(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)?.value)
    .join("-");
}
