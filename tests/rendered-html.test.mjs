import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("mantém a experiência em português, privada e com demonstração segura", async () => {
  const [layout, page, app, data, styles] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/components/management-app.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/demo-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /lang="pt-BR"/);
  assert.match(layout, /Hospet Quintal/);
  assert.match(layout, /\/favicon\.svg/);
  assert.match(page, /<ManagementApp \/>/);
  assert.match(app, /Demonstração segura/);
  assert.match(app, /\/api\/workspace/);
  assert.match(app, /Cloudflare/);
  assert.match(app, /Novo serviço/);
  assert.match(app, /Faturas/);
  assert.match(app, /\["credits", "Créditos"\]/);
  assert.match(app, /\["pending", "Pendências"\]/);
  assert.match(app, /\["history", "Histórico"\]/);
  assert.match(app, /invoice-delivery-button/);
  assert.match(app, /navigator\.share/);
  assert.match(app, /Salvar/);
  assert.match(app, /Registrar pagamento/);
  assert.match(app, /Em compensação/);
  assert.match(app, /Confirmar disponibilidade/);
  assert.match(app, /Gerar fatura do sinal/);
  assert.match(app, /Gerar fatura do saldo/);
  assert.match(app, /\.sort\(agendaBookingOrder\)/);
  assert.match(app, /nameDifference = left\.dogName\.localeCompare/);
  assert.match(app, /confirmed: "completed"/);
  assert.doesNotMatch(app, /Registrar chegada/);
  assert.match(app, /const defaultInvoiceFrom = shiftDate\(operationalToday, -29\)/);
  assert.match(
    app,
    /tab === "history" \? synchronizedHistoryInvoices : openInvoices/,
  );
  assert.match(app, /invoice\.paidAt \?\?\s*invoice\.issuedAt/s);
  assert.match(app, /const priorityDifference = priority\(left\) - priority\(right\)/);
  assert.match(app, /\["upcoming", "Em aberto"\]/);
  assert.match(app, /cancelInvoiceOpen/);
  assert.match(app, /Motivo do cancelamento/);
  assert.match(app, /invoice-delivery-column/);
  assert.match(app, /compact \? \(channel === "whatsapp" \? "WhatsApp" : "E-mail"\)/);
  assert.match(app, /Escolher período/);
  assert.match(app, /Mostrar faturas/);
  assert.match(app, /Filtrar cobranças por situação/);
  assert.match(app, /\["compensation", "Em compensação"\]/);
  assert.match(app, /Cliente · A–Z/);
  assert.match(app, /Data · mais próxima/);
  assert.match(app, /invoiceStatus\(invoice\) === invoiceStatusFilter/);
  assert.match(app, /left\.customerName\.localeCompare\(right\.customerName, "pt-BR"/);
  assert.match(app, /left\.dueDate \?\? "9999-12-31"/);
  assert.match(app, /whatsapp:\/\/send\?phone=/);
  assert.match(app, /isWindowsWhatsApp/);
  assert.match(app, /Digite o nome do cão/);
  assert.match(app, /service-dog-suggestions/);
  assert.match(app, /normalize\(`\$\{dog\.name\} \$\{dog\.customerName\}`\)\.includes\(query\)/);
  assert.doesNotMatch(app, /name="price"/);
  assert.match(app, /Cobrança regular/);
  assert.doesNotMatch(app, /serviceType === "transport" \? \(transportDirection === "round_trip"/);
  assert.match(app, /Não aplicar desconto por longa estadia/);
  assert.match(app, /Total pela diária padrão/);
  assert.match(app, /Valor tabelado:/);
  assert.match(app, /lodgingTableAmountCents/);
  assert.doesNotMatch(app, /pix/i);
  assert.match(data, /@example\.com/);
  assert.doesNotMatch(app, /Mastercard|VISA|cart[aã]o de cr[eé]dito/);
  assert.match(styles, /\.billing-page\s*\{[^}]*min-width:\s*0;/s);
  assert.match(styles, /\.billing-page\s*>\s*\*\s*\{[^}]*min-width:\s*0;/s);
  assert.match(styles, /\.billing-list-tools\s*\{[^}]*justify-content:\s*space-between;/s);
  assert.match(styles, /\.billing-status-filters\s*\{[^}]*overflow-x:\s*auto;/s);
});

test("mantém o Caixa íntegro, reversível e ligado aos pagamentos", async () => {
  const [
    schema,
    cashRoute,
    cashEntryRoute,
    cashSettings,
    payments,
    workspace,
    cashView,
    app,
    migration,
    integrityMigration,
    transfers,
    periods,
    reconciliations,
  ] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cash/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/cash/[id]/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/cash/settings/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/invoices/[id]/payments/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/components/cash-view.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/components/management-app.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0007_cash_ledger.sql", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../drizzle/0020_cash_integrity.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cash/transfers/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cash/periods/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/cash/reconciliations/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(schema, /sqliteTable\(\s*"cash_entries"/);
  assert.match(schema, /cashMonthStartDay/);
  assert.match(schema, /cash_entries_source_payment_unique/);
  assert.match(cashRoute, /requireIdentity\(request, \["owner", "finance"\]\)/);
  assert.match(cashRoute, /financialAccountId/);
  assert.match(cashRoute, /ce\.occurred_on BETWEEN \? AND \?/);
  assert.match(cashRoute, /i\.due_date < \?/);
  assert.doesNotMatch(cashRoute, /i\.due_on/);
  assert.match(cashEntryRoute, /automatic_cash_entry_locked/);
  assert.match(cashEntryRoute, /cash\.entry_excluded/);
  assert.match(cashEntryRoute, /cash\.entry_restored/);
  assert.doesNotMatch(cashEntryRoute, /export async function DELETE/);
  assert.match(cashSettings, /min: 1/);
  assert.match(cashSettings, /max: 28/);
  assert.match(payments, /INSERT INTO cash_entries/);
  assert.match(workspace, /cashEntryId/);
  assert.match(workspace, /orderBy\(desc\(invoices\.updatedAt\)\)/);
  const mergeQuery = workspace.slice(
    workspace.indexOf(".from(invoiceMergeMembers)"),
    workspace.indexOf(".from(invoicePayments)"),
  );
  const paymentQuery = workspace.slice(
    workspace.indexOf(".from(invoicePayments)"),
    workspace.indexOf(".from(invoiceSettlements)"),
  );
  assert.doesNotMatch(mergeQuery, /invoicePayments\.createdAt/);
  assert.match(paymentQuery, /orderBy\(desc\(invoicePayments\.createdAt\)\)/);
  assert.match(workspace, /orderBy\(desc\(creditPurchases\.updatedAt\)\)/);
  assert.match(workspace, /lodgingDailyRateCents/);
  assert.match(cashView, /Recebido no período/);
  assert.match(cashRoute, /credit_sold_cents/);
  assert.match(cashRoute, /ce\.status = 'included'/);
  assert.match(cashRoute, /ce\.occurred_on BETWEEN \? AND \?/);
  assert.match(cashRoute, /json_extract\(ai\.details_json, '\$\.groomingAddon'\) = 1/);
  assert.match(cashView, /Receita recebida no período/);
  assert.match(cashRoute, /\["hotel", "Hospedagem"\]/);
  assert.match(cashView, /Créditos vendidos:/);
  assert.match(cashView, /Avulsos recebidos:/);
  assert.match(cashView, /Resultado acumulado do período/);
  assert.match(cashView, /Desconsiderar/);
  assert.match(cashView, /Início do mês financeiro/);
  assert.match(schema, /sqliteTable\(\s*"invoice_settlements"/);
  assert.match(payments, /settlementMode/);
  assert.match(payments, /invoice\.settlement_scheduled/);
  assert.match(workspace, /compensationAvailableOn/);
  assert.match(app, /Fora do Caixa · restaurar/);
  assert.match(migration, /FROM `invoice_payments` ip/);
  assert.match(integrityMigration, /CREATE TABLE `cash_transfers`/);
  assert.match(integrityMigration, /CREATE TABLE `cash_reconciliations`/);
  assert.match(integrityMigration, /CREATE TABLE `cash_periods`/);
  assert.match(transfers, /idempotencyKey/);
  assert.match(transfers, /Transferência interna/);
  assert.match(periods, /cash\.period_closed/);
  assert.match(periods, /expectedVersion/);
  assert.match(reconciliations, /differenceCents/);
});

test("mantém perfis e navegação móveis enxutos e completos", async () => {
  const [app, styles, data, workspace, invoices] = await Promise.all([
    readFile(
      new URL("../app/components/management-app.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/workspace-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/invoices/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(app, /showDate/);
  assert.match(app, /formatShortDate\(booking\.date\)/);
  assert.doesNotMatch(app, /Documentos/);
  assert.match(app, /dog\.feedingNotes \|\| "Não informada"/);
  assert.match(app, /dog\.temperamentNotes \|\| "Não informado"/);
  assert.match(app, /balances\.transport/);
  assert.match(styles, /grid-template-columns:\s*repeat\(5,\s*1fr\)/);
  assert.match(styles, /grid-auto-columns:\s*106px/);
  assert.match(data, /year:\s*"numeric"/);
  assert.match(app, /function bookingOccursOn/);
  assert.match(app, /const dogsForDay = new Set/);
  assert.match(app, /label="hospedagens"/);
  assert.match(app, /label="creches"/);
  assert.match(app, /label="banhos"/);
  assert.match(app, /label="Taxi-dogs"/);
  assert.match(app, /function AgendaServiceFilters/);
  assert.match(app, /Todos os serviços/);
  assert.match(app, /Banhos e tosa/);
  assert.match(app, /function filterBookingsByService/);
  assert.match(app, /function CreditAdjustmentDialog/);
  assert.match(app, /Ajustar saldo/);
  assert.match(app, /Motivo do ajuste/);
  assert.match(app, /\/api\/credits/);
  assert.match(data, /"credit\.adjusted": "Saldo de créditos ajustado"/);
  assert.doesNotMatch(app, /label="programados"/);
  assert.doesNotMatch(app, /label="serviços no dia"/);
  assert.match(workspace, /lte\(appointments\.startDate, to\)/);
  assert.match(workspace, /gte\(appointments\.endDate, from\)/);
  assert.doesNotMatch(
    workspace,
    /eq\(appointmentItems\.paymentPreference, "invoice"\)/,
  );
  assert.match(workspace, /eq\(appointmentItems\.settlementMethod, "unsettled"\)/);
  assert.match(workspace, /isNull\(appointmentItems\.activeInvoiceId\)/);
  assert.doesNotMatch(
    workspace,
    /eq\(appointmentItems\.status, "completed"\)/,
  );
  assert.match(data, /appointment\.status === "completed"/);
  assert.doesNotMatch(
    data,
    /appointment\.status === "completed"\s*&&\s*item\.status === "completed"/,
  );
  assert.match(invoices, /SET status = 'completed', active_invoice_id = \?/);
  assert.match(app, /refreshWorkspace\(\{ force: true \}\)/);
  assert.match(app, /workspaceRefreshRevisionRef/);
});

test("mantém dados operacionais fora do repositório público", async () => {
  const [gitignore, schema, hosting, runtime] = await Promise.all([
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/runtime.ts", import.meta.url), "utf8"),
  ]);

  assert.match(gitignore, /\.dev\.vars\*/);
  assert.match(gitignore, /\*\.sqlite/);
  assert.match(gitignore, /\/exports\//);
  assert.match(schema, /sqliteTable\(\s*"audit_events"/);
  assert.match(schema, /sqliteTable\(\s*"invoice_payments"/);
  assert.match(schema, /amount_cents/);
  assert.doesNotMatch(schema, /pix/i);
  assert.doesNotMatch(runtime, /pix/i);
  const hostingConfig = JSON.parse(hosting);
  assert.equal(hostingConfig.d1, "DB");
  assert.equal(hostingConfig.r2, "FILES");
  assert.match(hostingConfig.project_id, /^appgprj_/);
});

test("protege as mutações essenciais no servidor", async () => {
  const [appointments, tasks, invoices, credits, auth, nextConfig] = await Promise.all([
    readFile(new URL("../app/api/appointments/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/tasks/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/invoices/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/credits/consume/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
  ]);

  for (const route of [appointments, tasks, invoices, credits]) {
    assert.match(route, /assertSameOrigin\(request\)/);
    assert.match(route, /requireIdentity\(request/);
  }
  for (const route of [appointments, tasks]) {
    assert.match(route, /auditEvents|audit_events/);
  }
  assert.match(invoices, /audit_events/);
  assert.match(credits, /audit_events/);
  assert.doesNotMatch(auth, /oai-authenticated-user-email/);
  assert.doesNotMatch(auth, /cf-access-jwt-assertion/);
  assert.doesNotMatch(auth, /NODE_ENV/);
  assert.match(nextConfig, /frame-ancestors 'none'/);
  assert.match(nextConfig, /private, no-store/);
});

test("mantém ações completas nos perfis e recorrências semanais seguras", async () => {
  const [app, appointments, appointmentUpdate, workspace, data] =
    await Promise.all([
      readFile(
        new URL("../app/components/management-app.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../app/api/appointments/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../app/api/appointments/[id]/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../app/api/workspace/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../lib/workspace-data.ts", import.meta.url), "utf8"),
    ]);

  assert.match(app, /function ProfileAppointments/);
  assert.match(app, /onEditBooking/);
  assert.match(app, /onCancelBooking/);
  assert.match(app, /Toda a recorrência/);
  assert.match(app, /Repetir por quantas semanas/);
  assert.match(appointments, /recurring_schedule\.created/);
  assert.match(appointments, /await d1\.batch\(statements\)/);
  assert.match(appointmentUpdate, /recurring_schedule\.cancelled/);
  assert.match(appointmentUpdate, /status NOT IN \('completed', 'cancelled'\)/);
  assert.match(appointmentUpdate, /recurring_schedule_has_payment/);
  assert.match(workspace, /recurringScheduleId/);
  assert.match(data, /Recorrência semanal cancelada/);
});

test("mostra datas brasileiras e limita as diárias ao período escolhido", async () => {
  const [app, portal, dateInput, appointments, invoices] =
    await Promise.all([
      readFile(
        new URL("../app/components/management-app.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../app/components/customer-portal.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/components/brazilian-date-input.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL("../app/api/appointments/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../app/api/invoices/route.ts", import.meta.url), "utf8"),
    ]);

  assert.match(dateInput, /dd\/mm\/aaaa/);
  assert.match(dateInput, /Janeiro/);
  assert.match(dateInput, /inputMode="numeric"/);
  assert.match(dateInput, /date-picker-popover/);
  assert.doesNotMatch(dateInput, /type="date"/);
  assert.doesNotMatch(app, /type="date"/);
  assert.doesNotMatch(portal, /type="date"/);
  assert.match(app, /function lodgingNightOptions/);
  assert.match(app, /calendarDays \+ 0\.5/);
  assert.match(app, /Opções compatíveis com o período/);
  assert.match(
    appointments,
    /lodgingNights !== durationDays \+ 0\.5/,
  );
  assert.match(invoices, /startDate: appointments\.startDate/);
  assert.match(invoices, /endDate: appointments\.endDate/);
  assert.match(dateInput, /Digite uma data válida no formato dd\/mm\/aaaa/);
});

test("mantém cadastros seguros, práticos e sem menus redundantes", async () => {
  const [app, dogRoute, customerRoute, taskRoute] =
    await Promise.all([
      readFile(new URL("../app/components/management-app.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/api/dogs/[id]/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/customers/[id]/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/tasks/route.ts", import.meta.url), "utf8"),
    ]);

  assert.match(app, /formatNearbyDate/);
  assert.match(app, /Inativar/);
  assert.doesNotMatch(app, /Importar CSV/);
  assert.doesNotMatch(app, /id: "agenda", label: "Agenda"/);
  assert.match(app, /Limpar concluídas/);
  assert.match(app, /name="sex"/);
  assert.match(app, /name="neutered"/);
  assert.match(dogRoute, /dog_has_history/);
  assert.match(dogRoute, /requireIdentity\(request, \["owner"\]\)/);
  assert.match(customerRoute, /customer_has_history/);
  assert.match(taskRoute, /tasks\.completed_cleared/);
});

test("mantém o primeiro acesso e o login protegidos sem bloqueio global da conta", async () => {
  const [setup, login, limiter, passwordAuth, schema] = await Promise.all([
    readFile(new URL("../app/api/auth/setup/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../lib/server/login-rate-limit.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/server/password-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);

  assert.match(setup, /administrators\.length !== 2/);
  assert.match(setup, /setupKeyMatches/);
  assert.match(setup, /NOT EXISTS \(SELECT 1 FROM admin_credentials\)/);
  assert.match(login, /reserveLoginAttempt/);
  assert.doesNotMatch(login, /adminCredentials\.lockedUntil/);
  assert.match(limiter, /MAX_ATTEMPTS_PER_IP = 30/);
  assert.match(limiter, /MAX_ATTEMPTS_PER_IP_AND_EMAIL = 6/);
  assert.match(limiter, /cf-connecting-ip/);
  assert.match(passwordAuth, /HMAC/);
  assert.match(passwordAuth, /login-rate-limit/);
  assert.match(
    passwordAuth,
    /PBKDF2_MAX_ITERATIONS_PER_DERIVATION = 100_000/,
  );
  assert.match(
    passwordAuth,
    /Math\.min\(\s*remainingIterations,\s*PBKDF2_MAX_ITERATIONS_PER_DERIVATION,/s,
  );
  assert.match(schema, /sqliteTable\(\s*"auth_login_rate_limits"/);
});

test("preserva as regras de faturas, sinais e créditos", async () => {
  const [invoices, payments, reversePayment, settlement, consume, purchases, prices, workspaceData, managementApp, invoiceNotes, invoiceNotesMigration, schema, serviceRules, creditPricing, creditPricingMigration, appointments, groomingAddonMigration] = await Promise.all([
    readFile(new URL("../app/api/invoices/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/invoices/[id]/payments/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/api/invoices/[id]/payments/reverse/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/invoices/[id]/settlement/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/credits/consume/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/credit-purchases/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/settings/prices/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/workspace-data.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/components/management-app.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/invoices/[id]/note/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../drizzle/0012_invoice_internal_notes.sql", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/service-rules.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/credit-pricing.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0017_credit_pricing.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/appointments/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0018_bath_grooming_addon.sql", import.meta.url), "utf8"),
  ]);

  assert.match(invoices, /active_invoice_id = \?/);
  assert.match(invoices, /lockResultIndex/);
  assert.match(invoices, /lodging_deposit_already_invoiced/);
  assert.match(invoices, /invoiceServiceName: "Sinal da hospedagem"/);
  assert.match(invoices, /FAT-/);
  assert.doesNotMatch(invoices, /pix/i);
  assert.match(payments, /invoice\.payment_recorded/);
  assert.match(payments, /confirmingLinkedSettlement/);
  assert.match(payments, /scheduledSettlement!\.financialAccountId!/);
  assert.ok(
    payments.indexOf("const paymentStatementIndex") <
      payments.indexOf("settlementConfirmationIndex = statements.length"),
  );
  assert.match(
    payments,
    /WHERE id = \? AND invoice_id = invoice_settlements\.invoice_id[\s\S]*AND status = 'active'/,
  );
  assert.match(
    payments,
    /WHERE id = \? AND invoice_id = invoices\.id AND status = 'confirmed'/,
  );
  assert.match(managementApp, /A confirmação será registrada na mesma conta/);
  assert.match(managementApp, /compensationFinancialAccountId/);
  assert.match(workspaceData, /compensationFinancialAccountName/);
  assert.match(invoices, /applyLongStayDiscount/);
  assert.doesNotMatch(payments, /withoutLongStayDiscount/);
  assert.match(payments, /Créditos liberados após pagamento da fatura/);
  assert.match(payments, /settlement_method = 'invoice'/);
  assert.match(payments, /service_name_snapshot <> 'Sinal da hospedagem'/);
  assert.match(reversePayment, /invoice\.payment_reversed/);
  assert.match(reversePayment, /status = 'reversed'/);
  assert.match(settlement, /invoice\.settlement_updated/);
  assert.match(settlement, /invoice\.settlement_cancelled/);
  assert.doesNotMatch(invoices, /payment_preference = 'invoice'/);
  assert.doesNotMatch(consume, /payment_preference = 'credit'/);
  assert.doesNotMatch(consume, /credit_not_selected/);
  assert.match(consume, /Conclua o atendimento antes de decidir usar créditos/);
  assert.match(consume, /taxi_dog/);
  assert.match(consume, /creditUnitsForServiceCode/);
  assert.match(serviceRules, /direction === "round_trip" \? 2 : 1/);
  assert.match(creditPricing, /daycareUnder4UnitCents: 6_500/);
  assert.match(creditPricing, /daycare12PlusUnitCents: 5_600/);
  assert.match(creditPricing, /bath4PlusDaycareUnitCents: 5_000/);
  assert.match(creditPricing, /daycareMultiDogDiscountPercent: 15/);
  assert.match(creditPricing, /direction === "round_trip" \? oneWay \* 2 : oneWay/);
  assert.match(creditPricingMigration, /billing_pricing_profile/);
  assert.match(consume, /eq\(serviceCatalog\.code, "bath_grooming"\)/);
  assert.match(consume, /grooming_addon_after_bath_credit/);
  assert.match(consume, /description_snapshot, details_json, unit_price_cents/);
  assert.match(consume, /chargeCreated: groomingAddon/);
  assert.doesNotMatch(purchases, /bath_grooming/);
  assert.match(appointments, /service_not_schedulable/);
  assert.match(appointments, /groomingAddon \? "Banho e tosa"/);
  assert.match(prices, /bathGroomingAddonCents/);
  assert.match(groomingAddonMigration, /bath_grooming_addon_cents/);
  assert.match(consume, /\) >= \?/);
  assert.match(purchases, /default_price_required/);
  assert.match(prices, /value < 1/);
  assert.match(prices, /daycareStartTime/);
  assert.match(workspaceData, /id: `deposit:\$\{item\.id\}`/);
  assert.match(workspaceData, /id: `balance:\$\{item\.id\}`/);
  assert.match(workspaceData, /Fature e registre o sinal antes de cobrar o saldo/);
  assert.match(managementApp, /function creditUnitsForService/);
  assert.match(managementApp, /onUseCredits/);
  assert.match(managementApp, /Cobrança decidida depois/);
  assert.match(managementApp, /booking\.serviceType !== "transport"/);
  assert.match(managementApp, /agenda-card[\s\S]*without-time/);
  assert.doesNotMatch(managementApp, /Usará 1 crédito ao concluir/);
  assert.match(managementApp, /Adicionar nota/);
  assert.match(managementApp, /invoice-entry-note-editor/);
  assert.match(workspaceData, /internalNote: invoice\.internalNote/);
  assert.match(workspaceData, /packageNameSnapshot\)\.includes\(compact\(creditDetail\)\)/);
  assert.match(invoiceNotes, /requireIdentity\(request, \["owner", "finance"\]\)/);
  assert.match(invoiceNotes, /invoice\.note_updated/);
  assert.match(invoiceNotesMigration, /ADD COLUMN internal_note text/);
  assert.match(schema, /invoice_payments_invoice_active_unique/);
  assert.match(schema, /invoice_settlements_invoice_scheduled_unique/);
});

test("impede serviços duplicados e hospedagens sobrepostas no banco", async () => {
  const [createRoute, batchRoute, editRoute, schema, migration, conflicts, app] =
    await Promise.all([
      readFile(new URL("../app/api/appointments/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/appointments/batch/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/appointments/[id]/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
      readFile(new URL("../drizzle/0021_appointment_conflicts.sql", import.meta.url), "utf8"),
      readFile(new URL("../lib/server/appointment-conflicts.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/components/management-app.tsx", import.meta.url), "utf8"),
    ]);

  assert.match(schema, /appointments_active_service_day_unique/);
  assert.match(schema, /primaryServiceCatalogId/);
  assert.match(migration, /appointments_prevent_lodging_overlap_insert/);
  assert.match(migration, /appointments_prevent_lodging_overlap_update/);
  assert.match(migration, /row_number\(\) OVER/);
  for (const route of [createRoute, batchRoute, editRoute]) {
    assert.match(route, /primaryServiceCatalogId|primary_service_catalog_id/);
    assert.match(route, /rethrowAppointmentConflict/);
  }
  assert.match(conflicts, /duplicate_appointment/);
  assert.match(conflicts, /lodging_overlap/);
  assert.match(app, /busyActionRef\.current/);
  assert.match(app, /disabled=\{busyAction\?\.startsWith\("new-service:"\)\}/);
});

test("mantém o manual e os detalhes das faturas disponíveis", async () => {
  const [app, workspace, manual, migration] = await Promise.all([
    readFile(
      new URL("../app/components/management-app.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/manual-administradores.md", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0005_final_invoice_workflow.sql", import.meta.url), "utf8"),
  ]);

  assert.match(app, /fatura-\$\{customer/);
  assert.match(app, /line\.dogName/);
  assert.match(app, /manual-hospet-quintal\.pdf/);
  assert.match(workspace, /invoiceItemRows/);
  assert.match(workspace, /dogNameSnapshot/);
  assert.match(manual, /Fluxo recomendado/);
  assert.match(migration, /DROP TABLE IF EXISTS `pix_charges`/);
  assert.match(migration, /CREATE TABLE `invoice_payments`/);
});

test("separa acessos, protege o portal e registra pedidos dos clientes", async () => {
  const [users, invitations, adminReset, portal, requests, workspace, app, schema, migration] =
    await Promise.all([
      readFile(new URL("../app/api/users/route.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../app/api/auth/invitations/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/api/users/[id]/password-reset/route.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(new URL("../app/api/portal/route.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../app/api/portal/requests/route.ts", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../app/components/management-app.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
      readFile(
        new URL(
          "../drizzle/0006_accounts_and_customer_portal.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

  assert.match(users, /requireIdentity\(request, \["owner"\]\)/);
  assert.match(users, /hashSessionToken\(oneTime\.token\)/);
  assert.match(invitations, /status = 'accepted'/);
  assert.match(invitations, /destination: invitation\.role === "customer"/);
  assert.match(adminReset, /requireIdentity\(request, \["owner"\]\)/);
  assert.match(adminReset, /resetUrl: actionUrl\.toString\(\)/);
  assert.match(portal, /requireIdentity\(request, \["customer"\]\)/);
  assert.match(portal, /eq\(dogs\.accountId, context\.accountId\)/);
  assert.match(requests, /customer\.request_created/);
  assert.match(workspace, /identity\.role === "staff"/);
  assert.match(workspace, /cpf: identity\.role === "owner"/);
  assert.match(app, /signedInRole === "owner"/);
  assert.match(app, /Pedidos dos clientes/);
  assert.match(schema, /sqliteTable\(\s*"account_invitations"/);
  assert.match(schema, /sqliteTable\(\s*"customer_requests"/);
  assert.match(migration, /CREATE TABLE `password_reset_tokens`/);
});

test("mantém histórico descritivo, indicadores recentes e horários flexíveis", async () => {
  const [app, workspace, activities, auditLog, appointments, appointmentEdit] =
    await Promise.all([
      readFile(new URL("../app/components/management-app.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/activities/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/server/audit-log.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/appointments/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/appointments/[id]/route.ts", import.meta.url), "utf8"),
    ]);

  assert.match(app, /Últimos 5 dias/);
  assert.match(app, /Consultar outro período/);
  assert.match(app, /Aguardando pagamento/);
  assert.match(app, /Todo o dia/);
  assert.match(app, /Manhã/);
  assert.match(app, /Tarde/);
  assert.match(app, /Noite/);
  assert.match(workspace, /receivedLast30DaysCents/);
  assert.match(workspace, /loadAuditLog/);
  assert.match(activities, /rangeDays > 365/);
  assert.match(auditLog, /subjectName/);
  assert.match(auditLog, /recipient_name_snapshot/);
  assert.match(appointments, /manha\|tarde\|noite/);
  assert.match(appointmentEdit, /manha\|tarde\|noite/);
});

test("mantém a política de hospedagem clara e auditável", async () => {
  const [app, createAppointment, editAppointment, regularBilling, invoices, payments, settings, schema, migration] =
    await Promise.all([
      readFile(new URL("../app/components/management-app.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/api/appointments/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/appointments/[id]/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/appointment-items/[id]/billing/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/invoices/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/invoices/[id]/payments/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/settings/prices/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
      readFile(new URL("../drizzle/0010_lodging_pricing.sql", import.meta.url), "utf8"),
    ]);

  assert.match(app, /cliente de creche regular/);
  assert.match(app, /segundo cão ou mais/);
  assert.match(app, /Condição da diária para calcular o sinal/);
  assert.match(app, /A condição da diária será definida em Cobranças/);
  assert.match(app, /Defina a condição da diária em Regular/);
  assert.match(app, /lodging_\$\{currentLodgingProfile\}/);
  assert.doesNotMatch(app, /name="price"/);
  assert.doesNotMatch(createAppointment, /body\.priceCents/);
  assert.doesNotMatch(editAppointment, /requestedPriceCents/);
  assert.match(createAppointment, /service\.code === "hotel" && depositPercent !== null/);
  assert.match(editAppointment, /service\.code === "hotel" && depositPercent !== null/);
  assert.match(regularBilling, /parseLodgingRateProfile/);
  assert.match(regularBilling, /SET lodging_rate_profile = \?/);
  assert.match(regularBilling, /lodging_rate_required/);
  assert.match(app, /Não aplicar desconto por longa estadia/);
  assert.match(createAppointment, /lodging_rate_profile/);
  assert.match(editAppointment, /lodgingRateProfile/);
  assert.match(invoices, /hotelLongStayDiscountPercent/);
  assert.match(invoices, /lodging_long_stay_discount_cents/);
  assert.match(invoices, /applyLongStayDiscount !== false/);
  assert.doesNotMatch(payments, /withoutLongStayDiscount/);
  assert.match(app, /Desconto de longa estadia de \$\{longStayDiscountPercent\}% aplicado/);
  assert.match(app, /Desconto por longa estadia/);
  assert.match(settings, /hotelDaycareAdditionalDogDailyRateCents/);
  assert.match(schema, /hotel_long_stay_discount_percent/);
  assert.match(migration, /lodging_long_stay_discount_cents/);
});

test("unifica faturas abertas com reversão segura e auditável", async () => {
  const [app, mergeRoute, unmergeRoute, voidRoute, paymentRoute, workspace, schema, migration, data] =
    await Promise.all([
      readFile(new URL("../app/components/management-app.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/api/invoices/merge/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/invoices/[id]/unmerge/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/invoices/[id]/void/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/invoices/[id]/payments/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
      readFile(new URL("../drizzle/0013_invoice_merges.sql", import.meta.url), "utf8"),
      readFile(new URL("../lib/workspace-data.ts", import.meta.url), "utf8"),
    ]);

  assert.match(app, /Unificar selecionadas/);
  assert.match(app, /Desfazer união/);
  assert.match(app, /Créditos serão liberados somente quando/);
  assert.doesNotMatch(app, /invoice\.sourceType !== "credit_package"/);
  assert.match(mergeRoute, /requireIdentity\(request, \["owner", "finance"\]\)/);
  assert.match(mergeRoute, /sourceType === "credit_package"/);
  assert.match(mergeRoute, /purchaseByInvoice/);
  assert.match(mergeRoute, /previousMergeRows/);
  assert.match(app, /Consolidar abertas por cliente/);
  assert.match(mergeRoute, /invoice_payments/);
  assert.match(mergeRoute, /status\s*=\s*'active'/);
  assert.match(mergeRoute, /invoice_settlements/);
  assert.match(mergeRoute, /await d1\.batch\(statements\)/);
  assert.match(unmergeRoute, /status = 'reversed'/);
  assert.match(unmergeRoute, /status = 'active'/);
  assert.match(unmergeRoute, /faturas originais restauradas/);
  assert.match(unmergeRoute, /invoice_merge_sources_changed/);
  assert.match(voidRoute, /merged_invoice_requires_unmerge/);
  assert.match(paymentRoute, /mergedCreditPurchases/);
  assert.match(paymentRoute, /releasedCreditPurchaseIds/);
  assert.match(paymentRoute, /creditPurchaseGuard/);
  assert.match(workspace, /mergedSourceInvoiceIds/);
  assert.match(schema, /sqliteTable\(\s*"invoice_merges"/);
  assert.match(schema, /sqliteTable\(\s*"invoice_merge_members"/);
  assert.match(migration, /CREATE TABLE `invoice_merges`/);
  assert.match(data, /"invoice\.merged": "Faturas unificadas"/);
  assert.match(data, /"invoice\.merge_reversed": "União de faturas desfeita"/);
});

test("mantém extratos, contas, agendamento rápido e alertas operacionais coerentes", async () => {
  const [app, batchRoute, statementRoute, statementPdf, accountRoute, regularBillingRoute, schema, portal, migration] =
    await Promise.all([
      readFile(new URL("../app/components/management-app.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/api/appointments/batch/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/statements/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../lib/statement-pdf.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/financial-accounts/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/appointment-items/[id]/billing/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/portal/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../drizzle/0015_financial_accounts.sql", import.meta.url), "utf8"),
    ]);

  assert.match(app, /Agendamento rápido/);
  assert.match(app, /Possivelmente esquecidos/);
  assert.match(app, /\(booking\.endDate \?\? booking\.date\) < operationalToday/);
  assert.match(app, /Cobrança regular/);
  assert.match(app, /Confirmar e incluir/);
  assert.match(app, /Próximos de renovar/);
  assert.match(app, /Emitir extrato do cliente/);
  assert.match(batchRoute, /mixed_customers/);
  assert.match(batchRoute, /lodging_requires_individual_booking/);
  assert.match(batchRoute, /await d1\.batch\(statements\)/);
  assert.match(statementRoute, /openingBalanceCents/);
  assert.match(statementRoute, /closingBalanceCents/);
  assert.match(statementRoute, /chargesInPeriodCents/);
  assert.match(statementRoute, /paymentsInPeriodCents/);
  assert.match(statementRoute, /Math\.max\(0, -runningBalanceCents\)/);
  assert.match(statementRoute, /inArray\(invoices\.status, \["issued", "paid"\]\)/);
  assert.match(statementRoute, /identity\.role === "customer"/);
  assert.match(statementPdf, /Pagamento recebido/);
  assert.match(statementPdf, /Crédito a favor do cliente/);
  assert.doesNotMatch(statementPdf, /`− \$\{money\(entry\.creditCents\)\}`/);
  assert.match(app, /Pagamentos recebidos/);
  assert.match(accountRoute, /requireIdentity\(request, \["owner", "finance"\]\)/);
  assert.match(regularBillingRoute, /billing\.regular_selected/);
  assert.match(regularBillingRoute, /billing_item_locked/);
  assert.match(regularBillingRoute, /active_invoice_id IS NULL/);
  assert.match(schema, /sqliteTable\(\s*"financial_accounts"/);
  assert.match(portal, /eq\(customerAccounts\.status, "active"\)/);
  assert.match(migration, /financial_account_id/);
});
