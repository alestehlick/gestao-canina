export type ServiceType =
  | "daycare"
  | "bath"
  | "grooming"
  | "transport"
  | "hotel"
  | "other";

export type CreditServiceType = "daycare" | "bath" | "grooming" | "transport";

export type BookingStatus =
  | "scheduled"
  | "confirmed"
  | "in_transit"
  | "present"
  | "in_service"
  | "completed"
  | "cancelled";

export type Dog = {
  id: string;
  name: string;
  initials: string;
  breed: string;
  age: string;
  birthDate?: string;
  sex?: "female" | "male" | "unknown";
  neutered?: boolean | null;
  feedingNotes?: string;
  temperamentNotes?: string;
  medicationNotes?: string;
  vaccines?: { name: string; expiresOn: string }[];
  photoUrl?: string;
  customerId: string;
  customerName: string;
  color: string;
  vaccinesCurrent: boolean;
  today: string;
  nextService: string;
  alert?: string;
  credits: { label: string; value: number }[];
};

export type Customer = {
  id: string;
  name: string;
  initials: string;
  phone: string;
  email: string;
  address?: string;
  cpf?: string;
  birthDate?: string;
  dogIds: string[];
  balanceCents: number;
  creditsLabel: string;
  status: "current" | "pending" | "overdue";
};

export type Booking = {
  id: string;
  itemId?: string;
  serviceCatalogId?: string;
  recurringScheduleId?: string;
  occurrenceDate?: string;
  date: string;
  time: string;
  endTime?: string;
  endDate?: string;
  lodgingNights?: number;
  depositPercent?: number;
  dogId: string;
  dogName: string;
  customerId: string;
  customerName: string;
  service: string;
  serviceType: ServiceType;
  transportDirection?: "one_way" | "round_trip";
  status: BookingStatus;
  priceCents: number;
  paymentPreference: "invoice" | "credit";
  settlementStatus?: "pending" | "invoice_pending" | "invoice_paid" | "credit_used";
  depositInvoice?: {
    id: string;
    number: string;
    amountCents: number;
    status: "pending" | "paid" | "overdue";
  };
  balanceInvoice?: {
    id: string;
    number: string;
    amountCents: number;
    status: "pending" | "paid" | "overdue";
  };
  receiptNumber?: string;
  note?: string;
};

export type Task = {
  id: string;
  title: string;
  due: string;
  priority: "normal" | "high";
  completed: boolean;
};

export type Invoice = {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  amountCents: number;
  due: string;
  status: "pending" | "paid" | "overdue";
  items: string;
  sourceType?: "services" | "credit_package" | "lodging_deposit" | "lodging_balance";
  cashEntryId?: string;
  cashIncluded?: boolean;
  periodStart?: string;
  periodEnd?: string;
  lines: {
    dogName: string;
    service: string;
    date: string;
    amountCents: number;
  }[];
};

export type BillableService = {
  id: string;
  customerId: string;
  customerName: string;
  dogName: string;
  date: string;
  service: string;
  amountCents: number;
};

export type CreditBalances = Record<
  string,
  Record<CreditServiceType, number>
>;

export type CreditPurchase = {
  id: string;
  customerId: string;
  customerName: string;
  serviceType: CreditServiceType;
  units: number;
  amountCents: number;
  standardValueCents: number;
  status: "awaiting_payment" | "paid" | "cancelled";
  createdAt: string;
  invoiceId?: string;
};

export type ServiceReceipt = {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  dogName: string;
  serviceType: CreditServiceType;
  service: string;
  date: string;
  creditUnits: number;
  remainingBalance?: number;
  deliveryStatus: "ready" | "sent";
  sentBy?: "whatsapp" | "email";
};

export const demoToday = "2026-07-30";

export const serviceLabels: Record<ServiceType, string> = {
  daycare: "Creche",
  bath: "Banho",
  grooming: "Banho e tosa",
  transport: "Taxi-dog",
  hotel: "Hospedagem",
  other: "Outro",
};

