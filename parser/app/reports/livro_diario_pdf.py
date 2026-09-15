from __future__ import annotations

import io

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Table

from ..schemas import LivroDiarioPdfRequest
from .common import MARGENS, build_header, format_historico, format_money, tabela_style

_COL_WIDTHS = [2.2 * cm, 6.5 * cm, 4.5 * cm, 1.3 * cm, 3.5 * cm]
_HEADER = ["Data", "Histórico", "Conta", "D/C", "Valor"]


def build_livro_diario_pdf(payload: LivroDiarioPdfRequest) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        title=f"Livro Diario {payload.periodo.mes:02d}-{payload.periodo.ano}",
        **MARGENS,
    )

    dados = [_HEADER]
    for lanc in payload.lancamentos:
        historico = format_historico(lanc.historico_codigo, lanc.historico_complemento)
        # Data/Histórico só aparecem na 1ª partida do lançamento — dá a
        # impressão de agrupado sem precisar de SPAN (não usado em nenhum
        # outro relatório dessa suite; risco real de off-by-one no índice
        # de linha, sem ganho real aqui).
        for i, partida in enumerate(lanc.partidas):
            dados.append(
                [
                    lanc.data if i == 0 else "",
                    historico if i == 0 else "",
                    f"{partida.conta_codigo} {partida.conta_nome}",
                    partida.tipo,
                    format_money(partida.valor_cents),
                ]
            )

    tabela = Table(dados, colWidths=_COL_WIDTHS, repeatRows=1)
    tabela.setStyle(tabela_style([]))

    titulo = f"LIVRO DIÁRIO — {payload.periodo.mes:02d}/{payload.periodo.ano}"
    story = [*build_header(payload.cliente, payload.periodo, titulo), tabela]
    doc.build(story)
    return buffer.getvalue()
