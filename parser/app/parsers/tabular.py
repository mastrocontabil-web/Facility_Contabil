"""Leitura genérica de extrato em tabela (CSV e planilhas)."""

from __future__ import annotations

import csv
import io
import re
import unicodedata
from datetime import date

from ..schemas import NormalizedTransaction, ParseResult
from .common import (
    direction_from_indicator,
    parse_date,
    parse_money,
    to_cents,
)


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    return s.strip().lower()


DATE_HEADERS = {"data", "data lancamento", "data movimento", "data mov", "date", "dt", "dt movimento", "data da transacao"}
DESC_HEADERS = {"descricao", "historico", "lancamento", "detalhe", "memo", "descricao/historico", "titulo", "descriçao"}
AMOUNT_HEADERS = {"valor", "valor (r$)", "amount", "valor lancamento", "vlr", "montante"}
DEBIT_HEADERS = {"debito", "saida", "pagamento", "valor debito", "debit"}
CREDIT_HEADERS = {"credito", "entrada", "recebimento", "valor credito", "credit"}
INDICATOR_HEADERS = {"tipo", "d/c", "c/d", "natureza", "indicador", "tipo lancamento", "debito/credito"}
BALANCE_HEADERS = {"saldo", "saldo (r$)", "balance", "saldo apos"}

Rows = list[list[str]]


def rows_to_result(rows: Rows, fmt: str) -> ParseResult:
    """Recebe as linhas já como lista de listas de strings e monta o resultado."""
    rows = [r for r in rows if any(str(c).strip() for c in r)]
    if not rows:
        return ParseResult(format=fmt, warnings=["arquivo sem linhas"])

    header_idx = _find_header(rows)
    warnings: list[str] = []

    if header_idx is None:
        # sem cabeçalho reconhecível: tenta layout Banco do Brasil (posicional ;)
        bb = _try_bb_layout(rows, fmt)
        if bb is not None:
            return bb
        # fallback: adivinha colunas por conteúdo
        cols = _guess_columns_by_content(rows)
        data_rows = rows
        if cols is None:
            return ParseResult(
                format=fmt,
                warnings=["não reconheci as colunas do extrato — verifique o arquivo"],
            )
    else:
        header = [_norm(c) for c in rows[header_idx]]
        data_rows = rows[header_idx + 1 :]
        cols = _map_columns_from_header(header)
        if cols is None:
            cols = _guess_columns_by_content(data_rows)
        if cols is None:
            return ParseResult(
                format=fmt, warnings=["cabeçalho encontrado mas não identifiquei data/valor"]
            )

    txns: list[NormalizedTransaction] = []
    seen: list[date] = []
    for i, row in enumerate(data_rows):
        try:
            t = _row_to_txn(row, cols)
        except Exception:  # noqa: BLE001
            t = None
        if t is None:
            continue
        d = date.fromisoformat(t.date)
        seen.append(d)
        t.raw["ordem"] = i
        txns.append(t)

    if not txns:
        warnings.append("nenhuma transação reconhecida nas linhas de dados")

    return ParseResult(
        format=fmt,
        period_start=min(seen).isoformat() if seen else None,
        period_end=max(seen).isoformat() if seen else None,
        transactions=txns,
        warnings=warnings,
    )


# --------------------------------------------------------------------------- #
# detecção de cabeçalho / colunas
# --------------------------------------------------------------------------- #
def _find_header(rows: Rows) -> int | None:
    for idx, row in enumerate(rows[:15]):
        cells = [_norm(c) for c in row]
        has_date = any("data" in c or c == "dt" or c == "date" for c in cells)
        has_val = any(
            any(k in c for k in ("valor", "credito", "debito", "amount", "montante", "vlr"))
            for c in cells
        )
        if has_date and has_val:
            return idx
    return None


def _map_columns_from_header(header: list[str]) -> dict | None:
    def find(cands: set[str], contains: tuple[str, ...] = ()) -> int | None:
        for i, h in enumerate(header):
            if h in cands or any(x in h for x in contains):
                return i
        return None

    date_i = find(DATE_HEADERS, ("data", "date"))
    desc_i = find(DESC_HEADERS, ("descri", "histor", "lancamento", "memo"))
    amount_i = find(AMOUNT_HEADERS, ("valor", "amount"))
    debit_i = find(DEBIT_HEADERS, ("debito",))
    credit_i = find(CREDIT_HEADERS, ("credito",))
    ind_i = find(INDICATOR_HEADERS, ("d/c", "c/d"))
    bal_i = find(BALANCE_HEADERS, ("saldo", "balance"))

    if amount_i is not None and amount_i == debit_i:
        debit_i = None
    if amount_i is not None and amount_i == credit_i:
        credit_i = None
    if bal_i is not None and bal_i == amount_i:
        bal_i = None

    if date_i is None:
        return None
    if amount_i is None and (debit_i is None and credit_i is None):
        return None

    return {
        "date": date_i,
        "desc": desc_i,
        "amount": amount_i,
        "debit": debit_i,
        "credit": credit_i,
        "indicator": ind_i,
        "balance": bal_i,
    }


