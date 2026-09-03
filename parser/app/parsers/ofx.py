from __future__ import annotations

import html
import re
from datetime import date
from decimal import Decimal, InvalidOperation

from ..schemas import NormalizedTransaction, ParseResult

_STMTTRN_RE = re.compile(r"<STMTTRN>(.*?)</STMTTRN>", re.IGNORECASE | re.DOTALL)


def _decode(content: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    return content.decode("latin-1", errors="replace")


def _tag(block: str, name: str) -> str | None:
    # OFX SGML: <TAG>valor  (sem fechamento). Pega até o próximo '<' ou fim de linha.
    m = re.search(rf"<{name}>([^<\r\n]*)", block, re.IGNORECASE)
    if not m:
        return None
    return html.unescape(m.group(1).strip()) or None


def _parse_ofx_date(value: str | None) -> date | None:
    if not value:
        return None
    digits = re.sub(r"\D", "", value)[:8]
    if len(digits) != 8:
        return None
    try:
        return date(int(digits[:4]), int(digits[4:6]), int(digits[6:8]))
    except ValueError:
        return None


def _parse_amount(value: str | None) -> Decimal | None:
    if value is None:
        return None
    v = value.strip().replace(" ", "")
    if "," in v and "." not in v:
        v = v.replace(",", ".")
    else:
        v = v.replace(",", "")
    try:
        return Decimal(v)
    except (InvalidOperation, ValueError):
        return None


def parse_ofx(content: bytes) -> ParseResult:
    text = _decode(content)

    bank_id = _tag(text, "BANKID")
    account_id = _tag(text, "ACCTID")
    # DTSTART/DTEND são pouco confiáveis (o OFX do C6, por ex., coloca ali o
    # timestamp de geração do arquivo, não o período do extrato). Usamos como
    # fallback; o período real vem do min/max das transações.
    declared_start = _parse_ofx_date(_tag(text, "DTSTART"))
    declared_end = _parse_ofx_date(_tag(text, "DTEND"))

    txns: list[NormalizedTransaction] = []
    warnings: list[str] = []
    seen_dates: list[date] = []

    for idx, block in enumerate(_STMTTRN_RE.findall(text)):
        d = _parse_ofx_date(_tag(block, "DTPOSTED"))
        amount = _parse_amount(_tag(block, "TRNAMT"))
        trntype = (_tag(block, "TRNTYPE") or "").upper()
        memo = _tag(block, "MEMO") or _tag(block, "NAME") or ""
        fitid = _tag(block, "FITID")

        if d is None or amount is None:
            warnings.append(f"transação {idx + 1} ignorada (data/valor ilegível)")
            continue

        if amount > 0:
            direction = "entrada"
        elif amount < 0:
            direction = "saida"
        else:
            direction = "entrada" if trntype in ("CREDIT", "DEP", "INT", "DIRECTDEP") else "saida"

        seen_dates.append(d)
        txns.append(
            NormalizedTransaction(
                date=d.isoformat(),
                description=re.sub(r"\s+", " ", memo).strip(),
                amount_cents=int((abs(amount) * 100).quantize(Decimal("1"))),
                direction=direction,
                raw={"trntype": trntype, "fitid": fitid, "trnamt": str(amount)},
            )
        )

    if not txns:
        warnings.append("nenhuma transação <STMTTRN> encontrada no OFX")

    # Período = min/max das datas das transações (é o que o cabeçalho Domínio usa).
    # DTSTART/DTEND só entram se não houver transação nenhuma.
    dt_start = min(seen_dates) if seen_dates else declared_start
    dt_end = max(seen_dates) if seen_dates else declared_end

    return ParseResult(
        format="ofx",
        bank_id=bank_id,
        account_id=account_id,
        period_start=dt_start.isoformat() if dt_start else None,
        period_end=dt_end.isoformat() if dt_end else None,
        transactions=txns,
        warnings=warnings,
    )
