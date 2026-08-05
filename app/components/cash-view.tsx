"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import {
  BrazilianDateInput,
  formatBrazilianDate,
} from "@/app/components/brazilian-date-input";

type CashDirection = "inflow" | "outflow";
type CashStatus = "included" | "excluded";

type CashEntry = {
  id: string;
  direction: CashDirection;
  origin: "invoice_payment" | "manual";
  sourcePaymentId: string | null;
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
};

type CashPayload = {
  anchorMonth: string;
  monthStartDay: number;
  period: { start: string; end: string };
  totals: {
    inflowCents: number;
    outflowCents: number;
    balanceCents: number;
    receivableCents: number;
    receivableCount: number;
    excludedCount: number;
  };
  analytics: {
    serviceStats: Array<{
      code: string;
      label: string;
      count: number;
      unit: string;
      billedCents: number;
      receivedCents: number;
    }>;
    previousTotals: { inflowCents: number; outflowCents: number };
    activity: {
      invoiceCount: number;
      customerCount: number;
      dogCount: number;
      averageTicketCents: number;
    };
    credits: {
      soldUnits: number;
      soldCents: number;
      usedUnits: number;
      availableUnits: number;
    };
    dailyCash: Array<{
      date: string;
      inflowCents: number;
      outflowCents: number;
      cumulativeCents: number;
    }>;
    expenseCategories: Array<{ category: string; amountCents: number }>;
  };
  entries: CashEntry[];
};

type CashDraft = {
  direction: CashDirection;
  occurredOn: string;
  amount: string;
  category: string;
  description: string;
  note: string;
};

const inflowCategories = [
  "Serviços fora do sistema",
  "Créditos",
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
  };
}

