export type ServiceType =
  | "daycare"
  | "bath"
  | "grooming"
  | "transport"
  | "hotel"
  | "other";

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
  dogIds: string[];
  balanceCents: number;
  creditsLabel: string;
  status: "current" | "pending" | "overdue";
};

export type Booking = {
  id: string;
  time: string;
  endTime?: string;
  dogId: string;
  dogName: string;
  customerId: string;
  customerName: string;
  service: string;
  serviceType: ServiceType;
  status: BookingStatus;
  priceCents: number;
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

export const serviceLabels: Record<ServiceType, string> = {
  daycare: "Creche",
  bath: "Banho",
  grooming: "Tosa higiênica",
  transport: "Transporte",
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
      { label: "Transporte", value: 6 },
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
    today: "Tosa às 10:00",
    nextService: "Tosa higiênica · hoje, 10:00",
    credits: [{ label: "Banho", value: 1 }],
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
    today: "Transporte às 16:30",
    nextService: "Transporte · hoje, 16:30",
    credits: [{ label: "Transporte", value: 3 }],
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
    creditsLabel: "11 créditos disponíveis",
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
    creditsLabel: "3 créditos disponíveis",
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
    time: "08:00",
    endTime: "08:45",
    dogId: "dog-bento",
    dogName: "Bento",
    customerId: "customer-marina",
    customerName: "Marina Costa",
    service: "Transporte de ida · Creche",
    serviceType: "transport",
    status: "in_transit",
    priceCents: 6500,
    note: "Buscar na portaria.",
  },
  {
    id: "booking-nina",
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
  },
  {
    id: "booking-theo",
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
    note: "Usar shampoo hipoalergênico.",
  },
  {
    id: "booking-lola",
    time: "10:00",
    endTime: "10:40",
    dogId: "dog-lola",
    dogName: "Lola",
    customerId: "customer-marina",
    customerName: "Marina Costa",
    service: "Tosa higiênica",
    serviceType: "grooming",
    status: "scheduled",
    priceCents: 5500,
  },
  {
    id: "booking-mel",
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
    note: "Confirmar entrega da ração.",
  },
  {
    id: "booking-chico",
    time: "16:30",
    endTime: "17:10",
    dogId: "dog-chico",
    dogName: "Chico",
    customerId: "customer-paulo",
    customerName: "Paulo Mendes",
    service: "Transporte de volta",
    serviceType: "transport",
    status: "scheduled",
    priceCents: 3500,
  },
  {
    id: "booking-pingo",
    time: "07:30",
    endTime: "08:20",
    dogId: "dog-nina",
    dogName: "Nina",
    customerId: "customer-camila",
    customerName: "Camila Moreira",
    service: "Transporte de ida",
    serviceType: "transport",
    status: "completed",
    priceCents: 3500,
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
  },
  {
    id: "invoice-183",
    number: "000183",
    customerId: "customer-ana",
    customerName: "Ana Ribeiro",
    amountCents: 18000,
    due: "Pago em 27/07",
    status: "paid",
    items: "Hospedagem da Mel",
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
    service: "Transporte",
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

export const auditFixtures = [
  {
    id: "audit-1",
    time: "10:42",
    actor: "Alex · Administrador",
    action: "Pagamento Pix confirmado",
    detail: "Cobrança 000183 · R$ 180,00",
  },
  {
    id: "audit-2",
    time: "09:56",
    actor: "Alex · Administrador",
    action: "Atendimento concluído",
    detail: "Nina · Transporte de ida",
  },
  {
    id: "audit-3",
    time: "09:18",
    actor: "Alex · Administrador",
    action: "Chegada registrada",
    detail: "Nina · Creche",
  },
  {
    id: "audit-4",
    time: "08:03",
    actor: "Alex · Administrador",
    action: "Rota iniciada",
    detail: "Bento · Transporte de ida",
  },
];
