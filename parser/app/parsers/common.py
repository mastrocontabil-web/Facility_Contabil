from __future__ import annotations

import re
from datetime import date
from decimal import Decimal, InvalidOperation

_DATE_PATTERNS = [
    re.compile(r"^(\d{2})[/.](\d{2})[/.](\d{4})$"),  # dd/mm/aaaa | dd.mm.aaaa
    re.compile(r"^(\d{2})[/.](\d{2})[/.](\d{2})$"),  # dd/mm/aa
    re.compile(r"^(\d{4})-(\d{2})-(\d{2})$"),  # aaaa-mm-dd (ISO)
]


def decode_bytes(content: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    return content.decode("latin-1", errors="replace")


def parse_date(value: str) -> date | None:
    s = (value or "").strip()
    if not s:
        return None
    for i, pat in enumerate(_DATE_PATTERNS):
        m = pat.match(s)
        if not m:
            continue
        try:
            if i == 2:  # ISO
                return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            d, mth, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if i == 1:  # 2-digit year
                y += 2000 if y < 70 else 1900
            return date(y, mth, d)
        except ValueError:
            return None
    return None


def parse_money(value: str) -> Decimal | None:
    """Aceita '1.234,56', '1234.56', '1,234.56', 'R$ -10,00', '10,00-', '(10,00)'."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None

    negative = False
    if s.startswith("(") and s.endswith(")"):
        negative = True
        s = s[1:-1]
    if s.endswith("-"):
        negative = True
        s = s[:-1]
    if s.startswith("-"):
        negative = True
        s = s[1:]

    s = re.sub(r"[^\d.,]", "", s)
    if not s:
        return None

    if "," in s and "." in s:
        # o último separador é o decimal
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        # vírgula decimal (padrão BR) — a menos que pareça separador de milhar
        if re.match(r"^\d{1,3}(,\d{3})+$", s):
            s = s.replace(",", "")
        else:
            s = s.replace(",", ".")

    try:
        d = Decimal(s)
    except (InvalidOperation, ValueError):
        return None
    return -d if negative else d


def to_cents(amount: Decimal) -> int:
    return int((abs(amount) * 100).quantize(Decimal("1")))


DEBIT_HINTS = {"d", "debito", "débito", "debit", "saida", "saída", "-"}
CREDIT_HINTS = {"c", "credito", "crédito", "credit", "entrada", "+"}


def direction_from_indicator(value: str) -> str | None:
    v = (value or "").strip().lower()
    if v in DEBIT_HINTS:
        return "saida"
    if v in CREDIT_HINTS:
        return "entrada"
    return None
