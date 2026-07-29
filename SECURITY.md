# Segurança

## Uso permitido nesta versão

Esta versão é adequada para demonstração com dados fictícios. Ela não deve
receber dados pessoais reais até que autenticação, D1, R2 e as políticas do
ambiente estejam conectados e revisados.

## Controles já presentes

- nenhum segredo ou dado real no repositório;
- `.env*`, `.dev.vars*`, bancos locais, exports, uploads e backups ignorados;
- valores financeiros em centavos inteiros;
- autorização no servidor para APIs operacionais;
- validação criptográfica do JWT do Cloudflare Access quando usado;
- verificação de mesma origem em mutações da aplicação;
- limite de tamanho e validação básica de JSON;
- respostas pessoais com `private, no-store`;
- headers de segurança no aplicativo;
- trilha de auditoria no modelo de dados;
- R2 previsto como privado;
- Pix real desativado sem adaptador oficial.

## Requisitos antes da produção

- Cloudflare Access com lista explícita de usuários e MFA para a equipe;
- endpoint direto do Worker desabilitado ou igualmente protegido;
- ambientes e bindings separados para produção, prévia e desenvolvimento;
- rate limiting no edge;
- política de upload com limite, MIME real, magic bytes, checksum, remoção de
  EXIF/GPS e quarentena;
- recuperação D1 testada e backups conforme a retenção definida;
- adaptador Pix com assinatura ou mTLS, idempotência e conciliação;
- testes de autorização por registro para equipe e clientes;
- política de retenção, atendimento de direitos e contratos LGPD.

## Pix

O retorno do navegador nunca pode marcar uma cobrança como paga. Apenas um
webhook autenticado e conciliado com `txid`, `endToEndId`, recebedor, valor e
estado pode confirmar o pagamento. Eventos repetidos ou fora de ordem não
podem duplicar um recebimento nem fazer o estado regredir.

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
