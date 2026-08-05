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
  assert.match(app, /Pacotes e créditos/);
  assert.match(app, /invoice-delivery-button/);
  assert.match(app, /navigator\.share/);
  assert.match(app, /Salvar/);
  assert.match(app, /Registrar pagamento/);
  assert.match(app, /Gerar fatura do sinal/);
  assert.match(app, /Gerar fatura do saldo/);
  assert.match(app, /Não aplicar desconto por longa estadia/);
  assert.match(app, /Total pela diária padrão/);
  assert.match(app, /Valor tabelado:/);
  assert.match(app, /lodgingTableAmountCents/);
  assert.doesNotMatch(app, /pix/i);
  assert.match(data, /@example\.com/);
  assert.doesNotMatch(app, /Mastercard|VISA|cart[aã]o de cr[eé]dito/);
  assert.match(styles, /\.billing-page\s*\{[^}]*min-width:\s*0;/s);
  assert.match(styles, /\.billing-page\s*>\s*\*\s*\{[^}]*min-width:\s*0;/s);
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
  ]);

  assert.match(schema, /sqliteTable\(\s*"cash_entries"/);
  assert.match(schema, /cashMonthStartDay/);
  assert.match(schema, /cash_entries_source_payment_unique/);
  assert.match(cashRoute, /requireIdentity\(request, \["owner"\]\)/);
  assert.match(cashRoute, /between\(cashEntries\.occurredOn/);
  assert.match(cashEntryRoute, /automatic_cash_entry_locked/);
  assert.match(cashEntryRoute, /cash\.entry_excluded/);
  assert.match(cashEntryRoute, /cash\.entry_restored/);
  assert.doesNotMatch(cashEntryRoute, /export async function DELETE/);
  assert.match(cashSettings, /min: 1/);
  assert.match(cashSettings, /max: 28/);
  assert.match(payments, /INSERT INTO cash_entries/);
  assert.match(workspace, /cashEntryId/);
  assert.match(workspace, /lodgingDailyRateCents/);
  assert.match(cashView, /Entradas consideradas/);
  assert.match(cashRoute, /credit_sold_cents/);
  assert.match(cashRoute, /ce\.status = 'included'/);
  assert.match(cashRoute, /ce\.occurred_on BETWEEN \? AND \?/);
  assert.match(cashView, /Receita recebida no período/);
  assert.match(cashView, /Créditos vendidos:/);
  assert.match(cashView, /Avulsos recebidos:/);
  assert.match(cashView, /Resultado acumulado do período/);
  assert.match(cashView, /Desconsiderar/);
  assert.match(cashView, /Configurar início do mês financeiro/);
  assert.match(app, /Considerar no Caixa/);
  assert.match(migration, /FROM `invoice_payments` ip/);
});

test("mantém perfis e navegação móveis enxutos e completos", async () => {
  const [app, styles, data, workspace] = await Promise.all([
    readFile(
      new URL("../app/components/management-app.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/workspace-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/workspace/route.ts", import.meta.url), "utf8"),
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
  assert.match(workspace, /lte\(appointments\.startDate, to\)/);
  assert.match(workspace, /gte\(appointments\.endDate, from\)/);
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
  const [app, portal, dateInput, appointments, lodgingInvoice] =
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
      readFile(
        new URL("../lib/server/lodging-invoice.ts", import.meta.url),
        "utf8",
      ),
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
  assert.match(lodgingInvoice, /displayDate\(lodging\.startDate\)/);
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
  const [invoices, payments, deposit, balance, lodgingHelper, consume, purchases, prices, workspaceData] = await Promise.all([
    readFile(new URL("../app/api/invoices/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../app/api/invoices/[id]/payments/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/appointments/[id]/deposit-invoice/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/api/appointments/[id]/balance-invoice/route.ts", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/server/lodging-invoice.ts", import.meta.url), "utf8"),
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
  ]);

  assert.match(invoices, /active_invoice_id = \?/);
  assert.match(invoices, /lockResultIndex/);
  assert.match(invoices, /lodging_deposit_already_invoiced/);
  assert.match(invoices, /invoiceServiceName: "Sinal da hospedagem"/);
  assert.match(invoices, /FAT-/);
  assert.doesNotMatch(invoices, /pix/i);
  assert.match(payments, /invoice\.payment_recorded/);
  assert.match(payments, /withoutLongStayDiscount/);
  assert.match(payments, /long_stay_discount_not_available/);
  assert.match(payments, /desconto de longa estadia não aplicado/);
  assert.match(payments, /Créditos liberados após pagamento da fatura/);
  assert.match(payments, /settlement_method = 'invoice'/);
  assert.match(payments, /service_name_snapshot <> 'Sinal da hospedagem'/);
  assert.match(deposit, /kind: "deposit"/);
  assert.match(balance, /kind: "balance"/);
  assert.match(lodgingHelper, /deposit_payment_pending/);
  assert.match(lodgingHelper, /lodging\.totalCents - depositPaidCents/);
  assert.match(consume, /payment_preference = 'credit'/);
  assert.match(consume, /credit_not_selected/);
  assert.match(consume, /taxi_dog/);
  assert.match(purchases, /default_price_required/);
  assert.match(prices, /value < 1/);
  assert.match(prices, /daycareStartTime/);
  assert.match(workspaceData, /id: `deposit:\$\{item\.id\}`/);
  assert.match(workspaceData, /id: `balance:\$\{item\.id\}`/);
  assert.match(workspaceData, /Fature e registre o sinal antes de cobrar o saldo/);
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
  assert.match(app, /signedInRole !== "owner"/);
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
  assert.match(app, /Recebido · últimos 30 dias/);
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
  const [app, createAppointment, editAppointment, invoices, payments, settings, schema, migration] =
    await Promise.all([
      readFile(new URL("../app/components/management-app.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/api/appointments/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/appointments/[id]/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/invoices/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/invoices/[id]/payments/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../app/api/settings/prices/route.ts", import.meta.url), "utf8"),
      readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
      readFile(new URL("../drizzle/0010_lodging_pricing.sql", import.meta.url), "utf8"),
    ]);

  assert.match(app, /cliente de creche regular/);
  assert.match(app, /segundo cão ou mais/);
  assert.match(app, /Não aplicar desconto por longa estadia/);
  assert.match(createAppointment, /lodging_rate_profile/);
  assert.match(editAppointment, /lodgingRateProfile/);
  assert.match(invoices, /hotelLongStayDiscountPercent/);
  assert.match(invoices, /lodging_long_stay_discount_cents/);
  assert.match(payments, /withoutLongStayDiscount/);
  assert.match(settings, /hotelDaycareAdditionalDogDailyRateCents/);
  assert.match(schema, /hotel_long_stay_discount_percent/);
  assert.match(migration, /lodging_long_stay_discount_cents/);
});
