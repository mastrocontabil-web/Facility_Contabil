"""Valida o parser OFX contra um extrato real de julho/2026 (não versionado).

191 lançamentos, 61 entradas = R$ 45.765,92, 130 saídas = R$ 41.898,10,
período 01/07 a 31/07/2026.
"""

from __future__ import annotations

from app.parsers.ofx import parse_ofx


def test_golden_ofx_totais(golden_ofx_bytes: bytes):
    result = parse_ofx(golden_ofx_bytes)

    assert result.period_start == "2026-07-01"
    assert result.period_end == "2026-07-31"
    assert len(result.transactions) == 191

    entradas = [t for t in result.transactions if t.direction == "entrada"]
    saidas = [t for t in result.transactions if t.direction == "saida"]

    assert len(entradas) == 61
    assert len(saidas) == 130
    assert sum(t.amount_cents for t in entradas) == 4_576_592  # R$ 45.765,92
    assert sum(t.amount_cents for t in saidas) == 4_189_810  # R$ 41.898,10
