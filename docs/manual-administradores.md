# Manual dos administradores — Hospet Quintal

## Comece por aqui

Este manual apresenta primeiro o que você precisa para trabalhar no dia a dia. As partes seguintes explicam os recursos financeiros, as configurações e os cuidados com os dados.

### 1. Entrar com segurança

No primeiro acesso, o sistema pede o cadastro de dois administradores. Cada pessoa deve usar seu próprio e-mail e uma senha diferente, com pelo menos 12 caracteres.

Depois dessa preparação, todo acesso começa pela tela de login. Não compartilhe senhas. Ao terminar o trabalho em um aparelho compartilhado, use **Sair**.

Os dados reais de clientes e cães ficam no ambiente privado da Hospet Quintal. Eles não são gravados no código público do GitHub.

### 2. Entender a tela Hoje

A tela **Hoje** é o ponto de partida. Ela mostra:

- os atendimentos do dia;
- os cães que estão no local;
- as tarefas abertas;
- aniversários do dia;
- vacinas vencidas ou com vencimento nos próximos 30 dias;
- cobranças que precisam de atenção.

Use os botões de data para consultar qualquer dia futuro sem sair da tela principal. **Ver agenda completa** abre uma visão mais ampla do dia selecionado.

### 3. Conduzir um atendimento

Cada cartão da agenda mostra o cão, o cliente, o serviço e a situação atual. Avance na ordem apresentada:

1. **Confirmar**: confirma o agendamento.
2. **Registrar chegada**: informa que o cão chegou.
3. **Concluir atendimento**: encerra o serviço.

Use **Opções** para editar ou cancelar. O cancelamento exige um motivo e permanece no histórico.

Essas mesmas ações aparecem em **Cães > Agenda e histórico** e em
**Clientes > Serviços**. Você pode trabalhar a partir da Agenda ou abrir a
ficha da pessoa ou do cão; a atualização é a mesma.

## Cadastros

### 4. Cadastrar um cliente

Abra **Clientes** e escolha **Novo cliente**. Informe nome, WhatsApp, e-mail, endereço, CPF e data de nascimento. Confira principalmente o WhatsApp e o e-mail, pois serão usados para compartilhar faturas e recibos.

O perfil do cliente reúne seus cães, serviços, faturas, créditos e recibos.

### 5. Cadastrar um cão

Abra **Cães** e escolha **Novo cão**. Vincule o cão ao cliente correto e preencha:

- nome, raça e data de nascimento;
- alimentação;
- temperamento;
- medicação;
- vacinas, com nome e data de vencimento;
- foto.

Registre informações de cuidado com frases diretas. Exemplo: “Come ração própria às 8h e às 18h”. Atualize as vacinas sempre que receber um novo comprovante.

## Agenda e serviços

### 6. Criar um serviço

Use **Novo serviço**, selecione o cão e escolha o tipo:

- **Creche**: usa os horários padrão definidos nas configurações.
- **Hospedagem**: pede entrada, saída e número de diárias.
- **Banho**.
- **Banho e tosa**.
- **Taxi-dog**: escolha ida ou ida e volta; não exige horário.

O valor sugerido vem das configurações. Um administrador pode alterá-lo para um atendimento específico sem mudar o preço padrão. Funcionários sempre usam o valor definido pela administração.

Na forma de quitação, escolha:

- **Gerar fatura**: o serviço será cobrado depois da conclusão.
- **Usar 1 crédito**: disponível para creche, banho, banho e tosa e Taxi-dog, desde que o cliente tenha saldo.

Para repetir semanalmente, escolha **Toda semana** e informe a quantidade de
semanas, entre 2 e 52. A série inteira é salva de uma vez.

Ao cancelar um dia de uma série semanal, escolha com atenção:

- **Somente este dia** mantém as outras semanas;
- **Toda a recorrência** cancela todos os agendamentos ainda abertos da série.

Atendimentos já concluídos permanecem no histórico. Se uma das semanas já tiver
fatura ou pagamento, o cancelamento global será interrompido para proteger o
financeiro; resolva essa cobrança antes de tentar novamente.

### 7. Hospedagem com sinal

Ao criar a hospedagem, informe as datas e o número de diárias em intervalos de meia diária: 1; 1,5; 2; 2,5 e assim por diante.

Se houver sinal, marque **Cobrar sinal no check-in** e informe a porcentagem. O padrão é 50%.

Fluxo recomendado:

1. Confirme a hospedagem.
2. No cartão da agenda, escolha **Gerar fatura do sinal**.
3. Compartilhe o PDF com o cliente.
4. Após receber, abra a fatura e escolha **Registrar pagamento**.
5. No checkout, conclua a hospedagem.
6. Escolha **Gerar fatura do saldo**.

O sistema desconta automaticamente o sinal pago. Se a fatura do sinal ainda estiver pendente, o saldo não será criado até que você registre o pagamento.

## Faturas e pagamentos

### 8. Criar uma fatura de serviços

Depois de concluir os serviços, abra **Cobranças > Faturas**. Selecione somente itens do mesmo cliente e escolha **Criar fatura**.

O PDF discrimina cada serviço pelo cão, com data e valor. O nome do arquivo contém o nome do cliente e o período cobrado.

### 9. Compartilhar o PDF

Na fatura, escolha uma destas opções:

- **WhatsApp**;
- **E-mail**;
- **Salvar**.

No iPhone e no Android, o sistema tenta abrir o menu normal de compartilhamento com o PDF anexado. No computador, quando o aplicativo não aceita o anexo automaticamente, o arquivo é salvo primeiro; depois, anexe-o à mensagem aberta.