export function CashView({
  referenceDate,
  onChanged,
}: {
  referenceDate: string;
  onChanged: () => void;
}) {
  const currentMonth = referenceDate.slice(0, 7);
  const [anchorMonth, setAnchorMonth] = useState(currentMonth);
  const [payload, setPayload] = useState<CashPayload | null>(null);
  const [filter, setFilter] = useState<
    "all" | "inflow" | "outflow" | "excluded"
  >("all");
  const [draft, setDraft] = useState<CashDraft>(() =>
    draftFor(referenceDate),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await cashRequest<CashPayload>(
        `/api/cash?month=${encodeURIComponent(anchorMonth)}`,
      );
      setPayload(result);
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível carregar o Caixa.",
      );
    }
  }, [anchorMonth]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const entries = useMemo(() => {
    const all = payload?.entries ?? [];
    if (filter === "excluded") {
      return all.filter((entry) => entry.status === "excluded");
    }
    if (filter === "inflow" || filter === "outflow") {
      return all.filter(
        (entry) =>
          entry.direction === filter && entry.status === "included",
      );
    }
    return all;
  }, [filter, payload]);

  const categories =
    draft.direction === "inflow" ? inflowCategories : outflowCategories;

  function openNew(direction: CashDirection) {
    setEditingId(null);
    setDraft(draftFor(referenceDate, direction));
    setFormOpen(true);
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
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setDraft(draftFor(referenceDate));
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

  async function changeStatus(entry: CashEntry) {
    if (busy) return;
    const action = entry.status === "included" ? "exclude" : "restore";
    let reason: string | undefined;
    if (action === "exclude") {
      const answer = window.prompt(
        "Por que este lançamento deve ser desconsiderado?",
      );
      if (answer === null) return;
      reason = answer.trim();
      if (!reason) {
        setError("Informe o motivo para manter o histórico claro.");
        return;
      }
    }
    setBusy(`status:${entry.id}`);
    try {
      await cashRequest(`/api/cash/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action, reason }),
      });
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
        </div>
        <div className="cash-period-actions" aria-label="Navegar entre períodos">
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

      <section className="finance-summary cash-summary">
        <div>
          <span>Entradas consideradas</span>
          <strong>{formatCurrency(payload?.totals.inflowCents ?? 0)}</strong>
        </div>
        <div>
          <span>Saídas consideradas</span>
          <strong>{formatCurrency(payload?.totals.outflowCents ?? 0)}</strong>
        </div>
        <div>
          <span>Saldo do período</span>
          <strong
            className={
              (payload?.totals.balanceCents ?? 0) < 0 ? "negative-value" : ""
            }
          >
            {formatCurrency(payload?.totals.balanceCents ?? 0)}
          </strong>
        </div>
        <div>
          <span>A receber</span>
          <strong>{formatCurrency(payload?.totals.receivableCents ?? 0)}</strong>
          <small>
            {payload?.totals.receivableCount ?? 0} faturas em aberto
          </small>
        </div>
      </section>

      <section className="panel cash-service-overview">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Atividade do período</p>
            <h2>Serviços</h2>
          </div>
          <small>Valores faturados · recebimentos identificados à parte</small>
        </div>
        <div className="cash-service-grid">
          {(payload?.analytics.serviceStats ?? []).map((service) => (
            <article key={service.code}>
              <span>{service.label}</span>
              <strong>{formatCurrency(service.billedCents)}</strong>
              <small>
                {new Intl.NumberFormat("pt-BR", {
                  maximumFractionDigits: 1,
                }).format(service.count)}{" "}
                {service.unit}
              </small>
              <small>Recebido: {formatCurrency(service.receivedCents)}</small>
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
                <span>Ticket médio</span>
                <strong>{formatCurrency(payload.analytics.activity.averageTicketCents)}</strong>
              </article>
              <article>
                <span>Faturas emitidas</span>
                <strong>{payload.analytics.activity.invoiceCount}</strong>
              </article>
              <article>
                <span>Clientes faturados</span>
                <strong>{payload.analytics.activity.customerCount}</strong>
              </article>
              <article>
                <span>Cães atendidos</span>
                <strong>{payload.analytics.activity.dogCount}</strong>
              </article>
            </div>

            <div className="cash-chart-grid">
              <article className="cash-chart-card">
                <div>
                  <p className="section-kicker">Comparativo</p>
                  <h3>Entradas e saídas</h3>
                </div>
                {(() => {
                  const values = [
                    payload.totals.inflowCents,
                    payload.totals.outflowCents,
                    payload.analytics.previousTotals.inflowCents,
                    payload.analytics.previousTotals.outflowCents,
                  ];
                  const maximum = Math.max(...values, 1);
                  return (
                    <div className="cash-comparison-chart">
                      {[
                        [
                          "Período atual",
                          payload.totals.inflowCents,
                          payload.totals.outflowCents,
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
                  <h3>Faturamento por serviço</h3>
                </div>
                <div className="cash-service-chart">
                  {payload.analytics.serviceStats.map((service) => {
                    const maximum = Math.max(
                      ...payload.analytics.serviceStats.map((item) => item.billedCents),
                      1,
                    );
                    return (
                      <div key={`chart-${service.code}`}>
                        <span>{service.label}</span>
                        <i>
                          <b style={{ width: `${barSize(service.billedCents, maximum)}%` }} />
                        </i>
                        <small>{formatCurrency(service.billedCents)}</small>
                      </div>
                    );
                  })}
                </div>
              </article>

              <article className="cash-chart-card cash-daily-card">
                <div>
                  <p className="section-kicker">Evolução</p>
                  <h3>Saldo acumulado</h3>
                </div>
                {payload.analytics.dailyCash.length ? (
                  <div className="cash-daily-chart" aria-label="Saldo acumulado por dia">
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
                  <div><dt>Valor vendido</dt><dd>{formatCurrency(payload.analytics.credits.soldCents)}</dd></div>
                  <div><dt>Utilizados</dt><dd>{payload.analytics.credits.usedUnits}</dd></div>
                  <div><dt>Disponíveis</dt><dd>{payload.analytics.credits.availableUnits}</dd></div>
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

      <section className="panel full-panel">
        <div className="panel-heading cash-heading">
          <div>
            <p className="section-kicker">Movimentações</p>
            <h2>Entradas e saídas</h2>
          </div>
          <div className="heading-actions">
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
              <select
                value={draft.category}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
              >
                {categories.map((category) => (
                  <option key={category}>{category}</option>
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

        <div className="filter-chips cash-filters" aria-label="Filtrar Caixa">
          {[
            ["all", "Todos"],
            ["inflow", "Entradas"],
            ["outflow", "Saídas"],
            ["excluded", "Desconsiderados"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={filter === id ? "active" : ""}
              onClick={() =>
                setFilter(
                  id as "all" | "inflow" | "outflow" | "excluded",
                )
              }
              aria-pressed={filter === id}
            >
              {label}
            </button>
          ))}
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
                              ? `${entry.customerName ?? "Cliente"} · lançamento automático`
                              : entry.note || "Lançamento manual"}
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
                            onClick={() => void changeStatus(entry)}
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
                      onClick={() => void changeStatus(entry)}
                    >
                      {entry.status === "included"
                        ? "Desconsiderar"
                        : "Restaurar"}
                    </button>
                  </span>
                </article>
              ))}
            </div>
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
      </section>

      <details className="panel cash-settings">
        <summary>Configurar início do mês financeiro</summary>
        <form onSubmit={saveStartDay}>
          <label className="field">
            <span>Primeiro dia do período</span>
            <select
              name="monthStartDay"
              defaultValue={payload?.monthStartDay ?? 1}
              key={payload?.monthStartDay ?? 1}
            >
              {Array.from({ length: 28 }, (_, index) => index + 1).map(
                (day) => (
                  <option key={day} value={day}>
                    Dia {day}
                  </option>
                ),
              )}
            </select>
          </label>
          <p>
            Se escolher dia 5, cada período vai do dia 5 ao dia 4 do mês
            seguinte.
          </p>
          <button
            className="primary-button"
            type="submit"
            disabled={busy === "settings"}
          >
            {busy === "settings" ? "Salvando…" : "Salvar configuração"}
          </button>
        </form>
      </details>
    </div>
  );
}
