export type CustomerStatement = {
  customer: { id: string; name: string };
  period: { from: string; to: string };
  openingBalanceCents: number;
  closingBalanceCents: number;
  summary: {
    openingAmountDueCents: number;
    openingCustomerCreditCents: number;
    chargesInPeriodCents: number;
    paymentsInPeriodCents: number;
    amountDueCents: number;
    customerCreditCents: number;
  };
  entries: Array<{
    id: string;
    date: string;
    type: "invoice" | "payment";
    reference: string;
    dueDate?: string | null;
    description: string;
    debitCents: number;
    creditCents: number;
    runningBalanceCents: number;
  }>;
  creditMovements: Array<{
    id: string;
    date: string;
    serviceName: string;
    deltaUnits: number;
    reason: string;
  }>;
  creditBalances: Array<{ serviceName: string; units: number }>;
  generatedAt: string;
};

export function describeStatementBalance(valueCents: number) {
  if (valueCents > 0) {
    return {
      label: "Total em aberto",
      amountCents: valueCents,
      kind: "due" as const,
    };
  }
  if (valueCents < 0) {
    return {
      label: "Crédito a favor do cliente",
      amountCents: Math.abs(valueCents),
      kind: "credit" as const,
    };
  }
  return {
    label: "Nada em aberto",
    amountCents: 0,
    kind: "settled" as const,
  };
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value / 100);
}

function date(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function safeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 -]/g, "")
    .trim();
}

function printable(value: string) {
  return value.replace(/[·–—]/g, "-");
}

export async function generateStatementPdf(statement: CustomerStatement) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 17;
  const pageWidth = 210;
  const contentWidth = pageWidth - margin * 2;
  let y = 18;

  const setInk = () => pdf.setTextColor(28, 53, 45);
  const setMuted = () => pdf.setTextColor(91, 99, 94);
  const addPageIfNeeded = (height = 12) => {
    if (y + height <= 278) return;
    pdf.addPage();
    y = 18;
    setInk();
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text("Hospet Quintal - Extrato", margin, y);
    y += 10;
  };
  const summaryBox = (
    x: number,
    width: number,
    label: string,
    valueCents: number,
  ) => {
    pdf.setFillColor(248, 246, 241);
    pdf.setDrawColor(222, 219, 211);
    pdf.roundedRect(x, y, width, 20, 2, 2, "FD");
    setMuted();
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.text(label, x + 4, y + 6);
    setInk();
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10.5);
    pdf.text(money(valueCents), x + 4, y + 14);
  };

  setInk();
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.text("Hospet Quintal", margin, y);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text("Extrato do cliente", pageWidth - margin, y, { align: "right" });
  y += 12;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text(printable(statement.customer.name), margin, y);
  setMuted();
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.text(
    `${date(statement.period.from)} a ${date(statement.period.to)}`,
    pageWidth - margin,
    y,
    { align: "right" },
  );
  y += 9;
  pdf.setDrawColor(205, 211, 205);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 8;

  const opening = describeStatementBalance(statement.openingBalanceCents);
  setMuted();
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.text("Situação no início do período", margin, y);
  setInk();
  pdf.setFont("helvetica", "bold");
  pdf.text(
    `${opening.label}: ${money(opening.amountCents)}`,
    pageWidth - margin,
    y,
    { align: "right" },
  );
  y += 7;

  const boxGap = 4;
  const boxWidth = (contentWidth - boxGap * 2) / 3;
  summaryBox(margin, boxWidth, "Faturado no período", statement.summary.chargesInPeriodCents);
  summaryBox(
    margin + boxWidth + boxGap,
    boxWidth,
    "Pagamentos recebidos",
    statement.summary.paymentsInPeriodCents,
  );
  const closing = describeStatementBalance(statement.closingBalanceCents);
  summaryBox(
    margin + (boxWidth + boxGap) * 2,
    boxWidth,
    closing.label,
    closing.amountCents,
  );
  y += 29;

  setInk();
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text("Movimentações do período", margin, y);
  y += 7;

  if (!statement.entries.length) {
    setMuted();
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.text("Nenhuma fatura ou pagamento foi registrado neste período.", margin, y);
    y += 10;
  }

  for (const entry of statement.entries) {
    const descriptionLines = pdf.splitTextToSize(
      printable(entry.description),
      116,
    ) as string[];
    const entryHeight = Math.max(17, 11 + descriptionLines.length * 4);
    addPageIfNeeded(entryHeight);

    setInk();
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.text(`${date(entry.date)} - ${entry.reference}`, margin, y);
    pdf.text(
      entry.type === "invoice" ? "Fatura" : "Pagamento recebido",
      pageWidth - margin,
      y,
      { align: "right" },
    );
    y += 5;

    setMuted();
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(descriptionLines, margin, y);
    setInk();
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9.5);
    pdf.text(
      money(entry.type === "invoice" ? entry.debitCents : entry.creditCents),
      pageWidth - margin,
      y,
      { align: "right" },
    );
    if (entry.type === "invoice" && entry.dueDate) {
      setMuted();
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7.5);
      pdf.text(`Vencimento ${date(entry.dueDate)}`, pageWidth - margin, y + 4.5, {
        align: "right",
      });
    }
    y += Math.max(8, descriptionLines.length * 4 + 5);
    pdf.setDrawColor(232, 232, 227);
    pdf.line(margin, y - 2, pageWidth - margin, y - 2);
  }

  addPageIfNeeded(38);
  y += 3;
  pdf.setFillColor(closing.kind === "due" ? 250 : 244, closing.kind === "due" ? 246 : 248, closing.kind === "due" ? 237 : 245);
  pdf.setDrawColor(205, 211, 205);
  pdf.roundedRect(margin, y, contentWidth, 20, 2, 2, "FD");
  setInk();
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10.5);
  pdf.text(closing.label, margin + 5, y + 12);
  pdf.setFontSize(12);
  pdf.text(money(closing.amountCents), pageWidth - margin - 5, y + 12, {
    align: "right",
  });
  y += 27;

  if (statement.creditBalances.length) {
    addPageIfNeeded(20);
    setInk();
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text("Saldos de créditos", margin, y);
    y += 5;
    setMuted();
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    const creditLines = pdf.splitTextToSize(
      statement.creditBalances
        .map((item) =>
          item.units < 0
            ? `${item.serviceName}: ${Math.abs(item.units)} a regularizar`
            : `${item.serviceName}: ${item.units} disponível${item.units === 1 ? "" : "is"}`,
        )
        .join(" - "),
      contentWidth,
    ) as string[];
    pdf.text(creditLines, margin, y);
  }

  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    setMuted();
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.text(
      `Gerado em ${date(statement.generatedAt)} - Página ${page} de ${pageCount}`,
      margin,
      286,
    );
  }

  const filename = `Extrato - ${safeName(statement.customer.name)} - ${date(statement.period.from).replaceAll("/", "-")} a ${date(statement.period.to).replaceAll("/", "-")}.pdf`;
  const blob = pdf.output("blob");
  return {
    blob,
    filename,
    file: new File([blob], filename, { type: "application/pdf" }),
  };
}
