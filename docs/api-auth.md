# Contrato da autenticação administrativa

As quatro rotas usam respostas `private, no-store`. As mutações exigem mesma
origem. O navegador não recebe hashes, salt, pepper nem identificadores de
sessão armazenados no banco.

## Estado

`GET /api/auth/status`

```json
{
  "setupRequired": false,
  "authenticated": true,
  "identity": {
    "email": "admin@example.com",
    "displayName": "Administração",
    "role": "owner"
  },
  "sessionExpiresAt": "2026-07-30T15:00:00.000Z"
}
```

`identity` e `sessionExpiresAt` são omitidos quando `authenticated` é `false`.

## Configuração inicial

`POST /api/auth/setup`

```json
{
  "setupKey": "chave inicial recebida por canal seguro",
  "establishmentName": "Nome da unidade",
  "administrators": [
    {
      "displayName": "Administrador 1",
      "email": "admin1@example.com",
      "password": "senha longa e exclusiva"
    },
    {
      "displayName": "Administrador 2",
      "email": "admin2@example.com",
      "password": "outra senha longa e exclusiva"
    }
  ]
}
```

A rota aceita exatamente dois administradores, com e-mails e senhas
distintos. Ela só grava dados quando ainda não existe credencial
administrativa. Se houver uma única unidade criada por uma versão anterior,
ela é preservada junto com os dados operacionais; acessos antigos sem
credencial são desativados. Unidade, dois proprietários, credenciais, catálogo
padrão, sessão do primeiro proprietário e auditoria são confirmados em um único
lote atômico. A resposta usa o mesmo formato autenticado da rota de estado.

## Entrada

`POST /api/auth/login`

```json
{
  "email": "admin1@example.com",
  "password": "senha longa e exclusiva"
}
```

Sucesso retorna `authenticated: true` e `identity`. Falha usa sempre
`401 invalid_credentials`, sem revelar se o e-mail existe ou se a conta está
temporariamente limitada. Cada tentativa conta em uma janela de 15 minutos:
até 30 por IP e até 6 por combinação de IP e e-mail. O bloqueio não é global
por conta, evitando que uma pessoa externa impeça os administradores de entrar
de outras origens. As chaves desses contadores usam HMAC e não guardam IP ou
e-mail em texto.

## Saída

`POST /api/auth/logout`

```json
{ "loggedOut": true }
```

A rota revoga a sessão encontrada e expira o cookie, sendo segura para repetir.

## Segredos obrigatórios

- `INITIAL_SETUP_KEY`: chave aleatória de pelo menos 24 bytes, usada uma única
  vez e comparada de modo resistente a diferenças de tempo.
- `AUTH_PASSWORD_PEPPER`: segredo aleatório de pelo menos 32 bytes, mantido
  apenas no ambiente de execução.

As senhas usam PBKDF2-HMAC-SHA-256 com salt aleatório de 128 bits, pepper e
310.000 iterações. O cookie `__Host-gestao_session` é `HttpOnly`, `Secure`,
`SameSite=Lax`, tem `Path=/` e dura 12 horas. Somente o SHA-256 do token opaco
é armazenado no D1.
