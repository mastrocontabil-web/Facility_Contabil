"""Bateria contra a pasta C:\\SEFIP\\EXTRATOS — um banco por subpasta.

Para cada subpasta, todos os formatos (OFX/CSV/PDF/XLSX/TXT) têm que dar o MESMO
resultado (mesma contagem e mesmos totais de entrada/saída). Referência: OFX se
tiver, senão CSV, senão o primeiro formato. Pulado se a pasta não existe.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

import pytest

from app.parsers import parse_statement
from app.parsers.excel import EncryptedFileError
from app.parsers.ofx import parse_ofx
from app.parsers.pdf import _MONEY, EncryptedPdfError, _looks_like_bb_extrato_cc, extract_pdf_text

SEFIP = Path(os.getenv("SEFIP_DIR", r"C:\SEFIP\EXTRATOS"))

pytestmark = pytest.mark.skipif(not SEFIP.exists(), reason=f"{SEFIP} não acessível")

_EXTS = ("ofx", "qfx", "csv", "pdf", "xlsx", "xls", "txt")
_PRIO = {e: i for i, e in enumerate(("ofx", "qfx", "csv", "txt", "xlsx", "xls", "pdf"))}


def _totais(r):
    e = [t for t in r.transactions if t.direction == "entrada"]
    s = [t for t in r.transactions if t.direction == "saida"]
    return (len(e), sum(t.amount_cents for t in e), len(s), sum(t.amount_cents for t in s))


def _parse(f: Path):
    ext = f.suffix.lower().lstrip(".")
    if ext in ("ofx", "qfx"):
        return _totais(parse_ofx(f.read_bytes()))
    return _totais(parse_statement(f.name, f.read_bytes()))


def _folders():
    if not SEFIP.exists():
        return []
    out = []
    for d in sorted(SEFIP.iterdir()):
        if d.is_dir() and any(f.suffix.lower().lstrip(".") in _EXTS for f in d.iterdir()):
            out.append(d)
    return out


@pytest.mark.parametrize("folder", _folders(), ids=lambda d: d.name)
def test_formatos_batem(folder: Path):
    files = sorted(
        (f for f in folder.iterdir() if f.suffix.lower().lstrip(".") in _EXTS),
        key=lambda f: _PRIO.get(f.suffix.lower().lstrip("."), 99),
    )
    resultados: dict[str, tuple] = {}
    for f in files:
        try:
            resultados[f.name] = _parse(f)
        except EncryptedFileError:
            pass  # planilha protegida — ok, é pra dar erro claro

    assert resultados, f"{folder.name}: nenhum formato leu"
    ref_nome, ref = next(iter(resultados.items()))
    assert ref[0] + ref[2] > 0, f"{ref_nome} sem transações"

    for nome, got in resultados.items():
        assert got == ref, f"{folder.name}: {nome} diverge de {ref_nome}: {got} != {ref}"


_SALDO_IMPRESSO_RE = re.compile(rf"(Saldo Anterior|S A L D O)\s+({_MONEY}) \(([+-])\)")


def _cents(valor: str, sinal: str) -> int:
    c = int(valor.replace(".", "").replace(",", ""))
    return -c if sinal == "-" else c


def test_bb_extrato_cc_fecha_com_o_saldo_impresso():
    """Pasta só com PDF não tem outro formato pra comparar — o test acima passa
    mesmo lendo tudo com o sinal errado. No BB "Extrato de Conta Corrente" a
    prova é o próprio extrato: saldo anterior + entradas − saídas = saldo final."""
    casos = []
    for pasta in _folders():
        for f in sorted(pasta.iterdir()):
            if f.suffix.lower() != ".pdf":
                continue
            try:
                texto = extract_pdf_text(f.read_bytes(), None)
            except EncryptedPdfError:
                continue
            if _looks_like_bb_extrato_cc(texto):
                casos.append((f, texto))
    if not casos:
        pytest.skip("nenhum PDF BB 'Extrato de Conta Corrente' na bateria")

    for f, texto in casos:
        saldos = {nome: _cents(v, s) for nome, v, s in _SALDO_IMPRESSO_RE.findall(texto)}
        assert {"Saldo Anterior", "S A L D O"} <= saldos.keys(), f"{f}: saldos impressos não achados"
        n_e, ent, n_s, sai = _totais(parse_statement(f.name, f.read_bytes()))
        assert saldos["Saldo Anterior"] + ent - sai == saldos["S A L D O"], (
            f"{f.parent.name}/{f.name}: {n_e} entradas ({ent}) e {n_s} saídas ({sai}) "
            f"não fecham {saldos['Saldo Anterior']} → {saldos['S A L D O']}"
        )
