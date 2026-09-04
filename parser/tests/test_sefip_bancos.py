"""Bateria contra a pasta C:\\SEFIP\\EXTRATOS — um banco por subpasta.

Para cada subpasta, todos os formatos (OFX/CSV/PDF/XLSX/TXT) têm que dar o MESMO
resultado (mesma contagem e mesmos totais de entrada/saída). Referência: OFX se
tiver, senão CSV, senão o primeiro formato. Pulado se a pasta não existe.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from app.parsers import parse_statement
from app.parsers.excel import EncryptedFileError
from app.parsers.ofx import parse_ofx

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
