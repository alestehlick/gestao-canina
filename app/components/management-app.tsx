"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { jsPDF } from "jspdf";
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
  toWorkspaceServiceCode,
  transformWorkspacePayload,
  type WorkspaceOnboardingPayload,
  type WorkspacePayload,
  type WorkspaceReadyPayload,
} from "@/lib/workspace-data";

type View =
  | "today"
  | "agenda"
  | "dogs"
  | "customers"
  | "billing"
  | "activity"
  | "settings"
  | "portal";

type DialogKind =
  | "service"
  | "task"
  | "registration"
  | "editService"
  | "editDog"
  | "editCustomer"
  | "cancel"
  | "pix"
  | "creditPackage"
  | "receipt"
  | null;

type ToastState = {
  message: string;
  actionLabel?: string;
  action?: () => void;
};

type PixState = {
  step: "review" | "code" | "paid";
  kind: "services" | "credit_package";
  invoice?: Invoice;
  selectedServices: BillableService[];
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  amountCents: number;
  creditPurchase?: Omit<CreditPurchase, "id" | "status" | "createdAt">;
  copyPasteCode?: string;
  providerMessage?: string;
};

type BillingTab = "pix" | "credits" | "receipts";
type RuntimeMode =
  | "loading"
  | "setup"
  | "login"
  | "onboarding"
  | "ready"
  | "demo"
  | "error";

type AuthStatusPayload = {
  setupRequired: boolean;
  authenticated: boolean;
  sessionExpiresAt?: string;
  configurationError?: boolean;
  identity?: {
    email: string;
    displayName: string;
    role: "owner";
  };
};

const navItems: { id: View; label: string; shortLabel: string }[] = [
  { id: "today", label: "Hoje", shortLabel: "Hoje" },
  { id: "agenda", label: "Agenda", shortLabel: "Agenda" },
  { id: "dogs", label: "Cães", shortLabel: "Cães" },
  { id: "customers", label: "Clientes", shortLabel: "Clientes" },
  { id: "billing", label: "Cobranças", shortLabel: "Mais" },
  { id: "activity", label: "Atividades", shortLabel: "Ativ." },
  { id: "settings", label: "Configurações", shortLabel: "Config." },
];

const pageCopy: Record<
  Exclude<View, "portal">,
  { eyebrow: string; title: string; description: string }
