from __future__ import annotations

import os

from ..schemas import FileFormat


def detect_format(filename: str, content: bytes) -> FileFormat:
    """Detecta o formato por extensão, com desempate por conteúdo.

    Casos tratados:
      - .xlsx que na verdade é .xls (OLE2, magic D0CF11E0) — visto em produção.
      - .ofx que veio como .txt.
    """
    ext = os.path.splitext(filename)[1].lower().lstrip(".")
    head = content[:8]

    if head[:4] == b"\xd0\xcf\x11\xe0":  # OLE2 compound file => .xls de verdade
        return "xls"
    if head[:2] == b"PK":  # zip => .xlsx (ou .ods, mas tratamos como xlsx)
        return "xlsx"
    if head[:4] == b"%PDF":
        return "pdf"

    sample = content[:4096].lstrip().upper()
    if sample.startswith(b"OFXHEADER") or b"<OFX>" in sample:
        return "ofx"

    if ext in ("ofx", "qfx"):
        return "ofx"
    if ext == "pdf":
        return "pdf"
    if ext == "csv" or ext == "txt":
        return "csv"
    if ext == "xlsx":
        return "xlsx"
    if ext == "xls":
        return "xls"

    # fallback: se parece texto delimitado, trata como csv
    return "csv"
