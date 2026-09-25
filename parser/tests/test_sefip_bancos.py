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

from app.parsers import NotAStatementError, parse_statement
from app.parsers.excel import EncryptedFileError
from app.parsers.ofx import parse_ofx
from app.parsers.pdf import (
    _MONEY,
    EncryptedPdfError,
    _looks_like_bb_extrato_cc,
    _looks_like_mercadopago,
    extract_pdf_text,
)
from app.parsers.planilha import ler_planilha, parse_planilha
from app.parsers.tabular import _norm
from app.schemas import ExcelMapeamento

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
        except (EncryptedFileError, NotAStatementError):
            pass  # planilha protegida / relatório que não é extrato — ok, é pra dar erro claro

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


_MP_RESUMO_RE = re.compile(rf"(Entradas|Sa[íi]das|Saldo inicial|Saldo final):\s*R\$\s*(-?)({_MONEY})")


def test_mercadopago_fecha_com_o_resumo_impresso():
    """Mesmo caso do BB acima: o "Extrato de conta" do Mercado Pago vem sem
    OFX/CSV equivalente (o CSV que o banco dá é só o relatório de vendas). A
    prova é o resumo impresso no topo — total de entradas, de saídas, saldo
    inicial e final — e o próprio leitor confere a coluna Saldo linha a linha."""
    casos = []
    for pasta in _folders():
        for f in sorted(pasta.iterdir()):
            if f.suffix.lower() != ".pdf":
                continue
            try:
                texto = extract_pdf_text(f.read_bytes(), None)
            except EncryptedPdfError:
                continue
            if _looks_like_mercadopago(texto):
                casos.append((f, texto))
    if not casos:
        pytest.skip("nenhum PDF Mercado Pago 'Extrato de conta' na bateria")

    for f, texto in casos:
        resumo = {nome.replace("í", "i"): _cents(v, s or "+") for nome, s, v in _MP_RESUMO_RE.findall(texto)}
        assert {"Entradas", "Saidas", "Saldo inicial", "Saldo final"} <= resumo.keys(), f"{f}: resumo não achado"
        r = parse_statement(f.name, f.read_bytes())
        _, ent, _, sai = _totais(r)
        onde = f"{f.parent.name}/{f.name}"
        assert ent == resumo["Entradas"], f"{onde}: entradas lidas {ent} != impressas {resumo['Entradas']}"
        assert -sai == resumo["Saidas"], f"{onde}: saídas lidas {sai} != impressas {-resumo['Saidas']}"
        assert resumo["Saldo inicial"] + ent - sai == resumo["Saldo final"], f"{onde}: saldo não fecha"
        assert not [w for w in r.warnings if "saldo" in w], f"{onde}: {r.warnings}"


# Mesma regra da prévia da tela (frontend/src/features/import/excel/planilha.ts):
# linha cujo histórico começa com "saldo"/"total" nasce fora da importação.
_PARECE_SALDO = re.compile(r"^(s\s*a\s*l\s*d\s*o\b(?!\s+de\b)|(sub\s*)?tota(l|is)\b)")


def test_planilhas_pela_importacao_excel_batem_com_o_leitor_automatico():
    """As planilhas de banco da bateria, lidas pela "Nova importação Excel" com as
    colunas sugeridas pelo cabeçalho (e as linhas de saldo tiradas, como a tela
    faz), têm que dar os mesmos lançamentos do leitor automático."""
    casos = [f for pasta in _folders() for f in sorted(pasta.iterdir()) if f.suffix.lower() in (".xlsx", ".xls")]
    lidos = 0
    for f in casos:
        conteudo = f.read_bytes()
        try:
            auto = parse_statement(f.name, conteudo)
            g = ler_planilha(conteudo)
        except (EncryptedFileError, NotAStatementError):
            continue
        onde = f"{f.parent.name}/{f.name}"
        s = g.sugestao
        assert s and s.data is not None and s.valor is not None and s.historico, f"{onde}: sem sugestão"

        excluir = []
        for linha in g.linhas:
            def cel(i, c=linha.c):
                return c[i] if i < len(c) else None

            historico = " - ".join(c.t for c in map(cel, s.historico) if c and c.t)
            if cel(s.data) and cel(s.data).d and cel(s.valor) and cel(s.valor).v and _PARECE_SALDO.match(
                _norm(historico)
            ):
                excluir.append(linha.n)

        mapa = ExcelMapeamento(aba=g.aba, data=s.data, valor=s.valor, historico=s.historico, excluir=excluir)
        r = parse_planilha(conteudo, mapa)
        chave = lambda x: [(t.date, t.direction, t.amount_cents) for t in x.transactions]  # noqa: E731
        assert chave(r) == chave(auto), f"{onde}: importação Excel diverge do leitor automático"
        lidos += 1
    if not lidos:
        pytest.skip("nenhuma planilha legível na bateria")