> = {
  today: {
    eyebrow: "Operação de hoje",
    title: "Um dia bem cuidado começa aqui.",
    description: "Agenda, presença e tarefas essenciais em uma única visão.",
  },
  agenda: {
    eyebrow: "Agenda operacional",
    title: "Todos os cuidados programados",
    description: "Acompanhe chegadas, atendimentos, hospedagens e rotas.",
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
  activity: {
    eyebrow: "Rastreabilidade",
    title: "Atividades",
    description: "Histórico de ações importantes da equipe e do financeiro.",
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
  "grooming",
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
  const value = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function dateFromIso(value: string) {
  return new Date(`${value}T12:00:00Z`);
}

function shiftDate(value: string, days: number) {
  const next = dateFromIso(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function formatSelectedDate(value: string, compact = false) {
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    weekday: compact ? undefined : "long",
    day: "numeric",
    month: compact ? "short" : "long",
    timeZone: "America/Sao_Paulo",
  }).format(dateFromIso(value));
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(dateFromIso(value));
}

type InvoiceDeliveryChannel = "whatsapp" | "email" | "save";

function invoiceFileName(state: PixState) {
  const number = state.invoice?.number ?? "nova";
  const customer = normalize(state.customerName)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `fatura-${number}-${customer || "cliente"}.pdf`;
}

function invoiceDescriptionLines(state: PixState) {
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
      detail: service.date,
      amountCents: service.amountCents,
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

function createInvoicePdf(state: PixState) {
  const document = new jsPDF({
    unit: "mm",
    format: "a4",
    orientation: "portrait",
  });
  const invoiceNumber = state.invoice?.number ?? "NOVA";
  const rows = invoiceDescriptionLines(state);
  const issuedAt = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeZone: "America/Sao_Paulo",
  }).format(new Date());

  document.setProperties({
    title: `Fatura ${invoiceNumber} · Hospet Quintal`,
    subject: `Fatura de serviços para ${state.customerName}`,
    author: "Hospet Quintal",
  });
  document.setFillColor(24, 63, 49);
  document.rect(0, 0, 210, 42, "F");
  document.setTextColor(255, 255, 255);
  document.setFont("helvetica", "bold");
  document.setFontSize(22);
  document.text("HOSPET QUINTAL", 18, 20);
  document.setFontSize(9);
  document.setFont("helvetica", "normal");
  document.text("Cuidado, hospedagem e bem-estar canino", 18, 28);
  document.setFont("helvetica", "bold");
  document.setFontSize(17);
  document.text("FATURA", 192, 19, { align: "right" });
  document.setFontSize(9);
  document.setFont("helvetica", "normal");
  document.text(`No. ${invoiceNumber}`, 192, 27, { align: "right" });

  document.setTextColor(38, 46, 41);
  document.setFont("helvetica", "bold");
  document.setFontSize(9);
  document.text("CLIENTE", 18, 57);
  document.text("EMISSÃO", 124, 57);
  document.setFont("helvetica", "normal");
  document.setFontSize(12);
  document.text(state.customerName, 18, 65);
  document.setFontSize(10);
  document.text(issuedAt, 124, 65);
  if (state.customerEmail) {
    document.setTextColor(91, 99, 94);
    document.setFontSize(8.5);
    document.text(state.customerEmail, 18, 71);
  }

  let y = 88;
  document.setFillColor(244, 241, 233);
  document.rect(18, y - 7, 174, 10, "F");
  document.setTextColor(62, 69, 64);
  document.setFont("helvetica", "bold");
  document.setFontSize(8);
  document.text("DESCRIÇÃO", 22, y);
  document.text("VALOR", 187, y, { align: "right" });
  y += 12;

  for (const row of rows) {
    if (y > 246) {
      document.addPage();
      y = 24;
    }
    document.setTextColor(38, 46, 41);
    document.setFont("helvetica", "bold");
    document.setFontSize(10);
    const titleLines = document.splitTextToSize(row.title, 125) as string[];
    document.text(titleLines, 22, y);
    document.setFont("helvetica", "normal");
    document.text(formatCurrency(row.amountCents), 187, y, { align: "right" });
    const detailY = y + titleLines.length * 5;
    document.setTextColor(102, 108, 104);
    document.setFontSize(8.5);
    document.text(row.detail, 22, detailY);
    document.setDrawColor(226, 222, 213);
    document.line(18, detailY + 5, 192, detailY + 5);
    y = detailY + 12;
  }

  y = Math.min(Math.max(y + 3, 118), 252);
  document.setFillColor(24, 63, 49);
  document.roundedRect(112, y, 80, 23, 2, 2, "F");
  document.setTextColor(220, 232, 225);
  document.setFont("helvetica", "normal");
  document.setFontSize(8);
  document.text("VALOR TOTAL", 119, y + 8);
  document.setTextColor(255, 255, 255);
  document.setFont("helvetica", "bold");
  document.setFontSize(16);
  document.text(formatCurrency(state.amountCents), 185, y + 16, {
    align: "right",
  });

  document.setTextColor(91, 99, 94);
  document.setFont("helvetica", "normal");
  document.setFontSize(8.5);
  document.text(
    "Esta fatura registra os serviços selecionados. Forma e confirmação do pagamento são combinadas diretamente com o cliente.",
    18,
    278,
    { maxWidth: 174 },
  );
  document.setFont("helvetica", "bold");
  document.text("Hospet Quintal · hopetquintal.com.br", 18, 289);

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
  state: PixState,
  channel: InvoiceDeliveryChannel,
) {
  const generated = createInvoicePdf(state);
  const title = `Fatura ${state.invoice?.number ?? ""} · Hospet Quintal`.trim();
  const text = `Olá, ${state.customerName}. Segue a fatura do Hospet Quintal no valor de ${formatCurrency(
    state.amountCents,
  )}.`;
  const shareData: ShareData = {
    title,
    text,
    files: [generated.file],
  };

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
    const phone = state.customerPhone?.replace(/\D/g, "") ?? "";
    const normalizedPhone =
      phone.length === 10 || phone.length === 11 ? `55${phone}` : phone;
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
) {
  if (recurrence === "none") return [startDate];
  if (recurrence === "weekly") {
    return [0, 7, 14, 21].map((days) => shiftDate(startDate, days));
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

function nextStatus(status: BookingStatus): BookingStatus {
  const progression: Partial<Record<BookingStatus, BookingStatus>> = {
    scheduled: "confirmed",
    confirmed: "present",
    in_transit: "completed",
    present: "completed",
    in_service: "completed",
    completed: "scheduled",
  };
  return progression[status] ?? status;
}

function primaryAction(status: BookingStatus) {
  const actions: Partial<Record<BookingStatus, string>> = {
    scheduled: "Confirmar",
    confirmed: "Registrar chegada",
    in_transit: "Concluir rota",
    present: "Concluir atendimento",
    in_service: "Concluir atendimento",
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
  const [servicePrices, setServicePrices] =
    useState<Record<ServiceType, number>>(defaultServicePrices);
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
    "all" | "upcoming" | "active" | "completed"
  >("all");
  const [search, setSearch] = useState("");
  const [searchCursor, setSearchCursor] = useState(0);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null);
  const [bookingToEdit, setBookingToEdit] = useState<Booking | null>(null);
  const [dogToEdit, setDogToEdit] = useState<Dog | null>(null);
  const [customerToEdit, setCustomerToEdit] = useState<Customer | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [pixState, setPixState] = useState<PixState | null>(null);
  const [billingTab, setBillingTab] = useState<BillingTab>("pix");
  const [creditCustomerId, setCreditCustomerId] = useState<string>("");
  const [selectedReceipt, setSelectedReceipt] =
    useState<ServiceReceipt | null>(null);
  const [serviceDraftDogId, setServiceDraftDogId] = useState("");
  const [serviceDraftType, setServiceDraftType] =
    useState<ServiceType>("daycare");
  const [serviceDraftPayment, setServiceDraftPayment] =
    useState<Booking["paymentPreference"]>("pix");
  const [serviceDraftTransportDirection, setServiceDraftTransportDirection] =
    useState<"one_way" | "round_trip">("one_way");
  const [portalTab, setPortalTab] = useState("Início");
  const [sessionExpiresAt, setSessionExpiresAt] = useState<string | null>(null);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const selectedDateRef = useRef(operationalToday);

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
    setServicePrices(defaultServicePrices);
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
    setPixState(null);
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
    setCreditCustomerId((current) =>
      data.customers.some((customer) => customer.id === current)
        ? current
        : data.customers[0]?.id ?? "",
    );
    setRuntimeMode("ready");
    setLoadError("");
  }, []);

  const refreshWorkspace = useCallback(
    async (
      options: {
        allowDemoFallback?: boolean;
        referenceDate?: string;
      } = {},
    ): Promise<WorkspaceReadyPayload | null> => {
      try {
        const payload = await requestJson<WorkspacePayload>(
          workspaceRequestUrl(
            options.referenceDate ?? selectedDateRef.current,
          ),
        );
        if (isReadyWorkspacePayload(payload)) {
          applyReadyWorkspace(payload);
          return payload;
        }
        setWorkspacePayload(null);
        setOnboardingPayload(payload);
        setRuntimeMode("onboarding");
        setLoadError("");
        return null;
      } catch (error) {
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
    },
    [activateDemo, applyReadyWorkspace, endSession],
  );

  const initializeApplication = useCallback(async () => {
    setRuntimeMode("loading");
    setLoadError("");
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
    void initializeApplication();
  }, [initializeApplication]);

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
    if (busyAction) return undefined;
    setBusyAction(key);
    try {
      const result = await action();
      if (options.refresh !== false) {
        await refreshWorkspace();
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
      setBusyAction(null);
    }
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
    setServiceDraftType("daycare");
    setServiceDraftPayment("pix");
    setDialog("service");
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
  ) {
    const previous = booking.status;

    if (runtimeMode === "ready" && view !== "portal") {
      if (
        status === "completed" &&
        booking.paymentPreference === "credit"
      ) {
        if (!booking.itemId) {
          setToast({
            message:
              "Este serviço não possui um item válido para usar o crédito.",
          });
          return;
        }
        const result = await runLiveAction(
          `credit:${booking.itemId}`,
          () =>
            requestJson<{
              receipt: { receiptNumber: string } | null;
              remainingUnits?: number;
            }>("/api/credits/consume", {
              method: "POST",
              body: JSON.stringify({
                appointmentItemId: booking.itemId,
              }),
            }),
          { refresh: true },
        );
        if (result) {
          const receiptNumber =
            result.receipt?.receiptNumber ?? "novo recibo";
          setOpenMenuId(null);
          setToast({
            message: `Crédito utilizado. O ${receiptNumber} está pronto para envio, sem nova fatura.`,
            actionLabel: "Ver recibos",
            action: () => {
              setBillingTab("receipts");
              navigate("billing");
            },
          });
        }
        return;
      }

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
                  ? { cancellationReason: booking.note }
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
              ? booking.paymentPreference === "pix"
                ? `Atendimento de ${booking.dogName} concluído e pronto para faturamento.`
                : `Atendimento de ${booking.dogName} concluído.`
              : status === "cancelled"
                ? `Atendimento de ${booking.dogName} cancelado.`
                : previous === "completed"
                  ? `Atendimento de ${booking.dogName} reaberto.`
                : `Situação de ${booking.dogName} atualizada.`,
        });
      }
      return;
    }

    if (status === "completed" && booking.paymentPreference === "credit") {
      if (!creditServiceTypes.includes(booking.serviceType as CreditServiceType)) {
        setToast({
          message:
            "Créditos são válidos para creche, banho, banho e tosa e taxi-dog.",
        });
        return;
      }
      const serviceType = booking.serviceType as CreditServiceType;
      const available = creditBalances[booking.customerId]?.[serviceType] ?? 0;
      if (available < 1) {
        setToast({
          message: `Não há crédito de ${serviceLabels[serviceType].toLowerCase()} disponível. Gere uma fatura ou venda um pacote.`,
        });
        return;
      }

      const receipt: ServiceReceipt = {
        id: `receipt-${crypto.randomUUID()}`,
        number: `REC-${String(32 + receipts.length).padStart(5, "0")}`,
        customerId: booking.customerId,
        customerName: booking.customerName,
        dogName: booking.dogName,
        serviceType,
        service: booking.service,
        date: formatShortDate(booking.date),
        creditUnits: 1,
        remainingBalance: available - 1,
        deliveryStatus: "ready",
      };
      const nextBalances: CreditBalances = {
        ...creditBalances,
        [booking.customerId]: {
          ...(creditBalances[booking.customerId] ?? {
            daycare: 0,
            bath: 0,
            grooming: 0,
          }),
          [serviceType]: available - 1,
        },
      };
      setCreditBalances(nextBalances);
      setCustomers((current) =>
        current.map((customer) =>
          customer.id === booking.customerId
            ? {
                ...customer,
                creditsLabel:
                  totalCredits(nextBalances, customer.id) > 0
                    ? `${totalCredits(nextBalances, customer.id)} créditos disponíveis`
                    : "Sem créditos",
              }
            : customer,
        ),
      );
      setReceipts((current) => [receipt, ...current]);
      setBookings((current) =>
        current.map((item) =>
          item.id === booking.id
            ? {
                ...item,
                status,
                settlementStatus: "credit_used",
                receiptNumber: receipt.number,
              }
            : item,
        ),
      );
      setOpenMenuId(null);
      setToast({
        message: `Crédito utilizado. O recibo ${receipt.number} está pronto para envio.`,
        actionLabel: "Ver recibo",
        action: () => {
          setSelectedReceipt(receipt);
          setDialog("receipt");
        },
      });
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
            }),
            [serviceType]:
              (creditBalances[booking.customerId]?.[serviceType] ?? 0) + 1,
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
      if (booking.settlementStatus === "pix_pending") {
        setBillableServices((current) =>
          current.filter((service) => service.id !== `bill-${booking.id}`),
        );
      }
    }

    if (
      status === "completed" &&
      booking.paymentPreference === "pix" &&
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
          amountCents: booking.priceCents,
        },
        ...current,
      ]);
    }

    setBookings((current) =>
      current.map((item) =>
        item.id === booking.id
          ? {
              ...item,
              note: booking.note,
              status,
              settlementStatus:
                status === "completed"
                  ? "pix_pending"
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
    updateBookingStatus(booking, nextStatus(booking.status));
  }

  function askToCancel(booking: Booking) {
    setBookingToCancel(booking);
    setDialog("cancel");
    setOpenMenuId(null);
  }

  function openBookingEditor(booking: Booking) {
    setBookingToEdit(booking);
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
    const serviceType = String(form.get("serviceType") ?? "") as ServiceType;
    const priceCents = Math.round(Number(form.get("price") ?? 0) * 100);
    if (!date || !time || !serviceType || priceCents < 0) {
      setToast({ message: "Revise os campos do serviço." });
      return;
    }
    if (endTime && endTime <= time) {
      setToast({ message: "O horário final deve ser posterior ao inicial." });
      return;
    }
    const paymentPreference: Booking["paymentPreference"] =
      creditServiceTypes.includes(serviceType as CreditServiceType) &&
      String(form.get("paymentPreference") ?? "pix") === "credit"
        ? "credit"
        : "pix";
    const note = String(form.get("note") ?? "").trim() || undefined;

    if (runtimeMode === "ready" && view !== "portal") {
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
                endDate: date,
                startTime: time,
                endTime: endTime || null,
                serviceCatalogId: service.id,
                priceCents,
                paymentPreference,
                internalNotes: note ?? null,
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
                time,
                endTime: endTime || undefined,
                serviceType,
                service: serviceLabels[serviceType],
                priceCents,
                paymentPreference,
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

  function submitCancellation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bookingToCancel) return;
    const form = new FormData(event.currentTarget);
    const reason = String(form.get("reason") ?? "").trim();
    if (!reason) {
      setToast({ message: "Informe o motivo do cancelamento." });
      return;
    }
    updateBookingStatus(
      { ...bookingToCancel, note: reason },
      "cancelled",
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
    const price = Number(form.get("price") ?? 0);
    const recurrence = String(form.get("recurrence") ?? "none") as
      | "none"
      | "weekly";

    if (!dog || !serviceType || !date || (serviceType !== "transport" && serviceType !== "hotel" && !time)) {
      setToast({ message: "Revise os campos obrigatórios." });
      return;
    }
    if (serviceType === "hotel" && (!endDate || endDate < date || lodgingNights < 0.5 || Math.round(lodgingNights * 2) !== lodgingNights * 2)) {
      setToast({ message: "Informe entrada, saída e diárias em múltiplos de 0,5." });
      return;
    }
    if (endTime && endTime <= time) {
      setToast({ message: "O horário final deve ser posterior ao inicial." });
      return;
    }

    const scheduledDates = recurrenceDates(date, recurrence);
    const priceCents = serviceType === "transport" ? (transportDirection === "round_trip" ? 1_000 : 500) : Math.max(0, Math.round(price * 100));
    const paymentPreference: Booking["paymentPreference"] =
      creditServiceTypes.includes(serviceType as CreditServiceType) &&
      String(form.get("paymentPreference") ?? "pix") === "credit"
        ? "credit"
        : "pix";
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
        async () => {
          const created: Array<{ appointment: { id: string } }> = [];
          try {
            for (const scheduledDate of scheduledDates) {
              created.push(
                await requestJson<{ appointment: { id: string } }>(
                  "/api/appointments",
                  {
                    method: "POST",
                    body: JSON.stringify({
                      dogId: dog.id,
                      serviceCatalogId: service.id,
                      startDate: scheduledDate,
                      endDate: serviceType === "hotel" ? endDate : scheduledDate,
                      startTime: serviceType === "transport" ? undefined : time || undefined,
                      endTime: serviceType === "transport" ? undefined : endTime || undefined,
                      internalNotes: note,
                      paymentPreference,
                      priceCents,
                      transportDirection,
                      lodgingNights: serviceType === "hotel" ? lodgingNights : undefined,
                      depositPercent: serviceType === "hotel" ? depositPercent : undefined,
                    }),
                  },
                ),
              );
            }
          } catch (error) {
            if (created.length > 0) {
              await refreshWorkspace();
              throw new ApiRequestError(
                `${created.length} atendimento(s) foram salvos, mas a sequência não pôde ser concluída. ${
                  error instanceof Error ? error.message : ""
                }`.trim(),
              );
            }
            throw error;
          }
          return created;
        },
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
        setView("agenda");
      }
      return;
    }

    const newBookings: Booking[] = scheduledDates.map((scheduledDate) => ({
        id: `booking-${crypto.randomUUID()}`,
        date: scheduledDate,
        time: serviceType === "transport" ? "Sem horário" : time || "Sem horário",
        endTime: endTime || undefined,
        endDate: serviceType === "hotel" ? endDate : undefined,
        lodgingNights: serviceType === "hotel" ? lodgingNights : undefined,
        depositPercent: serviceType === "hotel" ? depositPercent ?? undefined : undefined,
        dogId: dog.id,
        dogName: dog.name,
        customerId: dog.customerId,
        customerName: dog.customerName,
        service: serviceLabels[serviceType],
        serviceType,
        status: "scheduled",
        priceCents,
        paymentPreference,
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
    setView("agenda");
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

  function toggleBillable(service: BillableService) {
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

  function openCreditPackage(customerId?: string) {
    if (customerId) setCreditCustomerId(customerId);
    setDialog("creditPackage");
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
    const standardValueCents = servicePrices[serviceType] * units;
    setPixState({
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
      },
    });
    setDialog("pix");
  }

  async function saveDefaultPrices(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = { ...servicePrices };
    for (const serviceType of ["hotel", ...creditServiceTypes] as const) {
      const cents = Math.round(Number(form.get(serviceType) ?? 0) * 100);
      if (!Number.isFinite(cents) || cents < 1) {
        setToast({ message: "Revise todos os valores antes de salvar." });
        return;
      }
      next[serviceType] = cents;
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
                hygienic_grooming: next.grooming,
                transport: next.transport,
              },
            }),
          }),
        {
          refresh: true,
          successMessage:
            "Preços padrão salvos. Novos serviços já usarão os valores atualizados.",
        },
      );
      if (result) setServicePrices(next);
      return;
    }

    setServicePrices(next);
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
        `${receipt.creditUnits} crédito pré-pago utilizado.`,
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

  function openPixForSelection() {
    const selectedServices = billableServices.filter((item) =>
      selectedBillables.includes(item.id),
    );
    if (!selectedServices.length) return;
    const customer = customers.find(
      (item) => item.id === selectedServices[0].customerId,
    );
    setPixState({
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
    setDialog("pix");
  }

  function openExistingPix(invoice: Invoice) {
    const creditPurchase = creditPurchases.find(
      (purchase) => purchase.invoiceId === invoice.id,
    );
    const customer = customers.find(
      (item) => item.id === invoice.customerId,
    );
    setPixState({
      step: invoice.status === "paid" ? "paid" : "code",
      kind: creditPurchase ? "credit_package" : "services",
      invoice,
      selectedServices: [],
      customerName: invoice.customerName,
      customerPhone: customer?.phone,
      customerEmail: customer?.email,
      amountCents: invoice.amountCents,
      providerMessage:
        runtimeMode === "ready" && view !== "portal"
          ? "A fatura está registrada e pronta para compartilhar com o cliente."
          : undefined,
      creditPurchase: creditPurchase
        ? {
            customerId: creditPurchase.customerId,
            customerName: creditPurchase.customerName,
            serviceType: creditPurchase.serviceType,
            units: creditPurchase.units,
            amountCents: creditPurchase.amountCents,
            standardValueCents: creditPurchase.standardValueCents,
            invoiceId: creditPurchase.invoiceId,
          }
        : undefined,
    });
    setDialog("pix");
  }

  async function issuePix() {
    if (!pixState) return;

    if (runtimeMode === "ready") {
      if (busyAction) return;
      setBusyAction("issue-pix");
      let registeredInvoice = pixState.invoice;
      try {
        if (!registeredInvoice) {
          if (pixState.kind === "credit_package" && pixState.creditPurchase) {
            const purchase = pixState.creditPurchase;
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
                packageName: `${purchase.units} créditos de ${
                  serviceLabels[purchase.serviceType]
                }`,
                dueDate: operationalToday,
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
              items: `Pacote de ${purchase.units} créditos de ${
                serviceLabels[purchase.serviceType]
              }`,
            };
          } else {
            const response = await requestJson<{
              invoice: {
                id: string;
                invoiceNumber: string;
                accountId: string;
                customerName: string;
                totalCents: number;
              };
            }>("/api/invoices", {
              method: "POST",
              body: JSON.stringify({
                appointmentItemIds: pixState.selectedServices.map(
                  (service) => service.id,
                ),
                dueDate: operationalToday,
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
              items: `${pixState.selectedServices.length} serviços selecionados`,
            };
          }
        }

        setSelectedBillables([]);
        await refreshWorkspace();
        setPixState((current) =>
          current
            ? {
                ...current,
                invoice: registeredInvoice,
                step: "code",
                copyPasteCode: undefined,
                providerMessage:
                  "O PDF está pronto para compartilhar ou salvar no aparelho.",
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
          setPixState((current) =>
            current
              ? {
                  ...current,
                  invoice: registeredInvoice,
                  step: "code",
                  providerMessage:
                    error instanceof Error
                      ? error.message
                      : "A fatura foi registrada, mas não foi possível atualizar a tela.",
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

    const invoice: Invoice =
      pixState.invoice ??
      {
        id: `invoice-${crypto.randomUUID()}`,
        number: String(185 + invoices.length).padStart(6, "0"),
        customerId:
          pixState.creditPurchase?.customerId ??
          pixState.selectedServices[0]?.customerId ??
          "",
        customerName: pixState.customerName,
        amountCents: pixState.amountCents,
        due: "Vence hoje",
        status: "pending",
        items:
          pixState.kind === "credit_package" && pixState.creditPurchase
            ? `Pacote de ${pixState.creditPurchase.units} créditos de ${
                serviceLabels[pixState.creditPurchase.serviceType]
              }`
            : `${pixState.selectedServices.length} serviços selecionados`,
      };
    if (!pixState.invoice) {
      setInvoices((current) => [invoice, ...current]);
      if (pixState.kind === "credit_package" && pixState.creditPurchase) {
        const purchase: CreditPurchase = {
          ...pixState.creditPurchase,
          id: `credit-purchase-${crypto.randomUUID()}`,
          status: "awaiting_pix",
          createdAt: formatShortDate(operationalToday),
          invoiceId: invoice.id,
        };
        setCreditPurchases((current) => [purchase, ...current]);
      }
    }
    setPixState({ ...pixState, invoice, step: "code" });
    setToast({
      message:
        pixState.kind === "credit_package"
          ? "Fatura do pacote criada. Libere os créditos após registrar o pagamento."
          : "Fatura demonstrativa criada.",
    });
  }

  function simulatePixPayment() {
    if (runtimeMode === "ready" && view !== "portal") return;
    if (!pixState?.invoice) return;
    const invoiceId = pixState.invoice.id;
    setInvoices((current) =>
      current.map((invoice) =>
        invoice.id === invoiceId
          ? { ...invoice, status: "paid", due: "Pago agora" }
          : invoice,
      ),
    );
    if (pixState.kind === "credit_package" && pixState.creditPurchase) {
      const purchase = pixState.creditPurchase;
      const currentCustomerBalance = creditBalances[purchase.customerId] ?? {
        daycare: 0,
        bath: 0,
        grooming: 0,
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
        pixState.selectedServices.map((item) => item.id),
      );
      setBillableServices((current) =>
        current.filter((item) => !selectedIds.has(item.id)),
      );
      setSelectedBillables([]);
    }
    setPixState({ ...pixState, step: "paid" });
    setToast({
      message:
        pixState.kind === "credit_package"
          ? "Pagamento confirmado. Os créditos já estão disponíveis para uso."
          : "Pagamento confirmado no ambiente de demonstração.",
    });
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
  const serviceDraftCreditEligible = creditServiceTypes.includes(
    serviceDraftType as CreditServiceType,
  );
  const serviceDraftCreditBalance =
    serviceDraftDog && serviceDraftCreditEligible
      ? (creditBalances[serviceDraftDog.customerId]?.[
          serviceDraftType as CreditServiceType
        ] ?? 0)
      : 0;
  const pendingBillingCount =
    billableServices.length +
    invoices.filter((invoice) => invoice.status !== "paid").length;
  const signedInName =
    workspacePayload?.identity.displayName || "Administração";

  if (view === "portal") {
    return (
      <CustomerPortal
        dogs={demoDogs.filter((dog) => dog.customerId === "customer-marina")}
        invoice={demoInvoices.find((invoice) => invoice.id === "invoice-184")}
        portalTab={portalTab}
        setPortalTab={setPortalTab}
        onExit={() => navigate("today")}
        onOpenPix={(invoice) => openExistingPix(invoice)}
        dialog={dialog}
        pixState={pixState}
        setDialog={setDialog}
        issuePix={issuePix}
        simulatePixPayment={simulatePixPayment}
        setToast={setToast}
        liveMode={false}
      />
    );
  }

  const copy = pageCopy[view];

  return (
    <div className="app-root">
      <a className="skip-link" href="#conteudo-principal">
        Ir para o conteúdo
      </a>

      <aside className="sidebar" aria-label="Navegação principal">
        <button className="brand" onClick={() => navigate("today")}>
          <span className="brand-mark" aria-hidden="true">
            GC
          </span>
          <span>
            <strong>Hospet Quintal <small>HQ</small></strong>
            <small>Operação e cuidados</small>
          </span>
        </button>

        <nav className="side-nav">
          <p className="nav-caption">Trabalho</p>
          {navItems.map((item) => (
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
        <button className="portal-entry" onClick={() => setView("portal")}>
          <span>
            <small>Área do cliente</small>
            Prévia do portal
          </span>
          <span aria-hidden="true">›</span>
        </button>
        <div className="account-card">
          <span className="avatar avatar-forest">
            {initials(signedInName)}
          </span>
          <span>
            <strong>{signedInName}</strong>
            <small>Administrador</small>
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
          <span className="brand-mark">GC</span>
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
        <div
          className={
            runtimeMode === "ready"
              ? "demo-banner private-banner"
              : "demo-banner"
          }
          role="status"
        >
          <span className="demo-label">
            {runtimeMode === "ready"
              ? "Ambiente privado"
              : "Demonstração segura"}
          </span>
          <span>
            {runtimeMode === "ready"
              ? "Agenda e cadastros são salvos na Cloudflare e não ficam no GitHub."
              : "Todos os nomes, contatos e valores são fictícios. Nada aqui é uma cobrança real."}
          </span>
        </div>

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
              onAdvance={advanceBooking}
              onMenu={setOpenMenuId}
              openMenuId={openMenuId}
              onEdit={openBookingEditor}
              onCancel={askToCancel}
              onToggleTask={toggleTask}
              onViewAgenda={() => navigate("agenda")}
              onViewBilling={() => navigate("billing")}
              onOpenPix={openExistingPix}
              onOpenReceipt={openReceipt}
              invoice={invoices.find((item) => item.status !== "paid")}
            />
          )}
          {view === "agenda" && (
            <AgendaView
              bookings={bookings}
              dogs={dogs}
              receipts={receipts}
              selectedDate={selectedDate}
              onDateChange={selectAgendaDate}
              agendaFilter={agendaFilter}
              setAgendaFilter={setAgendaFilter}
              onAdvance={advanceBooking}
              onMenu={setOpenMenuId}
              openMenuId={openMenuId}
              onEdit={openBookingEditor}
              onCancel={askToCancel}
              onOpenReceipt={openReceipt}
              onNewService={() => openServiceDialog()}
            />
          )}
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
                onOpenPix={openExistingPix}
                creditBalances={creditBalances}
                creditPurchases={creditPurchases.filter(
                  (purchase) => purchase.customerId === selectedCustomer.id,
                )}
                receipts={receipts.filter(
                  (receipt) => receipt.customerId === selectedCustomer.id,
                )}
                onAddCredits={() => openCreditPackage(selectedCustomer.id)}
                onOpenReceipt={openReceipt}
                onNewService={() => openServiceDialog()}
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
              onCreatePix={openPixForSelection}
              onOpenPix={openExistingPix}
              onAddCredits={() => openCreditPackage()}
              onOpenReceipt={openReceipt}
            />
          )}
          {view === "activity" && (
            <ActivityView activities={activities} />
          )}
          {view === "settings" && (
            <SettingsView
              prices={servicePrices}
              onSave={saveDefaultPrices}
            />
          )}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Navegação móvel">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "active" : ""}
            onClick={() => navigate(item.id)}
          >
            <span className="mobile-nav-mark" aria-hidden="true" />
            {item.shortLabel}
          </button>
        ))}
      </nav>

      <button className="mobile-fab" onClick={() => openServiceDialog()}>
        <span aria-hidden="true">+</span> Novo serviço
      </button>

      {dialog === "service" && (
        <Dialog
          title="Novo serviço"
          description="Agende um cuidado e defina o valor aplicado."
          onClose={() => setDialog(null)}
        >
          <form className="form-grid" onSubmit={submitService}>
            <label className="field full">
              <span>Cão *</span>
              <select
                name="dogId"
                value={serviceDraftDogId}
                onChange={(event) => {
                  setServiceDraftDogId(event.target.value);
                  setServiceDraftPayment("pix");
                }}
                autoFocus
                required
              >
                <option value="" disabled>
                  Selecione um cão
                </option>
                {dogs.map((dog) => (
                  <option key={dog.id} value={dog.id}>
                    {dog.name} · {dog.customerName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{serviceDraftType === "hotel" ? "Entrada *" : "Data *"}</span>
              <input name="date" type="date" defaultValue={selectedDate} required />
            </label>
            {serviceDraftType === "hotel" && (
              <label className="field">
                <span>Saída *</span>
                <input name="endDate" type="date" defaultValue={selectedDate} required />
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
                  if (
                    !creditServiceTypes.includes(next as CreditServiceType)
                  ) {
                    setServiceDraftPayment("pix");
                  }
                }}
              >
                {Object.entries(serviceLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {serviceDraftType !== "transport" && (
              <>
                <label className="field">
                  <span>{serviceDraftType === "hotel" ? "Horário de entrada (opcional)" : "Horário inicial *"}</span>
                  <input name="time" type="time" defaultValue={serviceDraftType === "daycare" ? "07:30" : "09:00"} required={serviceDraftType !== "hotel"} />
                </label>
                <label className="field">
                  <span>{serviceDraftType === "hotel" ? "Horário de saída (opcional)" : "Horário final"}</span>
                  <input name="endTime" type="time" defaultValue={serviceDraftType === "daycare" ? "19:30" : "17:00"} />
                </label>
              </>
            )}
            {serviceDraftType === "transport" && (
              <label className="field">
                <span>Trajeto *</span>
                <select name="transportDirection" value={serviceDraftTransportDirection} onChange={(event) => setServiceDraftTransportDirection(event.target.value as "one_way" | "round_trip")}>
                  <option value="one_way">Ida · R$ 5,00</option>
                  <option value="round_trip">Ida e volta · R$ 10,00</option>
                </select>
              </label>
            )}
            {serviceDraftType === "hotel" && (
              <>
                <label className="field">
                  <span>Número de diárias *</span>
                  <input name="lodgingNights" type="number" min="0.5" step="0.5" defaultValue="1" required />
                </label>
                <label className="check-field">
                  <input name="hasDeposit" type="checkbox" />
                  <span>Cobrar sinal no check-in</span>
                </label>
                <label className="field">
                  <span>Sinal (%)</span>
                  <input name="depositPercent" type="number" min="1" max="99" defaultValue="50" />
                </label>
              </>
            )}
            <label className="field">
              <span>Valor aplicado (R$) *</span>
              <input
                key={`${serviceDraftType}-${serviceDraftTransportDirection}`}
                name="price"
                type="number"
                min="0"
                step="0.01"
                defaultValue={(serviceDraftType === "transport" ? (serviceDraftTransportDirection === "round_trip" ? 10 : 5) : servicePrices[serviceDraftType] / 100).toFixed(2)}
                readOnly={serviceDraftType === "transport"}
                required
              />
            </label>
            <label className="field">
              <span>Recorrência</span>
              <select name="recurrence" defaultValue="none">
                <option value="none">Não repetir</option>
                <option value="weekly">Toda semana</option>
              </select>
            </label>
            <label className="field full">
              <span>Forma de quitação ao concluir</span>
              <select
                name="paymentPreference"
                value={serviceDraftPayment}
                onChange={(event) =>
                  setServiceDraftPayment(
                    event.target.value as Booking["paymentPreference"],
                  )
                }
              >
                <option value="pix">Gerar fatura</option>
                <option
                  value="credit"
                  disabled={
                    !serviceDraftCreditEligible ||
                    serviceDraftCreditBalance < 1 ||
                    !serviceDraftDog
                  }
                >
                  {serviceDraftCreditEligible && serviceDraftDog
                    ? `Usar 1 crédito (${serviceDraftCreditBalance} disponíveis)`
                    : "Usar 1 crédito"}
                </option>
              </select>
              <small>
                Crédito é aceito para creche, banho, banho e tosa e taxi-dog.
                Sem saldo, a conclusão será interrompida para você revisar.
              </small>
            </label>
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
              <button className="primary-button" type="submit">
                Salvar serviço
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
              <span>Data *</span>
              <input
                name="date"
                type="date"
                defaultValue={bookingToEdit.date}
                autoFocus
                required
              />
            </label>
            <label className="field">
              <span>Serviço *</span>
              <select
                name="serviceType"
                defaultValue={bookingToEdit.serviceType}
                onChange={(event) => {
                  const form = event.currentTarget.form;
                  const price = form?.elements.namedItem("price") as
                    | HTMLInputElement
                    | null;
                  if (price) {
                    price.value = String(
                      servicePrices[event.target.value as ServiceType] / 100,
                    );
                  }
                }}
              >
                {Object.entries(serviceLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Horário inicial *</span>
              <input
                name="time"
                type="time"
                defaultValue={bookingToEdit.time}
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
            <label className="field">
              <span>Valor aplicado (R$) *</span>
              <input
                name="price"
                type="number"
                min="0"
                step="0.01"
                defaultValue={(bookingToEdit.priceCents / 100).toFixed(2)}
                required
              />
            </label>
            <label className="field">
              <span>Quitação ao concluir</span>
              <select
                name="paymentPreference"
                defaultValue={bookingToEdit.paymentPreference}
              >
                <option value="pix">Gerar fatura</option>
                <option value="credit">Usar 1 crédito</option>
              </select>
            </label>
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
              <button className="primary-button" type="submit">
                Salvar alterações
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
                <input
                  name="birthDate"
                  type="date"
                  defaultValue={dogToEdit.birthDate}
                />
              </label>
            ) : (
              <label className="field">
                <span>Idade</span>
                <input name="age" defaultValue={dogToEdit.age} />
              </label>
            )}
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
              <input name="vaccineExpiresOn" type="date" />
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
              <input name="birthDate" type="date" defaultValue={customerToEdit.birthDate} />
            </label>
            <div className="dialog-actions full">
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
              <input name="date" type="date" defaultValue={selectedDate} />
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
              <label className="field"><span>Data de nascimento</span><input name="birthDate" type="date" /></label>
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
                  {bookingToCancel.time} · {bookingToCancel.service}
                </small>
              </span>
            </div>
            <label className="field full">
              <span>Motivo do cancelamento *</span>
              <textarea name="reason" rows={3} autoFocus required />
            </label>
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
          prices={servicePrices}
          onClose={() => setDialog(null)}
          onSubmit={submitCreditPackage}
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

      {dialog === "pix" && pixState && (
        <PixDialog
          state={pixState}
          onClose={() => {
            setDialog(null);
            setPixState(null);
          }}
          onIssue={issuePix}
          onSimulatePayment={simulatePixPayment}
          onFeedback={(message) => setToast({ message })}
          liveMode={runtimeMode === "ready"}
          busy={busyAction === "issue-pix"}
        />
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
          GC
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
          GC
        </span>
        <p className="eyebrow">Acesso administrativo</p>
        <h1>Entre para cuidar da operação.</h1>
        <p>
          Agenda, clientes e financeiro ficam protegidos. Use uma das duas
          contas de administrador cadastradas no primeiro acesso.
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
          GC
        </span>
        <p className="eyebrow">Configuração única</p>
        <h1>Cadastre os dois administradores.</h1>
        <p>
          Esta tela desaparece assim que a configuração é concluída. Depois,
          somente estas duas contas poderão entrar.
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
              em um gerenciador de senhas. Contas de funcionários serão
              adicionadas somente em uma futura atualização.
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
          GC
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
  onAdvance,
  onMenu,
  openMenuId,
  onEdit,
  onCancel,
  onToggleTask,
  onViewAgenda,
  onViewBilling,
  onOpenPix,
  onOpenReceipt,
  invoice,
}: {
  bookings: Booking[];
  dogs: Dog[];
  customers: Customer[];
  tasks: Task[];
  receipts: ServiceReceipt[];
  selectedDate: string;
  onDateChange: (value: string) => void;
  agendaFilter: "all" | "upcoming" | "active" | "completed";
  setAgendaFilter: (
    value: "all" | "upcoming" | "active" | "completed",
  ) => void;
  onAdvance: (booking: Booking) => void;
  onMenu: (id: string | null) => void;
  openMenuId: string | null;
  onEdit: (booking: Booking) => void;
  onCancel: (booking: Booking) => void;
  onToggleTask: (id: string) => void;
  onViewAgenda: () => void;
  onViewBilling: () => void;
  onOpenPix: (invoice: Invoice) => void;
  onOpenReceipt: (receipt: ServiceReceipt) => void;
  invoice?: Invoice;
}) {
  const dayBookings = bookings.filter(
    (booking) => booking.date === selectedDate,
  );
  const visibleBookings = dayBookings.filter(
    (booking) => booking.status !== "cancelled",
  );
  const activeBookings = visibleBookings.filter(
    (booking) =>
      booking.status !== "completed" && booking.status !== "cancelled",
  );
  const presentDogs = visibleBookings.filter((booking) =>
    ["present", "in_service"].includes(booking.status),
  );
  const filteredBookings = filterBookings(dayBookings, agendaFilter).filter(
    (booking) => booking.status !== "cancelled",
  );
  const isToday = selectedDate === operationalToday;
  const alertsForDay = new Set(
    visibleBookings
      .filter((booking) =>
        dogs.find((dog) => dog.id === booking.dogId)?.alert,
      )
      .map((booking) => booking.dogId),
  ).size;
  const birthdays = customers.filter((customer) => customer.birthDate?.slice(5) === selectedDate.slice(5));
  const dogBirthdays = dogs.filter((dog) => dog.birthDate?.slice(5) === selectedDate.slice(5));
  const vaccineAlerts = dogs.flatMap((dog) => (dog.vaccines ?? []).filter((vaccine) => vaccine.expiresOn >= selectedDate && vaccine.expiresOn <= shiftDate(selectedDate, 30)).map((vaccine) => ({ dog, vaccine })));

  return (
    <>
      <section className="day-heading">
        <div>
          <p>{isToday ? formatToday() : formatSelectedDate(selectedDate)}</p>
          <span>São Paulo · horário local</span>
        </div>
        <button className="quiet-button" onClick={onViewAgenda}>
          Ver agenda completa
        </button>
      </section>

      <DateNavigator value={selectedDate} onChange={onDateChange} />

      {isToday && (birthdays.length || dogBirthdays.length || vaccineAlerts.length) ? (
        <section className="panel attention-panel">
          <p className="section-kicker">Alertas de hoje</p>
          <h2>Datas e vacinas importantes</h2>
          <div className="alert-list">
            {birthdays.map((customer) => <p key={`customer-${customer.id}`}>🎂 Aniversário de {customer.name}</p>)}
            {dogBirthdays.map((dog) => <p key={`dog-${dog.id}`}>🎈 Aniversário de {dog.name}</p>)}
            {vaccineAlerts.map(({ dog, vaccine }) => <p key={`${dog.id}-${vaccine.name}-${vaccine.expiresOn}`}>💉 {vaccine.name} de {dog.name} vence em {formatShortDate(vaccine.expiresOn)}</p>)}
          </div>
        </section>
      ) : null}

      <section
        className="summary-strip"
        aria-label={`Resumo de ${formatSelectedDate(selectedDate)}`}
      >
        <SummaryItem value={activeBookings.length} label="programados" />
        <SummaryItem
          value={isToday ? presentDogs.length : visibleBookings.length}
          label={isToday ? "presentes" : "serviços no dia"}
        />
        <SummaryItem
          value={
            visibleBookings.filter(
              (booking) =>
                booking.serviceType === "transport" &&
                booking.status !== "completed",
            ).length
          }
          label="transportes"
        />
        <SummaryItem
          value={
            visibleBookings.filter(
              (booking) => booking.status === "completed",
            ).length
          }
          label="concluídos"
        />
        <SummaryItem value={alertsForDay} label="alertas" attention />
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
            <AgendaFilters value={agendaFilter} onChange={setAgendaFilter} />
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
          <section className="panel compact-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">
                  {isToday ? "Presença" : "Planejamento"}
                </p>
                <h2>{isToday ? "No local agora" : "Programados neste dia"}</h2>
              </div>
              <span className="soft-count">
                {isToday ? presentDogs.length : visibleBookings.length}
              </span>
            </div>
            <div className="presence-list">
              {(isToday ? presentDogs : visibleBookings).map((booking) => {
                const dog = dogs.find((item) => item.id === booking.dogId);
                return (
                  <div className="presence-row" key={booking.id}>
                    <DogAvatar dog={dog} size="small" />
                    <span>
                      <strong>{booking.dogName}</strong>
                      <small>
                        {booking.time} · {booking.service}
                      </small>
                    </span>
                    <span className="presence-dot">
                      {isToday ? "Presente" : "Previsto"}
                    </span>
                  </div>
                );
              })}
              {(isToday ? presentDogs : visibleBookings).length === 0 && (
                <EmptyState
                  title="Nenhum cão nesta lista"
                  description={
                    isToday
                      ? "As chegadas registradas aparecerão aqui."
                      : "Não há serviços programados para este dia."
                  }
                />
              )}
            </div>
          </section>

          {alertsForDay > 0 && (
            <section className="panel compact-panel attention-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Cuidados</p>
                <h2>Requer atenção</h2>
              </div>
                <span className="attention-count">{alertsForDay}</span>
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
                    <span className="attention-mark" aria-hidden="true">
                      !
                    </span>
                    <span>
                      <strong>{dog?.name} · alerta</strong>
                      <small>{dog?.alert}</small>
                    </span>
                  </div>
                ))}
            </section>
          )}

          <section className="panel compact-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Equipe</p>
                <h2>Tarefas</h2>
              </div>
              <span className="soft-count">
                {tasks.filter((task) => !task.completed).length}
              </span>
            </div>
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
                <button className="text-button" onClick={() => onOpenPix(invoice)}>
                  Ver cobrança
                </button>
                <button className="text-button muted" onClick={onViewBilling}>
                  Abrir financeiro
                </button>
              </div>
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
            <input
              type="date"
              value={value}
              onChange={(event) => onChange(event.target.value)}
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
          const parsed = dateFromIso(date);
          const weekday = new Intl.DateTimeFormat("pt-BR", {
            weekday: "short",
            timeZone: "America/Sao_Paulo",
          })
            .format(parsed)
            .replace(".", "");
          return (
            <button
              key={date}
              className={value === date ? "active" : ""}
              onClick={() => onChange(date)}
              aria-pressed={value === date}
            >
              <span>{index === 0 ? "Hoje" : index === 1 ? "Amanhã" : weekday}</span>
              <strong>{parsed.getDate()}</strong>
              <small>
                {new Intl.DateTimeFormat("pt-BR", {
                  month: "short",
                  timeZone: "America/Sao_Paulo",
                })
                  .format(parsed)
                  .replace(".", "")}
              </small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AgendaView({
  bookings,
  dogs,
  selectedDate,
  onDateChange,
  agendaFilter,
  setAgendaFilter,
  onAdvance,
  onMenu,
  openMenuId,
  onEdit,
  onCancel,
  onOpenReceipt,
  receipts,
  onNewService,
}: {
  bookings: Booking[];
  dogs: Dog[];
  selectedDate: string;
  onDateChange: (value: string) => void;
  agendaFilter: "all" | "upcoming" | "active" | "completed";
  setAgendaFilter: (
    value: "all" | "upcoming" | "active" | "completed",
  ) => void;
  onAdvance: (booking: Booking) => void;
  onMenu: (id: string | null) => void;
  openMenuId: string | null;
  onEdit: (booking: Booking) => void;
  onCancel: (booking: Booking) => void;
  onOpenReceipt: (receipt: ServiceReceipt) => void;
  receipts: ServiceReceipt[];
  onNewService: () => void;
}) {
  const dayBookings = bookings.filter(
    (booking) => booking.date === selectedDate,
  );
  const filtered = filterBookings(dayBookings, agendaFilter);
  return (
    <div className="agenda-page">
      <DateNavigator value={selectedDate} onChange={onDateChange} />
      <section className="panel full-panel">
        <div className="panel-heading agenda-heading">
          <div>
            <p className="section-kicker">
              {selectedDate === operationalToday ? "Hoje" : "Dia selecionado"}
            </p>
            <h2>{formatSelectedDate(selectedDate)}</h2>
          </div>
          <div className="heading-actions">
            <AgendaFilters value={agendaFilter} onChange={setAgendaFilter} />
            <button className="primary-button compact-button" onClick={onNewService}>
              + Novo serviço
            </button>
          </div>
        </div>
        <div className="agenda-day-divider">
          <span>Atendimentos do dia</span>
          <span>
            {
              dayBookings.filter(
                (booking) => booking.status !== "cancelled",
              ).length
            }{" "}
            itens
          </span>
        </div>
        <div className="agenda-list spacious">
          {filtered
            .filter((booking) => booking.status !== "cancelled")
            .map((booking) => (
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
            />
          ))}
          {!filtered.filter((booking) => booking.status !== "cancelled").length && (
            <EmptyState
              title="Dia livre"
              description="Não há serviços com este filtro para o dia selecionado."
            />
          )}
        </div>
        {dayBookings.some((booking) => booking.status === "cancelled") && (
          <details className="cancelled-section">
            <summary>
              Cancelados (
              {
                dayBookings.filter(
                  (booking) => booking.status === "cancelled",
                ).length
              }
              )
            </summary>
            {dayBookings
              .filter((booking) => booking.status === "cancelled")
              .map((booking) => (
              <AgendaCard
                key={booking.id}
                booking={booking}
                dog={dogs.find((dog) => dog.id === booking.dogId)}
                onAdvance={onAdvance}
                openMenu={false}
                onMenu={() => undefined}
                onEdit={onEdit}
                onCancel={onCancel}
              />
            ))}
          </details>
        )}
      </section>
    </div>
  );
}

function AgendaFilters({
  value,
  onChange,
}: {
  value: "all" | "upcoming" | "active" | "completed";
  onChange: (value: "all" | "upcoming" | "active" | "completed") => void;
}) {
  const filters = [
    ["all", "Todos"],
    ["upcoming", "A iniciar"],
    ["active", "Em andamento"],
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

function filterBookings(
  bookings: Booking[],
  filter: "all" | "upcoming" | "active" | "completed",
) {
  if (filter === "upcoming") {
    return bookings.filter((booking) =>
      ["scheduled", "confirmed"].includes(booking.status),
    );
  }
  if (filter === "active") {
    return bookings.filter((booking) =>
      ["present", "in_service", "in_transit"].includes(booking.status),
    );
  }
  if (filter === "completed") {
    return bookings.filter((booking) => booking.status === "completed");
  }
  return bookings;
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
}) {
  const action =
    booking.date > operationalToday &&
    booking.status !== "scheduled" &&
    booking.status !== "completed"
      ? null
      : primaryAction(booking.status);
  return (
    <article
      className={`agenda-card service-${booking.serviceType} status-${booking.status}`}
    >
      <div className="time-block">
        <strong>{booking.time}</strong>
        <span>{booking.endTime ? `até ${booking.endTime}` : "Sem fim"}</span>
      </div>
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
        {booking.paymentPreference === "credit" &&
          booking.settlementStatus !== "credit_used" && (
            <span className="settlement-note credit">
              Usará 1 crédito ao concluir
            </span>
          )}
        {booking.settlementStatus === "credit_used" && (
          <span className="settlement-note settled">
            Quitado com 1 crédito · sem nova fatura
          </span>
        )}
        {booking.settlementStatus === "pix_pending" && (
          <span className="settlement-note pix">
            Serviço pronto para faturamento
          </span>
        )}
        {booking.note && <span className="care-note">{booking.note}</span>}
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

function DogProfile({
  dog,
  creditBalances,
  bookings,
  onBack,
  onEdit,
  onNewService,
}: {
  dog: Dog;
  creditBalances: CreditBalances;
  bookings: Booking[];
  onBack: () => void;
  onEdit: () => void;
  onNewService: () => void;
}) {
  const [tab, setTab] = useState("Resumo");
  const balances = creditBalances[dog.customerId] ?? {
    daycare: 0,
    bath: 0,
    grooming: 0,
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
        {["Resumo", "Agenda e histórico", "Saúde e cuidados", "Documentos"].map(
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
                <strong>
                  {dog.name === "Mel"
                    ? "Ração própria · 2 porções"
                    : "Rotina cadastrada"}
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
                  <span>Tosa higiênica</span>
                  <strong>{balances.grooming}</strong>
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
          <div className="timeline">
            {bookings.map((booking) => (
              <div className="timeline-item" key={booking.id}>
                <span className={`timeline-dot service-${booking.serviceType}`} />
                <div>
                  <small>
                    {formatShortDate(booking.date)} · {booking.time}
                  </small>
                  <strong>{booking.service}</strong>
                  <p>{statusLabels[booking.status]}</p>
                </div>
                <span>{formatCurrency(booking.priceCents)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {tab === "Saúde e cuidados" && (
        <section className="panel full-panel info-state">
          <p className="section-kicker">Cuidados compartilhados com a equipe</p>
          <h3>Informações essenciais</h3>
          <div className="detail-list two-columns">
            <div>
              <span>Vacinas</span>
              <strong>
                {dog.vaccinesCurrent ? "Em dia" : "Comprovante pendente"}
              </strong>
            </div>
            <div>
              <span>Temperamento</span>
              <strong>Sociável, adaptação gradual</strong>
            </div>
            <div>
              <span>Alimentação</span>
              <strong>Rotina cadastrada</strong>
            </div>
            <div>
              <span>Medicação</span>
              <strong>Nenhuma contínua</strong>
            </div>
          </div>
        </section>
      )}
      {tab === "Documentos" && (
        <section className="panel full-panel">
          <EmptyState
            title="Arquivos privados"
            description="Documentos serão guardados no armazenamento privado da Cloudflare após a conexão do ambiente."
          />
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
  return (
    <section className="panel full-panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Relacionamento</p>
          <h2>{customers.length} clientes ativos</h2>
        </div>
        <button className="secondary-button" onClick={onNew}>
          + Novo cliente
        </button>
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
                  {dogs
                    .filter((dog) => customer.dogIds.includes(dog.id))
                    .map((dog) => dog.name)
                    .join(", ") || "Nenhum"}
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
              {dogs
                .filter((dog) => customer.dogIds.includes(dog.id))
                .map((dog) => dog.name)
                .join(", ") || "Nenhum cão"}
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
  onOpenPix,
  onAddCredits,
  onOpenReceipt,
  onNewService,
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
  onOpenPix: (invoice: Invoice) => void;
  onAddCredits: () => void;
  onOpenReceipt: (receipt: ServiceReceipt) => void;
  onNewService: () => void;
}) {
  const [tab, setTab] = useState("Resumo");
  const balances = creditBalances[customer.id] ?? {
    daycare: 0,
    bath: 0,
    grooming: 0,
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
          <button className="secondary-button" onClick={onEdit}>
            Editar
          </button>
          <button className="primary-button" onClick={onNewService}>
            + Novo serviço
          </button>
        </div>
      </section>
      <div className="tabs" role="tablist" aria-label="Perfil do cliente">
        {["Resumo", "Serviços", "Financeiro e créditos", "Documentos"].map(
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
                <span>Créditos</span>
                <strong>{customer.creditsLabel}</strong>
              </div>
            </div>
          </section>
        </div>
      )}
      {tab === "Serviços" && (
        <section className="panel full-panel">
          <div className="timeline">
            {dogs.flatMap((dog) =>
              bookings
                .filter((booking) => booking.dogId === dog.id)
                .map((booking) => (
                  <div className="timeline-item" key={booking.id}>
                    <DogAvatar dog={dog} size="small" />
                    <div>
                      <small>
                        {formatShortDate(booking.date)} · {booking.time}
                      </small>
                      <strong>
                        {dog.name} · {booking.service}
                      </strong>
                      <p>{statusLabels[booking.status]}</p>
                    </div>
                    <span>{formatCurrency(booking.priceCents)}</span>
                  </div>
                )),
            )}
          </div>
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
                          onClick={() => onOpenPix(invoice)}
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
              <button className="text-button" onClick={onAddCredits}>
                Vender pacote
              </button>
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
                <span>Tosa higiênica</span>
                <strong>{balances.grooming}</strong>
              </div>
            </div>
            <p className="ledger-note">
              O saldo é calculado pelo extrato e não pode ser alterado sem uma
              movimentação registrada.
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
                          : purchase.status === "awaiting_pix"
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
                        ? "Enviado"
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
      {tab === "Documentos" && (
        <section className="panel full-panel">
          <EmptyState
            title="Nenhum documento compartilhado"
            description="Arquivos privados só aparecerão após a conexão segura com o R2."
          />
        </section>
      )}
    </div>
  );
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
  onCreatePix,
  onOpenPix,
  onAddCredits,
  onOpenReceipt,
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
  onCreatePix: () => void;
  onOpenPix: (invoice: Invoice) => void;
  onAddCredits: () => void;
  onOpenReceipt: (receipt: ServiceReceipt) => void;
}) {
  const selectedTotal = billableServices
    .filter((item) => selectedBillables.includes(item.id))
    .reduce((total, item) => total + item.amountCents, 0);
  const pendingTotal = invoices
    .filter((invoice) => invoice.status !== "paid")
    .reduce((total, invoice) => total + invoice.amountCents, 0);
  const openInvoiceCount = invoices.filter(
    (invoice) => invoice.status !== "paid",
  ).length;
  const paidInvoices = invoices.filter((invoice) => invoice.status === "paid");
  const recordedPaidTotal = paidInvoices.reduce(
    (total, invoice) => total + invoice.amountCents,
    0,
  );
  const availableCredits = customers.reduce(
    (total, customer) => total + totalCredits(creditBalances, customer.id),
    0,
  );
  const awaitingPackages = creditPurchases.filter(
    (purchase) => purchase.status === "awaiting_pix",
  ).length;

  return (
    <div className="billing-page">
      <section className="finance-summary">
        <div>
          <span>A receber</span>
          <strong>{formatCurrency(pendingTotal)}</strong>
          <small>
            {openInvoiceCount}{" "}
            {openInvoiceCount === 1 ? "cobrança aberta" : "cobranças abertas"}
          </small>
        </div>
        <div>
          <span>Recebido registrado</span>
          <strong>{formatCurrency(recordedPaidTotal)}</strong>
          <small>
            {paidInvoices.length}{" "}
            {paidInvoices.length === 1 ? "cobrança paga" : "cobranças pagas"} ·
            por fatura
          </small>
        </div>
        <div>
          <span>Serviços a cobrar</span>
          <strong>{billableServices.length}</strong>
          <small>
            {formatCurrency(
              billableServices.reduce(
                (total, service) => total + service.amountCents,
                0,
              ),
            )}{" "}
            disponíveis
          </small>
        </div>
        <div>
          <span>Créditos disponíveis</span>
          <strong>{availableCredits}</strong>
          <small>{awaitingPackages} pacotes com fatura pendente</small>
        </div>
      </section>

      <div className="tabs billing-tabs" role="tablist" aria-label="Financeiro">
        {[
          ["pix", "Faturas"],
          ["credits", "Pacotes e créditos"],
          ["receipts", "Recibos"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => onTabChange(id as BillingTab)}
            role="tab"
            aria-selected={tab === id}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "pix" && (
        <>
          <section className="panel full-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Aguardando faturamento</p>
                <h2>Serviços concluídos</h2>
              </div>
              <span className="pix-only-badge">
                Faturas para compartilhamento
              </span>
            </div>
            {billableServices.length ? (
              <div className="billable-list">
                {billableServices.map((service) => {
                  const checked = selectedBillables.includes(service.id);
                  const first = billableServices.find(
                    (item) => item.id === selectedBillables[0],
                  );
                  const disabled =
                    Boolean(first) && first?.customerId !== service.customerId;
                  return (
                    <label
                      className={
                        disabled ? "billable-row disabled" : "billable-row"
                      }
                      key={service.id}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => onToggleBillable(service)}
                      />
                      <span className="billable-date">{service.date}</span>
                      <span>
                        <strong>{service.dogName}</strong>
                        <small>{service.customerName}</small>
                      </span>
                      <span>{service.service}</span>
                      <strong>{formatCurrency(service.amountCents)}</strong>
                    </label>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title="Tudo faturado"
                description="Não há serviços concluídos aguardando cobrança."
              />
            )}
          </section>

          <section className="panel full-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Histórico</p>
                <h2>Cobranças recentes</h2>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table invoices-table">
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>Cliente</th>
                    <th>Itens</th>
                    <th>Vencimento</th>
                    <th>Valor</th>
                    <th>Situação</th>
                    <th>
                      <span className="sr-only">Ação</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>#{invoice.number}</td>
                      <td>
                        <strong>{invoice.customerName}</strong>
                      </td>
                      <td>{invoice.items}</td>
                      <td>{invoice.due}</td>
                      <td>
                        <strong>{formatCurrency(invoice.amountCents)}</strong>
                      </td>
                      <td>
                        <InvoiceStatus invoice={invoice} />
                      </td>
                      <td>
                        <button
                          className="row-link"
                          onClick={() => onOpenPix(invoice)}
                        >
                          {invoice.status === "pending" ? "Ver fatura" : "Detalhes"}
                        </button>
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
            <button className="primary-button" onClick={onAddCredits}>
              + Vender pacote de créditos
            </button>
          </section>

          <section className="panel full-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Saldos atuais</p>
                <h2>Créditos por cliente</h2>
              </div>
            </div>
            <div className="credit-balance-grid">
              {customers.map((customer) => {
                const balance = creditBalances[customer.id] ?? {
                  daycare: 0,
                  bath: 0,
                  grooming: 0,
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
                        <span>Tosa higiênica</span>
                        <strong>{balance.grooming}</strong>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
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
                    <th>Valor padrão</th>
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
                              : purchase.status === "awaiting_pix"
                                ? "pending"
                                : "neutral"
                          }`}
                        >
                          {purchase.status === "paid"
                            ? "Liberado"
                            : purchase.status === "awaiting_pix"
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

      {tab === "receipts" && (
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
                    {receipt.deliveryStatus === "sent" ? "Enviado" : "Pronto"}
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

      {tab === "pix" && selectedBillables.length > 0 && (
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
          <button className="primary-button" onClick={onCreatePix}>
            Criar fatura
          </button>
        </div>
      )}
    </div>
  );
}

function SettingsView({
  prices,
  onSave,
}: {
  prices: Record<ServiceType, number>;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const settings: {
    serviceType: "hotel" | CreditServiceType;
    title: string;
    description: string;
    unit: string;
  }[] = [
    {
      serviceType: "hotel",
      title: "Diária do hotel",
      description: "Valor sugerido para cada diária de hospedagem.",
      unit: "por diária",
    },
    {
      serviceType: "daycare",
      title: "Creche",
      description: "Valor sugerido para uma diária de creche.",
      unit: "por diária",
    },
    {
      serviceType: "bath",
      title: "Banho",
      description: "Valor sugerido ao criar um novo banho.",
      unit: "por serviço",
    },
    {
      serviceType: "grooming",
      title: "Banho e tosa",
      description: "Valor sugerido ao criar um novo banho e tosa.",
      unit: "por serviço",
    },
    {
      serviceType: "transport",
      title: "Taxi-dog · ida",
      description: "Valor padrão para uma ida (ida e volta: R$ 10,00).",
      unit: "por ida",
    },
  ];

  return (
    <div className="settings-page">
      <section className="panel settings-intro">
        <span className="settings-lock" aria-hidden="true">
          ADM
        </span>
        <div>
          <p className="section-kicker">Acesso de administrador</p>
          <h2>Preços padrão</h2>
          <p>
            Estes valores preenchem automaticamente novos serviços. A equipe
            ainda pode aplicar um valor diferente em um atendimento específico
            sem mudar o padrão.
          </p>
          <p><strong>Creche:</strong> horário padrão de 07:30 às 19:30.</p>
        </div>
      </section>

      <form className="panel settings-form" onSubmit={onSave}>
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Tabela principal</p>
            <h2>Valores sugeridos</h2>
          </div>
          <span className="pix-only-badge">Valores em reais</span>
        </div>
        <div className="price-settings-grid">
          {settings.map((setting) => (
            <label className="price-setting-card" key={setting.serviceType}>
              <span>
                <strong>{setting.title}</strong>
                <small>{setting.description}</small>
              </span>
              <span className="currency-input">
                <span>R$</span>
                <input
                  name={setting.serviceType}
                  type="number"
                  min="0.01"
                  step="0.01"
                  defaultValue={(prices[setting.serviceType] / 100).toFixed(2)}
                  required
                />
              </span>
              <small className="price-unit">{setting.unit}</small>
            </label>
          ))}
        </div>
        <div className="settings-actions">
          <span>
            A alteração vale para novos lançamentos. Serviços já salvos mantêm
            o valor original.
          </span>
          <button className="primary-button" type="submit">
            Salvar preços padrão
          </button>
        </div>
      </form>
    </div>
  );
}

function InvoiceStatus({ invoice }: { invoice: Invoice }) {
  if (invoice.status === "paid") {
    return <span className="status-pill success">Pago</span>;
  }
  if (invoice.status === "overdue") {
    return <span className="status-pill overdue">Vencido</span>;
  }
  return <span className="status-pill pending">Fatura pendente</span>;
}

function ActivityView({ activities }: { activities: AuditActivity[] }) {
  return (
    <section className="panel full-panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Hoje</p>
          <h2>Registro de atividades</h2>
        </div>
        <span className="audit-badge">Histórico protegido</span>
      </div>
      {activities.length ? (
        <div className="audit-list">
          {activities.map((event) => (
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
          title="Nenhuma atividade registrada ainda"
          description="As ações importantes aparecerão aqui conforme a equipe usar o sistema."
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

function CustomerPortal({
  dogs,
  invoice,
  portalTab,
  setPortalTab,
  onExit,
  onOpenPix,
  dialog,
  pixState,
  setDialog,
  issuePix,
  simulatePixPayment,
  setToast,
  liveMode,
}: {
  dogs: Dog[];
  invoice?: Invoice;
  portalTab: string;
  setPortalTab: (value: string) => void;
  onExit: () => void;
  onOpenPix: (invoice: Invoice) => void;
  dialog: DialogKind;
  pixState: PixState | null;
  setDialog: (value: DialogKind) => void;
  issuePix: () => void;
  simulatePixPayment: () => void;
  setToast: (toast: ToastState) => void;
  liveMode: boolean;
}) {
  const tabs = ["Início", "Meus cães", "Serviços", "Pagamentos", "Minha conta"];
  return (
    <div className="portal-root">
      <div className="portal-preview-banner">
        <span>
          <strong>Prévia do portal do cliente.</strong> Dados fictícios e acesso
          ainda não conectado.
        </span>
        <button onClick={onExit}>Voltar à administração</button>
      </div>
      <header className="portal-header">
        <div className="brand">
          <span className="brand-mark">GC</span>
          <span>
            <strong>Hospet Quintal <small>HQ</small></strong>
            <small>Portal do cliente</small>
          </span>
        </div>
        <nav aria-label="Portal do cliente">
          {tabs.map((tab) => (
            <button
              key={tab}
              className={portalTab === tab ? "active" : ""}
              onClick={() => setPortalTab(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>
        <span className="portal-account">
          <span className="avatar avatar-neutral">MC</span>
          Marina
        </span>
      </header>
      <main className="portal-content">
        <section className="portal-welcome">
          <p className="eyebrow">Sua família canina</p>
          <h1>Olá, Marina.</h1>
          <p>
            Acompanhe os próximos cuidados e pagamentos da sua família canina.
          </p>
        </section>
        {portalTab === "Início" && (
          <>
            {invoice && (
              <section className="portal-invoice">
                <div>
                  <p className="section-kicker">Pagamento pendente</p>
                  <strong>{formatCurrency(invoice.amountCents)} em fatura</strong>
                  <span>{invoice.due}</span>
                  <small>{invoice.items}</small>
                </div>
                <button className="light-button" onClick={() => onOpenPix(invoice)}>
                  Ver cobrança
                </button>
              </section>
            )}
            <div className="portal-grid">
              <section className="portal-card next-care">
                <div className="panel-heading">
                  <div>
                    <p className="section-kicker">Agenda</p>
                    <h2>Próximos cuidados</h2>
                  </div>
                </div>
                <div className="portal-care-row">
                  <span className="portal-date">
                    <strong>30</strong>
                    JUL
                  </span>
                  <DogAvatar dog={dogs[0]} size="small" />
                  <span>
                    <strong>Bento · Creche</strong>
                    <small>08:30–17:30 · Transporte de ida</small>
                  </span>
                  <span className="status-pill confirmed">Confirmado</span>
                </div>
                <div className="portal-care-row">
                  <span className="portal-date">
                    <strong>30</strong>
                    JUL
                  </span>
                  <DogAvatar dog={dogs[1]} size="small" />
                  <span>
                    <strong>Lola · Tosa higiênica</strong>
                    <small>10:00–10:40</small>
                  </span>
                  <span className="status-pill scheduled">Agendado</span>
                </div>
              </section>
              <section className="portal-card">
                <div className="panel-heading">
                  <div>
                    <p className="section-kicker">Família</p>
                    <h2>Meus cães</h2>
                  </div>
                </div>
                <div className="portal-dogs">
                  {dogs.map((dog) => (
                    <button key={dog.id} onClick={() => setPortalTab("Meus cães")}>
                      <DogAvatar dog={dog} size="large" />
                      <strong>{dog.name}</strong>
                      <small>{dog.breed}</small>
                    </button>
                  ))}
                </div>
              </section>
              <section className="portal-card">
                <div className="panel-heading">
                  <div>
                    <p className="section-kicker">Pré-pagos</p>
                    <h2>Créditos disponíveis</h2>
                  </div>
                </div>
                <div className="credit-list portal-credits">
                  <div>
                    <span>Creche</span>
                    <strong>4</strong>
                  </div>
                  <div>
                    <span>Tosa higiênica</span>
                    <strong>2</strong>
                  </div>
                  <div>
                    <span>Banho</span>
                    <strong>1</strong>
                  </div>
                </div>
              </section>
            </div>
          </>
        )}
        {portalTab === "Meus cães" && (
          <section className="portal-card portal-wide">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Perfis compartilhados</p>
                <h2>Bento e Lola</h2>
              </div>
            </div>
            <div className="portal-dog-profiles">
              {dogs.map((dog) => (
                <div key={dog.id}>
                  <DogAvatar dog={dog} size="large" />
                  <span>
                    <strong>{dog.name}</strong>
                    <small>
                      {dog.breed} · {dog.age}
                    </small>
                  </span>
                  <span className="status-pill success">Vacinas em dia</span>
                </div>
              ))}
            </div>
          </section>
        )}
        {portalTab === "Serviços" && (
          <section className="portal-card portal-wide">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Histórico recente</p>
                <h2>Serviços</h2>
              </div>
            </div>
            <div className="timeline">
              {demoBookings
                .filter((booking) => ["dog-bento", "dog-lola"].includes(booking.dogId))
                .map((booking) => (
                  <div className="timeline-item" key={booking.id}>
                    <DogAvatar
                      dog={dogs.find((dog) => dog.id === booking.dogId)}
                      size="small"
                    />
                    <div>
                      <small>{formatShortDate(booking.date)}</small>
                      <strong>
                        {booking.dogName} · {booking.service}
                      </strong>
                      <p>{statusLabels[booking.status]}</p>
                    </div>
                    <span>{formatCurrency(booking.priceCents)}</span>
                  </div>
                ))}
            </div>
          </section>
        )}
        {portalTab === "Pagamentos" && (
          <section className="portal-card portal-wide">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Cobranças</p>
                <h2>Faturas e pagamentos</h2>
              </div>
            </div>
            {invoice && (
              <div className="portal-payment-row">
                <span>
                  <strong>Cobrança #{invoice.number}</strong>
                  <small>{invoice.items}</small>
                </span>
                <strong>{formatCurrency(invoice.amountCents)}</strong>
                <InvoiceStatus invoice={invoice} />
                <button className="text-button" onClick={() => onOpenPix(invoice)}>
                  Ver cobrança
                </button>
              </div>
            )}
          </section>
        )}
        {portalTab === "Minha conta" && (
          <section className="portal-card portal-wide account-details">
            <div>
              <span>Nome</span>
              <strong>Marina Costa</strong>
            </div>
            <div>
              <span>WhatsApp</span>
              <strong>(11) 90000-1001</strong>
            </div>
            <div>
              <span>E-mail</span>
              <strong>marina.costa@example.com</strong>
            </div>
            <button
              className="secondary-button"
              onClick={() =>
                setToast({
                  message:
                    "Solicitação preparada. Nenhuma mensagem foi enviada na demonstração.",
                })
              }
            >
              Solicitar alteração
            </button>
          </section>
        )}
      </main>
      {dialog === "pix" && pixState && (
        <PixDialog
          state={pixState}
          onClose={() => setDialog(null)}
          onIssue={issuePix}
          onSimulatePayment={simulatePixPayment}
          onFeedback={(message) => setToast({ message })}
          liveMode={liveMode}
          busy={false}
        />
      )}
    </div>
  );
}

function CreditPackageDialog({
  customers,
  initialCustomerId,
  prices,
  onClose,
  onSubmit,
}: {
  customers: Customer[];
  initialCustomerId: string;
  prices: Record<ServiceType, number>;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [serviceType, setServiceType] =
    useState<CreditServiceType>("daycare");
  const [units, setUnits] = useState(5);
  const [packagePrice, setPackagePrice] = useState(
    ((prices.daycare * 5 * 0.9) / 100).toFixed(2),
  );
  const standardValueCents = prices[serviceType] * units;
  const packageValueCents = Math.max(
    0,
    Math.round(Number(packagePrice || 0) * 100),
  );
  const differenceCents = standardValueCents - packageValueCents;

  function updateSuggestedPrice(
    nextServiceType: CreditServiceType,
    nextUnits: number,
  ) {
    setPackagePrice(
      ((prices[nextServiceType] * nextUnits * 0.9) / 100).toFixed(2),
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
            defaultValue={initialCustomerId}
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
              const next = event.target.value as CreditServiceType;
              setServiceType(next);
              updateSuggestedPrice(next, units);
            }}
          >
            {creditServiceTypes.map((type) => (
              <option key={type} value={type}>
                {serviceLabels[type]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
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
        </label>
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
            <span>Valor padrão equivalente</span>
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
            <strong>{receipt.creditUnits} crédito utilizado</strong>
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

function PixDialog({
  state,
  onClose,
  onIssue,
  onSimulatePayment,
  onFeedback,
  liveMode,
  busy,
}: {
  state: PixState;
  onClose: () => void;
  onIssue: () => void;
  onSimulatePayment: () => void;
  onFeedback: (message: string) => void;
  liveMode: boolean;
  busy: boolean;
}) {
  const [deliveryBusy, setDeliveryBusy] =
    useState<InvoiceDeliveryChannel | null>(null);
  const demoCode = `DEMONSTRACAO-PIX-NAO-VALIDO-${
    state.invoice?.number ?? "NOVA-COBRANCA"
  }`;

  async function handleDelivery(channel: InvoiceDeliveryChannel) {
    if (deliveryBusy) return;
    setDeliveryBusy(channel);
    try {
      const result = await deliverInvoice(state, channel);
      if (result === "saved") {
        onFeedback("Fatura salva nos arquivos ou downloads deste aparelho.");
      } else if (result === "shared") {
        onFeedback("Fatura entregue ao menu de compartilhamento.");
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
                    Valor padrão:{" "}
                    {formatCurrency(state.creditPurchase.standardValueCents)}
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
          <div className="review-total">
            <span>Total</span>
            <strong>{formatCurrency(state.amountCents)}</strong>
          </div>
          <div className="pix-notice">
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
              onClick={onIssue}
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
            <span className="status-pill pending">Fatura pendente</span>
          </header>

          <div className="invoice-share-items">
            {rows.map((row, index) => (
              <div key={`${row.title}-${index}`}>
                <span>
                  <strong>{row.title}</strong>
                  <small>{row.detail}</small>
                </span>
                <strong>{formatCurrency(row.amountCents)}</strong>
              </div>
            ))}
          </div>

          <div className="invoice-share-total">
            <span>Total da fatura</span>
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

          <div className="invoice-share-note">
            <span className="attention-mark">i</span>
            <p>
              No iPhone e Android será aberto o menu normal de
              compartilhamento com o PDF anexado. No computador, se o
              aplicativo não aceitar anexos automáticos, o PDF será salvo
              antes de abrir o WhatsApp ou o e-mail.
            </p>
          </div>

          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              Fechar
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  if (liveMode) {
    return (
      <Dialog
        title={`Cobrança nº ${state.invoice?.number ?? "—"}`}
        description={
          state.kind === "credit_package"
            ? "Pacote de créditos · aguardando pagamento"
            : "Aguardando pagamento"
        }
        onClose={onClose}
      >
        <div className="pix-charge">
          <div className="pix-charge-summary">
            <span>
              <small>Total</small>
              <strong>{formatCurrency(state.amountCents)}</strong>
            </span>
            <span>
              <small>Vencimento</small>
              <strong>Hoje</strong>
            </span>
            <span className="status-pill pending">Fatura pendente</span>
          </div>

          {state.copyPasteCode ? (
            <>
              <div className="pix-body live-pix-body">
                <div className="live-pix-mark" aria-hidden="true">
                  PIX
                </div>
                <div className="pix-code">
                  <label htmlFor="pix-live-code">Pix Copia e Cola</label>
                  <div>
                    <input
                      id="pix-live-code"
                      readOnly
                      value={state.copyPasteCode}
                    />
                    <button
                      className="secondary-button"
                      onClick={async () => {
                        await navigator.clipboard?.writeText(
                          state.copyPasteCode ?? "",
                        );
                        onFeedback("Código Pix copiado.");
                      }}
                    >
                      Copiar código
                    </button>
                  </div>
                  <p>
                    Os créditos, quando houver, serão liberados somente após a
                    confirmação bancária.
                  </p>
                </div>
              </div>
              <div className="share-actions">
                <button
                  className="secondary-button"
                  onClick={() =>
                    onFeedback(
                      "Código pronto para compartilhar pelo WhatsApp.",
                    )
                  }
                >
                  Preparar WhatsApp
                </button>
                <button
                  className="secondary-button"
                  onClick={() =>
                    onFeedback("Código pronto para compartilhar por e-mail.")
                  }
                >
                  Preparar e-mail
                </button>
              </div>
            </>
          ) : (
            <div className="provider-state" role="status">
              <span className="attention-mark">i</span>
              <div>
                <strong>Cobrança registrada com segurança.</strong>
                <p>
                  {state.providerMessage ||
                    "Conecte o provedor Pix para gerar o código de pagamento."}
                </p>
                <button
                  className="secondary-button"
                  onClick={onIssue}
                  disabled={busy}
                >
                  {busy ? "Tentando…" : "Tentar gerar o código Pix"}
                </button>
              </div>
            </div>
          )}
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={`Cobrança nº ${state.invoice?.number ?? "—"}`}
      description={
        state.kind === "credit_package"
          ? "Pacote de créditos · aguardando pagamento"
          : "Aguardando pagamento"
      }
      onClose={onClose}
    >
      <div className="pix-charge">
        <div className="pix-charge-summary">
          <span>
            <small>Total</small>
            <strong>{formatCurrency(state.amountCents)}</strong>
          </span>
          <span>
            <small>Vencimento</small>
            <strong>Hoje</strong>
          </span>
            <span className="status-pill pending">Fatura pendente</span>
        </div>
        <div className="demo-warning">
          Demonstração — este código não é válido para pagamento.
        </div>
        <div className="pix-body">
          <DemoQr />
          <div className="pix-code">
            <label htmlFor="pix-demo-code">Pix Copia e Cola</label>
            <div>
              <input id="pix-demo-code" readOnly value={demoCode} />
              <button
                className="secondary-button"
                onClick={async () => {
                  await navigator.clipboard?.writeText(demoCode);
                  onFeedback("Código Pix demonstrativo copiado.");
                }}
              >
                Copiar código
              </button>
            </div>
            <p>
              O código real será criado pelo banco ou provedor Pix escolhido e
              nunca ficará no GitHub.
            </p>
          </div>
        </div>
        <div className="share-actions">
          <button
            className="secondary-button"
            onClick={() =>
              onFeedback(
                "Mensagem preparada. Nada foi enviado na demonstração.",
              )
            }
          >
            Preparar WhatsApp
          </button>
          <button
            className="secondary-button"
            onClick={() =>
              onFeedback("E-mail preparado. Nada foi enviado na demonstração.")
            }
          >
            Preparar e-mail
          </button>
        </div>
        <div className="simulation-strip">
          <span>
            <strong>Ferramenta de desenvolvimento</strong>
            Use apenas para validar a experiência.
          </span>
          <button className="text-button" onClick={onSimulatePayment}>
            Simular pagamento confirmado
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function DemoQr() {
  const pattern =
    "11111110010111111110000010011100000110111010110101110110111010001010110110111010111101110110000010010100000111111110101011111110000000011100000010101011100101101001011010011110110110101100100011100010101110110111000101111001010010101010011110110101110100110110000000110110101111111010101111111100010010101000000110110100111111110111100101100010111110011110000110000010000100010110111010111011100110111010101010111110111010110111101110000010011001000111111110110110101111111";
  return (
    <div className="demo-qr" aria-label="QR Pix de demonstração não escaneável">
      {pattern.split("").map((cell, index) => (
        <span className={cell === "1" ? "filled" : ""} key={index} />
      ))}
      <strong>PIX<br />DEMO</strong>
    </div>
  );
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
