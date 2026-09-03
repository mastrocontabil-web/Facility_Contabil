"""Testes contra extratos reais do Drive (pulados se o Drive não estiver montado).

A ideia: pro mesmo cliente/conta/mês, CSV, OFX e PDF têm que dar o MESMO
resultado (mesma quantidade de lançamentos e mesmos totais).
"""

from __future__ import annotations

from app.parsers import parse_statement
from app.parsers.excel import EncryptedFileError
from app.parsers.ofx import parse_ofx


def _totais(r):
    e = sum(t.amount_cents for t in r.transactions if t.direction == "entrada")
    s = sum(t.amount_cents for t in r.transactions if t.direction == "saida")
    ne = sum(1 for t in r.transactions if t.direction == "entrada")
    ns = sum(1 for t in r.transactions if t.direction == "saida")
    return (ne, e, ns, s)


def test_bb_csv_ofx_pdf_batem(bb_samples):
    rc = parse_statement("e.csv", bb_samples["csv"])
    ro = parse_ofx(bb_samples["ofx"])
    rp = parse_statement("e.pdf", bb_samples["pdf"])

    assert _totais(rc) == _totais(ro), "CSV do BB diverge do OFX"
    assert _totais(rp) == _totais(ro), "PDF do BB diverge do OFX"
    assert _totais(rc) == (14, 30491119, 143, 30491119)


def test_itau_pdf_bate_com_ofx(itau_samples):
    ro = parse_ofx(itau_samples["ofx"])
    rp = parse_statement("e.pdf", itau_samples["pdf"])
    assert _totais(rp) == _totais(ro), "PDF do Itaú diverge do OFX"
    assert _totais(ro) == (16, 5052748, 28, 5390284)


def test_nubank_csv_ofx_batem(nubank_samples):
    rc = parse_statement("e.csv", nubank_samples["csv"])
    ro = parse_ofx(nubank_samples["ofx"])
    assert _totais(rc) == _totais(ro)
    assert _totais(rc) == (11, 1126300, 50, 1084399)


def test_nubank_pdf_bate_com_ofx(nubank_pdf_samples):
    ro = parse_ofx(nubank_pdf_samples["ofx"])
    rc = parse_statement("e.csv", nubank_pdf_samples["csv"])
    rp = parse_statement("e.pdf", nubank_pdf_samples["pdf"])
    assert _totais(rc) == _totais(ro)
    assert _totais(rp) == _totais(ro), "PDF do Nubank diverge do OFX"
    assert rp.period_start == ro.period_start and rp.period_end == ro.period_end


def test_c6_xls_protegido_da_erro_claro(c6_encrypted_xls):
    try:
        parse_statement("extrato.xlsx", c6_encrypted_xls)
        raise AssertionError("deveria ter levantado EncryptedFileError")
    except EncryptedFileError as e:
        assert "senha" in str(e).lower()
