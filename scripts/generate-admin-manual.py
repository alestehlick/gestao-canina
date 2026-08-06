from pathlib import Path
import shutil

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf"
PUBLIC = ROOT / "public"
OUTPUT.mkdir(parents=True, exist_ok=True)
PUBLIC.mkdir(parents=True, exist_ok=True)
PDF_PATH = OUTPUT / "manual-hospet-quintal.pdf"

FOREST = colors.HexColor("#183F31")
CREAM = colors.HexColor("#F7F3EA")
INK = colors.HexColor("#26302B")
MUTED = colors.HexColor("#657069")
GOLD = colors.HexColor("#C69245")
BLUE = colors.HexColor("#009CDE")

styles = getSampleStyleSheet()
title = ParagraphStyle(
    "CoverTitle",
    parent=styles["Title"],
    fontName="Helvetica-Bold",
    fontSize=30,
    leading=34,
    textColor=colors.white,
    alignment=TA_CENTER,
    spaceAfter=10,
)
subtitle = ParagraphStyle(
    "CoverSubtitle",
    parent=styles["Normal"],
    fontName="Helvetica",
    fontSize=12,
    leading=18,
    textColor=colors.HexColor("#E4EEE8"),
    alignment=TA_CENTER,
)
h1 = ParagraphStyle(
    "H1",
    parent=styles["Heading1"],
    fontName="Helvetica-Bold",
    fontSize=19,
    leading=23,
    textColor=FOREST,
    spaceBefore=13,
    spaceAfter=8,
    keepWithNext=True,
)
h2 = ParagraphStyle(
    "H2",
    parent=styles["Heading2"],
    fontName="Helvetica-Bold",
    fontSize=13,
    leading=17,
    textColor=FOREST,
    spaceBefore=11,
    spaceAfter=5,
    keepWithNext=True,
)
body = ParagraphStyle(
    "Body",
    parent=styles["BodyText"],
    fontName="Helvetica",
    fontSize=10,
    leading=15,
    textColor=INK,
    spaceAfter=6,
)
bullet = ParagraphStyle(
    "Bullet",
    parent=body,
    leftIndent=13,
    firstLineIndent=-7,
    bulletIndent=3,
    spaceAfter=4,
)
step = ParagraphStyle(
    "Step",
    parent=body,
    leftIndent=16,
    firstLineIndent=-13,
    bulletIndent=1,
    borderColor=colors.HexColor("#DCE7E1"),
    borderWidth=0,
    spaceAfter=5,
)
callout = ParagraphStyle(
    "Callout",
    parent=body,
    backColor=colors.HexColor("#EAF5F9"),
    borderColor=BLUE,
    borderWidth=0.8,
    borderPadding=9,
    textColor=INK,
    spaceBefore=7,
    spaceAfter=10,
)


class ManualDoc(BaseDocTemplate):
    def __init__(self, path):
        super().__init__(
            str(path),
            pagesize=A4,
            leftMargin=20 * mm,
            rightMargin=20 * mm,
            topMargin=20 * mm,
            bottomMargin=18 * mm,
            title="Manual dos administradores — Hospet Quintal",
            author="Hospet Quintal",
        )
        frame = Frame(
            self.leftMargin,
            self.bottomMargin,
            self.width,
            self.height,
            id="body",
        )
        self.addPageTemplates(PageTemplate(id="main", frames=frame, onPage=footer))


