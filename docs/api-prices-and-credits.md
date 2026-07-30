# Contratos de preços, faturas e créditos

Todos os valores monetários são inteiros em centavos. As rotas de escrita
exigem JSON, mesma origem e uma sessão administrativa válida. As respostas de
erro seguem `{ "error": { "code", "message", "requestId" } }`.

## Preços e horários padrão

### `GET /api/settings/prices`

Retorna os preços ativos e o horário padrão da creche.

### `PATCH /api/settings/prices`

Aceita uma atualização parcial dos preços e horários:

```json
{
  "prices": {
    "hotel": 18000,
    "daycare": 7000,
    "bath": 7000,
    "bath_grooming": 9000,
    "taxi_dog": 500
  },
  "daycareStartTime": "07:30",
  "daycareEndTime": "19:30"
}
```

O valor de `taxi_dog` representa a ida. A interface calcula ida e volta usando
duas vezes esse valor.

## Venda de créditos

### `POST /api/credit-purchases`

Cria uma compra de créditos e sua fatura pendente. Os serviços aceitos são
`daycare`, `bath`, `bath_grooming` e `taxi_dog`.

Para vender um pacote cadastrado:

```json
{
  "accountId": "uuid-do-cliente",
  "packageId": "uuid-do-pacote",
  "amountCents": 58000,
  "dueDate": "2026-08-01"
}
```

Para uma venda avulsa:

```json
{
  "accountId": "uuid-do-cliente",
  "serviceCode": "bath",
  "creditUnits": 5,
  "amountCents": 40000,
  "packageName": "5 banhos — pacote da Mel"
}
```

O valor informado pode ser especial para aquela venda. Nenhum crédito é
concedido na criação; a resposta contém a compra e a fatura a compartilhar.

### `POST /api/invoices/:id/payments`

Registra o recebimento manual de uma fatura:

```json
{
  "paidAt": "2026-08-01",
  "note": "Pagamento confirmado pelo administrador"
}
```

Quando a fatura pertence a um pacote, esta operação marca a compra como paga e
concede os créditos de forma idempotente.

### `POST /api/invoices/:id/void`

Cancela uma fatura ainda não paga. Exige um motivo e libera os itens para uma
fatura corrigida.

## Saldos

### `GET /api/credits?accountId=:id`

Retorna o saldo por serviço, inclusive zero:

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

`POST /api/appointments` aceita `paymentPreference: "invoice" | "credit"`.
Crédito é aceito somente para creche, banho, banho e tosa e Taxi-dog.

## Conclusão usando crédito

### `POST /api/credits/consume`

Recebe `appointmentItemId`. A operação confirma o saldo, consome uma unidade,
conclui o item e cria um recibo, tudo no mesmo lote atômico. Nenhuma nova fatura
é criada.

Se não houver saldo, retorna `409` com
`error.code: "insufficient_credits"` e nada é alterado.

## Hospedagem com sinal

### `POST /api/appointments/:id/deposit-invoice`

Depois da confirmação ou chegada, cria uma única fatura de sinal conforme a
porcentagem salva no agendamento.

### `POST /api/appointments/:id/balance-invoice`

Depois do checkout, cria a fatura do saldo. Se houver sinal, ele precisa estar
registrado como pago e seu valor é abatido automaticamente.

## Recibos

`GET /api/credit-receipts` lista os recibos. O recibo documenta o uso de um
crédito já pago e pode ser compartilhado sem gerar outra cobrança.
