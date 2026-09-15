from __future__ import annotations

import io

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Table

from ..schemas import BalancetePdfRequest
from .common import MARGENS, build_header, format_money, tabela_style

_COL_WIDTHS = [2 * cm, 6.5 * cm, 3 * cm, 2.7 * cm, 2.7 * cm, 3 * cm]
_HEADER = ["Código", "Conta", "Saldo anterior", "Débito", "Crédito", "Saldo atual"]


def build_balancete_pdf(payload: BalancetePdfRequest) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        title=f"Balancete {payload.periodo.mes:02d}-{payload.periodo.ano}",
        **MARGENS,
    )

    dados = [_HEADER]
    negrito_rows: list[int] = []
    for item in payload.linhas:
        if item.tipo == "S":
            negrito_rows.append(len(dados))
        dados.append(
            [
                item.codigo,
                item.nome,
                format_money(item.saldo_anterior_cents, item.saldo_anterior_natureza),
                format_money(item.debito_cents),
                format_money(item.credito_cents),
                format_money(item.saldo_atual_cents, item.saldo_atual_natureza),
            ]
        )

    tabela = Table(dados, colWidths=_COL_WIDTHS, repeatRows=1)
    tabela.setStyle(tabela_style(negrito_rows))

    titulo = f"BALANCETE — {payload.periodo.mes:02d}/{payload.periodo.ano}"
    story = [*build_header(payload.cliente, payload.periodo, titulo), tabela]
    doc.build(story)
    return buffer.getvalue()
