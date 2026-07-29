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
  assert.match(layout, /Gestão Canina/);
  assert.match(layout, /\/favicon\.svg/);
  assert.match(page, /<ManagementApp \/>/);
  assert.match(app, /Ambiente privado/);
  assert.match(app, /Demonstração segura/);
  assert.match(app, /\/api\/workspace/);
  assert.match(app, /Cloudflare/);
  assert.match(app, /Novo serviço/);
  assert.match(app, /Cobranças Pix/);
  assert.match(app, /Pacotes e créditos/);
  assert.match(app, /Pagamento exclusivo por Pix/);
  assert.match(app, /código não é válido para pagamento/);
  assert.match(data, /@example\.com/);
  assert.doesNotMatch(app, /Mastercard|VISA|cart[aã]o de cr[eé]dito/);
  assert.match(styles, /\.billing-page\s*\{[^}]*min-width:\s*0;/s);
  assert.match(styles, /\.billing-page\s*>\s*\*\s*\{[^}]*min-width:\s*0;/s);
});

test("mantém dados operacionais fora do repositório público", async () => {
  const [gitignore, schema, pixRoute, hosting] = await Promise.all([
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/pix/charges/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);

  assert.match(gitignore, /\.dev\.vars\*/);
  assert.match(gitignore, /\*\.sqlite/);
  assert.match(gitignore, /\/exports\//);
  assert.match(schema, /sqliteTable\(\s*"audit_events"/);
  assert.match(schema, /sqliteTable\(\s*"pix_charges"/);
  assert.match(schema, /amount_cents/);
  assert.match(pixRoute, /pix_provider_not_configured/);
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
    assert.match(route, /auditEvents/);
  }
  assert.match(invoices, /audit_events/);
  assert.match(credits, /audit_events/);
  assert.doesNotMatch(auth, /oai-authenticated-user-email/);
  assert.doesNotMatch(auth, /cf-access-jwt-assertion/);
  assert.doesNotMatch(auth, /NODE_ENV/);
  assert.match(nextConfig, /frame-ancestors 'none'/);
  assert.match(nextConfig, /private, no-store/);
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
  assert.match(schema, /sqliteTable\(\s*"auth_login_rate_limits"/);
});

test("preserva as regras financeiras de Pix e créditos", async () => {
  const [invoices, consume, purchases, prices] = await Promise.all([
    readFile(new URL("../app/api/invoices/route.ts", import.meta.url), "utf8"),
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
  ]);

  assert.match(invoices, /active_invoice_id = \?/);
  assert.match(invoices, /results\[0\]\.meta\.changes/);
  assert.match(consume, /payment_preference = 'credit'/);
  assert.match(consume, /credit_not_selected/);
  assert.match(purchases, /default_price_required/);
  assert.match(prices, /value < 1/);
});
