"""Testes rápidos e sintéticos do parser de Balancete — sem depender do PDF
real (ao contrário de test_balancete.py). Mesmo espírito de test_pdf_layouts.py:
casos de borda construídos à mão contra as funções internas."""
from __future__ import annotations

import pytest

from app.parsers.balancete import _extract_periodo, _parse_row, _process_lines
from app.parsers.pdf import UnreadablePdfError


def test_parse_row_dc_ausente_em_zero_presente_em_nao_zero():
    # "335 FÉRIAS 0,00 250,00 0,00 250,00D" — mesma linha real do balancete
    item, warn = _parse_row("335 FÉRIAS 0,00 250,00 0,00 250,00D", is_bold=False)
    assert item is not None
    assert warn is None
    assert item.codigo == "335"
    assert item.tipo == "A"
    assert item.saldo_anterior_cents == 0
    assert item.saldo_anterior_natureza is None
    assert item.debito_cents == 25_000
    assert item.credito_cents == 0
    assert item.saldo_atual_cents == 25_000
    assert item.saldo_atual_natureza == "D"


def test_parse_row_bold_vira_sintetica():
    item, _ = _parse_row("149 PASSIVO 105.525,22D 46.402,37 9.656,44 142.271,15D", is_bold=True)
    assert item is not None
    assert item.tipo == "S"


def test_parse_row_credor_sem_ponto_de_milhar():
    item, _ = _parse_row("192 FGTS A RECOLHER 144,00C 144,00 144,00 144,00C", is_bold=False)
    assert item is not None
    assert item.saldo_anterior_cents == 14_400
    assert item.saldo_anterior_natureza == "C"
    assert item.saldo_atual_natureza == "C"


def test_parse_row_nao_reconhecida_devolve_none():
    item, warn = _parse_row("Sistema licenciado para MASTRO CONTABIL", is_bold=False)
    assert item is None
    assert warn is None


def test_parse_row_caractere_inesperado_gera_warning():
    item, warn = _parse_row("10002 ASSOCIA�ÃO EDUCACIONAL 0,00 10,00 10,00 0,00", is_bold=False)
    assert item is not None
    assert warn is not None
    assert "10002" in warn


def test_process_lines_para_no_resumo_do_balancete():
    lines = [
        ("1 ATIVO 84.145,97D 139.855,61 143.877,89 80.123,69D", True),
        ("RESUMO DO BALANCETE", False),
        ("2 ATIVO CIRCULANTE 80.034,24D 133.001,07 137.023,35 76.011,96D", True),
    ]
    items, warnings, stop = _process_lines(lines, set())
    assert stop is True
    assert [i.codigo for i in items] == ["1"]
    assert warnings == []


def test_process_lines_dedup_mantem_primeira_ocorrencia():
    lines = [
        ("536 BANCO ITAU UNIBANCO 12.684,98C 50.527,48 53.902,84 16.060,34C", False),
        ("536 BANCO ITAU UNIBANCO 0,00 0,00 0,00 0,00", False),
    ]
    items, warnings, stop = _process_lines(lines, set())
    assert stop is False
    assert len(items) == 1
    assert items[0].saldo_anterior_cents == 1_268_498
    assert any("536" in w and "duplicado" in w for w in warnings)


def test_process_lines_linha_nao_reconhecida_vira_warning():
    items, warnings, stop = _process_lines([("isso não é uma linha de conta", False)], set())
    assert items == []
    assert len(warnings) == 1
    assert "não reconhecida" in warnings[0]


def test_process_lines_boilerplate_nao_gera_warning():
    lines = [
        ("Empresa: CLIENTE TESTE LTDA Folha: 0001", False),
        ("C.N.P.J.: 00.000.000/0001-00", False),
        ("Período: 01/06/2026 - 30/06/2026", False),
        ("BALANCETE", False),
        ("CódigoDescrição da conta Saldo Anterior Débito Crédito Saldo Atual", False),
    ]
    items, warnings, stop = _process_lines(lines, set())
    assert items == []
    assert warnings == []
    assert stop is False


def test_extract_periodo_mes_fechado_valido():
    periodo = _extract_periodo("Período: 01/06/2026 - 30/06/2026")
    assert periodo.ano == 2026
    assert periodo.mes == 6


def test_extract_periodo_fevereiro_bissexto():
    periodo = _extract_periodo("Período: 01/02/2024 - 29/02/2024")
    assert periodo.ano == 2024
    assert periodo.mes == 2


def test_extract_periodo_sem_periodo_no_texto():
    with pytest.raises(UnreadablePdfError):
        _extract_periodo("nada relevante aqui")


def test_extract_periodo_range_parcial_rejeitado():
    with pytest.raises(UnreadablePdfError):
        _extract_periodo("Período: 05/06/2026 - 20/06/2026")


def test_extract_periodo_multiplos_meses_rejeitado():
    with pytest.raises(UnreadablePdfError):
        _extract_periodo("Período: 01/06/2026 - 31/07/2026")
