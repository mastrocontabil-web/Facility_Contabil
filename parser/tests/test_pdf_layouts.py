"""Regressões de layout de PDF encontradas contra extratos reais."""

from __future__ import annotations

from app.parsers.pdf import _bb_unstick, _parse_bb_consultas_pdf


def test_bb_unstick_separa_lote_colado_no_valor():
    # nº de lote/documento colado no valor + saldo (visto no BB "Consultas")
    line = "01/07/2026  0000 13105144 Pix - Enviado  70.10110.000,00 D10.000,13 C"
    out = _bb_unstick(line)
    assert "70.101 10.000,00 D 10.000,13 C" in out


def test_bb_consultas_pega_o_valor_nao_o_saldo():
    # o valor da linha é 10.000,00 D (saída); 10.000,13 C é o SALDO — não pode
    # ser lido como uma entrada.
    text = "\n".join(
        [
            "Consultas - Extrato de conta corrente",
            "Ag. origem  Lote  Documento  Hist  Dt. balancete",
            "01/07/2026  0000 13105144 Pix - Enviado  70.10110.000,00 D10.000,13 C",
            "            01/07 08:13 30 043 214 WESLEY FABRICIO",
            "05/07/2026  0000 13200000 Tarifa Pacote  50,00 D9.950,13 C",
        ]
    )
    r = _parse_bb_consultas_pdf(text)
    assert len(r.transactions) == 2
    pix, tarifa = r.transactions
    assert pix.direction == "saida"
    assert pix.amount_cents == 1_000_000  # R$ 10.000,00
    assert tarifa.direction == "saida"
    assert tarifa.amount_cents == 5_000
    # nenhuma entrada fantasma vinda do saldo
    assert all(t.direction == "saida" for t in r.transactions)
