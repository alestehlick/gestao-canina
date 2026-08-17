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
import {
  generateStatementPdf,
  type CustomerStatement,
} from "@/lib/statement-pdf";
import { todayInSaoPaulo } from "@/lib/service-rules";

type PortalData = {
  identity: { email: string; displayName: string; role: "customer" };
  account: {
    id: string;
    displayName: string;
    addressLine: string | null;
    addressCity: string | null;
    addressRegion: string | null;
    addressPostalCode: string | null;
    cpf: string | null;
    birthDate: string | null;
  };
  tutors: Array<{
    id: string;
    fullName: string;
    email: string | null;
    phoneE164: string | null;
    isFinancialContact: boolean;
  }>;
  dogs: Array<{
    id: string;
    name: string;
    breed: string | null;
    birthDate: string | null;
    sex: "female" | "male" | "unknown";
    weightGrams: number | null;
    neutered: boolean | null;
    photoUrl: string | null;
    feedingNotes: string | null;
    temperamentNotes: string | null;
    medicationNotes: string | null;
    emergencyNotes: string | null;
    vaccinesCurrent: boolean | null;
    vaccines: Array<{ name: string; expiresOn: string }>;
  }>;
  appointments: Array<{
    id: string;
    dogId: string;
    dogName: string;
    startDate: string;
    endDate: string;
    startTime: string | null;
    endTime: string | null;
    lodgingNights: number | null;
    depositPercent: number | null;
    status: string;
    serviceName: string | null;
    serviceCode: string | null;
    description: string | null;
    totalCents: number | null;
    settlementMethod: string | null;
  }>;
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    status: "draft" | "issued" | "paid" | "void";
    issuedAt: string | null;
    dueDate: string | null;
    totalCents: number;
    sourceType: string;
    items: Array<{
      id: string;
      dogName: string | null;
      serviceName: string;
      serviceDate: string;
      description: string | null;
      amountCents: number;
      serviceCode: string;
      lodgingStartDate: string | null;
      lodgingEndDate: string | null;
      lodgingNights: number | null;
      lodgingDailyRateCents: number | null;
      lodgingTableDailyRateCents: number | null;
      lodgingRateProfile: string | null;
      lodgingLongStayDiscountPercent: number | null;
      lodgingLongStayDiscountCents: number;
      depositPercent: number | null;
    }>;
  }>;
  credits: Array<{
    serviceCatalogId: string;
    serviceName: string;
    serviceCode: string;
    availableUnits: number;
  }>;
  receipts: Array<{
    id: string;
    receiptNumber: string;
    dogName: string;
    serviceName: string;
    serviceDate: string;
    creditUnits: number;
  }>;
  requests: Array<{
    id: string;
    type: "service" | "cancellation" | "profile_update";
    status: "pending" | "approved" | "rejected" | "cancelled";
    dogId: string | null;
    appointmentId: string | null;
    serviceCatalogId: string | null;
    requestedDate: string | null;
    requestedEndDate: string | null;
    requestedStartTime: string | null;
    requestedEndTime: string | null;
    detailsJson: string | null;
    notes: string | null;
    responseNote: string | null;
    createdAt: string;
  }>;
  services: Array<{ id: string; code: string; name: string }>;
};

type PortalView = "home" | "schedule" | "dogs" | "finance" | "account";

