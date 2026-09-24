"""Mercado Pago "EXTRATO DE CONTA" (tabela Data/Descrição/ID da operação/Valor/
Saldo, data com hífen, valor com sinal).

O PDF é gerado aqui com dados fictícios, reproduzindo o que o extrato real tem
de difícil: a descrição quebra em linhas ACIMA e abaixo da linha da data (a
célula é centralizada), o cabeçalho da tabela não se repete na 2ª página, um
lançamento começa no fim de uma página e termina no topo da seguinte, e o
rodapé traz uma data ("Data de geração") que não é lançamento.
"""

from __future__ import annotations

import io

from app.parsers.pdf import _looks_like_mercadopago, extract_pdf_text, parse_pdf

_W, _H = 446.25, 632.25  # tamanho da página do extrato real

# (data, linhas da descrição, id, valor, saldo). A linha da data fica no meio
# da célula: com 3 linhas ela divide a do meio; com 2, fica entre as duas.
_PAGINA_1 = [
    ("01-08-2026", ["Pix enviado FORNECEDOR"], "100000000001", "-1.000,00", "1.000,00"),
    ("01-08-2026", ["Liberação de dinheiro"], "100000000002", "10,38", "1.010,38"),
    ("02-08-2026", ["Pagamento com Código QR", "Pix CLIENTE BETA DA", "SILVA"], "100000000003", "23,00", "1.033,38"),
    ("02-08-2026", ["Pix recebido CLIENTE", "GAMA SOUZA"], "100000000004", "8,00", "1.041,38"),
]
# começo da descrição do lançamento que vira a página
_QUEBRADO_INICIO = ["Pagamento com Código QR", "Pix CLIENTE DELTA"]
_QUEBRADO_FIM = ("03-08-2026", ["OLIVEIRA"], "100000000005", "45,16", "1.086,54")
_PAGINA_2 = [
    ("04-08-2026", ["Pagamento"], "100000000002", "-0,33", "1.086,21"),  # estorno da venda de 01/08
    ("05-08-2026", ["Liberação de dinheiro"], "100000000006", "7,92", "1.094,13"),
]


def _pdf(separadores: bool = True, saldo_linha_4: str = "1.041,38", saldo_final: str = "1.094,13") -> bytes:
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(_W, _H))

    def txt(x: float, top: float, s: str, direita: bool = False) -> None:
        (c.drawRightString if direita else c.drawString)(x, _H - top - 6, s)

    def sep(top: float) -> None:
        if separadores:
            c.setFillGray(0.93)
            c.rect(30, _H - top - 0.7, 385.5, 0.7, stroke=0, fill=1)
            c.setFillGray(0)

    def celula(topo: float, data: str | None, linhas: list[str], ident: str, valor: str, saldo: str) -> float:
        altura = 18 + 12 * len(linhas)
        meio = topo + altura / 2
        for k, linha in enumerate(linhas):
            txt(88.9, meio - 6 * (len(linhas) - 1) + 12 * k - 3.5, linha)
        if data:
            txt(40.5, meio - 3.5, data)
            txt(197.6, meio - 3.5, ident)
            txt(332.3, meio - 3.5, f"R$ {valor}", direita=True)
            txt(405.0, meio - 3.5, f"R$ {saldo}", direita=True)
        sep(topo + altura)
        return topo + altura + 0.7

    c.setFont("Helvetica", 7.5)
    txt(329.1, 32.5, "EXTRATO DE CONTA")
    txt(345.2, 42.0, "EMPRESA FICTICIA LTDA")
    txt(208.0, 52.4, "CPF/CNPJ: 00000000000191 Agência: 1 Conta: 1234567890")
    txt(288.9, 61.7, "Periodo: De 01-08-2026 al 31-08-2026")
    txt(178.5, 101.9, "Entradas: R$ 94,46")
    txt(44.3, 108.4, "Saldo inicial: R$ 2.000,00")
    txt(250.0, 108.4, f"Saldo final: R$ {saldo_final}")
    txt(178.5, 115.0, "Saidas: R$ -1.000,33")
    txt(175.3, 158.8, "DETALHE DOS MOVIMENTOS")
    for x, s in ((40.5, "Data"), (88.9, "Descrição"), (197.6, "ID da operação"), (312.3, "Valor"), (383.8, "Saldo")):
        txt(x, 184.6, s)
    sep(201.3)
    topo = 202.0
    for i, (data, linhas, ident, valor, saldo) in enumerate(_PAGINA_1):
        topo = celula(topo, data, linhas, ident, valor, saldo_linha_4 if i == 3 else saldo)
    celula(topo, None, _QUEBRADO_INICIO, "", "", "")  # sem data: continua na próxima página
    txt(397.5, 612.8, "1/2")
    c.showPage()

    c.setFont("Helvetica", 7.5)  # 2ª página: sem o cabeçalho da tabela
    sep(0.4)
    topo = 1.1
    topo = celula(topo, *_QUEBRADO_FIM)
    for linha in _PAGINA_2:
        topo = celula(topo, *linha)
    txt(31.5, 555.9, "Data de geração: 03-09-2026")
    txt(31.5, 570.9, "Você tem alguma dúvida? Conte com o nosso Portal de ajuda para encontrar informações")
    txt(31.5, 600.9, "Mercado Pago Instituição de Pagamento Ltda. CNPJ n.º 10.573.521/0001-91.")
    txt(397.5, 612.8, "2/2")
    c.showPage()
    c.save()
    return buf.getvalue()