export const statusLabels: Record<BookingStatus, string> = {
  scheduled: "Agendado",
  confirmed: "Confirmado",
  in_transit: "Em rota",
  present: "Presente",
  in_service: "Em atendimento",
  completed: "Concluído",
  cancelled: "Cancelado",
};

export const defaultServicePrices: Record<ServiceType, number> = {
  daycare: 7000,
  bath: 9500,
  grooming: 9000,
  transport: 500,
  hotel: 18000,
  other: 5000,
};

export const demoDogs: Dog[] = [
  {
    id: "dog-bento",
    name: "Bento",
    initials: "BE",
    breed: "Golden retriever",
    age: "4 anos",
    customerId: "customer-marina",
    customerName: "Marina Costa",
    color: "clay",
    vaccinesCurrent: true,
    today: "Em rota para a creche",
    nextService: "Creche · hoje, 08:30",
    credits: [
      { label: "Creche", value: 4 },
      { label: "Banho", value: 1 },
    ],
  },
  {
    id: "dog-lola",
    name: "Lola",
    initials: "LO",
    breed: "Dachshund",
    age: "3 anos",
    customerId: "customer-marina",
    customerName: "Marina Costa",
    color: "plum",
    vaccinesCurrent: true,
    today: "Banho e tosa às 10:00",
    nextService: "Banho e tosa · hoje, 10:00",
    credits: [{ label: "Banho e tosa", value: 2 }],
  },
  {
    id: "dog-nina",
    name: "Nina",
    initials: "NI",
    breed: "Border collie",
    age: "5 anos",
    customerId: "customer-camila",
    customerName: "Camila Moreira",
    color: "forest",
    vaccinesCurrent: true,
    today: "Presente na creche",
    nextService: "Creche · hoje, 08:30",
    credits: [{ label: "Creche", value: 8 }],
  },
  {
    id: "dog-theo",
    name: "Theo",
    initials: "TH",
    breed: "Shih-tzu",
    age: "6 anos",
    customerId: "customer-rafael",
    customerName: "Rafael Nunes",
    color: "sky",
    vaccinesCurrent: true,
    today: "Banho confirmado",
    nextService: "Banho · hoje, 09:15",
    alert: "Pele sensível — usar shampoo hipoalergênico.",
    credits: [],
  },
  {
    id: "dog-chico",
    name: "Chico",
    initials: "CH",
    breed: "Beagle",
    age: "2 anos",
    customerId: "customer-paulo",
    customerName: "Paulo Mendes",
    color: "gold",
    vaccinesCurrent: true,
    today: "Taxi-dog às 16:30",
    nextService: "Taxi-dog · hoje, 16:30",
    credits: [],
  },
  {
    id: "dog-mel",
    name: "Mel",
    initials: "ME",
    breed: "Sem raça definida",
    age: "7 anos",
    customerId: "customer-ana",
    customerName: "Ana Ribeiro",
    color: "rose",
    vaccinesCurrent: true,
    today: "Entrada prevista às 14:00",
    nextService: "Hospedagem · hoje, 14:00",
    alert: "Alergia alimentar — não oferecer frango.",
    credits: [],
  },
];

export const demoCustomers: Customer[] = [
  {
    id: "customer-marina",
    name: "Marina Costa",
    initials: "MC",
    phone: "(11) 90000-1001",
    email: "marina.costa@example.com",
    dogIds: ["dog-bento", "dog-lola"],
    balanceCents: 21500,
    creditsLabel: "7 créditos disponíveis",
    status: "pending",
  },
  {
    id: "customer-camila",
    name: "Camila Moreira",
    initials: "CM",
    phone: "(11) 90000-1002",
    email: "camila.moreira@example.com",
    dogIds: ["dog-nina"],
    balanceCents: 0,
    creditsLabel: "8 créditos disponíveis",
    status: "current",
  },
  {
    id: "customer-rafael",
    name: "Rafael Nunes",
    initials: "RN",
    phone: "(11) 90000-1003",
    email: "rafael.nunes@example.com",
    dogIds: ["dog-theo"],
    balanceCents: 9500,
    creditsLabel: "Sem créditos",
    status: "overdue",
  },
  {
    id: "customer-paulo",
    name: "Paulo Mendes",
    initials: "PM",
    phone: "(11) 90000-1004",
    email: "paulo.mendes@example.com",
    dogIds: ["dog-chico"],
    balanceCents: 0,
    creditsLabel: "Sem créditos",
    status: "current",
  },
  {
    id: "customer-ana",
    name: "Ana Ribeiro",
    initials: "AR",
    phone: "(11) 90000-1005",
    email: "ana.ribeiro@example.com",
    dogIds: ["dog-mel"],
    balanceCents: 0,
    creditsLabel: "Sem créditos",
    status: "current",
  },
];

