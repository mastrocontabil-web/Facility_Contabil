from __future__ import annotations

import io

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Table

from ..schemas import RazaoPdfRequest
from .common import MARGENS, build_header, format_historico, format_money, tabela_style

_COL_WIDTHS = [2.2 * cm, 8 * cm, 1.3 * cm, 3 * cm, 3.5 * cm]
_HEADER = ["Data", "Histórico", "D/C", "Valor", "Saldo"]


def build_razao_pdf(payload: RazaoPdfRequest) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        title=f"Razao {payload.conta.codigo} {payload.periodo.mes:02d}-{payload.periodo.ano}",
        **MARGENS,
    )

    dados = [_HEADER]
    negrito_rows: list[int] = [len(dados)]
    dados.append(
        ["", "Saldo anterior", "", "", format_money(payload.saldo_anterior_cents, payload.saldo_anterior_natureza)]
    )

    for linha in payload.linhas:
        dados.append(
            [
                linha.data,
                format_historico(linha.historico_codigo, linha.historico_complemento),
                linha.tipo,
                format_money(linha.valor_cents),
                format_money(linha.saldo_cents, linha.saldo_natureza),
            ]
        )

    negrito_rows.append(len(dados))
    dados.append(
        ["", "Saldo atual", "", "", format_money(payload.saldo_atual_cents, payload.saldo_atual_natureza)]
    )

    tabela = Table(dados, colWidths=_COL_WIDTHS, repeatRows=1)
    tabela.setStyle(tabela_style(negrito_rows))

    titulo = f"RAZÃO — {payload.conta.codigo} {payload.conta.nome} — {payload.periodo.mes:02d}/{payload.periodo.ano}"
    story = [*build_header(payload.cliente, payload.periodo, titulo), tabela]
    doc.build(story)
    return buffer.getvalue()
