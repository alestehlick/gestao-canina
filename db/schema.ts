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
  daycareStartTime: text("daycare_start_time").notNull().default("07:30"),
  daycareEndTime: text("daycare_end_time").notNull().default("19:30"),
  hotelStandardDailyRateCents: integer("hotel_standard_daily_rate_cents")
    .notNull()
    .default(11_000),
  hotelDaycareDailyRateCents: integer("hotel_daycare_daily_rate_cents")
    .notNull()
    .default(10_000),
  hotelAdditionalDogDailyRateCents: integer(
    "hotel_additional_dog_daily_rate_cents",
  )
    .notNull()
    .default(9_900),
  hotelDaycareAdditionalDogDailyRateCents: integer(
    "hotel_daycare_additional_dog_daily_rate_cents",
  )
    .notNull()
    .default(9_000),
  hotelLongStayDiscountPercent: integer("hotel_long_stay_discount_percent")
    .notNull()
    .default(5),
  daycareUnder4UnitCents: integer("daycare_under_4_unit_cents").notNull().default(6_500),
  daycare4To7UnitCents: integer("daycare_4_to_7_unit_cents").notNull().default(6_000),
  daycare8To11UnitCents: integer("daycare_8_to_11_unit_cents").notNull().default(5_800),
  daycare12PlusUnitCents: integer("daycare_12_plus_unit_cents").notNull().default(5_600),
  daycareMultiDogDiscountPercent: integer("daycare_multi_dog_discount_percent").notNull().default(15),
  bathUnder4RegularUnitCents: integer("bath_under_4_regular_unit_cents").notNull().default(6_000),
  bathUnder4DaycareUnitCents: integer("bath_under_4_daycare_unit_cents").notNull().default(5_500),
  bath4PlusRegularUnitCents: integer("bath_4_plus_regular_unit_cents").notNull().default(5_500),
  bath4PlusDaycareUnitCents: integer("bath_4_plus_daycare_unit_cents").notNull().default(5_000),
  bathGroomingAddonCents: integer("bath_grooming_addon_cents").notNull().default(3_000),
  taxiDogShortUnitCents: integer("taxi_dog_short_unit_cents").notNull().default(500),
  taxiDogLongUnitCents: integer("taxi_dog_long_unit_cents").notNull().default(1_000),
  cashMonthStartDay: integer("cash_month_start_day").notNull().default(1),
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
    cpf: text("cpf"),
    birthDate: text("birth_date"),
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

export const financialAccounts = sqliteTable(
  "financial_accounts",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    institution: text("institution"),
    kind: text("kind", {
      enum: ["checking", "savings", "cash", "other"],
    })
      .notNull()
      .default("checking"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdByUserId: text("created_by_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    index("financial_accounts_establishment_active_idx").on(
      table.establishmentId,
      table.active,
      table.displayOrder,
    ),
    uniqueIndex("financial_accounts_establishment_name_unique").on(
      table.establishmentId,
      table.name,
    ),
  ],
);

export const adminCredentials = sqliteTable(
  "admin_credentials",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    passwordAlgorithm: text("password_algorithm")
      .notNull()
      .default("pbkdf2-sha256"),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),
    passwordIterations: integer("password_iterations")
      .notNull()
      .default(310_000),
    failedLoginAttempts: integer("failed_login_attempts")
      .notNull()
      .default(0),
    lockedUntil: text("locked_until"),
    lastFailedAt: text("last_failed_at"),
    lastLoginAt: text("last_login_at"),
    passwordChangedAt: text("password_changed_at").notNull().default(now),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    check(
      "admin_credentials_algorithm_valid",
      sql`${table.passwordAlgorithm} = 'pbkdf2-sha256'`,
    ),
    check(
      "admin_credentials_iterations_secure",
      sql`${table.passwordIterations} >= 210000`,
    ),
    check(
      "admin_credentials_failures_nonnegative",
      sql`${table.failedLoginAttempts} >= 0`,
    ),
  ],
);

