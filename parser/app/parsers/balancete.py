from __future__ import annotations

import calendar
import re
from datetime import date
from decimal import Decimal

from ..schemas import BalanceteContaItem, BalancetePeriodo, BalanceteParseResult
from .common import to_cents, warn_if_unexpected_char
from .pdf import UnreadablePdfError, open_pdf

# Camada decorativa: o relatório desenha o nome de toda conta sintética de novo,
# num tamanho maior (~8.76), sem código nem valores — sobreposta à linha real
# (código+nome+valores, ~6.18/7.02). Sem filtrar isso, extract_text intercala os
# dois textos caractere a caractere. Validado contra o PDF real: filtrando esse
# tamanho fora, extract_text_lines() dá linha limpa, uma por conta.
_DECORATIVO_SIZE = 8.76

_ROW_RE = re.compile(
    r"^(?P<codigo>\d+)\s+(?P<nome>.+?)\s+"
    r"(?P<saldo_ant>[\d.]+,\d{2})(?P<saldo_ant_dc>[DC]?)\s+"
    r"(?P<debito>[\d.]+,\d{2})\s+"
    r"(?P<credito>[\d.]+,\d{2})\s+"
    r"(?P<saldo_atual>[\d.]+,\d{2})(?P<saldo_atual_dc>[DC]?)$"
)

# Cabeçalho/rodapé repetidos em toda página do relatório — não são linhas de conta.
_BOILERPLATE_RE = re.compile(
    r"^Empresa:.*Folha:\s*\d+$|^C\.N\.P\.J\.:|^Per[íi]odo:|^BALANCETE$|"
    r"^C[oó]digo\s*Descri[çc][ãa]o da conta\s*Saldo Anterior\s*D[ée]bito\s*Cr[ée]dito\s*Saldo Atual$"
)

# A partir daqui é o resumo com totais recalculados (ATIVO, PASSIVO, RESULTADO
# DO MES...), sem código — não são contas, e não fazem parte do escopo do C2.
_RESUMO_RE = re.compile(r"^RESUMO\s+DO\s+BALANCETE$")

_PERIODO_RE = re.compile(r"Per[íi]odo:\s*(\d{2})/(\d{2})/(\d{4})\s*-\s*(\d{2})/(\d{2})/(\d{4})")


def _is_bold(chars: list[dict]) -> bool:
    return any("bold" in (c.get("fontname") or "").lower() for c in chars)


def _money_to_cents(value: str) -> int:
    return to_cents(Decimal(value.replace(".", "").replace(",", ".")))


def _parse_row(text: str, is_bold: bool) -> tuple[BalanceteContaItem | None, str | None]:
    """Faz o parse de UMA linha já extraída (texto puro + é negrito?). Separado
    do resto pra dar pra testar sem precisar de PDF/objetos do pdfplumber."""
    m = _ROW_RE.match(text)
    if not m:
        return None, None

    codigo = m.group("codigo")
    nome = m.group("nome").strip()
    item = BalanceteContaItem(
        codigo=codigo,
        nome=nome,
        tipo="S" if is_bold else "A",
        saldo_anterior_cents=_money_to_cents(m.group("saldo_ant")),
        saldo_anterior_natureza=m.group("saldo_ant_dc") or None,
        debito_cents=_money_to_cents(m.group("debito")),
        credito_cents=_money_to_cents(m.group("credito")),
        saldo_atual_cents=_money_to_cents(m.group("saldo_atual")),
        saldo_atual_natureza=m.group("saldo_atual_dc") or None,
    )
    return item, warn_if_unexpected_char(codigo, nome)


def _extract_periodo(text: str) -> BalancetePeriodo:
    m = _PERIODO_RE.search(text)
    if not m:
        raise UnreadablePdfError(
            "não encontrei o período do balancete — confira se é o relatório 'Balancete' do Domínio"
        )
    d1, m1, y1, d2, m2, y2 = (int(g) for g in m.groups())
    try:
        ini, fim = date(y1, m1, d1), date(y2, m2, d2)
    except ValueError as e:
        raise UnreadablePdfError(f"período do balancete inválido: {e}") from e

    ultimo_dia = calendar.monthrange(y1, m1)[1]
    mes_fechado_inteiro = (
        ini.year == fim.year
        and ini.month == fim.month
        and ini.day == 1
        and fim.day == ultimo_dia
    )
    if not mes_fechado_inteiro:
        raise UnreadablePdfError(
            "o período do balancete não é um mês fechado (dia 1 ao último dia) — "
            "esse relatório não é suportado ainda"
        )
    return BalancetePeriodo(ano=y1, mes=m1)


def _process_lines(
    lines: list[tuple[str, bool]], seen_codigos: set[str]
) -> tuple[list[BalanceteContaItem], list[str], bool]:
    """Processa as linhas já extraídas de UMA página: (texto, é_negrito?).
    `seen_codigos` é compartilhado entre páginas e mutado in-place (dedup do
    documento inteiro). Retorna (items, warnings, parou_no_resumo?). Separado
    da extração via pdfplumber pra dar pra testar com strings simples."""
    items: list[BalanceteContaItem] = []
    warnings: list[str] = []
    for text, is_bold in lines:
        if not text:
            continue
        if _RESUMO_RE.match(text):
            return items, warnings, True
        if _BOILERPLATE_RE.match(text):
            continue
        item, warn = _parse_row(text, is_bold)
        if item is None:
            warnings.append(f"linha não reconhecida (verifique essa conta manualmente): {text}")
            continue
        if item.codigo in seen_codigos:
            warnings.append(f"código {item.codigo} duplicado no balancete — mantida a primeira ocorrência")
            continue
        seen_codigos.add(item.codigo)
        if warn:
            warnings.append(warn)
        items.append(item)
    return items, warnings, False


def parse_balancete_pdf(content: bytes, password: str | None = None) -> BalanceteParseResult:
    all_items: list[BalanceteContaItem] = []
    all_warnings: list[str] = []
    seen_codigos: set[str] = set()

    with open_pdf(content, password) as pdf:
        periodo = _extract_periodo(pdf.pages[0].extract_text() or "")

        for page in pdf.pages:
            filtered = page.filter(
                lambda obj: obj.get("size") is None or round(obj["size"], 2) != _DECORATIVO_SIZE
            )
            lines = [
                (line["text"].strip(), _is_bold(line.get("chars", [])))
                for line in filtered.extract_text_lines()
            ]
            items, warnings, stop = _process_lines(lines, seen_codigos)
            all_items.extend(items)
            all_warnings.extend(warnings)
            if stop:
                break

    if not all_items:
        raise UnreadablePdfError(
            "não encontrei nenhuma conta no balancete — confira se é o relatório 'Balancete' do Domínio"
        )

    return BalanceteParseResult(periodo=periodo, items=all_items, warnings=all_warnings)
