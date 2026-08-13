import { HttpError } from "@/lib/server/http";

export function rethrowAppointmentConflict(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("lodging_overlap")) {
    throw new HttpError(
      409,
      "lodging_overlap",
      "Este cão já possui uma hospedagem que se sobrepõe ao período escolhido.",
    );
  }
  if (
    message.includes("appointments_active_service_day_unique") ||
    message.includes(
      "appointments.establishment_id, appointments.dog_id, appointments.start_date, appointments.primary_service_catalog_id",
    )
  ) {
    throw new HttpError(
      409,
      "duplicate_appointment",
      "Este cão já possui o mesmo serviço nessa data. Revise a Agenda antes de continuar.",
    );
  }
  throw error;
}
