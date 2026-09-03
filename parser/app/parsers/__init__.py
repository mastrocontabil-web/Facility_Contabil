from __future__ import annotations

from ..schemas import FileFormat, ParseResult
from .detect import detect_format
from .excel import EncryptedFileError, parse_xls, parse_xlsx
from .ofx import parse_ofx
from .pdf import EncryptedPdfError, UnreadablePdfError, parse_pdf
from .tabular import parse_csv

__all__ = [
    "detect_format",
    "parse_statement",
    "UnsupportedFormatError",
    "EncryptedFileError",
    "EncryptedPdfError",
]


class UnsupportedFormatError(Exception):
    def __init__(self, fmt: str, hint: str | None = None):
        super().__init__(f"formato não suportado: {fmt}")
        self.fmt = fmt
        self.hint = hint


def parse_statement(
    filename: str,
    content: bytes,
    hint_format: str | None = None,
    pdf_password: str | None = None,
) -> ParseResult:
    fmt: FileFormat = hint_format or detect_format(filename, content)  # type: ignore[assignment]

    if fmt == "ofx":
        return parse_ofx(content)
    if fmt == "csv":
        return parse_csv(content)
    if fmt == "xlsx":
        return parse_xlsx(content)
    if fmt == "xls":
        return parse_xls(content)
    if fmt == "pdf":
        return parse_pdf(content, pdf_password)

    raise UnsupportedFormatError(fmt or "desconhecido")