def _guess_columns_by_content(rows: Rows) -> dict | None:
    if not rows:
        return None
    width = max(len(r) for r in rows)
    sample = rows[: min(len(rows), 60)]

    date_score = [0] * width
    money_score = [0] * width
    text_len = [0] * width
    signed = [0] * width
    for r in sample:
        for c in range(width):
            v = r[c].strip() if c < len(r) else ""
            if not v:
                continue
            if parse_date(v):
                date_score[c] += 1
            m = parse_money(v)
            if m is not None and re.search(r"\d", v) and (any(ch in v for ch in ".,") or v.lstrip("-").isdigit()):
                money_score[c] += 1
                if m < 0 or v.strip().endswith("-") or v.strip().startswith("("):
                    signed[c] += 1
            if not parse_date(v):
                text_len[c] += len(v)

    date_i = max(range(width), key=lambda c: date_score[c])
    if date_score[date_i] == 0:
        return None

    money_cols = [c for c in range(width) if money_score[c] >= max(3, len(sample) // 3)]
    money_cols = [c for c in money_cols if c != date_i]
    if not money_cols:
        return None

    # coluna de valor: prefere a que tem sinal; senão a primeira
    amount_i = max(money_cols, key=lambda c: (signed[c], -c))
    desc_i = max(
        (c for c in range(width) if c != date_i and c not in money_cols),
        key=lambda c: text_len[c],
        default=None,
    )

    return {
        "date": date_i,
        "desc": desc_i,
        "amount": amount_i,
        "debit": None,
        "credit": None,
        "indicator": None,
        "balance": None,
    }


def _row_to_txn(row: list[str], cols: dict) -> NormalizedTransaction | None:
    def cell(i: int | None) -> str:
        return row[i].strip() if i is not None and i < len(row) else ""

    d = parse_date(cell(cols["date"]))
    if not d:
        return None

    desc = cell(cols["desc"])

    amount = None
    direction = None
    if cols.get("debit") is not None or cols.get("credit") is not None:
        deb = parse_money(cell(cols.get("debit")))
        cred = parse_money(cell(cols.get("credit")))
        if deb and deb != 0:
            amount, direction = deb, "saida"
        elif cred and cred != 0:
            amount, direction = cred, "entrada"
        else:
            return None
    else:
        amount = parse_money(cell(cols["amount"]))
        if amount is None:
            return None
        ind = direction_from_indicator(cell(cols.get("indicator")))
        if ind:
            direction = ind
        elif amount < 0:
            direction = "saida"
        elif amount > 0:
            direction = "entrada"
        else:
            return None

    low = _norm(desc)
    if re.match(
        r"^(s\s*a\s*l\s*d\s*o$|saldo\b|saldo total|saldo do dia|saldo anterior|"
        r"saldo final|saldo em conta|saldo inicial|saldo disponivel|saldo bloq)",
        low,
    ):
        return None

    return NormalizedTransaction(
        date=d.isoformat(),
        description=re.sub(r"\s+", " ", desc).strip(),
        amount_cents=to_cents(amount),
        direction=direction,
        raw={},
    )


# --------------------------------------------------------------------------- #
# Banco do Brasil — CSV posicional (;), sem cabeçalho
#   agencia;conta; ;dtBalancete;dtMov;agOrigem;?;doc;codHist;histTexto;valor;D/C;complemento
# --------------------------------------------------------------------------- #
def _try_bb_layout(rows: Rows, fmt: str) -> ParseResult | None:
    hits = 0
    for r in rows[:20]:
        if len(r) >= 12 and parse_date(r[3].strip()) and r[11].strip().upper() in ("D", "C"):
            hits += 1
    if hits < 3:
        return None

    txns: list[NormalizedTransaction] = []
    seen: list[date] = []
    for i, r in enumerate(rows):
        if len(r) < 12:
            continue
        d = parse_date(r[3].strip())
        dc = r[11].strip().upper()
        val = parse_money(r[10])
        if not d or dc not in ("D", "C") or val is None:
            continue
        hist_txt = r[9].strip()
        compl = r[12].strip() if len(r) > 12 else ""
        if _norm(hist_txt) in ("saldo anterior", "s a l d o", "saldo"):
            continue
        desc = f"{hist_txt} - {compl}".strip(" -") if compl else hist_txt
        seen.append(d)
        txns.append(
            NormalizedTransaction(
                date=d.isoformat(),
                description=re.sub(r"\s+", " ", desc).strip(),
                amount_cents=to_cents(val),
                direction="saida" if dc == "D" else "entrada",
                raw={"cod_hist_banco": r[8].strip(), "doc": r[7].strip(), "ordem": i},
            )
        )

    if not txns:
        return None
    return ParseResult(
        format=fmt,
        bank_id="001",
        period_start=min(seen).isoformat(),
        period_end=max(seen).isoformat(),
        transactions=txns,
        warnings=[],
    )


# --------------------------------------------------------------------------- #
# entrada CSV
# --------------------------------------------------------------------------- #
def _sniff_delimiter(text: str) -> str:
    sample = "\n".join(text.splitlines()[:20])
    counts = {d: sample.count(d) for d in (";", ",", "\t", "|")}
    best = max(counts, key=lambda d: counts[d])
    return best if counts[best] else ","


def parse_csv(content: bytes) -> ParseResult:
    from .common import decode_bytes

    text = decode_bytes(content)
    # Normaliza quebras: alguns bancos (Bradesco) exportam com CR sozinho, o que
    # faz o csv.reader engasgar ("new-line character seen in unquoted field").
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    delimiter = _sniff_delimiter(text)
    try:
        reader = csv.reader(io.StringIO(text), delimiter=delimiter)
        rows = [list(row) for row in reader]
    except csv.Error:
        # último recurso: split manual por linha e delimitador
        rows = [ln.split(delimiter) for ln in text.split("\n")]
    return rows_to_result(rows, "csv")
