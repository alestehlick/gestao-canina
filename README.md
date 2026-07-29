# Gestão Canina

Ferramenta de operação para creche, hospedagem, banho, tosa higiênica e
transporte de cães. A interface está em português brasileiro e foi pensada para
uso diário por uma equipe pequena.

## Estado atual

Este repositório entrega:

- painel responsivo com agenda, presença, alertas e tarefas;
- cadastros e perfis de cães e clientes;
- visão financeira, créditos e seleção de serviços para cobrança;
- fluxo Pix demonstrativo, claramente não pagável;
- prévia separada do portal do cliente;
- modelo D1 para agenda, recorrências, créditos, faturas, Pix, pagamentos,
  auditoria e metadados de arquivos privados;
- APIs iniciais com autorização no servidor, proteção de origem, limites de
  payload e respostas sem cache;
- arquitetura preparada para Cloudflare Workers, D1 e R2.

Todos os dados visíveis na demonstração são sintéticos. Eles ficam no código
apenas para mostrar a experiência e nunca devem ser substituídos por dados
reais.

## Regra de pagamento

O produto aceita **somente Pix**. Não há cartão de crédito, parcelamento nem
outra escolha de meio de pagamento.

O código Pix exibido no protótipo não é válido. Cobranças reais só poderão ser
ativadas depois da escolha de um banco ou provedor Pix e da configuração segura
das credenciais e do webhook oficial.

## Onde cada informação fica

| Conteúdo | Local |
|---|---|
| Código, estilos e migrações | GitHub público |
| Clientes, cães, agenda e financeiro | Cloudflare D1 privado |
| Fotos e documentos | Cloudflare R2 privado |
| Credenciais e chaves Pix | Secrets da Cloudflare |
| Dados fictícios do protótipo | `lib/demo-data.ts` |

Dados de clientes, exports, bancos locais, uploads, backups e arquivos de
segredo são bloqueados pelo `.gitignore`.

## Execução local

Pré-requisitos: Node.js 22.13 ou superior e pnpm.

```bash
pnpm install
pnpm dev:next
```

Abra `http://localhost:3000`. O comando `dev:next` mostra a demonstração sem
persistência. Para testar o runtime Cloudflare em um sistema compatível:

```bash
pnpm dev
```

Validações:

```bash
pnpm typecheck
pnpm lint
pnpm db:generate
pnpm test
```

## Configuração Cloudflare

Os bindings lógicos estão definidos em `.openai/hosting.json`:

- `DB`: banco D1;
- `FILES`: bucket R2 privado.

Valores sensíveis devem ser configurados como secrets ou variáveis do ambiente,
nunca em arquivos versionados:

| Variável | Finalidade |
|---|---|
| `DEFAULT_ESTABLISHMENT_ID` | Unidade usada pelo ambiente |
| `CLOUDFLARE_ACCESS_TEAM_DOMAIN` | Domínio da equipe no Cloudflare Access |
| `CLOUDFLARE_ACCESS_AUD` | Audience da aplicação Access |
| `OWNER_EMAILS` | E-mails autorizados a iniciar o ambiente |
| `PIX_PROVIDER` | Adaptador Pix escolhido |
| `PIX_WEBHOOK_SECRET` | Segredo ou referência de validação do webhook |

O painel deve permanecer atrás do Cloudflare Access. Para a equipe, a
recomendação é OTP por e-mail com lista explícita de endereços permitidos. Não
use uma política que aceite qualquer e-mail.

## Inicialização do banco

O esquema fica em `db/schema.ts` e as migrações em `drizzle/`.

Depois de aplicar as migrações ao D1, o proprietário autenticado pode chamar
`POST /api/bootstrap` uma única vez:

```json
{
  "establishmentName": "Nome do estabelecimento"
}
```

Essa operação cria a unidade, o primeiro proprietário e o catálogo básico de
serviços. Ela não insere clientes ou cães fictícios.

## Segurança e privacidade

Antes de usar dados reais:

1. proteger domínio e rotas do Worker com Cloudflare Access;
2. manter ambientes de produção, prévia e desenvolvimento separados;
3. aplicar as migrações ao D1 e testar restauração;
4. configurar R2 privado e validação de upload;
5. escolher o provedor Pix e implementar assinatura ou mTLS do webhook;
6. habilitar proteção de secrets e push protection no GitHub;
7. revisar retenção, avisos e solicitações de titulares conforme a LGPD.

Consulte [SECURITY.md](./SECURITY.md) para os limites atuais e o procedimento
em caso de segredo publicado.

## Estrutura principal

```text
app/
  api/                 APIs protegidas
  components/          interface administrativa e portal
db/
  schema.ts            modelo D1/Drizzle
lib/
  demo-data.ts         fixtures 100% fictícias
  server/              autenticação e validações
worker/
  index.ts             entrada Cloudflare Worker
```

## Observação regional

O D1 oferece criptografia em repouso e em trânsito, mas a localização primária
do banco deve ser confirmada no momento da implantação. Se os dados forem
processados fora do Brasil, registre a transferência internacional e os
controles correspondentes no processo de privacidade.