export const authLoginRateLimits = sqliteTable(
  "auth_login_rate_limits",
  {
    keyHash: text("key_hash").primaryKey(),
    scope: text("scope", { enum: ["ip", "ip_email"] }).notNull(),
    windowStartedAt: text("window_started_at").notNull(),
    attemptCount: integer("attempt_count").notNull().default(1),
    expiresAt: text("expires_at").notNull(),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    index("auth_login_rate_limits_expiry_idx").on(table.expiresAt),
    check(
      "auth_login_rate_limits_scope_valid",
      sql`${table.scope} in ('ip', 'ip_email')`,
    ),
    check(
      "auth_login_rate_limits_attempts_positive",
      sql`${table.attemptCount} > 0`,
    ),
  ],
);

export const adminSessions = sqliteTable(
  "admin_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    lastSeenAt: text("last_seen_at").notNull().default(now),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("admin_sessions_token_hash_unique").on(table.tokenHash),
    index("admin_sessions_user_expiry_idx").on(
      table.userId,
      table.expiresAt,
    ),
    index("admin_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const accountInvitations = sqliteTable(
  "account_invitations",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "cascade" }),
    normalizedEmail: text("normalized_email").notNull(),
    email: text("email").notNull(),
    role: text("role", { enum: ["staff", "customer"] }).notNull(),
    accountId: text("account_id").references(() => customerAccounts.id, {
      onDelete: "cascade",
    }),
    tokenHash: text("token_hash").notNull(),
    status: text("status", {
      enum: ["pending", "accepted", "revoked", "expired"],
    })
      .notNull()
      .default("pending"),
    deliveryStatus: text("delivery_status", {
      enum: ["pending", "sent", "failed", "manual"],
    })
      .notNull()
      .default("pending"),
    deliveryMessageId: text("delivery_message_id"),
    deliveryError: text("delivery_error"),
    expiresAt: text("expires_at").notNull(),
    sentAt: text("sent_at"),
    acceptedAt: text("accepted_at"),
    acceptedUserId: text("accepted_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    invitedByUserId: text("invited_by_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("account_invitations_token_hash_unique").on(table.tokenHash),
    index("account_invitations_establishment_status_idx").on(
      table.establishmentId,
      table.status,
      table.createdAt,
    ),
    index("account_invitations_email_status_idx").on(
      table.establishmentId,
      table.normalizedEmail,
      table.status,
    ),
  ],
);

