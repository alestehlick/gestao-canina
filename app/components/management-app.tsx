"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  auditFixtures,
  demoBillableServices,
  demoBookings,
  demoCustomers,
  demoDogs,
  demoInvoices,
  demoTasks,
  serviceLabels,
  statusLabels,
  type BillableService,
  type Booking,
  type BookingStatus,
  type Customer,
  type Dog,
  type Invoice,
  type ServiceType,
  type Task,
} from "@/lib/demo-data";

type View =
  | "today"
  | "agenda"
  | "dogs"
  | "customers"
  | "billing"
  | "activity"
  | "portal";

type DialogKind =
  | "service"
  | "task"
  | "registration"
  | "cancel"
  | "pix"
  | null;

type ToastState = {
  message: string;
  actionLabel?: string;
  action?: () => void;
};

type PixState = {
  step: "review" | "code" | "paid";
  invoice?: Invoice;
  selectedServices: BillableService[];
  customerName: string;
  amountCents: number;
};

const navItems: { id: View; label: string; shortLabel: string }[] = [
  { id: "today", label: "Hoje", shortLabel: "Hoje" },
  { id: "agenda", label: "Agenda", shortLabel: "Agenda" },
  { id: "dogs", label: "Cães", shortLabel: "Cães" },
  { id: "customers", label: "Clientes", shortLabel: "Clientes" },
  { id: "billing", label: "Cobranças", shortLabel: "Mais" },
  { id: "activity", label: "Atividades", shortLabel: "Ativ." },
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
    title: "Cobranças Pix",
    description: "Revise serviços concluídos e acompanhe pagamentos.",
  },
  activity: {
    eyebrow: "Rastreabilidade",
    title: "Atividades",
    description: "Histórico de ações importantes da equipe e do financeiro.",
  },
};

const servicePrices: Record<ServiceType, number> = {
  daycare: 7000,
  bath: 9500,
  grooming: 5500,
  transport: 3500,
  hotel: 18000,
  other: 5000,
};

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
  };
  return actions[status] ?? null;
}

