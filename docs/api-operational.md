# Contratos da API operacional

Esta API usa a identidade privada fornecida pelo Sites ou pelo Cloudflare
Access. O navegador não deve montar cabeçalhos de identidade. Todas as
respostas são privadas, sem cache, e erros seguem o formato:

```json
{
  "error": {
    "code": "codigo_estavel",
    "message": "Mensagem pronta para a interface",
    "requestId": "uuid"
  }
}
```

Requisições que alteram dados exigem `Content-Type: application/json` e passam
por uma verificação de mesma origem.

## Carregar a área administrativa

`GET /api/workspace?from=YYYY-MM-DD&to=YYYY-MM-DD`

- `from` é opcional e usa hoje no fuso da unidade.
- `to` é opcional e usa 30 dias depois de `from`.
- O intervalo máximo é de 94 dias, incluindo as duas pontas.
- Perfis aceitos: proprietário, equipe e financeiro.

Antes da primeira configuração:

```json
{
  "status": "onboarding",
  "identity": {
    "email": "responsavel@exemplo.com",
    "displayName": "Responsável",
    "role": "owner"
  },
  "onboarding": {
    "required": true,
    "canInitialize": true
  }
}
```

Depois da configuração, `status` é `ready`. A resposta reúne:

- `establishment`: unidade e fuso;
- `serviceCatalog`: serviços e preços;
- `customers`: contas com os respectivos `tutors`;
- `dogs`: cães e vínculos com responsáveis;
- `agenda`: agendamentos no período, cada um com `items`;
- `tasks`: tarefas operacionais;
- `billing.invoices`: cobranças;
- `billing.creditPackages`: pacotes disponíveis;
- `billing.creditPurchases`: compras de créditos;
- `billing.creditBalances`: saldo por cliente e serviço;
- `billing.creditReceipts`: recibos emitidos quando um crédito foi usado.

O cliente pode trocar apenas `from` e `to` para navegar para dias futuros sem
recarregar todos os recursos por endpoints separados.

## Cadastrar cliente

`POST /api/customers`

Perfis aceitos: proprietário e equipe.

```json
{
  "displayName": "Marina Costa",
  "fullName": "Marina Costa",
  "email": "marina@example.com",
  "phone": "(11) 99999-9999",
  "whatsappEnabled": true,
  "isFinancialContact": true,
  "addressLine": "Rua Exemplo, 123",
  "addressCity": "São Paulo",
  "addressRegion": "SP",
  "addressPostalCode": "01234-567"
}
```

`displayName` é obrigatório. Deve existir pelo menos um contato entre `email`
e `phone`. Um telefone brasileiro é normalizado para E.164 (`+55...`).
`fullName` usa `displayName` quando omitido. O endpoint cria a conta e o
primeiro responsável no mesmo lote e retorna `201`.

Contatos já ligados a outro cliente retornam `409 customer_contact_exists`.

## Cadastrar cão

`POST /api/dogs`

Perfis aceitos: proprietário e equipe.

```json
{
  "accountId": "uuid-do-cliente",
  "name": "Nino",
  "breed": "Shih-tzu",
  "birthDate": "2022-04-10",
  "sex": "male",
  "weightKg": 7.4,
  "neutered": true,
  "vaccinesCurrent": true,
  "feedingNotes": "Ração em duas porções",
  "temperamentNotes": "Sociável",
  "healthNotes": null,
  "emergencyNotes": null,
  "primaryTutorId": "uuid-opcional"
}
```

`accountId` e `name` são obrigatórios. `sex` aceita `female`, `male` ou
`unknown`. É possível enviar `weightKg` ou `weightGrams`. Se
`primaryTutorId` não for enviado, a API usa o contato financeiro ou o contato
mais recente do cliente. O endpoint retorna `201`.

## Alterar status ou cancelar agendamento

`PATCH /api/appointments/{id}`

Perfis aceitos: proprietário e equipe.

Alteração comum:

```json
{ "status": "confirmed" }
```

Cancelamento:

```json
{
  "status": "cancelled",
  "cancellationReason": "Pedido do cliente"
}
```

Status aceitos: `scheduled`, `confirmed`, `completed` e `cancelled`.

- O fluxo normal é `scheduled` → `confirmed` → `completed`.
- `completed` e `cancelled` são finais.
- Cancelar exige motivo.
- Um serviço com cobrança ou pagamento já ligado não pode ser cancelado até a
  parte financeira ser resolvida.
- Depois da conclusão, use `POST /api/credits/consume` com
  `appointmentItemId` para quitar com créditos e preparar o recibo sem criar
  uma nova fatura.
- Repetir o status atual é seguro e devolve `idempotent: true`.

## Concluir ou reabrir tarefa

`PATCH /api/tasks/{id}`

Perfis aceitos: proprietário e equipe.

```json
{ "status": "completed" }
```

Para reabrir:

```json
{ "status": "open" }
```

Ao concluir, `completedAt` é gravado. Ao reabrir, ele volta a `null`. Repetir o
status atual é seguro. Tarefas canceladas não são reabertas por este endpoint.

## Identidade após a configuração inicial

Depois da configuração inicial, o token opaco da sessão identifica o registro
correspondente em `app_users`. A unidade, o papel e o `userId` vêm desse
cadastro persistido; cabeçalhos externos de identidade são ignorados.
