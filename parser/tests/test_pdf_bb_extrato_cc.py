"""Banco do Brasil "Extrato de Conta Corrente" (tabela Dia/Lote/Documento/
Histórico/Valor, valor com "(+)"/"(-)").

O PDF é gerado aqui com dados fictícios, reproduzindo o que torna esse layout
difícil: cada lançamento fica entre duas linhas horizontais da tabela, mas o
título do histórico às vezes vem ACIMA da data (Pix) e o valor fica na altura
do meio da célula — lido como texto corrido, as partes de lançamentos vizinhos
se misturam.
"""

from __future__ import annotations

import io

from app.parsers.pdf import (
    _looks_like_bb_extrato_cc,
    _parse_bb_extrato_cc_pdf,
    _parse_signed_pdf,
    extract_pdf_text,
    parse_pdf,
)

_H = 842  # altura A4 em pontos

# (modo, data, lote, documento, título, complemento, valor com sinal)
#   "a" = título na altura da data e complemento embaixo (a maioria)
#   "b" = título ACIMA da data, complemento na linha do valor (Pix)
#   "c" = linha única, histórico na linha do valor
_PAGINA_1 = [
    ("a", "31/07/2026", "", "", "Saldo Anterior", "", "1.000,00 (+)"),
    ("a", "03/08/2026", "90001", "100000000000001", "Transferência recebida",
     "03/08 08:55 EMPRESA ALFA LTDA", "500,00 (+)"),
    ("a", "03/08/2026", "90002", "100000000000002", "Tarifa Pacote de Serviços",
     "Cobrança referente a 03/08/2026", "35,00 (-)"),
    ("a", "00/00/0000", "90003", "", "Saldo do dia", "", "1.465,00 (+)"),
    ("b", "10/08/2026", "90003", "100000000000003", "Pix - Recebido",
     "10/08 11:07 12345678000199 CLIENTE BETA", "1.234,56 (+)"),
    ("c", "10/08/2026", "90004", "1000000000004", "BB GIRO FGO PRONAMPE", "", "612,34 (-)"),
    ("b", "12/08/2026", "90005", "10005", "Pix - Enviado", "12/08 10:33 FORNECEDOR GAMA", "300,00 (-)"),
]
_PAGINA_2 = [
    ("a", "20/08/2026", "", "9999", "BB Rende Fácil", "Rende Facil", "487,90 (-)"),
    ("a", "31/08/2026", "", "", "S A L D O", "", "1.299,32 (+)"),
]


def _pdf(paginas: list[list[tuple]], separadores: bool = True) -> bytes:
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(595, _H))

    def txt(x: float, top: float, s: str, direita: bool = False) -> None:
        if s:
            (c.drawRightString if direita else c.drawString)(x, _H - top - 7, s)

    for pagina in paginas:
        c.setFont("Helvetica", 8)
        txt(70, 23, "Extrato de Conta Corrente")
        txt(71, 45, "Cliente FULANO DE TAL 00000000000")
        txt(220, 66, "Agência: 0000-0 Conta: 00000-0")
        txt(30, 87, "Lançamentos")
        if separadores:
            c.rect(20, _H - 115, 555, 15, stroke=1, fill=0)
        for x, s in ((30, "Dia"), (91, "Lote"), (152, "Documento"), (266, "Histórico")):
            txt(x, 103, s)
        txt(570, 103, "Valor", direita=True)

        topo = 115.0
        for modo, dia, lote, doc, titulo, compl, valor in pagina:
            altura = 31 if modo == "b" else 20
            linha_titulo, linha_data, linha_valor = {
                "a": (2, 2, 7), "b": (2, 7, 12), "c": (7, 2, 7),
            }[modo]
            txt(30, topo + linha_data, dia)
            txt(91, topo + linha_valor, lote)
            txt(152, topo + linha_valor, doc)
            txt(266, topo + linha_titulo, titulo)
            txt(266, topo + (linha_valor if modo == "b" else 12), compl)
            txt(570, topo + linha_valor, valor, direita=True)
            topo += altura
            if separadores:
                c.line(20, _H - topo, 575, _H - topo)
        txt(30, topo + 40, "Total Aplicações Financeiras")
        txt(470, topo + 40, "487,90")
        c.showPage()
    c.save()
    return buf.getvalue()


def test_detecta_o_layout():
    assert _looks_like_bb_extrato_cc(extract_pdf_text(_pdf([_PAGINA_1, _PAGINA_2]), None))


def test_le_cada_lancamento_inteiro_com_sinal_certo():
    r = parse_pdf(_pdf([_PAGINA_1, _PAGINA_2]))
    got = [(t.date, t.direction, t.amount_cents, t.description) for t in r.transactions]
    assert got == [
        ("2026-08-03", "entrada", 50000, "Transferência recebida - 03/08 08:55 EMPRESA ALFA LTDA"),
        ("2026-08-03", "saida", 3500, "Tarifa Pacote de Serviços - Cobrança referente a 03/08/2026"),
        ("2026-08-10", "entrada", 123456, "Pix - Recebido - 10/08 11:07 12345678000199 CLIENTE BETA"),
        ("2026-08-10", "saida", 61234, "BB GIRO FGO PRONAMPE"),
        ("2026-08-12", "saida", 30000, "Pix - Enviado - 12/08 10:33 FORNECEDOR GAMA"),
        ("2026-08-20", "saida", 48790, "BB Rende Fácil - Rende Facil"),
    ]
    # saldo anterior, saldo do dia, saldo final e o rodapé de aplicações não viram lançamento
    assert (r.period_start, r.period_end) == ("2026-08-03", "2026-08-20")
    assert r.transactions[0].raw == {"ordem": 0, "lote": "90001", "doc": "100000000000001"}
    assert [t.raw["ordem"] for t in r.transactions] == list(range(6))


def test_sem_as_linhas_da_tabela_cai_no_leitor_generico():
    # sem os separadores não dá pra saber onde cada lançamento começa — em vez
    # de juntar tudo num lançamento só, deixa o leitor genérico tentar.
    pdf = _pdf([_PAGINA_1], separadores=False)
    texto = extract_pdf_text(pdf, None)
    assert _parse_bb_extrato_cc_pdf(pdf, None, texto).transactions == []
    assert parse_pdf(pdf).transactions == _parse_signed_pdf(texto).transactions