_ESPERADO = [
    ("2026-08-01", "saida", 100000, "Pix enviado FORNECEDOR"),
    ("2026-08-01", "entrada", 1038, "Liberação de dinheiro"),
    ("2026-08-02", "entrada", 2300, "Pagamento com Código QR Pix CLIENTE BETA DA SILVA"),
    ("2026-08-02", "entrada", 800, "Pix recebido CLIENTE GAMA SOUZA"),
    ("2026-08-03", "entrada", 4516, "Pagamento com Código QR Pix CLIENTE DELTA OLIVEIRA"),
    ("2026-08-04", "saida", 33, "Pagamento"),
    ("2026-08-05", "entrada", 792, "Liberação de dinheiro"),
]


def _avisos_de_saldo(r) -> list[str]:
    return [w for w in r.warnings if "saldo" in w]


def test_detecta_o_layout():
    assert _looks_like_mercadopago(extract_pdf_text(_pdf(), None))


def test_le_cada_lancamento_inteiro_com_sinal_certo():
    r = parse_pdf(_pdf())
    got = [(t.date, t.direction, t.amount_cents, t.description) for t in r.transactions]
    # o resumo do topo (entradas/saídas/saldos) e a "Data de geração" do rodapé não viram lançamento
    assert got == _ESPERADO
    assert (r.period_start, r.period_end) == ("2026-08-01", "2026-08-05")
    assert r.transactions[0].raw == {"ordem": 0, "id_operacao": "100000000001"}
    assert r.transactions[5].raw["id_operacao"] == "100000000002"  # estorno com o ID da venda
    assert [t.raw["ordem"] for t in r.transactions] == list(range(7))
    assert _avisos_de_saldo(r) == []  # saldo linha a linha e saldo final batem


def test_saldo_que_nao_fecha_vira_aviso():
    r = parse_pdf(_pdf(saldo_linha_4="1.041,83"))
    assert len(r.transactions) == 7  # continua lendo tudo
    assert any("ID 100000000004" in w for w in _avisos_de_saldo(r))


def test_saldo_final_diferente_do_impresso_vira_aviso():
    r = parse_pdf(_pdf(saldo_final="1.094,99"))
    assert any("saldo final impresso" in w for w in r.warnings)


def test_sem_as_linhas_da_tabela_ainda_le_todos_os_valores():
    # sem separador não dá pra saber onde cada célula começa: cada lançamento
    # fica só com o texto da própria linha, mas nenhum valor se perde.
    r = parse_pdf(_pdf(separadores=False))
    got = [(t.date, t.direction, t.amount_cents) for t in r.transactions]
    assert got == [(d, dr, v) for d, dr, v, _ in _ESPERADO]
