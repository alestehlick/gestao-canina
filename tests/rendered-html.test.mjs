import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("mantém a experiência em português e explicitamente demonstrativa", async () => {
  const [layout, page, app, data] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/components/management-app.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../lib/demo-data.ts", import.meta.url), "utf8"),
  ]);

  assert.match(layout, /lang="pt-BR"/);
  assert.match(layout, /Gestão Canina/);
  assert.match(page, /<ManagementApp \/>/);
  assert.match(app, /Demonstração segura/);
  assert.match(app, /Agenda de hoje/);
  assert.match(app, /Novo serviço/);
  assert.match(app, /Cobranças Pix/);
  assert.match(app, /Pagamento exclusivo por Pix/);
  assert.match(app, /código não é válido para pagamento/);
  assert.match(data, /@example\.com/);
  assert.doesNotMatch(app, /Mastercard|VISA|cart[aã]o de cr[eé]dito/);
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
  assert.deepEqual(JSON.parse(hosting), { d1: "DB", r2: "FILES" });
});

test("protege as mutações essenciais no servidor", async () => {
  const [appointments, tasks, auth, nextConfig] = await Promise.all([
    readFile(new URL("../app/api/appointments/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/tasks/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/server/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
  ]);

  for (const route of [appointments, tasks]) {
    assert.match(route, /assertSameOrigin\(request\)/);
    assert.match(route, /requireIdentity\(request/);
    assert.match(route, /auditEvents/);
  }
  assert.match(auth, /jwtVerify/);
  assert.match(auth, /CLOUDFLARE_ACCESS_AUD/);
  assert.match(nextConfig, /frame-ancestors 'none'/);
  assert.match(nextConfig, /private, no-store/);
});