export function ManagementApp() {
  const [view, setView] = useState<View>("today");
  const [bookings, setBookings] = useState<Booking[]>(demoBookings);
  const [tasks, setTasks] = useState<Task[]>(demoTasks);
  const [dogs, setDogs] = useState<Dog[]>(demoDogs);
  const [customers, setCustomers] = useState<Customer[]>(demoCustomers);
  const [invoices, setInvoices] = useState<Invoice[]>(demoInvoices);
  const [billableServices, setBillableServices] = useState<BillableService[]>(
    demoBillableServices,
  );
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
  const [toast, setToast] = useState<ToastState | null>(null);
  const [pixState, setPixState] = useState<PixState | null>(null);
  const [portalTab, setPortalTab] = useState("Início");

  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    function onEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (dialog) {
        setDialog(null);
        setBookingToCancel(null);
      } else if (search) {
        setSearch("");
      }
    }
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [dialog, search]);

  useEffect(() => {
    titleRef.current?.focus();
  }, [view, selectedDogId, selectedCustomerId]);

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

  function navigate(nextView: View) {
    setSelectedDogId(null);
    setSelectedCustomerId(null);
    setView(nextView);
    setOpenMenuId(null);
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

  function updateBookingStatus(booking: Booking, status: BookingStatus) {
    const previous = booking.status;
    setBookings((current) =>
      current.map((item) => (item.id === booking.id ? { ...item, status } : item)),
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
                  item.id === booking.id ? { ...item, status: previous } : item,
                ),
              );
              setToast({ message: "Conclusão desfeita." });
            }
          : undefined,
    });
  }

  function advanceBooking(booking: Booking) {
    updateBookingStatus(booking, nextStatus(booking.status));
  }

  function reopenBooking(booking: Booking) {
    updateBookingStatus(booking, "present");
  }

  function askToCancel(booking: Booking) {
    setBookingToCancel(booking);
    setDialog("cancel");
    setOpenMenuId(null);
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

  function submitService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const dogId = String(form.get("dogId") ?? "");
    const dog = dogs.find((item) => item.id === dogId);
    const serviceType = String(form.get("serviceType") ?? "") as ServiceType;
    const time = String(form.get("time") ?? "");
    const endTime = String(form.get("endTime") ?? "");
    const price = Number(form.get("price") ?? 0);

    if (!dog || !serviceType || !time) {
      setToast({ message: "Revise os campos obrigatórios." });
      return;
    }
    if (endTime && endTime <= time) {
      setToast({ message: "O horário final deve ser posterior ao inicial." });
      return;
    }

    const newBooking: Booking = {
      id: `booking-${crypto.randomUUID()}`,
      time,
      endTime: endTime || undefined,
      dogId: dog.id,
      dogName: dog.name,
      customerId: dog.customerId,
      customerName: dog.customerName,
      service: serviceLabels[serviceType],
      serviceType,
      status: "scheduled",
      priceCents: Math.max(0, Math.round(price * 100)),
      note: String(form.get("note") ?? "").trim() || undefined,
    };
    setBookings((current) =>
      [...current, newBooking].sort((a, b) => a.time.localeCompare(b.time)),
    );
    setDialog(null);
    setView("agenda");
    setToast({ message: `Serviço agendado para ${dog.name}.` });
  }

  function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    if (!title) {
      setToast({ message: "Informe o título da tarefa." });
      return;
    }
    const task: Task = {
      id: `task-${crypto.randomUUID()}`,
      title,
      due: String(form.get("time") ?? "").trim() || "Sem horário",
      priority:
        String(form.get("priority") ?? "normal") === "high" ? "high" : "normal",
      completed: false,
    };
    setTasks((current) => [task, ...current]);
    setDialog(null);
    setToast({ message: "Tarefa adicionada." });
  }

  function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!name) {
      setToast({ message: "Informe o nome do cliente." });
      return;
    }
    const customer: Customer = {
      id: `customer-${crypto.randomUUID()}`,
      name,
      initials: initials(name),
      phone: String(form.get("phone") ?? "").trim() || "Não informado",
      email: String(form.get("email") ?? "").trim() || "Não informado",
      dogIds: [],
      balanceCents: 0,
      creditsLabel: "Sem créditos",
      status: "current",
    };
    setCustomers((current) => [customer, ...current]);
    setDialog(null);
    setRegistrationType("choice");
    setSelectedCustomerId(customer.id);
    setView("customers");
    setToast({ message: "Cliente cadastrado." });
  }

  function submitDog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const customerId = String(form.get("customerId") ?? "");
    const customer = customers.find((item) => item.id === customerId);
    if (!name || !customer) {
      setToast({ message: "Informe o nome do cão e selecione um cliente." });
      return;
    }
    const dog: Dog = {
      id: `dog-${crypto.randomUUID()}`,
      name,
      initials: initials(name),
      breed: String(form.get("breed") ?? "").trim() || "Raça não informada",
      age: "Idade não informada",
      customerId,
      customerName: customer.name,
      color: "forest",
      vaccinesCurrent: false,
      today: "Sem serviço hoje",
      nextService: "Nenhum atendimento agendado",
      alert: String(form.get("alert") ?? "").trim() || undefined,
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

  function toggleTask(taskId: string) {
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

  function openPixForSelection() {
    const selectedServices = billableServices.filter((item) =>
      selectedBillables.includes(item.id),
    );
    if (!selectedServices.length) return;
    setPixState({
      step: "review",
      selectedServices,
      customerName: selectedServices[0].customerName,
      amountCents: selectedServices.reduce(
        (total, item) => total + item.amountCents,
        0,
      ),
    });
    setDialog("pix");
  }

  function openExistingPix(invoice: Invoice) {
    setPixState({
      step: "code",
      invoice,
      selectedServices: [],
      customerName: invoice.customerName,
      amountCents: invoice.amountCents,
    });
    setDialog("pix");
  }

  function issuePix() {
    if (!pixState) return;
    const invoice: Invoice =
      pixState.invoice ??
      {
        id: `invoice-${crypto.randomUUID()}`,
        number: String(185 + invoices.length).padStart(6, "0"),
        customerId: pixState.selectedServices[0]?.customerId ?? "",
        customerName: pixState.customerName,
        amountCents: pixState.amountCents,
        due: "Vence hoje",
        status: "pending",
        items: `${pixState.selectedServices.length} serviços selecionados`,
      };
    if (!pixState.invoice) setInvoices((current) => [invoice, ...current]);
    setPixState({ ...pixState, invoice, step: "code" });
    setToast({ message: "Cobrança demonstrativa criada." });
  }

  function simulatePixPayment() {
    if (!pixState?.invoice) return;
    const invoiceId = pixState.invoice.id;
    setInvoices((current) =>
      current.map((invoice) =>
        invoice.id === invoiceId
          ? { ...invoice, status: "paid", due: "Pago agora" }
          : invoice,
      ),
    );
    const selectedIds = new Set(pixState.selectedServices.map((item) => item.id));
    setBillableServices((current) =>
      current.filter((item) => !selectedIds.has(item.id)),
    );
    setSelectedBillables([]);
    setPixState({ ...pixState, step: "paid" });
    setToast({ message: "Pagamento confirmado no ambiente de demonstração." });
  }

  const selectedDog = dogs.find((dog) => dog.id === selectedDogId) ?? null;
  const selectedCustomer =
    customers.find((customer) => customer.id === selectedCustomerId) ?? null;

  if (view === "portal") {
    return (
      <CustomerPortal
        dogs={dogs.filter((dog) => dog.customerId === "customer-marina")}
        invoice={invoices.find((invoice) => invoice.id === "invoice-184")}
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
            <strong>Gestão Canina</strong>
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
                <span className="nav-count" aria-label="2 cobranças pendentes">
                  2
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
          <span className="avatar avatar-forest">AS</span>
          <span>
            <strong>Alex</strong>
            <small>Administrador</small>
          </span>
        </div>
      </aside>

      <div className="mobile-header">
        <button className="brand compact" onClick={() => navigate("today")}>
          <span className="brand-mark">GC</span>
          <strong>Gestão Canina</strong>
        </button>
        <button
          className="icon-text-button"
          onClick={() => setDialog("task")}
          aria-label="Nova tarefa"
        >
          Tarefa
        </button>
      </div>

      <div className="workspace">
        <div className="demo-banner" role="status">
          <span className="demo-label">Demonstração segura</span>
          <span>
            Todos os nomes, contatos e valores são fictícios. Nada aqui é uma
            cobrança real.
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
              onClick={() => setDialog("service")}
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
              tasks={tasks}
              agendaFilter={agendaFilter}
              setAgendaFilter={setAgendaFilter}
              onAdvance={advanceBooking}
              onMenu={setOpenMenuId}
              openMenuId={openMenuId}
              onCancel={askToCancel}
              onReopen={reopenBooking}
              onToggleTask={toggleTask}
              onViewAgenda={() => navigate("agenda")}
              onViewBilling={() => navigate("billing")}
              onOpenPix={openExistingPix}
              invoice={invoices.find((item) => item.id === "invoice-184")}
            />
          )}
          {view === "agenda" && (
            <AgendaView
              bookings={bookings}
              agendaFilter={agendaFilter}
              setAgendaFilter={setAgendaFilter}
              onAdvance={advanceBooking}
              onMenu={setOpenMenuId}
              openMenuId={openMenuId}
              onCancel={askToCancel}
              onReopen={reopenBooking}
              onNewService={() => setDialog("service")}
            />
          )}
          {view === "dogs" &&
            (selectedDog ? (
              <DogProfile
                dog={selectedDog}
                bookings={bookings.filter(
                  (booking) => booking.dogId === selectedDog.id,
                )}
                onBack={() => setSelectedDogId(null)}
                onNewService={() => setDialog("service")}
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
                invoices={invoices.filter(
                  (invoice) => invoice.customerId === selectedCustomer.id,
                )}
                onBack={() => setSelectedCustomerId(null)}
                onOpenDog={(dogId) => {
                  setSelectedCustomerId(null);
                  setSelectedDogId(dogId);
                  setView("dogs");
                }}
                onOpenPix={openExistingPix}
                onNewService={() => setDialog("service")}
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
              onToggleBillable={toggleBillable}
              onCreatePix={openPixForSelection}
              onOpenPix={openExistingPix}
            />
          )}
          {view === "activity" && <ActivityView />}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Navegação móvel">
        {navItems.slice(0, 4).map((item) => (
          <button
            key={item.id}
            className={view === item.id ? "active" : ""}
            onClick={() => navigate(item.id)}
          >
            <span className="mobile-nav-mark" aria-hidden="true" />
            {item.shortLabel}
          </button>
        ))}
        <button
          className={view === "billing" || view === "activity" ? "active" : ""}
          onClick={() => navigate("billing")}
        >
          <span className="mobile-nav-mark" aria-hidden="true" />
          Mais
        </button>
      </nav>

      <button className="mobile-fab" onClick={() => setDialog("service")}>
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
              <select name="dogId" defaultValue="" autoFocus required>
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
              <span>Data *</span>
              <input name="date" type="date" defaultValue="2026-07-30" required />
            </label>
            <label className="field">
              <span>Serviço *</span>
              <select
                name="serviceType"
                defaultValue="daycare"
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
              <input name="time" type="time" defaultValue="09:00" required />
            </label>
            <label className="field">
              <span>Horário final</span>
              <input name="endTime" type="time" defaultValue="17:00" />
            </label>
            <label className="field">
              <span>Valor aplicado (R$) *</span>
              <input
                name="price"
                type="number"
                min="0"
                step="0.01"
                defaultValue="70.00"
                required
              />
            </label>
            <label className="field">
              <span>Recorrência</span>
              <select name="recurrence" defaultValue="none">
                <option value="none">Não repetir</option>
                <option value="weekly">Toda semana</option>
                <option value="weekdays">Dias úteis</option>
              </select>
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
              <input name="date" type="date" defaultValue="2026-07-30" />
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

function TodayView({
  bookings,
  dogs,
  tasks,
  agendaFilter,
  setAgendaFilter,
  onAdvance,
  onMenu,
  openMenuId,
  onCancel,
  onReopen,
  onToggleTask,
  onViewAgenda,
  onViewBilling,
  onOpenPix,
  invoice,
}: {
  bookings: Booking[];
  dogs: Dog[];
  tasks: Task[];
  agendaFilter: "all" | "upcoming" | "active" | "completed";
  setAgendaFilter: (
    value: "all" | "upcoming" | "active" | "completed",
  ) => void;
  onAdvance: (booking: Booking) => void;
  onMenu: (id: string | null) => void;
  openMenuId: string | null;
  onCancel: (booking: Booking) => void;
  onReopen: (booking: Booking) => void;
  onToggleTask: (id: string) => void;
  onViewAgenda: () => void;
  onViewBilling: () => void;
  onOpenPix: (invoice: Invoice) => void;
  invoice?: Invoice;
}) {
  const activeBookings = bookings.filter(
    (booking) =>
      booking.status !== "completed" && booking.status !== "cancelled",
  );
  const presentDogs = bookings.filter((booking) =>
    ["present", "in_service"].includes(booking.status),
  );
  const filteredBookings = filterBookings(bookings, agendaFilter);

  return (
    <>
      <section className="day-heading">
        <div>
          <p>{formatToday()}</p>
          <span>São Paulo · horário local</span>
        </div>
        <button className="quiet-button" onClick={onViewAgenda}>
          Ver agenda completa
        </button>
      </section>

      <section className="summary-strip" aria-label="Resumo de hoje">
        <SummaryItem value={activeBookings.length + 5} label="esperados" />
        <SummaryItem value={presentDogs.length + 6} label="presentes" />
        <SummaryItem
          value={
            bookings.filter(
              (booking) =>
                booking.serviceType === "transport" &&
                booking.status !== "completed",
            ).length
          }
          label="transportes"
        />
        <SummaryItem value={5} label="vagas" />
        <SummaryItem value={2} label="alertas" attention />
      </section>

      <div className="dashboard-grid">
        <section className="panel agenda-panel">
          <div className="panel-heading agenda-heading">
            <div>
              <p className="section-kicker">Quinta, 30 de julho</p>
              <h2>Agenda de hoje</h2>
            </div>
            <AgendaFilters value={agendaFilter} onChange={setAgendaFilter} />
          </div>
          <div className="agenda-list">
            {filteredBookings
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
                  onCancel={onCancel}
                  onReopen={onReopen}
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
                <p className="section-kicker">Presença</p>
                <h2>No local agora</h2>
              </div>
              <span className="soft-count">{presentDogs.length + 1}</span>
            </div>
            <div className="presence-list">
              {presentDogs.map((booking) => {
                const dog = dogs.find((item) => item.id === booking.dogId);
                return (
                  <div className="presence-row" key={booking.id}>
                    <DogAvatar dog={dog} size="small" />
                    <span>
                      <strong>{booking.dogName}</strong>
                      <small>{booking.service}</small>
                    </span>
                    <span className="presence-dot">Presente</span>
                  </div>
                );
              })}
              <div className="presence-row">
                <DogAvatar dog={dogs.find((dog) => dog.id === "dog-lola")} size="small" />
                <span>
                  <strong>Lola</strong>
                  <small>Aguardando tosa</small>
                </span>
                <span className="presence-dot">Recepção</span>
              </div>
            </div>
          </section>

          <section className="panel compact-panel attention-panel">
            <div className="panel-heading">
              <div>
                <p className="section-kicker">Cuidados</p>
                <h2>Requer atenção</h2>
              </div>
              <span className="attention-count">2</span>
            </div>
            <div className="attention-item">
              <span className="attention-mark" aria-hidden="true">
                !
              </span>
              <span>
                <strong>Mel · alimentação</strong>
                <small>Não oferecer frango. Alergia registrada.</small>
              </span>
            </div>
            <div className="attention-item">
              <span className="attention-mark" aria-hidden="true">
                !
              </span>
              <span>
                <strong>Theo · banho</strong>
                <small>Usar somente shampoo hipoalergênico.</small>
              </span>
            </div>
          </section>

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
                  <h2>Pix aguardando</h2>
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

function AgendaView({
  bookings,
  agendaFilter,
  setAgendaFilter,
  onAdvance,
  onMenu,
  openMenuId,
  onCancel,
  onReopen,
  onNewService,
}: {
  bookings: Booking[];
  agendaFilter: "all" | "upcoming" | "active" | "completed";
  setAgendaFilter: (
    value: "all" | "upcoming" | "active" | "completed",
  ) => void;
  onAdvance: (booking: Booking) => void;
  onMenu: (id: string | null) => void;
  openMenuId: string | null;
  onCancel: (booking: Booking) => void;
  onReopen: (booking: Booking) => void;
  onNewService: () => void;
}) {
  const filtered = filterBookings(bookings, agendaFilter);
  return (
    <section className="panel full-panel">
      <div className="panel-heading agenda-heading">
        <div>
          <p className="section-kicker">Quinta-feira</p>
          <h2>30 de julho</h2>
        </div>
        <div className="heading-actions">
          <AgendaFilters value={agendaFilter} onChange={setAgendaFilter} />
          <button className="primary-button compact-button" onClick={onNewService}>
            + Novo serviço
          </button>
        </div>
      </div>
      <div className="agenda-day-divider">
        <span>Manhã</span>
        <span>
          {bookings.filter((booking) => booking.time < "12:00").length} itens
        </span>
      </div>
      <div className="agenda-list spacious">
        {filtered
          .filter((booking) => booking.status !== "cancelled")
          .map((booking) => (
            <AgendaCard
              key={booking.id}
              booking={booking}
              dog={demoDogs.find((dog) => dog.id === booking.dogId)}
              onAdvance={onAdvance}
              openMenu={openMenuId === booking.id}
              onMenu={() =>
                onMenu(openMenuId === booking.id ? null : booking.id)
              }
              onCancel={onCancel}
              onReopen={onReopen}
            />
          ))}
      </div>
      {bookings.some((booking) => booking.status === "cancelled") && (
        <details className="cancelled-section">
          <summary>
            Cancelados (
            {bookings.filter((booking) => booking.status === "cancelled").length})
          </summary>
          {bookings
            .filter((booking) => booking.status === "cancelled")
            .map((booking) => (
              <AgendaCard
                key={booking.id}
                booking={booking}
                dog={demoDogs.find((dog) => dog.id === booking.dogId)}
                onAdvance={onAdvance}
                openMenu={false}
                onMenu={() => undefined}
                onCancel={onCancel}
                onReopen={onReopen}
              />
            ))}
        </details>
      )}
    </section>
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
  onCancel,
  onReopen,
}: {
  booking: Booking;
  dog?: Dog;
  onAdvance: (booking: Booking) => void;
  openMenu: boolean;
  onMenu: () => void;
  onCancel: (booking: Booking) => void;
  onReopen: (booking: Booking) => void;
}) {
  const action = primaryAction(booking.status);
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
        {booking.note && <span className="care-note">{booking.note}</span>}
      </div>
      <div className="agenda-actions">
        {action && (
          <button className="action-button" onClick={() => onAdvance(booking)}>
            {action}
          </button>
        )}
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
                  onMenu();
                }}
              >
                Editar
              </button>
              {booking.status === "completed" ? (
                <button onClick={() => onReopen(booking)}>Reabrir</button>
              ) : booking.status !== "cancelled" ? (
                <button className="danger-text" onClick={() => onCancel(booking)}>
                  Cancelar atendimento
                </button>
              ) : null}
            </div>
          )}
        </div>
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
  bookings,
  onBack,
  onNewService,
}: {
  dog: Dog;
  bookings: Booking[];
  onBack: () => void;
  onNewService: () => void;
}) {
  const [tab, setTab] = useState("Resumo");
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
          <button className="secondary-button">Editar</button>
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
            {dog.credits.length ? (
              <div className="credit-list">
                {dog.credits.map((credit) => (
                  <div key={credit.label}>
                    <span>{credit.label}</span>
                    <strong>{credit.value}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="Sem créditos"
                description="Este cão não possui utilizações pré-pagas."
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
                  <small>30/07/2026 · {booking.time}</small>
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
    return <span className="status-pill pending">Aguardando Pix</span>;
  }
  return <span className="status-pill success">Em dia</span>;
}

function CustomerProfile({
  customer,
  dogs,
  invoices,
  onBack,
  onOpenDog,
  onOpenPix,
  onNewService,
}: {
  customer: Customer;
  dogs: Dog[];
  invoices: Invoice[];
  onBack: () => void;
  onOpenDog: (id: string) => void;
  onOpenPix: (invoice: Invoice) => void;
  onNewService: () => void;
}) {
  const [tab, setTab] = useState("Resumo");
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
          <button className="secondary-button">Editar</button>
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
              demoBookings
                .filter((booking) => booking.dogId === dog.id)
                .map((booking) => (
                  <div className="timeline-item" key={booking.id}>
                    <DogAvatar dog={dog} size="small" />
                    <div>
                      <small>30/07/2026 · {booking.time}</small>
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
                          Ver Pix
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
            <p className="section-kicker">Créditos</p>
            <h3>Saldo por serviço</h3>
            <div className="credit-list">
              <div>
                <span>Creche</span>
                <strong>{customer.id === "customer-marina" ? 4 : 0}</strong>
              </div>
              <div>
                <span>Transporte</span>
                <strong>{customer.id === "customer-marina" ? 6 : 0}</strong>
              </div>
              <div>
                <span>Banho</span>
                <strong>{customer.id === "customer-marina" ? 1 : 0}</strong>
              </div>
            </div>
            <p className="ledger-note">
              O saldo é calculado pelo extrato e não pode ser alterado sem uma
              movimentação registrada.
            </p>
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
  onToggleBillable,
  onCreatePix,
  onOpenPix,
}: {
  invoices: Invoice[];
  billableServices: BillableService[];
  selectedBillables: string[];
  onToggleBillable: (service: BillableService) => void;
  onCreatePix: () => void;
  onOpenPix: (invoice: Invoice) => void;
}) {
  const selectedTotal = billableServices
    .filter((item) => selectedBillables.includes(item.id))
    .reduce((total, item) => total + item.amountCents, 0);
  const pendingTotal = invoices
    .filter((invoice) => invoice.status !== "paid")
    .reduce((total, invoice) => total + invoice.amountCents, 0);

  return (
    <div className="billing-page">
      <section className="finance-summary">
        <div>
          <span>A receber</span>
          <strong>{formatCurrency(pendingTotal)}</strong>
          <small>2 cobranças abertas</small>
        </div>
        <div>
          <span>Recebido no mês</span>
          <strong>{formatCurrency(428000)}</strong>
          <small>Somente Pix</small>
        </div>
        <div>
          <span>Serviços a cobrar</span>
          <strong>{billableServices.length}</strong>
          <small>{formatCurrency(40500)} disponíveis</small>
        </div>
      </section>

      <section className="panel full-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Aguardando faturamento</p>
            <h2>Serviços concluídos</h2>
          </div>
          <span className="pix-only-badge">Pagamento exclusivo por Pix</span>
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
                      {invoice.status === "pending" ? "Ver Pix" : "Detalhes"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selectedBillables.length > 0 && (
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
            Criar cobrança Pix
          </button>
        </div>
      )}
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
  return <span className="status-pill pending">Aguardando Pix</span>;
}

function ActivityView() {
  return (
    <section className="panel full-panel">
      <div className="panel-heading">
        <div>
          <p className="section-kicker">Hoje</p>
          <h2>Registro de atividades</h2>
        </div>
        <span className="audit-badge">Histórico protegido</span>
      </div>
      <div className="audit-list">
        {auditFixtures.map((event) => (
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
      <div className="audit-note">
        <strong>Como a trilha funciona</strong>
        <p>
          Ações financeiras, cancelamentos, permissões e arquivos geram eventos
          imutáveis. Conteúdo sensível e códigos Pix completos não entram nos
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
            <strong>Gestão Canina</strong>
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
                  <strong>{formatCurrency(invoice.amountCents)} por Pix</strong>
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
                    <span>Transporte</span>
                    <strong>6</strong>
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
                      <small>30/07/2026</small>
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
                <h2>Pagamentos por Pix</h2>
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
        />
      )}
    </div>
  );
}

function PixDialog({
  state,
  onClose,
  onIssue,
  onSimulatePayment,
  onFeedback,
}: {
  state: PixState;
  onClose: () => void;
  onIssue: () => void;
  onSimulatePayment: () => void;
  onFeedback: (message: string) => void;
}) {
  const demoCode = `DEMONSTRACAO-PIX-NAO-VALIDO-${
    state.invoice?.number ?? "NOVA-COBRANCA"
  }`;

  if (state.step === "review") {
    return (
      <Dialog
        title="Revisar cobrança"
        description="Confira os serviços antes de emitir o Pix."
        onClose={onClose}
      >
        <div className="billing-review">
          <div className="review-customer">
            <span>Cliente</span>
            <strong>{state.customerName}</strong>
          </div>
          <div className="review-items">
            {state.selectedServices.map((service) => (
              <div key={service.id}>
                <span>
                  <strong>
                    {service.dogName} · {service.service}
                  </strong>
                  <small>{service.date}</small>
                </span>
                <strong>{formatCurrency(service.amountCents)}</strong>
              </div>
            ))}
          </div>
          <div className="review-total">
            <span>Total</span>
            <strong>{formatCurrency(state.amountCents)}</strong>
          </div>
          <div className="pix-notice">
            <span className="attention-mark">i</span>
            <p>
              <strong>Pagamento exclusivo por Pix.</strong>
              Esta cobrança reúne o saldo integral dos itens selecionados.
            </p>
          </div>
          <div className="dialog-actions">
            <button className="secondary-button" onClick={onClose}>
              Voltar
            </button>
            <button className="primary-button" onClick={onIssue} autoFocus>
              Emitir cobrança Pix
            </button>
          </div>
        </div>
      </Dialog>
    );
  }

  if (state.step === "paid") {
    return (
      <Dialog
        title="Pagamento Pix confirmado"
        description="Confirmação simulada somente para validar o fluxo."
        onClose={onClose}
        size="small"
      >
        <div className="payment-success">
          <span className="success-mark" aria-hidden="true">
            ✓
          </span>
          <strong>{formatCurrency(state.amountCents)}</strong>
          <p>
            Recebido em 30/07/2026 às 10:42. Os itens relacionados foram
            marcados como pagos.
          </p>
          <button className="primary-button" onClick={onClose} autoFocus>
            Concluir
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title={`Cobrança nº ${state.invoice?.number ?? "—"}`}
      description="Aguardando pagamento"
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
          <span className="status-pill pending">Aguardando Pix</span>
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
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className={`dialog-card dialog-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        aria-describedby="dialog-description"
      >
        <header className="dialog-header">
          <div>
            <h2 id="dialog-title">{title}</h2>
            <p id="dialog-description">{description}</p>
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
