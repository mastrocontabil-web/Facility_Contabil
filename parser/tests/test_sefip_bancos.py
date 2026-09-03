"""Bateria contra a pasta C:\\SEFIP\\EXTRATOS — um banco por subpasta.

Para cada subpasta com OFX, o CSV e o PDF têm que dar o MESMO resultado (mesma
contagem e mesmos totais de entrada/saída). Pulado se a pasta não existe.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from app.parsers import parse_statement
from app.parsers.ofx import parse_ofx

SEFIP = Path(os.getenv("SEFIP_DIR", r"C:\SEFIP\EXTRATOS"))

pytestmark = pytest.mark.skipif(not SEFIP.exists(), reason=f"{SEFIP} não acessível")


def _totais(r):
    e = [t for t in r.transactions if t.direction == "entrada"]
    s = [t for t in r.transactions if t.direction == "saida"]
    return (len(e), sum(t.amount_cents for t in e), len(s), sum(t.amount_cents for t in s))


def _folders_with_ofx():
    if not SEFIP.exists():
        return []
    out = []
    for d in sorted(SEFIP.iterdir()):
        if d.is_dir() and any(f.suffix.lower() == ".ofx" for f in d.iterdir()):
            out.append(d)
    return out


@pytest.mark.parametrize("folder", _folders_with_ofx(), ids=lambda d: d.name)
def test_formatos_batem_com_ofx(folder: Path):
    files = list(folder.iterdir())
    ofx = next(f for f in files if f.suffix.lower() == ".ofx")
    ref = _totais(parse_ofx(ofx.read_bytes()))
    assert ref[0] + ref[2] > 0, "OFX de referência sem transações"

    for f in files:
        ext = f.suffix.lower().lstrip(".")
        if ext not in ("csv", "pdf"):
            continue
        got = _totais(parse_statement(f.name, f.read_bytes()))
        assert got == ref, f"{f.name} diverge do OFX: {got} != {ref}"
