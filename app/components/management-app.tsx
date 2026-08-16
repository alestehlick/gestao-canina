"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  BrazilianDateInput,
  formatBrazilianDate,
} from "@/app/components/brazilian-date-input";
import { CashView } from "@/app/components/cash-view";
import {
  describeStatementBalance,
  generateStatementPdf,
  type CustomerStatement,
} from "@/lib/statement-pdf";
import {
  auditFixtures,
  defaultServicePrices,
  demoBillableServices,
  demoBookings,
  demoCreditBalances,
  demoCreditPurchases,
  demoCustomers,
  demoDogs,
  demoInvoices,
  demoReceipts,
  demoTasks,
  serviceLabels,
  statusLabels,
  type AuditActivity,
  type BillableService,
  type Booking,
  type BookingStatus,
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
import {
  isReadyWorkspacePayload,
  mapWorkspaceActivities,
  mapWorkspaceInvoices,
  toWorkspaceServiceCode,
  transformWorkspacePayload,
  type WorkspaceOnboardingPayload,
  type WorkspacePayload,
  type WorkspaceReadyPayload,
  type WorkspaceCreditPurchase,
  type WorkspaceInvoice,
  type WorkspaceService,
} from "@/lib/workspace-data";
import {
  creditPricingFromEstablishment,
  creditPricingProfile,
  creditPricingProfileLabel,
  defaultCreditPricing,
  suggestedCreditTotalCents,
  suggestedCreditUnitCents,
  taxiDogRegularCents,
  type ActiveCreditServiceType,
  type CreditPricingContext,
  type CreditPricingSettings,
  type TaxiDogDistance,
} from "@/lib/credit-pricing";

type View =
  | "today"
  | "requests"
  | "dogs"
  | "customers"
  | "billing"
  | "cash"
  | "activity"
  | "settings"
  | "access";

type DialogKind =
  | "service"
  | "quickService"
  | "task"
  | "registration"
  | "editService"
  | "editDog"
  | "editCustomer"
  | "cancel"
  | "invoice"
  | "creditPackage"
  | "creditAdjustment"
  | "statement"
  | "receipt"
  | null;

type ToastState = {
  message: string;
  actionLabel?: string;
  action?: () => void;
};

type InvoiceState = {
  step: "review" | "code" | "paid";
  kind: "services" | "credit_package";
  invoice?: Invoice;
  selectedServices: BillableService[];
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  amountCents: number;
  creditPurchase?: Omit<CreditPurchase, "id" | "status" | "createdAt">;
};

function billableLongStayDiscountCents(
  service: BillableService,
  discountPercent: number,
) {
  const lodging = service.lodging;
  if (!lodging || lodging.nights < 10 || discountPercent < 1) return 0;

  const lodgingTotalCents = lodging.dailyRateCents
    ? Math.round(lodging.dailyRateCents * lodging.nights)
    : service.amountCents;
  const fullDiscountCents = Math.round(
    (lodgingTotalCents * discountPercent) / 100,
  );
  if (service.billingKind === "lodging_deposit") {
    return Math.round(
      (fullDiscountCents * (lodging.depositPercent ?? 0)) / 100,
    );
  }
  return Math.min(service.amountCents, fullDiscountCents);
}

function regularBillingAmountCents(service: BillableService) {
  const lodging = service.lodging;
  if (!lodging) return service.amountCents;

  if (lodging.dailyRateCents) {
    return Math.round(lodging.dailyRateCents * lodging.nights);
  }

  const depositPercent = lodging.depositPercent ?? 0;
  if (service.billingKind === "lodging_deposit" && depositPercent > 0) {
    return Math.round((service.amountCents * 100) / depositPercent);
  }
  if (service.billingKind === "lodging_balance" && depositPercent < 100) {
    return Math.round((service.amountCents * 100) / (100 - depositPercent));
  }
  return service.amountCents;
}

type BillingTab = "pending" | "history" | "credits";
type InvoiceListStatus =
  | "all"
  | "paid"
  | "overdue"
  | "pending"
  | "compensation"
  | "void";
type InvoiceListSort = "priority" | "customer" | "dueDate";
type AgendaServiceFilter =
  | "all"
  | "hotel"
  | "daycare"
  | "bath"
  | "transport";
type FinancialAccount = {
  id: string;
  name: string;
  institution: string | null;
  kind: "checking" | "savings" | "cash" | "other";
  active: boolean;
};
type RuntimeMode =
  | "loading"
  | "setup"
  | "login"
  | "onboarding"
  | "ready"
  | "demo"
  | "error";

type LodgingRateProfile =
  | "standard"
  | "daycare"
  | "additional_dog"
  | "daycare_additional_dog";

type LodgingPricing = {
  standardDailyRateCents: number;
  daycareDailyRateCents: number;
  additionalDogDailyRateCents: number;
  daycareAdditionalDogDailyRateCents: number;
  longStayDiscountPercent: number;
};

const defaultLodgingPricing: LodgingPricing = {
  standardDailyRateCents: 11_000,
  daycareDailyRateCents: 10_000,
  additionalDogDailyRateCents: 9_900,
  daycareAdditionalDogDailyRateCents: 9_000,
  longStayDiscountPercent: 5,
};

function lodgingRateProfile(
  daycareCustomer: boolean,
  additionalDog: boolean,
): LodgingRateProfile {
  if (daycareCustomer && additionalDog) return "daycare_additional_dog";
  if (daycareCustomer) return "daycare";
  if (additionalDog) return "additional_dog";
  return "standard";
}

function lodgingDailyRate(
  pricing: LodgingPricing,
  profile: LodgingRateProfile,
) {
  if (profile === "daycare") return pricing.daycareDailyRateCents;
  if (profile === "additional_dog") return pricing.additionalDogDailyRateCents;
  if (profile === "daycare_additional_dog") {
    return pricing.daycareAdditionalDogDailyRateCents;
  }
  return pricing.standardDailyRateCents;
}

function lodgingRateLabel(profile: LodgingRateProfile) {
  if (profile === "daycare") return "Cliente de creche";
  if (profile === "additional_dog") return "Segundo cão ou mais";
  if (profile === "daycare_additional_dog") {
    return "Cliente de creche · segundo cão ou mais";
  }
  return "Diária padrão";
}

function suggestedLodgingRateProfile(
  service: BillableService,
  bookings: Booking[],
  creditBalances: CreditBalances,
): LodgingRateProfile {
  const existingProfile = service.lodging?.rateProfile as
    | LodgingRateProfile
    | undefined;
  if (existingProfile) return existingProfile;

  const daycareCustomer =
    (creditBalances[service.customerId]?.daycare ?? 0) > 0 ||
    bookings.some(
      (booking) =>
        booking.customerId === service.customerId &&
        booking.serviceType === "daycare" &&
        booking.status !== "cancelled",
    );
  const checkIn = service.lodging?.checkInDate;
  const checkOut = service.lodging?.checkOutDate;
  const additionalDog = Boolean(
    checkIn &&
      checkOut &&
      bookings.some(
        (booking) =>
          booking.customerId === service.customerId &&
          booking.serviceType === "hotel" &&
          booking.status !== "cancelled" &&
          booking.dogName !== service.dogName &&
          booking.date <= checkOut &&
          (booking.endDate ?? booking.date) >= checkIn,
      ),
  );

  return lodgingRateProfile(daycareCustomer, additionalDog);
}

function creditUnitsForService(
  serviceType: ServiceType,
  transportDirection?: Booking["transportDirection"],
) {
  return serviceType === "transport" && transportDirection === "round_trip"
    ? 2
    : 1;
}

function creditUnitsForBooking(booking: Booking) {
  return creditUnitsForService(
    booking.serviceType,
    booking.transportDirection,
  );
}

type AuthStatusPayload = {
  setupRequired: boolean;
  authenticated: boolean;
  sessionExpiresAt?: string;
  configurationError?: boolean;
  identity?: {
    email: string;
    displayName: string;
    role: "owner" | "staff" | "finance" | "customer";
  };
};

const navItems: { id: View; label: string; shortLabel: string }[] = [
  { id: "today", label: "Hoje", shortLabel: "Hoje" },
  { id: "billing", label: "Cobranças", shortLabel: "Faturas" },
  { id: "requests", label: "Pedidos", shortLabel: "Pedidos" },
  { id: "dogs", label: "Cães", shortLabel: "Cães" },
  { id: "customers", label: "Clientes", shortLabel: "Clientes" },
  { id: "cash", label: "Caixa", shortLabel: "Caixa" },
  { id: "activity", label: "Atividades", shortLabel: "Ativ." },
  { id: "access", label: "Acessos", shortLabel: "Acessos" },
  { id: "settings", label: "Configurações", shortLabel: "Config." },
];

const pageCopy: Record<
  View,
  { eyebrow: string; title: string; description: string }
> = {
  today: {
    eyebrow: "Operação de hoje",
    title: "Um dia bem cuidado começa aqui.",
    description: "Agenda, presença e tarefas essenciais em uma única visão.",
  },
  requests: {
    eyebrow: "Portal do cliente",
    title: "Pedidos",
    description:
      "Analise solicitações de serviços e cancelamentos antes de alterar a agenda.",
  },
  dogs: {
    eyebrow: "Cadastro canino",
    title: "Cães",
    description: "Rotinas, alertas, tutores e histórico reunidos por cão.",
  },
  customers: {
    eyebrow: "Relacionamento",
    title: "Clientes",
    description: "Contatos, cães vinculados, créditos e situação financeira.",
  },
  billing: {
    eyebrow: "Financeiro",
    title: "Faturas",
    description: "Revise serviços concluídos e prepare as faturas para o cliente.",
  },
  cash: {
    eyebrow: "Controle financeiro",
    title: "Caixa",
    description:
      "Acompanhe entradas, saídas e o saldo real de cada período.",
  },
  activity: {
    eyebrow: "Rastreabilidade",
    title: "Atividades",
    description: "Histórico de ações importantes da equipe e do financeiro.",
  },
  access: {
    eyebrow: "Pessoas e segurança",
    title: "Acessos",
    description:
      "Convide funcionários e clientes, e encerre acessos quando necessário.",
  },
  settings: {
    eyebrow: "Administração",
    title: "Configurações",
    description: "Defina os valores padrão usados nos novos serviços.",
  },
};

const creditServiceTypes: CreditServiceType[] = [
  "daycare",
  "bath",
  "transport",
];

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

const operationalToday = todayInSaoPaulo();

class ApiRequestError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
  }
}

function isSessionError(error: unknown): error is ApiRequestError {
  return (
    error instanceof ApiRequestError &&
    (error.code === "authentication_required" ||
      error.code === "invalid_session" ||
      error.code === "session_expired")
  );
}

async function requestJson<T>(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(input, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "same-origin",
  });
  const payload = (await response.json().catch(() => null)) as
    | T
    | { error?: { code?: string; message?: string } }
    | null;
  if (!response.ok) {
    const apiError =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : undefined;
    throw new ApiRequestError(
      apiError?.message ?? "Não foi possível concluir esta ação.",
      apiError?.code,
    );
  }
  return payload as T;
}

function workspaceRequestUrl(referenceDate = operationalToday) {
  const from = shiftDate(referenceDate, -30);
  const to = shiftDate(referenceDate, 63);
  return `/api/workspace?from=${from}&to=${to}`;
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function formatToday() {
  return formatBrazilianDate(operationalToday);
}

function dateFromIso(value: string) {
  return new Date(`${value}T12:00:00Z`);
}

function shiftDate(value: string, days: number) {
  const next = dateFromIso(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function lodgingNightOptions(startDate: string, endDate: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
  ) {
    return [];
  }
  const calendarDays = Math.round(
    (dateFromIso(endDate).valueOf() - dateFromIso(startDate).valueOf()) /
      86_400_000,
  );
  if (calendarDays < 1) return [];
  return [calendarDays, calendarDays + 0.5];
}

function formatSelectedDate(value: string, compact = false) {
  void compact;
  return formatBrazilianDate(value);
}

function formatShortDate(value: string) {
  return formatBrazilianDate(value);
}

function formatNearbyDate(value: string) {
  const date = dateFromIso(value);
  const month = [
    "Jan",
    "Fev",
    "Mar",
    "Abr",
    "Mai",
    "Jun",
    "Jul",
    "Ago",
    "Set",
    "Out",
    "Nov",
    "Dez",
  ][date.getUTCMonth()];
  return `${String(date.getUTCDate()).padStart(2, "0")}-${month}`;
}

type InvoiceDeliveryChannel = "whatsapp" | "email" | "save";
type DayPeriod = "manha" | "tarde" | "noite";

const dayPeriodLabels: Record<DayPeriod, string> = {
  manha: "Manhã",
  tarde: "Tarde",
  noite: "Noite",
};

function isClockTime(value: string) {
  return /^\d{2}:\d{2}$/.test(value);
}

function isDayPeriod(value: string): value is DayPeriod {
  return value === "manha" || value === "tarde" || value === "noite";
}

function formatOperationalTime(value: string | undefined) {
  if (!value || value === "Sem horário") return "Sem horário";
  return isDayPeriod(value) ? dayPeriodLabels[value] : value;
}

function operationalTimeOrder(value: string) {
  if (isDayPeriod(value)) {
    return { manha: 8 * 60, tarde: 14 * 60, noite: 19 * 60 }[value];
  }
  if (!isClockTime(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function agendaBookingOrder(left: Booking, right: Booking) {
  const nameDifference = left.dogName.localeCompare(right.dogName, "pt-BR");
  if (nameDifference !== 0) return nameDifference;

  const leftTime = operationalTimeOrder(left.time) ?? Number.MAX_SAFE_INTEGER;
  const rightTime = operationalTimeOrder(right.time) ?? Number.MAX_SAFE_INTEGER;
  return leftTime - rightTime;
}

function invalidTimeOrder(start: string, end: string) {
  const startOrder = operationalTimeOrder(start);
  const endOrder = operationalTimeOrder(end);
  if (startOrder === null || endOrder === null) return false;
  if (isDayPeriod(start) && isDayPeriod(end)) return endOrder < startOrder;
  return endOrder <= startOrder;
}

function invoiceDateToken(value: string | undefined) {
  if (!value) return operationalToday;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (brazilian) return `${brazilian[3]}-${brazilian[2]}-${brazilian[1]}`;
  return operationalToday;
}

function invoiceFileName(state: InvoiceState) {
  const customer = normalize(state.customerName)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const dates =
    state.invoice?.lines
      .map((line) => invoiceDateToken(line.date))
      .filter(Boolean)
      .sort() ?? [];
  const start = invoiceDateToken(state.invoice?.periodStart ?? dates[0]);
  const end = invoiceDateToken(state.invoice?.periodEnd ?? dates.at(-1) ?? start);
  const period = start === end ? start : `${start}-a-${end}`;
  return `fatura-${customer || "cliente"}-${period}.pdf`;
}

function lodgingInvoiceDetail(lodging: {
  checkInDate: string;
  checkOutDate: string;
  nights: number;
}) {
  const nights = new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
  }).format(lodging.nights);
  return `Check-in: ${formatBrazilianDate(lodging.checkInDate)} · Check-out: ${formatBrazilianDate(lodging.checkOutDate)} · ${nights} ${lodging.nights === 1 ? "diária" : "diárias"}`;
}

function lodgingTableAmountCents(
  lodging: {
    nights: number;
    dailyRateCents?: number;
    tableDailyRateCents?: number;
    rateProfile?: string;
    longStayDiscountPercent?: number;
    longStayDiscountCents?: number;
    depositPercent?: number;
  },
  service: string,
) {
  const tableDailyRateCents =
    lodging.tableDailyRateCents ?? lodging.dailyRateCents;
  if (!tableDailyRateCents || tableDailyRateCents < 1) return undefined;
  const fullStayCents = Math.round(tableDailyRateCents * lodging.nights);
  if (service === "Sinal da hospedagem" && lodging.depositPercent) {
    return Math.round((fullStayCents * lodging.depositPercent) / 100);
  }
  if (service === "Saldo da hospedagem" && lodging.depositPercent) {
    return Math.round(
      (fullStayCents * (100 - lodging.depositPercent)) / 100,
    );
  }
  return fullStayCents;
}

type InvoiceDescriptionLine = {
  title: string;
  detail: string;
  amountCents: number;
  tableAmountCents?: number;
  longStayDiscountPercent?: number;
  longStayDiscountCents?: number;
};

function invoiceDescriptionLines(state: InvoiceState): InvoiceDescriptionLine[] {
  if (state.kind === "credit_package" && state.creditPurchase) {
    return [
      {
        title: `${state.creditPurchase.units} créditos de ${
          serviceLabels[state.creditPurchase.serviceType]
        }`,
        detail: "Pacote de créditos pré-pagos",
        amountCents: state.amountCents,
      },
    ];
  }
  if (state.selectedServices.length) {
    return state.selectedServices.map((service) => ({
      title: `${service.dogName} · ${service.service}`,
      detail: service.lodging
        ? lodgingInvoiceDetail(service.lodging)
        : service.date,
      amountCents: service.amountCents,
      tableAmountCents: service.lodging
        ? lodgingTableAmountCents(service.lodging, service.service)
        : undefined,
      longStayDiscountPercent: service.lodging?.longStayDiscountPercent,
      longStayDiscountCents: service.lodging?.longStayDiscountCents,
    }));
  }
  if (state.invoice?.lines.length) {
    return state.invoice.lines.map((line) => ({
      title: `${line.dogName} · ${line.service}`,
      detail: line.lodging
        ? lodgingInvoiceDetail(line.lodging)
        : formatShortDate(line.date),
      amountCents: line.amountCents,
      tableAmountCents: line.lodging
        ? lodgingTableAmountCents(line.lodging, line.service)
        : undefined,
      longStayDiscountPercent: line.lodging?.longStayDiscountPercent,
      longStayDiscountCents: line.lodging?.longStayDiscountCents,
    }));
  }
  return [
    {
      title: state.invoice?.items ?? "Serviços selecionados",
      detail: state.invoice?.due ?? "Vencimento conforme combinado",
      amountCents: state.amountCents,
    },
  ];
}

async function createInvoicePdf(state: InvoiceState) {
  const { jsPDF } = await import("jspdf");
  const document = new jsPDF({
    unit: "mm",
    format: "a4",
    orientation: "portrait",
  });
  const invoiceNumber = state.invoice?.number ?? "NOVA";
  const rows = invoiceDescriptionLines(state);
  const tableTotalCents = rows.reduce(
    (total, row) => total + (row.tableAmountCents ?? row.amountCents),
    0,
  );
  const longStayDiscountTotalCents = rows.reduce(
    (total, row) => total + Math.max(0, row.longStayDiscountCents ?? 0),
    0,
  );
  const hasLodging = rows.some((row) => row.tableAmountCents !== undefined);
  const issuedAt = formatBrazilianDate(
    state.invoice?.issuedAt ?? operationalToday,
  );

  document.setProperties({
    title: `Fatura ${invoiceNumber} · Hospet Quintal`,
    subject: `Fatura de serviços para ${state.customerName}`,
    author: "Hospet Quintal",
  });
  document.setTextColor(30, 55, 46);
  document.setFont("helvetica", "bold");
  document.setFontSize(15);
  document.text("Hospet Quintal", 18, 22);
  document.setTextColor(104, 111, 107);
  document.setFontSize(8);
  document.setFont("helvetica", "normal");
  document.text("Cuidado e bem-estar canino", 18, 29);
  document.setTextColor(30, 55, 46);
  document.setFont("helvetica", "bold");
  document.setFontSize(13);
  document.text("Fatura", 192, 22, { align: "right" });
  document.setTextColor(104, 111, 107);
  document.setFontSize(8);
  document.setFont("helvetica", "normal");
  document.text(`Nº ${invoiceNumber}`, 192, 29, { align: "right" });
  document.setDrawColor(209, 213, 210);
  document.setLineWidth(0.3);
  document.line(18, 38, 192, 38);

  document.setTextColor(38, 46, 41);
  document.setFont("helvetica", "bold");
  document.setFontSize(7.5);
  document.text("CLIENTE", 18, 52);
  document.text("EMISSÃO", 145, 52);
  document.setFont("helvetica", "normal");
  document.setFontSize(10.5);
  document.text(state.customerName, 18, 60);
  document.setFontSize(9);
  document.text(issuedAt, 145, 60);
  if (state.customerEmail) {
    document.setTextColor(91, 99, 94);
    document.setFontSize(8);
    document.text(state.customerEmail, 18, 66);
  }

  let y = 82;
  document.setTextColor(86, 93, 89);
  document.setFont("helvetica", "bold");
  document.setFontSize(7.5);
  document.text("DESCRIÇÃO", 18, y);
  document.text("VALOR", 192, y, { align: "right" });
  document.setDrawColor(209, 213, 210);
  document.line(18, y + 4, 192, y + 4);
  y += 14;

  for (const row of rows) {
    if (y > 246) {
      document.addPage();
      y = 24;
    }
    document.setTextColor(38, 46, 41);
    document.setFont("helvetica", "bold");
    document.setFontSize(10);
    const titleLines = document.splitTextToSize(row.title, 125) as string[];
    document.text(titleLines, 18, y);
    document.setFont("helvetica", "normal");
    document.text(formatCurrency(row.amountCents), 192, y, { align: "right" });
    if (row.tableAmountCents !== undefined) {
      document.setTextColor(128, 134, 131);
      document.setFontSize(7);
      document.text(
        `Tabela: ${formatCurrency(row.tableAmountCents)}`,
        192,
        y + 4,
        { align: "right" },
      );
    }
    const detailY = y + titleLines.length * 5;
    document.setTextColor(102, 108, 104);
    document.setFontSize(8.5);
    const detailLines = document.splitTextToSize(row.detail, 145) as string[];
    document.text(detailLines, 18, detailY);
    const discountY = detailY + detailLines.length * 4;
    if ((row.longStayDiscountCents ?? 0) > 0) {
      document.setTextColor(112, 118, 115);
      document.setFontSize(7.3);
      document.text(
        `Desconto por longa estadia (${row.longStayDiscountPercent}%): -${formatCurrency(row.longStayDiscountCents!)}`,
        18,
        discountY,
        { maxWidth: 125 },
      );
    }
    document.setDrawColor(232, 234, 232);
    const rowEnd = Math.max(
      discountY + ((row.longStayDiscountCents ?? 0) > 0 ? 4 : 0) + 3,
      row.tableAmountCents !== undefined ? y + 8 : 0,
    );
    document.line(18, rowEnd, 192, rowEnd);
    y = rowEnd + 8;
  }

  y = Math.min(Math.max(y + 4, 118), 252);
  document.setTextColor(91, 99, 94);
  document.setFont("helvetica", "normal");
  document.setFontSize(8);
  const totalLabelX = 132;
  document.text("Total", totalLabelX, y + 7);
  document.setTextColor(30, 55, 46);
  document.setFont("helvetica", "bold");
  document.setFontSize(13);
  document.text(formatCurrency(state.amountCents), 192, y + 7, {
    align: "right",
  });
  let totalDetailY = y + 13;
  if (longStayDiscountTotalCents > 0) {
    document.setTextColor(112, 118, 115);
    document.setFont("helvetica", "normal");
    document.setFontSize(7.5);
    document.text("Desconto por longa estadia", totalLabelX, totalDetailY);
    document.text(`-${formatCurrency(longStayDiscountTotalCents)}`, 192, totalDetailY, {
      align: "right",
    });
    totalDetailY += 6;
  }
  if (hasLodging) {
    document.setTextColor(112, 118, 115);
    document.setFont("helvetica", "normal");
    document.setFontSize(7.5);
    document.text("Total pela diária padrão", totalLabelX, totalDetailY);
    document.text(formatCurrency(tableTotalCents), 192, totalDetailY, {
      align: "right",
    });
  }
  document.setDrawColor(30, 55, 46);
  document.line(totalLabelX, y - 1, 192, y - 1);

  document.setTextColor(91, 99, 94);
  document.setFont("helvetica", "normal");
  document.setFontSize(8);
  document.text(
    "Esta fatura registra os serviços selecionados. Forma e confirmação do pagamento são combinadas diretamente com o cliente.",
    18,
    278,
    { maxWidth: 174 },
  );
  document.setDrawColor(224, 227, 225);
  document.line(18, 285, 192, 285);
  document.setFont("helvetica", "normal");
  document.text("Hospet Quintal · hospetquintal.com.br", 18, 289);

  const blob = document.output("blob");
  const filename = invoiceFileName(state);
  return {
    blob,
    file: new File([blob], filename, { type: "application/pdf" }),
    filename,
  };
}

function downloadInvoice(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function deliverInvoice(
  state: InvoiceState,
  channel: InvoiceDeliveryChannel,
) {
  const generated = await createInvoicePdf(state);
  const title = `Fatura ${state.invoice?.number ?? ""} · Hospet Quintal`.trim();
  const text = `Olá, ${state.customerName}. Segue a fatura do Hospet Quintal no valor de ${formatCurrency(
    state.amountCents,
  )}.`;
  const shareData: ShareData = {
    title,
    text,
    files: [generated.file],
  };

  const phone = state.customerPhone?.replace(/\D/g, "") ?? "";
  const normalizedPhone =
    phone.length === 10 || phone.length === 11 ? `55${phone}` : phone;
  const isWindowsWhatsApp =
    channel === "whatsapp" && /Windows/i.test(navigator.userAgent);

  if (isWindowsWhatsApp) {
    downloadInvoice(generated.blob, generated.filename);
    window.location.href = `whatsapp://send?phone=${normalizedPhone}&text=${encodeURIComponent(
      `${text}\n\nO PDF foi salvo em Downloads; anexe-o a esta conversa.`,
    )}`;
    return "downloaded";
  }

  if (
    channel !== "save" &&
    navigator.share &&
    (!navigator.canShare || navigator.canShare(shareData))
  ) {
    await navigator.share(shareData);
    return "shared";
  }

  downloadInvoice(generated.blob, generated.filename);
  if (channel === "save") return "saved";

  if (channel === "whatsapp") {
    window.open(
      `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(
        `${text}\n\nO PDF foi salvo neste aparelho; selecione-o para anexar se o menu de compartilhamento não aparecer.`,
      )}`,
      "_blank",
      "noopener,noreferrer",
    );
    return "downloaded";
  }

  const email =
    state.customerEmail && state.customerEmail !== "Não informado"
      ? state.customerEmail
      : "";
  window.location.href = `mailto:${encodeURIComponent(
    email,
  )}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(
    `${text}\n\nO PDF foi salvo neste aparelho para ser anexado à mensagem.`,
  )}`;
  return "downloaded";
}

function recurrenceDates(
  startDate: string,
  recurrence: "none" | "weekly",
  recurrenceCount = 12,
) {
  if (recurrence === "none") return [startDate];
  if (recurrence === "weekly") {
    return Array.from(
      { length: recurrenceCount },
      (_, index) => shiftDate(startDate, index * 7),
    );
  }
  return [startDate];
}

function totalCredits(
  balances: CreditBalances,
  customerId: string,
) {
  const customerBalance = balances[customerId];
  if (!customerBalance) return 0;
  return creditServiceTypes.reduce(
    (total, serviceType) => total + customerBalance[serviceType],
    0,
  );
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function nextStatus(booking: Booking): BookingStatus {
  const { status } = booking;
  const progression: Partial<Record<BookingStatus, BookingStatus>> = {
    scheduled: "confirmed",
    confirmed: "completed",
    completed: "scheduled",
  };
  return progression[status] ?? status;
}

function primaryAction(booking: Booking) {
  const { status } = booking;
  const actions: Partial<Record<BookingStatus, string>> = {
    scheduled: "Confirmar",
    confirmed: "Concluir atendimento",
    completed: "Reabrir",
  };
  return actions[status] ?? null;
}

export function ManagementApp() {
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("loading");
  const [workspacePayload, setWorkspacePayload] =
    useState<WorkspaceReadyPayload | null>(null);
  const [onboardingPayload, setOnboardingPayload] =
    useState<WorkspaceOnboardingPayload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [onboardingName, setOnboardingName] = useState("Hospet Quintal");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const busyActionRef = useRef<string | null>(null);
  const [cashExclusionInvoice, setCashExclusionInvoice] =
    useState<Invoice | null>(null);
  const [invoiceCorrection, setInvoiceCorrection] = useState<{
    kind: "unmerge";
    invoice: Invoice;
  } | null>(null);
  const [view, setView] = useState<View>("today");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dogs, setDogs] = useState<Dog[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [billableServices, setBillableServices] = useState<BillableService[]>(
    [],
  );
  const [creditBalances, setCreditBalances] = useState<CreditBalances>({});
  const [creditPurchases, setCreditPurchases] = useState<CreditPurchase[]>([]);
  const [receipts, setReceipts] = useState<ServiceReceipt[]>([]);
  const [activities, setActivities] = useState<AuditActivity[]>([]);
  const [financialAccounts, setFinancialAccounts] = useState<FinancialAccount[]>([]);
  const [servicePrices, setServicePrices] =
    useState<Record<ServiceType, number>>(defaultServicePrices);
  const [lodgingPricing, setLodgingPricing] =
    useState<LodgingPricing>(defaultLodgingPricing);
  const [creditPricing, setCreditPricing] =
    useState<CreditPricingSettings>(defaultCreditPricing);
  const [selectedDate, setSelectedDate] = useState(operationalToday);
  const [selectedBillables, setSelectedBillables] = useState<string[]>([]);
  const [selectedDogId, setSelectedDogId] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    null,
  );
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [registrationType, setRegistrationType] = useState<
    "choice" | "customer" | "dog"
  >("choice");
  const [agendaFilter, setAgendaFilter] = useState<
    "all" | "upcoming" | "completed"
  >("all");
  const [agendaServiceFilter, setAgendaServiceFilter] =
    useState<AgendaServiceFilter>("all");
  const [search, setSearch] = useState("");
  const [searchCursor, setSearchCursor] = useState(0);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null);
  const [bookingToEdit, setBookingToEdit] = useState<Booking | null>(null);
  const [editDraftType, setEditDraftType] =
    useState<ServiceType>("daycare");
  const [editDraftTransportDirection, setEditDraftTransportDirection] =
    useState<"one_way" | "round_trip">("one_way");
  const [editDraftGroomingAddon, setEditDraftGroomingAddon] = useState(false);
  const [editDraftHasDeposit, setEditDraftHasDeposit] = useState(false);
  const [editDraftDaycareCustomer, setEditDraftDaycareCustomer] =
    useState(false);
  const [editDraftAdditionalDog, setEditDraftAdditionalDog] = useState(false);
  const [editDraftDate, setEditDraftDate] = useState(operationalToday);
  const [editDraftEndDate, setEditDraftEndDate] = useState(
    shiftDate(operationalToday, 1),
  );
  const [editDraftLodgingNights, setEditDraftLodgingNights] = useState(1);
  const [dogToEdit, setDogToEdit] = useState<Dog | null>(null);
  const [customerToEdit, setCustomerToEdit] = useState<Customer | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [invoiceState, setInvoiceState] = useState<InvoiceState | null>(null);
  const [regularBillingService, setRegularBillingService] =
    useState<BillableService | null>(null);
  const [billingTab, setBillingTab] = useState<BillingTab>("pending");
  const [creditCustomerId, setCreditCustomerId] = useState<string>("");
  const [creditAdjustmentCustomerId, setCreditAdjustmentCustomerId] =
    useState<string>("");
  const [statementCustomerId, setStatementCustomerId] = useState<string>("");
  const [selectedReceipt, setSelectedReceipt] =
    useState<ServiceReceipt | null>(null);
  const [serviceDraftDogId, setServiceDraftDogId] = useState("");
  const [serviceDraftDogSearch, setServiceDraftDogSearch] = useState("");
  const [serviceDogPickerOpen, setServiceDogPickerOpen] = useState(false);
  const [serviceDraftType, setServiceDraftType] =
    useState<ServiceType>("daycare");
  const [serviceDraftTransportDirection, setServiceDraftTransportDirection] =
    useState<"one_way" | "round_trip">("one_way");
  const [serviceDraftGroomingAddon, setServiceDraftGroomingAddon] =
    useState(false);
  const [serviceDraftHasDeposit, setServiceDraftHasDeposit] = useState(false);
  const [serviceDraftDaycareCustomer, setServiceDraftDaycareCustomer] =
    useState(false);
  const [serviceDraftAdditionalDog, setServiceDraftAdditionalDog] =
    useState(false);
  const [serviceDraftDate, setServiceDraftDate] = useState(operationalToday);
  const [serviceDraftEndDate, setServiceDraftEndDate] = useState(
    shiftDate(operationalToday, 1),
  );
  const [serviceDraftLodgingNights, setServiceDraftLodgingNights] = useState(1);
  const [serviceDraftRecurrence, setServiceDraftRecurrence] = useState<
    "none" | "weekly"
  >("none");
  const [daycareStartTime, setDaycareStartTime] = useState("07:30");
  const [daycareEndTime, setDaycareEndTime] = useState("19:30");
  const [groomingAddonPriceCents, setGroomingAddonPriceCents] = useState(3_000);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const selectedDateRef = useRef(operationalToday);
  const workspaceRefreshRef = useRef<{
    key: string;
    promise: Promise<WorkspaceReadyPayload | null>;
  } | null>(null);
  const workspaceRefreshRevisionRef = useRef(0);

  const clearOperationalData = useCallback(() => {
    setWorkspacePayload(null);
    setOnboardingPayload(null);
    setBookings([]);
    setTasks([]);
    setDogs([]);
    setCustomers([]);
    setInvoices([]);
    setBillableServices([]);
    setCreditBalances({});
    setCreditPurchases([]);
    setReceipts([]);
    setActivities([]);
    setFinancialAccounts([]);
    setServicePrices(defaultServicePrices);
    setLodgingPricing(defaultLodgingPricing);
    setCreditPricing(defaultCreditPricing);
    setDaycareStartTime("07:30");
    setDaycareEndTime("19:30");
    setGroomingAddonPriceCents(3_000);
    setSelectedDogId(null);
    setSelectedCustomerId(null);
    setSelectedBillables([]);
    setSelectedReceipt(null);
    setBookingToCancel(null);
    setBookingToEdit(null);
    setDogToEdit(null);
    setCustomerToEdit(null);
    setCreditCustomerId("");
    setServiceDraftDogId("");
    setSearch("");
    setOpenMenuId(null);
    setInvoiceState(null);
    setDialog(null);
    setToast(null);
  }, []);

  const endSession = useCallback(
    (message = "Sua sessão terminou. Entre novamente para continuar.") => {
      clearOperationalData();
      setSessionExpiresAt(null);
      setRuntimeMode("login");
      setLoadError(message);
    },
    [clearOperationalData],
  );

  const activateDemo = useCallback(() => {
    setWorkspacePayload(null);
    setOnboardingPayload(null);
    setBookings(demoBookings);
    setTasks(demoTasks);
    setDogs(demoDogs);
    setCustomers(demoCustomers);
    setInvoices(demoInvoices);
    setBillableServices(demoBillableServices);
    setCreditBalances(demoCreditBalances);
    setCreditPurchases(demoCreditPurchases);
    setReceipts(demoReceipts);
    setActivities(auditFixtures);
    setServicePrices(defaultServicePrices);
    setLodgingPricing(defaultLodgingPricing);
    setCreditPricing(defaultCreditPricing);
    setGroomingAddonPriceCents(3_000);
    setSessionExpiresAt(null);
    setCreditCustomerId((current) => current || demoCustomers[0]?.id || "");
    setRuntimeMode("demo");
    setLoadError("");
  }, []);

  const applyReadyWorkspace = useCallback((payload: WorkspaceReadyPayload) => {
    const data = transformWorkspacePayload(payload, {
      referenceDate: operationalToday,
    });
    setWorkspacePayload(payload);
    setOnboardingPayload(null);
    setBookings(data.bookings);
    setTasks(data.tasks);
    setDogs(data.dogs);
    setCustomers(data.customers);
    setInvoices(data.invoices);
    setBillableServices(data.billableServices);
    setCreditBalances(data.creditBalances);
    setCreditPurchases(data.creditPurchases);
    setReceipts(data.receipts);
    setActivities(data.activities);
    setServicePrices(data.servicePrices);
    setLodgingPricing({
      standardDailyRateCents:
        payload.establishment.hotelStandardDailyRateCents ??
        defaultLodgingPricing.standardDailyRateCents,
      daycareDailyRateCents:
        payload.establishment.hotelDaycareDailyRateCents ??
        defaultLodgingPricing.daycareDailyRateCents,
      additionalDogDailyRateCents:
        payload.establishment.hotelAdditionalDogDailyRateCents ??
        defaultLodgingPricing.additionalDogDailyRateCents,
      daycareAdditionalDogDailyRateCents:
        payload.establishment.hotelDaycareAdditionalDogDailyRateCents ??
        defaultLodgingPricing.daycareAdditionalDogDailyRateCents,
      longStayDiscountPercent:
        payload.establishment.hotelLongStayDiscountPercent ??
        defaultLodgingPricing.longStayDiscountPercent,
    });
    setCreditPricing(creditPricingFromEstablishment(payload.establishment));
    setGroomingAddonPriceCents(
      payload.establishment.bathGroomingAddonCents ?? 3_000,
    );
    setDaycareStartTime(payload.establishment.daycareStartTime || "07:30");
    setDaycareEndTime(payload.establishment.daycareEndTime || "19:30");
    setCreditCustomerId((current) =>
      data.customers.some((customer) => customer.id === current)
        ? current
        : data.customers[0]?.id ?? "",
    );
    setRuntimeMode("ready");
    setLoadError("");
  }, []);

  const refreshWorkspace = useCallback(
    (
      options: {
        allowDemoFallback?: boolean;
        referenceDate?: string;
        force?: boolean;
      } = {},
    ): Promise<WorkspaceReadyPayload | null> => {
      const referenceDate =
        options.referenceDate ?? selectedDateRef.current;
      const key = `${referenceDate}:${options.allowDemoFallback ? "demo" : "live"}`;
      if (!options.force && workspaceRefreshRef.current?.key === key) {
        return workspaceRefreshRef.current.promise;
      }
      const revision = ++workspaceRefreshRevisionRef.current;

      const promise = (async () => {
        try {
          const payload = await requestJson<WorkspacePayload>(
            workspaceRequestUrl(referenceDate),
          );
          if (isReadyWorkspacePayload(payload)) {
            if (revision === workspaceRefreshRevisionRef.current) {
              applyReadyWorkspace(payload);
            }
            return payload;
          }
          if (revision !== workspaceRefreshRevisionRef.current) return null;
          setWorkspacePayload(null);
          setOnboardingPayload(payload);
          setRuntimeMode("onboarding");
          setLoadError("");
          return null;
        } catch (error) {
          if (revision !== workspaceRefreshRevisionRef.current) return null;
          if (isSessionError(error)) {
            endSession();
            return null;
          }
          if (
            options.allowDemoFallback &&
            process.env.NODE_ENV !== "production"
          ) {
            activateDemo();
            return null;
          }
          setRuntimeMode("error");
          setLoadError(
            error instanceof Error
              ? error.message
              : "Não foi possível abrir a área administrativa.",
          );
          return null;
        }
      })();
      workspaceRefreshRef.current = { key, promise };
      void promise.finally(() => {
        if (workspaceRefreshRef.current?.promise === promise) {
          workspaceRefreshRef.current = null;
        }
      });
      return promise;
    },
    [activateDemo, applyReadyWorkspace, endSession],
  );

  const initializeApplication = useCallback(async () => {
    try {
      const status = await requestJson<AuthStatusPayload>("/api/auth/status");
      if (status.configurationError) {
        throw new ApiRequestError(
          "A configuração de acesso está incompleta. Nenhum dado foi exposto.",
          "auth_configuration_incomplete",
        );
      }
      if (status.setupRequired) {
        clearOperationalData();
        setSessionExpiresAt(null);
        setRuntimeMode("setup");
        return;
      }
      if (!status.authenticated) {
        clearOperationalData();
        setSessionExpiresAt(null);
        setRuntimeMode("login");
        return;
      }
      if (status.identity?.role === "customer") {
        window.location.assign("/portal");
        return;
      }
      setSessionExpiresAt(status.sessionExpiresAt ?? null);
      await refreshWorkspace();
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        activateDemo();
        return;
      }
      setRuntimeMode("error");
      setLoadError(
        error instanceof Error
          ? error.message
          : "Não foi possível verificar o acesso.",
      );
    }
  }, [activateDemo, clearOperationalData, refreshWorkspace]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void initializeApplication();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initializeApplication]);

  useEffect(() => {
    if (
      runtimeMode !== "ready" ||
      !workspacePayload ||
      !["owner", "finance"].includes(workspacePayload.identity.role)
    ) {
      return;
    }
    let active = true;
    void requestJson<{ accounts: FinancialAccount[] }>("/api/financial-accounts")
      .then((result) => {
        if (active) setFinancialAccounts(result.accounts);
      })
      .catch(() => {
        if (active) setFinancialAccounts([]);
      });
    return () => {
      active = false;
    };
  }, [runtimeMode, workspacePayload]);

  const revalidateSession = useCallback(async () => {
    try {
      const status = await requestJson<AuthStatusPayload>("/api/auth/status");
      if (
        status.configurationError ||
        status.setupRequired ||
        !status.authenticated ||
        !status.sessionExpiresAt
      ) {
        endSession();
        return;
      }
      setSessionExpiresAt(status.sessionExpiresAt);
    } catch (error) {
      if (isSessionError(error)) {
        endSession();
      }
    }
  }, [endSession]);

  useEffect(() => {
    if (runtimeMode !== "ready") return;

    const expiresAtMs = sessionExpiresAt
      ? Date.parse(sessionExpiresAt)
      : Number.NaN;
    const expiryDelay = Number.isFinite(expiresAtMs)
      ? Math.max(0, expiresAtMs - Date.now())
      : 0;
    const expiryTimer = window.setTimeout(() => endSession(), expiryDelay);
    const interval = window.setInterval(() => {
      void revalidateSession();
    }, 5 * 60 * 1_000);
    const onReturn = () => {
      if (document.visibilityState === "visible") {
        void revalidateSession();
      }
    };

    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      window.clearTimeout(expiryTimer);
      window.clearInterval(interval);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [endSession, revalidateSession, runtimeMode, sessionExpiresAt]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (runtimeMode !== "ready" || !workspacePayload) return;
    if (
      selectedDate >= workspacePayload.range.from &&
      selectedDate <= workspacePayload.range.to
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshWorkspace({ referenceDate: selectedDate });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [refreshWorkspace, runtimeMode, selectedDate, workspacePayload]);

  useEffect(() => {
    function onEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (dialog) {
        setDialog(null);
        setBookingToCancel(null);
        setBookingToEdit(null);
        setDogToEdit(null);
        setCustomerToEdit(null);
      } else if (search) {
        setSearch("");
      }
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [dialog, search]);

  useEffect(() => {
    titleRef.current?.focus();
  }, [view, selectedDogId, selectedCustomerId, billingTab]);

  const searchResults = useMemo(() => {
    if (normalize(search).length < 2) return [];
    const query = normalize(search);
    const dogResults = dogs
      .filter(
        (dog) =>
          normalize(dog.name).includes(query) ||
          normalize(dog.customerName).includes(query),
      )
      .map((dog) => ({
        id: dog.id,
        type: "dog" as const,
        title: dog.name,
        detail: `${dog.breed} · ${dog.customerName}`,
      }));
    const customerResults = customers
      .filter(
        (customer) =>
          normalize(customer.name).includes(query) ||
          normalize(customer.phone).includes(query) ||
          normalize(customer.email).includes(query),
      )
      .map((customer) => ({
        id: customer.id,
        type: "customer" as const,
        title: customer.name,
        detail: `${customer.phone} · ${customer.dogIds.length} ${
          customer.dogIds.length === 1 ? "cão" : "cães"
        }`,
      }));

    return [...dogResults, ...customerResults].slice(0, 6);
  }, [customers, dogs, search]);

  async function runLiveAction<T>(
    key: string,
    action: () => Promise<T>,
    options: {
      successMessage?: string;
      refresh?: boolean;
    } = {},
  ): Promise<T | undefined> {
    if (busyActionRef.current) return undefined;
    busyActionRef.current = key;
    setBusyAction(key);
    try {
      const result = await action();
      if (options.refresh !== false) {
        // Confirma a ação assim que a gravação termina e sincroniza a visão
        // completa em segundo plano. Isso evita que cada botão espere uma nova
        // leitura de toda a área de trabalho.
        void refreshWorkspace({ force: true });
      }
      if (options.successMessage) {
        setToast({ message: options.successMessage });
      }
      return result;
    } catch (error) {
      if (
        error instanceof ApiRequestError &&
        (error.code === "authentication_required" ||
          error.code === "invalid_session" ||
          error.code === "session_expired")
      ) {
        endSession();
        return undefined;
      }
      setToast({
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível concluir esta ação.",
      });
      return undefined;
    } finally {
      busyActionRef.current = null;
      setBusyAction(null);
    }
  }

  async function toggleInvoiceCash(
    invoice: Invoice,
    exclusionReason?: string,
  ) {
    if (invoice.status !== "paid") return;
    if (!invoice.cashEntryId) {
      setToast({
        message:
          "Este pagamento ainda não possui um lançamento no Caixa. Atualize a página e tente novamente.",
      });
      return;
    }
    const nextIncluded = invoice.cashIncluded === false;
    const reason = exclusionReason?.trim();
    if (!nextIncluded) {
      if (!reason) {
        setCashExclusionInvoice(invoice);
        return;
      }
    }

    setInvoices((current) =>
      current.map((item) =>
        item.id === invoice.id
          ? { ...item, cashIncluded: nextIncluded }
          : item,
      ),
    );
    if (runtimeMode === "ready") {
      const result = await runLiveAction(
        `cash-invoice:${invoice.id}`,
        () =>
          requestJson(`/api/cash/${invoice.cashEntryId}`, {
            method: "PATCH",
            body: JSON.stringify({
              action: nextIncluded ? "restore" : "exclude",
              reason,
            }),
          }),
        { refresh: true },
      );
      if (!result) {
        setInvoices((current) =>
          current.map((item) =>
            item.id === invoice.id
              ? { ...item, cashIncluded: invoice.cashIncluded }
              : item,
          ),
        );
      }
    }
    setCashExclusionInvoice(null);
  }

  function navigate(nextView: View) {
    setSelectedDogId(null);
    setSelectedCustomerId(null);
    setView(nextView);
    setOpenMenuId(null);
  }

  function selectAgendaDate(value: string) {
    selectedDateRef.current = value;
    setSelectedDate(value);
  }

  function openServiceDialog(dogId = "") {
    setServiceDraftDogId(dogId);
    setServiceDraftDogSearch(
      dogs.find((dog) => dog.id === dogId)?.name ?? "",
    );
    setServiceDogPickerOpen(false);
    setServiceDraftType("daycare");
    setServiceDraftHasDeposit(false);
    setServiceDraftDaycareCustomer(false);
    setServiceDraftAdditionalDog(false);
    setServiceDraftRecurrence("none");
    setServiceDraftDate(selectedDateRef.current);
    setServiceDraftEndDate(shiftDate(selectedDateRef.current, 1));
    setServiceDraftLodgingNights(1);
    setDialog("service");
  }

  async function createQuickServices(payload: {
    dogIds: string[];
    serviceCatalogIds: string[];
    date: string;
    endDate?: string;
    startTime?: string;
    endTime?: string;
    transportDirection: "one_way" | "round_trip";
    lodgingNights?: number;
    depositPercent?: number | null;
    lodgingDaycareCustomer?: boolean;
    internalNotes?: string;
  }) {
    if (runtimeMode !== "ready") return false;
    const result = await runLiveAction(
      "quick-services",
      () => requestJson<{ created: number }>("/api/appointments/batch", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
      {
        refresh: true,
        successMessage: "Agendamentos criados e mantidos individualmente na Agenda.",
      },
    );
    if (!result) return false;
    setDialog(null);
    setSelectedDate(payload.date);
    return true;
  }

  function openSearchResult(result: (typeof searchResults)[number]) {
    if (result.type === "dog") {
      setSelectedDogId(result.id);
      setSelectedCustomerId(null);
      setView("dogs");
    } else {
      setSelectedCustomerId(result.id);
      setSelectedDogId(null);
      setView("customers");
    }
    setSearch("");
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!searchResults.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSearchCursor((current) => (current + 1) % searchResults.length);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSearchCursor(
        (current) => (current - 1 + searchResults.length) % searchResults.length,
      );
    }
    if (event.key === "Enter") {
      event.preventDefault();
      openSearchResult(searchResults[searchCursor]);
    }
  }

  async function updateBookingStatus(
    booking: Booking,
    status: BookingStatus,
    recurrenceScope: "occurrence" | "future" | "series" = "occurrence",
  ) {
    const previous = booking.status;

    if (runtimeMode === "ready") {
      const previousBookings = bookings;
      setBookings((current) =>
        current.map((item) =>
          ((recurrenceScope === "series" ||
            (recurrenceScope === "future" && item.date >= booking.date)) &&
            booking.recurringScheduleId &&
            item.recurringScheduleId === booking.recurringScheduleId &&
            item.status !== "completed" &&
            item.status !== "cancelled") ||
          item.id === booking.id
            ? { ...item, status }
            : item
        ),
      );
      const result = await runLiveAction(
        `appointment:${booking.id}`,
        () =>
          requestJson<{ appointment: { id: string; status: BookingStatus } }>(
            `/api/appointments/${booking.id}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                status,
                ...(status === "cancelled" && booking.note
                  ? {
                      cancellationReason: booking.note,
                      recurrenceScope,
                    }
                  : {}),
              }),
            },
          ),
        { refresh: true },
      );
      if (result) {
        setOpenMenuId(null);
        setToast({
          message:
            status === "completed"
              ? `Atendimento de ${booking.dogName} concluído. Escolha em Cobranças entre usar créditos ou gerar fatura.`
              : status === "cancelled"
                ? recurrenceScope === "series"
                  ? `Recorrência de ${booking.dogName} cancelada.`
                  : recurrenceScope === "future"
                    ? `Agendamentos de ${booking.dogName} cancelados deste dia em diante.`
                  : `Atendimento de ${booking.dogName} cancelado.`
                : previous === "completed"
                  ? `Atendimento de ${booking.dogName} reaberto.`
                : `Situação de ${booking.dogName} atualizada.`,
        });
      } else {
        setBookings(previousBookings);
      }
      return;
    }

    if (previous === "completed" && status !== "completed") {
      if (
        booking.settlementStatus === "credit_used" &&
        creditServiceTypes.includes(booking.serviceType as CreditServiceType)
      ) {
        const serviceType = booking.serviceType as CreditServiceType;
        const nextBalances: CreditBalances = {
          ...creditBalances,
          [booking.customerId]: {
            ...(creditBalances[booking.customerId] ?? {
              daycare: 0,
              bath: 0,
              grooming: 0,
              transport: 0,
            }),
            [serviceType]:
              (creditBalances[booking.customerId]?.[serviceType] ?? 0) +
              creditUnitsForBooking(booking),
          },
        };
        setCreditBalances(nextBalances);
        setCustomers((current) =>
          current.map((customer) =>
            customer.id === booking.customerId
              ? {
                  ...customer,
                  creditsLabel: `${totalCredits(nextBalances, customer.id)} créditos disponíveis`,
                }
              : customer,
          ),
        );
        setReceipts((current) =>
          current.filter((receipt) => receipt.number !== booking.receiptNumber),
        );
      }
      if (booking.settlementStatus === "invoice_pending") {
        setBillableServices((current) =>
          current.filter((service) => service.id !== `bill-${booking.id}`),
        );
      }
    }

    if (
      status === "completed" &&
      !billableServices.some((service) => service.id === `bill-${booking.id}`)
    ) {
      setBillableServices((current) => [
        {
          id: `bill-${booking.id}`,
          customerId: booking.customerId,
          customerName: booking.customerName,
          dogName: booking.dogName,
          date: formatShortDate(booking.date),
          service: booking.service,
          serviceType: booking.serviceType,
          appointmentItemId: booking.itemId,
          creditUnits: creditServiceTypes.includes(
            booking.serviceType as CreditServiceType,
          )
            ? creditUnitsForBooking(booking)
            : undefined,
          amountCents: booking.priceCents,
        },
        ...current,
      ]);
    }

    setBookings((current) =>
      current.map((item) =>
        ((recurrenceScope === "series" ||
          (recurrenceScope === "future" && item.date >= booking.date)) &&
          booking.recurringScheduleId &&
          item.recurringScheduleId === booking.recurringScheduleId &&
          item.status !== "completed" &&
          item.status !== "cancelled") ||
        item.id === booking.id
          ? {
              ...item,
              note: booking.note,
              status,
              settlementStatus:
                status === "completed"
                  ? "invoice_pending"
                  : "pending",
              receiptNumber:
                status === "completed" ? item.receiptNumber : undefined,
            }
          : item,
      ),
    );
    setOpenMenuId(null);
    setToast({
      message:
        status === "completed"
          ? `Atendimento de ${booking.dogName} concluído.`
          : status === "cancelled"
            ? `Atendimento de ${booking.dogName} cancelado.`
            : `Situação de ${booking.dogName} atualizada.`,
      actionLabel: status === "completed" ? "Desfazer" : undefined,
      action:
        status === "completed"
          ? () => {
              setBookings((current) =>
                current.map((item) =>
                  item.id === booking.id
                    ? {
                        ...item,
                        status: previous,
                        settlementStatus: "pending",
                        receiptNumber: undefined,
                      }
                    : item,
                ),
              );
              setBillableServices((current) =>
                current.filter((service) => service.id !== `bill-${booking.id}`),
              );
              setToast({ message: "Conclusão desfeita." });
            }
          : undefined,
    });
  }

  function advanceBooking(booking: Booking) {
    updateBookingStatus(booking, nextStatus(booking));
  }

  function askToCancel(booking: Booking) {
    setBookingToCancel(booking);
    setDialog("cancel");
    setOpenMenuId(null);
  }

  function openBookingEditor(booking: Booking) {
    setBookingToEdit(booking);
    setEditDraftType(booking.serviceType === "grooming" ? "bath" : booking.serviceType);
    setEditDraftGroomingAddon(
      booking.groomingAddon === true || booking.serviceType === "grooming",
    );
    setEditDraftTransportDirection(
      booking.transportDirection ?? "one_way",
    );
    setEditDraftHasDeposit(Boolean(booking.depositPercent));
    setEditDraftDaycareCustomer(
      booking.lodgingRateProfile === "daycare" ||
        booking.lodgingRateProfile === "daycare_additional_dog",
    );
    setEditDraftAdditionalDog(
      booking.lodgingRateProfile === "additional_dog" ||
        booking.lodgingRateProfile === "daycare_additional_dog",
    );
    setEditDraftDate(booking.date);
    setEditDraftEndDate(
      booking.endDate ?? shiftDate(booking.date, 1),
    );
    setEditDraftLodgingNights(booking.lodgingNights ?? 1);
    setDialog("editService");
    setOpenMenuId(null);
  }

  function openDogEditor(dog: Dog) {
    setDogToEdit(dog);
    setDialog("editDog");
  }

  function openCustomerEditor(customer: Customer) {
    setCustomerToEdit(customer);
    setDialog("editCustomer");
  }

  async function submitBookingEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bookingToEdit) return;
    const form = new FormData(event.currentTarget);
    const date = String(form.get("date") ?? "");
    const time = String(form.get("time") ?? "");
    const endTime = String(form.get("endTime") ?? "");
    const endDate = String(form.get("endDate") ?? date);
    const serviceType = String(form.get("serviceType") ?? "") as ServiceType;
    const transportDirection: "one_way" | "round_trip" =
      String(form.get("transportDirection") ?? "one_way") === "round_trip"
        ? "round_trip"
        : "one_way";
    const groomingAddon =
      serviceType === "bath" && form.get("groomingAddon") === "on";
    const lodgingNights = Number(form.get("lodgingNights") ?? 0);
    const depositPercent =
      form.get("hasDeposit") === "on"
        ? Number(form.get("depositPercent") ?? 50)
        : null;
    const nextLodgingRateProfile = editDraftHasDeposit
      ? lodgingRateProfile(
          editDraftDaycareCustomer,
          editDraftAdditionalDog,
        )
      : undefined;
    if (
      !date ||
      !serviceType ||
      (serviceType !== "transport" &&
        serviceType !== "hotel" &&
        !time)
    ) {
      setToast({ message: "Revise os campos do serviço." });
      return;
    }
    if (time && endTime && invalidTimeOrder(time, endTime) && endDate === date) {
      setToast({ message: "O horário final deve ser posterior ao inicial." });
      return;
    }
    if (serviceType === "hotel") {
      const calendarDays = endDate
        ? Math.round(
            (dateFromIso(endDate).valueOf() - dateFromIso(date).valueOf()) /
              86_400_000,
          )
        : 0;
      if (
        calendarDays < 1 ||
        lodgingNights < 1 ||
        Math.round(lodgingNights * 2) !== lodgingNights * 2 ||
        lodgingNights < calendarDays ||
        lodgingNights > calendarDays + 0.5
      ) {
        setToast({
          message:
            "Revise a saída e as diárias. Use o período em dias ou acrescente meia diária.",
        });
        return;
      }
    }
    const note = String(form.get("note") ?? "").trim() || undefined;

    if (runtimeMode === "ready") {
      const service = workspacePayload?.serviceCatalog.find(
        (item) => item.code === toWorkspaceServiceCode(serviceType),
      );
      if (!service) {
        setToast({ message: "O serviço selecionado não está disponível." });
        return;
      }
      const result = await runLiveAction(
        `edit-appointment:${bookingToEdit.id}`,
        () =>
          requestJson<{ appointment: { id: string } }>(
            `/api/appointments/${bookingToEdit.id}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                startDate: date,
                endDate: serviceType === "hotel" ? endDate : date,
                startTime:
                  serviceType === "transport" ? null : time || null,
                endTime:
                  serviceType === "transport" ? null : endTime || null,
                serviceCatalogId: service.id,
                paymentPreference: "invoice" as const,
                internalNotes: note ?? null,
                transportDirection,
                groomingAddon,
                lodgingNights:
                  serviceType === "hotel" ? lodgingNights : null,
                depositPercent:
                  serviceType === "hotel" ? depositPercent : null,
                lodgingRateProfile:
                  serviceType === "hotel" ? nextLodgingRateProfile ?? null : null,
              }),
            },
          ),
        {
          refresh: true,
          successMessage: "Serviço atualizado.",
        },
      );
      if (result) {
        selectAgendaDate(date);
        setDialog(null);
        setBookingToEdit(null);
      }
      return;
    }

    setBookings((current) =>
      current
        .map((booking) =>
          booking.id === bookingToEdit.id
            ? {
                ...booking,
                date,
                endDate:
                  serviceType === "hotel" ? endDate : undefined,
                time:
                  serviceType === "transport"
                    ? "Sem horário"
                    : time || "Sem horário",
                endTime: endTime || undefined,
                lodgingNights:
                  serviceType === "hotel" ? lodgingNights : undefined,
                depositPercent:
                  serviceType === "hotel"
                    ? depositPercent ?? undefined
                    : undefined,
                lodgingRateProfile:
                  serviceType === "hotel"
                    ? nextLodgingRateProfile
                    : undefined,
                lodgingTableDailyRateCents:
                  serviceType === "hotel"
                    ? lodgingPricing.standardDailyRateCents
                    : undefined,
                serviceType,
                groomingAddon,
                service:
                  serviceType === "bath" && groomingAddon
                    ? "Banho e tosa"
                    : serviceLabels[serviceType],
                transportDirection:
                  serviceType === "transport"
                    ? transportDirection
                    : undefined,
                priceCents:
                  serviceType === "hotel"
                    ? lodgingDailyRate(
                        lodgingPricing,
                        nextLodgingRateProfile ?? "standard",
                      ) * lodgingNights
                    : (servicePrices[serviceType] +
                        (serviceType === "bath" && groomingAddon
                          ? groomingAddonPriceCents
                          : 0)) *
                      (serviceType === "transport" && transportDirection === "round_trip" ? 2 : 1),
                paymentPreference: "invoice" as const,
                note,
              }
            : booking,
        )
        .sort((a, b) =>
          `${a.date}-${a.time}`.localeCompare(`${b.date}-${b.time}`),
        ),
    );
    selectAgendaDate(date);
    setDialog(null);
    setBookingToEdit(null);
    setToast({ message: "Serviço atualizado." });
  }

  async function submitDogEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dogToEdit) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!name) {
      setToast({ message: "Informe o nome do cão." });
      return;
    }
    const updated: Dog = {
      ...dogToEdit,
      name,
      initials: initials(name),
      breed:
        String(form.get("breed") ?? "").trim() || "Raça não informada",
      age: String(form.get("age") ?? "").trim() || "Idade não informada",
      birthDate:
        String(form.get("birthDate") ?? "").trim() ||
        dogToEdit.birthDate,
      sex: String(form.get("sex") ?? "unknown") as Dog["sex"],
      neutered:
        String(form.get("neutered") ?? "") === "yes"
          ? true
          : String(form.get("neutered") ?? "") === "no"
            ? false
            : null,
      alert: String(form.get("alert") ?? "").trim() || undefined,
      vaccinesCurrent: form.get("vaccinesCurrent") === "on",
      feedingNotes: String(form.get("feedingNotes") ?? "").trim() || undefined,
      temperamentNotes: String(form.get("temperamentNotes") ?? "").trim() || undefined,
      medicationNotes: String(form.get("medicationNotes") ?? "").trim() || undefined,
      vaccines: [
        ...((dogToEdit.vaccines ?? []).filter((vaccine) => vaccine.name && vaccine.expiresOn)),
        ...(String(form.get("vaccineName") ?? "").trim() && String(form.get("vaccineExpiresOn") ?? "") ? [{ name: String(form.get("vaccineName") ?? "").trim(), expiresOn: String(form.get("vaccineExpiresOn") ?? "") }] : []),
      ],
    };

    if (runtimeMode === "ready") {
      const result = await runLiveAction(
        `edit-dog:${dogToEdit.id}`,
        () =>
          requestJson<{ dog: { id: string } }>(
            `/api/dogs/${dogToEdit.id}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                name: updated.name,
                breed:
                  updated.breed === "Raça não informada"
                    ? null
                    : updated.breed,
                emergencyNotes: updated.alert ?? null,
                vaccinesCurrent: updated.vaccinesCurrent,
                birthDate: updated.birthDate ?? null,
                sex: updated.sex,
                neutered: updated.neutered,
                feedingNotes: updated.feedingNotes ?? null,
                temperamentNotes: updated.temperamentNotes ?? null,
                medicationNotes: updated.medicationNotes ?? null,
                vaccines: updated.vaccines,
              }),
            },
          ),
        {
          refresh: true,
          successMessage: `Cadastro de ${updated.name} atualizado.`,
        },
      );
      if (result) {
        const photo = form.get("photo");
        if (photo instanceof File && photo.size) {
          const upload = new FormData();
          upload.set("photo", photo);
          await fetch(`/api/dogs/${dogToEdit.id}`, { method: "POST", body: upload, credentials: "same-origin" });
        }
        setDialog(null);
        setDogToEdit(null);
      }
      return;
    }

    setDogs((current) =>
      current.map((dog) => (dog.id === updated.id ? updated : dog)),
    );
    setBookings((current) =>
      current.map((booking) =>
        booking.dogId === updated.id
          ? { ...booking, dogName: updated.name }
          : booking,
      ),
    );
    setBillableServices((current) =>
      current.map((service) =>
        service.dogName === dogToEdit.name &&
        service.customerId === dogToEdit.customerId
          ? { ...service, dogName: updated.name }
          : service,
      ),
    );
    setReceipts((current) =>
      current.map((receipt) =>
        receipt.dogName === dogToEdit.name &&
        receipt.customerId === dogToEdit.customerId
          ? { ...receipt, dogName: updated.name }
          : receipt,
      ),
    );
    setDialog(null);
    setDogToEdit(null);
    setToast({ message: `Cadastro de ${updated.name} atualizado.` });
  }

  async function saveDogFeeding(dogId: string, feedingNotes: string) {
    const dog = dogs.find((item) => item.id === dogId);
    const cleanedNotes = feedingNotes.trim();
    if (!dog || !cleanedNotes) return false;

    setDogs((current) =>
      current.map((item) =>
        item.id === dogId ? { ...item, feedingNotes: cleanedNotes } : item,
      ),
    );

    if (runtimeMode === "ready") {
      const result = await runLiveAction(
        `feeding-notes:${dogId}`,
        () =>
          requestJson<{ dog: { id: string } }>(`/api/dogs/${dogId}`, {
            method: "PATCH",
            body: JSON.stringify({ feedingNotes: cleanedNotes }),
          }),
        {
          refresh: false,
          successMessage: `Alimentação de ${dog.name} salva.`,
        },
      );
      if (!result) {
        setDogs((current) =>
          current.map((item) =>
            item.id === dogId ? { ...item, feedingNotes: dog.feedingNotes } : item,
          ),
        );
        return false;
      }
      return true;
    }

    setToast({ message: `Alimentação de ${dog.name} salva.` });
    return true;
  }

  async function submitCustomerEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!customerToEdit) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!name) {
      setToast({ message: "Informe o nome do cliente." });
      return;
    }
    const updated: Customer = {
      ...customerToEdit,
      name,
      initials: initials(name),
      phone: String(form.get("phone") ?? "").trim() || "Não informado",
      email: String(form.get("email") ?? "").trim() || "Não informado",
      address: String(form.get("address") ?? "").trim() || undefined,
      cpf: String(form.get("cpf") ?? "").trim() || undefined,
      birthDate: String(form.get("birthDate") ?? "").trim() || undefined,
    };

    if (runtimeMode === "ready") {
      const phone =
        updated.phone === "Não informado" ? null : updated.phone;
      const email =
        updated.email === "Não informado" ? null : updated.email;
      if (!phone && !email) {
        setToast({
          message: "Informe ao menos um WhatsApp ou e-mail para o cliente.",
        });
        return;
      }
      const result = await runLiveAction(
        `edit-customer:${customerToEdit.id}`,
        () =>
          requestJson<{ customer: { id: string } }>(
            `/api/customers/${customerToEdit.id}`,
            {
              method: "PATCH",
              body: JSON.stringify({
                displayName: updated.name,
                fullName: updated.name,
                phone,
                email,
                whatsappEnabled: Boolean(phone),
                isFinancialContact: true,
                addressLine: updated.address ?? null,
                cpf: updated.cpf ?? null,
                birthDate: updated.birthDate ?? null,
              }),
            },
          ),
        {
          refresh: true,
          successMessage: "Cadastro do cliente atualizado.",
        },
      );
      if (result) {
        setDialog(null);
        setCustomerToEdit(null);
      }
      return;
    }

    setCustomers((current) =>
      current.map((customer) =>
        customer.id === updated.id ? updated : customer,
      ),
    );
    setDogs((current) =>
      current.map((dog) =>
        dog.customerId === updated.id
          ? { ...dog, customerName: updated.name }
          : dog,
      ),
    );
    setBookings((current) =>
      current.map((booking) =>
        booking.customerId === updated.id
          ? { ...booking, customerName: updated.name }
          : booking,
      ),
    );
    setInvoices((current) =>
      current.map((invoice) =>
        invoice.customerId === updated.id
          ? { ...invoice, customerName: updated.name }
          : invoice,
      ),
    );
    setBillableServices((current) =>
      current.map((service) =>
        service.customerId === updated.id
          ? { ...service, customerName: updated.name }
          : service,
      ),
    );
    setCreditPurchases((current) =>
      current.map((purchase) =>
        purchase.customerId === updated.id
          ? { ...purchase, customerName: updated.name }
          : purchase,
      ),
    );
    setReceipts((current) =>
      current.map((receipt) =>
        receipt.customerId === updated.id
          ? { ...receipt, customerName: updated.name }
          : receipt,
      ),
    );
    setDialog(null);
    setCustomerToEdit(null);
    setToast({ message: "Cadastro do cliente atualizado." });
  }

  async function archiveDogProfile() {
    if (!dogToEdit || !window.confirm(`Inativar ${dogToEdit.name}? Ele deixará de aparecer nos novos agendamentos.`)) {
      return;
    }
    if (runtimeMode === "ready") {
      const result = await runLiveAction(
        `archive-dog:${dogToEdit.id}`,
        () =>
          requestJson(`/api/dogs/${dogToEdit.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "archived" }),
          }),
        { refresh: true, successMessage: `${dogToEdit.name} foi inativado.` },
      );
      if (result) {
        setDialog(null);
        setDogToEdit(null);
        setSelectedDogId(null);
      }
      return;
    }
    setDogs((current) => current.filter((dog) => dog.id !== dogToEdit.id));
    setDialog(null);
    setDogToEdit(null);
    setSelectedDogId(null);
    setToast({ message: `${dogToEdit.name} foi inativado.` });
  }

  async function deleteDogProfile() {
    if (!dogToEdit || !window.confirm(`Excluir definitivamente ${dogToEdit.name}? Essa ação só funciona quando não há histórico.`)) {
      return;
    }
    if (runtimeMode === "ready") {
      const result = await runLiveAction(
        `delete-dog:${dogToEdit.id}`,
        () => requestJson(`/api/dogs/${dogToEdit.id}`, { method: "DELETE" }),
        { refresh: true, successMessage: `${dogToEdit.name} foi excluído.` },
      );
      if (result) {
        setDialog(null);
        setDogToEdit(null);
        setSelectedDogId(null);
      }
      return;
    }
    setDogs((current) => current.filter((dog) => dog.id !== dogToEdit.id));
    setDialog(null);
    setDogToEdit(null);
    setSelectedDogId(null);
    setToast({ message: `${dogToEdit.name} foi excluído.` });
  }

  async function archiveCustomerProfile() {
    if (!customerToEdit || !window.confirm(`Inativar ${customerToEdit.name} e seus cães? Eles deixarão de aparecer nos novos agendamentos.`)) {
      return;
    }
    if (runtimeMode === "ready") {
      const result = await runLiveAction(
        `archive-customer:${customerToEdit.id}`,
        () =>
          requestJson(`/api/customers/${customerToEdit.id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "archived" }),
          }),
        { refresh: true, successMessage: "Cliente inativado." },
      );
      if (result) {
        setDialog(null);
        setCustomerToEdit(null);
        setSelectedCustomerId(null);
      }
      return;
    }
    setCustomers((current) =>
      current.filter((customer) => customer.id !== customerToEdit.id),
    );
    setDogs((current) =>
      current.filter((dog) => dog.customerId !== customerToEdit.id),
    );
    setDialog(null);
    setCustomerToEdit(null);
    setSelectedCustomerId(null);
    setToast({ message: "Cliente inativado." });
  }

  async function deleteCustomerProfile() {
    if (!customerToEdit || !window.confirm(`Excluir definitivamente ${customerToEdit.name}? Essa ação só funciona quando não há histórico.`)) {
      return;
    }
    if (runtimeMode === "ready") {
      const result = await runLiveAction(
        `delete-customer:${customerToEdit.id}`,
        () =>
          requestJson(`/api/customers/${customerToEdit.id}`, {
            method: "DELETE",
          }),
        { refresh: true, successMessage: "Cliente excluído." },
      );
      if (result) {
        setDialog(null);
        setCustomerToEdit(null);
        setSelectedCustomerId(null);
      }
      return;
    }
    setCustomers((current) =>
      current.filter((customer) => customer.id !== customerToEdit.id),
    );
    setDogs((current) =>
      current.filter((dog) => dog.customerId !== customerToEdit.id),
    );
    setDialog(null);
    setCustomerToEdit(null);
    setSelectedCustomerId(null);
    setToast({ message: "Cliente excluído." });
  }

  async function submitCancellation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bookingToCancel) return;
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") ?? "").trim();
    if (!reason) {
      setToast({ message: "Informe o motivo do cancelamento." });
      return;
    }
    const recurrenceScope =
      bookingToCancel.recurringScheduleId
        ? (String(form.get("recurrenceScope") ?? "occurrence") as
            | "occurrence"
            | "future"
            | "series")
        : "occurrence";
    await updateBookingStatus(
      { ...bookingToCancel, note: reason },
      "cancelled",
      recurrenceScope,
    );
    setDialog(null);
    setBookingToCancel(null);
  }

  async function submitService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const dogId = String(form.get("dogId") ?? "");
    const dog = dogs.find((item) => item.id === dogId);
    const serviceType = String(form.get("serviceType") ?? "") as ServiceType;
    const date = String(form.get("date") ?? "");
    const time = String(form.get("time") ?? "");
    const endTime = String(form.get("endTime") ?? "");
    const endDate = String(form.get("endDate") ?? date);
    const lodgingNights = Number(form.get("lodgingNights") ?? 0);
    const depositPercent = form.get("hasDeposit") === "on" ? Number(form.get("depositPercent") ?? 50) : null;
    const transportDirection = String(form.get("transportDirection") ?? "one_way") === "round_trip" ? "round_trip" : "one_way";
    const groomingAddon =
      serviceType === "bath" && form.get("groomingAddon") === "on";
    const recurrence = String(form.get("recurrence") ?? "none") as
      | "none"
      | "weekly";
    const recurrenceCount =
      recurrence === "weekly"
        ? Number(form.get("recurrenceCount") ?? 12)
        : 1;

    if (!dog || !serviceType || !date || (serviceType !== "transport" && serviceType !== "hotel" && !time)) {
      setToast({ message: "Revise os campos obrigatórios." });
      return;
    }
    if (serviceType === "hotel") {
      const calendarDays = endDate
        ? Math.round(
            (dateFromIso(endDate).valueOf() - dateFromIso(date).valueOf()) /
              86_400_000,
          )
        : 0;
      if (
        calendarDays < 1 ||
        lodgingNights < 1 ||
        Math.round(lodgingNights * 2) !== lodgingNights * 2 ||
        lodgingNights < calendarDays ||
        lodgingNights > calendarDays + 0.5
      ) {
        setToast({
          message:
            "Revise a saída e as diárias. Use o período em dias ou acrescente meia diária.",
        });
        return;
      }
    }
    if (time && endTime && endDate === date && invalidTimeOrder(time, endTime)) {
      setToast({ message: "O horário final deve ser posterior ao inicial." });
      return;
    }
    if (
      !Number.isSafeInteger(recurrenceCount) ||
      recurrenceCount < 1 ||
      recurrenceCount > 52
    ) {
      setToast({ message: "Informe uma duração entre 1 e 52 semanas." });
      return;
    }
    const scheduledDates = recurrenceDates(
      date,
      recurrence,
      recurrenceCount,
    );
    const nextLodgingRateProfile = serviceDraftHasDeposit
      ? lodgingRateProfile(
          serviceDraftDaycareCustomer,
          serviceDraftAdditionalDog,
        )
      : undefined;
    const note = String(form.get("note") ?? "").trim() || undefined;

    if (runtimeMode === "ready") {
      const service = workspacePayload?.serviceCatalog.find(
        (item) => item.code === toWorkspaceServiceCode(serviceType),
      );
      if (!service) {
        setToast({ message: "O serviço selecionado não está disponível." });
        return;
      }
      const result = await runLiveAction(
        `new-service:${dog.id}`,
        () =>
          requestJson<{
            appointment: { id: string };
            appointments: Array<{ id: string }>;
          }>("/api/appointments", {
            method: "POST",
            body: JSON.stringify({
              dogId: dog.id,
              serviceCatalogId: service.id,
              startDate: date,
              endDate: serviceType === "hotel" ? endDate : date,
              startTime:
                serviceType === "transport" ? undefined : time || undefined,
              endTime:
                serviceType === "transport"
                  ? undefined
                  : endTime || undefined,
              internalNotes: note,
              transportDirection,
              groomingAddon,
              lodgingNights:
                serviceType === "hotel" ? lodgingNights : undefined,
              depositPercent:
                serviceType === "hotel" ? depositPercent : undefined,
              lodgingRateProfile:
                serviceType === "hotel" ? nextLodgingRateProfile : undefined,
              recurrence,
              recurrenceCount,
            }),
          }),
        {
          refresh: true,
          successMessage:
            scheduledDates.length === 1
              ? `Serviço agendado para ${dog.name}.`
              : `${scheduledDates.length} serviços recorrentes agendados para ${dog.name}.`,
        },
      );
      if (result) {
        setDialog(null);
        selectAgendaDate(date);
        setView("today");
      }
      return;
    }

    const recurringScheduleId =
      recurrence === "weekly" ? `recurring-${crypto.randomUUID()}` : undefined;
    const lodgingDurationDays =
      serviceType === "hotel"
        ? Math.round(
            (dateFromIso(endDate).valueOf() - dateFromIso(date).valueOf()) /
              86_400_000,
          )
        : 0;
    const newBookings: Booking[] = scheduledDates.map((scheduledDate) => ({
        id: `booking-${crypto.randomUUID()}`,
        recurringScheduleId,
        occurrenceDate: recurringScheduleId ? scheduledDate : undefined,
        date: scheduledDate,
        time: serviceType === "transport" ? "Sem horário" : time || "Sem horário",
        endTime: endTime || undefined,
        endDate:
          serviceType === "hotel"
            ? shiftDate(scheduledDate, lodgingDurationDays)
            : undefined,
        lodgingNights: serviceType === "hotel" ? lodgingNights : undefined,
        depositPercent: serviceType === "hotel" ? depositPercent ?? undefined : undefined,
        lodgingRateProfile:
          serviceType === "hotel" ? nextLodgingRateProfile : undefined,
        lodgingTableDailyRateCents:
          serviceType === "hotel"
            ? lodgingPricing.standardDailyRateCents
            : undefined,
        dogId: dog.id,
        dogName: dog.name,
        customerId: dog.customerId,
        customerName: dog.customerName,
        service:
          serviceType === "bath" && groomingAddon
            ? "Banho e tosa"
            : serviceLabels[serviceType],
        serviceType,
        groomingAddon,
        status: "scheduled",
        priceCents:
          serviceType === "hotel"
            ? lodgingDailyRate(
                lodgingPricing,
                nextLodgingRateProfile ?? "standard",
              ) * lodgingNights
            : (servicePrices[serviceType] +
                (serviceType === "bath" && groomingAddon
                  ? groomingAddonPriceCents
                  : 0)) *
              (serviceType === "transport" && transportDirection === "round_trip" ? 2 : 1),
        paymentPreference: "invoice",
        settlementStatus: "pending",
        note,
      }));
    setBookings((current) =>
      [...current, ...newBookings].sort((a, b) =>
        `${a.date}-${a.time}`.localeCompare(`${b.date}-${b.time}`),
      ),
    );
    setDialog(null);
    selectAgendaDate(date);
    setView("today");
    setToast({
      message:
        newBookings.length === 1
          ? `Serviço agendado para ${dog.name}.`
          : `${newBookings.length} serviços recorrentes agendados para ${dog.name}.`,
    });
  }

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    if (!title) {
      setToast({ message: "Informe o título da tarefa." });
      return;
    }
    const date = String(form.get("date") ?? "").trim();
    const time = String(form.get("time") ?? "").trim();
    const priority =
      String(form.get("priority") ?? "normal") === "high" ? "high" : "normal";

    if (runtimeMode === "ready") {
      const result = await runLiveAction(
        "new-task",
        () =>
          requestJson<{ task: { id: string } }>("/api/tasks", {
            method: "POST",
            body: JSON.stringify({
              title,
              scheduledDate: date || undefined,
              scheduledTime: time || undefined,
              priority,
            }),
          }),
        {
          refresh: true,
          successMessage: "Tarefa adicionada.",
        },
      );
      if (result) setDialog(null);
      return;
    }

    const task: Task = {
      id: `task-${crypto.randomUUID()}`,
      title,
      due: time || "Sem horário",
      priority,
      completed: false,
    };
    setTasks((current) => [task, ...current]);
    setDialog(null);
    setToast({ message: "Tarefa adicionada." });
  }

  async function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!name) {
      setToast({ message: "Informe o nome do cliente." });
      return;
    }
    const phone = String(form.get("phone") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const address = String(form.get("address") ?? "").trim();
    const cpf = String(form.get("cpf") ?? "").trim();
    const birthDate = String(form.get("birthDate") ?? "").trim();
    if (runtimeMode === "ready") {
      if (!phone && !email) {
        setToast({
          message: "Informe ao menos um WhatsApp ou e-mail para o cliente.",
        });
        return;
      }
      const result = await runLiveAction(
        "new-customer",
        () =>
          requestJson<{ customer: { id: string } }>("/api/customers", {
            method: "POST",
            body: JSON.stringify({
              displayName: name,
              fullName: name,
              phone: phone || undefined,
              email: email || undefined,
              whatsappEnabled: Boolean(phone),
              isFinancialContact: true,
              addressLine: address || undefined,
              cpf: cpf || undefined,
              birthDate: birthDate || undefined,
            }),
          }),
        {
          refresh: true,
          successMessage: "Cliente cadastrado.",
        },
      );
      if (result) {
        setDialog(null);
        setRegistrationType("choice");
        setSelectedCustomerId(result.customer.id);
        setView("customers");
      }
      return;
    }

    const customer: Customer = {
      id: `customer-${crypto.randomUUID()}`,
      name,
      initials: initials(name),
      phone: phone || "Não informado",
      email: email || "Não informado",
      address: address || undefined,
      cpf: cpf || undefined,
      birthDate: birthDate || undefined,
      dogIds: [],
      balanceCents: 0,
      creditsLabel: "Sem créditos",
      status: "current",
    };
    setCustomers((current) => [customer, ...current]);
    setCreditBalances((current) => ({
      ...current,
      [customer.id]: { daycare: 0, bath: 0, grooming: 0, transport: 0 },
    }));
    setDialog(null);
    setRegistrationType("choice");
    setSelectedCustomerId(customer.id);
    setView("customers");
    setToast({ message: "Cliente cadastrado." });
  }

  async function submitDog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const customerId = String(form.get("customerId") ?? "");
    const customer = customers.find((item) => item.id === customerId);
    if (!name || !customer) {
      setToast({ message: "Informe o nome do cão e selecione um cliente." });
      return;
    }
    const breed = String(form.get("breed") ?? "").trim();
    const alert = String(form.get("alert") ?? "").trim();
    const birthDate = String(form.get("birthDate") ?? "").trim();
    const sex = String(form.get("sex") ?? "unknown") as Dog["sex"];
    const neutered =
      String(form.get("neutered") ?? "") === "yes"
        ? true
        : String(form.get("neutered") ?? "") === "no"
          ? false
          : null;
    if (runtimeMode === "ready") {
      const result = await runLiveAction(
        "new-dog",
        () =>
          requestJson<{ dog: { id: string } }>("/api/dogs", {
            method: "POST",
            body: JSON.stringify({
              accountId: customerId,
              name,
              breed: breed || undefined,
              birthDate: birthDate || undefined,
              sex,
              neutered,
              emergencyNotes: alert || undefined,
              vaccinesCurrent: false,
            }),
          }),
        {
          refresh: true,
          successMessage: `${name} foi cadastrado.`,
        },
      );
      if (result) {
        setDialog(null);
        setRegistrationType("choice");
        setSelectedDogId(result.dog.id);
        setView("dogs");
      }
      return;
    }

    const dog: Dog = {
      id: `dog-${crypto.randomUUID()}`,
      name,
      initials: initials(name),
      breed: breed || "Raça não informada",
      age: "Idade não informada",
      birthDate: birthDate || undefined,
      sex,
      neutered,
      customerId,
      customerName: customer.name,
      color: "forest",
      vaccinesCurrent: false,
      today: "Sem serviço hoje",
      nextService: "Nenhum atendimento agendado",
      alert: alert || undefined,
      credits: [],
    };
    setDogs((current) => [dog, ...current]);
    setCustomers((current) =>
      current.map((item) =>
        item.id === customerId
          ? { ...item, dogIds: [...item.dogIds, dog.id] }
          : item,
      ),
    );
    setDialog(null);
    setRegistrationType("choice");
    setSelectedDogId(dog.id);
    setView("dogs");
    setToast({ message: `${dog.name} foi cadastrado.` });
  }

  async function toggleTask(taskId: string) {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    if (runtimeMode === "ready") {
      await runLiveAction(
        `task:${taskId}`,
        () =>
          requestJson<{ task: { id: string } }>(`/api/tasks/${taskId}`, {
            method: "PATCH",
            body: JSON.stringify({
              status: task.completed ? "open" : "completed",
            }),
          }),
        { refresh: true },
      );
      return;
    }
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId ? { ...task, completed: !task.completed } : task,
      ),
    );
  }

  async function clearCompletedTasks() {
    const completedCount = tasks.filter((task) => task.completed).length;
    if (!completedCount) {
      setToast({ message: "Não há tarefas concluídas para limpar." });
      return;
    }
    if (!window.confirm(`Limpar ${completedCount} tarefa(s) concluída(s) do quadro?`)) {
      return;
    }
    if (runtimeMode === "ready") {
      await runLiveAction(
        "clear-completed-tasks",
        () => requestJson("/api/tasks", { method: "DELETE" }),
        { refresh: true, successMessage: "Tarefas concluídas removidas do quadro." },
      );
      return;
    }
    setTasks((current) => current.filter((task) => !task.completed));
    setToast({ message: "Tarefas concluídas removidas do quadro." });
  }

  function toggleBillable(service: BillableService) {
    if (service.selectable === false) {
      setToast({
        message:
          service.billingNote ??
          "Este serviço ainda não está disponível para faturamento.",
      });
      return;
    }
    const selected = selectedBillables.includes(service.id);
    if (selected) {
      setSelectedBillables((current) =>
        current.filter((id) => id !== service.id),
      );
      return;
    }
    const firstSelected = billableServices.find(
      (item) => item.id === selectedBillables[0],
    );
    if (firstSelected && firstSelected.customerId !== service.customerId) {
      setToast({
        message: "Selecione serviços de um único cliente por cobrança.",
      });
      return;
    }
    setSelectedBillables((current) => [...current, service.id]);
  }

  async function useCreditsForBillable(service: BillableService) {
    const serviceType = service.serviceType;
    const creditUnits = service.creditUnits ?? 0;
    if (
      !service.appointmentItemId ||
      !serviceType ||
      !creditServiceTypes.includes(serviceType as CreditServiceType) ||
      creditUnits < 1
    ) {
      setToast({ message: "Este serviço não pode ser quitado com créditos." });
      return;
    }
    const available = creditBalances[service.customerId]?.[
      serviceType as CreditServiceType
    ] ?? 0;
    if (available < creditUnits) {
      setToast({
        message: `Saldo insuficiente: são necessários ${creditUnits} ${
          creditUnits === 1 ? "crédito" : "créditos"
        } para este serviço.`,
      });
      return;
    }

    if (runtimeMode === "ready") {
      const result = await runLiveAction(
        `use-credit:${service.appointmentItemId}`,
        () =>
          requestJson<{
            receipt?: { id: string };
            chargeCreated?: boolean;
          }>("/api/credits/consume", {
            method: "POST",
            body: JSON.stringify({
              appointmentItemId: service.appointmentItemId,
            }),
          }),
        {
          refresh: true,
        },
      );
      if (result) {
        setSelectedBillables((current) =>
          current.filter((id) => id !== service.id),
        );
        setToast({
          message: result.chargeCreated
            ? "Crédito de banho utilizado. O recibo está pronto e a tosa foi separada para cobrança regular."
            : `${creditUnits} ${
                creditUnits === 1 ? "crédito utilizado" : "créditos utilizados"
              }. O recibo está pronto.`,
        });
      }
      return;
    }

    const nextBalance = available - creditUnits;
    setCreditBalances((current) => ({
      ...current,
      [service.customerId]: {
        ...(current[service.customerId] ?? {
          daycare: 0,
          bath: 0,
          grooming: 0,
          transport: 0,
        }),
        [serviceType]: nextBalance,
      },
    }));
    const hasGroomingAddon =
      serviceType === "bath" && service.service.toLowerCase().includes("tosa");
    setBillableServices((current) => [
      ...(hasGroomingAddon
        ? [
            {
              ...service,
              id: `grooming-${service.id}`,
              service: "Tosa",
              serviceType: "grooming" as const,
              creditUnits: undefined,
              amountCents: groomingAddonPriceCents,
            },
          ]
        : []),
      ...current.filter((item) => item.id !== service.id),
    ]);
    setSelectedBillables((current) =>
      current.filter((id) => id !== service.id),
    );
    setReceipts((current) => [
      {
        id: `receipt-${Date.now()}`,
        number: `REC-DEMO-${String(current.length + 1).padStart(3, "0")}`,
        customerId: service.customerId,
        customerName: service.customerName,
        dogName: service.dogName,
        serviceType: serviceType as CreditServiceType,
        service: hasGroomingAddon ? "Banho" : service.service,
        date: service.date,
        creditUnits,
        remainingBalance: nextBalance,
        deliveryStatus: "ready",
      },
      ...current,
    ]);
    setToast({
      message: hasGroomingAddon
        ? "Crédito de banho utilizado. A tosa foi separada para cobrança regular."
        : `${creditUnits} ${
            creditUnits === 1 ? "crédito utilizado" : "créditos utilizados"
          }. O recibo está pronto.`,
    });
  }

  async function saveRegularBilling(
    service: BillableService,
    amountCents: number,
    pricingProfile?: string,
  ) {
    if (!service.appointmentItemId || !Number.isSafeInteger(amountCents) || amountCents < 1) {
      setToast({ message: "Informe um valor válido para a cobrança." });
      return false;
    }

    const firstSelected = billableServices.find(
      (item) => item.id === selectedBillables[0],
    );
    if (firstSelected && firstSelected.customerId !== service.customerId) {
      setToast({ message: "Conclua primeiro a fatura do cliente já selecionado." });
      return false;
    }

    if (runtimeMode === "ready") {
      const result = await runLiveAction(
        `regular-billing:${service.appointmentItemId}`,
        () =>
          requestJson(`/api/appointment-items/${service.appointmentItemId}/billing`, {
            method: "PATCH",
            body: JSON.stringify({
              amountCents,
              billingKind: service.billingKind ?? "service",
              pricingProfile,
            }),
          }),
        {
          refresh: true,
          successMessage: "Valor confirmado. Serviço incluído na próxima fatura.",
        },
      );
      if (!result) return false;
    } else {
      setBillableServices((current) =>
        current.map((item) =>
          item.id === service.id
            ? {
                ...item,
                billingPricingProfile: pricingProfile,
                lodging:
                  item.lodging && pricingProfile?.startsWith("lodging_")
                    ? {
                        ...item.lodging,
                        rateProfile: pricingProfile.slice(
                          "lodging_".length,
                        ) as LodgingRateProfile,
                        dailyRateCents: Math.round(
                          amountCents / item.lodging.nights,
                        ),
                      }
                    : item.lodging,
                amountCents:
                  item.billingKind === "lodging_deposit"
                    ? Math.round(amountCents * ((item.lodging?.depositPercent ?? 0) / 100))
                    : item.billingKind === "lodging_balance"
                      ? Math.round(amountCents * ((100 - (item.lodging?.depositPercent ?? 0)) / 100))
                      : amountCents,
              }
            : item,
        ),
      );
    }

    setSelectedBillables((current) =>
      current.includes(service.id) ? current : [...current, service.id],
    );
    setRegularBillingService(null);
    return true;
  }

  function openCreditPackage(customerId?: string) {
    if (customerId) setCreditCustomerId(customerId);
    setDialog("creditPackage");
  }

  function openStatement(customerId?: string) {
    setStatementCustomerId(customerId ?? "");
    setDialog("statement");
  }

  function openCreditAdjustment(customerId: string) {
    setCreditAdjustmentCustomerId(customerId);
    setDialog("creditAdjustment");
  }

  async function submitCreditAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const accountId = String(form.get("customerId") ?? "");
    const serviceType = String(form.get("serviceType") ?? "");
    const targetUnits = Number(form.get("targetUnits") ?? "");
    const reason = String(form.get("reason") ?? "").trim();
    if (
      !customers.some((customer) => customer.id === accountId) ||
      !creditServiceTypes.includes(serviceType as CreditServiceType) ||
      !Number.isInteger(targetUnits) ||
      targetUnits < 0 ||
      targetUnits > 10_000 ||
      reason.length < 3
    ) {
      setToast({ message: "Informe o serviço, o novo saldo e um motivo breve." });
      return;
    }
    const result = await runLiveAction(
      `adjust-credit:${accountId}:${serviceType}`,
      () =>
        requestJson<{ targetUnits: number }>("/api/credits", {
          method: "POST",
          body: JSON.stringify({
            accountId,
            serviceCode: toWorkspaceServiceCode(serviceType as ServiceType),
            targetUnits,
            reason,
          }),
        }),
      {
        refresh: true,
        successMessage: "Saldo de créditos ajustado e registrado no histórico.",
      },
    );
    if (result) setDialog(null);
  }

  function submitCreditPackage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const customerId = String(form.get("customerId") ?? "");
    const customer = customers.find((item) => item.id === customerId);
    const serviceType = String(
      form.get("serviceType") ?? "daycare",
    ) as CreditServiceType;
    const units = Math.floor(Number(form.get("units") ?? 0));
    const amountCents = Math.round(Number(form.get("packagePrice") ?? 0) * 100);
    const pricingContext: CreditPricingContext = {
      multiDog: form.get("multiDog") === "on",
      daycareCustomer: form.get("daycareCustomer") === "on",
      taxiDistance: form.get("taxiDistance") === "long" ? "long" : "short",
    };
    if (
      !customer ||
      !creditServiceTypes.includes(serviceType) ||
      units < 1 ||
      units > 100 ||
      amountCents < 1
    ) {
      setToast({ message: "Revise o cliente, a quantidade e o valor do pacote." });
      return;
    }
    const activeServiceType = serviceType as ActiveCreditServiceType;
    const suggestedUnitPriceCents = suggestedCreditUnitCents(
      creditPricing,
      activeServiceType,
      units,
      pricingContext,
    );
    const standardValueCents = suggestedCreditTotalCents(
      creditPricing,
      activeServiceType,
      units,
      pricingContext,
    );
    setInvoiceState({
      step: "review",
      kind: "credit_package",
      selectedServices: [],
      customerName: customer.name,
      customerPhone: customer.phone,
      customerEmail: customer.email,
      amountCents,
      creditPurchase: {
        customerId,
        customerName: customer.name,
        serviceType,
        units,
        amountCents,
        standardValueCents,
        suggestedUnitPriceCents,
        suggestedAmountCents: standardValueCents,
        pricingProfile: creditPricingProfile(activeServiceType, pricingContext),
        pricingContext,
      },
    });
    setDialog("invoice");
  }

  async function saveDefaultPrices(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = { ...servicePrices };
    const nextDaycareStartTime = String(
      form.get("daycareStartTime") ?? "",
    );
    const nextDaycareEndTime = String(form.get("daycareEndTime") ?? "");
    const nextLodgingPricing: LodgingPricing = {
      standardDailyRateCents: Math.round(
        Number(form.get("hotelStandardDailyRate") ?? 0) * 100,
      ),
      daycareDailyRateCents: Math.round(
        Number(form.get("hotelDaycareDailyRate") ?? 0) * 100,
      ),
      additionalDogDailyRateCents: Math.round(
        Number(form.get("hotelAdditionalDogDailyRate") ?? 0) * 100,
      ),
      daycareAdditionalDogDailyRateCents: Math.round(
        Number(form.get("hotelDaycareAdditionalDogDailyRate") ?? 0) * 100,
      ),
      longStayDiscountPercent: Number(
        form.get("hotelLongStayDiscountPercent") ?? 0,
      ),
    };
    const moneyField = (name: string) =>
      Math.round(Number(form.get(name) ?? 0) * 100);
    const nextCreditPricing: CreditPricingSettings = {
      daycareUnder4UnitCents: moneyField("daycareUnder4Unit"),
      daycare4To7UnitCents: moneyField("daycare4To7Unit"),
      daycare8To11UnitCents: moneyField("daycare8To11Unit"),
      daycare12PlusUnitCents: moneyField("daycare12PlusUnit"),
      daycareMultiDogDiscountPercent: Number(
        form.get("daycareMultiDogDiscountPercent") ?? 0,
      ),
      bathUnder4RegularUnitCents: moneyField("bathUnder4RegularUnit"),
      bathUnder4DaycareUnitCents: moneyField("bathUnder4DaycareUnit"),
      bath4PlusRegularUnitCents: moneyField("bath4PlusRegularUnit"),
      bath4PlusDaycareUnitCents: moneyField("bath4PlusDaycareUnit"),
      taxiDogShortUnitCents: moneyField("taxiDogShortUnit"),
      taxiDogLongUnitCents: moneyField("taxiDogLongUnit"),
    };
    const nextGroomingAddonPriceCents = moneyField("bathGroomingAddon");
    next.hotel = nextLodgingPricing.standardDailyRateCents;
    for (const serviceType of ["daycare", "bath"] as const) {
      const cents = Math.round(Number(form.get(serviceType) ?? 0) * 100);
      if (!Number.isFinite(cents) || cents < 1) {
        setToast({ message: "Revise todos os valores antes de salvar." });
        return;
      }
      next[serviceType] = cents;
    }
    next.transport = nextCreditPricing.taxiDogShortUnitCents;
    if (
      Object.values(nextLodgingPricing)
        .slice(0, 4)
        .some((value) => !Number.isSafeInteger(value) || value < 1) ||
      !Number.isInteger(nextLodgingPricing.longStayDiscountPercent) ||
      nextLodgingPricing.longStayDiscountPercent < 0 ||
      nextLodgingPricing.longStayDiscountPercent > 99
    ) {
      setToast({ message: "Revise os valores e o desconto da hospedagem." });
      return;
    }
    if (
      !Number.isSafeInteger(nextGroomingAddonPriceCents) ||
      nextGroomingAddonPriceCents < 1
    ) {
      setToast({ message: "Revise o valor adicional da tosa." });
      return;
    }
    if (
      Object.entries(nextCreditPricing).some(([field, value]) =>
        field === "daycareMultiDogDiscountPercent"
          ? !Number.isInteger(value) || value < 0 || value > 99
          : !Number.isSafeInteger(value) || value < 1,
      )
    ) {
      setToast({ message: "Revise os valores dos pacotes de créditos." });
      return;
    }
    if (
      !nextDaycareStartTime ||
      !nextDaycareEndTime ||
      nextDaycareEndTime <= nextDaycareStartTime
    ) {
      setToast({
        message:
          "O horário final da creche deve ser posterior ao horário inicial.",
      });
      return;
    }

    if (runtimeMode === "ready") {
      const result = await runLiveAction(
        "save-prices",
        () =>
          requestJson<{ prices: unknown[] }>("/api/settings/prices", {
            method: "PATCH",
            body: JSON.stringify({
              prices: {
                hotel: next.hotel,
                daycare: next.daycare,
                bath: next.bath,
                taxi_dog: next.transport,
              },
              daycareStartTime: nextDaycareStartTime,
              daycareEndTime: nextDaycareEndTime,
              lodgingPricing: nextLodgingPricing,
              creditPricing: nextCreditPricing,
              bathGroomingAddonCents: nextGroomingAddonPriceCents,
            }),
          }),
        {
          refresh: true,
          successMessage:
            "Preços padrão salvos. Novos serviços já usarão os valores atualizados.",
        },
      );
      if (result) {
        setServicePrices(next);
        setDaycareStartTime(nextDaycareStartTime);
        setDaycareEndTime(nextDaycareEndTime);
        setLodgingPricing(nextLodgingPricing);
        setCreditPricing(nextCreditPricing);
        setGroomingAddonPriceCents(nextGroomingAddonPriceCents);
      }
      return;
    }

    setServicePrices(next);
    setDaycareStartTime(nextDaycareStartTime);
    setDaycareEndTime(nextDaycareEndTime);
    setLodgingPricing(nextLodgingPricing);
    setCreditPricing(nextCreditPricing);
    setGroomingAddonPriceCents(nextGroomingAddonPriceCents);
    setToast({
      message:
        "Preços padrão salvos. Novos serviços já usarão os valores atualizados.",
    });
  }

  function openReceipt(receipt: ServiceReceipt) {
    setSelectedReceipt(receipt);
    setDialog("receipt");
  }

  function sendReceipt(
    receipt: ServiceReceipt,
    channel: "whatsapp" | "email",
  ) {
    const updated: ServiceReceipt = {
      ...receipt,
      deliveryStatus: "sent",
      sentBy: channel,
    };
    if (runtimeMode === "ready") {
      const customer = customers.find(
        (item) => item.id === receipt.customerId,
      );
      const message = [
        `Recibo ${receipt.number}`,
        `${receipt.service} para ${receipt.dogName}`,
        `Data: ${receipt.date}`,
        `${receipt.creditUnits} ${receipt.creditUnits === 1 ? "crédito pré-pago utilizado" : "créditos pré-pagos utilizados"}.`,
        "Nenhuma nova fatura foi gerada.",
      ].join("\n");

      if (channel === "whatsapp") {
        let phone = customer?.phone.replace(/\D/g, "") ?? "";
        if (phone.length === 10 || phone.length === 11) {
          phone = `55${phone}`;
        }
        if (!phone || customer?.phone === "Não informado") {
          setToast({
            message:
              "Cadastre o WhatsApp do cliente antes de preparar o recibo.",
          });
          return;
        }
        window.open(
          `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
          "_blank",
          "noopener,noreferrer",
        );
      } else {
        const email =
          customer?.email && customer.email !== "Não informado"
            ? customer.email
            : "";
        if (!email) {
          setToast({
            message: "Cadastre o e-mail do cliente antes de preparar o recibo.",
          });
          return;
        }
        const subject = `Recibo ${receipt.number} · ${receipt.dogName}`;
        window.open(
          `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(
            subject,
          )}&body=${encodeURIComponent(message)}`,
          "_blank",
          "noopener,noreferrer",
        );
      }
      setToast({
        message: `Mensagem do recibo aberta para envio por ${
          channel === "whatsapp" ? "WhatsApp" : "e-mail"
        }. Confirme o envio no aplicativo.`,
      });
      return;
    }

    setReceipts((current) =>
      current.map((item) => (item.id === receipt.id ? updated : item)),
    );
    setSelectedReceipt(updated);
    setToast({
      message: `Recibo preparado para envio por ${
        channel === "whatsapp" ? "WhatsApp" : "e-mail"
      }. Nenhuma fatura foi criada.`,
    });
  }

  function openInvoiceForSelection() {
    const selectedServices = billableServices.filter((item) =>
      selectedBillables.includes(item.id),
    );
    if (!selectedServices.length) return;
    const customer = customers.find(
      (item) => item.id === selectedServices[0].customerId,
    );
    setInvoiceState({
      step: "review",
      kind: "services",
      selectedServices,
      customerName: selectedServices[0].customerName,
      customerPhone: customer?.phone,
      customerEmail: customer?.email,
      amountCents: selectedServices.reduce(
        (total, item) => total + item.amountCents,
        0,
      ),
    });
    setDialog("invoice");
  }

  function openExistingInvoice(invoice: Invoice) {
    const creditPurchase = creditPurchases.find(
      (purchase) => purchase.invoiceId === invoice.id,
    );
    const customer = customers.find(
      (item) => item.id === invoice.customerId,
    );
    setInvoiceState({
      step: "code",
      kind: creditPurchase ? "credit_package" : "services",
      invoice,
      selectedServices: [],
      customerName: invoice.customerName,
      customerPhone: customer?.phone,
      customerEmail: customer?.email,
      amountCents: invoice.amountCents,
      creditPurchase: creditPurchase
        ? {
            customerId: creditPurchase.customerId,
            customerName: creditPurchase.customerName,
            serviceType: creditPurchase.serviceType,
            units: creditPurchase.units,
            amountCents: creditPurchase.amountCents,
            standardValueCents: creditPurchase.standardValueCents,
            pricingProfile: creditPurchase.pricingProfile,
            suggestedUnitPriceCents: creditPurchase.suggestedUnitPriceCents,
            suggestedAmountCents: creditPurchase.suggestedAmountCents,
            invoiceId: creditPurchase.invoiceId,
          }
        : undefined,
    });
    setDialog("invoice");
  }

  async function loadActivityPeriod(from: string, to: string) {
    if (runtimeMode !== "ready" || !workspacePayload) {
      return {
        activities: auditFixtures.filter(
          (event) =>
            !event.occurredOn ||
            (event.occurredOn >= from && event.occurredOn <= to),
        ),
        truncated: false,
      };
    }
    try {
      const response = await requestJson<{
        activities: WorkspaceReadyPayload["activities"];
        truncated: boolean;
      }>(`/api/activities?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      return {
        activities: mapWorkspaceActivities({
          ...workspacePayload,
          activities: response.activities,
        }),
        truncated: response.truncated,
      };
    } catch (error) {
      setToast({
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível consultar esse período.",
      });
      return null;
    }
  }

  async function loadInvoiceHistory(from: string, to: string) {
    if (runtimeMode !== "ready" || !workspacePayload) {
      return invoices.filter((invoice) => {
        const date = invoice.paidAt ?? invoice.voidedAt ?? invoice.issuedAt;
        return (
          (invoice.status === "paid" || invoice.status === "void") &&
          Boolean(date && date >= from && date <= to)
        );
      });
    }
    try {
      const response = await requestJson<{
        invoices: WorkspaceInvoice[];
        creditPurchases: WorkspaceCreditPurchase[];
      }>(`/api/billing/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const purchases = new Map(
        workspacePayload.billing.creditPurchases.map((purchase) => [purchase.id, purchase]),
      );
      for (const purchase of response.creditPurchases) purchases.set(purchase.id, purchase);
      const mappedInvoices = mapWorkspaceInvoices(
        {
          ...workspacePayload,
          billing: {
            ...workspacePayload.billing,
            invoices: response.invoices,
            creditPurchases: [...purchases.values()],
          },
        },
        operationalToday,
        { includeVoided: true },
      );
      setInvoices((current) => {
        const loadedIds = new Set(mappedInvoices.map((invoice) => invoice.id));
        return [
          ...mappedInvoices,
          ...current.filter((invoice) => !loadedIds.has(invoice.id)),
        ];
      });
      return mappedInvoices;
    } catch (error) {
      setToast({
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível consultar o histórico de faturas.",
      });
      return null;
    }
  }

  async function markInvoiceDelivered(
    invoiceId: string,
    channel: "whatsapp" | "email",
  ) {
    const currentInvoice = invoices.find((item) => item.id === invoiceId);
    const currentChannels = currentInvoice?.sentBy ?? [];
    const sentBy = [...new Set([...currentChannels, channel])];
    const lastSentAt = new Date().toISOString();

    if (runtimeMode === "ready") {
      const result = await runLiveAction(
        `invoice-delivery:${invoiceId}`,
        () =>
          requestJson<{
            invoice: {
              id: string;
              sentBy: ("whatsapp" | "email")[];
              lastSentAt: string;
            };
          }>(`/api/invoices/${invoiceId}/delivery`, {
            method: "POST",
            body: JSON.stringify({ channel }),
          }),
        { refresh: false },
      );
      if (!result) return false;
      setInvoices((items) =>
        items.map((item) =>
          item.id === invoiceId
            ? {
                ...item,
                sentBy: result.invoice.sentBy,
                lastSentAt: result.invoice.lastSentAt,
              }
            : item,
        ),
      );
      setInvoiceState((state) =>
        state?.invoice?.id === invoiceId
          ? {
              ...state,
              invoice: {
                ...state.invoice,
                sentBy: result.invoice.sentBy,
                lastSentAt: result.invoice.lastSentAt,
              },
            }
          : state,
      );
      return true;
    }

    setInvoices((items) =>
      items.map((item) =>
        item.id === invoiceId ? { ...item, sentBy, lastSentAt } : item,
      ),
    );
    setInvoiceState((state) =>
      state?.invoice?.id === invoiceId
        ? {
            ...state,
            invoice: { ...state.invoice, sentBy, lastSentAt },
          }
        : state,
    );
    return true;
  }

  async function saveInvoiceNote(
    invoiceId: string,
    note: string,
    followUpOn?: string,
  ) {
    const internalNote = note.trim() || undefined;
    const savedFollowUpOn = followUpOn || undefined;
    if (runtimeMode === "ready") {
      const result = await runLiveAction(
        `invoice-note:${invoiceId}`,
        () =>
          requestJson<{ invoice: { id: string; internalNote: string | null; followUpOn: string | null } }>(
            `/api/invoices/${invoiceId}/note`,
            {
              method: "PUT",
              body: JSON.stringify({
                note: internalNote ?? "",
                followUpOn: savedFollowUpOn ?? "",
              }),
            },
          ),
        { refresh: false },
      );
      if (!result) return false;
      const savedNote = result.invoice.internalNote ?? undefined;
      const confirmedFollowUpOn = result.invoice.followUpOn ?? undefined;
      setInvoices((items) =>
        items.map((item) =>
          item.id === invoiceId
            ? {
                ...item,
                internalNote: savedNote,
                followUpOn: confirmedFollowUpOn,
              }
            : item,
        ),
      );
      setInvoiceState((state) =>
        state?.invoice?.id === invoiceId
          ? {
              ...state,
              invoice: {
                ...state.invoice,
                internalNote: savedNote,
                followUpOn: confirmedFollowUpOn,
              },
            }
          : state,
      );
      return true;
    }

    setInvoices((items) =>
      items.map((item) =>
        item.id === invoiceId
          ? { ...item, internalNote, followUpOn: savedFollowUpOn }
          : item,
      ),
    );
    setInvoiceState((state) =>
      state?.invoice?.id === invoiceId
        ? {
            ...state,
            invoice: {
              ...state.invoice,
              internalNote,
              followUpOn: savedFollowUpOn,
            },
          }
        : state,
    );
    return true;
  }

  function issueLodgingInvoice(
    booking: Booking,
    kind: "deposit" | "balance",
  ) {
    const billingKind =
      kind === "deposit" ? "lodging_deposit" : "lodging_balance";
    const matchingBillable = billableServices.find(
      (service) =>
        service.billingKind === billingKind &&
        service.appointmentItemId === booking.itemId,
    );
    if (matchingBillable) {
      const customer = customers.find(
        (item) => item.id === matchingBillable.customerId,
      );
      setInvoiceState({
        step: "review",
        kind: "services",
        selectedServices: [matchingBillable],
        customerName: matchingBillable.customerName,
        customerPhone: customer?.phone,
        customerEmail: customer?.email,
        amountCents: matchingBillable.amountCents,
      });
      setDialog("invoice");
      return;
    }

    if (runtimeMode === "ready") {
      setToast({
        message:
          "Atualize a página antes de gerar esta fatura. Assim, o desconto poderá ser revisado com segurança.",
      });
      return;
    }

    const depositAmount = Math.round(
      (booking.priceCents * (booking.depositPercent ?? 50)) / 100,
    );
    const paidDeposit =
      booking.depositInvoice?.status === "paid"
        ? booking.depositInvoice.amountCents
        : 0;
    const amountCents =
      kind === "deposit"
        ? depositAmount
        : Math.max(0, booking.priceCents - paidDeposit);
    const invoice: Invoice = {
      id: `invoice-${crypto.randomUUID()}`,
      number: `${kind === "deposit" ? "SIN" : "SAL"}-${String(
        185 + invoices.length,
      ).padStart(6, "0")}`,
      customerId: booking.customerId,
      customerName: booking.customerName,
      amountCents,
      due: "Vence hoje",
      status: "pending",
      issuedAt: operationalToday,
      items:
        kind === "deposit"
          ? `Sinal da hospedagem de ${booking.dogName}`
          : `Saldo da hospedagem de ${booking.dogName}`,
      sourceType:
        kind === "deposit" ? "lodging_deposit" : "lodging_balance",
      periodStart: booking.date,
      periodEnd: booking.endDate ?? booking.date,
      lines: [
        {
          dogName: booking.dogName,
          service:
            kind === "deposit"
              ? "Sinal da hospedagem"
              : "Saldo da hospedagem",
          date: booking.date,
          amountCents,
          lodging: {
            checkInDate: booking.date,
            checkOutDate: booking.endDate ?? booking.date,
            nights: booking.lodgingNights ?? 1,
            dailyRateCents: servicePrices.hotel,
            depositPercent: booking.depositPercent,
          },
        },
      ],
    };
    setInvoices((current) => [invoice, ...current]);
    setBookings((current) =>
      current.map((item) =>
        item.id === booking.id
          ? {
              ...item,
              [kind === "deposit" ? "depositInvoice" : "balanceInvoice"]: {
                id: invoice.id,
                number: invoice.number,
                amountCents,
                status: "pending",
              },
            }
          : item,
      ),
    );
    openExistingInvoice(invoice);
  }

  async function issueInvoice(applyLongStayDiscount = true) {
    if (!invoiceState) return;

    if (runtimeMode === "ready") {
      if (busyAction) return;
      setBusyAction("issue-invoice");
      let registeredInvoice = invoiceState.invoice;
      try {
        if (!registeredInvoice) {
          if (invoiceState.kind === "credit_package" && invoiceState.creditPurchase) {
            const purchase = invoiceState.creditPurchase;
            const response = await requestJson<{
              invoice: {
                id: string;
                invoiceNumber: string;
                totalCents: number;
              };
            }>("/api/credit-purchases", {
              method: "POST",
              body: JSON.stringify({
                accountId: purchase.customerId,
                serviceCode: toWorkspaceServiceCode(purchase.serviceType),
                creditUnits: purchase.units,
                amountCents: purchase.amountCents,
                packageName: `${purchase.units} créditos · ${creditPricingProfileLabel(
                  purchase.pricingProfile,
                )}`,
                multiDog: purchase.pricingContext?.multiDog,
                daycareCustomer: purchase.pricingContext?.daycareCustomer,
                taxiDistance: purchase.pricingContext?.taxiDistance,
                dueDate: operationalToday,
                applyLongStayDiscount,
              }),
            });
            registeredInvoice = {
              id: response.invoice.id,
              number: response.invoice.invoiceNumber,
              customerId: purchase.customerId,
              customerName: purchase.customerName,
              amountCents: response.invoice.totalCents,
              due: "Vence hoje",
              status: "pending",
              issuedAt: operationalToday,
              items: `Pacote de ${purchase.units} créditos de ${
                serviceLabels[purchase.serviceType]
              }`,
              sourceType: "credit_package",
              periodStart: operationalToday,
              periodEnd: operationalToday,
              lines: [
                {
                  dogName: "Não se aplica",
                  service: `${purchase.units} créditos · ${creditPricingProfileLabel(
                    purchase.pricingProfile,
                  )}`,
                  date: operationalToday,
                  amountCents: response.invoice.totalCents,
                },
              ],
            };
          } else {
            const response = await requestJson<{
              invoice: {
                id: string;
                invoiceNumber: string;
                accountId: string;
                customerName: string;
                totalCents: number;
                items: Array<{
                  dogNameSnapshot: string;
                  serviceNameSnapshot: string;
                  serviceDateSnapshot: string;
                  amountCents: number;
                  lodging: {
                    checkInDate: string;
                    checkOutDate: string;
                    nights: number;
                    dailyRateCents: number;
                    depositPercent: number | null;
                    tableDailyRateCents?: number;
                    rateProfile?: string;
                    longStayDiscountPercent?: number;
                    longStayDiscountCents?: number;
                  } | null;
                }>;
              };
            }>("/api/invoices", {
              method: "POST",
              body: JSON.stringify({
                billingEntries: invoiceState.selectedServices.map(
                  (service) => ({
                    appointmentItemId:
                      service.appointmentItemId ?? service.id,
                    kind: service.billingKind ?? "service",
                  })),
                dueDate: operationalToday,
                applyLongStayDiscount,
              }),
            });
            registeredInvoice = {
              id: response.invoice.id,
              number: response.invoice.invoiceNumber,
              customerId: response.invoice.accountId,
              customerName: response.invoice.customerName,
              amountCents: response.invoice.totalCents,
              due: "Vence hoje",
              status: "pending",
              issuedAt: operationalToday,
              items: `${invoiceState.selectedServices.length} serviços selecionados`,
              sourceType: "services",
              lines: response.invoice.items.map((item) => ({
                dogName: item.dogNameSnapshot,
                service: item.serviceNameSnapshot,
                date: item.serviceDateSnapshot,
                amountCents: item.amountCents,
                lodging: item.lodging
                  ? {
                      ...item.lodging,
                      depositPercent: item.lodging.depositPercent ?? undefined,
                    }
                  : undefined,
              })),
            };
          }
        }

        setSelectedBillables([]);
        await refreshWorkspace();
        setInvoiceState((current) =>
          current
            ? {
                ...current,
                invoice: registeredInvoice,
                amountCents:
                  registeredInvoice?.amountCents ?? current.amountCents,
                step: "code",
              }
            : current,
        );
        setToast({ message: "Fatura criada." });
      } catch (error) {
        if (isSessionError(error)) {
          endSession();
          return;
        }
        if (registeredInvoice) {
          await refreshWorkspace();
          setInvoiceState((current) =>
            current
              ? {
                  ...current,
                  invoice: registeredInvoice,
                  amountCents:
                    registeredInvoice?.amountCents ?? current.amountCents,
                  step: "code",
                }
              : current,
          );
        }
        setToast({
          message:
            error instanceof Error
              ? error.message
              : "Não foi possível criar a fatura.",
        });
      } finally {
        setBusyAction(null);
      }
      return;
    }

    const demoLongStayDiscountCents = applyLongStayDiscount
      ? invoiceState.selectedServices.reduce(
          (total, service) =>
            total +
            billableLongStayDiscountCents(
              service,
              lodgingPricing.longStayDiscountPercent,
            ),
          0,
        )
      : 0;
    const invoice: Invoice =
      invoiceState.invoice ??
      {
        id: `invoice-${crypto.randomUUID()}`,
        number: String(185 + invoices.length).padStart(6, "0"),
        customerId:
          invoiceState.creditPurchase?.customerId ??
          invoiceState.selectedServices[0]?.customerId ??
          "",
        customerName: invoiceState.customerName,
        amountCents: Math.max(
          0,
          invoiceState.amountCents - demoLongStayDiscountCents,
        ),
        due: "Vence hoje",
        status: "pending",
        issuedAt: operationalToday,
        items:
          invoiceState.kind === "credit_package" && invoiceState.creditPurchase
            ? `Pacote de ${invoiceState.creditPurchase.units} créditos de ${
                serviceLabels[invoiceState.creditPurchase.serviceType]
              }`
            : `${invoiceState.selectedServices.length} serviços selecionados`,
        sourceType:
          invoiceState.kind === "credit_package"
            ? "credit_package"
            : "services",
        periodStart: operationalToday,
        periodEnd: operationalToday,
        lines:
          invoiceState.kind === "credit_package" &&
          invoiceState.creditPurchase
            ? [
                {
                  dogName: "Não se aplica",
                  service: `Pacote de ${invoiceState.creditPurchase.units} créditos de ${
                    serviceLabels[invoiceState.creditPurchase.serviceType]
                  }`,
                  date: operationalToday,
                  amountCents: invoiceState.amountCents,
                },
              ]
            : invoiceState.selectedServices.map((service) => ({
                dogName: service.dogName,
                service: service.service,
                date: service.date,
                amountCents: Math.max(
                  0,
                  service.amountCents -
                    (applyLongStayDiscount
                      ? billableLongStayDiscountCents(
                          service,
                          lodgingPricing.longStayDiscountPercent,
                        )
                      : 0),
                ),
                lodging: service.lodging
                  ? {
                      ...service.lodging,
                      longStayDiscountPercent:
                        applyLongStayDiscount && service.lodging.nights >= 10
                          ? lodgingPricing.longStayDiscountPercent
                          : undefined,
                      longStayDiscountCents: applyLongStayDiscount
                        ? billableLongStayDiscountCents(
                            service,
                            lodgingPricing.longStayDiscountPercent,
                          )
                        : 0,
                    }
                  : undefined,
              })),
      };
    if (!invoiceState.invoice) {
      setInvoices((current) => [invoice, ...current]);
      if (invoiceState.kind === "credit_package" && invoiceState.creditPurchase) {
        const purchase: CreditPurchase = {
          ...invoiceState.creditPurchase,
          id: `credit-purchase-${crypto.randomUUID()}`,
          status: "awaiting_payment",
          createdAt: formatShortDate(operationalToday),
          invoiceId: invoice.id,
        };
        setCreditPurchases((current) => [purchase, ...current]);
      }
    }
    setInvoiceState({
      ...invoiceState,
      invoice,
      amountCents: invoice.amountCents,
      step: "code",
    });
    setToast({
      message:
        invoiceState.kind === "credit_package"
          ? "Fatura do pacote criada. Libere os créditos após registrar o pagamento."
          : "Fatura demonstrativa criada.",
    });
  }

  async function registerInvoicePayment(
    paidAt = operationalToday,
    settlementMode: "immediate" | "schedule" | "confirm_scheduled" = "immediate",
    availableOn?: string,
    financialAccountId?: string,
  ) {
    if (!invoiceState?.invoice) return;
    const invoiceId = invoiceState.invoice.id;
    if (runtimeMode === "ready") {
      const result = await runLiveAction(
        "register-invoice-payment",
        () =>
          requestJson<{
            invoice: { id: string; status: "paid"; paidAt: string };
            payment: { amountCents: number };
            creditsGranted: number;
            settlement?: {
              availableOn: string;
              status: "scheduled";
              financialAccountId: string;
              financialAccountName: string;
            };
          }>(`/api/invoices/${invoiceId}/payments`, {
            method: "POST",
            body: JSON.stringify({
              paidAt,
              settlementMode,
              availableOn,
              financialAccountId,
            }),
          }),
        {
          refresh: true,
          successMessage:
            settlementMode === "schedule"
              ? "Recebimento registrado em compensação. O Caixa aguardará a confirmação."
              : invoiceState.kind === "credit_package"
              ? "Pagamento registrado. Os créditos já estão disponíveis."
              : "Pagamento registrado e fatura concluída.",
        },
      );
      if (result) {
        if (result.settlement) {
          setInvoices((current) =>
            current.map((invoice) =>
              invoice.id === invoiceId
                ? {
                    ...invoice,
                    compensationAvailableOn: result.settlement!.availableOn,
                    compensationFinancialAccountId:
                      result.settlement!.financialAccountId,
                    compensationFinancialAccountName:
                      result.settlement!.financialAccountName,
                    due: `Em compensação · disponível em ${formatShortDate(result.settlement!.availableOn)}`,
                  }
                : invoice,
            ),
          );
          setInvoiceState((current) =>
            current?.invoice
              ? {
                  ...current,
                  invoice: {
                    ...current.invoice,
                    compensationAvailableOn: result.settlement!.availableOn,
                    compensationFinancialAccountId:
                      result.settlement!.financialAccountId,
                    compensationFinancialAccountName:
                      result.settlement!.financialAccountName,
                    due: `Em compensação · disponível em ${formatShortDate(result.settlement!.availableOn)}`,
                  },
                }
              : current,
          );
          return;
        }
        setInvoiceState((current) =>
          current
            ? {
                ...current,
                invoice: current.invoice
                  ? {
                      ...current.invoice,
                      status: "paid",
                      paidAt,
                      due: `Pago em ${formatShortDate(paidAt)}`,
                    }
                  : current.invoice,
                amountCents: result.payment.amountCents,
                step: "paid",
              }
            : current,
        );
      }
      return;
    }
    setInvoices((current) =>
      current.map((invoice) =>
        invoice.id === invoiceId
          ? {
              ...invoice,
              status: "paid",
              paidAt,
              due: `Pago em ${formatShortDate(paidAt)}`,
            }
          : invoice,
      ),
    );
    if (invoiceState.kind === "credit_package" && invoiceState.creditPurchase) {
      const purchase = invoiceState.creditPurchase;
      const currentCustomerBalance = creditBalances[purchase.customerId] ?? {
        daycare: 0,
        bath: 0,
        grooming: 0,
        transport: 0,
      };
      const nextBalances: CreditBalances = {
        ...creditBalances,
        [purchase.customerId]: {
          ...currentCustomerBalance,
          [purchase.serviceType]:
            currentCustomerBalance[purchase.serviceType] + purchase.units,
        },
      };
      setCreditBalances(nextBalances);
      setCreditPurchases((current) =>
        current.map((item) =>
          item.invoiceId === invoiceId ? { ...item, status: "paid" } : item,
        ),
      );
      setCustomers((current) =>
        current.map((customer) =>
          customer.id === purchase.customerId
            ? {
                ...customer,
                creditsLabel: `${totalCredits(nextBalances, customer.id)} créditos disponíveis`,
              }
            : customer,
        ),
      );
    } else {
      const selectedIds = new Set(
        invoiceState.selectedServices.map((item) => item.id),
      );
      setBillableServices((current) =>
        current.filter((item) => !selectedIds.has(item.id)),
      );
      setSelectedBillables([]);
    }
    setInvoiceState({
      ...invoiceState,
      invoice: { ...invoiceState.invoice, status: "paid", paidAt },
      step: "paid",
    });
    setToast({
      message:
        invoiceState.kind === "credit_package"
          ? "Pagamento confirmado. Os créditos já estão disponíveis para uso."
          : "Pagamento confirmado no ambiente de demonstração.",
    });
  }

  async function voidInvoice(reasonInput?: string) {
    if (!invoiceState?.invoice || invoiceState.invoice.status === "paid") return;
    if (invoiceState.invoice.mergeId) {
      const reversed = await reverseInvoiceMerge(invoiceState.invoice);
      if (reversed) {
        setDialog(null);
        setInvoiceState(null);
      }
      return;
    }
    const reason = reasonInput?.trim();
    if (!reason) return;
    if (runtimeMode === "ready") {
      const result = await runLiveAction(
        "void-invoice",
        () =>
          requestJson<{ invoice: { id: string; status: "void" } }>(
            `/api/invoices/${invoiceState.invoice!.id}/void`,
            {
              method: "POST",
              body: JSON.stringify({ reason }),
            },
          ),
        {
          refresh: true,
          successMessage: "Fatura cancelada e itens liberados para correção.",
        },
      );
      if (!result) return;
    } else {
      setInvoices((current) =>
        current.filter((invoice) => invoice.id !== invoiceState.invoice?.id),
      );
    }
    setDialog(null);
    setInvoiceState(null);
    setInvoiceCorrection(null);
  }

  async function reverseInvoicePayment(reason: string) {
    if (!invoiceState?.invoice || invoiceState.invoice.status !== "paid") {
      return false;
    }
    const invoiceId = invoiceState.invoice.id;
    if (runtimeMode === "ready") {
      const result = await runLiveAction(
        "reverse-invoice-payment",
        () =>
          requestJson<{ reversed: boolean }>(
            `/api/invoices/${invoiceId}/payments/reverse`,
            {
              method: "POST",
              body: JSON.stringify({ reason }),
            },
          ),
        {
          refresh: true,
          successMessage:
            "Pagamento estornado. A fatura voltou a ficar em aberto e o Caixa preservou o histórico.",
        },
      );
      if (!result) return false;
      setInvoices((current) =>
        current.map((invoice) =>
          invoice.id === invoiceId
            ? {
                ...invoice,
                status: "pending",
                paidAt: undefined,
                due: "Pagamento estornado",
                cashEntryId: undefined,
                cashIncluded: undefined,
              }
            : invoice,
        ),
      );
    } else {
      setInvoices((current) =>
        current.map((invoice) =>
          invoice.id === invoiceId
            ? {
                ...invoice,
                status: "pending",
                paidAt: undefined,
                due: "Pagamento estornado",
                cashIncluded: false,
              }
            : invoice,
        ),
      );
    }
    setDialog(null);
    setInvoiceState(null);
    return true;
  }

  async function manageInvoiceSettlement(
    action: "update" | "cancel",
    availableOn?: string,
    reason?: string,
  ) {
    if (!invoiceState?.invoice?.compensationAvailableOn) return false;
    if (runtimeMode !== "ready") {
      setToast({
        message: "A compensação pode ser alterada somente com dados reais.",
      });
      return false;
    }
    const invoiceId = invoiceState.invoice.id;
    const result = await runLiveAction(
      `settlement:${action}:${invoiceId}`,
      () =>
        requestJson<{ settlement: { status: string; availableOn: string } }>(
          `/api/invoices/${invoiceId}/settlement`,
          {
            method: "PATCH",
            body: JSON.stringify({ action, availableOn, reason }),
          },
        ),
      {
        refresh: true,
        successMessage:
          action === "update"
            ? "Previsão de compensação atualizada."
            : "Compensação cancelada; a fatura continua em aberto.",
      },
    );
    if (!result) return false;
    if (action === "update") {
      setInvoiceState((current) =>
        current?.invoice
          ? {
              ...current,
              invoice: {
                ...current.invoice,
                compensationAvailableOn: result.settlement.availableOn,
                due: `Em compensação · disponível em ${formatShortDate(
                  result.settlement.availableOn,
                )}`,
              },
            }
          : current,
      );
    } else {
      setDialog(null);
      setInvoiceState(null);
    }
    return true;
  }

  async function mergeInvoices(invoiceIds: string[], dueDate: string) {
    if (runtimeMode !== "ready") {
      setToast({ message: "A união de faturas está disponível somente com dados reais." });
      return false;
    }
    const result = await runLiveAction(
      "merge-invoices",
      () =>
        requestJson<{ invoice: { id: string; invoiceNumber: string } }>(
          "/api/invoices/merge",
          {
            method: "POST",
            body: JSON.stringify({ invoiceIds, dueDate }),
          },
        ),
      {
        refresh: true,
        successMessage: "Faturas unificadas. A nova fatura está pronta para revisão.",
      },
    );
    return Boolean(result);
  }

  async function reverseInvoiceMerge(invoice: Invoice, confirmed = false) {
    if (!invoice.mergeId || runtimeMode !== "ready") return false;
    if (!confirmed) {
      setInvoiceCorrection({ kind: "unmerge", invoice });
      setDialog((current) => (current === "invoice" ? null : current));
      setInvoiceState(null);
      return false;
    }
    const result = await runLiveAction(
      `unmerge-invoice:${invoice.id}`,
      () =>
        requestJson<{ reversed: boolean }>(
          `/api/invoices/${invoice.id}/unmerge`,
          { method: "POST" },
        ),
      {
        refresh: true,
        successMessage: "União desfeita. As faturas originais foram restauradas.",
      },
    );
    if (result) setInvoiceCorrection(null);
    return Boolean(result);
  }

  async function submitInitialSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyAction) return;
    const form = new FormData(event.currentTarget);
    const setupKey = String(form.get("setupKey") ?? "").trim();
    const establishmentName = String(
      form.get("establishmentName") ?? "",
    ).trim();
    const administrators = [1, 2].map((number) => ({
      displayName: String(form.get(`admin${number}Name`) ?? "").trim(),
      email: String(form.get(`admin${number}Email`) ?? "")
        .trim()
        .toLowerCase(),
      password: String(form.get(`admin${number}Password`) ?? ""),
      confirmation: String(
        form.get(`admin${number}PasswordConfirmation`) ?? "",
      ),
    }));

    if (!setupKey || !establishmentName) {
      setLoadError(
        "Informe a chave de ativação e o nome do estabelecimento.",
      );
      return;
    }
    if (
      administrators.some(
        (admin) =>
          !admin.displayName ||
          !admin.email ||
          admin.password.length < 12,
      )
    ) {
      setLoadError(
        "Preencha os dois administradores e use senhas com pelo menos 12 caracteres.",
      );
      return;
    }
    if (
      administrators.some(
        (admin) => admin.password !== admin.confirmation,
      )
    ) {
      setLoadError("A confirmação de uma das senhas não confere.");
      return;
    }
    if (administrators[0].email === administrators[1].email) {
      setLoadError("Use um e-mail diferente para cada administrador.");
      return;
    }
    if (administrators[0].password === administrators[1].password) {
      setLoadError("Crie uma senha diferente para cada administrador.");
      return;
    }

    setBusyAction("initial-setup");
    setLoadError("");
    try {
      const status = await requestJson<AuthStatusPayload>("/api/auth/setup", {
        method: "POST",
        body: JSON.stringify({
          setupKey,
          establishmentName,
          administrators: administrators.map(
            ({ displayName, email, password }) => ({
              displayName,
              email,
              password,
            }),
          ),
        }),
      });
      setSessionExpiresAt(status.sessionExpiresAt ?? null);
      setRuntimeMode("loading");
      await refreshWorkspace();
    } catch (error) {
      setRuntimeMode("setup");
      setLoadError(
        error instanceof Error
          ? error.message
          : "Não foi possível cadastrar os administradores.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyAction) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    if (!email || !password) {
      setLoadError("Informe seu e-mail e sua senha.");
      return;
    }
    setBusyAction("login");
    setLoadError("");
    try {
      const status = await requestJson<AuthStatusPayload>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (status.identity?.role === "customer") {
        window.location.assign("/portal");
        return;
      }
      setSessionExpiresAt(status.sessionExpiresAt ?? null);
      setRuntimeMode("loading");
      await refreshWorkspace();
    } catch (error) {
      setRuntimeMode("login");
      setLoadError(
        error instanceof Error
          ? error.message
          : "Não foi possível entrar.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function logout() {
    if (busyAction) return;
    setBusyAction("logout");
    try {
      await requestJson("/api/auth/logout", { method: "POST" });
    } catch {
      // Clear local state even if the server-side session already expired.
    } finally {
      clearOperationalData();
      setSessionExpiresAt(null);
      setLoadError("");
      setRuntimeMode("login");
      setBusyAction(null);
    }
  }

  async function submitOnboarding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = onboardingName.trim();
    if (!name) {
      setLoadError("Informe o nome do estabelecimento.");
      return;
    }
    if (!onboardingPayload?.onboarding.canInitialize) {
      setLoadError(
        "Somente o proprietário pode concluir a configuração inicial.",
      );
      return;
    }
    setBusyAction("onboarding");
    setLoadError("");
    try {
      await requestJson("/api/bootstrap", {
        method: "POST",
        body: JSON.stringify({ establishmentName: name }),
      });
      setRuntimeMode("loading");
      await refreshWorkspace();
    } catch (error) {
      setRuntimeMode("onboarding");
      setLoadError(
        error instanceof Error
          ? error.message
          : "Não foi possível concluir a configuração inicial.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  if (runtimeMode === "loading") {
    return (
      <StartupScreen
        title="Abrindo o Hospet Quintal"
        description="Conectando ao ambiente privado e carregando a agenda."
      />
    );
  }

  if (runtimeMode === "setup") {
    return (
      <InitialSetupScreen
        onSubmit={submitInitialSetup}
        busy={busyAction === "initial-setup"}
        error={loadError}
      />
    );
  }

  if (runtimeMode === "login") {
    return (
      <LoginScreen
        onSubmit={submitLogin}
        busy={busyAction === "login"}
        error={loadError}
      />
    );
  }

  if (runtimeMode === "onboarding") {
    return (
      <OnboardingScreen
        displayName={onboardingPayload?.identity.displayName ?? "Administrador"}
        canInitialize={
          onboardingPayload?.onboarding.canInitialize === true
        }
        establishmentName={onboardingName}
        setEstablishmentName={setOnboardingName}
        onSubmit={submitOnboarding}
        busy={busyAction === "onboarding"}
        error={loadError}
      />
    );
  }

  if (runtimeMode === "error") {
    return (
      <StartupScreen
        title="Não foi possível abrir o sistema"
        description={
          loadError ||
          "Confira sua conexão e tente novamente. Nenhum dado foi alterado."
        }
        actionLabel="Tentar novamente"
        onAction={() => {
          setRuntimeMode("loading");
          void refreshWorkspace();
        }}
      />
    );
  }

  const selectedDog = dogs.find((dog) => dog.id === selectedDogId) ?? null;
  const selectedCustomer =
    customers.find((customer) => customer.id === selectedCustomerId) ?? null;
  const serviceDraftDog =
    dogs.find((dog) => dog.id === serviceDraftDogId) ?? null;
  const serviceDogMatches = (() => {
    const query = normalize(serviceDraftDogSearch);
    return dogs
      .filter((dog) =>
        !query ||
        normalize(`${dog.name} ${dog.customerName}`).includes(query),
      )
      .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"))
      .slice(0, 8);
  })();
  const pendingBillingCount =
    billableServices.length +
    invoices.filter(
      (invoice) =>
        invoice.status === "overdue" ||
        Boolean(
          invoice.compensationAvailableOn &&
            invoice.compensationAvailableOn < operationalToday,
        ) ||
        Boolean(
          invoice.followUpOn && invoice.followUpOn <= operationalToday,
        ),
    ).length;
  const signedInName =
    workspacePayload?.identity.displayName || "Administração";
  const signedInRole = workspacePayload?.identity.role ?? "owner";
  const visibleNavItems = navItems.filter((item) => {
    if (signedInRole === "owner") return true;
    if (signedInRole === "finance") {
      return ["today", "billing", "customers", "cash"].includes(
        item.id,
      );
    }
    return ["today", "requests", "dogs", "customers"].includes(item.id);
  });

  const copy = pageCopy[view];

  return (
    <div className="app-root">
      <a className="skip-link" href="#conteudo-principal">
        Ir para o conteúdo
      </a>

      <aside className="sidebar" aria-label="Navegação principal">
        <button className="brand" onClick={() => navigate("today")}>
          <span className="brand-mark" aria-hidden="true">
            HQ
          </span>
          <span>
            <strong>Hospet Quintal <small>HQ</small></strong>
            <small>Operação e cuidados</small>
          </span>
        </button>

        <nav className="side-nav">
          <p className="nav-caption">Trabalho</p>
          {visibleNavItems.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "nav-item active" : "nav-item"}
              onClick={() => navigate(item.id)}
              aria-current={view === item.id ? "page" : undefined}
            >
              <span className="nav-dot" aria-hidden="true" />
              {item.label}
              {item.id === "billing" && (
                <span
                  className="nav-count"
                  aria-label={`${pendingBillingCount} cobranças pendentes`}
                >
                  {pendingBillingCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />
        <div className="account-card">
          <span className="avatar avatar-forest">
            {initials(signedInName)}
          </span>
          <span>
            <strong>{signedInName}</strong>
            <small>
              {signedInRole === "owner" ? "Administrador" : "Funcionário"}
            </small>
          </span>
          {runtimeMode === "ready" && (
            <button
              className="account-logout"
              onClick={() => void logout()}
              disabled={busyAction === "logout"}
            >
              Sair
            </button>
          )}
        </div>
      </aside>

      <div className="mobile-header">
        <button className="brand compact" onClick={() => navigate("today")}>
          <span className="brand-mark">HQ</span>
          <strong>Hospet Quintal <small>HQ</small></strong>
        </button>
        <div className="mobile-header-actions">
          <button
            className="icon-text-button"
            onClick={() => setDialog("task")}
            aria-label="Nova tarefa"
          >
            Tarefa
          </button>
          {runtimeMode === "ready" && (
            <button
              className="icon-text-button"
              onClick={() => void logout()}
              disabled={busyAction === "logout"}
            >
              Sair
            </button>
          )}
        </div>
      </div>

      <div className="workspace">
        {runtimeMode !== "ready" && (
          <div className="demo-banner" role="status">
            <span className="demo-label">Demonstração segura</span>
            <span>
              Todos os nomes, contatos e valores são fictícios. Nada aqui é
              uma cobrança real.
            </span>
          </div>
        )}

        <header className="topbar">
          <div>
            <p className="eyebrow">{copy.eyebrow}</p>
            <h1 ref={titleRef} tabIndex={-1}>
              {copy.title}
            </h1>
            <p>{copy.description}</p>
          </div>
          <div className="topbar-actions">
            <div className="global-search">
              <label className="sr-only" htmlFor="global-search">
                Buscar cão, cliente ou telefone
              </label>
              <input
                id="global-search"
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setSearchCursor(0);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder="Buscar cão, cliente ou telefone…"
                autoComplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={normalize(search).length >= 2}
                aria-controls="search-results"
              />
              {search && (
                <button
                  className="clear-search"
                  onClick={() => setSearch("")}
                  aria-label="Limpar busca"
                >
                  Limpar
                </button>
              )}
              {normalize(search).length >= 2 && (
                <div
                  className="search-popover"
                  id="search-results"
                  role="listbox"
                >
                  {searchResults.length ? (
                    searchResults.map((result, index) => (
                      <button
                        key={result.id}
                        className={
                          searchCursor === index
                            ? "search-result selected"
                            : "search-result"
                        }
                        onMouseEnter={() => setSearchCursor(index)}
                        onClick={() => openSearchResult(result)}
                        role="option"
                        aria-selected={searchCursor === index}
                      >
                        <span className="search-type">
                          {result.type === "dog" ? "Cão" : "Cliente"}
                        </span>
                        <span>
                          <strong>{result.title}</strong>
                          <small>{result.detail}</small>
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="search-empty">
                      <strong>Nenhum resultado encontrado.</strong>
                      <button
                        className="text-button"
                        onClick={() => {
                          setSearch("");
                          setRegistrationType("customer");
                          setDialog("registration");
                        }}
                      >
                        Cadastrar novo cliente
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            <button className="secondary-button" onClick={() => setDialog("task")}>
              Nova tarefa
            </button>
            <button
              className="primary-button"
              onClick={() => openServiceDialog()}
            >
              <span aria-hidden="true">+</span> Novo serviço
            </button>
          </div>
        </header>

        <main id="conteudo-principal">
          {view === "today" && (
            <TodayView
              bookings={bookings}
              dogs={dogs}
              customers={customers}
              tasks={tasks}
              receipts={receipts}
              selectedDate={selectedDate}
              onDateChange={selectAgendaDate}
              agendaFilter={agendaFilter}
              setAgendaFilter={setAgendaFilter}
              agendaServiceFilter={agendaServiceFilter}
              setAgendaServiceFilter={setAgendaServiceFilter}
              onAdvance={advanceBooking}
              onMenu={setOpenMenuId}
              openMenuId={openMenuId}
              onEdit={openBookingEditor}
              onCancel={askToCancel}
              onToggleTask={toggleTask}
              onClearCompletedTasks={clearCompletedTasks}
              onViewBilling={() => navigate("billing")}
              onOpenInvoice={openExistingInvoice}
              onLodgingInvoice={issueLodgingInvoice}
              onOpenReceipt={openReceipt}
              onSaveDogFeeding={saveDogFeeding}
              onQuickService={
                ["owner", "staff"].includes(signedInRole)
                  ? () => setDialog("quickService")
                  : undefined
              }
              invoice={invoices.find(
                (item) => item.status !== "paid" && item.status !== "void",
              )}
              billingReminders={invoices.filter(
                (item) =>
                  item.status !== "paid" &&
                  item.status !== "void" &&
                  item.followUpOn === operationalToday,
              )}
            />
          )}
          {view === "requests" && <CustomerRequestsView />}
          {view === "dogs" &&
            (selectedDog ? (
              <DogProfile
                dog={selectedDog}
                creditBalances={creditBalances}
                bookings={bookings.filter(
                  (booking) => booking.dogId === selectedDog.id,
                )}
                onBack={() => setSelectedDogId(null)}
                onEdit={() => openDogEditor(selectedDog)}
                onNewService={() => openServiceDialog(selectedDog.id)}
                receipts={receipts}
                onAdvance={advanceBooking}
                onMenu={setOpenMenuId}
                openMenuId={openMenuId}
                onEditBooking={openBookingEditor}
                onCancelBooking={askToCancel}
                onOpenReceipt={openReceipt}
                onLodgingInvoice={issueLodgingInvoice}
              />
            ) : (
              <DogsView
                dogs={dogs}
                onSelect={setSelectedDogId}
                onNew={() => {
                  setRegistrationType("dog");
                  setDialog("registration");
                }}
              />
            ))}
          {view === "customers" &&
            (selectedCustomer ? (
              <CustomerProfile
                customer={selectedCustomer}
                dogs={dogs.filter((dog) =>
                  selectedCustomer.dogIds.includes(dog.id),
                )}
                bookings={bookings.filter(
                  (booking) => booking.customerId === selectedCustomer.id,
                )}
                invoices={invoices.filter(
                  (invoice) => invoice.customerId === selectedCustomer.id,
                )}
                onBack={() => setSelectedCustomerId(null)}
                onEdit={() => openCustomerEditor(selectedCustomer)}
                onOpenDog={(dogId) => {
                  setSelectedCustomerId(null);
                  setSelectedDogId(dogId);
                  setView("dogs");
                }}
                onOpenInvoice={openExistingInvoice}
                creditBalances={creditBalances}
                creditPurchases={creditPurchases.filter(
                  (purchase) => purchase.customerId === selectedCustomer.id,
                )}
                receipts={receipts.filter(
                  (receipt) => receipt.customerId === selectedCustomer.id,
                )}
                onAddCredits={() => openCreditPackage(selectedCustomer.id)}
                onAdjustCredits={() => openCreditAdjustment(selectedCustomer.id)}
                canAdjustCredits={signedInRole === "owner"}
                onOpenReceipt={openReceipt}
                onNewService={() => openServiceDialog()}
                onAdvance={advanceBooking}
                onMenu={setOpenMenuId}
                openMenuId={openMenuId}
                onEditBooking={openBookingEditor}
                onCancelBooking={askToCancel}
                onLodgingInvoice={issueLodgingInvoice}
                onStatement={() => openStatement(selectedCustomer.id)}
              />
            ) : (
              <CustomersView
                customers={customers}
                dogs={dogs}
                onSelect={setSelectedCustomerId}
                onNew={() => {
                  setRegistrationType("customer");
                  setDialog("registration");
                }}
              />
            ))}
          {view === "billing" && (
            <BillingView
              invoices={invoices}
              billableServices={billableServices}
              selectedBillables={selectedBillables}
              tab={billingTab}
              onTabChange={setBillingTab}
              customers={customers}
              creditBalances={creditBalances}
              creditPurchases={creditPurchases}
              receipts={receipts}
              onToggleBillable={toggleBillable}
              onRegularBilling={setRegularBillingService}
              onUseCredits={useCreditsForBillable}
              onCreateInvoice={openInvoiceForSelection}
              onOpenInvoice={openExistingInvoice}
              onAddCredits={(customerId) => openCreditPackage(customerId)}
              onOpenReceipt={openReceipt}
              onToggleCash={toggleInvoiceCash}
              onSaveNote={saveInvoiceNote}
              onMergeInvoices={mergeInvoices}
              onReverseInvoiceMerge={reverseInvoiceMerge}
              onStatement={() => openStatement()}
              onLoadHistory={loadInvoiceHistory}
              mergeBusy={busyAction === "merge-invoices"}
            />
          )}
          {view === "cash" && ["owner", "finance"].includes(signedInRole) && (
            <CashView
              canEditSettings={signedInRole === "owner"}
              referenceDate={operationalToday}
              onChanged={() => void refreshWorkspace()}
              onOpenBilling={() => setView("billing")}
            />
          )}
          {view === "activity" && (
            <ActivityView
              activities={activities}
              onLoadPeriod={loadActivityPeriod}
            />
          )}
          {view === "access" && signedInRole === "owner" && (
            <AccessView customers={customers} />
          )}
          {view === "settings" && (
            <SettingsView
              prices={servicePrices}
              lodgingPricing={lodgingPricing}
              creditPricing={creditPricing}
              groomingAddonPriceCents={groomingAddonPriceCents}
              daycareStartTime={daycareStartTime}
              daycareEndTime={daycareEndTime}
              onSave={saveDefaultPrices}
            />
          )}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Navegação móvel">
        {visibleNavItems.slice(0, 4).map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "active" : ""}
            onClick={() => {
              setMobileMoreOpen(false);
              navigate(item.id);
            }}
          >
            <span className="mobile-nav-mark" aria-hidden="true" />
            {item.shortLabel}
          </button>
        ))}
        <button
          className={
            mobileMoreOpen ||
            ["billing", "cash", "activity", "access", "settings"].includes(view)
              ? "active"
              : ""
          }
          onClick={() => setMobileMoreOpen((current) => !current)}
          aria-expanded={mobileMoreOpen}
        >
          <span className="mobile-nav-mark" aria-hidden="true" />
          Mais
        </button>
      </nav>

      {mobileMoreOpen && (
        <div className="mobile-more-menu" role="menu">
          {visibleNavItems.slice(4).map((item) => (
            <button
              key={item.id}
              role="menuitem"
              onClick={() => {
                setMobileMoreOpen(false);
                navigate(item.id);
              }}
            >
              <strong>{item.label}</strong>
              {item.id === "billing" && pendingBillingCount > 0 && (
                <span>{pendingBillingCount} pendentes</span>
              )}
            </button>
          ))}
        </div>
      )}

      <button
        className="mobile-fab"
        onClick={() => openServiceDialog()}
        hidden={
          Boolean(selectedDog || selectedCustomer) ||
          !["today", "dogs", "customers"].includes(view) ||
          !["owner", "staff"].includes(signedInRole)
        }
      >
        <span aria-hidden="true">+</span> Novo serviço
      </button>

      {dialog === "quickService" && workspacePayload && (
        <QuickServiceDialog
          customers={customers}
          dogs={dogs}
          services={workspacePayload.serviceCatalog.filter(
            (service) => service.active,
          )}
          lodgingPricing={lodgingPricing}
          defaultDate={selectedDate}
          busy={busyAction === "quick-services"}
          onClose={() => setDialog(null)}
          onSubmit={createQuickServices}
        />
      )}

      {dialog === "service" && (
        <Dialog
          title="Novo serviço"
          description="Agende o cuidado. A forma de quitação e o valor serão confirmados após a conclusão."
          onClose={() => setDialog(null)}
        >
          <form className="form-grid" onSubmit={submitService}>
            <label className="field full">
              <span>Cão *</span>
              <div className="service-dog-picker">
                <input type="hidden" name="dogId" value={serviceDraftDogId} />
                <input
                  type="search"
                  value={serviceDraftDogSearch}
                  onChange={(event) => {
                    setServiceDraftDogSearch(event.target.value);
                    setServiceDraftDogId("");
                    setServiceDogPickerOpen(true);
                  }}
                  onFocus={() => setServiceDogPickerOpen(true)}
                  onBlur={() =>
                    window.setTimeout(() => setServiceDogPickerOpen(false), 120)
                  }
                  placeholder="Digite o nome do cão…"
                  autoComplete="off"
                  autoFocus
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={serviceDogPickerOpen}
                  aria-controls="new-service-dog-results"
                  aria-describedby={
                    serviceDraftDog ? "new-service-dog-selection" : undefined
                  }
                />
                {serviceDogPickerOpen && (
                  <div
                    className="service-dog-suggestions"
                    id="new-service-dog-results"
                    role="listbox"
                  >
                    {serviceDogMatches.length ? (
                      serviceDogMatches.map((dog) => (
                        <button
                          key={dog.id}
                          type="button"
                          role="option"
                          aria-selected={dog.id === serviceDraftDogId}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setServiceDraftDogId(dog.id);
                            setServiceDraftDogSearch(dog.name);
                            setServiceDogPickerOpen(false);
                          }}
                        >
                          <strong>{dog.name}</strong>
                          <small>{dog.customerName}</small>
                        </button>
                      ))
                    ) : (
                      <p>Nenhum cão encontrado.</p>
                    )}
                  </div>
                )}
              </div>
              {serviceDraftDog && (
                <small
                  className="service-dog-selection"
                  id="new-service-dog-selection"
                >
                  Cliente: {serviceDraftDog.customerName}
                </small>
              )}
            </label>
            <label className="field">
              <span>{serviceDraftType === "hotel" ? "Entrada *" : "Data *"}</span>
              <BrazilianDateInput
                name="date"
                value={serviceDraftDate}
                required
                ariaLabel={
                  serviceDraftType === "hotel"
                    ? "Data de entrada"
                    : "Data do serviço"
                }
                onChange={(nextDate) => {
                  setServiceDraftDate(nextDate);
                  if (
                    serviceDraftType === "hotel" &&
                    serviceDraftEndDate <= nextDate
                  ) {
                    const nextEndDate = shiftDate(nextDate, 1);
                    setServiceDraftEndDate(nextEndDate);
                    setServiceDraftLodgingNights(1);
                  }
                }}
              />
            </label>
            {serviceDraftType === "hotel" && (
              <label className="field">
                <span>Saída *</span>
                <BrazilianDateInput
                  name="endDate"
                  value={serviceDraftEndDate}
                  min={shiftDate(serviceDraftDate, 1)}
                  required
                  ariaLabel="Data de saída"
                  onChange={(nextEndDate) => {
                    setServiceDraftEndDate(nextEndDate);
                    const options = lodgingNightOptions(
                      serviceDraftDate,
                      nextEndDate,
                    );
                    if (options.length) {
                      setServiceDraftLodgingNights(options[0]);
                    }
                  }}
                />
              </label>
            )}
            <label className="field">
              <span>Serviço *</span>
              <select
                name="serviceType"
                value={serviceDraftType}
                onChange={(event) => {
                  const next = event.target.value as ServiceType;
                  setServiceDraftType(next);
                  if (next !== "bath") setServiceDraftGroomingAddon(false);
                  if (next !== "hotel") {
                    setServiceDraftHasDeposit(false);
                    setServiceDraftDaycareCustomer(false);
                    setServiceDraftAdditionalDog(false);
                  }
                  if (next === "hotel") {
                    const nextEndDate =
                      serviceDraftEndDate > serviceDraftDate
                        ? serviceDraftEndDate
                        : shiftDate(serviceDraftDate, 1);
                    const options = lodgingNightOptions(
                      serviceDraftDate,
                      nextEndDate,
                    );
                    setServiceDraftEndDate(nextEndDate);
                    const nextNights = options[0] ?? 1;
                    setServiceDraftLodgingNights(nextNights);
                  }
                }}
              >
                {Object.entries(serviceLabels).filter(([key]) => key !== "grooming").map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {serviceDraftType === "bath" && (
              <label className="check-field full">
                <input
                  name="groomingAddon"
                  type="checkbox"
                  checked={serviceDraftGroomingAddon}
                  onChange={(event) =>
                    setServiceDraftGroomingAddon(event.target.checked)
                  }
                />
                <span>
                  Incluir tosa
                  <small>O adicional será cobrado após o atendimento.</small>
                </span>
              </label>
            )}
            {serviceDraftType !== "transport" && (
              <>
                {serviceDraftType === "hotel" || serviceDraftType === "daycare" ? (
                  <>
                    <ServiceTimeInput
                      key={`new-${serviceDraftType}-start`}
                      name="time"
                      label={
                        serviceDraftType === "hotel"
                          ? "Entrada (opcional)"
                          : "Check-in *"
                      }
                      defaultValue={
                        serviceDraftType === "daycare" ? daycareStartTime : ""
                      }
                      required={serviceDraftType === "daycare"}
                    />
                    <ServiceTimeInput
                      key={`new-${serviceDraftType}-end`}
                      name="endTime"
                      label={
                        serviceDraftType === "hotel"
                          ? "Saída (opcional)"
                          : "Check-out"
                      }
                      defaultValue={
                        serviceDraftType === "daycare" ? daycareEndTime : ""
                      }
                    />
                  </>
                ) : (
                  <>
                    <label className="field">
                      <span>Horário inicial *</span>
                      <input name="time" type="time" defaultValue="09:00" required />
                    </label>
                    <label className="field">
                      <span>Horário final</span>
                      <input name="endTime" type="time" defaultValue="17:00" />
                    </label>
                  </>
                )}
              </>
            )}
            {serviceDraftType === "transport" && (
              <label className="field">
                <span>Trajeto *</span>
                <select name="transportDirection" value={serviceDraftTransportDirection} onChange={(event) => {
                  const nextDirection = event.target.value as "one_way" | "round_trip";
                  setServiceDraftTransportDirection(nextDirection);
                }}>
                  <option value="one_way">
                    Ida
                  </option>
                  <option value="round_trip">
                    Ida e volta
                  </option>
                </select>
              </label>
            )}
            {serviceDraftType === "hotel" && (
              <>
                <label className="field">
                  <span>Número de diárias *</span>
                  <select
                    name="lodgingNights"
                    value={serviceDraftLodgingNights}
                    onChange={(event) => {
                      const nextNights = Number(event.target.value);
                      setServiceDraftLodgingNights(nextNights);
                    }}
                    required
                  >
                    {lodgingNightOptions(
                      serviceDraftDate,
                      serviceDraftEndDate,
                    ).map((nights) => (
                      <option key={nights} value={nights}>
                        {String(nights).replace(".", ",")}{" "}
                        {nights === 1 ? "diária" : "diárias"}
                      </option>
                    ))}
                  </select>
                  <small>
                    Opções compatíveis com o período de entrada e saída.
                  </small>
                </label>
                <label className="check-field">
                  <input
                    name="hasDeposit"
                    type="checkbox"
                    checked={serviceDraftHasDeposit}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setServiceDraftHasDeposit(checked);
                      if (!checked) {
                        setServiceDraftDaycareCustomer(false);
                        setServiceDraftAdditionalDog(false);
                      }
                    }}
                  />
                  <span>Cobrar sinal no check-in</span>
                </label>
                {serviceDraftHasDeposit && (
                  <>
                    <label className="field">
                      <span>Sinal no check-in (%)</span>
                      <input
                        name="depositPercent"
                        type="number"
                        min="1"
                        max="99"
                        defaultValue="50"
                        required
                      />
                    </label>
                    <fieldset className="lodging-rate-options">
                      <legend>Condição da diária para calcular o sinal</legend>
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={serviceDraftDaycareCustomer}
                          onChange={(event) =>
                            setServiceDraftDaycareCustomer(event.target.checked)
                          }
                        />
                        <span>Aplicar diária para cliente de creche regular</span>
                      </label>
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={serviceDraftAdditionalDog}
                          onChange={(event) =>
                            setServiceDraftAdditionalDog(event.target.checked)
                          }
                        />
                        <span>Aplicar diária para segundo cão ou mais nesta reserva</span>
                      </label>
                      <small className="field-help">
                        {lodgingRateLabel(
                          lodgingRateProfile(
                            serviceDraftDaycareCustomer,
                            serviceDraftAdditionalDog,
                          ),
                        )}: {formatCurrency(
                          lodgingDailyRate(
                            lodgingPricing,
                            lodgingRateProfile(
                              serviceDraftDaycareCustomer,
                              serviceDraftAdditionalDog,
                            ),
                          ),
                        )} por diária.
                      </small>
                    </fieldset>
                  </>
                )}
                {!serviceDraftHasDeposit && (
                  <small className="field-help full">
                    A condição da diária será definida em Cobranças, ao escolher Regular.
                  </small>
                )}
              </>
            )}
            <div className="form-guidance">
              <strong>Cobrança após a conclusão</strong>
              <span>Em Cobranças, escolha entre créditos ou cobrança regular e confirme o valor.</span>
            </div>
            <label className="field">
              <span>Recorrência</span>
              <select
                name="recurrence"
                value={serviceDraftRecurrence}
                onChange={(event) =>
                  setServiceDraftRecurrence(
                    event.target.value as "none" | "weekly",
                  )
                }
              >
                <option value="none">Não repetir</option>
                <option value="weekly">Toda semana</option>
              </select>
            </label>
            {serviceDraftRecurrence === "weekly" && (
              <label className="field">
                <span>Repetir por quantas semanas? *</span>
                <input
                  name="recurrenceCount"
                  type="number"
                  min="2"
                  max="52"
                  step="1"
                  defaultValue="12"
                  required
                />
                <small>
                  Cada semana ficará ligada à mesma recorrência.
                </small>
              </label>
            )}
            <div className="form-guidance full">
              <strong>Cobrança decidida depois</strong>
              <span>
                Após concluir o atendimento, escolha em Cobranças entre usar
                créditos disponíveis ou incluir o serviço em uma fatura.
              </span>
            </div>
            <label className="field full">
              <span>Observação interna</span>
              <textarea
                name="note"
                rows={3}
                placeholder="Cuidados, endereço ou instruções para a equipe"
              />
            </label>
            <div className="dialog-actions full">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setDialog(null)}
              >
                Cancelar
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={busyAction?.startsWith("new-service:")}
              >
                {busyAction?.startsWith("new-service:")
                  ? "Salvando…"
                  : "Salvar serviço"}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {dialog === "editService" && bookingToEdit && (
        <Dialog
          title="Editar serviço"
          description={`Atualize o atendimento de ${bookingToEdit.dogName}.`}
          onClose={() => {
            setDialog(null);
            setBookingToEdit(null);
          }}
        >
          <form className="form-grid" onSubmit={submitBookingEdit}>
            <label className="field">
              <span>
                {editDraftType === "hotel" ? "Entrada *" : "Data *"}
              </span>
              <BrazilianDateInput
                name="date"
                value={editDraftDate}
                autoFocus
                required
                ariaLabel={
                  editDraftType === "hotel"
                    ? "Data de entrada"
                    : "Data do serviço"
                }
                onChange={(nextDate) => {
                  setEditDraftDate(nextDate);
                  if (
                    editDraftType === "hotel" &&
                    editDraftEndDate <= nextDate
                  ) {
                    const nextEndDate = shiftDate(nextDate, 1);
                    setEditDraftEndDate(nextEndDate);
                    setEditDraftLodgingNights(1);
                  }
                }}
              />
            </label>
            {editDraftType === "hotel" && (
              <label className="field">
                <span>Saída *</span>
                <BrazilianDateInput
                  name="endDate"
                  value={editDraftEndDate}
                  min={shiftDate(editDraftDate, 1)}
                  required
                  ariaLabel="Data de saída"
                  onChange={(nextEndDate) => {
                    setEditDraftEndDate(nextEndDate);
                    const options = lodgingNightOptions(
                      editDraftDate,
                      nextEndDate,
                    );
                    if (options.length) {
                      setEditDraftLodgingNights(options[0]);
                    }
                  }}
                />
              </label>
            )}
            <label className="field">
              <span>Serviço *</span>
              <select
                name="serviceType"
                value={editDraftType}
                onChange={(event) => {
                  const next = event.target.value as ServiceType;
                  setEditDraftType(next);
                  if (next !== "bath") setEditDraftGroomingAddon(false);
                  if (next !== "hotel") {
                    setEditDraftHasDeposit(false);
                    setEditDraftDaycareCustomer(false);
                    setEditDraftAdditionalDog(false);
                  }
                  if (next === "hotel") {
                    const nextEndDate =
                      editDraftEndDate > editDraftDate
                        ? editDraftEndDate
                        : shiftDate(editDraftDate, 1);
                    const options = lodgingNightOptions(
                      editDraftDate,
                      nextEndDate,
                    );
                    setEditDraftEndDate(nextEndDate);
                    const nextNights = options[0] ?? 1;
                    setEditDraftLodgingNights(nextNights);
                  }
                }}
              >
                {Object.entries(serviceLabels).filter(([key]) => key !== "grooming").map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {editDraftType === "bath" && (
              <label className="check-field full">
                <input
                  name="groomingAddon"
                  type="checkbox"
                  checked={editDraftGroomingAddon}
                  onChange={(event) =>
                    setEditDraftGroomingAddon(event.target.checked)
                  }
                />
                <span>
                  Incluir tosa
                  <small>O adicional será cobrado após o atendimento.</small>
                </span>
              </label>
            )}
            {editDraftType !== "transport" && (
              <>
                {editDraftType === "hotel" || editDraftType === "daycare" ? (
                  <>
                    <ServiceTimeInput
                      key={`edit-${bookingToEdit.id}-${editDraftType}-start`}
                      name="time"
                      label={editDraftType === "hotel" ? "Entrada (opcional)" : "Check-in *"}
                      defaultValue={
                        bookingToEdit.time === "Sem horário"
                          ? ""
                          : bookingToEdit.time
                      }
                      required={editDraftType === "daycare"}
                    />
                    <ServiceTimeInput
                      key={`edit-${bookingToEdit.id}-${editDraftType}-end`}
                      name="endTime"
                      label={editDraftType === "hotel" ? "Saída (opcional)" : "Check-out"}
                      defaultValue={bookingToEdit.endTime}
                    />
                  </>
                ) : (
                  <>
                    <label className="field">
                      <span>Horário inicial *</span>
                      <input
                        name="time"
                        type="time"
                        defaultValue={
                          bookingToEdit.time === "Sem horário"
                            ? ""
                            : bookingToEdit.time
                        }
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Horário final</span>
                      <input
                        name="endTime"
                        type="time"
                        defaultValue={bookingToEdit.endTime}
                      />
                    </label>
                  </>
                )}
              </>
            )}
            {editDraftType === "transport" && (
              <label className="field">
                <span>Trajeto *</span>
                <select
                  name="transportDirection"
                  value={editDraftTransportDirection}
                  onChange={(event) => {
                    const nextDirection = event.target.value as
                      | "one_way"
                      | "round_trip";
                    setEditDraftTransportDirection(nextDirection);
                  }}
                >
                  <option value="one_way">
                    Ida
                  </option>
                  <option value="round_trip">
                    Ida e volta
                  </option>
                </select>
              </label>
            )}
            {editDraftType === "hotel" && (
              <>
                <label className="field">
                  <span>Número de diárias *</span>
                  <select
                    name="lodgingNights"
                    value={editDraftLodgingNights}
                    onChange={(event) => {
                      const nextNights = Number(event.target.value);
                      setEditDraftLodgingNights(nextNights);
                    }}
                    required
                  >
                    {lodgingNightOptions(
                      editDraftDate,
                      editDraftEndDate,
                    ).map((nights) => (
                      <option key={nights} value={nights}>
                        {String(nights).replace(".", ",")}{" "}
                        {nights === 1 ? "diária" : "diárias"}
                      </option>
                    ))}
                  </select>
                  <small>
                    Opções compatíveis com o período de entrada e saída.
                  </small>
                </label>
                <label className="check-field">
                  <input
                    name="hasDeposit"
                    type="checkbox"
                    checked={editDraftHasDeposit}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setEditDraftHasDeposit(checked);
                      if (!checked) {
                        setEditDraftDaycareCustomer(false);
                        setEditDraftAdditionalDog(false);
                      }
                    }}
                  />
                  <span>Cobrar sinal no check-in</span>
                </label>
                {editDraftHasDeposit && (
                  <>
                    <label className="field">
                      <span>Sinal no check-in (%)</span>
                      <input
                        name="depositPercent"
                        type="number"
                        min="1"
                        max="99"
                        defaultValue={bookingToEdit.depositPercent ?? 50}
                        required
                      />
                    </label>
                    <fieldset className="lodging-rate-options">
                      <legend>Condição da diária para calcular o sinal</legend>
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={editDraftDaycareCustomer}
                          onChange={(event) =>
                            setEditDraftDaycareCustomer(event.target.checked)
                          }
                        />
                        <span>Aplicar diária para cliente de creche regular</span>
                      </label>
                      <label className="check-field">
                        <input
                          type="checkbox"
                          checked={editDraftAdditionalDog}
                          onChange={(event) =>
                            setEditDraftAdditionalDog(event.target.checked)
                          }
                        />
                        <span>Aplicar diária para segundo cão ou mais nesta reserva</span>
                      </label>
                      <small className="field-help">
                        {lodgingRateLabel(
                          lodgingRateProfile(
                            editDraftDaycareCustomer,
                            editDraftAdditionalDog,
                          ),
                        )}: {formatCurrency(
                          lodgingDailyRate(
                            lodgingPricing,
                            lodgingRateProfile(
                              editDraftDaycareCustomer,
                              editDraftAdditionalDog,
                            ),
                          ),
                        )} por diária.
                      </small>
                    </fieldset>
                  </>
                )}
                {!editDraftHasDeposit && (
                  <small className="field-help full">
                    A condição da diária será definida em Cobranças, ao escolher Regular.
                  </small>
                )}
              </>
            )}
            <div className="form-guidance">
              <strong>Cobrança após a conclusão</strong>
              <span>Em Cobranças, escolha entre créditos ou cobrança regular e confirme o valor.</span>
            </div>
            <label className="field full">
              <span>Observação interna</span>
              <textarea
                name="note"
                rows={3}
                defaultValue={bookingToEdit.note}
              />
            </label>
            <div className="dialog-actions full">
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setDialog(null);
                  setBookingToEdit(null);
                }}
              >
                Cancelar
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={busyAction === `edit-appointment:${bookingToEdit.id}`}
              >
                {busyAction === `edit-appointment:${bookingToEdit.id}`
                  ? "Salvando…"
                  : "Salvar alterações"}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {dialog === "editDog" && dogToEdit && (
        <Dialog
          title={`Editar ${dogToEdit.name}`}
          description="Mantenha os dados e alertas de cuidado atualizados."
          onClose={() => {
            setDialog(null);
            setDogToEdit(null);
          }}
          size="small"
        >
          <form className="form-grid" onSubmit={submitDogEdit}>
            <label className="field full">
              <span>Nome do cão *</span>
              <input
                name="name"
                defaultValue={dogToEdit.name}
                autoFocus
                required
              />
            </label>
            <label className="field">
              <span>Raça</span>
              <input name="breed" defaultValue={dogToEdit.breed} />
            </label>
            {runtimeMode === "ready" ? (
              <label className="field">
                <span>Data de nascimento</span>
                <BrazilianDateInput
                  name="birthDate"
                  defaultValue={dogToEdit.birthDate}
                  ariaLabel="Data de nascimento do cão"
                />
              </label>
            ) : (
              <label className="field">
                <span>Idade</span>
                <input name="age" defaultValue={dogToEdit.age} />
              </label>
            )}
            <label className="field">
              <span>Sexo</span>
              <select name="sex" defaultValue={dogToEdit.sex ?? "unknown"}>
                <option value="unknown">Não informado</option>
                <option value="female">Fêmea</option>
                <option value="male">Macho</option>
              </select>
            </label>
            <label className="field">
              <span>É castrado?</span>
              <select
                name="neutered"
                defaultValue={
                  dogToEdit.neutered === true
                    ? "yes"
                    : dogToEdit.neutered === false
                      ? "no"
                      : ""
                }
              >
                <option value="">Não informado</option>
                <option value="yes">Sim</option>
                <option value="no">Não</option>
              </select>
            </label>
            <label className="field full">
              <span>Alerta essencial</span>
              <textarea
                name="alert"
                rows={3}
                defaultValue={dogToEdit.alert}
              />
            </label>
            <label className="field full">
              <span>Alimentação</span>
              <textarea name="feedingNotes" rows={2} defaultValue={dogToEdit.feedingNotes} placeholder="Alimentos, porções e restrições" />
            </label>
            <label className="field full">
              <span>Temperamento</span>
              <textarea name="temperamentNotes" rows={2} defaultValue={dogToEdit.temperamentNotes} placeholder="Como o cão reage e prefere ser cuidado" />
            </label>
            <label className="field full">
              <span>Medicação</span>
              <textarea name="medicationNotes" rows={2} defaultValue={dogToEdit.medicationNotes} placeholder="Nome, dose e horários" />
            </label>
            <label className="field">
              <span>Vacina</span>
              <input name="vaccineName" placeholder="Nome da vacina" />
            </label>
            <label className="field">
              <span>Vencimento da vacina</span>
              <BrazilianDateInput
                name="vaccineExpiresOn"
                ariaLabel="Data de vencimento da vacina"
              />
            </label>
            {dogToEdit.vaccines?.length ? <div className="field full"><small>Vacinas registradas: {dogToEdit.vaccines.map((vaccine) => `${vaccine.name} (${formatShortDate(vaccine.expiresOn)})`).join(" · ")}</small></div> : null}
            <label className="field full">
              <span>Foto do cão</span>
              <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" />
              <small>JPG, PNG ou WebP de até 5 MB.</small>
            </label>
            <label className="check-field full">
              <input
                name="vaccinesCurrent"
                type="checkbox"
                defaultChecked={dogToEdit.vaccinesCurrent}
              />
              <span>Vacinas conferidas e em dia</span>
            </label>
            <div className="dialog-actions full">
              {signedInRole === "owner" && (
                <>
                  <button className="text-button danger" type="button" onClick={() => void archiveDogProfile()}>
                    Inativar
                  </button>
                  <button className="text-button danger" type="button" onClick={() => void deleteDogProfile()}>
                    Excluir
                  </button>
                </>
              )}
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setDialog(null);
                  setDogToEdit(null);
                }}
              >
                Cancelar
              </button>
              <button className="primary-button" type="submit">
                Salvar alterações
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {dialog === "editCustomer" && customerToEdit && (
        <Dialog
          title="Editar cliente"
          description="Atualize os dados usados para contato e envio de cobranças."
          onClose={() => {
            setDialog(null);
            setCustomerToEdit(null);
          }}
          size="small"
        >
          <form className="form-grid" onSubmit={submitCustomerEdit}>
            <label className="field full">
              <span>Nome completo *</span>
              <input
                name="name"
                defaultValue={customerToEdit.name}
                autoFocus
                required
              />
            </label>
            <label className="field full">
              <span>WhatsApp</span>
              <input
                name="phone"
                type="tel"
                defaultValue={
                  customerToEdit.phone === "Não informado"
                    ? ""
                    : customerToEdit.phone
                }
              />
            </label>
            <label className="field full">
              <span>E-mail</span>
              <input
                name="email"
                type="email"
                defaultValue={
                  customerToEdit.email === "Não informado"
                    ? ""
                    : customerToEdit.email
                }
              />
            </label>
            <label className="field full">
              <span>Endereço</span>
              <input name="address" defaultValue={customerToEdit.address} placeholder="Rua, número, bairro e cidade" />
            </label>
            <label className="field">
              <span>CPF</span>
              <input name="cpf" defaultValue={customerToEdit.cpf} inputMode="numeric" />
            </label>
            <label className="field">
              <span>Data de nascimento</span>
              <BrazilianDateInput
                name="birthDate"
                defaultValue={customerToEdit.birthDate}
                ariaLabel="Data de nascimento do cliente"
              />
            </label>
            <div className="dialog-actions full">
              {signedInRole === "owner" && (
                <>
                  <button className="text-button danger" type="button" onClick={() => void archiveCustomerProfile()}>
                    Inativar
                  </button>
                  <button className="text-button danger" type="button" onClick={() => void deleteCustomerProfile()}>
                    Excluir
                  </button>
                </>
              )}
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setDialog(null);
                  setCustomerToEdit(null);
                }}
              >
                Cancelar
              </button>
              <button className="primary-button" type="submit">
                Salvar alterações
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {dialog === "task" && (
        <Dialog
          title="Nova tarefa"
          description="Registre um lembrete para a equipe."
          onClose={() => setDialog(null)}
          size="small"
        >
          <form className="form-grid" onSubmit={submitTask}>
            <label className="field full">
              <span>Título *</span>
              <input
                name="title"
                autoFocus
                required
                placeholder="Ex.: Separar medicação da Mel"
              />
            </label>
            <label className="field">
              <span>Data</span>
              <BrazilianDateInput
                name="date"
                defaultValue={selectedDate}
                ariaLabel="Data da tarefa"
              />
            </label>
            <label className="field">
              <span>Horário</span>
              <input name="time" type="time" />
            </label>
            <label className="field full">
              <span>Prioridade</span>
              <select name="priority" defaultValue="normal">
                <option value="normal">Normal</option>
                <option value="high">Alta</option>
              </select>
            </label>
            <div className="dialog-actions full">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setDialog(null)}
              >
                Cancelar
              </button>
              <button className="primary-button" type="submit">
                Adicionar tarefa
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {dialog === "registration" && (
        <Dialog
          title={
            registrationType === "choice"
              ? "Novo cadastro"
              : registrationType === "customer"
                ? "Novo cliente"
                : "Novo cão"
          }
          description={
            registrationType === "choice"
              ? "Escolha o que deseja cadastrar."
              : "Comece com as informações essenciais. O restante pode ser preenchido depois."
          }
          onClose={() => {
            setDialog(null);
            setRegistrationType("choice");
          }}
          size="small"
        >
          {registrationType === "choice" && (
            <div className="registration-choices">
              <button onClick={() => setRegistrationType("customer")} autoFocus>
                <span className="choice-mark">CL</span>
                <span>
                  <strong>Novo cliente</strong>
                  <small>Contato, WhatsApp e e-mail</small>
                </span>
                <span aria-hidden="true">›</span>
              </button>
              <button onClick={() => setRegistrationType("dog")}>
                <span className="choice-mark">CÃ</span>
                <span>
                  <strong>Novo cão</strong>
                  <small>Tutor, raça e alertas essenciais</small>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            </div>
          )}
          {registrationType === "customer" && (
            <form className="form-grid" onSubmit={submitCustomer}>
              <label className="field full">
                <span>Nome completo *</span>
                <input name="name" autoFocus required />
              </label>
              <label className="field full">
                <span>WhatsApp</span>
                <input name="phone" type="tel" placeholder="(11) 90000-0000" />
              </label>
              <label className="field full">
                <span>E-mail</span>
                <input
                  name="email"
                  type="email"
                  placeholder="cliente@example.com"
                />
              </label>
              <label className="field full"><span>Endereço</span><input name="address" placeholder="Rua, número, bairro e cidade" /></label>
              <label className="field"><span>CPF</span><input name="cpf" inputMode="numeric" /></label>
              <label className="field">
                <span>Data de nascimento</span>
                <BrazilianDateInput
                  name="birthDate"
                  ariaLabel="Data de nascimento do cliente"
                />
              </label>
              <div className="dialog-actions full">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setRegistrationType("choice")}
                >
                  Voltar
                </button>
                <button className="primary-button" type="submit">
                  Salvar cliente
                </button>
              </div>
            </form>
          )}
          {registrationType === "dog" && (
            <form className="form-grid" onSubmit={submitDog}>
              <label className="field full">
                <span>Nome do cão *</span>
                <input name="name" autoFocus required />
              </label>
              <label className="field full">
                <span>Cliente vinculado *</span>
                <select name="customerId" defaultValue="" required>
                  <option value="" disabled>
                    Selecione um cliente
                  </option>
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field full">
                <span>Raça</span>
                <input name="breed" />
              </label>
              <label className="field">
                <span>Data de nascimento</span>
                <BrazilianDateInput
                  name="birthDate"
                  ariaLabel="Data de nascimento do cão"
                />
              </label>
              <label className="field">
                <span>Sexo</span>
                <select name="sex" defaultValue="unknown">
                  <option value="unknown">Não informado</option>
                  <option value="female">Fêmea</option>
                  <option value="male">Macho</option>
                </select>
              </label>
              <label className="field full">
                <span>É castrado?</span>
                <select name="neutered" defaultValue="">
                  <option value="">Não informado</option>
                  <option value="yes">Sim</option>
                  <option value="no">Não</option>
                </select>
              </label>
              <label className="field full">
                <span>Alerta essencial</span>
                <textarea
                  name="alert"
                  rows={2}
                  placeholder="Alergia, medicação ou comportamento"
                />
              </label>
              <div className="dialog-actions full">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setRegistrationType("choice")}
                >
                  Voltar
                </button>
                <button className="primary-button" type="submit">
                  Salvar cão
                </button>
              </div>
            </form>
          )}
        </Dialog>
      )}

      {dialog === "cancel" && bookingToCancel && (
        <Dialog
          title="Cancelar este atendimento?"
          description="O registro será mantido no histórico."
          onClose={() => {
            setDialog(null);
            setBookingToCancel(null);
          }}
          size="small"
        >
          <form className="form-grid" onSubmit={submitCancellation}>
            <div className="cancel-summary full">
              <DogAvatar
                dog={dogs.find((dog) => dog.id === bookingToCancel.dogId)}
                size="small"
              />
              <span>
                <strong>{bookingToCancel.dogName}</strong>
                <small>
                  {formatShortDate(bookingToCancel.date)} ·{" "}
                  {bookingToCancel.time} · {bookingToCancel.service}
                </small>
              </span>
            </div>
            <label className="field full">
              <span>Motivo do cancelamento *</span>
              <textarea name="reason" rows={3} autoFocus required />
            </label>
            {bookingToCancel.recurringScheduleId && (
              <fieldset className="field full">
                <legend>O que deseja cancelar?</legend>
                <label className="radio-option">
                  <input
                    name="recurrenceScope"
                    type="radio"
                    value="occurrence"
                    defaultChecked
                  />
                  <span>
                    <strong>Somente este dia</strong>
                    <small>As outras semanas continuam agendadas.</small>
                  </span>
                </label>
                <label className="radio-option">
                  <input
                    name="recurrenceScope"
                    type="radio"
                    value="future"
                  />
                  <span>
                    <strong>Deste dia em diante</strong>
                    <small>
                      Mantém as ocorrências anteriores e cancela esta e as
                      próximas semanas.
                    </small>
                  </span>
                </label>
                <label className="radio-option">
                  <input
                    name="recurrenceScope"
                    type="radio"
                    value="series"
                  />
                  <span>
                    <strong>Toda a recorrência</strong>
                    <small>
                      Cancela todos os agendamentos ainda abertos desta série.
                      Atendimentos já concluídos permanecem no histórico.
                    </small>
                  </span>
                </label>
              </fieldset>
            )}
            <div className="dialog-actions full">
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setDialog(null);
                  setBookingToCancel(null);
                }}
              >
                Voltar
              </button>
              <button className="danger-button" type="submit">
                Cancelar atendimento
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {dialog === "creditPackage" && (
        <CreditPackageDialog
          key={creditCustomerId}
          customers={customers}
          initialCustomerId={creditCustomerId}
          creditPricing={creditPricing}
          onClose={() => setDialog(null)}
          onSubmit={submitCreditPackage}
        />
      )}

      {dialog === "creditAdjustment" && creditAdjustmentCustomerId && (
        <CreditAdjustmentDialog
          customer={customers.find(
            (customer) => customer.id === creditAdjustmentCustomerId,
          )}
          balances={creditBalances[creditAdjustmentCustomerId] ?? {
            daycare: 0,
            bath: 0,
            grooming: 0,
            transport: 0,
          }}
          busy={busyAction?.startsWith("adjust-credit:") ?? false}
          onClose={() => setDialog(null)}
          onSubmit={submitCreditAdjustment}
        />
      )}

      {dialog === "receipt" && selectedReceipt && (
        <ReceiptDialog
          receipt={selectedReceipt}
          onClose={() => {
            setDialog(null);
            setSelectedReceipt(null);
          }}
          onSend={sendReceipt}
        />
      )}

      {dialog === "statement" && (
        <StatementDialog
          customers={customers}
          initialCustomerId={statementCustomerId}
          onClose={() => setDialog(null)}
          onFeedback={(message) => setToast({ message })}
        />
      )}

      {regularBillingService && (
        <RegularBillingDialog
          service={regularBillingService}
          creditPricing={creditPricing}
          lodgingPricing={lodgingPricing}
          suggestedLodgingProfile={suggestedLodgingRateProfile(
            regularBillingService,
            bookings,
            creditBalances,
          )}
          busy={busyAction === `regular-billing:${regularBillingService.appointmentItemId}`}
          onClose={() => setRegularBillingService(null)}
          onSubmit={(amountCents, pricingProfile) =>
            saveRegularBilling(regularBillingService, amountCents, pricingProfile)
          }
        />
      )}

      {dialog === "invoice" && invoiceState && (
        <InvoiceDialog
          state={invoiceState}
          financialAccounts={financialAccounts}
          onClose={() => {
            setDialog(null);
            setInvoiceState(null);
          }}
          onIssue={issueInvoice}
          onRegisterPayment={registerInvoicePayment}
          onReversePayment={reverseInvoicePayment}
          onManageSettlement={manageInvoiceSettlement}
          onVoid={voidInvoice}
          onDeliveryConfirmed={markInvoiceDelivered}
          onFeedback={(message) => setToast({ message })}
          longStayDiscountPercent={lodgingPricing.longStayDiscountPercent}
          liveMode={runtimeMode === "ready"}
          canReversePayment={signedInRole === "owner"}
          busy={
            busyAction === "issue-invoice" ||
            busyAction === "register-invoice-payment" ||
            busyAction === "reverse-invoice-payment" ||
            busyAction === "void-invoice"
          }
        />
      )}

      {invoiceCorrection && (
        <Dialog
          title="Desfazer a união?"
          description={`A fatura #${invoiceCorrection.invoice.number} será cancelada e as faturas originais serão restauradas.`}
          onClose={() => setInvoiceCorrection(null)}
          size="small"
        >
          <div className="billing-review">
            <p className="modal-confirmation-copy">
              Nenhum pagamento será apagado. Esta operação só é permitida
              enquanto a fatura unificada ainda estiver em aberto e sem
              compensação.
            </p>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setInvoiceCorrection(null)}
              >
                Manter união
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={() =>
                  void reverseInvoiceMerge(invoiceCorrection.invoice, true)
                }
              >
                Restaurar faturas originais
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {cashExclusionInvoice && (
        <Dialog
          title="Desconsiderar recebimento do Caixa?"
          description={`A fatura #${cashExclusionInvoice.number} continuará paga; somente o cálculo do Caixa será ajustado.`}
          onClose={() => setCashExclusionInvoice(null)}
          size="small"
        >
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              const reason = String(
                new FormData(event.currentTarget).get("reason") ?? "",
              ).trim();
              if (!reason) return;
              void toggleInvoiceCash(cashExclusionInvoice, reason);
            }}
          >
            <label className="field full">
              <span>Motivo *</span>
              <textarea
                name="reason"
                rows={3}
                maxLength={500}
                placeholder="Ex.: valor pessoal, não pertence ao movimento do negócio"
                autoFocus
                required
              />
            </label>
            <div className="dialog-actions full">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setCashExclusionInvoice(null)}
              >
                Voltar
              </button>
              <button className="danger-button" type="submit">
                Desconsiderar do Caixa
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast.message}</span>
          {toast.action && toast.actionLabel && (
            <button
              onClick={() => {
                toast.action?.();
              }}
            >
              {toast.actionLabel}
            </button>
          )}
          <button
            className="toast-close"
            onClick={() => setToast(null)}
            aria-label="Fechar aviso"
          >
            Fechar
          </button>
        </div>
      )}
    </div>
  );
}

function StartupScreen({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <main className="startup-screen">
      <section className="startup-card" aria-live="polite">
        <span className="brand-mark startup-mark" aria-hidden="true">
          HQ
        </span>
        <p className="eyebrow">Hospet Quintal · HQ</p>
        <h1>{title}</h1>
        <p>{description}</p>
        {actionLabel && onAction ? (
          <button className="primary-button" onClick={onAction}>
            {actionLabel}
          </button>
        ) : (
          <span className="loading-dots" aria-label="Carregando">
            <i />
            <i />
            <i />
          </span>
        )}
      </section>
    </main>
  );
}

function LoginScreen({
  onSubmit,
  busy,
  error,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  error: string;
}) {
  return (
    <main className="startup-screen">
      <section className="startup-card auth-card">
        <span className="brand-mark startup-mark" aria-hidden="true">
          HQ
        </span>
        <p className="eyebrow">Acesso protegido</p>
        <h1>Entre para cuidar da operação.</h1>
        <p>
          Use o e-mail e a senha da sua conta. Cada pessoa acessa somente as
          áreas apropriadas ao seu trabalho.
        </p>
        <form onSubmit={onSubmit}>
          <label className="field">
            <span>E-mail</span>
            <input
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              maxLength={254}
              autoFocus
              required
            />
          </label>
          <label className="field">
            <span>Senha</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={256}
              required
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
          <a className="auth-secondary-link" href="/recuperar">
            Esqueci minha senha
          </a>
        </form>
        <small className="security-caption">
          A sessão termina automaticamente por segurança. O sistema não oferece
          acesso público aos cadastros.
        </small>
      </section>
    </main>
  );
}

function InitialSetupScreen({
  onSubmit,
  busy,
  error,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  error: string;
}) {
  return (
    <main className="startup-screen setup-screen">
      <section className="startup-card setup-card">
        <span className="brand-mark startup-mark" aria-hidden="true">
          HQ
        </span>
        <p className="eyebrow">Configuração única</p>
        <h1>Cadastre os dois administradores.</h1>
        <p>
          Esta tela desaparece assim que a configuração é concluída. Depois,
          os administradores poderão convidar funcionários e clientes com
          acessos individuais.
        </p>
        <form onSubmit={onSubmit}>
          <div className="setup-foundation">
            <label className="field">
              <span>Chave secreta de ativação</span>
              <input
                name="setupKey"
                type="password"
                autoComplete="off"
                spellCheck={false}
                maxLength={512}
                required
              />
              <small>
                Use a chave recebida na entrega. Ela não fica no GitHub.
              </small>
            </label>
            <label className="field">
              <span>Nome do estabelecimento</span>
              <input
                name="establishmentName"
                defaultValue="Hospet Quintal"
                maxLength={120}
                required
              />
            </label>
          </div>

          <div className="administrator-grid">
            {[1, 2].map((number) => (
              <fieldset key={number}>
                <legend>Administrador {number}</legend>
                <label className="field">
                  <span>Nome</span>
                  <input
                    name={`admin${number}Name`}
                    autoComplete={`section-admin-${number} name`}
                    maxLength={120}
                    required
                  />
                </label>
                <label className="field">
                  <span>E-mail</span>
                  <input
                    name={`admin${number}Email`}
                    type="email"
                    autoComplete={`section-admin-${number} email`}
                    inputMode="email"
                    autoCapitalize="none"
                    maxLength={254}
                    required
                  />
                </label>
                <label className="field">
                  <span>Senha</span>
                  <input
                    name={`admin${number}Password`}
                    type="password"
                    autoComplete={`section-admin-${number} new-password`}
                    minLength={12}
                    maxLength={256}
                    required
                  />
                </label>
                <label className="field">
                  <span>Confirmar senha</span>
                  <input
                    name={`admin${number}PasswordConfirmation`}
                    type="password"
                    autoComplete={`section-admin-${number} new-password`}
                    minLength={12}
                    maxLength={256}
                    required
                  />
                </label>
              </fieldset>
            ))}
          </div>

          <div className="setup-safety-note">
            <span className="attention-mark">i</span>
            <p>
              Use senhas diferentes, com pelo menos 12 caracteres, e guarde-as
              em um gerenciador de senhas. Depois, os administradores poderão
              convidar funcionários e clientes pela área Acessos.
            </p>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Protegendo o ambiente…" : "Criar as duas contas"}
          </button>
        </form>
      </section>
    </main>
  );
}

function OnboardingScreen({
  displayName,
  canInitialize,
  establishmentName,
  setEstablishmentName,
  onSubmit,
  busy,
  error,
}: {
  displayName: string;
  canInitialize: boolean;
  establishmentName: string;
  setEstablishmentName: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  error: string;
}) {
  return (
    <main className="startup-screen">
      <section className="startup-card onboarding-card">
        <span className="brand-mark startup-mark" aria-hidden="true">
          HQ
        </span>
        <p className="eyebrow">Primeiro acesso</p>
        <h1>Vamos preparar seu ambiente privado.</h1>
        <p>
          Olá, {displayName}. Esta etapa cria a unidade e os serviços iniciais
          na Cloudflare. Dados reais de clientes não são gravados no GitHub.
        </p>
        {canInitialize ? (
          <form onSubmit={onSubmit}>
            <label className="field">
              <span>Nome do estabelecimento</span>
              <input
                value={establishmentName}
                onChange={(event) => setEstablishmentName(event.target.value)}
                maxLength={120}
                autoFocus
                required
              />
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? "Preparando…" : "Começar a usar"}
            </button>
          </form>
        ) : (
          <p className="form-error" role="alert">
            O proprietário precisa concluir esta configuração antes da equipe
            entrar.
          </p>
        )}
      </section>
    </main>
  );
}

function TodayView({
  bookings,
  dogs,
  customers,
  tasks,
  receipts,
  selectedDate,
  onDateChange,
  agendaFilter,
  setAgendaFilter,
  agendaServiceFilter,
  setAgendaServiceFilter,
  onAdvance,
  onMenu,
  openMenuId,
  onEdit,
  onCancel,
  onToggleTask,
  onClearCompletedTasks,
  onViewBilling,
  onOpenInvoice,
  onLodgingInvoice,
  onOpenReceipt,
  onSaveDogFeeding,
  onQuickService,
  invoice,
  billingReminders,
}: {
  bookings: Booking[];
  dogs: Dog[];
  customers: Customer[];
  tasks: Task[];
  receipts: ServiceReceipt[];
  selectedDate: string;
  onDateChange: (value: string) => void;
  agendaFilter: "all" | "upcoming" | "completed";
  setAgendaFilter: (
    value: "all" | "upcoming" | "completed",
  ) => void;
  agendaServiceFilter: AgendaServiceFilter;
  setAgendaServiceFilter: (value: AgendaServiceFilter) => void;
  onAdvance: (booking: Booking) => void;
  onMenu: (id: string | null) => void;
  openMenuId: string | null;
  onEdit: (booking: Booking) => void;
  onCancel: (booking: Booking) => void;
  onToggleTask: (id: string) => void;
  onClearCompletedTasks: () => void;
  onViewBilling: () => void;
  onOpenInvoice: (invoice: Invoice) => void;
  onLodgingInvoice: (
    booking: Booking,
    kind: "deposit" | "balance",
  ) => void;
  onOpenReceipt: (receipt: ServiceReceipt) => void;
  onSaveDogFeeding: (dogId: string, feedingNotes: string) => Promise<boolean>;
  onQuickService?: () => void;
  invoice?: Invoice;
  billingReminders: Invoice[];
}) {
  const [feedingEditorDogId, setFeedingEditorDogId] = useState<string | null>(null);
  const [feedingDraft, setFeedingDraft] = useState("");
  const [feedingSaving, setFeedingSaving] = useState(false);
  const dayBookings = bookings.filter((booking) =>
    bookingOccursOn(booking, selectedDate),
  );
  const visibleBookings = dayBookings.filter(
    (booking) => booking.status !== "cancelled",
  );
  const filteredBookings = filterBookingsByService(
    filterBookings(dayBookings, agendaFilter).filter(
      (booking) => booking.status !== "cancelled",
    ),
    agendaServiceFilter,
  ).sort(agendaBookingOrder);
  const isToday = selectedDate === operationalToday;
  const dogsForDay = new Set(
    visibleBookings.map((booking) => booking.dogId),
  ).size;
  const alertDogsForDay = new Set(
    visibleBookings
      .filter((booking) => dogs.find((dog) => dog.id === booking.dogId)?.alert)
      .map((booking) => booking.dogId),
  ).size;
  const birthdays = customers.filter((customer) => customer.birthDate?.slice(5) === selectedDate.slice(5));
  const dogBirthdays = dogs.filter((dog) => dog.birthDate?.slice(5) === selectedDate.slice(5));
  const vaccineAlerts = dogs.flatMap((dog) =>
    (dog.vaccines ?? [])
      .filter((vaccine) => vaccine.expiresOn <= shiftDate(selectedDate, 30))
      .map((vaccine) => ({ dog, vaccine })),
  );
  const overlookedBookings = bookings
    .filter(
      (booking) =>
        ["scheduled", "confirmed"].includes(booking.status) &&
        (booking.endDate ?? booking.date) < operationalToday,
    )
    .sort((left, right) =>
      (left.endDate ?? left.date).localeCompare(right.endDate ?? right.date) || agendaBookingOrder(left, right),
    );

  return (
    <>
      <section className="day-heading">
        <div>
          <p>{isToday ? formatToday() : formatSelectedDate(selectedDate)}</p>
          <span>São Paulo · horário local</span>
        </div>
        {onQuickService && (
          <button className="secondary-button" onClick={onQuickService}>
            Agendamento rápido
          </button>
        )}
      </section>

      <DateNavigator value={selectedDate} onChange={onDateChange} />

      {isToday && (birthdays.length || dogBirthdays.length || vaccineAlerts.length) ? (
        <section className="panel attention-panel">
          <p className="section-kicker">Alertas de hoje</p>
          <h2>Datas e vacinas importantes</h2>
          <div className="alert-list">
            {birthdays.map((customer) => <p key={`customer-${customer.id}`}>🎂 Aniversário de {customer.name}</p>)}
            {dogBirthdays.map((dog) => <p key={`dog-${dog.id}`}>🎈 Aniversário de {dog.name}</p>)}
            {vaccineAlerts.map(({ dog, vaccine }) => (
              <p key={`${dog.id}-${vaccine.name}-${vaccine.expiresOn}`}>
                💉 {vaccine.name} de {dog.name}{" "}
                {vaccine.expiresOn < selectedDate ? "venceu" : "vence"} em{" "}
                {formatShortDate(vaccine.expiresOn)}
              </p>
            ))}
          </div>
        </section>
      ) : null}

      <section
        className="summary-strip"
        aria-label={`Resumo de ${formatSelectedDate(selectedDate)}`}
      >
        <SummaryItem value={dogsForDay} label="cães" />
        <SummaryItem
          value={
            visibleBookings.filter((booking) => booking.serviceType === "hotel")
              .length
          }
          label="hospedagens"
        />
        <SummaryItem
          value={
            visibleBookings.filter(
              (booking) => booking.serviceType === "daycare",
            ).length
          }
          label="creches"
        />
        <SummaryItem
          value={
            visibleBookings.filter(
              (booking) =>
                booking.serviceType === "bath" ||
                booking.serviceType === "grooming",
            ).length
          }
          label="banhos"
        />
        <SummaryItem
          value={
            visibleBookings.filter(
              (booking) => booking.serviceType === "transport",
            ).length
          }
          label="Taxi-dogs"
        />
      </section>

      <div className="dashboard-grid">
        <section className="panel agenda-panel">
          <div className="panel-heading agenda-heading">
            <div>
              <p className="section-kicker">
                {formatSelectedDate(selectedDate)}
              </p>
              <h2>{isToday ? "Agenda de hoje" : "Agenda do dia"}</h2>
            </div>
            <div className="agenda-filter-groups">
              <AgendaFilters value={agendaFilter} onChange={setAgendaFilter} />
              <AgendaServiceFilters
                value={agendaServiceFilter}
                onChange={setAgendaServiceFilter}
              />
            </div>
          </div>
          <div className="agenda-list">
            {filteredBookings.map((booking) => (
                <AgendaCard
                  key={booking.id}
                  booking={booking}
                  dog={dogs.find((dog) => dog.id === booking.dogId)}
                  onAdvance={onAdvance}
                  openMenu={openMenuId === booking.id}
                  onMenu={() =>
                    onMenu(openMenuId === booking.id ? null : booking.id)
                  }
                  onEdit={onEdit}
                  onCancel={onCancel}
                  receipt={receipts.find(
                    (receipt) => receipt.number === booking.receiptNumber,
                  )}
                  onOpenReceipt={onOpenReceipt}
                  onLodgingInvoice={onLodgingInvoice}
                  agendaDate={selectedDate}
                  feedingEditorOpen={feedingEditorDogId === booking.dogId}
                  feedingDraft={feedingDraft}
                  feedingSaving={feedingSaving}
                  onStartFeedingEdit={() => {
                    setFeedingEditorDogId(booking.dogId);
                    setFeedingDraft("");
                  }}
                  onFeedingDraftChange={setFeedingDraft}
                  onCancelFeedingEdit={() => {
                    setFeedingEditorDogId(null);
                    setFeedingDraft("");
                  }}
                  onSaveFeeding={async () => {
                    if (!feedingDraft.trim()) return;
                    setFeedingSaving(true);
                    const saved = await onSaveDogFeeding(
                      booking.dogId,
                      feedingDraft,
                    );
                    setFeedingSaving(false);
                    if (saved) {
                      setFeedingEditorDogId(null);
                      setFeedingDraft("");
                    }
                  }}
                />
              ))}
            {!filteredBookings.length && (
              <EmptyState
                title="Nada por aqui"
                description="Ainda não há serviços com este filtro."
              />
            )}
          </div>
        </section>

        <aside className="dashboard-rail">
          <section className="panel compact-panel tasks-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Equipe</p>
                <h2>Tarefas</h2>
              </div>
              <span className="soft-count">
                {tasks.filter((task) => !task.completed).length}
              </span>
            </div>
            {tasks.some((task) => task.completed) && (
              <button className="text-button muted" onClick={onClearCompletedTasks}>
                Limpar concluídas
              </button>
            )}
            <div className="task-list">
              {tasks.map((task) => (
                <label
                  className={task.completed ? "task-row completed" : "task-row"}
                  key={task.id}
                >
                  <input
                    type="checkbox"
                    checked={task.completed}
                    onChange={() => onToggleTask(task.id)}
                  />
                  <span>
                    <strong>{task.title}</strong>
                    <small>
                      {task.due}
                      {task.priority === "high" ? " · Prioridade alta" : ""}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </section>

          {isToday && overlookedBookings.length > 0 && (
            <section className="panel compact-panel overdue-reminder-panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">Revisão rápida</p>
                  <h2>Possivelmente esquecidos</h2>
                </div>
                <span className="attention-count">{overlookedBookings.length}</span>
              </div>
              <p className="compact-help">O dia do atendimento já passou, mas ele continua aberto.</p>
              <div className="overdue-reminder-list">
                {overlookedBookings.slice(0, 6).map((booking) => (
                  <div key={booking.id}>
                    <span>
                      <strong>{booking.dogName} · {booking.service}</strong>
                      <small>{formatShortDate(booking.endDate ?? booking.date)} · {booking.status === "scheduled" ? "não confirmado" : "não concluído"}</small>
                    </span>
                    <button className="text-button" onClick={() => onAdvance(booking)}>
                      {booking.status === "scheduled" ? "Confirmar" : "Concluir"}
                    </button>
                  </div>
                ))}
              </div>
              {overlookedBookings.length > 6 && (
                <small className="compact-help">Mais {overlookedBookings.length - 6} atendimentos aguardam revisão.</small>
              )}
            </section>
          )}

          {isToday && billingReminders.length > 0 && (
            <section className="panel compact-panel billing-reminder-panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">Cobrar hoje</p>
                  <h2>Lembretes de cobrança</h2>
                </div>
                <span className="attention-count">{billingReminders.length}</span>
              </div>
              <div className="overdue-reminder-list">
                {billingReminders.slice(0, 6).map((reminder) => (
                  <div key={reminder.id}>
                    <span>
                      <strong>{reminder.customerName}</strong>
                      <small>{reminder.internalNote || reminder.items}</small>
                    </span>
                    <button className="text-button" onClick={() => onOpenInvoice(reminder)}>
                      Abrir
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {invoice && (
            <section className="panel compact-panel billing-snapshot">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">Financeiro</p>
                  <h2>Faturas pendentes</h2>
                </div>
                <span className="status-pill pending">Pendente</span>
              </div>
              <strong className="snapshot-value">
                {formatCurrency(invoice.amountCents)}
              </strong>
              <p>{invoice.customerName} · vence hoje</p>
              <div className="inline-actions">
                <button className="text-button" onClick={() => onOpenInvoice(invoice)}>
                  Ver cobrança
                </button>
                <button className="text-button muted" onClick={onViewBilling}>
                  Abrir financeiro
                </button>
              </div>
            </section>
          )}

          {alertDogsForDay > 0 && (
            <section className="panel compact-panel attention-panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">Cuidados</p>
                  <h2>Requer atenção</h2>
                </div>
                <span className="attention-count">{alertDogsForDay}</span>
              </div>
              {visibleBookings
                .map((booking) => ({
                  booking,
                  dog: dogs.find((dog) => dog.id === booking.dogId),
                }))
                .filter(({ dog }, index, items) =>
                  Boolean(
                    dog?.alert &&
                      items.findIndex(
                        (item) => item.booking.dogId === dog.id,
                      ) === index,
                  ),
                )
                .map(({ dog }) => (
                  <div className="attention-item" key={dog?.id}>
                    <span className="attention-mark" aria-hidden="true">!</span>
                    <span>
                      <strong>{dog?.name} · alerta</strong>
                      <small>{dog?.alert}</small>
                    </span>
                  </div>
                ))}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

function DateNavigator({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const dates = Array.from({ length: 7 }, (_, index) =>
    shiftDate(operationalToday, index),
  );

  return (
    <section className="date-navigator" aria-label="Consultar agenda por dia">
      <div className="date-nav-heading">
        <span>
          <strong>Consultar outro dia</strong>
          <small>Veja hoje ou antecipe os próximos dias.</small>
        </span>
        <div className="date-nav-controls">
          <button
            className="date-arrow"
            onClick={() => onChange(shiftDate(value, -1))}
            aria-label="Dia anterior"
          >
            ‹
          </button>
          <label>
            <span className="sr-only">Escolher uma data</span>
            <BrazilianDateInput
              value={value}
              onChange={onChange}
              ariaLabel="Escolher uma data"
            />
          </label>
          <button
            className="date-arrow"
            onClick={() => onChange(shiftDate(value, 1))}
            aria-label="Próximo dia"
          >
            ›
          </button>
        </div>
      </div>
      <div className="date-quick-list">
        {dates.map((date, index) => {
          const weekday = new Intl.DateTimeFormat("pt-BR", {
            weekday: "short",
            timeZone: "America/Sao_Paulo",
          })
            .format(dateFromIso(date))
            .replace(".", "");
          return (
            <button
              key={date}
              className={value === date ? "active" : ""}
              onClick={() => onChange(date)}
              aria-pressed={value === date}
            >
              <span>{index === 0 ? "Hoje" : index === 1 ? "Amanhã" : weekday}</span>
              <strong>{formatNearbyDate(date)}</strong>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ServiceTimeInput({
  name,
  label,
  defaultValue = "",
  required = false,
}: {
  name: "time" | "endTime";
  label: string;
  defaultValue?: string;
  required?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <label className="field time-choice-field">
      <span>{label}</span>
      <div className="time-choice-control">
        <input type="hidden" name={name} value={value} />
        <input
          type="time"
          value={isClockTime(value) ? value : ""}
          aria-label={`${label}: horário exato`}
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="day-period-options" aria-label={`${label}: período do dia`}>
          {(Object.entries(dayPeriodLabels) as [DayPeriod, string][]).map(
            ([period, periodLabel]) => (
              <button
                type="button"
                key={period}
                className={value === period ? "active" : ""}
                onClick={() => setValue(period)}
                aria-pressed={value === period}
              >
                {periodLabel}
              </button>
            ),
          )}
        </div>
      </div>
      <small>
        {required
          ? "Escolha um horário exato ou um período do dia."
          : "Opcional: informe um horário exato ou apenas o período."}
      </small>
    </label>
  );
}

function AgendaFilters({
  value,
  onChange,
}: {
  value: "all" | "upcoming" | "completed";
  onChange: (value: "all" | "upcoming" | "completed") => void;
}) {
  const filters = [
    ["all", "Todos"],
    ["upcoming", "Em aberto"],
    ["completed", "Concluídos"],
  ] as const;
  return (
    <div className="filter-chips" aria-label="Filtrar agenda">
      {filters.map(([id, label]) => (
        <button
          key={id}
          className={value === id ? "active" : ""}
          onClick={() => onChange(id)}
          aria-pressed={value === id}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function AgendaServiceFilters({
  value,
  onChange,
}: {
  value: AgendaServiceFilter;
  onChange: (value: AgendaServiceFilter) => void;
}) {
  const filters = [
    ["all", "Todos os serviços"],
    ["hotel", "Hospedagens"],
    ["daycare", "Creches"],
    ["bath", "Banhos e tosa"],
    ["transport", "Taxi-dogs"],
  ] as const;
  return (
    <div className="filter-chips service-filter-chips" aria-label="Filtrar por serviço">
      {filters.map(([id, label]) => (
        <button
          key={id}
          className={value === id ? "active" : ""}
          onClick={() => onChange(id)}
          aria-pressed={value === id}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function filterBookings(
  bookings: Booking[],
  filter: "all" | "upcoming" | "completed",
) {
  if (filter === "upcoming") {
    return bookings.filter((booking) =>
      ["scheduled", "confirmed"].includes(booking.status),
    );
  }
  if (filter === "completed") {
    return bookings.filter((booking) => booking.status === "completed");
  }
  return bookings;
}

function filterBookingsByService(
  bookings: Booking[],
  filter: AgendaServiceFilter,
) {
  if (filter === "hotel" || filter === "daycare" || filter === "transport") {
    return bookings.filter((booking) => booking.serviceType === filter);
  }
  if (filter === "bath") {
    return bookings.filter(
      (booking) =>
        booking.serviceType === "bath" || booking.serviceType === "grooming",
    );
  }
  return bookings;
}

function bookingOccursOn(booking: Booking, date: string) {
  if (booking.serviceType === "hotel" && booking.endDate) {
    return booking.date <= date && booking.endDate >= date;
  }
  return booking.date === date;
}

function agendaAlertsForDog(dog: Dog | undefined, date: string) {
  if (!dog) return [];
  const alerts: string[] = [];
  if (dog.alert?.trim()) alerts.push(dog.alert.trim());
  if (dog.birthDate?.slice(5) === date.slice(5)) {
    alerts.push(`Aniversário de ${dog.name}`);
  }
  for (const vaccine of dog.vaccines ?? []) {
    if (vaccine.expiresOn > shiftDate(date, 30)) continue;
    alerts.push(
      `${vaccine.name} ${
        vaccine.expiresOn < date ? "vencida" : "vence"
      } em ${formatShortDate(vaccine.expiresOn)}`,
    );
  }
  return alerts;
}

function QuickServiceDialog({
  customers,
  dogs,
  services,
  lodgingPricing,
  defaultDate,
  busy,
  onClose,
  onSubmit,
}: {
  customers: Customer[];
  dogs: Dog[];
  services: WorkspaceService[];
  lodgingPricing: LodgingPricing;
  defaultDate: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    dogIds: string[];
    serviceCatalogIds: string[];
    date: string;
    endDate?: string;
    startTime?: string;
    endTime?: string;
    transportDirection: "one_way" | "round_trip";
    lodgingNights?: number;
    depositPercent?: number | null;
    lodgingDaycareCustomer?: boolean;
    internalNotes?: string;
  }) => Promise<boolean>;
}) {
  const [customerId, setCustomerId] = useState("");
  const [dogIds, setDogIds] = useState<string[]>([]);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [direction, setDirection] = useState<"one_way" | "round_trip">("one_way");
  const [date, setDate] = useState(defaultDate);
  const [endDate, setEndDate] = useState(shiftDate(defaultDate, 1));
  const [lodgingNights, setLodgingNights] = useState(1);
  const [hasDeposit, setHasDeposit] = useState(false);
  const [depositPercent, setDepositPercent] = useState(50);
  const [lodgingDaycareCustomer, setLodgingDaycareCustomer] = useState(false);
  const selectedCustomer = customers.find((customer) => customer.id === customerId);
  const availableDogs = dogs.filter((dog) => selectedCustomer?.dogIds.includes(dog.id));
  const lodgingService = services.find((service) => service.code === "hotel");
  const includesLodging = Boolean(
    lodgingService && serviceIds.includes(lodgingService.id),
  );
  const includesTaxiDog = services.some(
    (service) => serviceIds.includes(service.id) && service.code === "taxi_dog",
  );
  const total = dogIds.length * serviceIds.length;
  const primaryLodgingProfile: LodgingRateProfile = lodgingDaycareCustomer
    ? "daycare"
    : "standard";
  const additionalDogLodgingProfile: LodgingRateProfile = lodgingDaycareCustomer
    ? "daycare_additional_dog"
    : "additional_dog";

  const toggle = (id: string, setter: (update: (current: string[]) => string[]) => void) => {
    setter((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dogIds.length || !serviceIds.length) return;
    if (
      includesLodging &&
      (!endDate ||
        !lodgingNightOptions(date, endDate).includes(lodgingNights) ||
        (hasDeposit &&
          (!Number.isInteger(depositPercent) ||
            depositPercent < 1 ||
            depositPercent > 99)))
    ) {
      return;
    }
    const form = new FormData(event.currentTarget);
    await onSubmit({
      dogIds,
      serviceCatalogIds: serviceIds,
      date,
      endDate: includesLodging ? endDate : undefined,
      startTime: String(form.get("time") ?? "") || undefined,
      endTime: String(form.get("endTime") ?? "") || undefined,
      transportDirection: direction,
      lodgingNights: includesLodging ? lodgingNights : undefined,
      depositPercent: includesLodging
        ? hasDeposit
          ? depositPercent
          : null
        : undefined,
      lodgingDaycareCustomer:
        includesLodging && hasDeposit ? lodgingDaycareCustomer : undefined,
      internalNotes: String(form.get("internalNotes") ?? "").trim() || undefined,
    });
  }

  return (
    <Dialog
      title="Agendamento rápido"
      description="Escolha vários cães do mesmo cliente e vários serviços. Cada combinação será salva separadamente para continuar fácil de confirmar, editar, concluir e faturar."
      onClose={onClose}
    >
      <form className="form-grid quick-service-form" onSubmit={submit}>
        <label className="field full">
          <span>Cliente *</span>
          <select
            value={customerId}
            onChange={(event) => {
              setCustomerId(event.target.value);
              setDogIds([]);
            }}
            required
          >
            <option value="">Escolha o cliente</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.name}</option>
            ))}
          </select>
        </label>

        <fieldset className="quick-choice-group full" disabled={!customerId}>
          <legend>Cães *</legend>
          {availableDogs.length ? availableDogs.map((dog) => (
            <label key={dog.id}>
              <input
                type="checkbox"
                checked={dogIds.includes(dog.id)}
                onChange={() => toggle(dog.id, setDogIds)}
              />
              <span>{dog.name}</span>
            </label>
          )) : <small>{customerId ? "Este cliente não possui cães ativos." : "Escolha o cliente primeiro."}</small>}
        </fieldset>

        <fieldset className="quick-choice-group full">
          <legend>Serviços *</legend>
          {services.map((service) => (
            <label key={service.id} className={`service-${service.code}`}>
              <input
                type="checkbox"
                checked={serviceIds.includes(service.id)}
                onChange={() => {
                  if (service.code === "hotel") {
                    if (serviceIds.includes(service.id)) {
                      setServiceIds([]);
                    } else {
                      const nextEndDate =
                        endDate > date ? endDate : shiftDate(date, 1);
                      setEndDate(nextEndDate);
                      setLodgingNights(
                        lodgingNightOptions(date, nextEndDate)[0] ?? 1,
                      );
                      setServiceIds([service.id]);
                    }
                    return;
                  }
                  setServiceIds((current) => {
                    const withoutLodging = lodgingService
                      ? current.filter((id) => id !== lodgingService.id)
                      : current;
                    return withoutLodging.includes(service.id)
                      ? withoutLodging.filter((id) => id !== service.id)
                      : [...withoutLodging, service.id];
                  });
                }}
              />
              <span>{service.name}</span>
            </label>
          ))}
          <small>
            Hospedagem é criada separadamente dos serviços do dia, mas pode incluir vários cães da mesma reserva.
          </small>
        </fieldset>

        <label className={`field${includesLodging ? "" : " full"}`}>
          <span>{includesLodging ? "Entrada *" : "Data *"}</span>
          <BrazilianDateInput
            value={date}
            onChange={(nextDate) => {
              setDate(nextDate);
              if (includesLodging && endDate <= nextDate) {
                const nextEndDate = shiftDate(nextDate, 1);
                setEndDate(nextEndDate);
                setLodgingNights(1);
              }
            }}
            required
          />
        </label>
        {includesLodging && (
          <>
            <label className="field">
              <span>Saída *</span>
              <BrazilianDateInput
                value={endDate}
                min={shiftDate(date, 1)}
                onChange={(nextEndDate) => {
                  setEndDate(nextEndDate);
                  setLodgingNights(
                    lodgingNightOptions(date, nextEndDate)[0] ?? 1,
                  );
                }}
                required
              />
            </label>
            <label className="field full">
              <span>Número de diárias *</span>
              <select
                value={lodgingNights}
                onChange={(event) =>
                  setLodgingNights(Number(event.target.value))
                }
                required
              >
                {lodgingNightOptions(date, endDate).map((nights) => (
                  <option key={nights} value={nights}>
                    {String(nights).replace(".", ",")} {nights === 1 ? "diária" : "diárias"}
                  </option>
                ))}
              </select>
              <small>Somente opções compatíveis com a entrada e a saída.</small>
            </label>
          </>
        )}
        <ServiceTimeInput
          name="time"
          label={includesLodging ? "Entrada (opcional)" : "Início"}
        />
        <ServiceTimeInput
          name="endTime"
          label={includesLodging ? "Saída (opcional)" : "Fim"}
        />

        {includesTaxiDog && (
          <label className="field full">
            <span>Trajeto do Taxi-dog</span>
            <select value={direction} onChange={(event) => setDirection(event.target.value as "one_way" | "round_trip")}>
              <option value="one_way">Ida · 1 crédito</option>
              <option value="round_trip">Ida e volta · 2 créditos</option>
            </select>
          </label>
        )}
        {includesLodging && (
          <>
            <label className="check-field full">
              <input
                type="checkbox"
                checked={hasDeposit}
                onChange={(event) => {
                  setHasDeposit(event.target.checked);
                  if (!event.target.checked) {
                    setLodgingDaycareCustomer(false);
                  }
                }}
              />
              <span>
                Cobrar sinal no check-in
                <small>O saldo permanecerá para o check-out.</small>
              </span>
            </label>
            {hasDeposit ? (
              <fieldset className="lodging-rate-options full">
                <legend>Condição para calcular o sinal</legend>
                <label className="field">
                  <span>Sinal no check-in (%)</span>
                  <input
                    type="number"
                    min="1"
                    max="99"
                    step="1"
                    value={depositPercent}
                    onChange={(event) =>
                      setDepositPercent(Number(event.target.value))
                    }
                    required
                  />
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={lodgingDaycareCustomer}
                    onChange={(event) =>
                      setLodgingDaycareCustomer(event.target.checked)
                    }
                  />
                  <span>Cliente de creche regular</span>
                </label>
                <small className="field-help">
                  {dogIds.length > 0
                    ? `${dogs.find((dog) => dog.id === dogIds[0])?.name ?? "Primeiro cão"}: ${lodgingRateLabel(primaryLodgingProfile)} · ${formatCurrency(lodgingDailyRate(lodgingPricing, primaryLodgingProfile))} por diária.`
                    : "Selecione ao menos um cão para visualizar a condição da diária."}
                  {dogIds.length > 1
                    ? dogIds.length === 2
                      ? ` O outro cão terá a diária adicional de ${formatCurrency(lodgingDailyRate(lodgingPricing, additionalDogLodgingProfile))}.`
                      : ` Os outros ${dogIds.length - 1} cães terão a diária adicional de ${formatCurrency(lodgingDailyRate(lodgingPricing, additionalDogLodgingProfile))}.`
                    : ""}
                </small>
              </fieldset>
            ) : (
              <small className="field-help full">
                A condição da diária será definida em Cobranças, ao escolher Regular.
              </small>
            )}
          </>
        )}
        <label className="field full">
          <span>Observação geral</span>
          <textarea name="internalNotes" rows={2} maxLength={2000} placeholder="Opcional" />
        </label>
        <div className="quick-service-summary full">
          <strong>{total || 0}</strong>
          <span>{total === 1 ? "atendimento será criado" : "atendimentos serão criados"}</span>
        </div>
        <div className="dialog-actions full">
          <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button className="primary-button" type="submit" disabled={busy || total === 0}>
            {busy ? "Criando…" : "Criar agendamentos"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function AgendaCard({
  booking,
  dog,
  onAdvance,
  openMenu,
  onMenu,
  onEdit,
  onCancel,
  receipt,
  onOpenReceipt,
  onLodgingInvoice,
  showDate = false,
  agendaDate,
  feedingEditorOpen = false,
  feedingDraft = "",
  feedingSaving = false,
  onStartFeedingEdit,
  onFeedingDraftChange,
  onCancelFeedingEdit,
  onSaveFeeding,
}: {
  booking: Booking;
  dog?: Dog;
  onAdvance: (booking: Booking) => void;
  openMenu: boolean;
  onMenu: () => void;
  onEdit: (booking: Booking) => void;
  onCancel: (booking: Booking) => void;
  receipt?: ServiceReceipt;
  onOpenReceipt?: (receipt: ServiceReceipt) => void;
  onLodgingInvoice?: (
    booking: Booking,
    kind: "deposit" | "balance",
  ) => void;
  showDate?: boolean;
  agendaDate?: string;
  feedingEditorOpen?: boolean;
  feedingDraft?: string;
  feedingSaving?: boolean;
  onStartFeedingEdit?: () => void;
  onFeedingDraftChange?: (value: string) => void;
  onCancelFeedingEdit?: () => void;
  onSaveFeeding?: () => void;
}) {
  const action =
    booking.date > operationalToday &&
    booking.status !== "scheduled" &&
    booking.status !== "completed"
      ? null
      : primaryAction(booking);
  const dogAlerts = agendaDate ? agendaAlertsForDog(dog, agendaDate) : [];
  const showsOperationalTime = booking.serviceType !== "transport";
  const showsTimeBlock = showsOperationalTime || showDate;
  const creditUnits = creditUnitsForBooking(booking);
  const lodgingDayPosition =
    booking.serviceType === "hotel" && agendaDate
      ? agendaDate === booking.date
        ? "arrival"
        : agendaDate === booking.endDate
          ? "departure"
          : "stay"
      : null;
  const displayedTime =
    lodgingDayPosition === "arrival"
      ? booking.time === "Sem horário"
        ? "Entrada"
        : formatOperationalTime(booking.time)
      : lodgingDayPosition === "departure"
        ? booking.endTime
          ? formatOperationalTime(booking.endTime)
          : "Saída"
        : lodgingDayPosition === "stay"
          ? "Todo o dia"
          : formatOperationalTime(booking.time);
  const displayedTimeCaption =
    lodgingDayPosition === "arrival"
      ? booking.time === "Sem horário"
        ? "dia de chegada"
        : "chegada"
      : lodgingDayPosition === "departure"
        ? booking.endTime
          ? "saída até este horário"
          : "dia de saída"
        : lodgingDayPosition === "stay"
          ? "hospedado"
          : booking.time !== "Sem horário"
            ? booking.endTime
              ? `até ${formatOperationalTime(booking.endTime)}`
              : "Horário inicial"
            : null;
  return (
    <article
      className={`agenda-card service-${booking.serviceType} status-${booking.status}${
        showsTimeBlock ? "" : " without-time"
      }`}
    >
      {showsTimeBlock && (
        <div className="time-block">
          {showDate && (
            <span className="booking-card-date">
              {formatShortDate(booking.date)}
              {booking.endDate && booking.endDate !== booking.date
                ? ` a ${formatShortDate(booking.endDate)}`
                : ""}
            </span>
          )}
          {showsOperationalTime && <strong>{displayedTime}</strong>}
          {showsOperationalTime && displayedTimeCaption && (
            <span>{displayedTimeCaption}</span>
          )}
        </div>
      )}
      <DogAvatar dog={dog} />
      <div className="agenda-main">
        <div className="agenda-title-row">
          <h3>{booking.dogName}</h3>
          <span className={`status-pill ${booking.status}`}>
            {statusLabels[booking.status]}
          </span>
        </div>
        <p>{booking.service}</p>
        <small>{booking.customerName}</small>
        {booking.serviceType === "hotel" && booking.endDate && (
          <span className="lodging-period">
            Entrada {formatShortDate(booking.date)} · saída{" "}
            {formatShortDate(booking.endDate)}
            {booking.lodgingNights
              ? ` · ${booking.lodgingNights} ${
                  booking.lodgingNights === 1 ? "diária" : "diárias"
                }`
              : ""}
          </span>
        )}
        {booking.recurringScheduleId && (
          <span className="settlement-note recurrence">
            Recorrência semanal
          </span>
        )}
        {booking.settlementStatus === "credit_used" && (
          <span className="settlement-note settled">
            Quitado com {creditUnits} {creditUnits === 1 ? "crédito" : "créditos"}
            {" · sem nova fatura"}
          </span>
        )}
        {booking.settlementStatus === "invoice_pending" && (
          <span className="settlement-note invoice">
            Serviço pronto para faturamento
          </span>
        )}
        {booking.serviceType === "hotel" && booking.depositPercent && (
          <div className="lodging-billing-status">
            <strong>Hospedagem com sinal de {booking.depositPercent}%</strong>
            {booking.depositInvoice ? (
              <span>
                Sinal {formatCurrency(booking.depositInvoice.amountCents)} ·{" "}
                {booking.depositInvoice.status === "paid"
                  ? "pago"
                  : "aguardando pagamento"}
              </span>
            ) : booking.status === "confirmed" && onLodgingInvoice ? (
              <button
                type="button"
                className="text-button"
                onClick={() => onLodgingInvoice(booking, "deposit")}
              >
                Gerar fatura do sinal
              </button>
            ) : (
              <span>Disponível após confirmar a hospedagem</span>
            )}
            {booking.balanceInvoice ? (
              <span>
                Saldo {formatCurrency(booking.balanceInvoice.amountCents)} ·{" "}
                {booking.balanceInvoice.status === "paid"
                  ? "pago"
                  : "aguardando pagamento"}
              </span>
            ) : booking.status === "completed" && onLodgingInvoice ? (
              <button
                type="button"
                className="text-button"
                onClick={() => onLodgingInvoice(booking, "balance")}
              >
                Gerar fatura do saldo
              </button>
            ) : null}
          </div>
        )}
        {booking.serviceType === "hotel" &&
          !booking.depositPercent &&
          booking.status === "completed" &&
          !booking.balanceInvoice &&
          onLodgingInvoice && (
            <div className="lodging-billing-status">
              <strong>Pagamento integral no checkout</strong>
              <button
                type="button"
                className="text-button"
                onClick={() => onLodgingInvoice(booking, "balance")}
              >
                Gerar fatura da hospedagem
              </button>
            </div>
          )}
        {booking.note && <span className="care-note">{booking.note}</span>}
        {agendaDate && dog && (
          <div className="agenda-dog-care">
            {dogAlerts.length > 0 && (
              <div className="agenda-dog-alert" role="note">
                <span aria-hidden="true">!</span>
                <p>
                  <strong>Atenção</strong>
                  {dogAlerts.join(" · ")}
                </p>
              </div>
            )}
            {dog.feedingNotes ? (
              <div className="agenda-feeding-note">
                <span>Alimentação</span>
                <p>{dog.feedingNotes}</p>
              </div>
            ) : feedingEditorOpen ? (
              <div className="agenda-feeding-editor">
                <label htmlFor={`feeding-${booking.id}`}>Alimentação de {dog.name}</label>
                <textarea
                  id={`feeding-${booking.id}`}
                  rows={3}
                  value={feedingDraft}
                  onChange={(event) => onFeedingDraftChange?.(event.target.value)}
                  placeholder="Ex.: 2 porções por dia, 120 g cada"
                  autoFocus
                />
                <div>
                  <button
                    type="button"
                    className="text-button muted"
                    onClick={onCancelFeedingEdit}
                    disabled={feedingSaving}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={onSaveFeeding}
                    disabled={feedingSaving || !feedingDraft.trim()}
                  >
                    {feedingSaving ? "Salvando…" : "Salvar"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="add-feeding-button"
                onClick={onStartFeedingEdit}
              >
                + Adicionar dados sobre alimentação
              </button>
            )}
          </div>
        )}
      </div>
      <div className="agenda-actions">
        {action && (
          <button className="action-button" onClick={() => onAdvance(booking)}>
            {action}
          </button>
        )}
        {booking.settlementStatus === "credit_used" &&
          receipt &&
          onOpenReceipt && (
          <button
            className="receipt-button"
            onClick={() => onOpenReceipt(receipt)}
          >
            Ver recibo
          </button>
          )}
        {booking.status !== "completed" &&
          booking.status !== "cancelled" && (
            <div className="more-menu">
              <button
                className="more-button"
                onClick={onMenu}
                aria-expanded={openMenu}
                aria-label={`Mais opções para ${booking.dogName}`}
              >
                Opções
              </button>
              {openMenu && (
                <div className="menu-popover">
                  <button
                    onClick={() => {
                      onEdit(booking);
                    }}
                  >
                    Editar
                  </button>
                  <button
                    className="danger-text"
                    onClick={() => onCancel(booking)}
                  >
                    Cancelar atendimento
                  </button>
                </div>
              )}
            </div>
          )}
      </div>
    </article>
  );
}

function DogsView({
  dogs,
  onSelect,
  onNew,
}: {
  dogs: Dog[];
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <section className="panel full-panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Ativos</p>
          <h2>{dogs.length} cães cadastrados</h2>
        </div>
        <button className="secondary-button" onClick={onNew}>
          + Novo cão
        </button>
      </div>
      <div className="dog-grid">
        {dogs.map((dog) => (
          <button className="dog-card" key={dog.id} onClick={() => onSelect(dog.id)}>
            <div className="dog-card-top">
              <DogAvatar dog={dog} size="large" />
              <span className="status-pill neutral">Ativo</span>
            </div>
            <h3>{dog.name}</h3>
            <p>
              {dog.breed} · {dog.age}
            </p>
            <div className="dog-card-divider" />
            <small>Cliente</small>
            <strong className="customer-name">{dog.customerName}</strong>
            <span className="today-status">{dog.today}</span>
            {dog.alert && <span className="mini-alert">{dog.alert}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}

function ProfileAppointments({
  bookings,
  dogs,
  receipts,
  onAdvance,
  onMenu,
  openMenuId,
  onEdit,
  onCancel,
  onOpenReceipt,
  onLodgingInvoice,
}: {
  bookings: Booking[];
  dogs: Dog[];
  receipts: ServiceReceipt[];
  onAdvance: (booking: Booking) => void;
  onMenu: (id: string | null) => void;
  openMenuId: string | null;
  onEdit: (booking: Booking) => void;
  onCancel: (booking: Booking) => void;
  onOpenReceipt: (receipt: ServiceReceipt) => void;
  onLodgingInvoice: (
    booking: Booking,
    kind: "deposit" | "balance",
  ) => void;
}) {
  const openBookings = bookings
    .filter(
      (booking) =>
        booking.status !== "completed" && booking.status !== "cancelled",
    )
    .sort((left, right) =>
      `${left.date}-${left.time}`.localeCompare(
        `${right.date}-${right.time}`,
      ),
    );
  const historyBookings = bookings
    .filter(
      (booking) =>
        booking.status === "completed" || booking.status === "cancelled",
    )
    .sort((left, right) =>
      `${right.date}-${right.time}`.localeCompare(
        `${left.date}-${left.time}`,
      ),
    );

  function renderBooking(booking: Booking) {
    return (
      <AgendaCard
        key={booking.id}
        booking={booking}
        dog={dogs.find((dog) => dog.id === booking.dogId)}
        onAdvance={onAdvance}
        openMenu={openMenuId === booking.id}
        onMenu={() =>
          onMenu(openMenuId === booking.id ? null : booking.id)
        }
        onEdit={onEdit}
        onCancel={onCancel}
        receipt={receipts.find(
          (receipt) => receipt.number === booking.receiptNumber,
        )}
        onOpenReceipt={onOpenReceipt}
        onLodgingInvoice={onLodgingInvoice}
        showDate
      />
    );
  }

  if (!bookings.length) {
    return (
      <EmptyState
        title="Nenhum serviço neste período"
        description="Use “Novo serviço” para criar o primeiro agendamento."
      />
    );
  }

  return (
    <div className="profile-appointment-groups">
      {openBookings.length > 0 && (
        <section>
          <div className="agenda-day-divider">
            <span>Próximos e em andamento</span>
            <span>{openBookings.length}</span>
          </div>
          <div className="agenda-list spacious">
            {openBookings.map(renderBooking)}
          </div>
        </section>
      )}
      {historyBookings.length > 0 && (
        <section>
          <div className="agenda-day-divider">
            <span>Histórico recente</span>
            <span>{historyBookings.length}</span>
          </div>
          <div className="agenda-list spacious">
            {historyBookings.map(renderBooking)}
          </div>
        </section>
      )}
    </div>
  );
}

function DogProfile({
  dog,
  creditBalances,
  bookings,
  onBack,
  onEdit,
  onNewService,
  receipts,
  onAdvance,
  onMenu,
  openMenuId,
  onEditBooking,
  onCancelBooking,
  onOpenReceipt,
  onLodgingInvoice,
}: {
  dog: Dog;
  creditBalances: CreditBalances;
  bookings: Booking[];
  onBack: () => void;
  onEdit: () => void;
  onNewService: () => void;
  receipts: ServiceReceipt[];
  onAdvance: (booking: Booking) => void;
  onMenu: (id: string | null) => void;
  openMenuId: string | null;
  onEditBooking: (booking: Booking) => void;
  onCancelBooking: (booking: Booking) => void;
  onOpenReceipt: (receipt: ServiceReceipt) => void;
  onLodgingInvoice: (
    booking: Booking,
    kind: "deposit" | "balance",
  ) => void;
}) {
  const [tab, setTab] = useState("Resumo");
  const balances = creditBalances[dog.customerId] ?? {
    daycare: 0,
    bath: 0,
    grooming: 0,
    transport: 0,
  };
  const hasCredits = totalCredits(creditBalances, dog.customerId) > 0;
  return (
    <div className="profile-page">
      <button className="back-button" onClick={onBack}>
        ‹ Voltar para cães
      </button>
      <section className="profile-header panel">
        <DogAvatar dog={dog} size="xlarge" />
        <div className="profile-title">
          <div className="profile-badges">
            <span className="status-pill neutral">Ativo</span>
            <span className="status-pill success">
              {dog.vaccinesCurrent ? "Vacinas em dia" : "Vacinas a revisar"}
            </span>
          </div>
          <h2>{dog.name}</h2>
          <p>
            {dog.breed} · {dog.age}
          </p>
        </div>
        <div className="profile-actions">
          <button className="secondary-button" onClick={onEdit}>
            Editar
          </button>
          <button className="primary-button" onClick={onNewService}>
            + Novo serviço
          </button>
        </div>
      </section>
      {dog.alert && (
        <div className="profile-alert">
          <span className="attention-mark">!</span>
          <p>
            <strong>Alerta essencial</strong>
            {dog.alert}
          </p>
        </div>
      )}
      <div className="tabs" role="tablist" aria-label={`Perfil de ${dog.name}`}>
        {["Resumo", "Agenda e histórico", "Saúde e cuidados"].map(
          (item) => (
            <button
              key={item}
              className={tab === item ? "active" : ""}
              onClick={() => setTab(item)}
              role="tab"
              aria-selected={tab === item}
            >
              {item}
            </button>
          ),
        )}
      </div>
      {tab === "Resumo" && (
        <div className="profile-grid">
          <section className="panel profile-main-card">
            <p className="section-kicker">Hoje</p>
            <h3>{dog.today}</h3>
            <div className="detail-list">
              <div>
                <span>Próximo cuidado</span>
                <strong>{dog.nextService}</strong>
              </div>
              <div>
                <span>Cliente responsável</span>
                <strong>{dog.customerName}</strong>
              </div>
              <div>
                <span>Alimentação</span>
                <strong>{dog.feedingNotes || "Não informada"}</strong>
              </div>
              <div>
                <span>Sexo</span>
                <strong>
                  {dog.sex === "female"
                    ? "Fêmea"
                    : dog.sex === "male"
                      ? "Macho"
                      : "Não informado"}
                </strong>
              </div>
              <div>
                <span>Castrado</span>
                <strong>
                  {dog.neutered === true
                    ? "Sim"
                    : dog.neutered === false
                      ? "Não"
                      : "Não informado"}
                </strong>
              </div>
            </div>
          </section>
          <section className="panel">
            <p className="section-kicker">Créditos</p>
            <h3>Disponíveis</h3>
            {hasCredits ? (
              <div className="credit-list">
                <div>
                  <span>Creche</span>
                  <strong>{balances.daycare}</strong>
                </div>
                <div>
                  <span>Banho</span>
                  <strong>{balances.bath}</strong>
                </div>
                <div>
                  <span>Taxi-dog</span>
                  <strong>{balances.transport}</strong>
                </div>
              </div>
            ) : (
              <EmptyState
                title="Sem créditos"
                description="A conta deste cliente não possui utilizações pré-pagas."
              />
            )}
          </section>
        </div>
      )}
      {tab === "Agenda e histórico" && (
        <section className="panel full-panel">
          <ProfileAppointments
            bookings={bookings}
            dogs={[dog]}
            receipts={receipts}
            onAdvance={onAdvance}
            onMenu={onMenu}
            openMenuId={openMenuId}
            onEdit={onEditBooking}
            onCancel={onCancelBooking}
            onOpenReceipt={onOpenReceipt}
            onLodgingInvoice={onLodgingInvoice}
          />
        </section>
      )}
      {tab === "Saúde e cuidados" && (
        <section className="panel full-panel info-state">
          <p className="section-kicker">Cuidados compartilhados com a equipe</p>
          <h3>Informações essenciais</h3>
          <div className="detail-list two-columns">
            <div>
              <span>Vacinas</span>
              {dog.vaccines?.length ? (
                <strong>
                  {dog.vaccines
                    .map(
                      (vaccine) =>
                        `${vaccine.name} · vence em ${formatShortDate(
                          vaccine.expiresOn,
                        )}`,
                    )
                    .join(" · ")}
                </strong>
              ) : (
                <strong>Nenhuma vacina cadastrada</strong>
              )}
            </div>
            <div>
              <span>Temperamento</span>
              <strong>{dog.temperamentNotes || "Não informado"}</strong>
            </div>
            <div>
              <span>Alimentação</span>
              <strong>{dog.feedingNotes || "Não informada"}</strong>
            </div>
            <div>
              <span>Medicação</span>
              <strong>{dog.medicationNotes || "Nenhuma informada"}</strong>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function CustomersView({
  customers,
  dogs,
  onSelect,
  onNew,
}: {
  customers: Customer[];
  dogs: Dog[];
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const dogNamesByCustomer = useMemo(() => {
    const dogNameById = new Map(dogs.map((dog) => [dog.id, dog.name]));
    return new Map(
      customers.map((customer) => [
        customer.id,
        customer.dogIds
          .map((dogId) => dogNameById.get(dogId))
          .filter((name): name is string => Boolean(name))
          .join(", "),
      ]),
    );
  }, [customers, dogs]);

  return (
    <section className="panel full-panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Relacionamento</p>
          <h2>{customers.length} clientes ativos</h2>
        </div>
        <div className="inline-actions">
          <button className="secondary-button" onClick={onNew}>
            + Novo cliente
          </button>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Contato</th>
              <th>Cães</th>
              <th>Créditos</th>
              <th>Situação</th>
              <th>
                <span className="sr-only">Abrir</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td>
                  <span className="table-person">
                    <span className="avatar avatar-neutral">
                      {customer.initials}
                    </span>
                    <strong>{customer.name}</strong>
                  </span>
                </td>
                <td>
                  <span className="table-stack">
                    <strong>{customer.phone}</strong>
                    <small>{customer.email}</small>
                  </span>
                </td>
                <td>
                  {dogNamesByCustomer.get(customer.id) || "Nenhum"}
                </td>
                <td>{customer.creditsLabel}</td>
                <td>
                  <CustomerStatus customer={customer} />
                </td>
                <td>
                  <button
                    className="row-link"
                    onClick={() => onSelect(customer.id)}
                    aria-label={`Abrir cliente ${customer.name}`}
                  >
                    Abrir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mobile-card-list">
        {customers.map((customer) => (
          <button
            className="mobile-data-card"
            key={customer.id}
            onClick={() => onSelect(customer.id)}
          >
            <span className="table-person">
              <span className="avatar avatar-neutral">{customer.initials}</span>
              <span>
                <strong>{customer.name}</strong>
                <small>{customer.phone}</small>
              </span>
            </span>
            <CustomerStatus customer={customer} />
            <span className="mobile-data-detail">
              {dogNamesByCustomer.get(customer.id) || "Nenhum cão"}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function CustomerStatus({ customer }: { customer: Customer }) {
  if (customer.status === "overdue") {
    return <span className="status-pill overdue">Vencido</span>;
  }
  if (customer.status === "pending") {
    return <span className="status-pill pending">Fatura pendente</span>;
  }
  return <span className="status-pill success">Em dia</span>;
}

function CustomerProfile({
  customer,
  dogs,
  bookings,
  invoices,
  creditBalances,
  creditPurchases,
  receipts,
  onBack,
  onEdit,
  onOpenDog,
  onOpenInvoice,
  onAddCredits,
  onAdjustCredits,
  canAdjustCredits,
  onOpenReceipt,
  onNewService,
  onAdvance,
  onMenu,
  openMenuId,
  onEditBooking,
  onCancelBooking,
  onLodgingInvoice,
  onStatement,
}: {
  customer: Customer;
  dogs: Dog[];
  bookings: Booking[];
  invoices: Invoice[];
  creditBalances: CreditBalances;
  creditPurchases: CreditPurchase[];
  receipts: ServiceReceipt[];
  onBack: () => void;
  onEdit: () => void;
  onOpenDog: (id: string) => void;
  onOpenInvoice: (invoice: Invoice) => void;
  onAddCredits: () => void;
  onAdjustCredits: () => void;
  canAdjustCredits: boolean;
  onOpenReceipt: (receipt: ServiceReceipt) => void;
  onNewService: () => void;
  onAdvance: (booking: Booking) => void;
  onMenu: (id: string | null) => void;
  openMenuId: string | null;
  onEditBooking: (booking: Booking) => void;
  onCancelBooking: (booking: Booking) => void;
  onLodgingInvoice: (
    booking: Booking,
    kind: "deposit" | "balance",
  ) => void;
  onStatement: () => void;
}) {
  const [tab, setTab] = useState("Resumo");
  const balances = creditBalances[customer.id] ?? {
    daycare: 0,
    bath: 0,
    grooming: 0,
    transport: 0,
  };
  return (
    <div className="profile-page">
      <button className="back-button" onClick={onBack}>
        ‹ Voltar para clientes
      </button>
      <section className="profile-header panel">
        <span className="avatar avatar-xlarge avatar-neutral">
          {customer.initials}
        </span>
        <div className="profile-title">
          <div className="profile-badges">
            <CustomerStatus customer={customer} />
          </div>
          <h2>{customer.name}</h2>
          <p>
            {customer.phone} · {customer.email}
          </p>
        </div>
        <div className="profile-actions">
          <button className="secondary-button" onClick={onStatement}>
            Emitir extrato
          </button>
          <button className="secondary-button" onClick={onEdit}>
            Editar
          </button>
          <button className="primary-button" onClick={onNewService}>
            + Novo serviço
          </button>
        </div>
      </section>
      <div className="tabs" role="tablist" aria-label="Perfil do cliente">
        {["Resumo", "Serviços", "Financeiro e créditos"].map(
          (item) => (
            <button
              key={item}
              className={tab === item ? "active" : ""}
              onClick={() => setTab(item)}
              role="tab"
              aria-selected={tab === item}
            >
              {item}
            </button>
          ),
        )}
      </div>
      {tab === "Resumo" && (
        <div className="profile-grid">
          <section className="panel profile-main-card">
            <p className="section-kicker">Família canina</p>
            <h3>{dogs.length === 1 ? "1 cão" : `${dogs.length} cães`}</h3>
            <div className="linked-dogs">
              {dogs.map((dog) => (
                <button key={dog.id} onClick={() => onOpenDog(dog.id)}>
                  <DogAvatar dog={dog} size="small" />
                  <span>
                    <strong>{dog.name}</strong>
                    <small>{dog.breed}</small>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          </section>
          <section className="panel">
            <p className="section-kicker">Contato</p>
            <h3>Informações principais</h3>
            <div className="detail-list">
              <div>
                <span>WhatsApp</span>
                <strong>{customer.phone}</strong>
              </div>
              <div>
                <span>E-mail financeiro</span>
                <strong>{customer.email}</strong>
              </div>
              <div>
                <span>Endereço</span>
                <strong>{customer.address || "Não informado"}</strong>
              </div>
              <div>
                <span>CPF</span>
                <strong>{customer.cpf || "Não informado"}</strong>
              </div>
              <div>
                <span>Data de nascimento</span>
                <strong>
                  {customer.birthDate
                    ? formatShortDate(customer.birthDate)
                    : "Não informada"}
                </strong>
              </div>
              <div>
                <span>Créditos</span>
                <strong>{customer.creditsLabel}</strong>
              </div>
            </div>
          </section>
        </div>
      )}
      {tab === "Serviços" && (
        <section className="panel full-panel">
          <ProfileAppointments
            bookings={bookings}
            dogs={dogs}
            receipts={receipts}
            onAdvance={onAdvance}
            onMenu={onMenu}
            openMenuId={openMenuId}
            onEdit={onEditBooking}
            onCancel={onCancelBooking}
            onOpenReceipt={onOpenReceipt}
            onLodgingInvoice={onLodgingInvoice}
          />
        </section>
      )}
      {tab === "Financeiro e créditos" && (
        <div className="profile-grid">
          <section className="panel profile-main-card">
            <p className="section-kicker">Cobranças</p>
            <h3>Movimentações recentes</h3>
            {invoices.length ? (
              <div className="invoice-mini-list">
                {invoices.map((invoice) => (
                  <div key={invoice.id}>
                    <span>
                      <strong>Cobrança {invoice.number}</strong>
                      <small>{invoice.due}</small>
                    </span>
                    <span>
                      <strong>{formatCurrency(invoice.amountCents)}</strong>
                      {invoice.status === "pending" && (
                        <button
                          className="text-button"
                          onClick={() => onOpenInvoice(invoice)}
                        >
                          Ver fatura
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Tudo em dia"
                description="Não há cobranças para este cliente."
              />
            )}
          </section>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Créditos</p>
                <h3>Saldo por serviço</h3>
              </div>
              <div className="heading-actions">
                {canAdjustCredits && (
                  <button className="text-button" onClick={onAdjustCredits}>
                    Ajustar saldo
                  </button>
                )}
                <button className="text-button" onClick={() => onAddCredits()}>
                  Vender pacote
                </button>
              </div>
            </div>
            <div className="credit-list">
              <div>
                <span>Creche</span>
                <strong>{balances.daycare}</strong>
              </div>
              <div>
                <span>Banho</span>
                <strong>{balances.bath}</strong>
              </div>
              <div>
                <span>Taxi-dog</span>
                <strong>{balances.transport}</strong>
              </div>
            </div>
            <p className="ledger-note">
              O saldo é calculado pelo extrato. Ajustes administrativos ficam
              registrados no histórico.
            </p>
          </section>
          <section className="panel profile-full-card">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Pacotes pré-pagos</p>
                <h3>Compras e liberações</h3>
              </div>
            </div>
            {creditPurchases.length ? (
              <div className="credit-package-list">
                {creditPurchases.map((purchase) => (
                  <div key={purchase.id}>
                    <span>
                      <strong>
                        {purchase.units} créditos de{" "}
                        {serviceLabels[purchase.serviceType]}
                      </strong>
                      <small>
                        {purchase.createdAt} ·{" "}
                        {purchase.status === "paid"
                          ? "Créditos liberados"
                          : purchase.status === "awaiting_payment"
                            ? "Fatura pendente"
                            : "Cancelado"}
                      </small>
                    </span>
                    <strong>{formatCurrency(purchase.amountCents)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Nenhum pacote vendido"
                description="Use “Vender pacote” para preparar a fatura e liberar os créditos após registrar o pagamento."
              />
            )}
          </section>
          <section className="panel profile-full-card">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Recibos</p>
                <h3>Serviços quitados com crédito</h3>
              </div>
            </div>
            {receipts.length ? (
              <div className="receipt-list">
                {receipts.map((receipt) => (
                  <button
                    key={receipt.id}
                    onClick={() => onOpenReceipt(receipt)}
                  >
                    <span>
                      <strong>
                        {receipt.dogName} · {receipt.service}
                      </strong>
                      <small>
                        {receipt.date} · {receipt.number}
                      </small>
                    </span>
                    <span className="status-pill success">
                      {receipt.deliveryStatus === "sent"
                        ? "Compartilhado"
                        : "Pronto"}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Nenhum recibo"
                description="Ao usar um crédito em um serviço, o recibo aparecerá aqui."
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function billableVisualType(service: BillableService): ServiceType {
  if (service.serviceType) return service.serviceType;
  const label = normalize(service.service);
  if (label.includes("hospedagem")) return "hotel";
  if (label.includes("taxi")) return "transport";
  if (label.includes("banho e tosa")) return "grooming";
  if (label.includes("banho")) return "bath";
  if (label.includes("creche")) return "daycare";
  return "other";
}

function BillingView({
  invoices,
  billableServices,
  selectedBillables,
  tab,
  onTabChange,
  customers,
  creditBalances,
  creditPurchases,
  receipts,
  onToggleBillable,
  onRegularBilling,
  onUseCredits,
  onCreateInvoice,
  onOpenInvoice,
  onAddCredits,
  onOpenReceipt,
  onToggleCash,
  onSaveNote,
  onMergeInvoices,
  onReverseInvoiceMerge,
  onStatement,
  onLoadHistory,
  mergeBusy,
}: {
  invoices: Invoice[];
  billableServices: BillableService[];
  selectedBillables: string[];
  tab: BillingTab;
  onTabChange: (value: BillingTab) => void;
  customers: Customer[];
  creditBalances: CreditBalances;
  creditPurchases: CreditPurchase[];
  receipts: ServiceReceipt[];
  onToggleBillable: (service: BillableService) => void;
  onRegularBilling: (service: BillableService) => void;
  onUseCredits: (service: BillableService) => void | Promise<void>;
  onCreateInvoice: () => void;
  onOpenInvoice: (invoice: Invoice) => void;
  onAddCredits: (customerId?: string) => void;
  onOpenReceipt: (receipt: ServiceReceipt) => void;
  onToggleCash: (invoice: Invoice) => void;
  onSaveNote: (
    invoiceId: string,
    note: string,
    followUpOn?: string,
  ) => Promise<boolean>;
  onMergeInvoices: (invoiceIds: string[], dueDate: string) => Promise<boolean>;
  onReverseInvoiceMerge: (invoice: Invoice) => boolean | Promise<boolean>;
  onStatement: () => void;
  onLoadHistory: (from: string, to: string) => Promise<Invoice[] | null>;
  mergeBusy: boolean;
}) {
  const [noteEditorInvoiceId, setNoteEditorInvoiceId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [followUpDraft, setFollowUpDraft] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [historyInvoices, setHistoryInvoices] = useState<Invoice[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const defaultInvoiceFrom = shiftDate(operationalToday, -29);
  const [invoicePeriodOpen, setInvoicePeriodOpen] = useState(false);
  const [invoicePeriodFrom, setInvoicePeriodFrom] = useState(defaultInvoiceFrom);
  const [invoicePeriodTo, setInvoicePeriodTo] = useState(operationalToday);
  const [appliedInvoiceFrom, setAppliedInvoiceFrom] = useState(defaultInvoiceFrom);
  const [appliedInvoiceTo, setAppliedInvoiceTo] = useState(operationalToday);
  const [invoiceStatusFilter, setInvoiceStatusFilter] =
    useState<InvoiceListStatus>("all");
  const [invoiceListSort, setInvoiceListSort] =
    useState<InvoiceListSort>("priority");
  const [selectedMergeInvoiceIds, setSelectedMergeInvoiceIds] = useState<string[]>([]);
  const [mergeSelectionMode, setMergeSelectionMode] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [bulkMergeDialogOpen, setBulkMergeDialogOpen] = useState(false);
  const [bulkMergeProgress, setBulkMergeProgress] = useState("");
  const [mergeDueDate, setMergeDueDate] = useState(operationalToday);
  const [creditSearch, setCreditSearch] = useState("");
  const [showZeroCreditAccounts, setShowZeroCreditAccounts] = useState(false);
  const synchronizedHistoryInvoices = historyInvoices.map(
    (historyInvoice) =>
      invoices.find((invoice) => invoice.id === historyInvoice.id) ??
      historyInvoice,
  );
  const selectedTotal = billableServices
    .filter((item) => selectedBillables.includes(item.id))
    .reduce((total, item) => total + item.amountCents, 0);
  const openInvoices = invoices.filter(
    (invoice) =>
      invoice.status !== "paid" && invoice.status !== "void",
  );
  const compensationInvoices = openInvoices.filter((invoice) =>
    Boolean(invoice.compensationAvailableOn),
  );
  const compensationTotal = compensationInvoices.reduce(
    (total, invoice) => total + invoice.amountCents,
    0,
  );
  const pendingInvoices = openInvoices.filter(
    (invoice) => !invoice.compensationAvailableOn,
  );
  const overdueInvoices = pendingInvoices.filter(
    (invoice) => invoice.status === "overdue",
  );
  const awaitingInvoices = pendingInvoices.filter(
    (invoice) => invoice.status !== "overdue",
  );
  const lateCompensations = compensationInvoices.filter(
    (invoice) => invoice.compensationAvailableOn! < operationalToday,
  );
  const filteredCreditCustomers = customers.filter((customer) => {
    const matchesSearch = normalize(customer.name).includes(
      normalize(creditSearch),
    );
    return (
      matchesSearch &&
      (showZeroCreditAccounts ||
        totalCredits(creditBalances, customer.id) > 0)
    );
  });
  const renewalCandidates = customers.flatMap((customer) =>
    creditServiceTypes.flatMap((serviceType) => {
      const hasBought = creditPurchases.some(
        (purchase) =>
          purchase.customerId === customer.id &&
          purchase.serviceType === serviceType &&
          purchase.status === "paid",
      );
      if (!hasBought) return [];
      const balance = creditBalances[customer.id]?.[serviceType] ?? 0;
      return balance <= 1 ? [{ customer, serviceType, balance }] : [];
    }),
  ).sort((left, right) =>
    left.balance - right.balance ||
    left.customer.name.localeCompare(right.customer.name, "pt-BR", { sensitivity: "base" }),
  );
  const invoiceStatus = (invoice: Invoice): Exclude<InvoiceListStatus, "all"> => {
    if (invoice.status === "void") return "void";
    if (invoice.status === "paid") return "paid";
    if (invoice.compensationAvailableOn) return "compensation";
    if (invoice.status === "overdue") return "overdue";
    return "pending";
  };
  const invoiceMatchesSearch = (invoice: Invoice) => {
    const query = normalize(invoiceSearch);
    if (!query) return true;
    return normalize(
      `${invoice.customerName} ${invoice.number} ${invoice.items} ${invoice.lines
        .map((line) => `${line.dogName} ${line.service}`)
        .join(" ")}`,
    ).includes(query);
  };
  const displayedInvoices = (tab === "history" ? synchronizedHistoryInvoices : openInvoices)
    .filter((invoice) => {
      if (tab !== "history") return true;
      if (invoice.status !== "paid" && invoice.status !== "void") return false;
      const entryDate =
        invoice.status === "paid"
          ? invoice.paidAt ?? invoice.issuedAt
          : invoice.voidedAt ?? invoice.issuedAt;
      return Boolean(
        entryDate &&
          entryDate >= appliedInvoiceFrom &&
          entryDate <= appliedInvoiceTo,
      );
    })
    .filter(invoiceMatchesSearch)
    .filter(
      (invoice) =>
        invoiceStatusFilter === "all" ||
        invoiceStatus(invoice) === invoiceStatusFilter,
    )
    .sort((left, right) => {
      if (invoiceListSort === "customer") {
        return (
          left.customerName.localeCompare(right.customerName, "pt-BR", {
            sensitivity: "base",
          }) ||
          (left.dueDate ?? "").localeCompare(right.dueDate ?? "") ||
          left.number.localeCompare(right.number)
        );
      }
      if (invoiceListSort === "dueDate") {
        return (
          (left.dueDate ?? "9999-12-31").localeCompare(
            right.dueDate ?? "9999-12-31",
          ) ||
          left.customerName.localeCompare(right.customerName, "pt-BR", {
            sensitivity: "base",
          }) ||
          left.number.localeCompare(right.number)
        );
      }
      const priority = (invoice: Invoice) => {
        if (
          invoice.compensationAvailableOn &&
          invoice.compensationAvailableOn < operationalToday
        ) return 0;
        if (invoice.status === "overdue") return 1;
        if (invoice.followUpOn && invoice.followUpOn <= operationalToday) return 2;
        if (invoice.dueDate === operationalToday) return 3;
        if (!invoice.sentBy?.length) return 4;
        if (invoice.compensationAvailableOn) return 5;
        if (invoice.status === "pending") return 6;
        if (invoice.status === "paid") return 7;
        return 8;
      };
      const priorityDifference = priority(left) - priority(right);
      if (priorityDifference) return priorityDifference;
      const leftPaid = left.status === "paid";
      const rightPaid = right.status === "paid";
      if (leftPaid !== rightPaid) return leftPaid ? 1 : -1;
      const leftDate =
        (leftPaid ? left.paidAt : left.issuedAt) ??
        left.issuedAt ??
        left.paidAt ??
        left.periodEnd ??
        left.periodStart ??
        "";
      const rightDate =
        (rightPaid ? right.paidAt : right.issuedAt) ??
        right.issuedAt ??
        right.paidAt ??
        right.periodEnd ??
        right.periodStart ??
        "";
      return rightDate.localeCompare(leftDate) || right.number.localeCompare(left.number);
    });
  const isDefaultInvoicePeriod =
    appliedInvoiceFrom === defaultInvoiceFrom &&
    appliedInvoiceTo === operationalToday;
  const selectedMergeInvoices = invoices.filter((invoice) =>
    selectedMergeInvoiceIds.includes(invoice.id),
  );
  const mergeTotalCents = selectedMergeInvoices.reduce(
    (total, invoice) => total + invoice.amountCents,
    0,
  );
  const mergeHasDifferentDueDates = new Set(
    selectedMergeInvoices.map((invoice) => invoice.dueDate),
  ).size > 1;
  const mergeHasLodgingMilestones = selectedMergeInvoices.some(
    (invoice) =>
      invoice.sourceType === "lodging_deposit" ||
      invoice.sourceType === "lodging_balance",
  );
  const bulkMergeGroups = Object.values(
    invoices.filter((invoice) =>
      invoice.status !== "paid" &&
      invoice.status !== "void" &&
      !invoice.compensationAvailableOn &&
      invoice.lines.length > 0 &&
      invoice.sourceType !== "lodging_deposit" &&
      invoice.sourceType !== "lodging_balance",
    ).reduce<Record<string, Invoice[]>>((groups, invoice) => {
      (groups[invoice.customerId] ??= []).push(invoice);
      return groups;
    }, {}),
  ).filter((group) => group.length >= 2);
  const billablesByCustomer = Object.values(
    billableServices.reduce<Record<string, BillableService[]>>((groups, service) => {
      (groups[service.customerId] ??= []).push(service);
      return groups;
    }, {}),
  ).sort((left, right) =>
    left[0].customerName.localeCompare(right[0].customerName, "pt-BR", {
      sensitivity: "base",
    }),
  );

  function invoiceCanBeMerged(invoice: Invoice) {
    return (
      invoice.status !== "paid" &&
      invoice.status !== "void" &&
      !invoice.compensationAvailableOn &&
      invoice.lines.length > 0
    );
  }

  function toggleMergeInvoice(invoice: Invoice) {
    if (!invoiceCanBeMerged(invoice)) return;
    setSelectedMergeInvoiceIds((current) => {
      if (current.includes(invoice.id)) {
        return current.filter((id) => id !== invoice.id);
      }
      const currentInvoices = invoices.filter((item) => current.includes(item.id));
      if (
        currentInvoices.length &&
        currentInvoices[0].customerId !== invoice.customerId
      ) {
        return [invoice.id];
      }
      return [...current, invoice.id];
    });
  }

  function openMergeDialog() {
    if (selectedMergeInvoices.length < 2) return;
    setMergeDueDate(
      selectedMergeInvoices
        .map((invoice) => invoice.dueDate ?? operationalToday)
        .sort()[0] ?? operationalToday,
    );
    setMergeDialogOpen(true);
  }

  async function submitInvoiceMerge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const merged = await onMergeInvoices(selectedMergeInvoiceIds, mergeDueDate);
    if (!merged) return;
    setSelectedMergeInvoiceIds([]);
    setMergeSelectionMode(false);
    setMergeDialogOpen(false);
  }

  async function submitBulkInvoiceMerge() {
    if (!bulkMergeGroups.length || mergeBusy) return;
    for (let index = 0; index < bulkMergeGroups.length; index += 1) {
      const group = bulkMergeGroups[index];
      setBulkMergeProgress(
        `${index + 1} de ${bulkMergeGroups.length} · ${group[0].customerName}`,
      );
      const dueDate = group
        .map((invoice) => invoice.dueDate ?? operationalToday)
        .sort()[0] ?? operationalToday;
      const merged = await onMergeInvoices(group.map((invoice) => invoice.id), dueDate);
      if (!merged) {
        setBulkMergeProgress("Operação interrompida com segurança; os demais clientes não foram alterados.");
        return;
      }
    }
    setBulkMergeProgress("");
    setBulkMergeDialogOpen(false);
    setSelectedMergeInvoiceIds([]);
  }

  async function loadHistoryPeriod(from: string, to: string) {
    if (historyLoading) return false;
    setHistoryLoading(true);
    const loaded = await onLoadHistory(from, to);
    setHistoryLoading(false);
    if (!loaded) return false;
    setHistoryInvoices(loaded);
    return true;
  }

  async function applyInvoicePeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !invoicePeriodFrom ||
      !invoicePeriodTo ||
      invoicePeriodTo < invoicePeriodFrom
    ) {
      return;
    }
    if (!(await loadHistoryPeriod(invoicePeriodFrom, invoicePeriodTo))) return;
    setAppliedInvoiceFrom(invoicePeriodFrom);
    setAppliedInvoiceTo(invoicePeriodTo);
    setSelectedMergeInvoiceIds([]);
    setInvoicePeriodOpen(false);
  }

  async function resetInvoicePeriod() {
    setInvoicePeriodFrom(defaultInvoiceFrom);
    setInvoicePeriodTo(operationalToday);
    setAppliedInvoiceFrom(defaultInvoiceFrom);
    setAppliedInvoiceTo(operationalToday);
    setSelectedMergeInvoiceIds([]);
    setMergeSelectionMode(false);
    setInvoicePeriodOpen(false);
    await loadHistoryPeriod(defaultInvoiceFrom, operationalToday);
  }

  function openInvoiceNote(invoice: Invoice) {
    setNoteEditorInvoiceId(invoice.id);
    setNoteDraft(invoice.internalNote ?? "");
    setFollowUpDraft(invoice.followUpOn ?? "");
  }

  async function saveInvoiceNote(invoiceId: string) {
    if (noteSaving) return;
    setNoteSaving(true);
    const saved = await onSaveNote(invoiceId, noteDraft, followUpDraft);
    setNoteSaving(false);
    if (saved) {
      setHistoryInvoices((current) =>
        current.map((invoice) =>
          invoice.id === invoiceId
            ? {
                ...invoice,
                internalNote: noteDraft.trim() || undefined,
                followUpOn: followUpDraft || undefined,
              }
            : invoice,
        ),
      );
      setNoteEditorInvoiceId(null);
    }
  }

  function toggleCashFromList(invoice: Invoice) {
    setHistoryInvoices((current) =>
      current.map((item) =>
        item.id === invoice.id
          ? { ...item, cashIncluded: invoice.cashIncluded === false }
          : item,
      ),
    );
    onToggleCash(invoice);
  }

  return (
    <div className="billing-page">
      <section className="finance-summary">
        <button
          type="button"
          onClick={() => {
            onTabChange("pending");
            setInvoiceStatusFilter("all");
          }}
        >
          <span>A faturar</span>
          <strong>{billableServices.length}</strong>
          <small>serviços concluídos aguardando decisão</small>
        </button>
        <button
          type="button"
          className={overdueInvoices.length ? "attention" : ""}
          onClick={() => {
            onTabChange("pending");
            setInvoiceStatusFilter("overdue");
          }}
        >
          <span>Vencidas</span>
          <strong>{overdueInvoices.length}</strong>
          <small>{formatCurrency(overdueInvoices.reduce((sum, invoice) => sum + invoice.amountCents, 0))}</small>
        </button>
        <button
          type="button"
          onClick={() => {
            onTabChange("pending");
            setInvoiceStatusFilter("pending");
          }}
        >
          <span>Aguardando pagamento</span>
          <strong>{awaitingInvoices.length}</strong>
          <small>{formatCurrency(awaitingInvoices.reduce((sum, invoice) => sum + invoice.amountCents, 0))}</small>
        </button>
        <button
          type="button"
          className={lateCompensations.length ? "attention" : ""}
          onClick={() => {
            onTabChange("pending");
            setInvoiceStatusFilter("compensation");
          }}
        >
          <span>Em compensação</span>
          <strong>{compensationInvoices.length}</strong>
          <small>
            {formatCurrency(compensationTotal)}
            {lateCompensations.length ? ` · ${lateCompensations.length} atrasada(s)` : ""}
          </small>
        </button>
      </section>

      <div className="billing-utility-actions">
        <button className="secondary-button" onClick={onStatement}>
          Emitir extrato do cliente
        </button>
        {bulkMergeGroups.length > 0 && (
          <button className="secondary-button" onClick={() => setBulkMergeDialogOpen(true)}>
            Consolidar abertas por cliente
          </button>
        )}
      </div>

      <div className="tabs billing-tabs" role="tablist" aria-label="Financeiro">
        {[
          ["pending", "Pendências"],
          ["history", "Histórico"],
          ["credits", "Créditos"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => {
              onTabChange(id as BillingTab);
              setInvoiceStatusFilter("all");
              setSelectedMergeInvoiceIds([]);
              setMergeSelectionMode(false);
              if (id === "history") {
                void loadHistoryPeriod(appliedInvoiceFrom, appliedInvoiceTo);
              }
            }}
            role="tab"
            aria-selected={tab === id}
          >
            {label}
          </button>
        ))}
      </div>

      {(tab === "pending" || tab === "history") && (
        <>
          {tab === "pending" && (
          <section className="panel full-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Aguardando faturamento</p>
                <h2>Serviços concluídos</h2>
                <small className="panel-heading-note">
                  Escolha Regular para conferir o valor e incluir na fatura, ou
                  quite o serviço com créditos disponíveis.
                </small>
              </div>
              <span className="invoice-only-badge">
                Faturas para compartilhamento
              </span>
            </div>
            {billableServices.length ? (
              <div className="billable-customer-list">
                {billablesByCustomer.map((customerServices) => (
                  <section
                    className="billable-customer-group"
                    key={customerServices[0].customerId}
                  >
                    <header>
                      <strong>{customerServices[0].customerName}</strong>
                      <small>
                        {customerServices.length}{" "}
                        {customerServices.length === 1 ? "serviço" : "serviços"}
                      </small>
                    </header>
                    <div className="billable-list">
                {customerServices.map((service) => {
                  const checked = selectedBillables.includes(service.id);
                  const first = billableServices.find(
                    (item) => item.id === selectedBillables[0],
                  );
                  const disabled =
                    service.selectable === false ||
                    (Boolean(first) && first?.customerId !== service.customerId);
                  const creditType = service.serviceType as
                    | CreditServiceType
                    | undefined;
                  const creditUnits = service.creditUnits ?? 0;
                  const availableCredits = creditType
                    ? (creditBalances[service.customerId]?.[creditType] ?? 0)
                    : 0;
                  const canUseCredits =
                    Boolean(service.appointmentItemId) &&
                    Boolean(creditType) &&
                    creditServiceTypes.includes(creditType!) &&
                    creditUnits > 0;
                  const lodgingValuePending =
                    service.serviceType === "hotel" &&
                    !service.lodging?.depositPercent &&
                    !service.billingPricingProfile;
                  return (
                    <div
                      className={`billable-row service-${billableVisualType(service)}${
                        disabled ? " disabled" : ""
                      }`}
                      key={service.id}
                    >
                      <span
                        className={`billable-selection-state${checked ? " selected" : ""}`}
                        aria-label={checked ? "Incluído na próxima fatura" : "Aguardando escolha"}
                        title={checked ? "Incluído na próxima fatura" : "Aguardando escolha"}
                      >
                        {checked ? "✓" : "·"}
                      </span>
                      <span className="billable-date">{service.date}</span>
                      <span className="billable-identity">
                        <strong>{service.dogName}</strong>
                        <small>{service.customerName}</small>
                      </span>
                      <span className="billable-description">
                        <strong>{service.service}</strong>
                        {service.billingNote && (
                          <small className="billable-note">
                            {service.billingNote}
                          </small>
                        )}
                        {lodgingValuePending && (
                          <small className="billable-note">
                            Defina a condição da diária em Regular
                          </small>
                        )}
                      </span>
                      <strong className="billable-amount">
                        {lodgingValuePending
                          ? "Valor a definir"
                          : formatCurrency(service.amountCents)}
                      </strong>
                      <span className="billable-payment-actions">
                        <button
                          type="button"
                          className={checked ? "secondary-button compact-button selected" : "secondary-button compact-button"}
                          disabled={disabled && !checked}
                          onClick={() =>
                            checked ? onToggleBillable(service) : onRegularBilling(service)
                          }
                        >
                          {checked ? "Regular ✓" : "Regular"}
                        </button>
                        {canUseCredits && (
                          <button
                            type="button"
                            className="text-button billable-credit-action"
                            disabled={checked || availableCredits < creditUnits}
                            onClick={() => void onUseCredits(service)}
                            title={
                              availableCredits < creditUnits
                                ? `Saldo atual: ${availableCredits}`
                                : `Saldo após o uso: ${availableCredits - creditUnits}`
                            }
                          >
                            {availableCredits < creditUnits
                              ? "Sem saldo"
                              : `Usar ${creditUnits} ${
                                  creditUnits === 1 ? "crédito" : "créditos"
                                }`}
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Tudo faturado"
                description="Não há serviços concluídos aguardando cobrança."
              />
            )}
          </section>
          )}

          <section className="panel full-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">
                  {tab === "pending" ? "Trabalho financeiro" : "Consulta"}
                </p>
                <h2>{tab === "pending" ? "Faturas abertas" : "Histórico de faturas"}</h2>
                <small className="audit-period-label">
                  {tab === "history" &&
                    `${formatShortDate(appliedInvoiceFrom)} a ${formatShortDate(appliedInvoiceTo)} · `}
                  {displayedInvoices.length}{" "}
                  {displayedInvoices.length === 1 ? "fatura" : "faturas"}
                </small>
              </div>
              <div className="billing-period-actions">
                <input
                  className="billing-search"
                  type="search"
                  value={invoiceSearch}
                  onChange={(event) => setInvoiceSearch(event.target.value)}
                  placeholder="Cliente, cão ou fatura"
                  aria-label="Buscar por cliente, cão ou número da fatura"
                />
                {tab === "history" && <>
                {!isDefaultInvoicePeriod && (
                  <button
                    type="button"
                    className="text-button muted"
                    onClick={() => void resetInvoicePeriod()}
                  >
                    Voltar aos últimos 30 dias
                  </button>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setInvoicePeriodOpen((open) => !open)}
                  aria-expanded={invoicePeriodOpen}
                >
                  {invoicePeriodOpen ? "Fechar período" : "Escolher período"}
                </button>
                </>}
              </div>
            </div>
            {tab === "history" && invoicePeriodOpen && (
              <form className="audit-period-form billing-period-form" onSubmit={applyInvoicePeriod}>
                <label className="field">
                  <span>Data inicial</span>
                  <BrazilianDateInput
                    value={invoicePeriodFrom}
                    max={invoicePeriodTo}
                    ariaLabel="Data inicial das cobranças"
                    onChange={setInvoicePeriodFrom}
                  />
                </label>
                <label className="field">
                  <span>Data final</span>
                  <BrazilianDateInput
                    value={invoicePeriodTo}
                    min={invoicePeriodFrom}
                    max={operationalToday}
                    ariaLabel="Data final das cobranças"
                    onChange={setInvoicePeriodTo}
                  />
                </label>
                <button className="primary-button" type="submit" disabled={historyLoading}>
                  {historyLoading ? "Consultando…" : "Mostrar faturas"}
                </button>
              </form>
            )}
            <div className="billing-list-tools">
              <div className="billing-status-control">
                <span className="compact-control-label">Situação</span>
                <div className="filter-chips billing-status-filters" aria-label="Filtrar cobranças por situação">
                  {(
                    tab === "history"
                      ? ([
                          ["all", "Todas"],
                          ["paid", "Pagas"],
                          ["void", "Canceladas"],
                        ] as Array<[InvoiceListStatus, string]>)
                      : ([
                          ["all", "Todas"],
                          ["overdue", "Vencidas"],
                          ["pending", "Aguardando pagamento"],
                          ["compensation", "Em compensação"],
                        ] as Array<[InvoiceListStatus, string]>)
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={invoiceStatusFilter === value ? "active" : ""}
                      aria-pressed={invoiceStatusFilter === value}
                      onClick={() => {
                        setInvoiceStatusFilter(value);
                        setSelectedMergeInvoiceIds([]);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <label className="field billing-sort-control">
                <span>Ordenar por</span>
                <select
                  value={invoiceListSort}
                  onChange={(event) =>
                    setInvoiceListSort(event.target.value as InvoiceListSort)
                  }
                >
                  <option value="priority">Situação e atualização</option>
                  <option value="customer">Cliente · A–Z</option>
                  <option value="dueDate">Data · mais próxima</option>
                </select>
              </label>
            </div>
            {tab === "pending" && <div className="invoice-merge-toolbar">
              {mergeSelectionMode ? (
                <>
                  <span>
                    {selectedMergeInvoiceIds.length
                      ? `${selectedMergeInvoiceIds.length} faturas selecionadas`
                      : "Selecione faturas abertas do mesmo cliente"}
                  </span>
                  <div>
                    <button
                      type="button"
                      className="text-button muted"
                      onClick={() => {
                        setSelectedMergeInvoiceIds([]);
                        setMergeSelectionMode(false);
                      }}
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={selectedMergeInvoiceIds.length < 2}
                      onClick={openMergeDialog}
                    >
                      Unificar selecionadas
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setMergeSelectionMode(true)}
                >
                  Unificar faturas
                </button>
              )}
            </div>}
            <div className="table-wrap">
              <table className="data-table invoices-table">
                <colgroup>
                  {mergeSelectionMode && <col className="invoice-select-column" />}
                  <col className="invoice-customer-column" />
                  <col className="invoice-items-column" />
                  <col className="invoice-value-column" />
                  <col className="invoice-status-column" />
                  <col className="invoice-delivery-column" />
                  <col className="invoice-actions-column" />
                </colgroup>
                <thead>
                  <tr>
                    {mergeSelectionMode && (
                      <th>
                        <span className="sr-only">Selecionar para unificar</span>
                      </th>
                    )}
                    <th>Cliente</th>
                    <th>Serviços</th>
                    <th>Valor</th>
                    <th>Situação e data</th>
                    <th>Compartilhamento</th>
                    <th>
                      <span className="sr-only">Ação</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {displayedInvoices.map((invoice) => {
                    const mergeEligible = invoiceCanBeMerged(invoice);
                    const mergeSelectionDisabled = !mergeEligible;
                    return (
                    <Fragment key={invoice.id}>
                    <tr>
                      {mergeSelectionMode && <td className="invoice-merge-select-cell">
                        <input
                          type="checkbox"
                          checked={selectedMergeInvoiceIds.includes(invoice.id)}
                          disabled={mergeSelectionDisabled}
                          onChange={() => toggleMergeInvoice(invoice)}
                          aria-label={`Selecionar fatura ${invoice.number} para unificar`}
                          title={
                            invoice.compensationAvailableOn
                                  ? "Faturas em compensação não podem ser unificadas."
                                  : undefined
                          }
                        />
                      </td>}
                      <td className="invoice-customer-cell">
                        <strong>{invoice.customerName}</strong>
                        <small>#{invoice.number}</small>
                      </td>
                      <td>
                        <span>{invoice.items}</span>
                      </td>
                      <td>
                        <strong>{formatCurrency(invoice.amountCents)}</strong>
                      </td>
                      <td className="invoice-status-date-cell">
                        <InvoiceStatus invoice={invoice} />
                        <small>{invoice.due}</small>
                        {invoice.followUpOn && invoice.status !== "paid" && invoice.status !== "void" && (
                          <small className={invoice.followUpOn <= operationalToday ? "follow-up-due" : ""}>
                            Lembrar em {formatShortDate(invoice.followUpOn)}
                          </small>
                        )}
                      </td>
                      <td>
                        <InvoiceDeliveryStatus invoice={invoice} compact />
                      </td>
                      <td>
                        <div className="invoice-row-actions">
                          <button
                            className="row-link"
                            onClick={() => onOpenInvoice(invoice)}
                          >
                            {invoice.compensationAvailableOn && invoice.compensationAvailableOn <= operationalToday
                              ? "Confirmar compensação"
                              : invoice.status === "overdue"
                                ? "Revisar cobrança"
                                : invoice.status === "pending"
                                  ? "Abrir"
                                  : "Ver"}
                          </button>
                          <button
                            className={`row-link subtle invoice-note-link${
                              invoice.internalNote ? " has-note" : ""
                            }`}
                            onClick={() => openInvoiceNote(invoice)}
                            title={invoice.internalNote ?? undefined}
                          >
                            {invoice.internalNote ?? (invoice.followUpOn ? "Editar lembrete" : "Nota ou lembrete")}
                          </button>
                          {invoice.status === "paid" && invoice.cashIncluded === false && (
                            <button className="row-link subtle" type="button" onClick={() => toggleCashFromList(invoice)}>
                              Fora do Caixa · restaurar
                            </button>
                          )}
                          {invoice.status === "paid" && invoice.cashIncluded !== false && invoice.cashEntryId && (
                            <details className="invoice-more-actions">
                              <summary>Mais</summary>
                              <button type="button" onClick={() => toggleCashFromList(invoice)}>
                                Retirar do Caixa
                              </button>
                            </details>
                          )}
                          {invoice.mergeId && invoice.status !== "paid" && !invoice.compensationAvailableOn && (
                            <button
                              className="row-link subtle"
                              type="button"
                              onClick={() => void onReverseInvoiceMerge(invoice)}
                            >
                              Desfazer união
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {noteEditorInvoiceId === invoice.id && (
                      <tr className="invoice-note-editor-row">
                        <td colSpan={mergeSelectionMode ? 7 : 6}>
                          <form
                            className="invoice-entry-note-editor"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void saveInvoiceNote(invoice.id);
                            }}
                          >
                            <label>
                              <span>Observação</span>
                              <input
                                autoFocus
                                value={noteDraft}
                                onChange={(event) => setNoteDraft(event.target.value)}
                                maxLength={1000}
                                placeholder="Ex.: pediu para pagar em 12/08"
                              />
                            </label>
                            <label className="invoice-follow-up-field">
                              <span>Lembrar de cobrar em</span>
                              <BrazilianDateInput
                                value={followUpDraft}
                                min={operationalToday}
                                ariaLabel="Data do lembrete da cobrança"
                                onChange={setFollowUpDraft}
                              />
                            </label>
                            <button className="text-button" type="button" onClick={() => setNoteEditorInvoiceId(null)} disabled={noteSaving}>
                              Cancelar
                            </button>
                            <button className="text-button" type="submit" disabled={noteSaving}>
                              {noteSaving ? "Salvando…" : "Salvar"}
                            </button>
                          </form>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mobile-card-list invoice-mobile-list">
              {displayedInvoices.map((invoice) => {
                const mergeEligible = invoiceCanBeMerged(invoice);
                const mergeSelectionDisabled = !mergeEligible;
                return (
                <article
                  className={`mobile-data-card invoice-${invoice.status}`}
                  key={`mobile-${invoice.id}`}
                >
                  {mergeSelectionMode && <label className="invoice-merge-select-mobile">
                    <input
                      type="checkbox"
                      checked={selectedMergeInvoiceIds.includes(invoice.id)}
                      disabled={mergeSelectionDisabled}
                      onChange={() => toggleMergeInvoice(invoice)}
                    />
                    Selecionar para unificar
                  </label>}
                  <button
                    className="mobile-card-main"
                    onClick={() => onOpenInvoice(invoice)}
                  >
                    <span className="invoice-mobile-heading">
                      <small>Fatura #{invoice.number}</small>
                      <strong>{invoice.customerName}</strong>
                    </span>
                    <InvoiceStatus invoice={invoice} />
                    <span className="invoice-mobile-items">
                      {invoice.items}
                    </span>
                    <span className="invoice-mobile-footer">
                      <span>
                        <small>{invoice.due}</small>
                        {invoice.followUpOn && invoice.status !== "paid" && invoice.status !== "void" && (
                          <small className={invoice.followUpOn <= operationalToday ? "follow-up-due" : ""}>
                            Lembrar em {formatShortDate(invoice.followUpOn)}
                          </small>
                        )}
                        <InvoiceDeliveryStatus invoice={invoice} compact />
                      </span>
                      <strong>{formatCurrency(invoice.amountCents)}</strong>
                    </span>
                  </button>
                  {invoice.status === "paid" && invoice.cashIncluded === false && (
                    <button className="cash-exception-mobile" type="button" onClick={() => toggleCashFromList(invoice)}>
                      Fora do Caixa · restaurar
                    </button>
                  )}
                  {invoice.status === "paid" && invoice.cashIncluded !== false && invoice.cashEntryId && (
                    <details className="invoice-more-actions invoice-more-mobile">
                      <summary>Mais opções</summary>
                      <button type="button" onClick={() => toggleCashFromList(invoice)}>
                        Retirar do Caixa
                      </button>
                    </details>
                  )}
                  <button
                    className={`row-link subtle invoice-note-trigger invoice-note-link${
                      invoice.internalNote ? " has-note" : ""
                    }`}
                    type="button"
                    onClick={() => openInvoiceNote(invoice)}
                    title={invoice.internalNote ?? undefined}
                  >
                    {invoice.internalNote ?? (invoice.followUpOn ? "Editar lembrete" : "Adicionar nota ou lembrete")}
                  </button>
                  {noteEditorInvoiceId === invoice.id && (
                    <form
                      className="invoice-entry-note-editor"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveInvoiceNote(invoice.id);
                      }}
                    >
                      <label>
                        <span>Observação</span>
                        <input
                          autoFocus
                          value={noteDraft}
                          onChange={(event) => setNoteDraft(event.target.value)}
                          maxLength={1000}
                          placeholder="Ex.: pediu para pagar em 12/08"
                        />
                      </label>
                      <label className="invoice-follow-up-field">
                        <span>Lembrar de cobrar em</span>
                        <BrazilianDateInput
                          value={followUpDraft}
                          min={operationalToday}
                          ariaLabel="Data do lembrete da cobrança"
                          onChange={setFollowUpDraft}
                        />
                      </label>
                      <button className="text-button" type="button" onClick={() => setNoteEditorInvoiceId(null)} disabled={noteSaving}>
                        Cancelar
                      </button>
                      <button className="text-button" type="submit" disabled={noteSaving}>
                        {noteSaving ? "Salvando…" : "Salvar"}
                      </button>
                    </form>
                  )}
                  {invoice.mergeId && invoice.status !== "paid" && !invoice.compensationAvailableOn && (
                    <button
                      className="row-link subtle invoice-unmerge-mobile"
                      type="button"
                      onClick={() => void onReverseInvoiceMerge(invoice)}
                    >
                      Desfazer união
                    </button>
                  )}
                </article>
                );
              })}
            </div>
            {!displayedInvoices.length && (
              <EmptyState
                title="Nenhuma cobrança com estes filtros"
                description="Altere a situação ou o período para consultar outras cobranças."
              />
            )}
          </section>
        </>
      )}

      {tab === "credits" && (
        <>
          <section className="panel credit-flow-panel">
            <div>
              <p className="section-kicker">Pré-pagamento seguro</p>
              <h2>Venda o pacote; libere após registrar o pagamento</h2>
              <p>
                Defina a quantidade e um valor especial. A emissão da fatura não
                muda o saldo: os créditos entram automaticamente apenas quando
                o pagamento for confirmado.
              </p>
            </div>
            <button className="primary-button" onClick={() => onAddCredits()}>
              + Vender pacote de créditos
            </button>
          </section>

          <section className="panel full-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Saldos atuais</p>
                <h2>Créditos por cliente</h2>
              </div>
              <div className="credit-balance-tools">
                <input
                  type="search"
                  value={creditSearch}
                  onChange={(event) => setCreditSearch(event.target.value)}
                  placeholder="Buscar cliente"
                  aria-label="Buscar cliente nos saldos de créditos"
                />
                <label>
                  <input
                    type="checkbox"
                    checked={showZeroCreditAccounts}
                    onChange={(event) =>
                      setShowZeroCreditAccounts(event.target.checked)
                    }
                  />
                  Mostrar saldos zerados
                </label>
              </div>
            </div>
            {renewalCandidates.length > 0 && (
              <details className="credit-renewal-panel">
                <summary>
                  <span>Próximos de renovar</span>
                  <strong>{renewalCandidates.length}</strong>
                </summary>
                <div className="credit-renewal-list">
                  {renewalCandidates.map(({ customer, serviceType, balance }) => (
                    <div key={`${customer.id}:${serviceType}`}>
                      <span>
                        <strong>{customer.name}</strong>
                        <small>{serviceLabels[serviceType]} · {balance === 0 ? "sem créditos" : "1 crédito restante"}</small>
                      </span>
                      <button className="text-button" onClick={() => onAddCredits(customer.id)}>
                        Vender pacote
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            )}
            <div className="credit-balance-grid">
              {filteredCreditCustomers.map((customer) => {
                const balance = creditBalances[customer.id] ?? {
                  daycare: 0,
                  bath: 0,
                  grooming: 0,
                  transport: 0,
                };
                return (
                  <article key={customer.id}>
                    <span>
                      <span className="avatar avatar-small avatar-neutral">
                        {customer.initials}
                      </span>
                      <strong>{customer.name}</strong>
                    </span>
                    <div className="credit-list">
                      <div>
                        <span>Creche</span>
                        <strong>{balance.daycare}</strong>
                      </div>
                      <div>
                        <span>Banho</span>
                        <strong>{balance.bath}</strong>
                      </div>
                      <div>
                        <span>Taxi-dog</span>
                        <strong>{balance.transport}</strong>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            {!filteredCreditCustomers.length && (
              <EmptyState
                title="Nenhum saldo encontrado"
                description="Ajuste a busca ou mostre também os saldos zerados."
              />
            )}
          </section>

          <section className="panel full-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Extrato de vendas</p>
                <h2>Pacotes recentes</h2>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Pacote</th>
                    <th>Sugestão da tabela</th>
                    <th>Valor cobrado</th>
                    <th>Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {creditPurchases.map((purchase) => (
                    <tr key={purchase.id}>
                      <td>
                        <strong>{purchase.customerName}</strong>
                      </td>
                      <td>
                        {purchase.units} × {serviceLabels[purchase.serviceType]}
                      </td>
                      <td>{formatCurrency(purchase.standardValueCents)}</td>
                      <td>
                        <strong>{formatCurrency(purchase.amountCents)}</strong>
                      </td>
                      <td>
                        <span
                          className={`status-pill ${
                            purchase.status === "paid"
                              ? "success"
                              : purchase.status === "awaiting_payment"
                                ? "pending"
                                : "neutral"
                          }`}
                        >
                          {purchase.status === "paid"
                            ? "Liberado"
                            : purchase.status === "awaiting_payment"
                              ? "Fatura pendente"
                              : "Cancelado"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {tab === "credits" && (
        <section className="panel full-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Sem nova cobrança</p>
              <h2>Recibos de serviços quitados com crédito</h2>
            </div>
          </div>
          {receipts.length ? (
            <div className="receipt-list">
              {receipts.map((receipt) => (
                <button
                  key={receipt.id}
                  onClick={() => onOpenReceipt(receipt)}
                >
                  <span>
                    <strong>
                      {receipt.dogName} · {receipt.service}
                    </strong>
                    <small>
                      {receipt.customerName} · {receipt.date} · {receipt.number}
                    </small>
                  </span>
                  <span className="status-pill success">
                    {receipt.deliveryStatus === "sent"
                      ? "Compartilhado"
                      : "Pronto"}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Nenhum recibo"
              description="Recibos aparecem quando um atendimento é concluído usando crédito."
            />
          )}
        </section>
      )}

      {tab === "pending" && selectedBillables.length > 0 && (
        <div className="selection-bar">
          <span>
            <strong>
              {selectedBillables.length}{" "}
              {selectedBillables.length === 1
                ? "serviço selecionado"
                : "serviços selecionados"}
            </strong>
            <small>{formatCurrency(selectedTotal)}</small>
          </span>
          <button className="primary-button" onClick={onCreateInvoice}>
            Criar fatura
          </button>
        </div>
      )}

      {mergeDialogOpen && (
        <Dialog
          title="Unificar faturas"
          description="Confira as faturas e o vencimento. A operação poderá ser desfeita enquanto a nova fatura não tiver pagamento ou compensação."
          onClose={() => setMergeDialogOpen(false)}
          size="small"
        >
          <form className="form-grid" onSubmit={submitInvoiceMerge}>
            <div className="invoice-merge-review full">
              {selectedMergeInvoices.map((invoice) => (
                <div key={invoice.id}>
                  <span>
                    <strong>#{invoice.number}</strong>
                    <small>{invoice.items}</small>
                  </span>
                  <strong>{formatCurrency(invoice.amountCents)}</strong>
                </div>
              ))}
              <div className="invoice-merge-total">
                <span>Total da nova fatura</span>
                <strong>{formatCurrency(mergeTotalCents)}</strong>
              </div>
            </div>
            <label className="field full">
              <span>Vencimento da nova fatura *</span>
              <BrazilianDateInput
                value={mergeDueDate}
                ariaLabel="Vencimento da fatura unificada"
                onChange={setMergeDueDate}
              />
              <small>Por segurança, sugerimos o vencimento mais próximo.</small>
            </label>
            {(mergeHasDifferentDueDates || mergeHasLodgingMilestones) && (
              <div className="form-warning full">
                {mergeHasDifferentDueDates && (
                  <p>As faturas têm vencimentos diferentes. Confira a data antes de continuar.</p>
                )}
                {mergeHasLodgingMilestones && (
                  <p>Esta seleção inclui sinal ou saldo de hospedagem. Confirme se deseja reuni-los no mesmo momento de cobrança.</p>
                )}
              </div>
            )}
            <div className="credit-safety-note full">
              <strong>Proteção financeira</strong>
              <span>
                As faturas originais serão guardadas e poderão ser restauradas
                por “Desfazer união”. Créditos serão liberados somente quando
                a nova fatura for paga; valores em compensação não entram nesta operação.
              </span>
            </div>
            <div className="dialog-actions full">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setMergeDialogOpen(false)}
                disabled={mergeBusy}
              >
                Cancelar
              </button>
              <button className="primary-button" type="submit" disabled={mergeBusy}>
                {mergeBusy ? "Unificando…" : "Confirmar união"}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {bulkMergeDialogOpen && (
        <Dialog
          title="Consolidar faturas abertas"
          description="Será criada uma fatura por cliente, reunindo todas as cobranças abertas elegíveis. Cada cliente é processado separadamente e cada união pode ser desfeita antes do pagamento."
          onClose={() => !mergeBusy && setBulkMergeDialogOpen(false)}
          size="small"
        >
          <div className="invoice-merge-review">
            {bulkMergeGroups.map((group) => (
              <div key={group[0].customerId}>
                <span>
                  <strong>{group[0].customerName}</strong>
                  <small>{group.length} faturas</small>
                </span>
                <strong>{formatCurrency(group.reduce((total, invoice) => total + invoice.amountCents, 0))}</strong>
              </div>
            ))}
          </div>
          <div className="credit-safety-note">
            <strong>Operação reversível</strong>
            <span>Faturas pagas, em compensação, sinais e saldos de hospedagem permanecem intocados. O vencimento mais próximo de cada cliente será preservado.</span>
          </div>
          {bulkMergeProgress && <p className="form-feedback">{bulkMergeProgress}</p>}
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={() => setBulkMergeDialogOpen(false)} disabled={mergeBusy}>
              Cancelar
            </button>
            <button className="primary-button" type="button" onClick={() => void submitBulkInvoiceMerge()} disabled={mergeBusy}>
              {mergeBusy ? "Consolidando…" : `Consolidar ${bulkMergeGroups.length} clientes`}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function SettingsView({
  prices,
  lodgingPricing,
  creditPricing,
  groomingAddonPriceCents,
  daycareStartTime,
  daycareEndTime,
  onSave,
}: {
  prices: Record<ServiceType, number>;
  lodgingPricing: LodgingPricing;
  creditPricing: CreditPricingSettings;
  groomingAddonPriceCents: number;
  daycareStartTime: string;
  daycareEndTime: string;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const moneyInput = (
    name: string,
    title: string,
    cents: number,
    note: string,
  ) => (
    <label className="price-setting-card" key={name}>
      <span><strong>{title}</strong><small>{note}</small></span>
      <span className="currency-input">
        <span>R$</span>
        <input name={name} type="number" min="0.01" step="0.01" defaultValue={(cents / 100).toFixed(2)} required />
      </span>
    </label>
  );

  return (
    <div className="settings-page">
      <section className="panel settings-intro">
        <span className="settings-lock" aria-hidden="true">
          ADM
        </span>
        <div>
          <p className="section-kicker">Acesso de administrador</p>
          <h2>Tabela de preços</h2>
          <p>
            Valores avulsos, hospedagem e pacotes estão separados por assunto.
            As sugestões podem ser ajustadas no momento da cobrança sem alterar esta tabela.
          </p>
        </div>
      </section>

      <form className="panel settings-form" onSubmit={onSave}>
        <div className="panel-heading">
          <div><p className="section-kicker">Serviços</p><h2>Valores avulsos</h2></div>
          <span className="invoice-only-badge">Valores em reais</span>
        </div>
        <div className="price-settings-grid">
          {moneyInput("daycare", "Creche avulsa", prices.daycare, "por diária")}
          {moneyInput("bath", "Banho avulso", prices.bath, "por serviço")}
          {moneyInput(
            "bathGroomingAddon",
            "Tosa junto ao banho",
            groomingAddonPriceCents,
            "valor adicional ao banho",
          )}
        </div>
        <section className="lodging-pricing-settings">
          <div>
            <p className="section-kicker">Hospedagem</p>
            <h3>Diárias por condição</h3>
            <span>
              A condição é escolhida em cada reserva; os valores abaixo são o padrão.
            </span>
          </div>
          <div className="price-settings-grid">
            {[
              ["hotelStandardDailyRate", "Diária padrão", lodgingPricing.standardDailyRateCents],
              ["hotelDaycareDailyRate", "Cliente de creche", lodgingPricing.daycareDailyRateCents],
              ["hotelAdditionalDogDailyRate", "Segundo cão ou mais", lodgingPricing.additionalDogDailyRateCents],
              ["hotelDaycareAdditionalDogDailyRate", "Creche · segundo cão ou mais", lodgingPricing.daycareAdditionalDogDailyRateCents],
            ].map(([name, title, cents]) => (
              <label className="price-setting-card" key={String(name)}>
                <span><strong>{title}</strong><small>por diária</small></span>
                <span className="currency-input"><span>R$</span><input name={String(name)} type="number" min="0.01" step="0.01" defaultValue={(Number(cents) / 100).toFixed(2)} required /></span>
              </label>
            ))}
            <label className="price-setting-card">
              <span><strong>Longa estadia</strong><small>Aplicado a partir de 10 diárias.</small></span>
              <span className="currency-input"><input name="hotelLongStayDiscountPercent" type="number" min="0" max="99" step="1" defaultValue={lodgingPricing.longStayDiscountPercent} required /><span>%</span></span>
            </label>
          </div>
        </section>
        <section className="settings-group">
          <div className="settings-group-heading">
            <div><p className="section-kicker">Pacotes</p><h3>Créditos de creche</h3></div>
            <span>Valor por crédito conforme a quantidade</span>
          </div>
          <div className="price-settings-grid">
            {moneyInput("daycareUnder4Unit", "1 a 3 créditos", creditPricing.daycareUnder4UnitCents, "por crédito")}
            {moneyInput("daycare4To7Unit", "4 a 7 créditos", creditPricing.daycare4To7UnitCents, "por crédito")}
            {moneyInput("daycare8To11Unit", "8 a 11 créditos", creditPricing.daycare8To11UnitCents, "por crédito")}
            {moneyInput("daycare12PlusUnit", "12 créditos ou mais", creditPricing.daycare12PlusUnitCents, "por crédito")}
            <label className="price-setting-card">
              <span><strong>Dois ou mais cães</strong><small>desconto em todas as faixas</small></span>
              <span className="currency-input"><input name="daycareMultiDogDiscountPercent" type="number" min="0" max="99" step="1" defaultValue={creditPricing.daycareMultiDogDiscountPercent} required /><span>%</span></span>
            </label>
          </div>
        </section>
        <section className="settings-group">
          <div className="settings-group-heading">
            <div><p className="section-kicker">Pacotes</p><h3>Créditos de banho</h3></div>
            <span>Banho e tosa não utiliza créditos</span>
          </div>
          <div className="price-settings-grid">
            {moneyInput("bathUnder4RegularUnit", "1 a 3 · cliente regular", creditPricing.bathUnder4RegularUnitCents, "por crédito")}
            {moneyInput("bathUnder4DaycareUnit", "1 a 3 · cliente de creche", creditPricing.bathUnder4DaycareUnitCents, "por crédito")}
            {moneyInput("bath4PlusRegularUnit", "4 ou mais · cliente regular", creditPricing.bath4PlusRegularUnitCents, "por crédito")}
            {moneyInput("bath4PlusDaycareUnit", "4 ou mais · cliente de creche", creditPricing.bath4PlusDaycareUnitCents, "por crédito")}
          </div>
        </section>
        <section className="settings-group">
          <div className="settings-group-heading">
            <div><p className="section-kicker">Taxi-dog</p><h3>Distância curta e longa</h3></div>
            <span>Uma ida consome 1 crédito; ida e volta consome 2</span>
          </div>
          <div className="price-settings-grid">
            {moneyInput("taxiDogShortUnit", "Distância curta", creditPricing.taxiDogShortUnitCents, "por ida ou crédito")}
            {moneyInput("taxiDogLongUnit", "Distância longa", creditPricing.taxiDogLongUnitCents, "por ida ou crédito")}
          </div>
          <p className="compact-help">Na cobrança regular, ida e volta usa automaticamente o dobro do valor de uma ida.</p>
        </section>
        <div className="daycare-hours-settings">
          <div>
            <p className="section-kicker">Horário padrão da creche</p>
            <h3>Entrada e saída sugeridas</h3>
            <span>
              Estes horários poderão ser ajustados em cada atendimento.
            </span>
          </div>
          <label className="field">
            <span>Entrada</span>
            <input
              name="daycareStartTime"
              type="time"
              defaultValue={daycareStartTime}
              required
            />
          </label>
          <label className="field">
            <span>Saída</span>
            <input
              name="daycareEndTime"
              type="time"
              defaultValue={daycareEndTime}
              required
            />
          </label>
        </div>
        <div className="manual-download">
          <span>
            <strong>Manual dos administradores</strong>
            Aprenda o essencial primeiro e avance no seu ritmo.
          </span>
          <a
            className="secondary-button"
            href="/manual-hospet-quintal.pdf"
            download
          >
            Baixar manual
          </a>
        </div>
        <div className="settings-actions">
          <span>
            A alteração vale para novas sugestões. Lançamentos já salvos mantêm o valor original.
          </span>
          <button className="primary-button" type="submit">
            Salvar configurações
          </button>
        </div>
      </form>
    </div>
  );
}

function InvoiceStatus({ invoice }: { invoice: Invoice }) {
  if (invoice.status === "void") {
    return <span className="status-pill neutral">Cancelada</span>;
  }
  if (invoice.status === "paid") {
    return <span className="status-pill success">Pago</span>;
  }
  if (invoice.compensationAvailableOn) {
    return invoice.compensationAvailableOn < operationalToday ? (
      <span className="status-pill overdue">Compensação atrasada</span>
    ) : (
      <span className="status-pill compensation">Em compensação</span>
    );
  }
  if (invoice.status === "overdue") {
    return <span className="status-pill overdue">Vencido</span>;
  }
  return <span className="status-pill pending">Aguardando pagamento</span>;
}

function InvoiceDeliveryStatus({
  invoice,
  compact = false,
}: {
  invoice: Invoice;
  compact?: boolean;
}) {
  const channels = invoice.sentBy ?? [];
  if (!channels.length) {
    return compact ? (
      <span className="invoice-delivery-state not-sent">Não compartilhada</span>
    ) : (
      <span className="invoice-delivery-empty">—</span>
    );
  }
  return (
    <span className={`invoice-delivery-state${compact ? " compact" : ""}`}>
      {channels.map((channel) => {
        const detailedLabel =
          channel === "whatsapp"
            ? "WhatsApp aberto"
            : "E-mail preparado";
        return (
          <span
            className={`delivery-channel ${channel}`}
            key={channel}
            title={detailedLabel}
            aria-label={detailedLabel}
          >
            {compact ? (channel === "whatsapp" ? "WhatsApp" : "E-mail") : detailedLabel}
          </span>
        );
      })}
    </span>
  );
}

function ActivityView({
  activities,
  onLoadPeriod,
}: {
  activities: AuditActivity[];
  onLoadPeriod: (
    from: string,
    to: string,
  ) => Promise<{ activities: AuditActivity[]; truncated: boolean } | null>;
}) {
  const defaultFrom = shiftDate(operationalToday, -4);
  const [customActivities, setCustomActivities] = useState<AuditActivity[]>([]);
  const [periodFrom, setPeriodFrom] = useState(defaultFrom);
  const [periodTo, setPeriodTo] = useState(operationalToday);
  const [appliedFrom, setAppliedFrom] = useState(defaultFrom);
  const [appliedTo, setAppliedTo] = useState(operationalToday);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [periodLoading, setPeriodLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);

  async function submitPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!periodFrom || !periodTo || periodTo < periodFrom) return;
    setPeriodLoading(true);
    const result = await onLoadPeriod(periodFrom, periodTo);
    setPeriodLoading(false);
    if (!result) return;
    setCustomActivities(result.activities);
    setTruncated(result.truncated);
    setAppliedFrom(periodFrom);
    setAppliedTo(periodTo);
    setPeriodOpen(false);
  }

  const defaultPeriod =
    appliedFrom === defaultFrom && appliedTo === operationalToday;
  const displayedActivities = defaultPeriod ? activities : customActivities;
  return (
    <section className="panel full-panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">
            {defaultPeriod ? "Últimos 5 dias" : "Período consultado"}
          </p>
          <h2>Registro de atividades</h2>
          <small className="audit-period-label">
            {formatShortDate(appliedFrom)} a {formatShortDate(appliedTo)}
          </small>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => setPeriodOpen((open) => !open)}
          aria-expanded={periodOpen}
        >
          {periodOpen ? "Fechar período" : "Consultar outro período"}
        </button>
      </div>
      {periodOpen && (
        <form className="audit-period-form" onSubmit={submitPeriod}>
          <label className="field">
            <span>Data inicial</span>
            <BrazilianDateInput
              value={periodFrom}
              max={periodTo}
              ariaLabel="Data inicial do histórico"
              onChange={setPeriodFrom}
            />
          </label>
          <label className="field">
            <span>Data final</span>
            <BrazilianDateInput
              value={periodTo}
              min={periodFrom}
              max={operationalToday}
              ariaLabel="Data final do histórico"
              onChange={setPeriodTo}
            />
          </label>
          <button className="primary-button" type="submit" disabled={periodLoading}>
            {periodLoading ? "Consultando…" : "Mostrar atividades"}
          </button>
        </form>
      )}
      {truncated && (
        <p className="audit-limit-note">
          O período possui muitos registros. Foram mostradas as 1.000 atividades mais recentes.
        </p>
      )}
      {displayedActivities.length ? (
        <div className="audit-list">
          {displayedActivities.map((event) => (
            <div className="audit-row" key={event.id}>
              <span className="audit-time">{event.time}</span>
              <span className="audit-line" aria-hidden="true" />
              <span>
                <strong>{event.action}</strong>
                <small>{event.detail}</small>
                <em>{event.actor}</em>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Nenhuma atividade neste período"
          description="Escolha outro intervalo para consultar registros anteriores."
        />
      )}
      <div className="audit-note">
        <strong>Como a trilha funciona</strong>
        <p>
          Ações financeiras, cancelamentos, permissões e arquivos geram eventos
          imutáveis. Conteúdo financeiro sensível não entra nos
          registros.
        </p>
      </div>
    </section>
  );
}

type CustomerRequestRow = {
  id: string;
  type: "service" | "cancellation" | "profile_update";
  status: "pending" | "approved" | "rejected" | "cancelled";
  customerName: string;
  dogName: string | null;
  serviceName: string | null;
  requestedDate: string | null;
  requestedEndDate: string | null;
  notes: string | null;
  createdAt: string;
};

function CustomerRequestsView() {
  const [requests, setRequests] = useState<CustomerRequestRow[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const payload = await requestJson<{ requests: CustomerRequestRow[] }>(
        "/api/customer-requests",
      );
      setRequests(payload.requests);
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível carregar os pedidos.",
      );
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function review(
    request: CustomerRequestRow,
    status: "approved" | "rejected",
  ) {
    if (busy) return;
    const responseNote =
      status === "rejected"
        ? window.prompt(
            "Escreva uma explicação breve para o cliente (opcional):",
          )
        : null;
    setBusy(request.id);
    try {
      await requestJson(`/api/customer-requests/${request.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status, responseNote }),
      });
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível analisar o pedido.",
      );
    } finally {
      setBusy("");
    }
  }

  const pending = requests.filter((request) => request.status === "pending");
  const reviewed = requests.filter((request) => request.status !== "pending");
  return (
    <section className="panel full-panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Aguardando análise</p>
          <h2>Pedidos dos clientes</h2>
        </div>
        <span className="count-badge">{pending.length}</span>
      </div>
      {error && <p className="form-error">{error}</p>}
      {pending.length ? (
        <div className="request-review-list">
          {pending.map((request) => (
            <article className="request-review-row" key={request.id}>
              <div>
                <strong>
                  {request.type === "cancellation"
                    ? "Cancelamento solicitado"
                    : "Novo serviço solicitado"}
                </strong>
                <p>
                  {request.customerName}
                  {request.dogName ? ` · ${request.dogName}` : ""}
                  {request.serviceName ? ` · ${request.serviceName}` : ""}
                </p>
                {request.requestedDate && (
                  <small>
                    {formatSelectedDate(request.requestedDate)}
                    {request.requestedEndDate
                      ? ` a ${formatSelectedDate(request.requestedEndDate)}`
                      : ""}
                  </small>
                )}
                {request.notes && <em>{request.notes}</em>}
              </div>
              <div className="access-actions">
                <button
                  className="secondary-button"
                  disabled={busy === request.id}
                  onClick={() => void review(request, "rejected")}
                >
                  Não aprovar
                </button>
                <button
                  className="primary-button"
                  disabled={busy === request.id}
                  onClick={() => void review(request, "approved")}
                >
                  Aprovar
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Tudo analisado"
          description="Não há pedidos de clientes aguardando sua decisão."
        />
      )}
      {reviewed.length > 0 && (
        <details className="reviewed-requests">
          <summary>Ver pedidos já analisados ({reviewed.length})</summary>
          {reviewed.slice(0, 50).map((request) => (
            <p key={request.id}>
              <strong>{request.customerName}</strong> ·{" "}
              {request.status === "approved" ? "aprovado" : "não aprovado"}
            </p>
          ))}
        </details>
      )}
      <div className="audit-note">
        <strong>Aprovar não altera a agenda automaticamente</strong>
        <p>
          Depois de conferir disponibilidade, crie o serviço na agenda. Isso
          evita reservas automáticas em horários ou datas incompatíveis.
        </p>
      </div>
    </section>
  );
}

type AccessUser = {
  id: string;
  email: string;
  displayName: string;
  role: "owner" | "staff" | "finance" | "customer";
  status: "active" | "disabled" | "invited";
};

type AccessInvitation = {
  id: string;
  email: string;
  role: "staff" | "customer";
  customerName: string | null;
  status: "pending" | "accepted" | "revoked" | "expired";
  deliveryStatus: "pending" | "sent" | "failed" | "manual";
  expiresAt: string;
};

function AccessView({ customers }: { customers: Customer[] }) {
  const [users, setUsers] = useState<AccessUser[]>([]);
  const [invitations, setInvitations] = useState<AccessInvitation[]>([]);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [recoveryLinks, setRecoveryLinks] = useState<Record<string, string>>(
    {},
  );
  const [inviteRole, setInviteRole] = useState<"staff" | "customer">("staff");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const payload = await requestJson<{
        users: AccessUser[];
        invitations: AccessInvitation[];
        emailConfigured: boolean;
      }>("/api/users");
      setUsers(payload.users);
      setInvitations(payload.invitations);
      setEmailConfigured(payload.emailConfigured);
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível carregar os acessos.",
      );
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const role = String(form.get("role") ?? "");
    setBusy("invite");
    setNotice("");
    setError("");
    try {
      const payload = await requestJson<{
        invitation: AccessInvitation & { inviteUrl: string };
      }>("/api/users", {
        method: "POST",
        body: JSON.stringify({
          email: String(form.get("email") ?? ""),
          role,
          accountId:
            role === "customer"
              ? String(form.get("accountId") ?? "")
              : undefined,
        }),
      });
      setLinks((current) => ({
        ...current,
        [payload.invitation.id]: payload.invitation.inviteUrl,
      }));
      setNotice(
        payload.invitation.deliveryStatus === "sent"
          ? "Convite enviado por e-mail."
          : "Convite criado. Copie o link seguro abaixo e envie à pessoa.",
      );
      formElement.reset();
      setInviteRole("staff");
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Não foi possível convidar.",
      );
    } finally {
      setBusy("");
    }
  }

  async function changeUser(user: AccessUser) {
    if (busy) return;
    const nextStatus = user.status === "active" ? "disabled" : "active";
    setBusy(user.id);
    setError("");
    try {
      await requestJson(`/api/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      setNotice(
        nextStatus === "active" ? "Acesso reativado." : "Acesso encerrado.",
      );
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível alterar o acesso.",
      );
    } finally {
      setBusy("");
    }
  }

  async function createPasswordReset(user: AccessUser) {
    if (busy || user.status !== "active") return;
    setBusy(`reset-${user.id}`);
    setNotice("");
    setError("");
    try {
      const payload = await requestJson<{
        passwordReset: {
          resetUrl: string;
          deliveryStatus: "sent" | "manual" | "failed";
        };
      }>(`/api/users/${user.id}/password-reset`, { method: "POST" });
      setRecoveryLinks((current) => ({
        ...current,
        [user.id]: payload.passwordReset.resetUrl,
      }));
      setNotice(
        payload.passwordReset.deliveryStatus === "sent"
          ? `Recuperação enviada para ${user.email}.`
          : "Link de recuperação criado. Copie-o e envie em particular; ele vale por 1 hora.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível gerar a recuperação.",
      );
    } finally {
      setBusy("");
    }
  }

  async function changeInvitation(
    invitation: AccessInvitation,
    action: "resend" | "revoke",
  ) {
    if (busy) return;
    setBusy(invitation.id);
    setError("");
    try {
      const payload = await requestJson<{
        invitation?: { inviteUrl?: string; deliveryStatus?: string };
      }>(`/api/users/invitations/${invitation.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      if (payload.invitation?.inviteUrl) {
        setLinks((current) => ({
          ...current,
          [invitation.id]: payload.invitation!.inviteUrl!,
        }));
      }
      setNotice(
        action === "revoke"
          ? "Convite cancelado."
          : payload.invitation?.deliveryStatus === "sent"
            ? "Novo convite enviado."
            : "Novo link seguro criado.",
      );
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível alterar o convite.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="access-layout">
      <section className="panel access-invite-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Novo acesso</p>
            <h2>Convidar uma pessoa</h2>
          </div>
        </div>
        {!emailConfigured && (
          <div className="access-warning">
            O envio automático por e-mail ainda não está configurado. O sistema
            criará um link seguro para você compartilhar.
          </div>
        )}
        <form className="form-grid" onSubmit={invite}>
          <label className="field full">
            <span>Tipo de conta</span>
            <select
              name="role"
              value={inviteRole}
              onChange={(event) =>
                setInviteRole(event.target.value as "staff" | "customer")
              }
            >
              <option value="staff">Funcionário</option>
              <option value="customer">Cliente</option>
            </select>
          </label>
          <label className="field full">
            <span>E-mail da pessoa</span>
            <input
              name="email"
              type="email"
              autoComplete="off"
              maxLength={254}
              required
            />
          </label>
          {inviteRole === "customer" && (
            <label className="field full">
              <span>Cadastro do cliente</span>
              <select name="accountId" defaultValue="" required>
                <option value="" disabled>
                  Selecione o cliente
                </option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && <p className="form-error full">{error}</p>}
          {notice && <p className="access-success full">{notice}</p>}
          <div className="dialog-actions full">
            <button className="primary-button" disabled={busy === "invite"}>
              {busy === "invite" ? "Criando…" : "Criar convite"}
            </button>
          </div>
        </form>
      </section>

      <section className="panel access-people-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Contas</p>
            <h2>Quem pode entrar</h2>
          </div>
          <span className="count-badge">{users.length}</span>
        </div>
        <div className="access-list">
          {users.map((user) => (
            <div className="access-row" key={user.id}>
              <span className="avatar avatar-forest">
                {initials(user.displayName)}
              </span>
              <span>
                <strong>{user.displayName}</strong>
                <small>{user.email}</small>
                <em>
                  {user.role === "owner"
                    ? "Administrador"
                    : user.role === "customer"
                      ? "Cliente"
                      : "Funcionário"}{" "}
                  · {user.status === "active" ? "ativo" : "desativado"}
                </em>
              </span>
              <div className="access-actions">
                {recoveryLinks[user.id] && (
                  <button
                    className="secondary-button"
                    onClick={() => {
                      void navigator.clipboard.writeText(
                        recoveryLinks[user.id],
                      );
                      setNotice("Link de recuperação copiado.");
                    }}
                  >
                    Copiar recuperação
                  </button>
                )}
                {user.status === "active" && (
                  <button
                    className="text-button"
                    disabled={busy === `reset-${user.id}`}
                    onClick={() => void createPasswordReset(user)}
                  >
                    Redefinir senha
                  </button>
                )}
                {user.role !== "owner" && (
                  <button
                    className="text-button"
                    disabled={busy === user.id}
                    onClick={() => void changeUser(user)}
                  >
                    {user.status === "active"
                      ? "Encerrar acesso"
                      : "Reativar"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel full-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Convites</p>
            <h2>Envios recentes</h2>
          </div>
        </div>
        <div className="access-list">
          {invitations.length ? (
            invitations.map((invitation) => (
              <div className="access-row invitation-row" key={invitation.id}>
                <span>
                  <strong>{invitation.email}</strong>
                  <small>
                    {invitation.role === "customer"
                      ? `Cliente${invitation.customerName ? ` · ${invitation.customerName}` : ""}`
                      : "Funcionário"}
                  </small>
                  <em>
                    {invitation.status === "pending"
                      ? "Aguardando cadastro"
                      : invitation.status === "accepted"
                        ? "Aceito"
                        : invitation.status === "expired"
                          ? "Expirado"
                          : "Cancelado"}
                  </em>
                </span>
                <div className="access-actions">
                  {links[invitation.id] && (
                    <button
                      className="secondary-button"
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          links[invitation.id],
                        );
                        setNotice("Link copiado.");
                      }}
                    >
                      Copiar link
                    </button>
                  )}
                  {invitation.status === "pending" && (
                    <>
                      <button
                        className="text-button"
                        onClick={() =>
                          void changeInvitation(invitation, "resend")
                        }
                      >
                        Reenviar
                      </button>
                      <button
                        className="text-button danger"
                        onClick={() =>
                          void changeInvitation(invitation, "revoke")
                        }
                      >
                        Cancelar
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          ) : (
            <EmptyState
              title="Nenhum convite ainda"
              description="Os convites criados aparecerão aqui."
            />
          )}
        </div>
      </section>
    </div>
  );
}

function RegularBillingDialog({
  service,
  creditPricing,
  lodgingPricing,
  suggestedLodgingProfile,
  busy,
  onClose,
  onSubmit,
}: {
  service: BillableService;
  creditPricing: CreditPricingSettings;
  lodgingPricing: LodgingPricing;
  suggestedLodgingProfile: LodgingRateProfile;
  busy: boolean;
  onClose: () => void;
  onSubmit: (
    amountCents: number,
    pricingProfile?: string,
  ) => boolean | Promise<boolean>;
}) {
  const [taxiDistance, setTaxiDistance] = useState<TaxiDogDistance>(
    service.billingPricingProfile === "taxi_long" ? "long" : "short",
  );
  const taxiDirection = service.transportDirection ?? "one_way";
  const taxiSuggestedCents = taxiDogRegularCents(
    creditPricing,
    taxiDistance,
    taxiDirection,
  );
  const isDeferredLodging =
    service.serviceType === "hotel" && !service.lodging?.depositPercent;
  const initialLodgingProfile =
    (service.lodging?.rateProfile as LodgingRateProfile | undefined) ??
    suggestedLodgingProfile;
  const [lodgingDaycareCustomer, setLodgingDaycareCustomer] = useState(
    initialLodgingProfile === "daycare" ||
      initialLodgingProfile === "daycare_additional_dog",
  );
  const [lodgingAdditionalDog, setLodgingAdditionalDog] = useState(
    initialLodgingProfile === "additional_dog" ||
      initialLodgingProfile === "daycare_additional_dog",
  );
  const currentLodgingProfile = lodgingRateProfile(
    lodgingDaycareCustomer,
    lodgingAdditionalDog,
  );
  const lodgingSuggestedCents = service.lodging
    ? Math.round(
        lodgingDailyRate(lodgingPricing, currentLodgingProfile) *
          service.lodging.nights,
      )
    : 0;
  const [amount, setAmount] = useState(
    ((service.serviceType === "transport"
      ? taxiDogRegularCents(
          creditPricing,
          service.billingPricingProfile === "taxi_long" ? "long" : "short",
          taxiDirection,
        )
      : isDeferredLodging
        ? Math.round(
            lodgingDailyRate(lodgingPricing, initialLodgingProfile) *
              (service.lodging?.nights ?? 1),
          )
        : regularBillingAmountCents(service)) / 100).toFixed(2),
  );
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountCents = Math.round(Number(amount.replace(",", ".")) * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
      setError("Informe um valor maior que zero.");
      return;
    }
    setError("");
    await onSubmit(
      amountCents,
      service.serviceType === "transport"
        ? `taxi_${taxiDistance}`
        : isDeferredLodging
          ? `lodging_${currentLodgingProfile}`
          : undefined,
    );
  }

  return (
    <Dialog
      title="Cobrança regular"
      description="Confirme o valor antes de incluir este serviço na próxima fatura."
      onClose={onClose}
      size="small"
    >
      <form className="form-grid" onSubmit={submit}>
        <div className="regular-billing-summary full">
          <strong>{service.dogName} · {service.service}</strong>
          <span>{service.customerName} · {service.date}</span>
          {service.lodging && (
            <small>
              Check-in {formatBrazilianDate(service.lodging.checkInDate)} · check-out {formatBrazilianDate(service.lodging.checkOutDate)} · {service.lodging.nights} diárias
            </small>
          )}
        </div>
        {service.serviceType === "transport" && (
          <fieldset className="choice-fieldset full">
            <legend>Distância *</legend>
            <div className="compact-choice-grid">
              {(["short", "long"] as const).map((distance) => {
                const suggested = taxiDogRegularCents(
                  creditPricing,
                  distance,
                  taxiDirection,
                );
                return (
                  <label className="radio-option" key={distance}>
                    <input
                      type="radio"
                      name="taxiDistance"
                      value={distance}
                      checked={taxiDistance === distance}
                      onChange={() => {
                        setTaxiDistance(distance);
                        setAmount((suggested / 100).toFixed(2));
                      }}
                    />
                    <span>
                      <strong>
                        {distance === "short" ? "Distância curta" : "Distância longa"}
                      </strong>
                      <small>{formatCurrency(suggested)} · {taxiDirection === "round_trip" ? "ida e volta" : "ida"}</small>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}
        {isDeferredLodging && (
          <fieldset className="lodging-rate-options full">
            <legend>Condição da diária *</legend>
            <label className="check-field">
              <input
                type="checkbox"
                checked={lodgingDaycareCustomer}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setLodgingDaycareCustomer(checked);
                  const profile = lodgingRateProfile(
                    checked,
                    lodgingAdditionalDog,
                  );
                  setAmount(
                    ((lodgingDailyRate(lodgingPricing, profile) *
                      (service.lodging?.nights ?? 1)) /
                      100).toFixed(2),
                  );
                }}
              />
              <span>Cliente de creche regular</span>
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={lodgingAdditionalDog}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setLodgingAdditionalDog(checked);
                  const profile = lodgingRateProfile(
                    lodgingDaycareCustomer,
                    checked,
                  );
                  setAmount(
                    ((lodgingDailyRate(lodgingPricing, profile) *
                      (service.lodging?.nights ?? 1)) /
                      100).toFixed(2),
                  );
                }}
              />
              <span>Segundo cão ou mais nesta reserva</span>
            </label>
            <small className="field-help">
              {lodgingRateLabel(currentLodgingProfile)}: {formatCurrency(
                lodgingDailyRate(lodgingPricing, currentLodgingProfile),
              )} por diária · total sugerido {formatCurrency(lodgingSuggestedCents)}.
            </small>
          </fieldset>
        )}
        <label className="field full">
          <span>{service.lodging ? "Valor total da hospedagem (R$)" : "Valor do serviço (R$)"}</span>
          <input
            name="amount"
            type="number"
            min="0.01"
            max="1000000"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            required
          />
          {service.serviceType === "transport" && (
            <small>Sugestão pela tabela: {formatCurrency(taxiSuggestedCents)}</small>
          )}
          {isDeferredLodging && (
            <small>
              Sugestão pela condição escolhida: {formatCurrency(lodgingSuggestedCents)}.
              O valor pode ser ajustado antes de confirmar.
            </small>
          )}
        </label>
        {error && <p className="form-error full">{error}</p>}
        <p className="compact-help full">
          Isto apenas prepara o serviço para faturamento. O pagamento será registrado depois, na fatura.
        </p>
        <div className="dialog-actions full">
          <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>
            Voltar
          </button>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Salvando…" : "Confirmar e incluir"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function CreditPackageDialog({
  customers,
  initialCustomerId,
  creditPricing,
  onClose,
  onSubmit,
}: {
  customers: Customer[];
  initialCustomerId: string;
  creditPricing: CreditPricingSettings;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const firstCustomerId = initialCustomerId || customers[0]?.id || "";
  const initialCustomer = customers.find((item) => item.id === firstCustomerId);
  const [customerId, setCustomerId] = useState(firstCustomerId);
  const [serviceType, setServiceType] =
    useState<ActiveCreditServiceType>("daycare");
  const [units, setUnits] = useState(4);
  const [multiDog, setMultiDog] = useState(
    (initialCustomer?.dogIds.length ?? 0) >= 2,
  );
  const [daycareCustomer, setDaycareCustomer] = useState(true);
  const [taxiDistance, setTaxiDistance] = useState<TaxiDogDistance>("short");
  const initialContext: CreditPricingContext = {
    multiDog: (initialCustomer?.dogIds.length ?? 0) >= 2,
    daycareCustomer: true,
    taxiDistance: "short",
  };
  const [packagePrice, setPackagePrice] = useState(
    (suggestedCreditTotalCents(
      creditPricing,
      "daycare",
      4,
      initialContext,
    ) / 100).toFixed(2),
  );
  const context: CreditPricingContext = {
    multiDog,
    daycareCustomer,
    taxiDistance,
  };
  const suggestedUnitPriceCents = suggestedCreditUnitCents(
    creditPricing,
    serviceType,
    units,
    context,
  );
  const standardValueCents = suggestedCreditTotalCents(
    creditPricing,
    serviceType,
    units,
    context,
  );
  const packageValueCents = Math.max(
    0,
    Math.round(Number(packagePrice || 0) * 100),
  );
  const differenceCents = standardValueCents - packageValueCents;

  function updateSuggestedPrice(
    nextServiceType: ActiveCreditServiceType,
    nextUnits: number,
    nextContext: CreditPricingContext = context,
  ) {
    setPackagePrice(
      (suggestedCreditTotalCents(
        creditPricing,
        nextServiceType,
        nextUnits,
        nextContext,
      ) / 100).toFixed(2),
    );
  }

  return (
    <Dialog
      title="Vender pacote de créditos"
      description="Defina o pacote e o valor especial. Os créditos são liberados após registrar o pagamento."
      onClose={onClose}
    >
      <form className="form-grid" onSubmit={onSubmit}>
        <label className="field full">
          <span>Cliente *</span>
          <select
            name="customerId"
            value={customerId}
            onChange={(event) => {
              const nextId = event.target.value;
              const nextMultiDog =
                (customers.find((item) => item.id === nextId)?.dogIds.length ?? 0) >= 2;
              setCustomerId(nextId);
              setMultiDog(nextMultiDog);
              updateSuggestedPrice(serviceType, units, {
                ...context,
                multiDog: nextMultiDog,
              });
            }}
            autoFocus
            required
          >
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Tipo de crédito *</span>
          <select
            name="serviceType"
            value={serviceType}
            onChange={(event) => {
              const next = event.target.value as ActiveCreditServiceType;
              setServiceType(next);
              const nextUnits = next === "bath" ? 4 : units;
              if (next === "bath") setUnits(4);
              updateSuggestedPrice(next, nextUnits);
            }}
          >
            {creditServiceTypes.map((type) => (
              <option key={type} value={type}>
                {serviceLabels[type]}
              </option>
            ))}
          </select>
        </label>
        {serviceType === "daycare" && (
          <div className="field full">
            <span>Atalhos de quantidade</span>
            <div className="package-quick-options">
              {[4, 8, 12].map((quantity) => (
                <button
                  type="button"
                  key={quantity}
                  className={units === quantity ? "active" : ""}
                  onClick={() => {
                    setUnits(quantity);
                    updateSuggestedPrice(serviceType, quantity);
                  }}
                >
                  {quantity} créditos
                </button>
              ))}
            </div>
          </div>
        )}
        <label className="field full">
          <span>Quantidade de créditos *</span>
          <input
            name="units"
            type="number"
            min="1"
            max="100"
            step="1"
            value={units}
            onChange={(event) => {
              const next = Math.max(1, Math.floor(Number(event.target.value)));
              setUnits(next);
              updateSuggestedPrice(serviceType, next);
            }}
            required
          />
          <small>Digite qualquer quantidade; os atalhos acima são apenas para os pacotes mais usados.</small>
        </label>
        {serviceType === "daycare" && (
          <label className="compact-check full">
            <input
              name="multiDog"
              type="checkbox"
              checked={multiDog}
              onChange={(event) => {
                const checked = event.target.checked;
                setMultiDog(checked);
                updateSuggestedPrice(serviceType, units, {
                  ...context,
                  multiDog: checked,
                });
              }}
            />
            <span>
              <strong>Dois ou mais cães</strong>
              <small>Aplica {creditPricing.daycareMultiDogDiscountPercent}% de desconto ao valor de cada crédito.</small>
            </span>
          </label>
        )}
        {serviceType === "bath" && (
          <label className="compact-check full">
            <input
              name="daycareCustomer"
              type="checkbox"
              checked={daycareCustomer}
              onChange={(event) => {
                const checked = event.target.checked;
                setDaycareCustomer(checked);
                updateSuggestedPrice(serviceType, units, {
                  ...context,
                  daycareCustomer: checked,
                });
              }}
            />
            <span>
              <strong>Cliente de creche</strong>
              <small>Marcado por padrão; desmarque para aplicar a tarifa de cliente regular.</small>
            </span>
          </label>
        )}
        {serviceType === "transport" && (
          <fieldset className="choice-fieldset full">
            <legend>Distância *</legend>
            <div className="compact-choice-grid">
              {(["short", "long"] as const).map((distance) => (
                <label className="radio-option" key={distance}>
                  <input
                    type="radio"
                    name="taxiDistance"
                    value={distance}
                    checked={taxiDistance === distance}
                    onChange={() => {
                      setTaxiDistance(distance);
                      updateSuggestedPrice(serviceType, units, {
                        ...context,
                        taxiDistance: distance,
                      });
                    }}
                  />
                  <span>
                    <strong>{distance === "short" ? "Distância curta" : "Distância longa"}</strong>
                    <small>{formatCurrency(distance === "short" ? creditPricing.taxiDogShortUnitCents : creditPricing.taxiDogLongUnitCents)} por crédito</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <label className="field full">
          <span>Valor especial do pacote (R$) *</span>
          <input
            name="packagePrice"
            type="number"
            min="0.01"
            step="0.01"
            value={packagePrice}
            onChange={(event) => setPackagePrice(event.target.value)}
            required
          />
          <small>
            Você pode manter o valor sugerido com desconto ou digitar qualquer
            valor combinado com o cliente.
          </small>
        </label>
        <div className="package-summary full">
          <div>
            <span>Valor sugerido por crédito</span>
            <strong>{formatCurrency(suggestedUnitPriceCents)}</strong>
          </div>
          <div>
            <span>Total sugerido pela tabela</span>
            <strong>{formatCurrency(standardValueCents)}</strong>
          </div>
          <div>
            <span>Valor da fatura</span>
            <strong>{formatCurrency(packageValueCents)}</strong>
          </div>
          <div className={differenceCents >= 0 ? "saving" : ""}>
            <span>{differenceCents >= 0 ? "Economia do cliente" : "Acréscimo"}</span>
            <strong>{formatCurrency(Math.abs(differenceCents))}</strong>
          </div>
        </div>
        <div className="credit-safety-note full">
          <strong>Regra de segurança</strong>
          <span>
            Criar a cobrança não adiciona créditos. O saldo muda somente quando
            o pagamento é registrado.
          </span>
        </div>
        <div className="dialog-actions full">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" type="submit">
            Revisar fatura
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function CreditAdjustmentDialog({
  customer,
  balances,
  busy,
  onClose,
  onSubmit,
}: {
  customer?: Customer;
  balances: Record<CreditServiceType, number>;
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [serviceType, setServiceType] =
    useState<CreditServiceType>("daycare");
  const [targetUnits, setTargetUnits] = useState(balances.daycare);

  if (!customer) return null;

  return (
    <Dialog
      title="Ajustar créditos"
      description="Defina o saldo correto. O ajuste ficará registrado no histórico deste cliente."
      onClose={onClose}
      size="small"
    >
      <form className="form-grid" onSubmit={onSubmit}>
        <input type="hidden" name="customerId" value={customer.id} />
        <label className="field full">
          <span>Cliente</span>
          <input value={customer.name} readOnly />
        </label>
        <label className="field">
          <span>Tipo de crédito *</span>
          <select
            name="serviceType"
            value={serviceType}
            onChange={(event) => {
              const next = event.target.value as CreditServiceType;
              setServiceType(next);
              setTargetUnits(balances[next]);
            }}
          >
            {creditServiceTypes.map((type) => (
              <option key={type} value={type}>
                {serviceLabels[type]}
              </option>
            ))}
          </select>
          <small>Saldo atual: {balances[serviceType]}</small>
        </label>
        <label className="field">
          <span>Novo saldo *</span>
          <input
            name="targetUnits"
            type="number"
            min="0"
            max="10000"
            step="1"
            value={targetUnits}
            onChange={(event) => setTargetUnits(event.target.valueAsNumber)}
            required
          />
        </label>
        <label className="field full">
          <span>Motivo do ajuste *</span>
          <textarea
            name="reason"
            rows={3}
            minLength={3}
            maxLength={500}
            placeholder="Ex.: correção de saldo após conferência"
            required
          />
          <small>
            Esta correção não cria uma venda nem altera faturas já emitidas.
          </small>
        </label>
        <div className="dialog-actions full">
          <button className="secondary-button" type="button" onClick={onClose}>
            Cancelar
          </button>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "Salvando…" : "Salvar ajuste"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ReceiptDialog({
  receipt,
  onClose,
  onSend,
}: {
  receipt: ServiceReceipt;
  onClose: () => void;
  onSend: (
    receipt: ServiceReceipt,
    channel: "whatsapp" | "email",
  ) => void;
}) {
  return (
    <Dialog
      title={`Recibo ${receipt.number}`}
      description="Comprovante de serviço quitado com crédito pré-pago."
      onClose={onClose}
      size="small"
    >
      <div className="receipt-document">
        <span className="receipt-check" aria-hidden="true">
          ✓
        </span>
        <p className="section-kicker">Quitado</p>
        <h3>{receipt.service}</h3>
        <p>
          {receipt.dogName} · {receipt.customerName}
        </p>
        <div className="receipt-details">
          <div>
            <span>Data</span>
            <strong>{receipt.date}</strong>
          </div>
          <div>
            <span>Forma de quitação</span>
            <strong>
              {receipt.creditUnits} {receipt.creditUnits === 1 ? "crédito utilizado" : "créditos utilizados"}
            </strong>
          </div>
          {receipt.remainingBalance !== undefined && (
            <div>
              <span>Saldo restante deste serviço</span>
              <strong>{receipt.remainingBalance} créditos</strong>
            </div>
          )}
          <div>
            <span>Nova fatura</span>
            <strong>Não gerada</strong>
          </div>
        </div>
        <div className="receipt-confirmation">
          Este serviço já estava pago pelo pacote de créditos. Nenhum novo valor
          é devido.
        </div>
        {receipt.deliveryStatus === "sent" && (
          <span className="status-pill success">
            Preparado para{" "}
            {receipt.sentBy === "whatsapp" ? "WhatsApp" : "e-mail"}
          </span>
        )}
      </div>
      <div className="dialog-actions receipt-actions">
        <button
          className="secondary-button"
          onClick={() => onSend(receipt, "email")}
        >
          Preparar e-mail
        </button>
        <button
          className="primary-button"
          onClick={() => onSend(receipt, "whatsapp")}
        >
          Preparar WhatsApp
        </button>
      </div>
    </Dialog>
  );
}

function StatementDialog({
  customers,
  initialCustomerId,
  onClose,
  onFeedback,
}: {
  customers: Customer[];
  initialCustomerId: string;
  onClose: () => void;
  onFeedback: (message: string) => void;
}) {
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [from, setFrom] = useState(`${operationalToday.slice(0, 8)}01`);
  const [to, setTo] = useState(operationalToday);
  const [statement, setStatement] = useState<CustomerStatement | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const closingStatementBalance = statement
    ? describeStatementBalance(statement.closingBalanceCents)
    : null;
  const openingStatementBalance = statement
    ? describeStatementBalance(statement.openingBalanceCents)
    : null;

  async function loadStatement(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!customerId || !from || !to || from > to) {
      setError("Escolha o cliente e um período válido.");
      return;
    }
    setBusy("load");
    try {
      const result = await requestJson<CustomerStatement>(
        `/api/statements?accountId=${encodeURIComponent(customerId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      setStatement(result);
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível preparar o extrato.",
      );
    } finally {
      setBusy("");
    }
  }

  async function deliver(channel: "whatsapp" | "email" | "save") {
    if (!statement || busy) return;
    setBusy(channel);
    try {
      const generated = await generateStatementPdf(statement);
      if (channel === "save") {
        downloadInvoice(generated.blob, generated.filename);
        onFeedback("Extrato salvo nos arquivos ou downloads deste aparelho.");
        return;
      }
      if (
        navigator.share &&
        (!navigator.canShare || navigator.canShare({ files: [generated.file] }))
      ) {
        await navigator.share({
          title: `Extrato de ${statement.customer.name}`,
          text: `Extrato da Hospet Quintal · ${formatShortDate(from)} a ${formatShortDate(to)}`,
          files: [generated.file],
        });
        onFeedback("Extrato entregue ao menu de compartilhamento.");
        return;
      }
      downloadInvoice(generated.blob, generated.filename);
      const message = `Extrato Hospet Quintal de ${formatShortDate(from)} a ${formatShortDate(to)}. O PDF foi salvo para ser anexado.`;
      if (channel === "whatsapp") {
        window.location.href = `whatsapp://send?text=${encodeURIComponent(message)}`;
      } else {
        window.location.href = `mailto:?subject=${encodeURIComponent(`Extrato Hospet Quintal · ${statement.customer.name}`)}&body=${encodeURIComponent(message)}`;
      }
      onFeedback("PDF salvo; anexe-o no aplicativo que foi aberto.");
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível gerar o extrato.",
      );
    } finally {
      setBusy("");
    }
  }

  return (
    <Dialog
      title="Extrato do cliente"
      description="Escolha o período. O extrato reúne faturas, pagamentos e créditos sem alterar nenhum lançamento."
      onClose={onClose}
      size="regular"
    >
      <form className="form-grid statement-form" onSubmit={loadStatement}>
        <label className="field full">
          <span>Cliente</span>
          <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} required>
            <option value="">Escolha o cliente</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>De</span>
          <BrazilianDateInput value={from} onChange={setFrom} required />
        </label>
        <label className="field">
          <span>Até</span>
          <BrazilianDateInput value={to} onChange={setTo} required />
        </label>
        {error && <p className="form-error full">{error}</p>}
        <div className="dialog-actions full">
          <button type="button" className="secondary-button" onClick={onClose}>Fechar</button>
          <button type="submit" className="primary-button" disabled={busy === "load"}>
            {busy === "load" ? "Preparando…" : "Preparar extrato"}
          </button>
        </div>
      </form>
      {statement && (
        <section className="statement-preview">
          <div className="statement-opening full">
            <span>Situação no início do período</span>
            <strong>
              {openingStatementBalance?.label}: {formatCurrency(openingStatementBalance?.amountCents ?? 0)}
            </strong>
          </div>
          <div className="statement-summary-grid full">
            <span>
              <small>Faturado no período</small>
              <strong>{formatCurrency(statement.summary.chargesInPeriodCents)}</strong>
            </span>
            <span>
              <small>Pagamentos recebidos</small>
              <strong>{formatCurrency(statement.summary.paymentsInPeriodCents)}</strong>
            </span>
            <span className={`statement-closing ${closingStatementBalance?.kind ?? "settled"}`}>
              <small>{closingStatementBalance?.label}</small>
              <strong>{formatCurrency(closingStatementBalance?.amountCents ?? 0)}</strong>
            </span>
          </div>
          <small className="statement-entry-count full">
            {statement.entries.length === 1
              ? "1 movimentação no período"
              : `${statement.entries.length} movimentações no período`}
          </small>
          <div className="invoice-delivery-options full">
            <button type="button" className="invoice-delivery-button whatsapp" disabled={Boolean(busy)} onClick={() => void deliver("whatsapp")}>
              <span>WA</span><strong>WhatsApp</strong><small>Compartilhar PDF</small>
            </button>
            <button type="button" className="invoice-delivery-button email" disabled={Boolean(busy)} onClick={() => void deliver("email")}>
              <span>@</span><strong>E-mail</strong><small>Compartilhar PDF</small>
            </button>
            <button type="button" className="invoice-delivery-button save" disabled={Boolean(busy)} onClick={() => void deliver("save")}>
              <span>↓</span><strong>Salvar</strong><small>Arquivos ou downloads</small>
            </button>
          </div>
        </section>
      )}
    </Dialog>
  );
}

function InvoiceDialog({
  state,
  financialAccounts,
  onClose,
  onIssue,
  onRegisterPayment,
  onReversePayment,
  onManageSettlement,
  onVoid,
  onDeliveryConfirmed,
  onFeedback,
  longStayDiscountPercent,
  liveMode,
  canReversePayment,
  busy,
}: {
  state: InvoiceState;
  financialAccounts: FinancialAccount[];
  onClose: () => void;
  onIssue: (applyLongStayDiscount?: boolean) => void;
  onRegisterPayment: (
    paidAt: string,
    settlementMode?: "immediate" | "schedule" | "confirm_scheduled",
    availableOn?: string,
    financialAccountId?: string,
  ) => void | Promise<void>;
  onReversePayment: (reason: string) => boolean | Promise<boolean>;
  onManageSettlement: (
    action: "update" | "cancel",
    availableOn?: string,
    reason?: string,
  ) => boolean | Promise<boolean>;
  onVoid: (reason: string) => void | Promise<void>;
  onDeliveryConfirmed: (
    invoiceId: string,
    channel: "whatsapp" | "email",
  ) => Promise<boolean>;
  onFeedback: (message: string) => void;
  longStayDiscountPercent: number;
  liveMode: boolean;
  canReversePayment: boolean;
  busy: boolean;
}) {
  const [deliveryBusy, setDeliveryBusy] =
    useState<InvoiceDeliveryChannel | null>(null);
  const [paidAt, setPaidAt] = useState(operationalToday);
  const [paymentMode, setPaymentMode] = useState<"immediate" | "schedule">(
    "immediate",
  );
  const [availableOn, setAvailableOn] = useState(shiftDate(operationalToday, 1));
  const [financialAccountId, setFinancialAccountId] = useState(
    state.invoice?.compensationFinancialAccountId ??
      (financialAccounts.length === 1 ? financialAccounts[0].id : ""),
  );
  const effectiveFinancialAccountId =
    state.invoice?.compensationAvailableOn &&
    state.invoice.compensationFinancialAccountId
      ? state.invoice.compensationFinancialAccountId
      : financialAccountId;
  const [skipLongStayDiscount, setSkipLongStayDiscount] = useState(false);
  const [reversePaymentOpen, setReversePaymentOpen] = useState(false);
  const [reversePaymentReason, setReversePaymentReason] = useState("");
  const [cancelInvoiceOpen, setCancelInvoiceOpen] = useState(false);
  const [cancelInvoiceReason, setCancelInvoiceReason] = useState("");
  const [settlementEditorOpen, setSettlementEditorOpen] = useState(false);
  const [settlementDate, setSettlementDate] = useState(
    state.invoice?.compensationAvailableOn ?? shiftDate(operationalToday, 1),
  );
  const [settlementCancelReason, setSettlementCancelReason] = useState("");

  async function handleDelivery(channel: InvoiceDeliveryChannel) {
    if (deliveryBusy) return;
    setDeliveryBusy(channel);
    try {
      const result = await deliverInvoice(state, channel);
      if (result === "saved") {
        onFeedback("Fatura salva nos arquivos ou downloads deste aparelho.");
      } else if (result === "shared") {
        if (channel !== "save" && state.invoice?.id) {
          const recorded = await onDeliveryConfirmed(state.invoice.id, channel);
          onFeedback(
            recorded
              ? `Compartilhamento por ${channel === "whatsapp" ? "WhatsApp" : "e-mail"} preparado e registrado.`
              : "O compartilhamento foi concluído, mas não foi possível registrar o canal.",
          );
        } else {
          onFeedback("Fatura entregue ao menu de compartilhamento.");
        }
      } else {
        onFeedback(
          "PDF salvo. O aplicativo foi aberto para você anexar e confirmar o envio.",
        );
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      onFeedback(
        error instanceof Error
          ? error.message
          : "Não foi possível preparar o PDF desta fatura.",
      );
    } finally {
      setDeliveryBusy(null);
    }
  }

  if (state.step === "review") {
    const availableLongStayDiscountCents =
      state.kind === "services"
        ? state.selectedServices.reduce(
            (total, service) =>
              total +
              billableLongStayDiscountCents(
                service,
                longStayDiscountPercent,
              ),
            0,
          )
        : 0;
    const hasLongStayDiscount = availableLongStayDiscountCents > 0;
    const reviewTotalCents = Math.max(
      0,
      state.amountCents -
        (hasLongStayDiscount && !skipLongStayDiscount
          ? availableLongStayDiscountCents
          : 0),
    );
    return (
      <Dialog
        title="Revisar cobrança"
        description={
          state.kind === "credit_package"
            ? "Confira o pacote e o valor especial antes de criar a fatura."
            : "Confira os serviços antes de criar a fatura."
        }
        onClose={onClose}
      >
        <div className="billing-review">
          <div className="review-customer">
            <span>Cliente</span>
            <strong>{state.customerName}</strong>
          </div>
          <div className="review-items">
            {state.kind === "credit_package" && state.creditPurchase ? (
              <div>
                <span>
                  <strong>
                    {state.creditPurchase.units} créditos de{" "}
                    {serviceLabels[state.creditPurchase.serviceType]}
                  </strong>
                  <small>
                    Sugestão da tabela:{" "}
                    {formatCurrency(state.creditPurchase.standardValueCents)}
                    {state.creditPurchase.pricingProfile && (
                      <> · {creditPricingProfileLabel(state.creditPurchase.pricingProfile)}</>
                    )}
                  </small>
                </span>
                <strong>{formatCurrency(state.amountCents)}</strong>
              </div>
            ) : (
              state.selectedServices.map((service) => (
                <div key={service.id}>
                  <span>
                    <strong>
                      {service.dogName} · {service.service}
                    </strong>
                    <small>{service.date}</small>
                  </span>
                  <strong>{formatCurrency(service.amountCents)}</strong>
                </div>
              ))
            )}
          </div>
          {hasLongStayDiscount && (
            <div className="long-stay-choice">
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={skipLongStayDiscount}
                  onChange={(event) =>
                    setSkipLongStayDiscount(event.target.checked)
                  }
                />
                <span>Não aplicar desconto por longa estadia</span>
              </label>
              <p className={skipLongStayDiscount ? "not-applied" : "applied"}>
                {skipLongStayDiscount
                  ? `Desconto não aplicado. A fatura será criada pelo valor integral de ${formatCurrency(state.amountCents)}.`
                  : `Desconto de longa estadia de ${longStayDiscountPercent}% aplicado: −${formatCurrency(availableLongStayDiscountCents)}.`}
              </p>
            </div>
          )}
          <div className="review-total">
            <span>Total</span>
            <strong>{formatCurrency(reviewTotalCents)}</strong>
          </div>
          <div className="invoice-notice">
            <span className="attention-mark">i</span>
            <p>
              <strong>Fatura pronta para compartilhamento.</strong>
              {state.kind === "credit_package"
                ? " Os créditos serão liberados somente depois da confirmação do pagamento."
                : " Esta cobrança reúne o saldo integral dos itens selecionados."}
            </p>
          </div>
          <div className="dialog-actions">
            <button className="secondary-button" onClick={onClose}>
              Voltar
            </button>
            <button
              className="primary-button"
              onClick={() => onIssue(!skipLongStayDiscount)}
              autoFocus
              disabled={busy}
            >
              {busy ? "Registrando…" : "Criar fatura"}
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  if (state.step === "paid") {
    return (
      <Dialog
        title="Pagamento confirmado"
        description={
          liveMode
            ? "O pagamento foi confirmado."
            : "Confirmação de demonstração." 
        }
        onClose={onClose}
        size="small"
      >
        <div className="payment-success">
          <span className="success-mark" aria-hidden="true">
            ✓
          </span>
          <strong>{formatCurrency(state.amountCents)}</strong>
          <p>
            {state.kind === "credit_package"
              ? "O pacote foi pago e os créditos já aparecem no saldo do cliente."
              : "Pagamento confirmado. Os itens relacionados foram marcados como pagos."}
          </p>
          <button className="primary-button" onClick={onClose} autoFocus>
            Concluir
          </button>
        </div>
      </Dialog>
    );
  }

  if (state.step === "code") {
    const rows = invoiceDescriptionLines(state);
    const tableTotalCents = rows.reduce(
      (total, row) => total + (row.tableAmountCents ?? row.amountCents),
      0,
    );
    const hasLodging = rows.some(
      (row) => row.tableAmountCents !== undefined,
    );
    const isPaid = state.invoice?.status === "paid";
    const compensationAvailableOn = state.invoice?.compensationAvailableOn;
    return (
      <Dialog
        title={`Fatura nº ${state.invoice?.number ?? "—"}`}
        description="O PDF está pronto para salvar ou compartilhar."
        onClose={onClose}
      >
        <div className="invoice-share-card">
          <header>
            <span className="invoice-document-mark" aria-hidden="true">
              PDF
            </span>
            <span>
              <small>Cliente</small>
              <strong>{state.customerName}</strong>
            </span>
            <span className={`status-pill ${isPaid ? "paid" : "pending"}`}>
              {isPaid
                ? "Fatura paga"
                : compensationAvailableOn
                  ? "Em compensação"
                  : "Fatura pendente"}
            </span>
          </header>

          <div className="invoice-share-items">
            {rows.map((row, index) => (
              <div key={`${row.title}-${index}`}>
                <span>
                  <strong>{row.title}</strong>
                  <small>{row.detail}</small>
                  {row.tableAmountCents !== undefined && (
                    <small className="invoice-table-value">
                      Valor tabelado: {formatCurrency(row.tableAmountCents)}
                    </small>
                  )}
                  {(row.longStayDiscountCents ?? 0) > 0 && (
                    <small className="invoice-table-value">
                      Desconto de longa estadia ({row.longStayDiscountPercent}%): −{formatCurrency(row.longStayDiscountCents!)}
                    </small>
                  )}
                </span>
                <strong>{formatCurrency(row.amountCents)}</strong>
              </div>
            ))}
          </div>

          <div className="invoice-share-total">
            <span>
              Total da fatura
              {hasLodging && (
                <small>
                  Total pela diária padrão: {formatCurrency(tableTotalCents)}
                </small>
              )}
            </span>
            <strong>{formatCurrency(state.amountCents)}</strong>
          </div>

          <div className="invoice-delivery-options">
            <button
              className="invoice-delivery-button whatsapp"
              type="button"
              disabled={Boolean(deliveryBusy)}
              onClick={() => handleDelivery("whatsapp")}
            >
              <span aria-hidden="true">WA</span>
              <strong>
                {deliveryBusy === "whatsapp"
                  ? "Preparando…"
                  : "WhatsApp"}
              </strong>
              <small>Compartilhar o PDF</small>
            </button>
            <button
              className="invoice-delivery-button email"
              type="button"
              disabled={Boolean(deliveryBusy)}
              onClick={() => handleDelivery("email")}
            >
              <span aria-hidden="true">@</span>
              <strong>
                {deliveryBusy === "email" ? "Preparando…" : "E-mail"}
              </strong>
              <small>Enviar como anexo</small>
            </button>
            <button
              className="invoice-delivery-button save"
              type="button"
              disabled={Boolean(deliveryBusy)}
              onClick={() => handleDelivery("save")}
            >
              <span aria-hidden="true">↓</span>
              <strong>
                {deliveryBusy === "save" ? "Gerando…" : "Salvar"}
              </strong>
              <small>Arquivos ou downloads</small>
            </button>
          </div>

          {state.invoice && (state.invoice.sentBy?.length ?? 0) > 0 && (
            <InvoiceDeliveryStatus invoice={state.invoice} compact />
          )}

          <div className="invoice-share-note">
            <span className="attention-mark">i</span>
            <p>
              No iPhone e Android será aberto o menu normal de
              compartilhamento com o PDF anexado. No computador, se o
              aplicativo não aceitar anexos automáticos, o PDF será salvo
              antes de abrir o WhatsApp ou o e-mail.
            </p>
          </div>

          {!isPaid && compensationAvailableOn && (
            <div className="invoice-compensation-status">
              <strong>Recebimento em compensação</strong>
              <span>
                Previsto para ficar disponível em {formatShortDate(compensationAvailableOn)}.
              </span>
              {!settlementEditorOpen && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setSettlementEditorOpen(true)}
                >
                  Alterar previsão
                </button>
              )}
            </div>
          )}

          {!isPaid && compensationAvailableOn && settlementEditorOpen && (
            <div className="settlement-editor">
              <label>
                <span>Nova data prevista</span>
                <BrazilianDateInput
                  value={settlementDate}
                  min={operationalToday}
                  onChange={setSettlementDate}
                  ariaLabel="Nova data prevista para compensação"
                />
              </label>
              <label>
                <span>Motivo para cancelar a compensação</span>
                <input
                  value={settlementCancelReason}
                  onChange={(event) =>
                    setSettlementCancelReason(event.target.value)
                  }
                  maxLength={500}
                  placeholder="Preencha somente se desejar cancelar"
                />
              </label>
              <div>
                <button
                  type="button"
                  className="text-button muted"
                  onClick={() => setSettlementEditorOpen(false)}
                  disabled={busy}
                >
                  Fechar
                </button>
                <button
                  type="button"
                  className="danger-button"
                  disabled={busy || settlementCancelReason.trim().length < 3}
                  onClick={() =>
                    void onManageSettlement(
                      "cancel",
                      undefined,
                      settlementCancelReason.trim(),
                    )
                  }
                >
                  Cancelar compensação
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy || !settlementDate}
                  onClick={async () => {
                    const updated = await onManageSettlement(
                      "update",
                      settlementDate,
                    );
                    if (updated) setSettlementEditorOpen(false);
                  }}
                >
                  Salvar data
                </button>
              </div>
            </div>
          )}

          {!isPaid && (
            <div className="invoice-payment-register">
              {compensationAvailableOn &&
              state.invoice?.compensationFinancialAccountId ? (
                <div className="payment-account-summary">
                  <span>Conta de recebimento</span>
                  <strong>
                    {state.invoice.compensationFinancialAccountName ??
                      "Conta vinculada à compensação"}
                  </strong>
                  <small>A confirmação será registrada na mesma conta escolhida anteriormente.</small>
                </div>
              ) : (
                <label>
                  Conta de recebimento
                  <select
                    value={effectiveFinancialAccountId}
                    onChange={(event) => setFinancialAccountId(event.target.value)}
                    required
                  >
                    {financialAccounts.length > 1 && (
                      <option value="">Escolha a conta</option>
                    )}
                    {financialAccounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}{account.institution ? ` · ${account.institution}` : ""}
                      </option>
                    ))}
                  </select>
                  {!financialAccounts.length && (
                    <small>Cadastre uma conta ativa no Caixa antes de registrar o recebimento.</small>
                  )}
                </label>
              )}
              <label>
                {compensationAvailableOn
                  ? "Data em que o valor ficou disponível"
                  : paymentMode === "schedule"
                    ? "Data prevista para disponibilidade"
                    : "Data do pagamento"}
                <BrazilianDateInput
                  value={compensationAvailableOn ? paidAt : paymentMode === "schedule" ? availableOn : paidAt}
                  min={paymentMode === "schedule" ? operationalToday : undefined}
                  max={paymentMode === "schedule" ? undefined : operationalToday}
                  onChange={compensationAvailableOn ? setPaidAt : paymentMode === "schedule" ? setAvailableOn : setPaidAt}
                  ariaLabel={compensationAvailableOn ? "Data de disponibilidade" : paymentMode === "schedule" ? "Data prevista para disponibilidade" : "Data do pagamento"}
                />
              </label>
              {compensationAvailableOn ? (
                <span>Confirme somente quando o valor estiver disponível na conta.</span>
              ) : (
                <fieldset className="invoice-payment-mode">
                  <span>Recebimento</span>
                  <div>
                    <button
                      type="button"
                      className={paymentMode === "immediate" ? "active" : ""}
                      aria-pressed={paymentMode === "immediate"}
                      onClick={() => setPaymentMode("immediate")}
                    >
                      Valor já disponível
                    </button>
                    <button
                      type="button"
                      className={paymentMode === "schedule" ? "active" : ""}
                      aria-pressed={paymentMode === "schedule"}
                      onClick={() => setPaymentMode("schedule")}
                    >
                      Ainda vai compensar
                    </button>
                  </div>
                  <small>
                    {paymentMode === "schedule"
                      ? "A fatura permanece em aberto e o Caixa só recebe este valor após a confirmação."
                      : "Use esta opção quando o valor já estiver disponível na conta."}
                  </small>
                </fieldset>
              )}
            </div>
          )}

          {isPaid && canReversePayment && reversePaymentOpen && (
            <form
              className="invoice-reversal-form"
              onSubmit={async (event) => {
                event.preventDefault();
                const reason = reversePaymentReason.trim();
                if (reason.length < 3) return;
                await onReversePayment(reason);
              }}
            >
              <label>
                <span>Motivo do estorno *</span>
                <textarea
                  value={reversePaymentReason}
                  onChange={(event) =>
                    setReversePaymentReason(event.target.value)
                  }
                  rows={2}
                  minLength={3}
                  maxLength={500}
                  placeholder="Ex.: pagamento registrado por engano"
                  autoFocus
                  required
                />
              </label>
              <p>
                A fatura voltará a ficar em aberto. O lançamento do Caixa e
                eventuais créditos liberados serão revertidos, preservando o
                histórico.
              </p>
              <div>
                <button
                  className="text-button muted"
                  type="button"
                  onClick={() => {
                    setReversePaymentOpen(false);
                    setReversePaymentReason("");
                  }}
                  disabled={busy}
                >
                  Cancelar
                </button>
                <button
                  className="danger-button"
                  type="submit"
                  disabled={busy || reversePaymentReason.trim().length < 3}
                >
                  {busy ? "Estornando…" : "Confirmar estorno"}
                </button>
              </div>
            </form>
          )}

          {!isPaid && !state.invoice?.mergeId && cancelInvoiceOpen && (
            <form
              className="invoice-reversal-form"
              onSubmit={async (event) => {
                event.preventDefault();
                const reason = cancelInvoiceReason.trim();
                if (reason.length < 3) return;
                await onVoid(reason);
              }}
            >
              <label>
                <span>Motivo do cancelamento *</span>
                <textarea
                  value={cancelInvoiceReason}
                  onChange={(event) => setCancelInvoiceReason(event.target.value)}
                  rows={2}
                  minLength={3}
                  maxLength={500}
                  placeholder="Ex.: serviço lançado em duplicidade"
                  autoFocus
                  required
                />
              </label>
              <p>
                A fatura será cancelada e os serviços voltarão para correção em
                Cobranças. O motivo ficará registrado no histórico.
              </p>
              <div>
                <button
                  className="text-button muted"
                  type="button"
                  onClick={() => {
                    setCancelInvoiceOpen(false);
                    setCancelInvoiceReason("");
                  }}
                  disabled={busy}
                >
                  Voltar
                </button>
                <button
                  className="danger-button"
                  type="submit"
                  disabled={busy || cancelInvoiceReason.trim().length < 3}
                >
                  {busy ? "Cancelando…" : "Confirmar cancelamento"}
                </button>
              </div>
            </form>
          )}

          <div className="dialog-actions">
            {!isPaid && !cancelInvoiceOpen && (
              <button
                className="danger-button"
                type="button"
                onClick={() => {
                  if (state.invoice?.mergeId) {
                    void onVoid("");
                  } else {
                    setCancelInvoiceOpen(true);
                  }
                }}
              >
                {state.invoice?.mergeId ? "Desfazer união" : "Cancelar fatura"}
              </button>
            )}
            <button className="secondary-button" type="button" onClick={onClose}>
              Fechar
            </button>
            {isPaid && canReversePayment && !reversePaymentOpen && (
              <button
                className="danger-button"
                type="button"
                onClick={() => setReversePaymentOpen(true)}
              >
                Estornar pagamento
              </button>
            )}
            {!isPaid && (
              <button
                className="primary-button"
                type="button"
                disabled={
                  busy ||
                  !(compensationAvailableOn
                    ? paidAt
                    : paymentMode === "schedule"
                      ? availableOn
                      : paidAt) ||
                  !effectiveFinancialAccountId
                }
                onClick={() =>
                  onRegisterPayment(
                    paidAt,
                    compensationAvailableOn
                      ? "confirm_scheduled"
                      : paymentMode,
                    paymentMode === "schedule" ? availableOn : undefined,
                    effectiveFinancialAccountId,
                  )
                }
              >
                {busy
                  ? "Registrando…"
                  : compensationAvailableOn
                    ? "Confirmar disponibilidade"
                    : paymentMode === "schedule"
                      ? "Registrar em compensação"
                      : "Registrar pagamento"}
              </button>
            )}
          </div>
        </div>
      </Dialog>
    );
  }

  return null;
}

function Dialog({
  title,
  description,
  onClose,
  size = "regular",
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  size?: "small" | "regular";
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeDialog = useEffectEvent(onClose);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = dialogRef.current?.querySelector<HTMLElement>(
      "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
    );
    focusable?.focus();

    function keepFocusInside(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", keepFocusInside);
    return () => {
      document.removeEventListener("keydown", keepFocusInside);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={`dialog-card dialog-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className="dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId}>{description}</p>
          </div>
          <button className="dialog-close" onClick={onClose} aria-label="Fechar">
            Fechar
          </button>
        </header>
        <div className="dialog-content">{children}</div>
      </section>
    </div>
  );
}

function DogAvatar({
  dog,
  size = "regular",
}: {
  dog?: Dog;
  size?: "small" | "regular" | "large" | "xlarge";
}) {
  if (dog?.photoUrl) {
    // Uploaded dog photos use private, short-lived application URLs; a plain
    // image avoids sending those URLs through an external optimization service.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={`avatar dog-avatar avatar-${size}`} src={dog.photoUrl} alt="" />;
  }
  return (
    <span
      className={`avatar dog-avatar avatar-${size} avatar-${
        dog?.color ?? "neutral"
      }`}
      aria-hidden="true"
    >
      {dog?.initials ?? "CÃ"}
    </span>
  );
}

function SummaryItem({
  value,
  label,
  attention = false,
}: {
  value: number;
  label: string;
  attention?: boolean;
}) {
  return (
    <div className={attention ? "summary-item attention" : "summary-item"}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-mark" aria-hidden="true">
        —
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
