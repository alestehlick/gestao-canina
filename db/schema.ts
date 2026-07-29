import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const establishments = sqliteTable("establishments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  createdAt: text("created_at").notNull().default(now),
  updatedAt: text("updated_at").notNull().default(now),
});

export const customerAccounts = sqliteTable(
  "customer_accounts",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    displayName: text("display_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    addressLine: text("address_line"),
    addressCity: text("address_city"),
    addressRegion: text("address_region").default("SP"),
    addressPostalCode: text("address_postal_code"),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    index("customer_accounts_establishment_name_idx").on(
      table.establishmentId,
      table.normalizedName,
    ),
  ],
);

export const tutors = sqliteTable(
  "tutors",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    accountId: text("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "restrict" }),
    fullName: text("full_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    email: text("email"),
    normalizedEmail: text("normalized_email"),
    phoneE164: text("phone_e164"),
    whatsappEnabled: integer("whatsapp_enabled", { mode: "boolean" })
      .notNull()
      .default(true),
    isFinancialContact: integer("is_financial_contact", { mode: "boolean" })
      .notNull()
      .default(false),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    index("tutors_account_name_idx").on(table.accountId, table.normalizedName),
    index("tutors_email_idx").on(table.establishmentId, table.normalizedEmail),
    index("tutors_phone_idx").on(table.establishmentId, table.phoneE164),
  ],
);

export const appUsers = sqliteTable(
  "app_users",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    externalSubject: text("external_subject").notNull(),
    email: text("email").notNull(),
    normalizedEmail: text("normalized_email").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role", {
      enum: ["owner", "staff", "finance", "customer"],
    })
      .notNull()
      .default("staff"),
    tutorId: text("tutor_id").references(() => tutors.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: ["active", "disabled"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("app_users_external_subject_unique").on(table.externalSubject),
    uniqueIndex("app_users_establishment_email_unique").on(
      table.establishmentId,
      table.normalizedEmail,
    ),
  ],
);

