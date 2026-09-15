from __future__ import annotations

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Flowable, Paragraph, Spacer, TableStyle

from ..schemas import BalancetePeriodo, RelatorioCliente

MARGENS = {
    "leftMargin": 1.5 * cm,
    "rightMargin": 1.5 * cm,
    "topMargin": 1.5 * cm,
    "bottomMargin": 1.5 * cm,
}

_styles = getSampleStyleSheet()

TITULO_STYLE = ParagraphStyle(
    "TituloRelatorio", parent=_styles["Heading2"], alignment=1, spaceAfter=2,
)
CABECALHO_STYLE = ParagraphStyle(
    "CabecalhoRelatorio", parent=_styles["Normal"], alignment=1, fontSize=9, leading=12,
)
SECAO_STYLE = ParagraphStyle(
    "SecaoRelatorio", parent=_styles["Heading4"], spaceBefore=6, spaceAfter=2,
)


def format_money(cents: int, natureza: str | None = None) -> str:
    """Formata centavos como dinheiro BR (1.234,56), sufixo D/C opcional."""
    valor = f"{abs(cents) / 100:,.2f}"  # "1,234.56" (agrupamento US)
    valor = valor.replace(",", "@").replace(".", ",").replace("@", ".")
    sufixo = f" {natureza}" if natureza else ""
    return f"{valor}{sufixo}"


def format_historico(codigo: str | None, complemento: str) -> str:
    """Junta código padrão (se tiver) + complemento livre — mesma convenção
    visual de LancamentosPage.tsx (span mono do código + texto do complemento),
    só que achatada em uma string pra célula de tabela do PDF."""
    return f"{codigo} {complemento}" if codigo else complemento


def build_header(cliente: RelatorioCliente, periodo: BalancetePeriodo, titulo: str) -> list[Flowable]:
    return [
        Paragraph(titulo, TITULO_STYLE),
        Paragraph(f"Empresa: {cliente.razao_social}", CABECALHO_STYLE),
        Paragraph(f"C.N.P.J.: {cliente.cnpj}", CABECALHO_STYLE),
        Paragraph(f"Período: {periodo.mes:02d}/{periodo.ano:04d}", CABECALHO_STYLE),
        Spacer(1, 0.5 * cm),
    ]


def tabela_style(negrito_rows: list[int], align_from_col: int = 2) -> TableStyle:
    """Estilo padrão de tabela: cabeçalho (linha 0) e `negrito_rows` em negrito
    com fundo leve — mesma convenção visual de `SaldoRow`/`Dinheiro` no frontend
    (font-medium + bg-slate-50/60 pra conta sintética)."""
    estilo = [
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (align_from_col, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]
    for i in negrito_rows:
        estilo.append(("FONTNAME", (0, i), (-1, i), "Helvetica-Bold"))
        estilo.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#f8fafc")))
    return TableStyle(estilo)
