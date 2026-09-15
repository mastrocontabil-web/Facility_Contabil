from __future__ import annotations

import io

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table

from ..schemas import DrePdfRequest, GrupoDre
from .common import MARGENS, SECAO_STYLE, build_header, format_money, tabela_style

_COL_WIDTHS = [2 * cm, 7.5 * cm, 2.7 * cm, 2.7 * cm, 3 * cm]
_HEADER = ["Código", "Conta", "Débito", "Crédito", "Saldo atual"]


def _linha(item) -> list[str]:  # noqa: ANN001 — BalanceteContaItem, evita import circular de tipo só p/ anotação
    return [
        item.codigo,
        item.nome,
        format_money(item.debito_cents),
        format_money(item.credito_cents),
        format_money(item.saldo_atual_cents, item.saldo_atual_natureza),
    ]


def _tabela_grupo(grupo: GrupoDre) -> Table:
    dados = [_HEADER]
    negrito_rows: list[int] = []
    for item in grupo.linhas:
        if item.tipo == "S":
            negrito_rows.append(len(dados))
        dados.append(_linha(item))
    negrito_rows.append(len(dados))
    dados.append(_linha(grupo.raiz))

    tabela = Table(dados, colWidths=_COL_WIDTHS, repeatRows=1)
    tabela.setStyle(tabela_style(negrito_rows))
    return tabela


def build_dre_pdf(payload: DrePdfRequest) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        title=f"DRE {payload.periodo.mes:02d}-{payload.periodo.ano}",
        **MARGENS,
    )

    titulo = f"DEMONSTRAÇÃO DO RESULTADO DO EXERCÍCIO — {payload.periodo.mes:02d}/{payload.periodo.ano}"
    story = build_header(payload.cliente, payload.periodo, titulo)

    story.append(Paragraph("Receitas", SECAO_STYLE))
    story.append(_tabela_grupo(payload.receitas))
    story.append(Spacer(1, 0.5 * cm))

    story.append(Paragraph("Despesas", SECAO_STYLE))
    story.append(_tabela_grupo(payload.despesas))
    story.append(Spacer(1, 0.7 * cm))

    story.append(Paragraph("Resultado", SECAO_STYLE))
    resumo = Table(
        [
            [
                "Resultado do mês",
                format_money(payload.resultado_mes.cents, payload.resultado_mes.natureza),
            ],
            [
                "Resultado do exercício",
                format_money(payload.resultado_exercicio.cents, payload.resultado_exercicio.natureza),
            ],
        ],
        colWidths=[7.5 * cm, 3 * cm],
    )
    resumo.setStyle(tabela_style([0, 1], align_from_col=1))
    story.append(resumo)

    doc.build(story)
    return buffer.getvalue()