export const demoBookings: Booking[] = [
  {
    id: "booking-bento",
    date: "2026-07-30",
    time: "08:00",
    endTime: "08:45",
    dogId: "dog-bento",
    dogName: "Bento",
    customerId: "customer-marina",
    customerName: "Marina Costa",
    service: "Taxi-dog · ida · Creche",
    serviceType: "transport",
    status: "in_transit",
    priceCents: 6500,
    paymentPreference: "invoice",
    note: "Buscar na portaria.",
  },
  {
    id: "booking-nina",
    date: "2026-07-30",
    time: "08:30",
    endTime: "17:30",
    dogId: "dog-nina",
    dogName: "Nina",
    customerId: "customer-camila",
    customerName: "Camila Moreira",
    service: "Creche",
    serviceType: "daycare",
    status: "present",
    priceCents: 7000,
    paymentPreference: "credit",
  },
  {
    id: "booking-theo",
    date: "2026-07-30",
    time: "09:15",
    endTime: "10:15",
    dogId: "dog-theo",
    dogName: "Theo",
    customerId: "customer-rafael",
    customerName: "Rafael Nunes",
    service: "Banho",
    serviceType: "bath",
    status: "confirmed",
    priceCents: 9500,
    paymentPreference: "invoice",
    note: "Usar shampoo hipoalergênico.",
  },
  {
    id: "booking-lola",
    date: "2026-07-30",
    time: "10:00",
    endTime: "10:40",
    dogId: "dog-lola",
    dogName: "Lola",
    customerId: "customer-marina",
    customerName: "Marina Costa",
    service: "Banho e tosa",
    serviceType: "grooming",
    status: "scheduled",
    priceCents: 5500,
    paymentPreference: "credit",
  },
  {
    id: "booking-mel",
    date: "2026-07-30",
    time: "14:00",
    endTime: "18:00",
    dogId: "dog-mel",
    dogName: "Mel",
    customerId: "customer-ana",
    customerName: "Ana Ribeiro",
    service: "Entrada de hospedagem",
    serviceType: "hotel",
    status: "scheduled",
    priceCents: 18000,
    paymentPreference: "invoice",
    lodgingNights: 1,
    depositPercent: 50,
    note: "Confirmar entrega da ração.",
  },
  {
    id: "booking-chico",
    date: "2026-07-30",
    time: "16:30",
    endTime: "17:10",
    dogId: "dog-chico",
    dogName: "Chico",
    customerId: "customer-paulo",
    customerName: "Paulo Mendes",
    service: "Taxi-dog · volta",
    serviceType: "transport",
    status: "scheduled",
    priceCents: 3500,
    paymentPreference: "invoice",
  },
  {
    id: "booking-pingo",
    date: "2026-07-30",
    time: "07:30",
    endTime: "08:20",
    dogId: "dog-nina",
    dogName: "Nina",
    customerId: "customer-camila",
    customerName: "Camila Moreira",
    service: "Taxi-dog · ida",
    serviceType: "transport",
    status: "completed",
    priceCents: 3500,
    paymentPreference: "invoice",
    settlementStatus: "invoice_pending",
  },
  {
    id: "booking-bento-future",
    date: "2026-07-31",
    time: "08:30",
    endTime: "17:30",
    dogId: "dog-bento",
    dogName: "Bento",
    customerId: "customer-marina",
    customerName: "Marina Costa",
    service: "Creche",
    serviceType: "daycare",
    status: "confirmed",
    priceCents: 7000,
    paymentPreference: "credit",
  },
  {
    id: "booking-theo-future",
    date: "2026-07-31",
    time: "10:30",
    endTime: "11:30",
    dogId: "dog-theo",
    dogName: "Theo",
    customerId: "customer-rafael",
    customerName: "Rafael Nunes",
    service: "Banho",
    serviceType: "bath",
    status: "scheduled",
    priceCents: 9500,
    paymentPreference: "invoice",
    note: "Confirmar shampoo na chegada.",
  },
  {
    id: "booking-mel-future",
    date: "2026-08-01",
    time: "09:00",
    endTime: "09:30",
    dogId: "dog-mel",
    dogName: "Mel",
    customerId: "customer-ana",
    customerName: "Ana Ribeiro",
    service: "Diária de hospedagem",
    serviceType: "hotel",
    status: "confirmed",
    priceCents: 18000,
    paymentPreference: "invoice",
    note: "Separar alimentação própria.",
  },
  {
    id: "booking-nina-future",
    date: "2026-08-03",
    time: "08:30",
    endTime: "17:30",
    dogId: "dog-nina",
    dogName: "Nina",
    customerId: "customer-camila",
    customerName: "Camila Moreira",
    service: "Creche",
    serviceType: "daycare",
    status: "scheduled",
    priceCents: 7000,
    paymentPreference: "credit",
  },
  {
    id: "booking-lola-future",
    date: "2026-08-04",
    time: "14:00",
    endTime: "14:45",
    dogId: "dog-lola",
    dogName: "Lola",
    customerId: "customer-marina",
    customerName: "Marina Costa",
    service: "Banho e tosa",
    serviceType: "grooming",
    status: "scheduled",
    priceCents: 5500,
    paymentPreference: "credit",
  },
];

