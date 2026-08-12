import {
  defaultServicePrices,
  serviceLabels,
  statusLabels,
  type AuditActivity,
  type Booking,
  type BookingStatus,
  type BillableService,
  type CreditBalances,
  type CreditPurchase,
  type CreditServiceType,
  type Customer,
  type Dog,
  type Invoice,
  type ServiceReceipt,
  type ServiceType,
  type Task,
} from "@/lib/demo-data";
import { creditUnitsForServiceCode } from "@/lib/service-rules";

export type WorkspaceServiceCode =
  | "daycare"
  | "hotel"
  | "bath"
  | "bath_grooming"
  | "taxi_dog"
  | "other";

export type WorkspaceRole = "owner" | "staff" | "finance" | "customer";

export type WorkspaceIdentity = {
  email: string;
  displayName: string;
  role: WorkspaceRole;
};

export type WorkspaceOnboardingPayload = {
  status: "onboarding";
  identity: WorkspaceIdentity;
  onboarding: {
    required: true;
    canInitialize: boolean;
  };
};

export type WorkspaceService = {
  id: string;
  establishmentId: string;
  code: WorkspaceServiceCode;
  name: string;
  unit: "day" | "night" | "service" | "leg" | "hour";
  basePriceCents: number;
  durationMinutes: number | null;
  colorToken: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceTutor = {
  id: string;
  establishmentId: string;
  accountId: string;
  fullName: string;
  normalizedName: string;
  email: string | null;
  normalizedEmail: string | null;
  phoneE164: string | null;
  whatsappEnabled: boolean;
  isFinancialContact: boolean;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceCustomer = {
  id: string;
  establishmentId: string;
  displayName: string;
  normalizedName: string;
  addressLine: string | null;
  addressCity: string | null;
  addressRegion: string | null;
  addressPostalCode: string | null;
  cpf: string | null;
  birthDate: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  tutors: WorkspaceTutor[];
};

export type WorkspaceDogTutor = {
  dogId: string;
  tutorId: string;
  isPrimary: boolean;
  emergencyContact: boolean;
  pickupAuthorized: boolean;
  portalVisible: boolean;
};

export type WorkspaceDog = {
  id: string;
  establishmentId: string;
  accountId: string;
  name: string;
  normalizedName: string;
  breed: string | null;
  birthDate: string | null;
  sex: "female" | "male" | "unknown";
  weightGrams: number | null;
  neutered: boolean | null;
  photoObjectKey: string | null;
  feedingNotes: string | null;
  temperamentNotes: string | null;
  healthNotes: string | null;
  medicationNotes: string | null;
  vaccinesJson: string;
  emergencyNotes: string | null;
  vaccinesCurrent: boolean | null;
  status: "active" | "archived" | "deceased";
  createdAt: string;
  updatedAt: string;
  tutors: WorkspaceDogTutor[];
};

export type WorkspaceAppointmentItem = {
  id: string;
  serviceCatalogId: string;
  serviceName: string;
  description: string | null;
  unitPriceCents: number;
  quantity: number;
  totalCents: number;
  status: "scheduled" | "completed" | "cancelled";
  paymentPreference: "invoice" | "credit";
  settlementMethod: "unsettled" | "invoice" | "credit";
  billingPricingProfile?: string | null;
  detailsJson?: string | null;
  settledAt: string | null;
  activeInvoiceId?: string | null;
};

export type WorkspaceAppointment = {
  id: string;
  accountId: string;
  dogId: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  lodgingNights: number | null;
  depositPercent: number | null;
  lodgingRateProfile:
    | "standard"
    | "daycare"
    | "additional_dog"
    | "daycare_additional_dog"
    | null;
  lodgingTableDailyRateCents: number | null;
  status: BookingStatus;
  source: "manual" | "recurring";
  recurringScheduleId: string | null;
  occurrenceDate: string | null;
  internalNotes: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
  dogName: string;
  customerName: string;
  items: WorkspaceAppointmentItem[];
};

export type WorkspaceTask = {
  id: string;
  establishmentId: string;
  dogId: string | null;
  accountId: string | null;
  appointmentId: string | null;
  title: string;
  description: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  priority: "low" | "normal" | "high";
  status: "open" | "completed" | "cancelled";
  assignedUserId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceInvoiceItem = {
  id: string;
  appointmentItemId: string;
  dogNameSnapshot: string;
  serviceNameSnapshot: string;
  serviceDateSnapshot: string;
  descriptionSnapshot: string;
  amountCents: number;
  serviceCode: WorkspaceServiceCode | null;
  lodgingStartDate: string | null;
  lodgingEndDate: string | null;
  lodgingNights: number | null;
  lodgingDailyRateCents: number | null;
  lodgingTableDailyRateCents: number | null;
  lodgingRateProfile:
    | "standard"
    | "daycare"
    | "additional_dog"
    | "daycare_additional_dog"
    | null;
  lodgingLongStayDiscountPercent: number | null;
  lodgingLongStayDiscountCents: number;
  depositPercent: number | null;
};

export type WorkspaceInvoice = {
  id: string;
  establishmentId: string;
  accountId: string;
  invoiceNumber: string;
  recipientNameSnapshot: string;
  recipientEmailSnapshot: string | null;
  status: "draft" | "issued" | "paid" | "void";
  issuedAt: string | null;
  deliveryChannelsJson: string;
  lastSentAt: string | null;
  internalNote: string | null;
  followUpOn: string | null;
  dueDate: string;
  totalCents: number;
  sourceType:
    | "services"
    | "credit_package"
    | "lodging_deposit"
    | "lodging_balance";
  sourceId: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt?: string | null;
  cashEntryId?: string | null;
  cashIncluded?: boolean;
  compensationAvailableOn?: string | null;
  mergedSourceInvoiceIds?: string[];
  /**
   * The current workspace endpoint does not need this field to render a useful
   * fallback label, but the mapper accepts it when the endpoint includes invoice
   * item snapshots in a future response.
   */
  items?: WorkspaceInvoiceItem[];
};

export type WorkspaceCreditPackage = {
  id: string;
  serviceCatalogId: string;
  serviceCode: WorkspaceServiceCode;
  name: string;
  creditUnits: number;
  packagePriceCents: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceCreditPurchase = {
  id: string;
  establishmentId: string;
  accountId: string;
  packageId: string | null;
  serviceCatalogId: string;
  invoiceId: string;
  packageNameSnapshot: string;
  creditUnits: number;
  standardValueCents: number;
  amountCents: number;
  pricingProfileSnapshot: string;
  suggestedUnitPriceCents: number | null;
  suggestedAmountCents: number | null;
  status: "awaiting_payment" | "paid" | "cancelled" | "refunded";
  grantMovementId: string | null;
  createdByUserId: string | null;
  paidAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceCreditBalance = {
  accountId: string;
  serviceCatalogId: string;
  availableUnits: number;
};

export type WorkspaceCreditReceipt = {
  id: string;
  establishmentId: string;
  accountId: string;
  dogId: string | null;
  appointmentItemId: string;
  creditMovementId: string;
  receiptNumber: string;
  customerNameSnapshot: string;
  dogNameSnapshot: string;
  serviceNameSnapshot: string;
  serviceDateSnapshot: string;
  creditUnits: number;
  deliveryStatus: "pending" | "sent" | "failed";
  deliveryChannelsJson: string;
  deliveryChannels: unknown;
  issuedAt: string;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceAuditEvent = {
  id: string;
  actorRole: string;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  result: "success" | "denied" | "failed";
  metadataJson: string | null;
  occurredAt: string;
  subjectName?: string | null;
  secondaryName?: string | null;
  serviceName?: string | null;
  eventDate?: string | null;
  amountCents?: number | null;
  referenceNumber?: string | null;
  currentStatus?: string | null;
};

export type WorkspaceReadyPayload = {
  status: "ready";
  identity: WorkspaceIdentity;
  establishment: {
    id: string;
    name: string;
    timezone: string;
    daycareStartTime: string;
    daycareEndTime: string;
    hotelStandardDailyRateCents: number;
    hotelDaycareDailyRateCents: number;
    hotelAdditionalDogDailyRateCents: number;
    hotelDaycareAdditionalDogDailyRateCents: number;
    hotelLongStayDiscountPercent: number;
    daycareUnder4UnitCents: number;
    daycare4To7UnitCents: number;
    daycare8To11UnitCents: number;
    daycare12PlusUnitCents: number;
    daycareMultiDogDiscountPercent: number;
    bathUnder4RegularUnitCents: number;
    bathUnder4DaycareUnitCents: number;
    bath4PlusRegularUnitCents: number;
    bath4PlusDaycareUnitCents: number;
    bathGroomingAddonCents: number;
    taxiDogShortUnitCents: number;
    taxiDogLongUnitCents: number;
    cashMonthStartDay: number;
    createdAt: string;
    updatedAt: string;
  };
  range: {
    from: string;
    to: string;
  };
  serviceCatalog: WorkspaceService[];
  customers: WorkspaceCustomer[];
  dogs: WorkspaceDog[];
  agenda: WorkspaceAppointment[];
  tasks: WorkspaceTask[];
  billing: {
    receivedLast30DaysCents: number;
    receivedLast30DaysCount: number;
    invoices: WorkspaceInvoice[];
    creditPackages: WorkspaceCreditPackage[];
    creditPurchases: WorkspaceCreditPurchase[];
    creditBalances: WorkspaceCreditBalance[];
    creditReceipts: WorkspaceCreditReceipt[];
  };
  activities: WorkspaceAuditEvent[];
};

export type WorkspacePayload =
  | WorkspaceOnboardingPayload
  | WorkspaceReadyPayload;

export type WorkspaceUiData = {
  operationalToday: string;
  customers: Customer[];
  dogs: Dog[];
  bookings: Booking[];
  billableServices: BillableService[];
  tasks: Task[];
  invoices: Invoice[];
  creditBalances: CreditBalances;
  creditPurchases: CreditPurchase[];
  receipts: ServiceReceipt[];
  servicePrices: Record<ServiceType, number>;
  activities: AuditActivity[];
};

const creditServiceTypes: CreditServiceType[] = [
  "daycare",
  "bath",
  "transport",
];

const dogColorTokens = ["clay", "plum", "forest", "sky", "gold", "rose"];

export function isReadyWorkspacePayload(
  payload: WorkspacePayload,
): payload is WorkspaceReadyPayload {
  return payload.status === "ready";
}

export function toUiServiceType(
  code: WorkspaceServiceCode | string | null | undefined,
): ServiceType {
  if (
    code === "bath_grooming" ||
    code === "grooming"
  ) {
    return "grooming";
  }
  if (code === "taxi_dog" || code === "transport") {
    return "transport";
  }
  if (
    code === "daycare" ||
    code === "bath" ||
    code === "hotel" ||
    code === "other"
  ) {
    return code;
  }
  return "other";
}

export function toWorkspaceServiceCode(
  serviceType: ServiceType,
): WorkspaceServiceCode {
  if (serviceType === "grooming") return "bath_grooming";
  if (serviceType === "transport") return "taxi_dog";
  return serviceType;
}

export function formatPhoneForDisplay(phoneE164: string | null | undefined) {
  const value = phoneE164?.trim();
  if (!value) return "Não informado";

  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("55")) {
    const nationalNumber = digits.slice(2);
    if (nationalNumber.length === 11) {
      return `(${nationalNumber.slice(0, 2)}) ${nationalNumber.slice(
        2,
        7,
      )}-${nationalNumber.slice(7)}`;
    }
    if (nationalNumber.length === 10) {
      return `(${nationalNumber.slice(0, 2)}) ${nationalNumber.slice(
        2,
        6,
      )}-${nationalNumber.slice(6)}`;
    }
  }

  // Keep non-Brazilian E.164 numbers intact instead of guessing their local
  // grouping rules.
  return value;
}

export function mapWorkspaceCreditBalances(
  payload: WorkspaceReadyPayload,
): CreditBalances {
  const balances: CreditBalances = {};
  for (const customer of payload.customers) {
    balances[customer.id] = emptyCreditBalance();
  }

  const servicesById = new Map(
    payload.serviceCatalog.map((service) => [service.id, service]),
  );
  for (const balance of payload.billing.creditBalances) {
    const service = servicesById.get(balance.serviceCatalogId);
    const serviceType = toCreditServiceType(service?.code);
    if (!serviceType) continue;

    const accountBalance =
      balances[balance.accountId] ?? emptyCreditBalance();
    accountBalance[serviceType] = Math.max(
      0,
      Math.trunc(Number(balance.availableUnits) || 0),
    );
    balances[balance.accountId] = accountBalance;
  }

  return balances;
}

export function mapWorkspaceCustomers(
  payload: WorkspaceReadyPayload,
  creditBalances: CreditBalances,
  referenceDate = payload.range.from,
): Customer[] {
  const activeDogIdsByAccount = new Map<string, string[]>();
  for (const dog of payload.dogs) {
    if (dog.status !== "active") continue;
    const dogIds = activeDogIdsByAccount.get(dog.accountId) ?? [];
    dogIds.push(dog.id);
    activeDogIdsByAccount.set(dog.accountId, dogIds);
  }

  const openInvoicesByAccount = new Map<string, WorkspaceInvoice[]>();
  for (const invoice of payload.billing.invoices) {
    if (invoice.status !== "issued") continue;
    const invoices = openInvoicesByAccount.get(invoice.accountId) ?? [];
    invoices.push(invoice);
    openInvoicesByAccount.set(invoice.accountId, invoices);
  }

  return payload.customers
    .filter((account) => account.status === "active")
    .map((account) => {
      const activeTutors = account.tutors.filter(
        (tutor) => tutor.status === "active",
      );
      const contact =
        activeTutors.find((tutor) => tutor.isFinancialContact) ??
        activeTutors[0];
      const openInvoices = openInvoicesByAccount.get(account.id) ?? [];
      const balanceCents = openInvoices.reduce(
        (total, invoice) => total + Math.max(0, invoice.totalCents),
        0,
      );
      const hasOverdueInvoice = openInvoices.some(
        (invoice) => invoice.dueDate < referenceDate,
      );
      const availableCredits = totalAvailableCredits(
        creditBalances[account.id],
      );

      return {
        id: account.id,
        name: account.displayName,
        initials: initialsFor(account.displayName),
        phone: formatPhoneForDisplay(contact?.phoneE164),
        email: contact?.email?.trim() || "Não informado",
        address: [
          account.addressLine,
          account.addressCity,
          account.addressRegion,
          account.addressPostalCode,
        ].filter(Boolean).join(" · ") || undefined,
        cpf: account.cpf ?? undefined,
        birthDate: account.birthDate ?? undefined,
        dogIds: activeDogIdsByAccount.get(account.id) ?? [],
        balanceCents,
        creditsLabel: creditLabel(availableCredits),
        status: hasOverdueInvoice
          ? "overdue"
          : openInvoices.length > 0
            ? "pending"
            : "current",
      };
    });
}

function parseAppointmentItemDetails(value: string | null | undefined) {
  if (!value) return {} as { groomingAddon?: boolean };
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as { groomingAddon?: boolean })
      : {};
  } catch {
    return {};
  }
}

export function mapWorkspaceBookings(
  payload: WorkspaceReadyPayload,
): Booking[] {
  const servicesById = new Map(
    payload.serviceCatalog.map((service) => [service.id, service]),
  );
  const receiptByItemId = new Map(
    payload.billing.creditReceipts.map((receipt) => [
      receipt.appointmentItemId,
      receipt,
    ]),
  );

  return payload.agenda.map((appointment) => {
    const activeItems = appointment.items.filter(
      (item) => item.status !== "cancelled",
    );
    const displayItems =
      activeItems.length > 0 ? activeItems : appointment.items;
    const firstItem = displayItems[0];
    const firstService = firstItem
      ? servicesById.get(firstItem.serviceCatalogId)
      : undefined;
    const serviceType = toUiServiceType(firstService?.code);
    const matchingReceipt = displayItems
      .map((item) => receiptByItemId.get(item.id))
      .find((receipt): receipt is WorkspaceCreditReceipt => Boolean(receipt));
    const usesCredit = displayItems.some(
      (item) => item.settlementMethod === "credit",
    );
    const awaitingInvoice =
      appointment.status === "completed" &&
      !usesCredit &&
      displayItems.some(
        (item) =>
          item.settlementMethod === "unsettled" &&
          !item.activeInvoiceId,
      );
    const appointmentInvoices = payload.billing.invoices.filter(
      (invoice) =>
        invoice.sourceId === appointment.id && invoice.status !== "void",
    );
    const depositInvoice =
      appointmentInvoices.find(
        (invoice) => invoice.sourceType === "lodging_deposit",
      ) ??
      payload.billing.invoices.find(
        (invoice) =>
          invoice.status !== "void" &&
          invoice.items?.some(
            (invoiceItem) =>
              invoiceItem.appointmentItemId === firstItem?.id &&
              invoiceItem.serviceNameSnapshot === "Sinal da hospedagem",
          ),
      );
    const depositInvoiceLine = depositInvoice?.items?.find(
      (invoiceItem) =>
        invoiceItem.appointmentItemId === firstItem?.id &&
        invoiceItem.serviceNameSnapshot === "Sinal da hospedagem",
    );
    const balanceInvoice = appointmentInvoices.find(
      (invoice) => invoice.sourceType === "lodging_balance",
    );
    const combinedInvoice = firstItem?.activeInvoiceId
      ? payload.billing.invoices.find(
          (invoice) =>
            invoice.id === firstItem.activeInvoiceId &&
            invoice.status !== "void",
        )
      : undefined;
    const combinedInvoiceLine = combinedInvoice?.items?.find(
      (invoiceItem) => invoiceItem.appointmentItemId === firstItem?.id,
    );
    const effectiveBalanceInvoice = balanceInvoice ?? combinedInvoice;

    return {
      id: appointment.id,
      itemId: firstItem?.id,
      serviceCatalogId: firstItem?.serviceCatalogId,
      recurringScheduleId: appointment.recurringScheduleId ?? undefined,
      occurrenceDate: appointment.occurrenceDate ?? undefined,
      date: appointment.startDate,
      endDate: appointment.endDate,
      time: appointment.startTime ?? "Sem horário",
      endTime: appointment.endTime ?? undefined,
      lodgingNights: appointment.lodgingNights ?? undefined,
      depositPercent: appointment.depositPercent ?? undefined,
      lodgingRateProfile: appointment.lodgingRateProfile ?? undefined,
      lodgingTableDailyRateCents:
        appointment.lodgingTableDailyRateCents ?? undefined,
      dogId: appointment.dogId,
      dogName: appointment.dogName,
      customerId: appointment.accountId,
      customerName: appointment.customerName,
      service:
        displayItems.map((item) => item.serviceName).join(" · ") ||
        "Serviço sem item",
      serviceType,
      transportDirection:
        firstService?.code === "taxi_dog"
          ? firstItem?.description === "Ida e volta"
            ? "round_trip"
            : "one_way"
          : undefined,
      groomingAddon:
        firstService?.code === "bath" &&
        parseAppointmentItemDetails(firstItem?.detailsJson).groomingAddon === true,
      status: appointment.status,
      priceCents: displayItems.reduce(
        (total, item) => total + Math.max(0, item.totalCents),
        0,
      ),
      paymentPreference: "invoice",
      settlementStatus: usesCredit
        ? "credit_used"
        : awaitingInvoice
          ? "invoice_pending"
          : "pending",
      depositInvoice: depositInvoice
        ? {
            id: depositInvoice.id,
            number: depositInvoice.invoiceNumber,
            amountCents:
              depositInvoiceLine?.amountCents ?? depositInvoice.totalCents,
            status: activeInvoiceStatus(depositInvoice, payload.range.from),
          }
        : undefined,
      balanceInvoice: effectiveBalanceInvoice
        ? {
            id: effectiveBalanceInvoice.id,
            number: effectiveBalanceInvoice.invoiceNumber,
            amountCents:
              combinedInvoiceLine?.amountCents ??
              effectiveBalanceInvoice.totalCents,
            status: activeInvoiceStatus(effectiveBalanceInvoice, payload.range.from),
          }
        : undefined,
      receiptNumber: matchingReceipt?.receiptNumber,
      note:
        appointment.internalNotes ??
        appointment.cancellationReason ??
        firstItem?.description ??
        undefined,
    };
  });
}

export function mapWorkspaceBillableServices(
  payload: WorkspaceReadyPayload,
): BillableService[] {
  const servicesById = new Map(
    payload.serviceCatalog.map((service) => [service.id, service]),
  );
  const activeInvoices = payload.billing.invoices.filter(
    (invoice) => invoice.status !== "void",
  );

  return payload.agenda.flatMap((appointment) =>
    appointment.items.flatMap((item): BillableService[] => {
      if (
        item.settlementMethod !== "unsettled"
      ) {
        return [];
      }

      const isLodging =
        servicesById.get(item.serviceCatalogId)?.code === "hotel";
      const serviceCode = servicesById.get(item.serviceCatalogId)?.code;
      const serviceType = toUiServiceType(
        servicesById.get(item.serviceCatalogId)?.code,
      );
      const lodging =
        isLodging && appointment.lodgingNights !== null
          ? {
              checkInDate: appointment.startDate,
              checkOutDate: appointment.endDate,
              nights: appointment.lodgingNights,
              dailyRateCents: appointment.lodgingNights
                ? Math.round(item.totalCents / appointment.lodgingNights)
                : undefined,
              tableDailyRateCents:
                appointment.lodgingTableDailyRateCents ?? undefined,
              rateProfile: appointment.lodgingRateProfile ?? undefined,
              depositPercent: appointment.depositPercent ?? undefined,
            }
          : undefined;
      const base = {
        appointmentItemId: item.id,
        customerId: appointment.accountId,
        customerName: appointment.customerName,
        dogName: appointment.dogName,
        date: formatBrazilianDate(appointment.startDate),
        serviceType,
        creditUnits:
          serviceCode &&
          ["daycare", "bath", "taxi_dog"].includes(
            serviceCode,
          )
            ? creditUnitsForServiceCode(serviceCode, item.description)
            : undefined,
        transportDirection:
          serviceCode === "taxi_dog" && item.description === "Ida e volta"
            ? ("round_trip" as const)
            : serviceCode === "taxi_dog"
              ? ("one_way" as const)
              : undefined,
        billingPricingProfile: item.billingPricingProfile ?? undefined,
        lodging,
      };

      if (!isLodging) {
        return appointment.status === "completed" &&
          !item.activeInvoiceId
          ? [
              {
                ...base,
                id: item.id,
                billingKind: "service",
                service: item.serviceName,
                amountCents: item.totalCents,
              },
            ]
          : [];
      }

      const depositInvoice = activeInvoices.find(
        (invoice) =>
          (invoice.sourceType === "lodging_deposit" &&
            invoice.sourceId === appointment.id) ||
          invoice.items?.some(
            (invoiceItem) =>
              invoiceItem.appointmentItemId === item.id &&
              invoiceItem.serviceNameSnapshot === "Sinal da hospedagem",
          ),
      );
      const depositInvoiceLine = depositInvoice?.items?.find(
        (invoiceItem) =>
          invoiceItem.appointmentItemId === item.id &&
          invoiceItem.serviceNameSnapshot === "Sinal da hospedagem",
      );
      const depositConfigured =
        Boolean(appointment.depositPercent) &&
        appointment.depositPercent! > 0 &&
        appointment.depositPercent! < 100;
      const canOfferDeposit = ["confirmed", "completed"].includes(
        appointment.status,
      );
      const entries: BillableService[] = [];

      if (depositConfigured && canOfferDeposit && !depositInvoice) {
        const depositAmount = Math.round(
          (item.totalCents * appointment.depositPercent!) / 100,
        );
        entries.push({
          ...base,
          id: `deposit:${item.id}`,
          billingKind: "lodging_deposit",
          service: "Sinal da hospedagem",
          amountCents: depositAmount,
          selectable: depositAmount > 0,
          billingNote: `${appointment.depositPercent}% do valor da hospedagem`,
        });
      }

      if (
        appointment.status === "completed" &&
        !item.activeInvoiceId
      ) {
        const paidDepositCents =
          depositInvoice?.status === "paid"
            ? (depositInvoiceLine?.amountCents ?? depositInvoice.totalCents)
            : 0;
        const waitingForDeposit =
          depositConfigured && depositInvoice?.status !== "paid";
        const amountCents = Math.max(0, item.totalCents - paidDepositCents);
        entries.push({
          ...base,
          id: `balance:${item.id}`,
          billingKind: "lodging_balance",
          service:
            depositConfigured || paidDepositCents > 0
              ? "Saldo da hospedagem"
              : "Hospedagem",
          amountCents,
          selectable: !waitingForDeposit && amountCents > 0,
          billingNote: waitingForDeposit
            ? depositInvoice?.status === "issued"
              ? "Aguardando pagamento ou cancelamento da fatura do sinal"
              : "Fature e registre o sinal antes de cobrar o saldo"
            : paidDepositCents > 0
              ? `Sinal de ${formatMoney(paidDepositCents)} já abatido`
              : undefined,
        });
      }

      return entries;
    }),
  );
}

export function mapWorkspaceTasks(
  payload: WorkspaceReadyPayload,
  referenceDate = payload.range.from,
): Task[] {
  return payload.tasks
    .filter((task) => task.status !== "cancelled")
    .map((task) => ({
      id: task.id,
      title: task.title,
      due: taskDueLabel(task, referenceDate),
      priority: task.priority === "high" ? "high" : "normal",
      completed: task.status === "completed",
    }));
}

export function mapWorkspaceInvoices(
  payload: WorkspaceReadyPayload,
  referenceDate = payload.range.from,
  options: { includeVoided?: boolean } = {},
): Invoice[] {
  const purchasesByInvoiceId = new Map(
    payload.billing.creditPurchases.map((purchase) => [
      purchase.invoiceId,
      purchase,
    ]),
  );
  const servicesById = new Map(
    payload.serviceCatalog.map((service) => [service.id, service]),
  );

  return payload.billing.invoices
    .filter((invoice) => options.includeVoided || invoice.status !== "void")
    .map((invoice) => {
      const status = invoiceStatus(invoice, referenceDate);
      const purchase = purchasesByInvoiceId.get(invoice.id);
      const service = purchase
        ? servicesById.get(purchase.serviceCatalogId)
        : undefined;
      const mergedCreditPurchases = (invoice.mergedSourceInvoiceIds ?? [])
        .map((sourceInvoiceId) => purchasesByInvoiceId.get(sourceInvoiceId))
        .filter(
          (candidate): candidate is WorkspaceCreditPurchase => Boolean(candidate),
        );
      const creditPurchasesForInvoice = purchase
        ? [purchase]
        : mergedCreditPurchases;
      const serviceLines = (invoice.items ?? []).map((item) => ({
        dogName: item.dogNameSnapshot || "Sem cão informado",
        service: item.serviceNameSnapshot,
        date: item.serviceDateSnapshot,
        amountCents: Math.max(0, item.amountCents),
        lodging:
          item.serviceCode === "hotel" &&
          item.lodgingStartDate &&
          item.lodgingEndDate &&
          item.lodgingNights !== null
            ? {
                checkInDate: item.lodgingStartDate,
                checkOutDate: item.lodgingEndDate,
                nights: item.lodgingNights,
                dailyRateCents: item.lodgingDailyRateCents ?? undefined,
                tableDailyRateCents:
                  item.lodgingTableDailyRateCents ?? undefined,
                rateProfile: item.lodgingRateProfile ?? undefined,
                longStayDiscountPercent:
                  item.lodgingLongStayDiscountPercent ?? undefined,
                longStayDiscountCents:
                  item.lodgingLongStayDiscountCents ?? undefined,
                depositPercent: item.depositPercent ?? undefined,
              }
            : undefined,
      }));
      const creditLines = creditPurchasesForInvoice.map((creditPurchase) => {
        const creditService = servicesById.get(creditPurchase.serviceCatalogId);
        const type = toCreditServiceType(creditService?.code);
        const serviceName = type ? serviceLabels[type] : creditService?.name;
        return {
          dogName: "Pacote",
          service: `${creditPurchase.creditUnits} ${
            creditPurchase.creditUnits === 1 ? "crédito" : "créditos"
          }${serviceName ? ` de ${serviceName}` : ""}`,
          date:
            invoice.issuedAt?.slice(0, 10) ?? invoice.createdAt.slice(0, 10),
          amountCents: Math.max(0, creditPurchase.amountCents),
        };
      });
      const lines = [...serviceLines, ...creditLines];
      const mergedItemsLabel = mergedCreditPurchases.length
        ? [
            invoice.items?.length
              ? invoiceItemsLabel(invoice, undefined, undefined)
              : "",
            ...creditLines.map((line) => line.service),
          ]
            .filter(Boolean)
            .join(" · ")
        : invoiceItemsLabel(invoice, purchase, service);

      return {
        id: invoice.id,
        number: invoice.invoiceNumber,
        customerId: invoice.accountId,
        customerName: invoice.recipientNameSnapshot,
        amountCents: Math.max(0, invoice.totalCents),
        due: invoiceDueLabel(invoice, referenceDate),
        status,
        issuedAt:
          invoice.issuedAt?.slice(0, 10) ?? invoice.createdAt.slice(0, 10),
        paidAt: invoice.paidAt?.slice(0, 10) ?? undefined,
        sentBy: extractDeliveryChannels(invoice.deliveryChannelsJson).filter(
          (channel): channel is "whatsapp" | "email" =>
            channel === "whatsapp" || channel === "email",
        ),
        lastSentAt: invoice.lastSentAt ?? undefined,
        internalNote: invoice.internalNote ?? undefined,
        followUpOn: invoice.followUpOn ?? undefined,
        items: mergedItemsLabel,
        sourceType: invoice.sourceType,
        sourceId: invoice.sourceId ?? undefined,
        dueDate: invoice.dueDate,
        mergeId: invoice.sourceId?.startsWith("invoice-merge:")
          ? invoice.sourceId.slice("invoice-merge:".length)
          : undefined,
        voidedAt: invoice.voidedAt?.slice(0, 10) ?? undefined,
        voidReason: invoice.voidReason ?? undefined,
        cashEntryId: invoice.cashEntryId ?? undefined,
        cashIncluded: invoice.cashEntryId
          ? invoice.cashIncluded !== false
          : undefined,
        compensationAvailableOn:
          invoice.compensationAvailableOn ?? undefined,
        periodStart: invoice.items?.length
          ? invoice.items
              .map((item) => item.serviceDateSnapshot)
              .sort()[0]
          : undefined,
        periodEnd: invoice.items?.length
          ? invoice.items
              .map((item) => item.serviceDateSnapshot)
              .sort()
              .at(-1)
          : undefined,
        lines: lines.length
          ? lines
          : [
            {
              dogName: "Não se aplica",
              service: mergedItemsLabel,
              date: invoice.issuedAt?.slice(0, 10) ?? invoice.createdAt.slice(0, 10),
              amountCents: Math.max(0, invoice.totalCents),
            },
          ],
      };
    });
}

export function mapWorkspaceCreditPurchases(
  payload: WorkspaceReadyPayload,
): CreditPurchase[] {
  const customersById = new Map(
    payload.customers.map((customer) => [customer.id, customer]),
  );
  const servicesById = new Map(
    payload.serviceCatalog.map((service) => [service.id, service]),
  );

  return payload.billing.creditPurchases.flatMap((purchase) => {
    const serviceType = toCreditServiceType(
      servicesById.get(purchase.serviceCatalogId)?.code,
    );
    if (!serviceType) return [];

    return [
      {
        id: purchase.id,
        customerId: purchase.accountId,
        customerName:
          customersById.get(purchase.accountId)?.displayName ??
          "Cliente não encontrado",
        serviceType,
        units: Math.max(0, Math.trunc(purchase.creditUnits)),
        amountCents: Math.max(0, purchase.amountCents),
        standardValueCents: Math.max(0, purchase.standardValueCents),
        pricingProfile: purchase.pricingProfileSnapshot,
        suggestedUnitPriceCents:
          purchase.suggestedUnitPriceCents ?? undefined,
        suggestedAmountCents: purchase.suggestedAmountCents ?? undefined,
        status:
          purchase.status === "awaiting_payment"
            ? "awaiting_payment"
            : purchase.status === "paid"
              ? "paid"
              : "cancelled",
        createdAt: formatBrazilianDate(purchase.paidAt ?? purchase.createdAt),
        invoiceId: purchase.invoiceId,
      },
    ];
  });
}

export function mapWorkspaceReceipts(
  payload: WorkspaceReadyPayload,
): ServiceReceipt[] {
  const servicesById = new Map(
    payload.serviceCatalog.map((service) => [service.id, service]),
  );
  const itemServiceType = new Map<string, CreditServiceType>();
  for (const appointment of payload.agenda) {
    for (const item of appointment.items) {
      const serviceType = toCreditServiceType(
        servicesById.get(item.serviceCatalogId)?.code,
      );
      if (serviceType) itemServiceType.set(item.id, serviceType);
    }
  }

  return payload.billing.creditReceipts.flatMap((receipt) => {
    const serviceType =
      itemServiceType.get(receipt.appointmentItemId) ??
      creditServiceTypeFromName(receipt.serviceNameSnapshot);
    if (!serviceType) return [];

    const channels = extractDeliveryChannels(receipt.deliveryChannels);
    const sentBy = channels.find(
      (channel): channel is "whatsapp" | "email" =>
        channel === "whatsapp" || channel === "email",
    );

    return [
      {
        id: receipt.id,
        number: receipt.receiptNumber,
        customerId: receipt.accountId,
        customerName: receipt.customerNameSnapshot,
        dogName: receipt.dogNameSnapshot,
        serviceType,
        service: receipt.serviceNameSnapshot,
        date: formatBrazilianDate(receipt.serviceDateSnapshot),
        creditUnits: Math.max(1, Math.trunc(receipt.creditUnits)),
        deliveryStatus:
          receipt.deliveryStatus === "sent" ? "sent" : "ready",
        sentBy:
          receipt.deliveryStatus === "sent" ? sentBy : undefined,
      },
    ];
  });
}

export function mapWorkspaceDogs(
  payload: WorkspaceReadyPayload,
  creditBalances: CreditBalances,
  referenceDate = payload.range.from,
  mappedBookings?: Booking[],
): Dog[] {
  const customersById = new Map(
    payload.customers.map((customer) => [customer.id, customer]),
  );
  const bookings = mappedBookings ?? mapWorkspaceBookings(payload);
  const bookingsByDog = new Map<string, Booking[]>();
  for (const booking of bookings) {
    if (booking.status === "cancelled" || booking.date < referenceDate) {
      continue;
    }
    const dogBookings = bookingsByDog.get(booking.dogId) ?? [];
    dogBookings.push(booking);
    bookingsByDog.set(booking.dogId, dogBookings);
  }

  return payload.dogs
    .filter((dog) => dog.status === "active")
    .map((dog) => {
      const dogBookings = (bookingsByDog.get(dog.id) ?? []).sort(
        compareBookings,
      );
      const todayBooking = dogBookings.find(
        (booking) => booking.date === referenceDate,
      );
      const nextBooking = dogBookings[0];
      const accountCredits =
        creditBalances[dog.accountId] ?? emptyCreditBalance();

      return {
        id: dog.id,
        name: dog.name,
        initials: initialsFor(dog.name),
        breed: dog.breed?.trim() || "Raça não informada",
        age: ageLabel(dog.birthDate, referenceDate),
        birthDate: dog.birthDate ?? undefined,
        sex: dog.sex,
        neutered: dog.neutered,
        feedingNotes: dog.feedingNotes ?? undefined,
        temperamentNotes: dog.temperamentNotes ?? undefined,
        medicationNotes: dog.medicationNotes ?? undefined,
        vaccines: parseVaccines(dog.vaccinesJson),
        photoUrl: dog.photoObjectKey ? `/api/dogs/${dog.id}?photo=1` : undefined,
        customerId: dog.accountId,
        customerName:
          customersById.get(dog.accountId)?.displayName ??
          "Cliente não encontrado",
        color: stableDogColor(dog.id),
        vaccinesCurrent: dog.vaccinesCurrent === true,
        today: todayBooking
          ? `${statusLabels[todayBooking.status]} · ${todayBooking.service}`
          : "Sem atendimento hoje",
        nextService: nextBooking
          ? nextServiceLabel(nextBooking, referenceDate)
          : "Nenhum atendimento agendado",
        alert:
          firstNonEmpty(
            dog.emergencyNotes,
            dog.healthNotes,
          ) ?? undefined,
        credits: creditServiceTypes.flatMap((serviceType) => {
          const value = accountCredits[serviceType] ?? 0;
          return value > 0
            ? [{ label: serviceLabels[serviceType], value }]
            : [];
        }),
      };
    });
}

export function mapWorkspaceServicePrices(
  payload: WorkspaceReadyPayload,
): Record<ServiceType, number> {
  const prices = { ...defaultServicePrices };
  for (const service of payload.serviceCatalog) {
    if (!service.active) continue;
    prices[toUiServiceType(service.code)] = Math.max(
      0,
      Math.trunc(service.basePriceCents),
    );
  }
  return prices;
}

export function mapWorkspaceActivities(
  payload: WorkspaceReadyPayload,
): AuditActivity[] {
  return payload.activities.map((event) => {
    const occurredAt = new Date(event.occurredAt);
    const occurredOn = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: payload.establishment.timezone,
    }).format(occurredAt);
    return {
      id: event.id,
      time: new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: payload.establishment.timezone,
      }).format(occurredAt),
      occurredOn,
      actor: event.actorName
        ? `${event.actorName} · ${roleLabel(event.actorRole)}`
        : "Sistema",
      action: activityActionLabel(event.action),
      detail: activityDetail(event),
    };
  });
}

