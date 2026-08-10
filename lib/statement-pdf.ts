export type CustomerStatement = {
  customer: { id: string; name: string };
  period: { from: string; to: string };
  openingBalanceCents: number;
  closingBalanceCents: number;
  entries: Array<{
    id: string;
    date: string;
    type: "invoice" | "payment";
    reference: string;
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

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
}

function date(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function safeName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9 -]/g, "").trim();
}

export async function generateStatementPdf(statement: CustomerStatement) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 16;
  const pageWidth = 210;
  let y = 18;
  const addPageIfNeeded = (height = 12) => {
    if (y + height <= 282) return;
    pdf.addPage();
    y = 18;
  };
  pdf.setTextColor(28, 53, 45);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  pdf.text("Hospet Quintal", margin, y);
  pdf.setFontSize(10);
  pdf.setFont("helvetica", "normal");
  pdf.text("Extrato do cliente", pageWidth - margin, y, { align: "right" });
  y += 12;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text(statement.customer.name, margin, y);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text(`${date(statement.period.from)} a ${date(statement.period.to)}`, pageWidth - margin, y, { align: "right" });
  y += 10;
  pdf.setDrawColor(205, 211, 205);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 8;
  pdf.setFontSize(9);
  pdf.text("Saldo anterior", margin, y);
  pdf.setFont("helvetica", "bold");
  pdf.text(money(statement.openingBalanceCents), pageWidth - margin, y, { align: "right" });
  pdf.setFont("helvetica", "normal");
  y += 9;
  for (const entry of statement.entries) {
    addPageIfNeeded(18);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text(`${date(entry.date)} · ${entry.reference}`, margin, y);
    pdf.text(
      entry.type === "invoice" ? money(entry.debitCents) : `− ${money(entry.creditCents)}`,
      pageWidth - margin,
      y,
      { align: "right" },
    );
    y += 5;
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(82, 91, 86);
    const lines = pdf.splitTextToSize(entry.description, 125) as string[];
    pdf.text(lines, margin, y);
    pdf.text(`Saldo ${money(entry.runningBalanceCents)}`, pageWidth - margin, y, { align: "right" });
    y += Math.max(8, lines.length * 4 + 4);
    pdf.setTextColor(28, 53, 45);
    pdf.setDrawColor(232, 232, 227);
    pdf.line(margin, y - 3, pageWidth - margin, y - 3);
  }
  addPageIfNeeded(28);
  y += 3;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text("Saldo ao final do período", margin, y);
  pdf.text(money(statement.closingBalanceCents), pageWidth - margin, y, { align: "right" });
  if (statement.creditBalances.length) {
    y += 12;
    pdf.setFontSize(9);
    pdf.text("Créditos disponíveis", margin, y);
    pdf.setFont("helvetica", "normal");
    y += 5;
    pdf.text(
      statement.creditBalances.map((item) => `${item.serviceName}: ${item.units}`).join(" · "),
      margin,
      y,
    );
  }
  const filename = `Extrato - ${safeName(statement.customer.name)} - ${date(statement.period.from).replaceAll("/", "-")} a ${date(statement.period.to).replaceAll("/", "-")}.pdf`;
  const blob = pdf.output("blob");
  return { blob, filename, file: new File([blob], filename, { type: "application/pdf" }) };
}
