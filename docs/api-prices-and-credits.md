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
    "taxi_dog": 500
  },
  "bathGroomingAddonCents": 3000,
  "daycareStartTime": "07:30",
  "daycareEndTime": "19:30"
}
```

O valor de `taxi_dog` representa a ida. A interface calcula ida e volta usando
duas vezes esse valor. `bathGroomingAddonCents` é o adicional aplicado quando
um banho inclui tosa.

## Venda de créditos

### `POST /api/credit-purchases`

Cria uma compra de créditos e sua fatura pendente. Os serviços aceitos são
`daycare`, `bath` e `taxi_dog`. Tosa não possui créditos próprios.

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

Para valores ainda em processamento, envie `settlementMode: "schedule"` e
`availableOn`. A compensação pode ser alterada ou cancelada com
`PATCH /api/invoices/:id/settlement`.

`POST /api/invoices/:id/payments/reverse` estorna um pagamento com motivo
obrigatório. A fatura volta a `issued`, o Caixa preserva um lançamento excluído
e créditos liberados são revertidos somente se ainda não tiverem sido usados.

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

## Agendamento e forma de quitação

O agendamento não recebe forma de pagamento. Depois que o atendimento estiver
concluído, o operador decide entre incluí-lo em uma fatura ou usar créditos.

## Conclusão usando crédito

### `POST /api/credits/consume`

Recebe `appointmentItemId` de um serviço já concluído. A operação confirma o
saldo, consome os créditos necessários e cria um recibo, tudo no mesmo lote
atômico. Nenhuma nova fatura é criada. Taxi-dog de ida consome 1 crédito; ida e
volta consome 2.

Se não houver saldo, retorna `409` com
`error.code: "insufficient_credits"` e nada é alterado.

## Hospedagem com sinal

Sinal e saldo usam o mesmo endpoint `POST /api/invoices`, com entradas
`lodging_deposit` e `lodging_balance`. Depois da confirmação, o sinal pode ser
faturado. O saldo só fica disponível após o checkout e exige que o sinal tenha
sido pago ou cancelado. O valor pago é abatido automaticamente.

## Recibos

`GET /api/credit-receipts` lista os recibos. O recibo documenta o uso de um
crédito já pago e pode ser compartilhado sem gerar outra cobrança.