function activityDetail(event: WorkspaceAuditEvent) {
  const metadata = parseActivityMetadata(event.metadataJson);
  const parts: string[] = [];

  if (event.referenceNumber) {
    parts.push(
      event.entityType === "credit_receipt"
        ? `Recibo ${event.referenceNumber}`
        : `Fatura ${event.referenceNumber}`,
    );
  }
  if (event.subjectName?.trim()) parts.push(event.subjectName.trim());
  if (event.secondaryName?.trim()) parts.push(event.secondaryName.trim());
  if (event.serviceName?.trim()) parts.push(event.serviceName.trim());
  if (event.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(event.eventDate)) {
    parts.push(formatBrazilianDate(event.eventDate));
  }
  if (typeof event.amountCents === "number") {
    parts.push(
      new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(event.amountCents / 100),
    );
  }

  const previousStatus = activityStatusLabel(metadata.previousStatus);
  const nextStatus = activityStatusLabel(metadata.status ?? event.currentStatus);
  if (previousStatus && nextStatus && previousStatus !== nextStatus) {
    parts.push(`${previousStatus} → ${nextStatus}`);
  } else if (nextStatus && event.action === "appointment.status_changed") {
    parts.push(nextStatus);
  }

  if (event.action === "invoice.merged" && Array.isArray(metadata.sourceInvoiceNumbers)) {
    const numbers = metadata.sourceInvoiceNumbers.filter(
      (value): value is string => typeof value === "string" && Boolean(value.trim()),
    );
    if (numbers.length) parts.push(`Origem: ${numbers.map((number) => `#${number}`).join(", ")}`);
  }
  if (
    event.action === "invoice.merge_reversed" &&
    typeof metadata.mergedInvoiceNumber === "string" &&
    metadata.mergedInvoiceNumber.trim()
  ) {
    parts.push(`Fatura #${metadata.mergedInvoiceNumber.trim()}`);
  }

  if (event.reason?.trim()) parts.push(`Motivo: ${event.reason.trim()}`);
  if (!parts.length) {
    const metadataName = firstActivityMetadataText(metadata, [
      "name",
      "dogName",
      "customerName",
      "email",
      "title",
      "description",
    ]);
    if (metadataName) parts.push(metadataName);
  }
  return parts.length ? parts.join(" · ") : entityTypeLabel(event.entityType);
}

function parseActivityMetadata(value: string | null) {
  if (!value) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function firstActivityMetadataText(
  metadata: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    if (typeof metadata[key] === "string" && metadata[key].trim()) {
      return metadata[key].trim();
    }
  }
  return "";
}

function activityStatusLabel(value: unknown) {
  if (typeof value !== "string") return "";
  return statusLabels[value as BookingStatus] ?? value;
}

export function transformWorkspacePayload(
  payload: WorkspaceReadyPayload,
  options: { referenceDate?: string } = {},
): WorkspaceUiData {
  const operationalToday = options.referenceDate ?? payload.range.from;
  const creditBalances = mapWorkspaceCreditBalances(payload);
  const bookings = mapWorkspaceBookings(payload);

  return {
    operationalToday,
    customers: mapWorkspaceCustomers(
      payload,
      creditBalances,
      operationalToday,
    ),
    dogs: mapWorkspaceDogs(
      payload,
      creditBalances,
      operationalToday,
      bookings,
    ),
    bookings,
    billableServices: mapWorkspaceBillableServices(payload),
    tasks: mapWorkspaceTasks(payload, operationalToday),
    invoices: mapWorkspaceInvoices(payload, operationalToday),
    creditBalances,
    creditPurchases: mapWorkspaceCreditPurchases(payload),
    receipts: mapWorkspaceReceipts(payload),
    servicePrices: mapWorkspaceServicePrices(payload),
    activities: mapWorkspaceActivities(payload),
  };
}

function roleLabel(role: string) {
  if (role === "owner") return "Administrador";
  if (role === "finance") return "Financeiro";
  if (role === "staff") return "Equipe";
  if (role === "customer") return "Cliente";
  return "Sistema";
}

function activityActionLabel(action: string) {
  const labels: Record<string, string> = {
    "appointment.created": "Serviço agendado",
    "recurring_schedule.created": "Recorrência semanal criada",
    "recurring_schedule.cancelled": "Recorrência semanal cancelada",
    "appointment.updated": "Serviço atualizado",
    "appointment.cancelled": "Atendimento cancelado",
    "appointment.status_changed": "Situação do atendimento atualizada",
    "customer.created": "Cliente cadastrado",
    "customer.updated": "Cliente atualizado",
    "dog.created": "Cão cadastrado",
    "dog.updated": "Cadastro do cão atualizado",
    "task.created": "Tarefa criada",
    "task.status_changed": "Tarefa atualizada",
    "service_prices.updated": "Preços padrão atualizados",
    "credit_purchase.created": "Pacote de créditos vendido",
    "credit.consumed": "Crédito utilizado",
    "credit.adjusted": "Saldo de créditos ajustado",
    "credit_receipt.sent": "Recibo marcado como enviado",
    "credit_receipt.failed": "Falha no envio do recibo registrada",
    "invoice.created": "Cobrança preparada",
    "invoice.merged": "Faturas unificadas",
    "invoice.merge_reversed": "União de faturas desfeita",
    "invoice.payment_recorded": "Pagamento registrado",
    "invoice.payment_reversed": "Pagamento corrigido e estornado",
    "invoice.settlement_scheduled": "Recebimento em compensação registrado",
    "invoice.settlement_updated": "Data de compensação atualizada",
    "invoice.settlement_cancelled": "Compensação cancelada",
    "invoice.sent": "Fatura enviada",
    "invoice.note_updated": "Observação da fatura atualizada",
    "invoice.voided": "Fatura cancelada",
    "cash.entry_created": "Lançamento incluído no Caixa",
    "cash.entry_updated": "Lançamento do Caixa atualizado",
    "cash.entry_excluded": "Lançamento desconsiderado do Caixa",
    "cash.entry_restored": "Lançamento restaurado no Caixa",
    "cash.settings_updated": "Período do Caixa atualizado",
    "account.invited": "Convite de acesso criado",
    "account.invitation_resent": "Convite de acesso reenviado",
    "account.invitation_revoked": "Convite de acesso cancelado",
    "account.invitation_accepted": "Nova conta ativada",
    "account.disabled": "Acesso de conta encerrado",
    "account.reactivated": "Acesso de conta reativado",
    "auth.password_reset_requested": "Recuperação de senha solicitada",
    "auth.password_reset_requested_by_admin":
      "Administrador gerou recuperação de senha",
    "auth.password_reset_completed": "Senha redefinida",
    "customer.request_created": "Cliente enviou um pedido",
    "customer_request.approved": "Pedido de cliente aprovado",
    "customer_request.rejected": "Pedido de cliente não aprovado",
    "customer.profile_updated": "Cliente atualizou seus dados",
    "customer.archived": "Cliente inativado",
    "customer.deleted": "Cliente excluído",
    "dog.archived": "Cão inativado",
    "dog.deleted": "Cão excluído",
    "tasks.completed_cleared": "Tarefas concluídas removidas do quadro",
    "credit_package.created": "Pacote de créditos criado",
    "credit_package.updated": "Pacote de créditos atualizado",
  };
  return labels[action] ?? "Ação administrativa registrada";
}

function entityTypeLabel(entityType: string) {
  const labels: Record<string, string> = {
    appointment: "Atendimento",
    recurring_schedule: "Recorrência semanal",
    appointment_item: "Serviço",
    customer: "Cliente",
    dog: "Cão",
    task: "Tarefa",
    service_catalog: "Preço",
    credit_purchase: "Pacote",
    credit_movement: "Créditos",
    credit_receipt: "Recibo",
    invoice: "Cobrança",
    payment: "Pagamento",
    cash_entry: "Lançamento do Caixa",
    app_user: "Conta",
    account_invitation: "Convite",
    customer_request: "Pedido do cliente",
    customer_account: "Cadastro do cliente",
  };
  return labels[entityType] ?? "Registro";
}

function emptyCreditBalance(): Record<CreditServiceType, number> {
  return { daycare: 0, bath: 0, grooming: 0, transport: 0 };
}

function toCreditServiceType(
  code: WorkspaceServiceCode | string | null | undefined,
): CreditServiceType | null {
  const serviceType = toUiServiceType(code);
  return serviceType === "daycare" ||
    serviceType === "bath" ||
    serviceType === "grooming" || serviceType === "transport"
    ? serviceType
    : null;
}

function initialsFor(name: string) {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase("pt-BR");
  return `${words[0][0]}${words[words.length - 1][0]}`.toLocaleUpperCase(
    "pt-BR",
  );
}

function totalAvailableCredits(
  balance: Record<CreditServiceType, number> | undefined,
) {
  if (!balance) return 0;
  return creditServiceTypes.reduce(
    (total, serviceType) => total + Math.max(0, balance[serviceType] ?? 0),
    0,
  );
}

function creditLabel(total: number) {
  if (total <= 0) return "Sem créditos";
  return `${total} ${total === 1 ? "crédito disponível" : "créditos disponíveis"}`;
}

function taskDueLabel(task: WorkspaceTask, referenceDate: string) {
  if (!task.scheduledDate) return task.scheduledTime ?? "Sem horário";
  if (task.scheduledDate === referenceDate) {
    return task.scheduledTime ?? "Hoje";
  }
  const date = formatBrazilianDate(task.scheduledDate);
  return task.scheduledTime ? `${date} · ${task.scheduledTime}` : date;
}

function invoiceStatus(
  invoice: WorkspaceInvoice,
  referenceDate: string,
): Invoice["status"] {
  if (invoice.status === "void") return "void";
  if (invoice.status === "paid") return "paid";
  if (invoice.compensationAvailableOn) return "pending";
  return invoice.dueDate < referenceDate ? "overdue" : "pending";
}

function activeInvoiceStatus(
  invoice: WorkspaceInvoice,
  referenceDate: string,
): "pending" | "paid" | "overdue" {
  const status = invoiceStatus(invoice, referenceDate);
  return status === "void" ? "pending" : status;
}

function invoiceDueLabel(
  invoice: WorkspaceInvoice,
  referenceDate: string,
) {
  if (invoice.status === "draft") return "Em preparação";
  if (invoice.status === "void") {
    return invoice.voidedAt
      ? `Cancelada em ${formatBrazilianDate(invoice.voidedAt)}`
      : "Cancelada";
  }
  if (invoice.status === "paid") {
    return invoice.paidAt
      ? `Pago em ${formatBrazilianDate(invoice.paidAt)}`
      : "Pago";
  }
  if (invoice.compensationAvailableOn) {
    return `Em compensação · disponível em ${formatBrazilianDate(invoice.compensationAvailableOn)}`;
  }
  if (invoice.dueDate === referenceDate) return "Vence hoje";
  const date = formatBrazilianDate(invoice.dueDate);
  return invoice.dueDate < referenceDate
    ? `Venceu em ${date}`
    : `Vence em ${date}`;
}

function invoiceItemsLabel(
  invoice: WorkspaceInvoice,
  purchase: WorkspaceCreditPurchase | undefined,
  service: WorkspaceService | undefined,
) {
  if (invoice.items?.length) {
    const dogNames = [...new Set(invoice.items.map((item) => item.dogNameSnapshot))]
      .filter(Boolean);
    const firstItem = invoice.items[0];
    if (invoice.items.length === 1) {
      return `${firstItem.dogNameSnapshot} · ${firstItem.serviceNameSnapshot}`;
    }
    const dogsLabel =
      dogNames.length === 1
        ? dogNames[0]
        : `${dogNames.slice(0, 2).join(" · ")}${
            dogNames.length > 2 ? ` + ${dogNames.length - 2} cães` : ""
          }`;
    return `${dogsLabel} · ${invoice.items.length} ${
      invoice.items.length === 1 ? "serviço" : "serviços"
    }`;
  }

  if (purchase) {
    const type = toCreditServiceType(service?.code);
    const serviceName = type ? serviceLabels[type] : service?.name;
    const unitLabel =
      purchase.creditUnits === 1 ? "1 crédito" : `${purchase.creditUnits} créditos`;
    const creditDetail = `${unitLabel}${serviceName ? ` de ${serviceName}` : ""}`;
    const compact = (value: string) =>
      value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
    return compact(purchase.packageNameSnapshot).includes(compact(creditDetail))
      ? purchase.packageNameSnapshot
      : `${purchase.packageNameSnapshot} · ${creditDetail}`;
  }

  return invoice.sourceType === "credit_package"
    ? "Pacote de créditos"
    : invoice.sourceType === "lodging_deposit"
      ? "Sinal da hospedagem"
      : invoice.sourceType === "lodging_balance"
        ? "Saldo da hospedagem"
        : "Serviços faturados";
}

function formatBrazilianDate(value: string) {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(timestamp);
}

function formatMoney(valueCents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valueCents / 100);
}