export const dogs = sqliteTable(
  "dogs",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    accountId: text("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    breed: text("breed"),
    birthDate: text("birth_date"),
    sex: text("sex", { enum: ["female", "male", "unknown"] })
      .notNull()
      .default("unknown"),
    weightGrams: integer("weight_grams"),
    neutered: integer("neutered", { mode: "boolean" }),
    photoObjectKey: text("photo_object_key"),
    feedingNotes: text("feeding_notes"),
    temperamentNotes: text("temperament_notes"),
    healthNotes: text("health_notes"),
    emergencyNotes: text("emergency_notes"),
    vaccinesCurrent: integer("vaccines_current", { mode: "boolean" }),
    status: text("status", { enum: ["active", "archived", "deceased"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    index("dogs_establishment_status_name_idx").on(
      table.establishmentId,
      table.status,
      table.normalizedName,
    ),
    index("dogs_account_idx").on(table.accountId),
    check(
      "dogs_weight_nonnegative",
      sql`${table.weightGrams} is null or ${table.weightGrams} >= 0`,
    ),
  ],
);

export const dogTutors = sqliteTable(
  "dog_tutors",
  {
    dogId: text("dog_id")
      .notNull()
      .references(() => dogs.id, { onDelete: "cascade" }),
    tutorId: text("tutor_id")
      .notNull()
      .references(() => tutors.id, { onDelete: "cascade" }),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    emergencyContact: integer("emergency_contact", { mode: "boolean" })
      .notNull()
      .default(false),
    pickupAuthorized: integer("pickup_authorized", { mode: "boolean" })
      .notNull()
      .default(true),
    portalVisible: integer("portal_visible", { mode: "boolean" })
      .notNull()
      .default(true),
  },
  (table) => [
    primaryKey({ columns: [table.dogId, table.tutorId] }),
    index("dog_tutors_tutor_idx").on(table.tutorId),
  ],
);

export const serviceCatalog = sqliteTable(
  "service_catalog",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    code: text("code", {
      enum: [
        "daycare",
        "hotel",
        "bath",
        "hygienic_grooming",
        "transport",
        "other",
      ],
    }).notNull(),
    name: text("name").notNull(),
    unit: text("unit", {
      enum: ["day", "night", "service", "leg", "hour"],
    })
      .notNull()
      .default("service"),
    basePriceCents: integer("base_price_cents").notNull().default(0),
    durationMinutes: integer("duration_minutes"),
    colorToken: text("color_token").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("service_catalog_establishment_code_unique").on(
      table.establishmentId,
      table.code,
    ),
    check(
      "service_catalog_price_nonnegative",
      sql`${table.basePriceCents} >= 0`,
    ),
  ],
);

export const recurringSchedules = sqliteTable(
  "recurring_schedules",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    dogId: text("dog_id")
      .notNull()
      .references(() => dogs.id, { onDelete: "restrict" }),
    serviceCatalogId: text("service_catalog_id")
      .notNull()
      .references(() => serviceCatalog.id, { onDelete: "restrict" }),
    weekdaysMask: integer("weekdays_mask").notNull(),
    startsOn: text("starts_on").notNull(),
    endsOn: text("ends_on"),
    startTime: text("start_time"),
    endTime: text("end_time"),
    fixedPriceCents: integer("fixed_price_cents"),
    status: text("status", { enum: ["active", "paused", "ended"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    index("recurring_schedules_dog_status_idx").on(table.dogId, table.status),
    check(
      "recurring_schedules_weekdays_valid",
      sql`${table.weekdaysMask} between 1 and 127`,
    ),
    check(
      "recurring_schedules_price_nonnegative",
      sql`${table.fixedPriceCents} is null or ${table.fixedPriceCents} >= 0`,
    ),
  ],
);

export const appointments = sqliteTable(
  "appointments",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    accountId: text("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "restrict" }),
    dogId: text("dog_id")
      .notNull()
      .references(() => dogs.id, { onDelete: "restrict" }),
    financialTutorId: text("financial_tutor_id").references(() => tutors.id, {
      onDelete: "set null",
    }),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    startTime: text("start_time"),
    endTime: text("end_time"),
    status: text("status", {
      enum: [
        "scheduled",
        "confirmed",
        "in_transit",
        "present",
        "in_service",
        "completed",
        "cancelled",
      ],
    })
      .notNull()
      .default("scheduled"),
    source: text("source", { enum: ["manual", "recurring"] })
      .notNull()
      .default("manual"),
    recurringScheduleId: text("recurring_schedule_id").references(
      () => recurringSchedules.id,
      { onDelete: "set null" },
    ),
    occurrenceDate: text("occurrence_date"),
    internalNotes: text("internal_notes"),
    cancellationReason: text("cancellation_reason"),
    createdByUserId: text("created_by_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    index("appointments_establishment_date_status_idx").on(
      table.establishmentId,
      table.startDate,
      table.status,
    ),
    index("appointments_dog_date_idx").on(table.dogId, table.startDate),
    uniqueIndex("appointments_recurrence_occurrence_unique").on(
      table.recurringScheduleId,
      table.occurrenceDate,
    ),
  ],
);

export const appointmentItems = sqliteTable(
  "appointment_items",
  {
    id: text("id").primaryKey(),
    appointmentId: text("appointment_id")
      .notNull()
      .references(() => appointments.id, { onDelete: "restrict" }),
    serviceCatalogId: text("service_catalog_id")
      .notNull()
      .references(() => serviceCatalog.id, { onDelete: "restrict" }),
    serviceNameSnapshot: text("service_name_snapshot").notNull(),
    descriptionSnapshot: text("description_snapshot"),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull().default(1),
    totalCents: integer("total_cents").notNull(),
    status: text("status", {
      enum: ["scheduled", "completed", "cancelled"],
    })
      .notNull()
      .default("scheduled"),
    detailsJson: text("details_json"),
    activeInvoiceId: text("active_invoice_id"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    index("appointment_items_appointment_status_idx").on(
      table.appointmentId,
      table.status,
    ),
    index("appointment_items_active_invoice_idx").on(table.activeInvoiceId),
    check(
      "appointment_items_values_nonnegative",
      sql`${table.unitPriceCents} >= 0 and ${table.quantity} > 0 and ${table.totalCents} >= 0`,
    ),
  ],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    dogId: text("dog_id").references(() => dogs.id, { onDelete: "set null" }),
    accountId: text("account_id").references(() => customerAccounts.id, {
      onDelete: "set null",
    }),
    appointmentId: text("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    description: text("description"),
    scheduledDate: text("scheduled_date"),
    scheduledTime: text("scheduled_time"),
    priority: text("priority", { enum: ["low", "normal", "high"] })
      .notNull()
      .default("normal"),
    status: text("status", { enum: ["open", "completed", "cancelled"] })
      .notNull()
      .default("open"),
    assignedUserId: text("assigned_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    index("tasks_establishment_date_status_idx").on(
      table.establishmentId,
      table.scheduledDate,
      table.status,
    ),
  ],
);

export const creditMovements = sqliteTable(
  "credit_movements",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    accountId: text("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "restrict" }),
    dogId: text("dog_id").references(() => dogs.id, { onDelete: "set null" }),
    serviceCatalogId: text("service_catalog_id")
      .notNull()
      .references(() => serviceCatalog.id, { onDelete: "restrict" }),
    appointmentItemId: text("appointment_item_id").references(
      () => appointmentItems.id,
      { onDelete: "set null" },
    ),
    reversedMovementId: text("reversed_movement_id"),
    movementType: text("movement_type", {
      enum: ["grant", "consume", "refund", "adjust"],
    }).notNull(),
    deltaUnits: integer("delta_units").notNull(),
    reason: text("reason").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    actorUserId: text("actor_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    occurredAt: text("occurred_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("credit_movements_idempotency_unique").on(
      table.idempotencyKey,
    ),
    index("credit_movements_balance_idx").on(
      table.accountId,
      table.serviceCatalogId,
      table.dogId,
      table.occurredAt,
    ),
    check("credit_movements_nonzero", sql`${table.deltaUnits} <> 0`),
  ],
);

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    accountId: text("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "restrict" }),
    invoiceNumber: text("invoice_number").notNull(),
    recipientNameSnapshot: text("recipient_name_snapshot").notNull(),
    recipientEmailSnapshot: text("recipient_email_snapshot"),
    status: text("status", {
      enum: ["draft", "issued", "paid", "void"],
    })
      .notNull()
      .default("draft"),
    issuedAt: text("issued_at"),
    dueDate: text("due_date").notNull(),
    totalCents: integer("total_cents").notNull(),
    voidedAt: text("voided_at"),
    voidReason: text("void_reason"),
    createdByUserId: text("created_by_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("invoices_establishment_number_unique").on(
      table.establishmentId,
      table.invoiceNumber,
    ),
    index("invoices_account_status_due_idx").on(
      table.accountId,
      table.status,
      table.dueDate,
    ),
    check("invoices_total_nonnegative", sql`${table.totalCents} >= 0`),
  ],
);

export const invoiceItems = sqliteTable(
  "invoice_items",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    appointmentItemId: text("appointment_item_id")
      .notNull()
      .references(() => appointmentItems.id, { onDelete: "restrict" }),
    dogNameSnapshot: text("dog_name_snapshot").notNull(),
    serviceNameSnapshot: text("service_name_snapshot").notNull(),
    serviceDateSnapshot: text("service_date_snapshot").notNull(),
    descriptionSnapshot: text("description_snapshot").notNull(),
    amountCents: integer("amount_cents").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("invoice_items_active_service_unique").on(
      table.invoiceId,
      table.appointmentItemId,
    ),
    check("invoice_items_amount_nonnegative", sql`${table.amountCents} >= 0`),
  ],
);

export const pixCharges = sqliteTable(
  "pix_charges",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    txid: text("txid").notNull(),
    externalId: text("external_id"),
    amountCents: integer("amount_cents").notNull(),
    status: text("status", {
      enum: ["pending", "paid", "expired", "cancelled", "refunded"],
    })
      .notNull()
      .default("pending"),
    copyPasteCode: text("copy_paste_code"),
    idempotencyKey: text("idempotency_key").notNull(),
    expiresAt: text("expires_at").notNull(),
    paidAt: text("paid_at"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("pix_charges_txid_unique").on(table.txid),
    uniqueIndex("pix_charges_external_id_unique").on(table.externalId),
    uniqueIndex("pix_charges_idempotency_unique").on(table.idempotencyKey),
    index("pix_charges_invoice_status_idx").on(table.invoiceId, table.status),
    check("pix_charges_amount_positive", sql`${table.amountCents} > 0`),
  ],
);

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    pixChargeId: text("pix_charge_id")
      .notNull()
      .references(() => pixCharges.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: ["receipt", "refund"] }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    endToEndId: text("end_to_end_id").notNull(),
    reversesPaymentId: text("reverses_payment_id"),
    confirmedAt: text("confirmed_at").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("payments_end_to_end_id_unique").on(table.endToEndId),
    index("payments_invoice_confirmed_idx").on(
      table.invoiceId,
      table.confirmedAt,
    ),
    check("payments_amount_positive", sql`${table.amountCents} > 0`),
  ],
);

export const paymentAllocations = sqliteTable(
  "payment_allocations",
  {
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    invoiceItemId: text("invoice_item_id")
      .notNull()
      .references(() => invoiceItems.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [
    primaryKey({ columns: [table.paymentId, table.invoiceItemId] }),
    check("payment_allocations_amount_positive", sql`${table.amountCents} > 0`),
  ],
);

export const privateFiles = sqliteTable(
  "private_files",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    accountId: text("account_id").references(() => customerAccounts.id, {
      onDelete: "set null",
    }),
    ownerType: text("owner_type", {
      enum: ["dog", "account", "appointment", "invoice"],
    }).notNull(),
    ownerId: text("owner_id").notNull(),
    objectKey: text("object_key").notNull(),
    originalName: text("original_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    visibility: text("visibility", { enum: ["staff", "customer"] })
      .notNull()
      .default("staff"),
    status: text("status", { enum: ["pending", "ready", "quarantined"] })
      .notNull()
      .default("pending"),
    createdByUserId: text("created_by_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("private_files_object_key_unique").on(table.objectKey),
    index("private_files_owner_idx").on(
      table.establishmentId,
      table.ownerType,
      table.ownerId,
    ),
    check("private_files_size_nonnegative", sql`${table.sizeBytes} >= 0`),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    actorUserId: text("actor_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    actorRole: text("actor_role").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    requestId: text("request_id").notNull(),
    reason: text("reason"),
    result: text("result", { enum: ["success", "denied", "failed"] })
      .notNull()
      .default("success"),
    metadataJson: text("metadata_json"),
    occurredAt: text("occurred_at").notNull().default(now),
  },
  (table) => [
    index("audit_events_entity_idx").on(
      table.entityType,
      table.entityId,
      table.occurredAt,
    ),
    index("audit_events_actor_idx").on(
      table.actorUserId,
      table.occurredAt,
    ),
  ],
);
