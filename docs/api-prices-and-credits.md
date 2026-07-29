# Contratos de preços, pacotes e créditos

Todos os valores monetários são inteiros em centavos. As rotas de escrita
exigem JSON, mesma origem e uma sessão com um dos papéis indicados. As respostas
de erro seguem `{ "error": { "code", "message", "requestId" } }`.

## Preços padrão

### `GET /api/settings/prices`

Papel: `owner`.

Retorna os quatro serviços editáveis:

```json
{
  "prices": [
    {
      "id": "uuid",
      "code": "daycare",
      "name": "Creche",
      "unit": "day",
      "priceCents": 7000,
      "updatedAt": "2026-07-30T10:00:00.000Z"
    }
  ]
}
```

### `PATCH /api/settings/prices`

Papel: `owner`. Aceita atualização parcial ou dos quatro preços de uma vez.

```json
{
  "prices": {
    "hotel": 18000,
    "daycare": 7000,
    "bath": 9500,
    "hygienic_grooming": 5500
  }
}
```

## Ofertas reutilizáveis de pacotes

### `GET /api/credit-packages`

Papéis: `owner`, `staff`, `finance`. Retorna somente pacotes ativos. Para
proprietário ou financeiro, `?includeInactive=true` inclui os inativos.

Cada pacote inclui `standardValueCents` (preço padrão atual multiplicado pela
quantidade), `packagePriceCents` e `savingsCents`.

### `POST /api/credit-packages`

Papéis: `owner`, `finance`.

```json
{
  "name": "10 dias de creche",
  "serviceCode": "daycare",
  "creditUnits": 10,
  "packagePriceCents": 60000
}
```

Somente `daycare`, `bath` e `hygienic_grooming` aceitam créditos.

### `PATCH /api/credit-packages/:id`

Papéis: `owner`, `finance`. Aceita um ou mais campos:

```json
{
  "name": "10 dias de creche — fidelidade",
  "creditUnits": 10,
  "packagePriceCents": 58000,
  "active": true
}
```

## Venda de créditos

### `POST /api/credit-purchases`

Papéis: `owner`, `finance`.

Para vender um pacote cadastrado:

```json
{
  "accountId": "uuid-do-cliente",
  "packageId": "uuid-do-pacote",
  "amountCents": 58000,
  "dueDate": "2026-08-01"
}
```

`amountCents` é opcional com `packageId`: se omitido, usa o preço do pacote. Se
informado, permite o preço especial negociado nessa venda. `creditUnits` e
`packageName` também podem substituir o padrão apenas nessa compra.

Para uma venda avulsa, sem oferta cadastrada:

```json
{
  "accountId": "uuid-do-cliente",
  "serviceCode": "bath",
  "creditUnits": 5,
  "amountCents": 40000,
  "packageName": "5 banhos — pacote da Mel"
}
```

A rota cria a compra com `status: "awaiting_payment"` e uma fatura emitida. A
resposta contém:

```json
{
  "nextAction": {
    "method": "pix",
    "createChargeAt": "/api/pix/charges",
    "body": { "invoiceId": "uuid-da-fatura" }
  }
}
```

Nenhum crédito é concedido nesse momento. A interface deve criar e exibir a
cobrança Pix usando os dados de `nextAction`.

### `GET /api/credit-purchases`

Papéis: `owner`, `staff`, `finance`. Aceita `?accountId=...`.

Retorna compras, situação da fatura, valor padrão, valor cobrado e economia.

## Confirmação Pix e concessão automática

O adaptador oficial do provedor, depois de verificar assinatura ou mTLS, deve
chamar:

```ts
settleVerifiedPixPayment({
  pixChargeId,
  endToEndId,
  amountCents,
  confirmedAt,
  providerEventId,
});
```

A função está em `lib/server/pix-settlement.ts`. Ela é idempotente e executa em
um único lote atômico no D1:

1. registra o pagamento;
2. marca cobrança e fatura como pagas;
3. marca a compra como paga;
4. concede os créditos;
5. grava a auditoria.

Ela nunca deve receber diretamente um corpo enviado pelo navegador.

## Saldos

### `GET /api/credits?accountId=:id`

Papéis: `owner`, `staff`, `finance`.

Retorna saldo por serviço, inclusive zero:

```json
{
  "account": { "id": "uuid", "displayName": "Marina Souza" },
  "balances": [
    {
      "serviceCatalogId": "uuid",
      "serviceCode": "daycare",
      "serviceName": "Creche",
      "basePriceCents": 7000,
      "availableUnits": 4
    }
  ]
}
```

## Agendamento e preferência de pagamento

`POST /api/appointments` aceita `paymentPreference: "pix" | "credit"` e retorna
`itemId`, `paymentPreference` e `settlementMethod`. Crédito é aceito somente para
creche, banho e tosa higiênica.

`GET /api/dashboard?date=YYYY-MM-DD` inclui esses mesmos campos em cada item da
agenda, permitindo que a interface mostre a preferência escolhida.

## Conclusão usando crédito

### `POST /api/credits/consume`

Papéis: `owner`, `staff`.

```json
{
  "appointmentItemId": "uuid-do-item"
}
```

A operação é idempotente e atômica. Ela confirma que:

- o item pertence ao estabelecimento;
- o serviço aceita crédito;
- não há fatura Pix ligada ao item;
- o item não foi cancelado;
- existe ao menos um crédito no saldo do cliente.

Em seguida, no mesmo lote D1, consome uma unidade, conclui o item, cria um recibo
e grava a auditoria. Não cria cobrança nem fatura:

```json
{
  "consumed": true,
  "idempotent": false,
  "remainingUnits": 3,
  "receipt": {
    "id": "uuid",
    "receiptNumber": "REC-20260730-12AB34CD",
    "deliveryStatus": "pending",
    "deliveryChannelsJson": "[\"email\",\"whatsapp\"]"
  },
  "chargeCreated": false,
  "nextAction": {
    "type": "deliver_receipt",
    "channels": ["email", "whatsapp"]
  }
}
```

Se não houver saldo, retorna `409` com `error.code: "insufficient_credits"` e
nada é alterado.

## Recibos

### `GET /api/credit-receipts`

Papéis: `owner`, `staff`, `finance`. Aceita `?accountId=...`.

### `PATCH /api/credit-receipts/:id`

Papéis: `owner`, `staff`. Use depois do envio automático ou manual:

```json
{
  "deliveryStatus": "sent",
  "channels": ["whatsapp", "email"]
}
```

Também aceita `deliveryStatus: "failed"`. O recibo registra apenas o uso do
crédito; não apresenta uma nova cobrança Pix.
