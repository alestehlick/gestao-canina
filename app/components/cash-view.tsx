"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import {
  BrazilianDateInput,
  formatBrazilianDate,
} from "@/app/components/brazilian-date-input";
import {
  cashReportFilename,
  generateCashReportPdf,
  type CashReportData,
} from "@/lib/cash-report-pdf";

type CashDirection = "inflow" | "outflow";
type CashStatus = "included" | "excluded";

type CashEntry = {
  id: string;
  direction: CashDirection;
  origin: "invoice_payment" | "manual" | "transfer";
  sourcePaymentId: string | null;
  transferId: string | null;
  financialAccountId: string | null;
  financialAccountName: string | null;
  occurredOn: string;
  amountCents: number;
  category: string;
  description: string;
  note: string | null;
  status: CashStatus;
  exclusionReason: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  customerName: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  transferVersion: number | null;
  createdByName: string | null;
  updatedByName: string | null;
  excludedByName: string | null;
  receiptName: string | null;
  receiptUrl: string | null;
};

type CashPayload = {
  anchorMonth: string;
  monthStartDay: number;
  period: { start: string; end: string };
  periodState: {
    id?: string;
    status: "open" | "closed";
    closeNote?: string | null;
    closedAt?: string | null;
    reopenedAt?: string | null;
    reopenReason?: string | null;
    version: number;
  };
  totals: {
    receivedCents: number;
    paidCents: number;
    resultCents: number;
    accountMovementCents: number;
    overdueReceivableCents: number;
    overdueReceivableCount: number;
    excludedCount: number;
    transferInflowCents: number;
    transferOutflowCents: number;
  };
  analytics: {
    serviceStats: Array<{
      code: string;
      label: string;
      creditUnits: number;
      creditSoldCents: number;
      standaloneCount: number;
      standaloneReceivedCents: number;
      receivedCents: number;
    }>;
    previousTotals: { inflowCents: number; outflowCents: number };
    automaticInflowCents: number;
    manualInflowCents: number;
    unallocatedAutomaticCents: number;
    credits: {
      soldUnits: number;
      soldCents: number;
      byService: Array<{
        code: string;
        label: string;
        soldUnits: number;
        usedUnits: number;
        availableUnits: number;
      }>;
    };
    dailyCash: Array<{
      date: string;
      inflowCents: number;
      outflowCents: number;
      cumulativeCents: number;
    }>;
    expenseCategories: Array<{ category: string; amountCents: number }>;
  };
  categories: string[];
  entries: CashEntry[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
};

type CashDraft = {
  direction: CashDirection;
  occurredOn: string;
  amount: string;
  category: string;
  description: string;
  note: string;
  financialAccountId: string;
};

type FinancialAccount = {
  id: string;
  name: string;
  institution: string | null;
  kind: "checking" | "savings" | "cash" | "other";
  active: boolean;
  openingBalanceCents: number | null;
  openingBalanceOn: string | null;
  reconciledBalanceCents: number | null;
  reconciledOn: string | null;
  reconciledAt: string | null;
  lastReconciliationDifferenceCents: number | null;
  calculatedBalanceCents: number | null;
  scheduledSettlementCount: number;
};

type CashTab = "summary" | "entries" | "accounts";

const inflowCategories = [
  "Serviços fora do sistema",
  "Aporte dos sócios",
  "Reembolso",
  "Outros",
];

const outflowCategories = [
  "Alimentação e insumos",
  "Equipe e prestadores",
  "Aluguel e contas",
  "Manutenção",
  "Transporte",
  "Impostos e taxas",
  "Outros",
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value / 100);
}

function currencyCents(value: FormDataEntryValue | null) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const cents = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(cents) ? cents : Number.NaN;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  const label = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function shiftMonth(value: string, delta: number) {
  const [year, month] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return shifted.toISOString().slice(0, 7);
}

function compactDate(value: string) {
  return value.slice(8, 10);
}

function barSize(value: number, maximum: number) {
  if (value <= 0 || maximum <= 0) return 0;
  return Math.max(5, Math.round((value / maximum) * 100));
}

async function cashRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("content-type", "application/json");
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : null;
    throw new Error(
      message || "Não foi possível concluir a operação.",
    );
  }
  return payload as T;
}

function draftFor(
  referenceDate: string,
  direction: CashDirection = "outflow",
  financialAccountId = "",
): CashDraft {
  const categories =
    direction === "inflow" ? inflowCategories : outflowCategories;
  return {
    direction,
    occurredOn: referenceDate,
    amount: "",
    category: categories[0],
    description: "",
    note: "",
    financialAccountId,
  };
}