const today = todayInSaoPaulo();
const vaccineAlertLimit = (() => {
  const value = new Date(`${today}T12:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 30);
  return value.toISOString().slice(0, 10);
})();

function nextDay(value: string) {
  if (!value) return today;
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function money(cents: number | null) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format((cents ?? 0) / 100);
}

function maskedCpf(value: string | null) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length === 11 ? `***.***.***-${digits.slice(-2)}` : "Não informado";
}

function shortDate(value: string | null) {
  if (!value) return "—";
  return formatBrazilianDate(value);
}

function portalTimeLabel(value: string) {
  if (value === "manha") return "Manhã";
  if (value === "tarde") return "Tarde";
  if (value === "noite") return "Noite";
  return value;
}

function invoiceItemDetail(item: PortalData["invoices"][number]["items"][number]) {
  if (
    item.serviceCode === "hotel" &&
    item.lodgingStartDate &&
    item.lodgingEndDate &&
    item.lodgingNights !== null
  ) {
    const nights = new Intl.NumberFormat("pt-BR", {
      maximumFractionDigits: 1,
    }).format(item.lodgingNights);
    return `Check-in: ${shortDate(item.lodgingStartDate)} · Check-out: ${shortDate(item.lodgingEndDate)} · ${nights} ${item.lodgingNights === 1 ? "diária" : "diárias"}`;
  }
  return shortDate(item.serviceDate);
}

function invoiceItemTableAmount(
  item: PortalData["invoices"][number]["items"][number],
) {
  if (
    item.serviceCode !== "hotel" ||
    item.lodgingNights === null ||
    !(item.lodgingTableDailyRateCents ?? item.lodgingDailyRateCents)
  ) {
    return undefined;
  }
  const fullStayCents = Math.round(
    item.lodgingNights *
      (item.lodgingTableDailyRateCents ?? item.lodgingDailyRateCents!),
  );
  if (item.serviceName === "Sinal da hospedagem" && item.depositPercent) {
    return Math.round((fullStayCents * item.depositPercent) / 100);
  }
  if (item.serviceName === "Saldo da hospedagem" && item.depositPercent) {
    return Math.round(
      (fullStayCents * (100 - item.depositPercent)) / 100,
    );
  }
  return fullStayCents;
}

function statusLabel(status: string) {
  return (
    {
      scheduled: "Agendado",
      confirmed: "Confirmado",
      completed: "Concluído",
      cancelled: "Cancelado",
      pending: "Aguardando análise",
      approved: "Aprovado",
      rejected: "Não aprovado",
      paid: "Pago",
      issued: "Em aberto",
      void: "Cancelado",
    }[status] ?? status
  );
}

function portalRequestDetails(value: string | null) {
  if (!value) return "";
  try {
    const details = JSON.parse(value) as Record<string, unknown>;
    const parts: string[] = [];
    if (details.groomingAddon === true) parts.push("com tosa");
    if (details.transportDirection === "round_trip") parts.push("ida e volta");
    else if (details.transportDirection === "one_way") parts.push("ida");
    if (details.transportDistance === "long") parts.push("distância longa");
    else if (details.transportDistance === "short") parts.push("distância curta");
    return parts.join(" · ");
  } catch {
    return "";
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as {
    error?: { message?: string };
  } & T;
  if (!response.ok) {
    throw new Error(payload?.error?.message || "Não foi possível concluir.");
  }
  return payload as T;
}

export default function CustomerPortal() {
  const [data, setData] = useState<PortalData | null>(null);
  const [view, setView] = useState<PortalView>("home");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [requestStartDate, setRequestStartDate] = useState("");
  const [requestEndDate, setRequestEndDate] = useState("");
  const [cancelAppointmentId, setCancelAppointmentId] = useState<string | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/portal", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 401 || response.status === 403) {
        window.location.assign("/");
        return;
      }
      setData(await readResponse<PortalData>(response));
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível abrir seu portal.",
      );
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!cancelAppointmentId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCancelAppointmentId(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [cancelAppointmentId]);

  const futureAppointments = useMemo(
    () =>
      (data?.appointments ?? [])
        .filter(
          (appointment) =>
            appointment.endDate >= today &&
            !["completed", "cancelled"].includes(appointment.status),
        )
        .sort(
          (left, right) =>
            left.startDate.localeCompare(right.startDate) ||
            left.dogName.localeCompare(right.dogName, "pt-BR"),
        ),
    [data],
  );
  const pastAppointments = useMemo(
    () =>
      (data?.appointments ?? [])
        .filter(
          (appointment) =>
            appointment.endDate < today ||
            appointment.status === "completed" ||
            appointment.status === "cancelled",
        )
        .sort((left, right) => right.startDate.localeCompare(left.startDate))
        .slice(0, 40),
    [data],
  );
  const selectedService = data?.services.find(
    (service) => service.id === selectedServiceId,
  );
  const pendingCancellationIds = useMemo(
    () =>
      new Set(
        (data?.requests ?? [])
          .filter(
            (request) =>
              request.type === "cancellation" && request.status === "pending",
          )
          .map((request) => request.appointmentId)
          .filter((id): id is string => Boolean(id)),
      ),
    [data],
  );
  const petAlerts = useMemo(
    () =>
      (data?.dogs ?? []).flatMap((dog) =>
        dog.vaccines
          .filter((vaccine) => vaccine.expiresOn <= vaccineAlertLimit)
          .map((vaccine) => ({
            dogName: dog.name,
            vaccineName: vaccine.name,
            expiresOn: vaccine.expiresOn,
          })),
      ),
    [data],
  );

  async function submitServiceRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || busy) return;
    const form = new FormData(event.currentTarget);
    setBusy("request");
    setMessage("");
    setError("");
    try {
      await readResponse(
        await fetch("/api/portal/requests", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "service",
            dogId: String(form.get("dogId") ?? ""),
            serviceCatalogId: String(form.get("serviceCatalogId") ?? ""),
            requestedDate: String(form.get("requestedDate") ?? ""),
            requestedEndDate:
              String(form.get("requestedEndDate") ?? "") || undefined,
            requestedStartTime:
              String(form.get("requestedStartTime") ?? "") || undefined,
            requestedEndTime:
              String(form.get("requestedEndTime") ?? "") || undefined,
            groomingAddon: form.get("groomingAddon") === "on",
            transportDirection:
              String(form.get("transportDirection") ?? "") || undefined,
            transportDistance:
              String(form.get("transportDistance") ?? "") || undefined,
            notes: String(form.get("notes") ?? "") || undefined,
          }),
        }),
      );
      event.currentTarget.reset();
      setSelectedServiceId("");
      setRequestStartDate("");
      setRequestEndDate("");
      setMessage(
        "Pedido enviado. Assim que a equipe aprovar, ele entrará automaticamente na agenda.",
      );
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Não foi possível enviar.",
      );
    } finally {
      setBusy("");
    }
  }

  async function requestCancellation(
    event: FormEvent<HTMLFormElement>,
    appointmentId: string,
  ) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const notes = String(form.get("reason") ?? "").trim();
    if (!notes) return;
    setBusy(`cancel:${appointmentId}`);
    setMessage("");
    setError("");
    try {
      await readResponse(
        await fetch("/api/portal/requests", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "cancellation",
            appointmentId,
            notes,
          }),
        }),
      );
      setMessage("Pedido de cancelamento enviado para a equipe.");
      setCancelAppointmentId(null);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Não foi possível enviar.",
      );
    } finally {
      setBusy("");
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy("profile");
    setMessage("");
    setError("");
    try {
      await readResponse(
        await fetch("/api/portal", {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            phone: String(form.get("phone") ?? "") || null,
            addressLine: String(form.get("addressLine") ?? "") || null,
            addressCity: String(form.get("addressCity") ?? "") || null,
            addressRegion: String(form.get("addressRegion") ?? "") || null,
            addressPostalCode:
              String(form.get("addressPostalCode") ?? "") || null,
          }),
        }),
      );
      setMessage("Dados atualizados.");
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Não foi possível salvar.",
      );
    } finally {
      setBusy("");
    }
  }

  async function downloadInvoice(invoice: PortalData["invoices"][number]) {
    setBusy(`invoice:${invoice.id}`);
    try {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      pdf.setTextColor(30, 55, 46);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(15);
      pdf.text("Hospet Quintal", 18, 22);
      pdf.setFontSize(13);
      pdf.text("Fatura", 192, 22, { align: "right" });
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(104, 111, 107);
      pdf.setFontSize(8);
      pdf.text(`Nº ${invoice.invoiceNumber}`, 192, 29, { align: "right" });
      pdf.setDrawColor(209, 213, 210);
      pdf.line(18, 38, 192, 38);
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(38, 46, 41);
      pdf.setFontSize(7.5);
      pdf.text("CLIENTE", 18, 52);
      pdf.text("EMISSÃO", 145, 52);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10.5);
      pdf.text(data?.account.displayName ?? "", 18, 60);
      pdf.setFontSize(9);
      pdf.text(shortDate(invoice.issuedAt), 145, 60);
      let y = 79;
      const tableTotalCents = invoice.items.reduce(
        (total, item) => total + (invoiceItemTableAmount(item) ?? item.amountCents),
        0,
      );
      const hasLodging = invoice.items.some(
        (item) => invoiceItemTableAmount(item) !== undefined,
      );
      pdf.setFont("helvetica", "bold");
      pdf.setTextColor(86, 93, 89);
      pdf.setFontSize(7.5);
      pdf.text("DESCRIÇÃO", 18, y);
      pdf.text("VALOR", 192, y, { align: "right" });
      pdf.setDrawColor(209, 213, 210);
      pdf.line(18, y + 4, 192, y + 4);
      y += 14;
      for (const item of invoice.items) {
        if (y > 260) {
          pdf.addPage();
          y = 22;
        }
        pdf.setTextColor(38, 46, 41);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        pdf.text(`${item.dogName ?? "Cliente"} · ${item.serviceName}`, 18, y);
        pdf.setFont("helvetica", "normal");
        pdf.text(money(item.amountCents), 192, y, { align: "right" });
        const tableAmountCents = invoiceItemTableAmount(item);
        if (tableAmountCents !== undefined) {
          pdf.setTextColor(128, 134, 131);
          pdf.setFontSize(7);
          pdf.text(`Tabela: ${money(tableAmountCents)}`, 192, y + 4, {
            align: "right",
          });
        }
        if (item.lodgingLongStayDiscountCents > 0) {
          pdf.setTextColor(128, 134, 131);
          pdf.setFontSize(7);
          pdf.text(
            `Longa estadia (${item.lodgingLongStayDiscountPercent}%): −${money(item.lodgingLongStayDiscountCents)}`,
            192,
            y + (tableAmountCents !== undefined ? 8 : 4),
            { align: "right" },
          );
        }
        pdf.setTextColor(102, 108, 104);
        pdf.setFontSize(8.5);
        const detailLines = pdf.splitTextToSize(invoiceItemDetail(item), 150) as string[];
        pdf.text(detailLines, 18, y + 5);
        pdf.setDrawColor(232, 234, 232);
        const rowHeight = Math.max(
          11 + detailLines.length * 4,
          tableAmountCents !== undefined || item.lodgingLongStayDiscountCents > 0
            ? 16
            : 0,
        );
        pdf.line(18, y + rowHeight, 192, y + rowHeight);
        y += rowHeight + 8;
      }
      y += 4;
      pdf.setDrawColor(30, 55, 46);
      pdf.line(145, y, 192, y);
      pdf.setTextColor(91, 99, 94);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.text("Total", 145, y + 8);
      pdf.setTextColor(30, 55, 46);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(13);
      pdf.text(money(invoice.totalCents), 192, y + 8, { align: "right" });
      if (hasLodging) {
        pdf.setTextColor(112, 118, 115);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(7.5);
        pdf.text("Total pela diária padrão", 145, y + 14);
        pdf.text(money(tableTotalCents), 192, y + 14, { align: "right" });
      }
      const safeName = (data?.account.displayName ?? "cliente")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const filename = `fatura-${safeName}-${invoice.dueDate ?? invoice.issuedAt?.slice(0, 10) ?? today}.pdf`;
      const blob = pdf.output("blob");
      const file = new File([blob], filename, { type: "application/pdf" });
      if (
        navigator.share &&
        (!navigator.canShare || navigator.canShare({ files: [file] }))
      ) {
        await navigator.share({
          title: `Fatura ${invoice.invoiceNumber}`,
          text: `Fatura da Hospet Quintal · ${money(invoice.totalCents)}`,
          files: [file],
        });
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
      }
      setMessage("Fatura preparada para compartilhar ou salvar.");
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível preparar a fatura.",
      );
    } finally {
      setBusy("");
    }
  }

  async function downloadStatement() {
    if (!data || busy) return;
    const from = `${today.slice(0, 8)}01`;
    setBusy("statement");
    try {
      const response = await fetch(
        `/api/statements?from=${encodeURIComponent(from)}&to=${encodeURIComponent(today)}`,
        { credentials: "same-origin", cache: "no-store" },
      );
      const statement = await readResponse<CustomerStatement>(response);
      const generated = await generateStatementPdf(statement);
      if (
        navigator.share &&
        (!navigator.canShare || navigator.canShare({ files: [generated.file] }))
      ) {
        await navigator.share({
          title: "Extrato Hospet Quintal",
          text: `Extrato de ${shortDate(from)} a ${shortDate(today)}`,
          files: [generated.file],
        });
      } else {
        const url = URL.createObjectURL(generated.blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = generated.filename;
        anchor.click();
        URL.revokeObjectURL(url);
      }
      setMessage("Extrato preparado com segurança.");
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "Não foi possível gerar o extrato.");
    } finally {
      setBusy("");
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => undefined);
    window.location.assign("/");
  }

  if (!data) {
    return (
      <main className="startup-screen">
        <section className="startup-card">
          <span className="brand-mark startup-mark">HQ</span>
          <h1>{error ? "Não foi possível abrir" : "Abrindo seu portal"}</h1>
          <p>{error || "Carregando seus cães, serviços e documentos."}</p>
          {error ? (
            <button className="primary-button" onClick={() => void load()}>
              Tentar novamente
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

  const mainTutor =
    data.tutors.find((tutor) => tutor.isFinancialContact) ?? data.tutors[0];
  const pendingRequests = data.requests.filter(
    (request) => request.status === "pending",
  );
  const visibleInvoices = data.invoices
    .filter((invoice) => invoice.status !== "void")
    .sort(
      (left, right) =>
        Number(left.status === "paid") - Number(right.status === "paid") ||
        (right.issuedAt ?? "").localeCompare(left.issuedAt ?? ""),
    );
  return (
    <div className="customer-portal">
      <header className="customer-portal-header">
        <button className="brand compact" onClick={() => setView("home")}>
          <span className="brand-mark">HQ</span>
          <span>
            <strong>Hospet Quintal</strong>
            <small>Área do cliente</small>
          </span>
        </button>
        <nav aria-label="Portal do cliente">
          {(
            [
              ["home", "Início"],
              ["schedule", "Serviços"],
              ["dogs", "Cães"],
              ["finance", "Faturas"],
              ["account", "Conta"],
            ] as Array<[PortalView, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <button className="quiet-button" onClick={() => void logout()}>
          Sair
        </button>
      </header>

      <main className="customer-portal-content">
        {(message || error) && (
          <div
            className={error ? "portal-message error" : "portal-message"}
            role={error ? "alert" : "status"}
            aria-live="polite"
          >
            {error || message}
          </div>
        )}

        {view === "home" && (
          <>
            <section className="portal-hero">
              <div>
                <p className="eyebrow">Olá, {data.identity.displayName}</p>
                <h1>Seus cães, cuidados e documentos em um só lugar.</h1>
                <p>
                  Acompanhe os próximos serviços e envie pedidos para a equipe.
                </p>
              </div>
              <span>
                <strong>{futureAppointments.length}</strong>
                próximos serviços
              </span>
            </section>
            {petAlerts.length > 0 && (
              <section className="portal-alert-strip" aria-label="Avisos de vacinas">
                <strong>Vacinas que precisam de atenção</strong>
                <span>
                  {petAlerts.map((alert) => (
                    <span key={`${alert.dogName}-${alert.vaccineName}`}>
                      {alert.dogName}: {alert.vaccineName} · {alert.expiresOn < today ? "vencida" : `vence em ${shortDate(alert.expiresOn)}`}
                    </span>
                  ))}
                </span>
              </section>
            )}
            <div className="portal-dashboard-grid">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="section-kicker">Próximos</p>
                    <h2>Agenda confirmada</h2>
                  </div>
                </div>
                <PortalAppointmentList
                  appointments={futureAppointments.slice(0, 4)}
                  onCancel={setCancelAppointmentId}
                  busy={busy}
                  pendingCancellationIds={pendingCancellationIds}
                />
              </section>
              <section className="panel portal-request-panel">
                <div>
                  <p className="section-kicker">Novo pedido</p>
                  <h2>Solicitar um serviço</h2>
                  <p>
                    A equipe confere a disponibilidade. Ao aprovar, o serviço
                    entra automaticamente na agenda.
                  </p>
                </div>
                <form onSubmit={submitServiceRequest}>
                  <label className="field">
                    <span>Cão</span>
                    <select name="dogId" required>
                      <option value="">Selecione</option>
                      {data.dogs.map((dog) => (
                        <option key={dog.id} value={dog.id}>
                          {dog.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Serviço</span>
                    <select
                      name="serviceCatalogId"
                      required
                      value={selectedServiceId}
                      onChange={(event) => setSelectedServiceId(event.target.value)}
                    >
                      <option value="">Selecione</option>
                      {data.services.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>
                      {selectedService?.code === "hotel"
                        ? "Data de entrada"
                        : "Data desejada"}
                    </span>
                    <BrazilianDateInput
                      name="requestedDate"
                      value={requestStartDate}
                      min={today}
                      required
                      ariaLabel="Data desejada para o serviço"
                      onChange={setRequestStartDate}
                    />
                  </label>
                  {selectedService?.code === "hotel" && (
                    <label className="field">
                      <span>Data de saída</span>
                      <BrazilianDateInput
                        name="requestedEndDate"
                        value={requestEndDate}
                        min={nextDay(requestStartDate)}
                        required
                        ariaLabel="Data de saída desejada"
                        onChange={setRequestEndDate}
                      />
                    </label>
                  )}
                  {selectedService &&
                    selectedService.code !== "taxi_dog" && (
                      <>
                        <label className="field">
                          <span>
                            {selectedService.code === "hotel"
                              ? "Chegada (opcional)"
                              : "Início (opcional)"}
                          </span>
                          <select name="requestedStartTime">
                            <option value="">Sem preferência</option>
                            <option value="manha">Manhã</option>
                            <option value="tarde">Tarde</option>
                            <option value="noite">Noite</option>
                          </select>
                        </label>
                        {(selectedService.code === "hotel" ||
                          selectedService.code === "daycare") && (
                          <label className="field">
                            <span>
                              {selectedService.code === "hotel"
                                ? "Saída (opcional)"
                                : "Término (opcional)"}
                            </span>
                            <select name="requestedEndTime">
                              <option value="">Sem preferência</option>
                              <option value="manha">Manhã</option>
                              <option value="tarde">Tarde</option>
                              <option value="noite">Noite</option>
                            </select>
                          </label>
                        )}
                      </>
                    )}
                  {selectedService?.code === "bath" && (
                    <label className="portal-choice full">
                      <input type="checkbox" name="groomingAddon" />
                      <span>
                        <strong>Incluir tosa</strong>
                        <small>O banho e a tosa serão cobrados juntos.</small>
                      </span>
                    </label>
                  )}
                  {selectedService?.code === "taxi_dog" && (
                    <div className="portal-request-options full">
                      <label className="field">
                        <span>Trajeto</span>
                        <select name="transportDirection" defaultValue="one_way">
                          <option value="one_way">Ida</option>
                          <option value="round_trip">Ida e volta</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Distância</span>
                        <select name="transportDistance" defaultValue="short">
                          <option value="short">Curta</option>
                          <option value="long">Longa</option>
                        </select>
                      </label>
                    </div>
                  )}
                  <label className="field full">
                    <span>Observações</span>
                    <textarea
                      name="notes"
                      rows={3}
                      maxLength={2000}
                      placeholder="Algo importante para a equipe saber?"
                    />
                  </label>
                  <button
                    className="primary-button portal-request-submit"
                    type="submit"
                    disabled={busy === "request"}
                  >
                    {busy === "request" ? "Enviando…" : "Enviar solicitação"}
                  </button>
                </form>
              </section>
            </div>
            {pendingRequests.length > 0 && (
              <section className="panel portal-pending-requests">
                <div className="panel-heading">
                  <div>
                    <p className="section-kicker">Acompanhamento</p>
                    <h2>Pedidos aguardando resposta</h2>
                  </div>
                  <span className="soft-count">{pendingRequests.length}</span>
                </div>
                {pendingRequests.map((request) => {
                  const service = data.services.find(
                    (item) => item.id === request.serviceCatalogId,
                  );
                  const dog = data.dogs.find((item) => item.id === request.dogId);
                  return (
                    <div key={request.id}>
                      <strong>
                        {request.type === "service"
                          ? `${dog?.name ?? "Cão"} · ${service?.name ?? "Serviço"}`
                          : request.type === "cancellation"
                            ? "Cancelamento solicitado"
                            : "Atualização cadastral"}
                      </strong>
                      <span>
                        {shortDate(request.requestedDate ?? request.createdAt)}
                        {request.requestedEndDate
                          ? ` a ${shortDate(request.requestedEndDate)}`
                          : ""}
                      </span>
                      {request.notes && <small>{request.notes}</small>}
                    </div>
                  );
                })}
              </section>
            )}
          </>
        )}

        {view === "schedule" && (
          <section className="panel full-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Serviços</p>
                <h1>Agenda e histórico</h1>
              </div>
            </div>
            <h2>Próximos</h2>
            <PortalAppointmentList
              appointments={futureAppointments}
              onCancel={setCancelAppointmentId}
              busy={busy}
              pendingCancellationIds={pendingCancellationIds}
            />
            <h2 className="portal-subheading">Concluídos</h2>
            <PortalAppointmentList
              appointments={pastAppointments}
              onCancel={setCancelAppointmentId}
              busy={busy}
              pendingCancellationIds={pendingCancellationIds}
              historical
            />
            {data.requests.length > 0 && (
              <details className="portal-request-history">
                <summary>Pedidos enviados ({data.requests.length})</summary>
                <div>
                  {data.requests.slice(0, 30).map((request) => {
                    const service = data.services.find(
                      (item) => item.id === request.serviceCatalogId,
                    );
                    const dog = data.dogs.find((item) => item.id === request.dogId);
                    return (
                      <article key={request.id}>
                        <span>
                          <strong>
                            {request.type === "cancellation"
                              ? "Cancelamento"
                              : service?.name || "Solicitação"}
                          </strong>
                          <small>
                            {dog?.name ? `${dog.name} · ` : ""}
                            {shortDate(request.requestedDate ?? request.createdAt)}
                            {request.requestedEndDate
                              ? ` a ${shortDate(request.requestedEndDate)}`
                              : ""}
                          </small>
                          {portalRequestDetails(request.detailsJson) && (
                            <small>{portalRequestDetails(request.detailsJson)}</small>
                          )}
                          {request.responseNote && <em>{request.responseNote}</em>}
                        </span>
                        <span className={`status-pill ${request.status}`}>
                          {statusLabel(request.status)}
                        </span>
                      </article>
                    );
                  })}
                </div>
              </details>
            )}
          </section>
        )}

        {view === "dogs" && (
          <div className="portal-dog-grid">
            {data.dogs.map((dog) => (
              <article className="panel portal-dog-card" key={dog.id}>
                <div className="portal-dog-title">
                  {dog.photoUrl ? (
                    // Photos are private application URLs and should not leave
                    // the authenticated origin for optimization.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={dog.photoUrl} alt={`Foto de ${dog.name}`} />
                  ) : (
                    <span>{dog.name.slice(0, 2).toUpperCase()}</span>
                  )}
                  <div>
                    <p className="section-kicker">Meu cão</p>
                    <h2>{dog.name}</h2>
                    <small>{dog.breed || "Raça não informada"}</small>
                  </div>
                </div>
                <div className="portal-dog-facts">
                  <span>
                    <small>Nascimento</small>
                    <strong>{shortDate(dog.birthDate)}</strong>
                  </span>
                  <span>
                    <small>Sexo</small>
                    <strong>
                      {dog.sex === "female"
                        ? "Fêmea"
                        : dog.sex === "male"
                          ? "Macho"
                          : "Não informado"}
                    </strong>
                  </span>
                  <span>
                    <small>Castração</small>
                    <strong>
                      {dog.neutered === null
                        ? "Não informado"
                        : dog.neutered
                          ? "Castrado"
                          : "Não castrado"}
                    </strong>
                  </span>
                  {dog.weightGrams !== null && (
                    <span>
                      <small>Peso</small>
                      <strong>
                        {new Intl.NumberFormat("pt-BR", {
                          maximumFractionDigits: 1,
                        }).format(dog.weightGrams / 1000)} kg
                      </strong>
                    </span>
                  )}
                </div>
                <dl className="portal-dog-details">
                  <div>
                    <dt>Alimentação</dt>
                    <dd>{dog.feedingNotes || "Sem orientação registrada"}</dd>
                  </div>
                  <div>
                    <dt>Temperamento</dt>
                    <dd>
                      {dog.temperamentNotes || "Sem observação registrada"}
                    </dd>
                  </div>
                  <div>
                    <dt>Medicação</dt>
                    <dd>{dog.medicationNotes || "Nenhuma registrada"}</dd>
                  </div>
                </dl>
                <div className="portal-vaccines">
                  <strong>Vacinas</strong>
                  {dog.vaccines.length ? (
                    dog.vaccines.map((vaccine) => (
                      <span key={`${vaccine.name}-${vaccine.expiresOn}`}>
                        {vaccine.name}
                        <small>vence em {shortDate(vaccine.expiresOn)}</small>
                      </span>
                    ))
                  ) : (
                    <small>Nenhuma vacina registrada.</small>
                  )}
                </div>
                <p className="portal-safety-note">
                  Para alterar alimentação, medicação ou cuidados, fale com a
                  equipe pelo WhatsApp habitual.
                </p>
              </article>
            ))}
          </div>
        )}

        {view === "finance" && (
          <div className="portal-finance-grid">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">Créditos</p>
                  <h2>Saldos disponíveis</h2>
                </div>
              </div>
              <div className="portal-credit-list">
                {data.credits.length ? (
                  data.credits.map((credit) => (
                    <div key={credit.serviceCatalogId}>
                      <span>{credit.serviceName}</span>
                      <strong>{credit.availableUnits}</strong>
                    </div>
                  ))
                ) : (
                  <p>Nenhum crédito disponível.</p>
                )}
              </div>
            </section>
            <section className="panel portal-invoice-list">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">Documentos</p>
                  <h2>Faturas</h2>
                </div>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy === "statement"}
                  onClick={() => void downloadStatement()}
                >
                  {busy === "statement" ? "Preparando…" : "Extrato do mês"}
                </button>
              </div>
              {visibleInvoices.length ? (
                visibleInvoices.map((invoice) => (
                  <article key={invoice.id}>
                    <div className="portal-invoice-heading">
                      <strong>{invoice.invoiceNumber}</strong>
                      <small>
                        {invoice.status === "paid"
                          ? `Emitida em ${shortDate(invoice.issuedAt)}`
                          : `Vence em ${shortDate(invoice.dueDate)}`}
                      </small>
                    </div>
                    <div className="portal-invoice-total">
                      <strong>{money(invoice.totalCents)}</strong>
                      <span className={`status-pill ${invoice.status}`}>
                        {statusLabel(invoice.status)}
                      </span>
                    </div>
                    <div className="portal-invoice-items">
                      {invoice.items.map((item) => (
                        <span key={item.id}>
                          {item.dogName} · {item.serviceName}
                          <small>{shortDate(item.serviceDate)}</small>
                        </span>
                      ))}
                    </div>
                    <button
                      className="secondary-button"
                      onClick={() => void downloadInvoice(invoice)}
                      disabled={busy === `invoice:${invoice.id}`}
                    >
                      {busy === `invoice:${invoice.id}`
                        ? "Preparando…"
                        : "Compartilhar PDF"}
                    </button>
                  </article>
                ))
              ) : (
                <p className="portal-empty">Nenhuma fatura emitida.</p>
              )}
            </section>
            <section className="panel portal-receipt-list">
              <div className="panel-heading">
                <div>
                  <p className="section-kicker">Créditos utilizados</p>
                  <h2>Recibos</h2>
                </div>
              </div>
              {data.receipts.length ? (
                data.receipts.map((receipt) => (
                  <div key={receipt.id}>
                    <span>
                      <strong>{receipt.receiptNumber}</strong>
                      <small>
                        {receipt.dogName} · {receipt.serviceName}
                      </small>
                    </span>
                    <span>{shortDate(receipt.serviceDate)}</span>
                  </div>
                ))
              ) : (
                <p>Nenhum recibo de crédito ainda.</p>
              )}
            </section>
          </div>
        )}

        {view === "account" && (
          <div className="portal-account-grid">
            <section className="panel">
              <p className="section-kicker">Minha conta</p>
              <h1>{data.account.displayName}</h1>
              <p>
                O e-mail de acesso é <strong>{data.identity.email}</strong>.
                Para trocá-lo, fale com a administração.
              </p>
              <div className="portal-account-facts">
                <span>
                  <small>CPF</small>
                  <strong>{maskedCpf(data.account.cpf)}</strong>
                </span>
                <span>
                  <small>Data de nascimento</small>
                  <strong>
                    {data.account.birthDate
                      ? shortDate(data.account.birthDate)
                      : "Não informada"}
                  </strong>
                </span>
              </div>
              <form className="portal-profile-form" onSubmit={saveProfile}>
                <label className="field">
                  <span>WhatsApp ou telefone</span>
                  <input
                    name="phone"
                    defaultValue={mainTutor?.phoneE164 ?? ""}
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={40}
                  />
                </label>
                <label className="field full">
                  <span>Endereço</span>
                  <input
                    name="addressLine"
                    defaultValue={data.account.addressLine ?? ""}
                    autoComplete="street-address"
                    maxLength={300}
                  />
                </label>
                <label className="field">
                  <span>Cidade</span>
                  <input
                    name="addressCity"
                    defaultValue={data.account.addressCity ?? ""}
                    autoComplete="address-level2"
                    maxLength={120}
                  />
                </label>
                <label className="field">
                  <span>Estado</span>
                  <input
                    name="addressRegion"
                    defaultValue={data.account.addressRegion ?? ""}
                    autoComplete="address-level1"
                    maxLength={40}
                  />
                </label>
                <label className="field">
                  <span>CEP</span>
                  <input
                    name="addressPostalCode"
                    defaultValue={data.account.addressPostalCode ?? ""}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    maxLength={20}
                  />
                </label>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={busy === "profile"}
                >
                  {busy === "profile" ? "Salvando…" : "Salvar meus dados"}
                </button>
              </form>
            </section>
            <section className="panel portal-account-help">
              <p className="section-kicker">Ajuda</p>
              <h2>Precisa falar conosco?</h2>
              <p>
                Use o WhatsApp habitual da Hospet Quintal para alterações
                urgentes, medicação ou dúvidas sobre um atendimento.
              </p>
              <a className="text-button" href="/recuperar">
                Redefinir minha senha
              </a>
            </section>
          </div>
        )}
      </main>
      {cancelAppointmentId && (
        <div
          className="portal-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setCancelAppointmentId(null);
          }}
        >
          <section
            className="portal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-request-title"
          >
            <p className="section-kicker">Pedido à equipe</p>
            <h2 id="cancel-request-title">Solicitar cancelamento</h2>
            <p>
              O serviço permanece na agenda até a equipe aprovar o pedido.
            </p>
            <form
              onSubmit={(event) =>
                void requestCancellation(event, cancelAppointmentId)
              }
            >
              <label className="field">
                <span>Motivo</span>
                <textarea
                  name="reason"
                  rows={4}
                  maxLength={2000}
                  required
                  autoFocus
                />
              </label>
              <div className="portal-dialog-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setCancelAppointmentId(null)}
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={busy === `cancel:${cancelAppointmentId}`}
                >
                  {busy === `cancel:${cancelAppointmentId}`
                    ? "Enviando…"
                    : "Enviar pedido"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function PortalAppointmentList({
  appointments,
  onCancel,
  busy,
  pendingCancellationIds,
  historical = false,
}: {
  appointments: PortalData["appointments"];
  onCancel: (id: string) => void;
  busy: string;
  pendingCancellationIds: Set<string>;
  historical?: boolean;
}) {
  if (!appointments.length) {
    return <p className="portal-empty">Nenhum serviço nesta lista.</p>;
  }
  return (
    <div className="portal-appointment-list">
      {appointments.map((appointment) => (
        <article
          key={appointment.id}
          className={
            appointment.serviceCode
              ? `portal-service-${appointment.serviceCode}`
              : undefined
          }
        >
          <time dateTime={appointment.startDate}>
            <strong>{shortDate(appointment.startDate)}</strong>
          </time>
          <div>
            <strong>
              {appointment.dogName} · {appointment.serviceName}
            </strong>
            <small>
              {shortDate(appointment.startDate)}
              {appointment.endDate !== appointment.startDate
                ? ` a ${shortDate(appointment.endDate)}`
                : ""}
              {appointment.startTime
                ? ` · ${portalTimeLabel(appointment.startTime)}`
                : ""}
            </small>
          </div>
          <span className={`status-pill ${appointment.status}`}>
            {statusLabel(appointment.status)}
          </span>
          {!historical &&
            !["completed", "cancelled"].includes(appointment.status) && (
              pendingCancellationIds.has(appointment.id) ? (
                <span className="status-pill pending">Cancelamento solicitado</span>
              ) : (
                <button
                  className="text-button muted"
                  onClick={() => onCancel(appointment.id)}
                  disabled={busy === `cancel:${appointment.id}`}
                >
                  Solicitar cancelamento
                </button>
              )
            )}
        </article>
      ))}
    </div>
  );
}
