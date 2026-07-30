# Segurança

## Uso permitido nesta versão

A área administrativa pode receber dados reais somente em uma implantação
privada, autenticada e com o D1 correto ligado. Os dados operacionais não são
gravados no GitHub nem incluídos no pacote de código. A demonstração local
continua usando apenas registros fictícios.

O sistema não recebe nem processa pagamentos bancários. Ele gera faturas em
PDF e um administrador registra o recebimento somente depois de confirmá-lo
fora do sistema. Créditos antecipados não são liberados antes desse registro.

## Controles já presentes

- nenhum segredo ou dado real no repositório;
- `.env*`, `.dev.vars*`, bancos locais, exports, uploads e backups ignorados;
- valores financeiros em centavos inteiros;
- autorização no servidor para APIs operacionais;
- autenticação somente pelas duas contas administrativas locais, sem confiança
  em cabeçalhos externos de identidade;
- verificação de mesma origem em mutações da aplicação;
- limite de tamanho e validação básica de JSON;
- respostas pessoais com `private, no-store`;
- headers de segurança no aplicativo;
- trilha de auditoria no modelo de dados;
- R2 previsto como privado;
- primeiro acesso protegido por chave secreta fora do repositório;
- exatamente duas contas administrativas criadas de forma atômica;
- senhas derivadas com PBKDF2-SHA256, salt individual, pepper externo e
  310 mil iterações;
- limitação de login em janelas de 15 minutos por IP e por combinação de
  IP/e-mail, sem bloquear globalmente uma conta;
- identificadores do limitador protegidos com HMAC; IP e e-mail não são
  armazenados em texto no contador;
- sessões opacas de 12 horas com cookie `HttpOnly`, `Secure` e `SameSite=Lax`;
- pacotes de créditos concedidos apenas depois do registro administrativo do
  pagamento da fatura;
- consumo de crédito e emissão de recibo realizados de forma atômica, sem nova
  cobrança;

## Requisitos antes da produção

- secrets fortes e distintos para ativação inicial e pepper de senha;
- ambientes e bindings separados para produção, prévia e desenvolvimento;
- proteção adicional contra abuso no edge, como camada complementar ao
  limitador já aplicado pelo aplicativo;
- política de upload com limite, MIME real, magic bytes, checksum, remoção de
  EXIF/GPS e quarentena;
- recuperação D1 testada e backups conforme a retenção definida;
- confirmação operacional e conciliação periódica dos pagamentos registrados;
- testes de autorização por registro para os administradores;
- política de retenção, atendimento de direitos e contratos LGPD.

## Registro de pagamentos

Somente um administrador autenticado pode marcar uma fatura como paga. Essa
ação deve ocorrer depois da confirmação do recebimento no canal usado pelo
estabelecimento. A operação é idempotente e não pode conceder o mesmo pacote de
créditos duas vezes.

## Arquivos

O bucket R2 deve permanecer privado. As chaves dos objetos devem ser aleatórias
e não conter nome, e-mail ou telefone. Todo acesso passa por autorização e usa
URL temporária curta ou resposta autenticada. SVG e HTML enviados por usuários
devem ser rejeitados.

## Segredo publicado

Se um segredo aparecer em commit, issue, log ou artefato:

1. revogue ou rotacione o segredo imediatamente;
2. verifique acessos e ações relacionados;
3. remova-o do histórico quando necessário;
4. registre o incidente e as medidas tomadas.

Apagar apenas o texto do commit não torna o segredo seguro novamente.

## Relato de vulnerabilidade

Não abra uma issue pública com dados sensíveis, credenciais ou registros de
clientes. Use um canal privado definido pelo proprietário do repositório.
