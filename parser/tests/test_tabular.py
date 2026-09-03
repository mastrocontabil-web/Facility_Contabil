from __future__ import annotations

from pathlib import Path

from app.parsers import parse_statement
from app.parsers.tabular import parse_csv

FIX = Path(__file__).parent / "fixtures"


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


def test_detecta_ofx_como_csv_txt(tmp_path):
    # arquivo .txt que é OFX deve ser tratado como OFX
    ofx = (FIX / "sample.ofx").read_bytes()
    r = parse_statement("extrato.txt", ofx)
    assert r.format == "ofx"