function parseVaccines(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as { name?: unknown }).name === "string" &&
        typeof (item as { expiresOn?: unknown }).expiresOn === "string"
      ) {
        return [{
          name: (item as { name: string }).name,
          expiresOn: (item as { expiresOn: string }).expiresOn,
        }];
      }
      return [];
    });
  } catch {
    return [];
  }
}

function ageLabel(birthDate: string | null, referenceDate: string) {
  if (!birthDate) return "Idade não informada";
  const birth = parseIsoDate(birthDate);
  const reference = parseIsoDate(referenceDate);
  if (!birth || !reference || birth > reference) {
    return "Idade não informada";
  }

  let years = reference.getUTCFullYear() - birth.getUTCFullYear();
  let months = reference.getUTCMonth() - birth.getUTCMonth();
  if (reference.getUTCDate() < birth.getUTCDate()) months -= 1;
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years > 0) return `${years} ${years === 1 ? "ano" : "anos"}`;
  const safeMonths = Math.max(0, months);
  return `${safeMonths} ${safeMonths === 1 ? "mês" : "meses"}`;
}

function parseIsoDate(value: string) {
  const isoDate = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function stableDogColor(id: string) {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return dogColorTokens[hash % dogColorTokens.length];
}

function compareBookings(a: Booking, b: Booking) {
  return `${a.date}T${operationalTimeSortKey(a.time)}`.localeCompare(
    `${b.date}T${operationalTimeSortKey(b.time)}`,
  );
}

function nextServiceLabel(booking: Booking, referenceDate: string) {
  const date =
    booking.date === referenceDate
      ? "hoje"
      : booking.date === addDays(referenceDate, 1)
        ? "amanhã"
        : formatBrazilianDate(booking.date);
  return `${booking.service} · ${date}, ${operationalTimeLabel(booking.time)}`;
}

function operationalTimeSortKey(value: string) {
  if (value === "manha") return "08:00";
  if (value === "tarde") return "14:00";
  if (value === "noite") return "19:00";
  if (value === "Sem horário") return "99:99";
  return value;
}

function operationalTimeLabel(value: string) {
  if (value === "manha") return "Manhã";
  if (value === "tarde") return "Tarde";
  if (value === "noite") return "Noite";
  return value;
}

function addDays(date: string, days: number) {
  const parsed = parseIsoDate(date);
  if (!parsed) return date;
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function firstNonEmpty(...values: Array<string | null>) {
  return values.map((value) => value?.trim()).find(Boolean) ?? null;
}

function creditServiceTypeFromName(name: string) {
  const normalized = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
  if (normalized.includes("creche")) return "daycare";
  if (normalized.includes("banho")) return "bath";
  if (normalized.includes("tosa") || normalized.includes("higien")) {
    return "grooming";
  }
  return null;
}

function extractDeliveryChannels(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((channel): channel is string => typeof channel === "string");
  }
  if (typeof value === "string") {
    try {
      return extractDeliveryChannels(JSON.parse(value) as unknown);
    } catch {
      return [value];
    }
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.channels)) {
      return extractDeliveryChannels(record.channels);
    }
    return ["whatsapp", "email"].filter(
      (channel) => record[channel] === true,
    );
  }
  return [];
}
