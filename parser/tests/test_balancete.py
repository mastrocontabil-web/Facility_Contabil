"""Golden test do parser de Balancete contra o PDF real do Domínio.

Pulado se tests/local_paths.py não tiver o caminho (ver conftest.py).
"""
from __future__ import annotations

from app.parsers.balancete import parse_balancete_pdf


def test_parse_balancete_real_pdf(balancete_pdf_bytes: bytes) -> None:
    result = parse_balancete_pdf(balancete_pdf_bytes)

    assert result.periodo.ano == 2026
    assert result.periodo.mes == 6

    assert len(result.items) == 104
    codigos = [i.codigo for i in result.items]
    assert len(codigos) == len(set(codigos))
    for item in result.items:
        assert item.tipo in ("S", "A")
        assert item.nome.strip() != ""
        assert item.saldo_anterior_cents >= 0
        assert item.debito_cents >= 0
        assert item.credito_cents >= 0
        assert item.saldo_atual_cents >= 0
        if item.saldo_anterior_cents == 0:
            assert item.saldo_anterior_natureza is None
        else:
            assert item.saldo_anterior_natureza in ("D", "C")
        if item.saldo_atual_cents == 0:
            assert item.saldo_atual_natureza is None
        else:
            assert item.saldo_atual_natureza in ("D", "C")

    por_codigo = {i.codigo: i for i in result.items}

    # raiz: "1 ATIVO 84.145,97D 139.855,61 143.877,89 80.123,69D"
    raiz = por_codigo["1"]
    assert raiz.nome == "ATIVO"
    assert raiz.tipo == "S"
    assert raiz.saldo_anterior_cents == 8_414_597
    assert raiz.saldo_anterior_natureza == "D"
    assert raiz.debito_cents == 13_985_561
    assert raiz.credito_cents == 14_387_789
    assert raiz.saldo_atual_cents == 8_012_369
    assert raiz.saldo_atual_natureza == "D"

    # D/C ausente em valor zero, presente em valor não-zero na MESMA linha:
    # "335 FÉRIAS 0,00 250,00 0,00 250,00D"
    ferias = por_codigo["335"]
    assert ferias.tipo == "A"
    assert ferias.saldo_anterior_cents == 0
    assert ferias.saldo_anterior_natureza is None
    assert ferias.debito_cents == 25_000
    assert ferias.credito_cents == 0
    assert ferias.saldo_atual_cents == 25_000
    assert ferias.saldo_atual_natureza == "D"

    # conta real que existe no balancete mas (por um bug do parser de plano de
    # contas do C1) não está cadastrada no plano_contas desse cliente — o
    # parser do balancete não sabe disso, só precisa continuar reconhecendo a
    # linha normalmente; o vínculo/aviso é responsabilidade do backend.
    orfa = por_codigo["10298"]
    assert "ESCRITORIO INTELIGENTE" in orfa.nome
    assert orfa.tipo == "A"

    # tipo derivado do negrito bate com o esperado pra uma amostra conhecida
    esperado = {"1": "S", "2": "S", "3": "S", "4": "S", "5": "A", "536": "A",
                "10303": "A", "12": "S", "13": "S", "10000": "A", "542": "A", "10398": "A"}
    for codigo, tipo in esperado.items():
        assert por_codigo[codigo].tipo == tipo, f"código {codigo}"

    # a seção "RESUMO DO BALANCETE" (totais recalculados) não vira conta
    assert "RESUMO DO BALANCETE" not in por_codigo
    assert not any("RESUMO" in i.nome for i in result.items)
