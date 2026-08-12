import { jsPDF } from "jspdf";

type CashReportEntry = {
  occurredOn: string;
  description: string;
  category: string;
  financialAccountName: string | null;
  direction: "inflow" | "outflow";
  amountCents: number;
};

export type CashReportData = {
  period: { start: string; end: string };
  accountName?: string;
  totals: {
    receivedCents: number;
    paidCents: number;
    resultCents: number;
  };
  serviceStats: Array<{ label: string; receivedCents: number }>;
  expenseCategories: Array<{ category: string; amountCents: number }>;
  entries: CashReportEntry[];
};

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value / 100);
}

function date(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function cashReportFilename(data: CashReportData, extension: "pdf" | "csv") {
  return `caixa_${data.period.start}_${data.period.end}.${extension}`;
}

export function generateCashReportPdf(data: CashReportData) {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const left = 18;
  const right = 192;
  let y = 20;
  const ensure = (height = 12) => {
    if (y + height <= 278) return;
    pdf.addPage();
    y = 18;
  };

  pdf.setTextColor(35, 45, 40);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.text("Hospet Quintal", left, y);
  pdf.setFontSize(8);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(105, 108, 103);
  pdf.text("Relatório gerencial do Caixa", right, y, { align: "right" });
  y += 12;

  pdf.setDrawColor(210, 208, 202);
  pdf.line(left, y, right, y);
  y += 9;
  pdf.setTextColor(35, 45, 40);
  pdf.setFontSize(11);
  pdf.setFont("helvetica", "bold");
  pdf.text(`${date(data.period.start)} a ${date(data.period.end)}`, left, y);
  if (data.accountName) {
    pdf.setFontSize(8);
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(105, 108, 103);
    pdf.text(data.accountName, right, y, { align: "right" });
  }
  y += 11;

  const summaries = [
    ["Recebido", data.totals.receivedCents],
    ["Pago", data.totals.paidCents],
    ["Resultado", data.totals.resultCents],
  ] as const;
  summaries.forEach(([label, value], index) => {
    const x = left + index * 59;
    pdf.setFillColor(247, 245, 240);
    pdf.roundedRect(x, y, 55, 20, 2, 2, "F");
    pdf.setFontSize(7);
    pdf.setTextColor(105, 108, 103);
    pdf.text(label.toUpperCase(), x + 4, y + 6);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(value < 0 ? 145 : 35, value < 0 ? 65 : 45, value < 0 ? 60 : 40);
    pdf.text(money(value), x + 4, y + 15);
    pdf.setFont("helvetica", "normal");
  });
  y += 30;

  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(35, 45, 40);
  pdf.setFontSize(9);
  pdf.text("Receita recebida por serviço", left, y);
  y += 6;
  for (const service of data.serviceStats) {
    ensure(7);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(70, 74, 70);
    pdf.text(service.label, left, y);
    pdf.text(money(service.receivedCents), right, y, { align: "right" });
    y += 6;
  }
  y += 4;

  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(35, 45, 40);
  pdf.setFontSize(9);
  pdf.text("Despesas por categoria", left, y);
  y += 6;
  if (!data.expenseCategories.length) {
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(105, 108, 103);
    pdf.text("Nenhuma despesa considerada no período.", left, y);
    y += 7;
  } else {
    for (const item of data.expenseCategories) {
      ensure(7);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(70, 74, 70);
      pdf.text(item.category, left, y);
      pdf.text(money(item.amountCents), right, y, { align: "right" });
      y += 6;
    }
  }
  y += 5;

  ensure(18);
  pdf.setFont("helvetica", "bold");
  pdf.setTextColor(35, 45, 40);
  pdf.setFontSize(9);
  pdf.text("Movimentações consideradas", left, y);
  y += 7;
  pdf.setFontSize(7);
  pdf.setTextColor(105, 108, 103);
  pdf.text("DATA", left, y);
  pdf.text("DESCRIÇÃO", left + 22, y);
  pdf.text("VALOR", right, y, { align: "right" });
  y += 4;
  pdf.line(left, y, right, y);
  y += 6;
  for (const entry of data.entries) {
    ensure(10);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(55, 59, 55);
    pdf.text(date(entry.occurredOn), left, y);
    const description = `${entry.description} · ${entry.category}${entry.financialAccountName ? ` · ${entry.financialAccountName}` : ""}`;
    pdf.text(pdf.splitTextToSize(description, 118)[0], left + 22, y);
    pdf.setFont("helvetica", "bold");
    pdf.text(`${entry.direction === "outflow" ? "−" : "+"} ${money(entry.amountCents)}`, right, y, { align: "right" });
    y += 7;
  }

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.setTextColor(130, 132, 128);
    pdf.text(`Página ${page} de ${pages}`, right, 289, { align: "right" });
  }
  return pdf.output("blob");
}