export const demoTasks: Task[] = [
  {
    id: "task-food",
    title: "Confirmar entrega da ração da Mel",
    due: "12:00",
    priority: "high",
    completed: false,
  },
  {
    id: "task-vaccine",
    title: "Revisar comprovante de vacina da Lola",
    due: "15:00",
    priority: "normal",
    completed: false,
  },
  {
    id: "task-call",
    title: "Retornar mensagem da Camila",
    due: "Sem horário",
    priority: "normal",
    completed: true,
  },
];

export const demoInvoices: Invoice[] = [
  {
    id: "invoice-184",
    number: "000184",
    customerId: "customer-marina",
    customerName: "Marina Costa",
    amountCents: 21500,
    due: "Vence hoje",
    status: "pending",
    items: "Banho de Bento e 2 outros serviços",
    periodStart: "2026-07-28",
    periodEnd: "2026-07-29",
    lines: [
      { dogName: "Bento", service: "Banho", date: "2026-07-28", amountCents: 9000 },
      { dogName: "Lola", service: "Creche", date: "2026-07-29", amountCents: 7000 },
      { dogName: "Bento", service: "Taxi-dog", date: "2026-07-29", amountCents: 5500 },
    ],
  },
  {
    id: "invoice-183",
    number: "000183",
    customerId: "customer-ana",
    customerName: "Ana Ribeiro",
    amountCents: 18000,
    due: "Pago em 27/07",
    status: "paid",
    cashEntryId: "cash-invoice-183",
    cashIncluded: true,
    items: "Hospedagem da Mel",
    sourceType: "lodging_balance",
    periodStart: "2026-07-26",
    periodEnd: "2026-07-27",
    lines: [
      { dogName: "Mel", service: "Saldo da hospedagem", date: "2026-07-27", amountCents: 18000 },
    ],
  },
  {
    id: "invoice-181",
    number: "000181",
    customerId: "customer-rafael",
    customerName: "Rafael Nunes",
    amountCents: 9500,
    due: "Venceu em 25/07",
    status: "overdue",
    items: "Banho do Theo",
    periodStart: "2026-07-25",
    periodEnd: "2026-07-25",
    lines: [
      { dogName: "Theo", service: "Banho", date: "2026-07-25", amountCents: 9500 },
    ],
  },
];