export function CashView({
  referenceDate,
  onChanged,
  onOpenBilling,
  canEditSettings = false,
}: {
  referenceDate: string;
  onChanged: () => void;
  onOpenBilling?: () => void;
  canEditSettings?: boolean;
}) {
  const currentMonth = referenceDate.slice(0, 7);
  const [anchorMonth, setAnchorMonth] = useState(currentMonth);
  const [payload, setPayload] = useState<CashPayload | null>(null);
  const [tab, setTab] = useState<CashTab>("summary");
  const [directionFilter, setDirectionFilter] = useState<"all" | CashDirection>("all");
  const [statusFilter, setStatusFilter] = useState<"included" | "excluded" | "all">("included");
  const [originFilter, setOriginFilter] = useState<"all" | "automatic" | "manual" | "transfer">("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchDraft, setSearchDraft] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState<CashDraft>(() =>
    draftFor(referenceDate),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [financialAccounts, setFinancialAccounts] = useState<FinancialAccount[]>([]);
  const [accountFilter, setAccountFilter] = useState("all");
  const [newAccountOpen, setNewAccountOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [reconcileAccountId, setReconcileAccountId] = useState<string | null>(null);
  const [configureAccountId, setConfigureAccountId] = useState<string | null>(null);
  const [entryAction, setEntryAction] = useState<{ entry: CashEntry; action: "exclude" | "restore" } | null>(null);
  const [detailsEntryId, setDetailsEntryId] = useState<string | null>(null);
  const [entryIdempotencyKey, setEntryIdempotencyKey] = useState(() => crypto.randomUUID());
  const [transferIdempotencyKey, setTransferIdempotencyKey] = useState(() => crypto.randomUUID());
  const [periodAction, setPeriodAction] = useState<"close" | "reopen" | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        month: anchorMonth,
        page: String(page),
        direction: directionFilter,
        status: statusFilter,
        origin: originFilter,
      });
      if (accountFilter !== "all") params.set("accountId", accountFilter);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      if (appliedSearch) params.set("q", appliedSearch);
      const result = await cashRequest<CashPayload>(`/api/cash?${params.toString()}`);
      const accountResult = await cashRequest<{ accounts: FinancialAccount[] }>(
        `/api/financial-accounts?through=${encodeURIComponent(result.period.end)}${canEditSettings ? "&includeInactive=true" : ""}`,
      );
      setPayload(result);
      setFinancialAccounts(accountResult.accounts);
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível carregar o Caixa.",
      );
    }
  }, [accountFilter, anchorMonth, appliedSearch, canEditSettings, categoryFilter, directionFilter, originFilter, page, statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const entries = payload?.entries ?? [];

  const categories =
    draft.direction === "inflow" ? inflowCategories : outflowCategories;

  function openNew(direction: CashDirection) {
    if (payload?.periodState.status === "closed") {
      setError("Este período está fechado. Reabra-o antes de registrar movimentações.");
      return;
    }
    const activeAccounts = financialAccounts.filter((account) => account.active);
    setEditingId(null);
    setDraft(
      draftFor(
        referenceDate,
        direction,
        activeAccounts.length === 1 ? activeAccounts[0].id : "",
      ),
    );
    setEntryIdempotencyKey(crypto.randomUUID());
    setFormOpen(true);
    setTab("entries");
  }

  function openEdit(entry: CashEntry) {
    setEditingId(entry.id);
    setDraft({
      direction: entry.direction,
      occurredOn: entry.occurredOn,
      amount: (entry.amountCents / 100).toFixed(2),
      category: entry.category,
      description: entry.description,
      note: entry.note ?? "",
      financialAccountId: entry.financialAccountId ?? "",
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setDraft(draftFor(referenceDate));
    setEntryIdempotencyKey(crypto.randomUUID());
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const amountCents = Math.round(
      Number(draft.amount.replace(",", ".")) * 100,
    );
    if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
      setError("Informe um valor maior que zero.");
      return;
    }
    if (!draft.financialAccountId) {
      setError("Escolha a conta desta movimentação.");
      return;
    }
    setBusy("save");
    try {
      const body = {
        ...(editingId ? { action: "update" } : {}),
        direction: draft.direction,
        occurredOn: draft.occurredOn,
        amountCents,
        category: draft.category,
        description: draft.description,
        note: draft.note || undefined,
        financialAccountId: draft.financialAccountId,
        ...(editingId
          ? {
              expectedVersion:
                entries.find((entry) => entry.id === editingId)?.version ?? 0,
            }
          : { idempotencyKey: entryIdempotencyKey }),
      };
      await cashRequest(
        editingId ? `/api/cash/${editingId}` : "/api/cash",
        {
          method: editingId ? "PATCH" : "POST",
          body: JSON.stringify(body),
        },
      );
      closeForm();
      await load();
      onChanged();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível salvar o lançamento.",
      );
    } finally {
      setBusy("");
    }
  }

  function requestStatusChange(entry: CashEntry) {
    setEntryAction({
      entry,
      action: entry.status === "included" ? "exclude" : "restore",
    });
  }

  async function changeStatus(entry: CashEntry, reason = "") {
    if (busy) return;
    const action = entry.status === "included" ? "exclude" : "restore";
    if (action === "exclude" && !reason.trim()) {
      setError("Informe o motivo para manter o histórico claro.");
      return;
    }
    setBusy(`status:${entry.id}`);
    try {
      const endpoint = entry.transferId
        ? `/api/cash/transfers/${entry.transferId}`
        : `/api/cash/${entry.id}`;
      await cashRequest(endpoint, {
        method: "PATCH",
        body: JSON.stringify({
          action,
          reason: reason.trim() || undefined,
          expectedVersion: entry.transferId
            ? entry.transferVersion
            : entry.version,
        }),
      });
      setEntryAction(null);
      await load();
      onChanged();
    } catch (reasonValue) {
      setError(
        reasonValue instanceof Error
          ? reasonValue.message
          : "Não foi possível alterar o lançamento.",
      );
    } finally {
      setBusy("");
    }
  }

  async function saveStartDay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const monthStartDay = Number(form.get("monthStartDay"));
    setBusy("settings");
    try {
      await cashRequest("/api/cash/settings", {
        method: "PATCH",
        body: JSON.stringify({ monthStartDay }),
      });
      await load();
      onChanged();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível salvar a configuração.",
      );
    } finally {
      setBusy("");
    }
  }

  async function createFinancialAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const openingBalanceValue = String(form.get("openingBalance") ?? "").trim();
    const openingBalanceOn = String(form.get("openingBalanceOn") ?? "").trim();
    const openingBalanceCents = openingBalanceValue
      ? currencyCents(openingBalanceValue)
      : null;
    if (
      (openingBalanceCents === null) !== !openingBalanceOn ||
      (openingBalanceCents !== null && !Number.isSafeInteger(openingBalanceCents))
    ) {
      setError("Informe o saldo inicial e a data de referência juntos.");
      return;
    }
    setBusy("financial-account");
    try {
      await cashRequest("/api/financial-accounts", {
        method: "POST",
        body: JSON.stringify({
          name: String(form.get("name") ?? "").trim(),
          institution: String(form.get("institution") ?? "").trim() || null,
          kind: String(form.get("kind") ?? "checking"),
          openingBalanceCents,
          openingBalanceOn: openingBalanceOn || null,
        }),
      });
      setNewAccountOpen(false);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível cadastrar a conta.",
      );
    } finally {
      setBusy("");
    }
  }

  async function toggleFinancialAccount(account: FinancialAccount) {
    if (busy) return;
    setBusy(`financial-account:${account.id}`);
    try {
      await cashRequest(`/api/financial-accounts/${account.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: account.active ? "archive" : "activate",
        }),
      });
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível alterar a conta.",
      );
    } finally {
      setBusy("");
    }
  }

  async function configureFinancialAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configureAccountId || busy) return;
    const form = new FormData(event.currentTarget);
    const openingBalanceCents = currencyCents(form.get("openingBalance"));
    const openingBalanceOn = String(form.get("openingBalanceOn") ?? "");
    if (!Number.isSafeInteger(openingBalanceCents) || !openingBalanceOn) {
      setError("Informe o saldo inicial e a data de referência.");
      return;
    }
    setBusy(`configure:${configureAccountId}`);
    try {
      await cashRequest(`/api/financial-accounts/${configureAccountId}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "configure",
          openingBalanceCents,
          openingBalanceOn,
        }),
      });
      setConfigureAccountId(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível configurar o saldo inicial.");
    } finally {
      setBusy("");
    }
  }

  async function createTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const amountCents = currencyCents(form.get("amount"));
    if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
      setError("Informe um valor maior que zero.");
      return;
    }
    setBusy("transfer");
    try {
      await cashRequest("/api/cash/transfers", {
        method: "POST",
        body: JSON.stringify({
          fromFinancialAccountId: String(form.get("fromFinancialAccountId") ?? ""),
          toFinancialAccountId: String(form.get("toFinancialAccountId") ?? ""),
          occurredOn: String(form.get("occurredOn") ?? ""),
          amountCents,
          description: String(form.get("description") ?? "").trim() || undefined,
          note: String(form.get("note") ?? "").trim() || undefined,
          idempotencyKey: transferIdempotencyKey,
        }),
      });
      setTransferOpen(false);
      setTransferIdempotencyKey(crypto.randomUUID());
      await load();
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível registrar a transferência.");
    } finally {
      setBusy("");
    }
  }

  async function reconcileAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reconcileAccountId || busy) return;
    const form = new FormData(event.currentTarget);
    const statementBalanceCents = currencyCents(form.get("statementBalance"));
    if (!Number.isSafeInteger(statementBalanceCents)) {
      setError("Informe o saldo mostrado pelo banco ou caixa físico.");
      return;
    }
    setBusy(`reconcile:${reconcileAccountId}`);
    try {
      await cashRequest("/api/cash/reconciliations", {
        method: "POST",
        body: JSON.stringify({
          financialAccountId: reconcileAccountId,
          reconciledOn: String(form.get("reconciledOn") ?? ""),
          statementBalanceCents,
          note: String(form.get("note") ?? "").trim() || undefined,
        }),
      });
      setReconcileAccountId(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível conciliar a conta.");
    } finally {
      setBusy("");
    }
  }

  async function changePeriodState(action: "close" | "reopen", reason = "") {
    if (!payload || busy) return false;
    setBusy("period-state");
    try {
      await cashRequest("/api/cash/periods", {
        method: "POST",
        body: JSON.stringify({
          action,
          periodStart: payload.period.start,
          periodEnd: payload.period.end,
          expectedVersion: payload.periodState.version || undefined,
          ...(action === "close" ? { note: reason || undefined } : { reason }),
        }),
      });
      await load();
      return true;
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "Não foi possível alterar o período.");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function uploadReceipt(entry: CashEntry, file: File) {
    if (busy) return;
    setBusy(`receipt:${entry.id}`);
    try {
      const form = new FormData();
      form.set("receipt", file);
      const response = await fetch(`/api/cash/${entry.id}/receipt`, {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(result?.error?.message || "Não foi possível anexar o comprovante.");
      }
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível anexar o comprovante.");
    } finally {
      setBusy("");
    }
  }

  async function reportData() {
    const params = new URLSearchParams({
      month: anchorMonth,
      status: "included",
      export: "1",
    });
    if (accountFilter !== "all") params.set("accountId", accountFilter);
    return cashRequest<CashPayload>(`/api/cash?${params.toString()}`);
  }

  async function exportReport(kind: "pdf" | "csv") {
    if (busy) return;
    setBusy(`report:${kind}`);
    try {
      const data = await reportData();
      const accountName = financialAccounts.find((account) => account.id === accountFilter)?.name;
      const report: CashReportData = {
        period: data.period,
        accountName,
        totals: data.totals,
        serviceStats: data.analytics.serviceStats,
        expenseCategories: data.analytics.expenseCategories,
        entries: data.entries,
      };
      if (kind === "pdf") {
        downloadBlob(generateCashReportPdf(report), cashReportFilename(report, "pdf"));
      } else {
        const header = ["Data", "Tipo", "Descrição", "Categoria", "Conta", "Valor (R$)"];
        const rows = report.entries.map((entry) => [
          formatBrazilianDate(entry.occurredOn),
          entry.direction === "inflow" ? "Entrada" : "Saída",
          entry.description,
          entry.category,
          entry.financialAccountName ?? "",
          `${entry.direction === "outflow" ? "-" : ""}${(entry.amountCents / 100).toFixed(2).replace(".", ",")}`,
        ]);
        const csv = [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
        downloadBlob(
          new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
          cashReportFilename(report, "csv"),
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível gerar o relatório.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="cash-page">
      <section className="panel cash-period-panel">
        <div>
          <p className="section-kicker">Período financeiro</p>
          <h2>{monthLabel(anchorMonth)}</h2>
          <p>
            {payload
              ? `${formatBrazilianDate(payload.period.start)} a ${formatBrazilianDate(payload.period.end)}`
              : "Carregando período…"}
          </p>
          {payload && (
            <span className={`cash-period-state ${payload.periodState.status}`}>
              {payload.periodState.status === "closed" ? "Período fechado" : "Período aberto"}
            </span>
          )}
        </div>
        <div className="cash-period-actions" aria-label="Navegar entre períodos">
          <label className="cash-account-scope">
            <span>Conta</span>
            <select
              value={accountFilter}
              onChange={(event) => {
                setAccountFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">Todas</option>
              {financialAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="secondary-button"
            onClick={() => setAnchorMonth(shiftMonth(anchorMonth, -1))}
            aria-label="Período anterior"
          >
            ‹
          </button>
          <button
            className="secondary-button"
            onClick={() => setAnchorMonth(currentMonth)}
          >
            Atual
          </button>
          <button
            className="secondary-button"
            onClick={() => setAnchorMonth(shiftMonth(anchorMonth, 1))}
            aria-label="Próximo período"
          >
            ›
          </button>
        </div>
      </section>

      {error && (
        <div className="inline-error" role="alert">
          {error}
          <button onClick={() => setError("")}>Fechar</button>
        </div>
      )}

      <nav className="cash-tabs" aria-label="Seções do Caixa">
        {[
          ["summary", "Resumo"],
          ["entries", "Movimentações"],
          ["accounts", "Contas"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "active" : ""}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id as CashTab)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "summary" && <>
      <section className="finance-summary cash-summary">
        <div>
          <span>Recebido no período</span>
          <strong>{formatCurrency(payload?.totals.receivedCents ?? 0)}</strong>
        </div>
        <div>
          <span>Pago no período</span>
          <strong>{formatCurrency(payload?.totals.paidCents ?? 0)}</strong>
        </div>
        <div>
          <span>Resultado do período</span>
          <strong
            className={
              (payload?.totals.resultCents ?? 0) < 0 ? "negative-value" : ""
            }
          >
            {formatCurrency(payload?.totals.resultCents ?? 0)}
          </strong>
        </div>
        <button type="button" onClick={onOpenBilling} disabled={!onOpenBilling}>
          <span>Vencido a receber</span>
          <strong>{formatCurrency(payload?.totals.overdueReceivableCents ?? 0)}</strong>
          <small>
            {payload?.totals.overdueReceivableCount ?? 0} faturas vencidas · ver Cobranças
          </small>
        </button>
      </section>

      <section className="panel cash-service-overview">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Receita recebida no período</p>
            <h2>Por serviço</h2>
          </div>
          <div className="heading-actions cash-report-actions">
            <button className="secondary-button" type="button" onClick={() => void exportReport("pdf")} disabled={busy.startsWith("report:")}>PDF</button>
            <button className="secondary-button" type="button" onClick={() => void exportReport("csv")} disabled={busy.startsWith("report:")}>CSV</button>
          </div>
        </div>
        <div className="cash-service-grid">
          {(payload?.analytics.serviceStats ?? []).map((service) => (
            <article key={service.code}>
              <span>{service.label}</span>
              <strong>{formatCurrency(service.receivedCents)}</strong>
              {service.creditUnits > 0 && (
                <small>
                  Créditos vendidos: {service.creditUnits} · {formatCurrency(service.creditSoldCents)}
                </small>
              )}
              {service.standaloneCount > 0 && (
                <small>
                  Avulsos recebidos: {service.standaloneCount} · {formatCurrency(service.standaloneReceivedCents)}
                </small>
              )}
              {service.creditUnits === 0 && service.standaloneCount === 0 && (
                <small>Nenhum recebimento no período</small>
              )}
            </article>
          ))}
        </div>
      </section>

      <details className="panel cash-analytics">
        <summary>
          <span>
            <span className="section-kicker">Planejamento</span>
            <strong>Ver análises</strong>
          </span>
          <span className="cash-analysis-toggle" aria-hidden="true">+</span>
        </summary>
        {payload && (
          <div className="cash-analytics-body">
            <div className="cash-analysis-metrics">
              <article>
                <span>Receita de serviços e créditos</span>
                <strong>{formatCurrency(payload.analytics.automaticInflowCents)}</strong>
              </article>
              <article>
                <span>Entradas manuais operacionais</span>
                <strong>{formatCurrency(payload.analytics.manualInflowCents)}</strong>
              </article>
              {payload.analytics.unallocatedAutomaticCents !== 0 && (
                <article className="attention">
                  <span>Diferença a revisar</span>
                  <strong>{formatCurrency(payload.analytics.unallocatedAutomaticCents)}</strong>
                </article>
              )}
            </div>

            <div className="cash-chart-grid">
              <article className="cash-chart-card">
                <div>
                  <p className="section-kicker">Comparativo</p>
                  <h3>Entradas e saídas</h3>
                </div>
                {(() => {
                  const values = [
                    payload.totals.receivedCents,
                    payload.totals.paidCents,
                    payload.analytics.previousTotals.inflowCents,
                    payload.analytics.previousTotals.outflowCents,
                  ];
                  const maximum = Math.max(...values, 1);
                  return (
                    <div className="cash-comparison-chart">
                      {[
                        [
                          "Período atual",
                          payload.totals.receivedCents,
                          payload.totals.paidCents,
                        ],
                        [
                          "Período anterior",
                          payload.analytics.previousTotals.inflowCents,
                          payload.analytics.previousTotals.outflowCents,
                        ],
                      ].map(([label, inflow, outflow]) => (
                        <div className="cash-comparison-row" key={String(label)}>
                          <span>{label}</span>
                          <div className="cash-comparison-bars">
                            <i
                              className="inflow-bar"
                              style={{ width: `${barSize(Number(inflow), maximum)}%` }}
                              title={`Entradas: ${formatCurrency(Number(inflow))}`}
                            />
                            <i
                              className="outflow-bar"
                              style={{ width: `${barSize(Number(outflow), maximum)}%` }}
                              title={`Saídas: ${formatCurrency(Number(outflow))}`}
                            />
                          </div>
                          <small>
                            +{formatCurrency(Number(inflow))} · −{formatCurrency(Number(outflow))}
                          </small>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                <div className="cash-chart-legend">
                  <span><i className="inflow-bar" /> Entradas</span>
                  <span><i className="outflow-bar" /> Saídas</span>
                </div>
              </article>

              <article className="cash-chart-card">
                <div>
                  <p className="section-kicker">Composição</p>
                  <h3>Receita por serviço</h3>
                </div>
                <div className="cash-service-chart">
                  {payload.analytics.serviceStats.map((service) => {
                    const maximum = Math.max(
                      ...payload.analytics.serviceStats.map((item) => item.receivedCents),
                      1,
                    );
                    return (
                      <div key={`chart-${service.code}`}>
                        <span>{service.label}</span>
                        <i>
                          <b style={{ width: `${barSize(service.receivedCents, maximum)}%` }} />
                        </i>
                        <small>{formatCurrency(service.receivedCents)}</small>
                      </div>
                    );
                  })}
                </div>
              </article>

              <article className="cash-chart-card cash-daily-card">
                <div>
                  <p className="section-kicker">Evolução</p>
                  <h3>Resultado acumulado do período</h3>
                </div>
                {payload.analytics.dailyCash.length ? (
                  <div className="cash-daily-chart" aria-label="Resultado acumulado por dia no período">
                    {(() => {
                      const maximum = Math.max(
                        ...payload.analytics.dailyCash.map((day) => Math.abs(day.cumulativeCents)),
                        1,
                      );
                      return payload.analytics.dailyCash.map((day) => (
                        <span key={day.date}>
                          <i
                            className={day.cumulativeCents < 0 ? "negative" : "positive"}
                            style={{ height: `${barSize(Math.abs(day.cumulativeCents), maximum)}%` }}
                            title={`${formatBrazilianDate(day.date)}: ${formatCurrency(day.cumulativeCents)}`}
                          />
                          <small>{compactDate(day.date)}</small>
                        </span>
                      ));
                    })()}
                  </div>
                ) : (
                  <p className="cash-chart-empty">Sem movimentações consideradas neste período.</p>
                )}
              </article>
            </div>

            <div className="cash-detail-grid">
              <article>
                <p className="section-kicker">Créditos</p>
                <h3>Pacotes pré-pagos</h3>
                <dl>
                  <div><dt>Vendidos no período</dt><dd>{payload.analytics.credits.soldUnits}</dd></div>
                  <div><dt>Receita de vendas</dt><dd>{formatCurrency(payload.analytics.credits.soldCents)}</dd></div>
                  {payload.analytics.credits.byService.map((service) => (
                    <div key={service.code}>
                      <dt>{service.label}</dt>
                      <dd>{service.usedUnits} usados · {service.availableUnits} disponíveis</dd>
                    </div>
                  ))}
                </dl>
              </article>
              <article>
                <p className="section-kicker">Despesas</p>
                <h3>Por categoria</h3>
                {payload.analytics.expenseCategories.length ? (
                  <dl>
                    {payload.analytics.expenseCategories.map((item) => (
                      <div key={item.category}>
                        <dt>{item.category}</dt>
                        <dd>{formatCurrency(item.amountCents)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="cash-chart-empty">Nenhuma saída considerada.</p>
                )}
              </article>
            </div>
          </div>
        )}
      </details>
      </>}

      {tab === "entries" && <section className="panel full-panel">
        <div className="panel-heading cash-heading">
          <div>
            <p className="section-kicker">Movimentações</p>
            <h2>Entradas e saídas</h2>
          </div>
          <div className="heading-actions">
            {financialAccounts.filter((account) => account.active).length > 1 && (
              <button
                className="secondary-button"
                type="button"
                onClick={() => setTransferOpen(true)}
                disabled={payload?.periodState.status === "closed"}
              >
                Transferir
              </button>
            )}
            <button
              className="secondary-button"
              onClick={() => openNew("inflow")}
            >
              + Entrada
            </button>
            <button
              className="primary-button"
              onClick={() => openNew("outflow")}
            >
              + Saída
            </button>
          </div>
        </div>

        {formOpen && (
          <form className="cash-entry-form" onSubmit={submit}>
            <div className="cash-form-heading">
              <div>
                <p className="section-kicker">
                  {editingId ? "Editar lançamento" : "Novo lançamento manual"}
                </p>
                <h3>
                  {draft.direction === "inflow" ? "Entrada" : "Saída"}
                </h3>
              </div>
              <button className="text-button" type="button" onClick={closeForm}>
                Fechar
              </button>
            </div>
            <label className="field">
              <span>Tipo</span>
              <select
                value={draft.direction}
                onChange={(event) => {
                  const direction = event.target.value as CashDirection;
                  const nextCategories =
                    direction === "inflow"
                      ? inflowCategories
                      : outflowCategories;
                  setDraft((current) => ({
                    ...current,
                    direction,
                    category: nextCategories[0],
                  }));
                }}
              >
                <option value="inflow">Entrada</option>
                <option value="outflow">Saída</option>
              </select>
            </label>
            <label className="field">
              <span>Data</span>
              <BrazilianDateInput
                value={draft.occurredOn}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, occurredOn: value }))
                }
                required
              />
            </label>
            <label className="field">
              <span>Valor</span>
              <span className="currency-input">
                <span>R$</span>
                <input
                  inputMode="decimal"
                  value={draft.amount}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      amount: event.target.value,
                    }))
                  }
                  placeholder="0,00"
                  required
                />
              </span>
            </label>
            <label className="field">
              <span>Categoria</span>
              <input
                list="cash-entry-categories"
                value={draft.category}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
                maxLength={60}
                required
              />
              <datalist id="cash-entry-categories">
                {[...new Set([...categories, ...(payload?.categories ?? [])])].map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>Conta</span>
              <select
                value={draft.financialAccountId}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    financialAccountId: event.target.value,
                  }))
                }
                required
              >
                {!draft.financialAccountId && <option value="">Escolha a conta</option>}
                {financialAccounts
                  .filter(
                    (account) =>
                      account.active || account.id === draft.financialAccountId,
                  )
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                      {account.institution ? ` · ${account.institution}` : ""}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field cash-description-field">
              <span>Descrição</span>
              <input
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                maxLength={160}
                placeholder="Ex.: compra de ração"
                required
              />
            </label>
            <label className="field cash-note-field">
              <span>Observação (opcional)</span>
              <input
                value={draft.note}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    note: event.target.value,
                  }))
                }
                maxLength={500}
              />
            </label>
            <div className="cash-form-actions">
              <button className="secondary-button" type="button" onClick={closeForm}>
                Cancelar
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={busy === "save"}
              >
                {busy === "save"
                  ? "Salvando…"
                  : editingId
                    ? "Salvar alterações"
                    : "Adicionar ao Caixa"}
              </button>
            </div>
          </form>
        )}

        <form
          className="cash-search"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setAppliedSearch(searchDraft.trim());
          }}
        >
          <input
            type="search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Buscar descrição, cliente ou fatura"
            aria-label="Buscar movimentações"
          />
          <button className="secondary-button" type="submit">Buscar</button>
          {appliedSearch && (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                setSearchDraft("");
                setAppliedSearch("");
                setPage(1);
              }}
            >
              Limpar
            </button>
          )}
        </form>
        <div className="cash-filter-grid">
          <label className="field">
            <span>Tipo</span>
            <select value={directionFilter} onChange={(event) => { setDirectionFilter(event.target.value as "all" | CashDirection); setPage(1); }}>
              <option value="all">Entradas e saídas</option>
              <option value="inflow">Entradas</option>
              <option value="outflow">Saídas</option>
            </select>
          </label>
          <label className="field">
            <span>Situação</span>
            <select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as "included" | "excluded" | "all"); setPage(1); }}>
              <option value="included">Considerados</option>
              <option value="excluded">Desconsiderados</option>
              <option value="all">Todos</option>
            </select>
          </label>
          <label className="field">
            <span>Origem</span>
            <select value={originFilter} onChange={(event) => { setOriginFilter(event.target.value as "all" | "automatic" | "manual" | "transfer"); setPage(1); }}>
              <option value="all">Todas as origens</option>
              <option value="automatic">Faturas</option>
              <option value="manual">Manuais</option>
              <option value="transfer">Transferências</option>
            </select>
          </label>
          <label className="field">
            <span>Categoria</span>
            <select value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setPage(1); }}>
              <option value="all">Todas as categorias</option>
              {(payload?.categories ?? []).map((category) => <option key={category}>{category}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Conta</span>
            <select value={accountFilter} onChange={(event) => { setAccountFilter(event.target.value); setPage(1); }}>
              <option value="all">Todas as contas</option>
              {financialAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}{account.active ? "" : " · inativa"}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!!payload?.totals.excludedCount && (
          <p className="cash-excluded-note">
            {payload.totals.excludedCount} lançamento(s) desconsiderado(s), preservado(s) no histórico.
          </p>
        )}

        {entries.length ? (
          <>
            <div className="table-wrap">
              <table className="data-table cash-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Descrição</th>
                    <th>Categoria</th>
                    <th>Valor</th>
                    <th>Situação</th>
                    <th>
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr
                      key={entry.id}
                      className={
                        entry.status === "excluded" ? "cash-row-excluded" : ""
                      }
                    >
                      <td>{formatBrazilianDate(entry.occurredOn)}</td>
                      <td>
                        <span className="table-stack">
                          <strong>{entry.description}</strong>
                          <small>
                            {entry.origin === "invoice_payment"
                              ? `${entry.customerName ?? "Cliente"}${entry.invoiceNumber ? ` · ${entry.invoiceNumber}` : ""}`
                              : entry.origin === "transfer"
                                ? "Transferência entre contas"
                                : entry.note || "Lançamento manual"}
                            {entry.financialAccountName
                              ? ` · ${entry.financialAccountName}`
                              : ""}
                          </small>
                        </span>
                      </td>
                      <td>{entry.category}</td>
                      <td>
                        <strong
                          className={
                            entry.direction === "outflow"
                              ? "cash-outflow"
                              : "cash-inflow"
                          }
                        >
                          {entry.direction === "outflow" ? "− " : "+ "}
                          {formatCurrency(entry.amountCents)}
                        </strong>
                      </td>
                      <td>
                        <span
                          className={`status-pill ${
                            entry.status === "included" ? "success" : "neutral"
                          }`}
                        >
                          {entry.status === "included"
                            ? "Considerado"
                            : "Desconsiderado"}
                        </span>
                      </td>
                      <td>
                        <span className="cash-row-actions">
                          {entry.origin === "manual" &&
                            entry.status === "included" && (
                              <button
                                className="row-link"
                                onClick={() => openEdit(entry)}
                              >
                                Editar
                              </button>
                            )}
                          <button
                            className="row-link"
                            onClick={() => setDetailsEntryId(entry.id)}
                          >
                            Detalhes
                          </button>
                          <button
                            className="row-link"
                            onClick={() => requestStatusChange(entry)}
                            disabled={busy === `status:${entry.id}`}
                          >
                            {entry.status === "included"
                              ? "Desconsiderar"
                              : "Restaurar"}
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-card-list cash-mobile-list">
              {entries.map((entry) => (
                <article
                  className={`mobile-data-card ${
                    entry.status === "excluded" ? "cash-row-excluded" : ""
                  }`}
                  key={`mobile-${entry.id}`}
                >
                  <span>
                    <strong>{entry.description}</strong>
                    <small>
                      {formatBrazilianDate(entry.occurredOn)} · {entry.category}
                      {entry.financialAccountName
                        ? ` · ${entry.financialAccountName}`
                        : ""}
                    </small>
                  </span>
                  <strong
                    className={
                      entry.direction === "outflow"
                        ? "cash-outflow"
                        : "cash-inflow"
                    }
                  >
                    {entry.direction === "outflow" ? "− " : "+ "}
                    {formatCurrency(entry.amountCents)}
                  </strong>
                  <span className="cash-mobile-actions">
                    {entry.origin === "manual" &&
                      entry.status === "included" && (
                        <button
                          className="text-button"
                          onClick={() => openEdit(entry)}
                        >
                          Editar
                        </button>
                      )}
                    <button
                      className="text-button"
                      onClick={() => setDetailsEntryId(entry.id)}
                    >
                      Detalhes
                    </button>
                    <button
                      className="text-button"
                      onClick={() => requestStatusChange(entry)}
                    >
                      {entry.status === "included"
                        ? "Desconsiderar"
                        : "Restaurar"}
                    </button>
                  </span>
                </article>
              ))}
            </div>
            {payload && payload.pagination.total > payload.pagination.pageSize && (
              <nav className="cash-pagination" aria-label="Paginação das movimentações">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Anteriores
                </button>
                <span>
                  {Math.min((page - 1) * payload.pagination.pageSize + 1, payload.pagination.total)}–{Math.min(page * payload.pagination.pageSize, payload.pagination.total)} de {payload.pagination.total}
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!payload.pagination.hasMore}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Próximas
                </button>
              </nav>
            )}
          </>
        ) : (
          <div className="empty-state cash-empty">
            <strong>Nenhum lançamento neste filtro</strong>
            <p>
              Pagamentos registrados aparecem aqui automaticamente. Você também
              pode adicionar entradas e saídas manuais.
            </p>
          </div>
        )}
      </section>}

      {tab === "accounts" && (
        <section className="panel full-panel cash-accounts-panel">
          <div className="panel-heading cash-heading">
            <div>
              <p className="section-kicker">Conferência</p>
              <h2>Contas e saldos</h2>
            </div>
            {canEditSettings && (
              <button type="button" className="secondary-button" onClick={() => setNewAccountOpen((current) => !current)}>
                {newAccountOpen ? "Cancelar" : "+ Nova conta"}
              </button>
            )}
          </div>

          {newAccountOpen && canEditSettings && (
            <form className="cash-account-form" onSubmit={createFinancialAccount}>
              <label className="field"><span>Nome da conta</span><input name="name" placeholder="Ex.: Conta principal" maxLength={80} required /></label>
              <label className="field"><span>Instituição (opcional)</span><input name="institution" maxLength={80} /></label>
              <label className="field"><span>Tipo</span><select name="kind" defaultValue="checking"><option value="checking">Conta corrente</option><option value="savings">Poupança</option><option value="cash">Dinheiro em caixa</option><option value="other">Outra</option></select></label>
              <label className="field"><span>Saldo inicial (opcional)</span><span className="currency-input"><span>R$</span><input name="openingBalance" inputMode="decimal" placeholder="0,00" /></span></label>
              <label className="field"><span>Data do saldo inicial</span><BrazilianDateInput name="openingBalanceOn" max={referenceDate} /></label>
              <div className="cash-form-actions"><button type="submit" className="primary-button" disabled={busy === "financial-account"}>Salvar conta</button></div>
            </form>
          )}

          <div className="cash-account-cards">
            {financialAccounts.map((account) => {
              const difference = account.lastReconciliationDifferenceCents;
              return (
                <article key={account.id} className={!account.active ? "inactive" : ""}>
                  <header>
                    <span><strong>{account.name}</strong><small>{account.institution || "Sem instituição"}{account.active ? "" : " · inativa"}</small></span>
                    <strong>{account.calculatedBalanceCents == null ? "Saldo inicial pendente" : formatCurrency(account.calculatedBalanceCents)}</strong>
                  </header>
                  <dl>
                    <div><dt>Saldo calculado até {payload ? formatBrazilianDate(payload.period.end) : "o fim do período"}</dt><dd>{account.calculatedBalanceCents == null ? "Defina o saldo inicial" : formatCurrency(account.calculatedBalanceCents)}</dd></div>
                    <div><dt>Última conferência</dt><dd>{account.reconciledOn ? `${formatBrazilianDate(account.reconciledOn)} · ${formatCurrency(account.reconciledBalanceCents ?? 0)}` : "Ainda não realizada"}</dd></div>
                    {difference !== null && <div className={difference === 0 ? "ok" : "attention"}><dt>Diferença na última conferência</dt><dd>{formatCurrency(difference)}</dd></div>}
                    {!!account.scheduledSettlementCount && <div><dt>Recebimentos futuros vinculados</dt><dd>{account.scheduledSettlementCount}</dd></div>}
                  </dl>
                  {canEditSettings && (
                    <div className="cash-account-actions">
                      <button type="button" className="text-button" onClick={() => setReconcileAccountId(account.id)}>Conciliar</button>
                      <button type="button" className="text-button" onClick={() => setConfigureAccountId(account.id)}>Saldo inicial</button>
                      <button type="button" className="text-button muted" disabled={busy === `financial-account:${account.id}`} onClick={() => void toggleFinancialAccount(account)}>{account.active ? "Inativar" : "Reativar"}</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {canEditSettings && (
            <div className="cash-admin-settings">
              <form onSubmit={saveStartDay}>
                <div><p className="section-kicker">Períodos</p><h3>Início do mês financeiro</h3><p>Ex.: dia 5 cria períodos do dia 5 ao dia 4 seguinte.</p></div>
                <label className="field"><span>Primeiro dia</span><select name="monthStartDay" defaultValue={payload?.monthStartDay ?? 1} key={payload?.monthStartDay ?? 1}>{Array.from({ length: 28 }, (_, index) => index + 1).map((day) => <option key={day} value={day}>Dia {day}</option>)}</select></label>
                <button className="secondary-button" type="submit" disabled={busy === "settings"}>Salvar</button>
              </form>
              <div className="cash-period-control">
                <div><p className="section-kicker">Segurança</p><h3>{payload?.periodState.status === "closed" ? "Período fechado" : "Fechar este período"}</h3><p>{payload?.periodState.status === "closed" ? "Movimentações passadas estão protegidas contra alterações." : "Use depois de conferir as contas. É possível reabrir com justificativa."}</p></div>
                <button type="button" className={payload?.periodState.status === "closed" ? "secondary-button" : "primary-button"} onClick={() => setPeriodAction(payload?.periodState.status === "closed" ? "reopen" : "close")} disabled={!payload || busy === "period-state" || (payload.periodState.status === "open" && payload.period.end > referenceDate)}>{payload?.periodState.status === "closed" ? "Reabrir período" : payload && payload.period.end > referenceDate ? "Disponível após o período" : "Fechar período"}</button>
              </div>
            </div>
          )}
        </section>
      )}

      {transferOpen && (
        <div className="dialog-backdrop" role="presentation">
          <form className="dialog-card dialog-small" onSubmit={createTransfer} role="dialog" aria-modal="true" aria-labelledby="cash-transfer-title">
            <div className="dialog-header"><div><p className="section-kicker">Entre contas</p><h2 id="cash-transfer-title">Registrar transferência</h2></div><button type="button" className="dialog-close" onClick={() => setTransferOpen(false)}>×</button></div>
            <div className="dialog-content cash-dialog-fields">
              <label className="field"><span>Conta de origem</span><select name="fromFinancialAccountId" required defaultValue=""><option value="" disabled>Escolha</option>{financialAccounts.filter((account) => account.active).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
              <label className="field"><span>Conta de destino</span><select name="toFinancialAccountId" required defaultValue=""><option value="" disabled>Escolha</option>{financialAccounts.filter((account) => account.active).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
              <label className="field"><span>Data</span><BrazilianDateInput name="occurredOn" defaultValue={referenceDate} required /></label>
              <label className="field"><span>Valor</span><span className="currency-input"><span>R$</span><input name="amount" inputMode="decimal" required /></span></label>
              <label className="field"><span>Descrição (opcional)</span><input name="description" maxLength={160} placeholder="Transferência entre contas" /></label>
              <label className="field"><span>Observação (opcional)</span><textarea name="note" maxLength={500} /></label>
            </div>
            <div className="dialog-actions full"><button type="button" className="secondary-button" onClick={() => setTransferOpen(false)}>Cancelar</button><button type="submit" className="primary-button" disabled={busy === "transfer"}>Registrar</button></div>
          </form>
        </div>
      )}

      {entryAction && (
        <div className="dialog-backdrop" role="presentation">
          <form className="dialog-card dialog-small" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void changeStatus(entryAction.entry, String(form.get("reason") ?? "")); }} role="dialog" aria-modal="true" aria-labelledby="cash-action-title">
            <div className="dialog-header"><div><p className="section-kicker">Histórico preservado</p><h2 id="cash-action-title">{entryAction.action === "exclude" ? "Desconsiderar lançamento" : "Restaurar lançamento"}</h2></div><button type="button" className="dialog-close" onClick={() => setEntryAction(null)}>×</button></div>
            <div className="dialog-content"><p><strong>{entryAction.entry.description}</strong> · {formatCurrency(entryAction.entry.amountCents)}</p>{entryAction.action === "exclude" ? <label className="field"><span>Motivo</span><textarea name="reason" required maxLength={300} autoFocus /></label> : <p>O lançamento voltará a fazer parte dos totais.</p>}</div>
            <div className="dialog-actions full"><button type="button" className="secondary-button" onClick={() => setEntryAction(null)}>Cancelar</button><button type="submit" className="primary-button" disabled={busy.startsWith("status:")}>{entryAction.action === "exclude" ? "Desconsiderar" : "Restaurar"}</button></div>
          </form>
        </div>
      )}

      {detailsEntryId && (() => {
        const entry = entries.find((item) => item.id === detailsEntryId);
        if (!entry) return null;
        return (
          <div className="dialog-backdrop" role="presentation">
            <div className="dialog-card dialog-small" role="dialog" aria-modal="true" aria-labelledby="cash-details-title">
              <div className="dialog-header"><div><p className="section-kicker">Movimentação</p><h2 id="cash-details-title">Detalhes</h2></div><button type="button" className="dialog-close" onClick={() => setDetailsEntryId(null)}>×</button></div>
              <div className="dialog-content cash-entry-details">
                <dl><div><dt>Descrição</dt><dd>{entry.description}</dd></div><div><dt>Data</dt><dd>{formatBrazilianDate(entry.occurredOn)}</dd></div><div><dt>Valor</dt><dd>{formatCurrency(entry.amountCents)}</dd></div><div><dt>Categoria</dt><dd>{entry.category}</dd></div><div><dt>Conta</dt><dd>{entry.financialAccountName || "Não informada"}</dd></div><div><dt>Origem</dt><dd>{entry.origin === "invoice_payment" ? `Fatura ${entry.invoiceNumber ?? ""}` : entry.origin === "transfer" ? "Transferência interna" : "Lançamento manual"}</dd></div>{entry.note && <div><dt>Observação</dt><dd>{entry.note}</dd></div>}{entry.exclusionReason && <div><dt>Motivo da exclusão</dt><dd>{entry.exclusionReason}</dd></div>}<div><dt>Registrado por</dt><dd>{entry.createdByName || "Sistema"}</dd></div></dl>
                <div className="cash-receipt-row"><span><strong>Comprovante</strong><small>{entry.receiptName || "Nenhum arquivo anexado"}</small></span>{entry.receiptUrl ? <a className="secondary-button" href={entry.receiptUrl} target="_blank" rel="noreferrer">Abrir</a> : <label className="secondary-button cash-file-button">Anexar<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadReceipt(entry, file); }} /></label>}</div>
              </div>
              <div className="dialog-actions full"><button type="button" className="secondary-button" onClick={() => setDetailsEntryId(null)}>Fechar</button></div>
            </div>
          </div>
        );
      })()}

      {reconcileAccountId && (() => {
        const account = financialAccounts.find((item) => item.id === reconcileAccountId);
        if (!account) return null;
        return <div className="dialog-backdrop" role="presentation"><form className="dialog-card dialog-small" onSubmit={reconcileAccount} role="dialog" aria-modal="true"><div className="dialog-header"><div><p className="section-kicker">Conciliação</p><h2>Conferir {account.name}</h2></div><button type="button" className="dialog-close" onClick={() => setReconcileAccountId(null)}>×</button></div><div className="dialog-content cash-dialog-fields"><p>Saldo calculado: <strong>{account.calculatedBalanceCents == null ? "defina primeiro o saldo inicial" : formatCurrency(account.calculatedBalanceCents)}</strong></p><label className="field"><span>Data da conferência</span><BrazilianDateInput name="reconciledOn" defaultValue={payload && payload.period.end < referenceDate ? payload.period.end : referenceDate} required /></label><label className="field"><span>Saldo no banco ou caixa físico</span><span className="currency-input"><span>R$</span><input name="statementBalance" inputMode="decimal" required autoFocus /></span></label><label className="field"><span>Observação (opcional)</span><textarea name="note" maxLength={500} /></label></div><div className="dialog-actions full"><button type="button" className="secondary-button" onClick={() => setReconcileAccountId(null)}>Cancelar</button><button type="submit" className="primary-button" disabled={busy.startsWith("reconcile:") || account.calculatedBalanceCents == null}>Salvar conferência</button></div></form></div>;
      })()}

      {configureAccountId && (() => {
        const account = financialAccounts.find((item) => item.id === configureAccountId);
        if (!account) return null;
        return <div className="dialog-backdrop" role="presentation"><form className="dialog-card dialog-small" onSubmit={configureFinancialAccount} role="dialog" aria-modal="true"><div className="dialog-header"><div><p className="section-kicker">Base do cálculo</p><h2>Saldo inicial</h2></div><button type="button" className="dialog-close" onClick={() => setConfigureAccountId(null)}>×</button></div><div className="dialog-content cash-dialog-fields"><p>Informe o saldo no começo da data escolhida. As movimentações desse dia em diante serão somadas a ele.</p><label className="field"><span>Saldo inicial</span><span className="currency-input"><span>R$</span><input name="openingBalance" inputMode="decimal" defaultValue={account.openingBalanceCents == null ? "" : (account.openingBalanceCents / 100).toFixed(2).replace(".", ",")} required /></span></label><label className="field"><span>Data de referência</span><BrazilianDateInput name="openingBalanceOn" defaultValue={account.openingBalanceOn ?? referenceDate} max={referenceDate} required /></label></div><div className="dialog-actions full"><button type="button" className="secondary-button" onClick={() => setConfigureAccountId(null)}>Cancelar</button><button type="submit" className="primary-button" disabled={busy.startsWith("configure:")}>Salvar</button></div></form></div>;
      })()}

      {periodAction && payload && (
        <div className="dialog-backdrop" role="presentation"><form className="dialog-card dialog-small" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const reason = String(form.get("reason") ?? "").trim(); if (periodAction === "reopen" && !reason) { setError("Informe o motivo da reabertura."); return; } void changePeriodState(periodAction, reason).then((success) => { if (success) setPeriodAction(null); }); }} role="dialog" aria-modal="true"><div className="dialog-header"><div><p className="section-kicker">{formatBrazilianDate(payload.period.start)} a {formatBrazilianDate(payload.period.end)}</p><h2>{periodAction === "close" ? "Fechar período" : "Reabrir período"}</h2></div><button type="button" className="dialog-close" onClick={() => setPeriodAction(null)}>×</button></div><div className="dialog-content"><p>{periodAction === "close" ? "Depois do fechamento, lançamentos e pagamentos desse período ficam protegidos. Confira as contas antes de continuar." : "A reabertura permite alterar o período novamente e ficará registrada no histórico."}</p><label className="field"><span>{periodAction === "close" ? "Observação (opcional)" : "Motivo da reabertura"}</span><textarea name="reason" required={periodAction === "reopen"} maxLength={500} /></label></div><div className="dialog-actions full"><button type="button" className="secondary-button" onClick={() => setPeriodAction(null)}>Cancelar</button><button type="submit" className="primary-button" disabled={busy === "period-state"}>{periodAction === "close" ? "Confirmar fechamento" : "Confirmar reabertura"}</button></div></form></div>
      )}
    </div>
  );
}