def footer(canvas, doc):
    if doc.page == 1:
        canvas.setFillColor(FOREST)
        canvas.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
        canvas.setFillColor(GOLD)
        canvas.circle(A4[0] / 2, A4[1] - 56 * mm, 15 * mm, fill=1, stroke=0)
        canvas.setFillColor(FOREST)
        canvas.setFont("Helvetica-Bold", 20)
        canvas.drawCentredString(A4[0] / 2, A4[1] - 59 * mm, "HQ")
        return
    canvas.setStrokeColor(colors.HexColor("#D9DDD8"))
    canvas.line(20 * mm, 14 * mm, A4[0] - 20 * mm, 14 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(20 * mm, 9 * mm, "Hospet Quintal · Manual dos administradores")
    canvas.drawRightString(A4[0] - 20 * mm, 9 * mm, f"Página {doc.page}")


story = [
    Spacer(1, 72 * mm),
    Paragraph("HOSPET QUINTAL", title),
    Paragraph("Manual dos administradores", title),
    Spacer(1, 6 * mm),
    Paragraph(
        "Um guia claro para cuidar da agenda, dos cadastros, das faturas e dos créditos com segurança.",
        subtitle,
    ),
    Spacer(1, 68 * mm),
    Paragraph("Versão de uso diário · 2026", subtitle),
    PageBreak(),
]

sections = [
    (
        "Comece por aqui",
        [
            (
                "1. Entrar com segurança",
                [
                    "No primeiro acesso, cadastre os dois administradores. Cada pessoa deve usar seu próprio e-mail e uma senha diferente, com pelo menos 12 caracteres.",
                    "Depois dessa preparação, todo acesso começa pela tela de login. Ao terminar o trabalho em um aparelho compartilhado, use <b>Sair</b>.",
                    "Os dados reais de clientes e cães ficam no ambiente privado da Hospet Quintal. Eles não são gravados no código público do GitHub.",
                ],
            ),
            (
                "2. Entender a tela Hoje",
                [
                    "A tela <b>Hoje</b> reúne agenda, presença, tarefas, aniversários, vacinas e cobranças que precisam de atenção.",
                    "Use os botões de data para consultar qualquer dia futuro. <b>Ver agenda completa</b> abre a visão detalhada do dia selecionado.",
                ],
            ),
            (
                "3. Conduzir um atendimento",
                [
                    "O fluxo tem somente duas etapas: <b>Confirmar</b> e <b>Concluir atendimento</b>.",
                    "Use <b>Opções</b> para editar ou cancelar. O cancelamento exige um motivo e permanece no histórico.",
                    "As mesmas ações aparecem em <b>Cães &gt; Agenda e histórico</b> e em <b>Clientes &gt; Serviços</b>.",
                ],
            ),
        ],
    ),
    (
        "Cadastros",
        [
            (
                "4. Cadastrar um cliente",
                [
                    "Em <b>Clientes</b>, escolha <b>Novo cliente</b>. Informe nome, WhatsApp, e-mail, endereço, CPF e data de nascimento.",
                    "Confira principalmente WhatsApp e e-mail: eles serão usados para compartilhar faturas e recibos.",
                ],
            ),
            (
                "5. Cadastrar um cão",
                [
                    "Em <b>Cães</b>, escolha <b>Novo cão</b>. Vincule o cliente correto e preencha nome, raça, nascimento, alimentação, temperamento e medicação.",
                    "Cadastre cada vacina com nome e vencimento. Você também pode adicionar uma foto.",
                    "Escreva os cuidados de forma direta. Exemplo: “Come ração própria às 8h e às 18h”.",
                ],
            ),
        ],
    ),
    (
        "Agenda e serviços",
        [
            (
                "6. Criar um serviço",
                [
                    "Use <b>Novo serviço</b>, escolha o cão e selecione Creche, Hospedagem, Banho, Banho e tosa ou Taxi-dog.",
                    "A Creche usa os horários padrão das configurações. O Taxi-dog pede ida ou ida e volta e não exige horário.",
                    "O administrador pode alterar o preço de um atendimento sem mudar o padrão. Funcionários sempre usam o valor definido pela administração.",
                    "O agendamento não define a forma de quitação. Conclua o serviço e, em <b>Cobranças &gt; Faturas</b>, escolha entre criar uma fatura ou usar créditos disponíveis.",
                    "Para repetir semanalmente, escolha <b>Toda semana</b> e informe de 2 a 52 semanas. Ao cancelar, escolha somente o dia, deste dia em diante ou toda a recorrência. Atendimentos concluídos são preservados.",
                ],
            ),
            (
                "7. Hospedagem com sinal",
                [
                    "Informe primeiro a entrada e a saída. Todas as datas aparecem como dia/mês/ano. O campo de diárias mostra somente o período em dias ou esse período acrescido de meia diária. Por exemplo, de 03/10/2026 a 04/10/2026, escolha 1 ou 1,5 diária.",
                    "Se houver sinal, marque <b>Cobrar sinal no check-in</b> e informe a porcentagem. O padrão é 50%.",
                ],
            ),
        ],
    ),
]

for section_title, topics in sections:
    for topic_index, (topic_title, paragraphs) in enumerate(topics):
        opening = []
        if topic_index == 0:
            opening.append(Paragraph(section_title, h1))
        opening.extend(
            [
                Paragraph(topic_title, h2),
                Paragraph(paragraphs[0], body),
            ]
        )
        story.append(KeepTogether(opening))
        story.extend(Paragraph(text, body) for text in paragraphs[1:])

story.extend(
    [
        Paragraph("Fluxo do sinal, passo a passo", h2),
        Paragraph(
            "<b>1.</b> Confirme a hospedagem.<br/>"
            "<b>2.</b> Escolha <b>Gerar fatura do sinal</b>.<br/>"
            "<b>3.</b> Compartilhe o PDF com o cliente.<br/>"
            "<b>4.</b> Depois de receber, use <b>Registrar pagamento</b>.<br/>"
            "<b>5.</b> No checkout, conclua a hospedagem.<br/>"
            "<b>6.</b> Escolha <b>Gerar fatura do saldo</b>.",
            step,
        ),
        Paragraph(
            "<b>Importante:</b> o sistema desconta automaticamente o sinal pago. Se a fatura do sinal ainda estiver pendente, o saldo não será criado.",
            callout,
        ),
        Paragraph("Faturas e pagamentos", h1),
        Paragraph("8. Criar uma fatura de serviços", h2),
        Paragraph(
            "Depois de concluir os serviços, abra <b>Cobranças &gt; Faturas</b>. Selecione itens de um único cliente e escolha <b>Criar fatura</b>.",
            body,
        ),
        Paragraph(
            "O PDF discrimina cada serviço pelo cão, com data e valor. O nome do arquivo contém o nome do cliente e o período cobrado.",
            body,
        ),
        Paragraph("9. Compartilhar o PDF", h2),
        Paragraph("Escolha WhatsApp, E-mail ou Salvar.", body),
        Paragraph(
            "No iPhone e Android, o menu normal de compartilhamento será aberto com o PDF. No computador, se o anexo não puder ser incluído automaticamente, o arquivo será salvo para você anexar.",
            body,
        ),
        Paragraph("10. Registrar um pagamento", h2),
        Paragraph(
            "Abra a fatura, confira cliente e total, informe a data e escolha <b>Registrar pagamento</b>.",
            body,
        ),
        Paragraph(
            "<b>Registre somente depois de confirmar o recebimento.</b> A fatura passará para Pago e os serviços serão quitados.",
            callout,
        ),
        Paragraph(
            "Se o valor ainda estiver sendo processado, escolha <b>Em compensação</b> e informe a previsão. O Caixa só recebe o valor quando você confirmar que ele ficou disponível.",
            body,
        ),
        Paragraph(
            "Um administrador pode usar <b>Estornar pagamento</b> quando houver erro. A fatura volta a ficar aberta e o Caixa preserva o histórico. Créditos liberados só são revertidos se ainda não tiverem sido usados.",
            body,
        ),
        Paragraph("Caixa", h1),
        Paragraph("11. Acompanhar entradas e saídas", h2),
        Paragraph(
            "Abra <b>Caixa</b> para consultar entradas, saídas e o saldo de cada período. Quando uma fatura é marcada como paga, o recebimento entra automaticamente. Faturas abertas não são consideradas.",
            body,
        ),
        Paragraph(
            "Use <b>+ Entrada</b> para valores recebidos fora das faturas e <b>+ Saída</b> para despesas. Informe data, valor, categoria e uma descrição clara.",
            body,
        ),
        Paragraph(
            "Em Cobranças recentes, <b>Considerar no Caixa</b> aparece nas faturas pagas. Desmarcar não cancela o pagamento: apenas retira o valor do resultado financeiro.",
            callout,
        ),
        Paragraph("12. Períodos e histórico", h2),
        Paragraph(
            "Use <b>Desconsiderar</b> em vez de apagar. Informe o motivo e use <b>Restaurar</b> se precisar. Lançamentos manuais podem ser editados; recebimentos automáticos devem ser corrigidos na cobrança original.",
            body,
        ),
        Paragraph(
            "O período começa no dia 1 por padrão. Você pode escolher um dia entre 1 e 28. Se escolher dia 5, o período vai do dia 5 ao dia 4 do mês seguinte. Use as setas para navegar.",
            body,
        ),
        Paragraph("Créditos pré-pagos", h1),
        Paragraph("13. Vender um pacote", h2),
        Paragraph(
            "Em <b>Cobranças &gt; Créditos</b>, escolha <b>Vender pacote</b>. Selecione cliente, serviço e quantidade e informe o valor especial.",
            body,
        ),
        Paragraph(
            "A criação do pacote gera uma fatura, mas ainda não altera o saldo. Os créditos são liberados automaticamente quando você registra o pagamento da fatura.",
            body,
        ),
        Paragraph("14. Usar créditos", h2),
        Paragraph(
            "Conclua o serviço e abra <b>Cobranças &gt; Faturas</b>. Na linha do item, escolha <b>Usar crédito</b>. Nenhuma fatura é criada e um recibo fica disponível. Taxi-dog de ida usa 1 crédito; ida e volta usa 2.",
            body,
        ),
        Paragraph("Pessoas e acessos", h1),
        Paragraph("15. Convidar um funcionário", h2),
        Paragraph(
            "Em <b>Acessos</b>, escolha Funcionário e informe o e-mail. O convite vale por 48 horas e pode ser usado uma única vez. Se o e-mail automático não estiver ativo, copie o link seguro e envie em particular.",
            body,
        ),
        Paragraph(
            "Funcionários usam Hoje, Pedidos, Cães e Clientes. Eles não abrem cobranças, configurações, histórico global ou gestão de acessos.",
            callout,
        ),
        Paragraph("16. Convidar um cliente", h2),
        Paragraph(
            "Em <b>Acessos</b>, escolha Cliente, informe o e-mail e selecione o cadastro correto. No portal, o cliente consulta seus cães, serviços, créditos, faturas e recibos, atualiza contato e envia pedidos.",
            body,
        ),
        Paragraph(
            "Cada cliente vê somente o próprio cadastro. Um pedido não reserva automaticamente uma data.",
            body,
        ),
        Paragraph("17. Analisar pedidos", h2),
        Paragraph(
            "Abra <b>Pedidos</b>, confira disponibilidade e analise a solicitação. Crie o agendamento normalmente e só depois marque o pedido como aprovado. Essa confirmação separada evita mudanças erradas na agenda.",
            body,
        ),
        Paragraph("18. Encerrar ou recuperar acesso", h2),
        Paragraph(
            "Em Acessos, use <b>Encerrar acesso</b> quando necessário. As sessões dessa conta são interrompidas. Se o e-mail automático ainda não estiver ativo, use <b>Redefinir senha</b> e compartilhe o link temporário em particular.",
            body,
        ),
        Paragraph("Configurações e rotina", h1),
        Paragraph("19. Preços e horários padrão", h2),
        Paragraph(
            "Em <b>Configurações</b>, defina diária da hospedagem, creche, banho, banho e tosa, Taxi-dog de ida e horários da creche.",
            body,
        ),
        Paragraph(
            "As mudanças valem para novos serviços. Atendimentos já salvos mantêm o valor original.",
            body,
        ),
        Paragraph("20. Revisão diária recomendada", h2),
        Paragraph(
            "- No início: confira alertas, agenda e vacinas.<br/>"
            "- Durante o dia: confirme e conclua atendimentos; acompanhe sinais de hospedagem.<br/>"
            "- No fim: gere faturas, registre recebimentos e confira créditos e recibos.",
            body,
        ),
        KeepTogether([
            Paragraph("21. Se algo não funcionar", h2),
            Paragraph(
                "- Atualize a página e tente novamente uma vez.<br/>"
                "- Confira a internet e se a sessão continua aberta.<br/>"
                "- Leia a mensagem exibida e revise o campo indicado.<br/>"
                "- Não recrie uma fatura repetidamente; confira antes a lista do cliente.",
                body,
            ),
            Paragraph(
                "Ao pedir suporte, informe o que estava fazendo, o cliente ou cão e o horário aproximado. Nunca envie senhas.",
                callout,
            ),
        ]),
        PageBreak(),
        Paragraph("Resumo rápido", h1),
        Paragraph("Use Hoje para comandar a operação.", bullet, bulletText="•"),
        Paragraph("Use a data para consultar dias futuros.", bullet, bulletText="•"),
        Paragraph("Conclua o serviço antes de faturar.", bullet, bulletText="•"),
        Paragraph("Registre o sinal pago antes de gerar o saldo da hospedagem.", bullet, bulletText="•"),
        Paragraph("Compartilhe o PDF por WhatsApp, e-mail ou Arquivos.", bullet, bulletText="•"),
        Paragraph("Registre pagamento somente depois de receber.", bullet, bulletText="•"),
        Paragraph("Confira o Caixa e registre as despesas do período.", bullet, bulletText="•"),
        Paragraph("Mantenha contatos, vacinas e cuidados atualizados.", bullet, bulletText="•"),
        Paragraph("Use uma conta individual para cada pessoa.", bullet, bulletText="•"),
        Paragraph("Confira Pedidos antes de alterar a agenda.", bullet, bulletText="•"),
    ]
)

ManualDoc(PDF_PATH).build(story)
shutil.copy2(PDF_PATH, PUBLIC / PDF_PATH.name)
print(PDF_PATH)