export const demoBillableServices: BillableService[] = [
  {
    id: "bill-bento-bath",
    customerId: "customer-marina",
    customerName: "Marina Costa",
    dogName: "Bento",
    date: "28/07/2026",
    service: "Banho",
    amountCents: 9000,
  },
  {
    id: "bill-lola-daycare",
    customerId: "customer-marina",
    customerName: "Marina Costa",
    dogName: "Lola",
    date: "29/07/2026",
    service: "Creche",
    amountCents: 7000,
  },
  {
    id: "bill-bento-transport",
    customerId: "customer-marina",
    customerName: "Marina Costa",
    dogName: "Bento",
    date: "29/07/2026",
    service: "Taxi-dog",
    amountCents: 5500,
  },
  {
    id: "bill-theo-bath",
    customerId: "customer-rafael",
    customerName: "Rafael Nunes",
    dogName: "Theo",
    date: "25/07/2026",
    service: "Banho",
    amountCents: 9500,
  },
];

export const demoCreditBalances: CreditBalances = {
  "customer-marina": { daycare: 4, bath: 1, grooming: 2, transport: 0 },
  "customer-camila": { daycare: 8, bath: 0, grooming: 0, transport: 0 },
  "customer-rafael": { daycare: 0, bath: 0, grooming: 0, transport: 0 },
  "customer-paulo": { daycare: 0, bath: 0, grooming: 0, transport: 0 },
  "customer-ana": { daycare: 0, bath: 0, grooming: 0, transport: 0 },
};

export const demoCreditPurchases: CreditPurchase[] = [
  {
    id: "credit-purchase-marina",
    customerId: "customer-marina",
    customerName: "Marina Costa",
    serviceType: "daycare",
    units: 5,
    amountCents: 31500,
    standardValueCents: 35000,
    status: "paid",
    createdAt: "29/07/2026",
    invoiceId: "invoice-credit-179",
  },
  {
    id: "credit-purchase-camila",
    customerId: "customer-camila",
    customerName: "Camila Moreira",
    serviceType: "daycare",
    units: 10,
    amountCents: 63000,
    standardValueCents: 70000,
    status: "paid",
    createdAt: "22/07/2026",
    invoiceId: "invoice-credit-166",
  },
];

export const demoReceipts: ServiceReceipt[] = [
  {
    id: "receipt-credit-1",
    number: "REC-00031",
    customerId: "customer-camila",
    customerName: "Camila Moreira",
    dogName: "Nina",
    serviceType: "daycare",
    service: "Creche",
    date: "28/07/2026",
    creditUnits: 1,
    remainingBalance: 8,
    deliveryStatus: "sent",
    sentBy: "whatsapp",
  },
];

export type AuditActivity = {
  id: string;
  time: string;
  actor: string;
  action: string;
  detail: string;
};

export const auditFixtures: AuditActivity[] = [
  {
    id: "audit-1",
    time: "10:42",
    actor: "Administrador fictício",
    action: "Pagamento registrado",
    detail: "Cobrança 000183 · R$ 180,00",
  },
  {
    id: "audit-2",
    time: "09:56",
    actor: "Administrador fictício",
    action: "Atendimento concluído",
    detail: "Nina · Taxi-dog de ida",
  },
  {
    id: "audit-3",
    time: "09:18",
    actor: "Administrador fictício",
    action: "Chegada registrada",
    detail: "Nina · Creche",
  },
  {
    id: "audit-4",
    time: "08:03",
    actor: "Administrador fictício",
    action: "Rota iniciada",
    detail: "Bento · Taxi-dog de ida",
  },
];
