# Hospet Quintal

Ferramenta de operação para creche, hospedagem, banho, banho e tosa e Taxi-dog.
A interface está em português brasileiro e foi pensada para administradores,
funcionários e clientes, cada um com acesso somente ao que precisa.

## Estado atual

Este repositório entrega:

- painel responsivo com agenda, presença, alertas e tarefas;
- consulta de datas futuras diretamente na tela principal;
- cadastros e perfis editáveis de cães e clientes;
- preços e horários padrão administráveis;
- venda de pacotes, saldos de créditos por serviço e recibos sem nova cobrança;
- faturas em PDF detalhadas por cão, compartilháveis pelo menu do aparelho;
- sinal e saldo de hospedagem, com abatimento automático do valor recebido;
- ambiente operacional conectado ao D1 privado, com demonstração fictícia
  apenas como apoio no desenvolvimento local;
- configuração inicial protegida para exatamente dois administradores e login
  obrigatório nas visitas seguintes;
- convites individuais para funcionários e clientes, recuperação de senha,
  encerramento imediato de acesso e portal privado do cliente;
- histórico global identificado por pessoa e fila de pedidos de serviços ou
  cancelamentos enviados pelo portal;
- modelo D1 para agenda, recorrências, créditos, faturas, pagamentos,
  auditoria e metadados de arquivos privados;
- APIs iniciais com autorização no servidor, proteção de origem, limites de
  payload e respostas sem cache;
- arquitetura implantável em Cloudflare Workers, D1 e R2.

Todos os dados visíveis na demonstração são sintéticos. Eles ficam no código
apenas para mostrar a experiência e nunca devem ser substituídos por dados
reais.

## Regra de cobrança

O sistema gera a fatura em PDF, mas não processa o pagamento. Depois de receber
o valor pelo meio combinado com o cliente, um administrador registra a data do
pagamento. Pacotes de créditos são liberados somente nessa confirmação.

## Onde cada informação fica

| Conteúdo | Local |
|---|---|
| Código, estilos e migrações | GitHub público |
| Clientes, cães, agenda e financeiro | Cloudflare D1 privado |
| Fotos e documentos | Cloudflare R2 privado |
| Segredos de acesso | Secrets da Cloudflare |
| Dados fictícios do protótipo | `lib/demo-data.ts` |

Dados de clientes, exports, bancos locais, uploads, backups e arquivos de
segredo são bloqueados pelo `.gitignore`.

## Execução local

Pré-requisitos: Node.js 22.13 ou superior e pnpm.

```bash
pnpm install
pnpm dev:next
```

Abra `http://localhost:3000`. Sem um binding D1 local, o comando `dev:next`
mostra automaticamente a demonstração sem persistência. Para testar o runtime
Cloudflare em um sistema compatível:

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
| `INITIAL_SETUP_KEY` | Chave secreta usada uma única vez no primeiro acesso |
| `AUTH_PASSWORD_PEPPER` | Segredo adicional da derivação das senhas |
| `POSTMARK_SERVER_TOKEN` | Token opcional para envio automático de convites |
| `AUTH_EMAIL_FROM` | Remetente verificado usado nos e-mails de acesso |

O endereço do site pode ser público porque as páginas de gestão exigem a sessão
própria. Cabeçalhos externos de identidade não são aceitos nesta versão: o
os dois administradores iniciais controlam os convites de outras contas.

## Inicialização do banco

O esquema fica em `db/schema.ts` e as migrações em `drizzle/`.

Depois de aplicar as migrações ao D1, o primeiro acesso mostra uma configuração
única. A pessoa informa a chave secreta de ativação, o nome do estabelecimento
e os dados de exatamente dois administradores. A operação cria a unidade, as
duas contas e o catálogo básico de serviços em um único lote. Ela não insere
clientes ou cães fictícios.

Depois dessa configuração, o cadastro inicial é encerrado e todo acesso exige
e-mail e senha próprios. Os administradores podem convidar funcionários e
clientes; links de convite são de uso único e expiram em 48 horas. As senhas usam PBKDF2-SHA256,
salt individual, pepper externo e 310 mil iterações. As sessões duram 12 horas,
usam cookie `HttpOnly`, `Secure` e `SameSite=Lax`, e somente o hash do token é
armazenado no D1. Tentativas de login são limitadas por IP e por combinação de
IP/e-mail; os identificadores desses contadores ficam protegidos por HMAC.

## Segurança e privacidade

Antes de usar dados reais, confirme no ambiente implantado:

1. configurar `INITIAL_SETUP_KEY` e `AUTH_PASSWORD_PEPPER` como secrets;
2. manter ambientes de produção, prévia e desenvolvimento separados;
3. aplicar as migrações ao D1 e testar restauração;
4. configurar R2 privado e validação de upload;
5. habilitar proteção de secrets e push protection no GitHub;
6. revisar retenção, avisos e solicitações de titulares conforme a LGPD.

Consulte [SECURITY.md](./SECURITY.md) para os limites atuais e o procedimento
em caso de segredo publicado.

## Estrutura principal

```text
app/
  api/                 APIs protegidas
  components/          interface administrativa
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