Revise o destinatário e o PDF antes de confirmar o envio.

### 10. Registrar um pagamento

Quando o valor realmente tiver sido recebido:

1. Abra a fatura.
2. Confira o cliente e o total.
3. Informe a data do recebimento.
4. Escolha **Registrar pagamento**.

Não use esse botão antes de confirmar o recebimento. A fatura passará para **Pago** e os serviços serão quitados.

## Créditos pré-pagos

### 11. Vender um pacote

Abra **Cobranças > Créditos** e escolha **Vender pacote**. Selecione cliente, serviço e quantidade. Informe o valor especial do pacote; o sistema mostra a comparação com o valor padrão.

Ao confirmar, será criada uma fatura. Os créditos ainda não entram no saldo.

Depois que o cliente pagar, abra a fatura e registre o pagamento. Somente então os créditos são liberados.

### 12. Usar um crédito

Ao criar ou editar um serviço, escolha **Usar 1 crédito**. Ao concluir o atendimento:

- um crédito é retirado do saldo;
- nenhuma nova fatura é criada;
- um recibo fica disponível para compartilhar por WhatsApp ou e-mail.

Se não houver saldo suficiente, o sistema interrompe a conclusão para evitar cobrança errada.

## Pessoas e acessos

### 13. Convidar um funcionário

Abra **Acessos**, escolha **Funcionário**, informe o e-mail da pessoa e crie o convite. Se o envio automático estiver ativo, ela receberá o link por e-mail. Caso contrário, use **Copiar link** e envie por um canal particular.

O link vale por 48 horas e pode ser usado uma única vez. O funcionário escolhe o próprio nome e senha. Sua conta mostra somente a operação: Hoje, Agenda, Pedidos, Cães e Clientes. Ela não abre cobranças, configurações, histórico global nem gestão de acessos.

Cada pessoa deve usar sua própria conta. Assim, o histórico identifica quem realizou cada ação.

### 14. Convidar um cliente

Em **Acessos**, escolha **Cliente**, informe o e-mail e selecione o cadastro correto. O cliente usa o convite para criar a própria senha.

No portal, o cliente pode:

- consultar seus próximos serviços e o histórico;
- ver os próprios cães e cuidados registrados;
- consultar créditos, faturas e recibos;
- baixar suas faturas em PDF;
- pedir um serviço ou cancelamento;
- atualizar telefone e endereço.

O cliente vê somente os dados ligados ao próprio cadastro. Um pedido não reserva automaticamente uma data.

### 15. Analisar pedidos dos clientes

Abra **Pedidos**. Confira cliente, cão, serviço, datas e observações. Antes de aprovar um serviço, confirme a disponibilidade e crie o agendamento normalmente. Para cancelamentos, confira se já existe cobrança ou pagamento.

Use **Aprovar** ou **Não aprovar** para devolver uma resposta ao portal do cliente. Essa separação evita mudanças automáticas erradas na agenda.

### 16. Encerrar ou recuperar um acesso

Em **Acessos**, use **Encerrar acesso** quando um funcionário sair ou um acesso de cliente não for mais necessário. As sessões abertas dessa conta são encerradas.

Na tela de entrada, **Esqueci minha senha** envia um link de recuperação com validade curta quando o e-mail automático está ativo. Se ele ainda não estiver, abra **Acessos**, use **Redefinir senha** na conta e compartilhe o link temporário em particular. Nunca envie uma senha por mensagem.

## Configurações e rotina

### 17. Preços e horários padrão

Em **Configurações**, o administrador define:

- diária da hospedagem;
- creche;
- banho;
- banho e tosa;
- Taxi-dog de ida;
- horário padrão de entrada e saída da creche.

As alterações valem para novos serviços. Atendimentos já salvos mantêm o valor original.

### 18. Revisão diária recomendada

No início do dia:

1. Confira alertas e agenda.
2. Confirme as chegadas previstas.
3. Revise vacinas vencidas ou próximas do vencimento.

Durante o dia:

1. Registre chegadas e conclusões.
2. Atualize observações importantes.
3. Gere o sinal de hospedagem quando aplicável.

No fim do dia:

1. Revise os serviços concluídos.
2. Gere e compartilhe as faturas.
3. Registre somente os pagamentos já recebidos.
4. Confira saldos de créditos e recibos.

### 19. Se algo não funcionar

- Atualize a página e tente novamente uma vez.
- Confira se há internet.
- Verifique se você ainda está conectado.
- Leia a mensagem exibida: ela costuma indicar o campo que precisa ser corrigido.
- Não recrie uma fatura repetidamente. Primeiro confira a lista de faturas do cliente.

Se o problema continuar, anote o que estava tentando fazer, o nome do cliente ou cão e o horário aproximado. Não envie senhas em mensagens de suporte.

## Resumo rápido

- Use **Hoje** para comandar a operação.
- Use a data para consultar dias futuros.
- Conclua o serviço antes de faturar.
- Na hospedagem, registre o sinal pago antes de gerar o saldo.
- Compartilhe o PDF por WhatsApp, e-mail ou salve nos arquivos.
- Registre pagamento somente depois de receber.
- Créditos entram no saldo somente após o pagamento da fatura do pacote.
- Mantenha contatos, vacinas e cuidados do cão atualizados.
- Use uma conta individual para cada pessoa e encerre acessos que não são mais necessários.
- Confira **Pedidos** antes de alterar a agenda.
