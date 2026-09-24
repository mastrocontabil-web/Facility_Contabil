from __future__ import annotations

from pathlib import Path

import pytest

from app.parsers import NotAStatementError, parse_statement
from app.parsers.tabular import parse_csv

FIX = Path(__file__).parent / "fixtures"

# Relatório de vendas do Mercado Pago (1ª linha em branco, como vem do banco).
MP_RELATORIO_VENDAS = (
    "\n"
    "OPERATION_DATETIME;RELEASE_DATETIME;MOVEMENT_TYPE;PAYMENT_ID;LOCAL;CHARGE_METHOD;"
    "PAYMENT_METHOD_DETAIL;PAYMENT_METHOD;GROSS_VALUE;SALES_DISCOUNTS;NET\n"
    "01-08-2026 08:47:55;01-08-2026 08:47:53;Pagamento;100000000001;Loja;Point;Visa;;10,50;-0,12;10,38\n"
).encode("utf-8-sig")


def _totais(r):
    e = [t for t in r.transactions if t.direction == "entrada"]
    s = [t for t in r.transactions if t.direction == "saida"]
    return len(e), sum(t.amount_cents for t in e), len(s), sum(t.amount_cents for t in s)


def test_nubank_csv():
    r = parse_csv((FIX / "nubank.csv").read_bytes())
    assert r.format == "csv"
    assert len(r.transactions) == 4
    ne, ve, ns, vs = _totais(r)
    assert (ne, ve) == (2, 234055 + 10000)
    assert (ns, vs) == (2, 1000 + 120000)
    assert r.transactions[0].direction == "saida"
    assert r.period_start == "2026-07-01" and r.period_end == "2026-07-31"


def test_bb_csv_layout():
    r = parse_csv((FIX / "bb.csv").read_bytes())
    assert r.bank_id == "001"
    # ignora "Saldo Anterior" e "S A L D O"
    assert len(r.transactions) == 3
    ne, ve, ns, vs = _totais(r)
    assert (ne, ve) == (1, 570245)
    assert (ns, vs) == (2, 1099167 + 25000)
    assert r.transactions[0].raw.get("cod_hist_banco") == "109"


def test_generico_debito_credito():
    r = parse_csv((FIX / "generico.csv").read_bytes())
    assert len(r.transactions) == 3  # SALDO ANTERIOR ignorado
    ne, ve, ns, vs = _totais(r)
    assert (ne, ve) == (1, 50000)
    assert (ns, vs) == (2, 2990 + 15000)


def test_relatorio_de_vendas_do_mercado_pago_nao_e_extrato():
    # só tem os recebimentos (maquininha/QR) — lido como extrato, a conta
    # ficaria sem as saídas e o saldo nunca fecharia
    with pytest.raises(NotAStatementError, match="relatório de vendas do Mercado Pago"):
        parse_csv(MP_RELATORIO_VENDAS)


def test_detecta_ofx_como_csv_txt(tmp_path):
    # arquivo .txt que é OFX deve ser tratado como OFX
    ofx = (FIX / "sample.ofx").read_bytes()
    r = parse_statement("extrato.txt", ofx)
    assert r.format == "ofx"