export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    status: text("status", {
      enum: ["pending", "used", "revoked", "expired"],
    })
      .notNull()
      .default("pending"),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_token_hash_unique").on(table.tokenHash),
    index("password_reset_tokens_user_status_idx").on(
      table.userId,
      table.status,
      table.createdAt,
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
    medicationNotes: text("medication_notes"),
    vaccinesJson: text("vaccines_json").notNull().default("[]"),
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
        "bath_grooming",
        "taxi_dog",
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
    lodgingNights: integer("lodging_nights"),
    depositPercent: integer("deposit_percent"),
    lodgingRateProfile: text("lodging_rate_profile", {
      enum: ["standard", "daycare", "additional_dog", "daycare_additional_dog"],
    }),
    lodgingTableDailyRateCents: integer("lodging_table_daily_rate_cents"),
    status: text("status", {
      enum: [
        "scheduled",
        "confirmed",
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
    paymentPreference: text("payment_preference", {
      enum: ["invoice", "credit"],
    })
      .notNull()
      .default("invoice"),
    settlementMethod: text("settlement_method", {
      enum: ["unsettled", "invoice", "credit"],
    })
      .notNull()
      .default("unsettled"),
    billingPricingProfile: text("billing_pricing_profile"),
    creditMovementId: text("credit_movement_id"),
    settledAt: text("settled_at"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    index("appointment_items_appointment_status_idx").on(
      table.appointmentId,
      table.status,
    ),
    index("appointment_items_active_invoice_idx").on(table.activeInvoiceId),
    uniqueIndex("appointment_items_credit_movement_unique").on(
      table.creditMovementId,
    ),
    index("appointment_items_settlement_idx").on(table.settlementMethod),
    check(
      "appointment_items_values_nonnegative",
      sql`${table.unitPriceCents} >= 0 and ${table.quantity} > 0 and ${table.totalCents} >= 0`,
    ),
    check(
      "appointment_items_credit_settlement_valid",
      sql`(${table.settlementMethod} = 'credit' and ${table.creditMovementId} is not null and ${table.settledAt} is not null) or (${table.settlementMethod} <> 'credit' and ${table.creditMovementId} is null)`,
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

export const customerRequests = sqliteTable(
  "customer_requests",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "cascade" }),
    requestedByUserId: text("requested_by_user_id").references(
      () => appUsers.id,
      { onDelete: "set null" },
    ),
    type: text("type", {
      enum: ["service", "cancellation", "profile_update"],
    }).notNull(),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "cancelled"],
    })
      .notNull()
      .default("pending"),
    dogId: text("dog_id").references(() => dogs.id, { onDelete: "set null" }),
    appointmentId: text("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    serviceCatalogId: text("service_catalog_id").references(
      () => serviceCatalog.id,
      { onDelete: "set null" },
    ),
    requestedDate: text("requested_date"),
    requestedEndDate: text("requested_end_date"),
    notes: text("notes"),
    reviewedByUserId: text("reviewed_by_user_id").references(
      () => appUsers.id,
      { onDelete: "set null" },
    ),
    reviewedAt: text("reviewed_at"),
    responseNote: text("response_note"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    index("customer_requests_establishment_status_idx").on(
      table.establishmentId,
      table.status,
      table.createdAt,
    ),
    index("customer_requests_account_created_idx").on(
      table.accountId,
      table.createdAt,
    ),
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
    deliveryChannelsJson: text("delivery_channels_json").notNull().default("[]"),
    lastSentAt: text("last_sent_at"),
    internalNote: text("internal_note"),
    followUpOn: text("follow_up_on"),
    dueDate: text("due_date").notNull(),
    totalCents: integer("total_cents").notNull(),
    sourceType: text("source_type", {
      enum: [
        "services",
        "credit_package",
        "lodging_deposit",
        "lodging_balance",
      ],
    })
      .notNull()
      .default("services"),
    sourceId: text("source_id"),
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
    index("invoices_establishment_follow_up_idx").on(
      table.establishmentId,
      table.followUpOn,
      table.status,
    ),
    index("invoices_establishment_status_updated_idx").on(
      table.establishmentId,
      table.status,
      table.updatedAt,
    ),
    uniqueIndex("invoices_establishment_source_unique").on(
      table.establishmentId,
      table.sourceType,
      table.sourceId,
    ),
    check("invoices_total_nonnegative", sql`${table.totalCents} >= 0`),
    check(
      "invoices_credit_package_source_valid",
      sql`${table.sourceType} <> 'credit_package' or ${table.sourceId} is not null`,
    ),
  ],
);

export const creditPackages = sqliteTable(
  "credit_packages",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    serviceCatalogId: text("service_catalog_id")
      .notNull()
      .references(() => serviceCatalog.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    creditUnits: integer("credit_units").notNull(),
    packagePriceCents: integer("package_price_cents").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdByUserId: text("created_by_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    index("credit_packages_establishment_active_idx").on(
      table.establishmentId,
      table.active,
    ),
    index("credit_packages_service_idx").on(table.serviceCatalogId),
    check("credit_packages_units_positive", sql`${table.creditUnits} > 0`),
    check(
      "credit_packages_price_positive",
      sql`${table.packagePriceCents} > 0`,
    ),
  ],
);

export const creditPurchases = sqliteTable(
  "credit_purchases",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    accountId: text("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "restrict" }),
    packageId: text("package_id").references(() => creditPackages.id, {
      onDelete: "set null",
    }),
    serviceCatalogId: text("service_catalog_id")
      .notNull()
      .references(() => serviceCatalog.id, { onDelete: "restrict" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    packageNameSnapshot: text("package_name_snapshot").notNull(),
    creditUnits: integer("credit_units").notNull(),
    standardValueCents: integer("standard_value_cents").notNull(),
    amountCents: integer("amount_cents").notNull(),
    pricingProfileSnapshot: text("pricing_profile_snapshot").notNull().default("legacy"),
    suggestedUnitPriceCents: integer("suggested_unit_price_cents"),
    suggestedAmountCents: integer("suggested_amount_cents"),
    status: text("status", {
      enum: ["awaiting_payment", "paid", "cancelled", "refunded"],
    })
      .notNull()
      .default("awaiting_payment"),
    grantMovementId: text("grant_movement_id"),
    createdByUserId: text("created_by_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    paidAt: text("paid_at"),
    cancelledAt: text("cancelled_at"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("credit_purchases_invoice_unique").on(table.invoiceId),
    uniqueIndex("credit_purchases_grant_movement_unique").on(
      table.grantMovementId,
    ),
    index("credit_purchases_account_status_idx").on(
      table.accountId,
      table.status,
      table.createdAt,
    ),
    index("credit_purchases_service_idx").on(table.serviceCatalogId),
    check("credit_purchases_units_positive", sql`${table.creditUnits} > 0`),
    check(
      "credit_purchases_values_positive",
      sql`${table.standardValueCents} > 0 and ${table.amountCents} > 0`,
    ),
    check(
      "credit_purchases_grant_valid",
      sql`(${table.status} = 'paid' and ${table.grantMovementId} is not null and ${table.paidAt} is not null) or (${table.status} <> 'paid' and ${table.grantMovementId} is null)`,
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
    creditPurchaseId: text("credit_purchase_id").references(
      () => creditPurchases.id,
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
    uniqueIndex("credit_movements_purchase_grant_unique").on(
      table.creditPurchaseId,
    ),
    uniqueIndex("credit_movements_item_consume_unique").on(
      table.appointmentItemId,
    ),
    index("credit_movements_balance_idx").on(
      table.accountId,
      table.serviceCatalogId,
      table.occurredAt,
    ),
    check("credit_movements_nonzero", sql`${table.deltaUnits} <> 0`),
    check(
      "credit_movements_sign_valid",
      sql`(${table.movementType} in ('grant', 'refund') and ${table.deltaUnits} > 0) or (${table.movementType} = 'consume' and ${table.deltaUnits} < 0) or ${table.movementType} = 'adjust'`,
    ),
  ],
);

export const creditReceipts = sqliteTable(
  "credit_receipts",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    accountId: text("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "restrict" }),
    dogId: text("dog_id").references(() => dogs.id, { onDelete: "set null" }),
    appointmentItemId: text("appointment_item_id")
      .notNull()
      .references(() => appointmentItems.id, { onDelete: "restrict" }),
    creditMovementId: text("credit_movement_id")
      .notNull()
      .references(() => creditMovements.id, { onDelete: "restrict" }),
    receiptNumber: text("receipt_number").notNull(),
    customerNameSnapshot: text("customer_name_snapshot").notNull(),
    dogNameSnapshot: text("dog_name_snapshot").notNull(),
    serviceNameSnapshot: text("service_name_snapshot").notNull(),
    serviceDateSnapshot: text("service_date_snapshot").notNull(),
    creditUnits: integer("credit_units").notNull().default(1),
    deliveryStatus: text("delivery_status", {
      enum: ["pending", "sent", "failed"],
    })
      .notNull()
      .default("pending"),
    deliveryChannelsJson: text("delivery_channels_json").notNull(),
    issuedAt: text("issued_at").notNull().default(now),
    sentAt: text("sent_at"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("credit_receipts_establishment_number_unique").on(
      table.establishmentId,
      table.receiptNumber,
    ),
    uniqueIndex("credit_receipts_item_unique").on(table.appointmentItemId),
    uniqueIndex("credit_receipts_movement_unique").on(table.creditMovementId),
    index("credit_receipts_account_date_idx").on(
      table.accountId,
      table.issuedAt,
    ),
    check("credit_receipts_units_positive", sql`${table.creditUnits} > 0`),
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
    lodgingLongStayDiscountPercent: integer(
      "lodging_long_stay_discount_percent",
    ),
    lodgingLongStayDiscountCents: integer("lodging_long_stay_discount_cents")
      .notNull()
      .default(0),
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

export const invoicePayments = sqliteTable(
  "invoice_payments",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    financialAccountId: text("financial_account_id").references(
      () => financialAccounts.id,
      { onDelete: "restrict" },
    ),
    amountCents: integer("amount_cents").notNull(),
    method: text("method", { enum: ["manual"] }).notNull().default("manual"),
    status: text("status", { enum: ["active", "reversed"] })
      .notNull()
      .default("active"),
    note: text("note"),
    paidAt: text("paid_at").notNull(),
    recordedByUserId: text("recorded_by_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    reversedAt: text("reversed_at"),
    reversalReason: text("reversal_reason"),
    reversedByUserId: text("reversed_by_user_id").references(
      () => appUsers.id,
      { onDelete: "set null" },
    ),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("invoice_payments_invoice_active_unique")
      .on(table.invoiceId)
      .where(sql`${table.status} = 'active'`),
    index("invoice_payments_invoice_paid_idx").on(
      table.invoiceId,
      table.paidAt,
    ),
    index("invoice_payments_establishment_status_idx").on(
      table.establishmentId,
      table.status,
      table.paidAt,
    ),
    index("invoice_payments_financial_account_idx").on(
      table.financialAccountId,
      table.paidAt,
    ),
    check("invoice_payments_amount_positive", sql`${table.amountCents} > 0`),
    check(
      "invoice_payments_reversal_valid",
      sql`(${table.status} = 'active' and ${table.reversedAt} is null and ${table.reversalReason} is null) or (${table.status} = 'reversed' and ${table.reversedAt} is not null and ${table.reversalReason} is not null)`,
    ),
  ],
);

export const invoiceSettlements = sqliteTable(
  "invoice_settlements",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    financialAccountId: text("financial_account_id").references(
      () => financialAccounts.id,
      { onDelete: "restrict" },
    ),
    amountCents: integer("amount_cents").notNull(),
    availableOn: text("available_on").notNull(),
    note: text("note"),
    status: text("status", { enum: ["scheduled", "confirmed", "cancelled"] })
      .notNull()
      .default("scheduled"),
    createdByUserId: text("created_by_user_id").references(
      () => appUsers.id,
      { onDelete: "set null" },
    ),
    cancelledAt: text("cancelled_at"),
    cancelledByUserId: text("cancelled_by_user_id").references(
      () => appUsers.id,
      { onDelete: "set null" },
    ),
    cancellationReason: text("cancellation_reason"),
    confirmedAt: text("confirmed_at"),
    confirmedByUserId: text("confirmed_by_user_id").references(
      () => appUsers.id,
      { onDelete: "set null" },
    ),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("invoice_settlements_invoice_scheduled_unique")
      .on(table.invoiceId)
      .where(sql`${table.status} = 'scheduled'`),
    index("invoice_settlements_establishment_available_idx").on(
      table.establishmentId,
      table.status,
      table.availableOn,
    ),
    index("invoice_settlements_financial_account_idx").on(
      table.financialAccountId,
      table.availableOn,
    ),
    check("invoice_settlements_amount_positive", sql`${table.amountCents} > 0`),
    check(
      "invoice_settlements_cancelled_valid",
      sql`(${table.status} = 'cancelled' and ${table.cancelledAt} is not null and ${table.cancellationReason} is not null and ${table.confirmedAt} is null) or (${table.status} = 'confirmed' and ${table.confirmedAt} is not null and ${table.cancelledAt} is null) or (${table.status} = 'scheduled' and ${table.cancelledAt} is null and ${table.confirmedAt} is null)`,
    ),
  ],
);

export const invoiceMerges = sqliteTable(
  "invoice_merges",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    accountId: text("account_id")
      .notNull()
      .references(() => customerAccounts.id, { onDelete: "restrict" }),
    mergedInvoiceId: text("merged_invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["active", "reversed"] })
      .notNull()
      .default("active"),
    createdByUserId: text("created_by_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    reversedByUserId: text("reversed_by_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at").notNull().default(now),
    reversedAt: text("reversed_at"),
  },
  (table) => [
    uniqueIndex("invoice_merges_merged_invoice_unique").on(
      table.mergedInvoiceId,
    ),
    index("invoice_merges_establishment_status_idx").on(
      table.establishmentId,
      table.status,
      table.createdAt,
    ),
    check(
      "invoice_merges_reversal_valid",
      sql`(${table.status} = 'active' and ${table.reversedAt} is null) or (${table.status} = 'reversed' and ${table.reversedAt} is not null)`,
    ),
  ],
);

export const invoiceMergeMembers = sqliteTable(
  "invoice_merge_members",
  {
    mergeId: text("merge_id")
      .notNull()
      .references(() => invoiceMerges.id, { onDelete: "restrict" }),
    sourceInvoiceId: text("source_invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    originalStatus: text("original_status", {
      enum: ["draft", "issued"],
    }).notNull(),
    originalSourceId: text("original_source_id"),
    createdAt: text("created_at").notNull().default(now),
  },
  (table) => [
    primaryKey({ columns: [table.mergeId, table.sourceInvoiceId] }),
    index("invoice_merge_members_source_idx").on(table.sourceInvoiceId),
  ],
);

export const cashEntries = sqliteTable(
  "cash_entries",
  {
    id: text("id").primaryKey(),
    establishmentId: text("establishment_id")
      .notNull()
      .references(() => establishments.id, { onDelete: "restrict" }),
    direction: text("direction", { enum: ["inflow", "outflow"] }).notNull(),
    origin: text("origin", {
      enum: ["invoice_payment", "manual"],
    }).notNull(),
    sourcePaymentId: text("source_payment_id").references(
      () => invoicePayments.id,
      { onDelete: "restrict" },
    ),
    financialAccountId: text("financial_account_id").references(
      () => financialAccounts.id,
      { onDelete: "restrict" },
    ),
    occurredOn: text("occurred_on").notNull(),
    amountCents: integer("amount_cents").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull(),
    note: text("note"),
    status: text("status", { enum: ["included", "excluded"] })
      .notNull()
      .default("included"),
    exclusionReason: text("exclusion_reason"),
    createdByUserId: text("created_by_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    updatedByUserId: text("updated_by_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    excludedByUserId: text("excluded_by_user_id").references(
      () => appUsers.id,
      { onDelete: "set null" },
    ),
    excludedAt: text("excluded_at"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (table) => [
    uniqueIndex("cash_entries_source_payment_unique").on(
      table.sourcePaymentId,
    ),
    index("cash_entries_establishment_date_idx").on(
      table.establishmentId,
      table.occurredOn,
    ),
    index("cash_entries_establishment_status_idx").on(
      table.establishmentId,
      table.status,
      table.occurredOn,
    ),
    index("cash_entries_financial_account_idx").on(
      table.financialAccountId,
      table.occurredOn,
    ),
    check("cash_entries_amount_positive", sql`${table.amountCents} > 0`),
    check(
      "cash_entries_source_valid",
      sql`(${table.origin} = 'invoice_payment' and ${table.sourcePaymentId} is not null and ${table.direction} = 'inflow') or (${table.origin} = 'manual' and ${table.sourcePaymentId} is null)`,
    ),
    check(
      "cash_entries_exclusion_valid",
      sql`(${table.status} = 'excluded' and ${table.excludedAt} is not null) or (${table.status} = 'included' and ${table.excludedAt} is null)`,
    ),
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
    index("audit_events_establishment_date_idx").on(
      table.establishmentId,
      table.occurredAt,
    ),
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
