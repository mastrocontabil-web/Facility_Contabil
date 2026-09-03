from __future__ import annotations

import logging

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from .config import MAX_UPLOAD_BYTES
from .parsers import (
    EncryptedFileError,
    EncryptedPdfError,
    UnsupportedFormatError,
    parse_statement,
)
from .parsers.pdf import UnreadablePdfError
from .schemas import ParseResult
from .security import require_shared_secret

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("parser")

app = FastAPI(title="Parser de Extratos", version="0.2.0")


@app.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "service": "parser"}


@app.post("/parse", response_model=ParseResult, dependencies=[Depends(require_shared_secret)])
async def parse(
    file: UploadFile = File(...),
    hint_format: str | None = Form(default=None),
    pdf_password: str | None = Form(default=None),
) -> ParseResult:
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="arquivo muito grande")
    if not content:
        raise HTTPException(status_code=400, detail="arquivo vazio")

    filename = file.filename or "extrato"
    try:
        result = parse_statement(filename, content, hint_format, pdf_password)
    except UnsupportedFormatError as exc:
        return JSONResponse(
            status_code=422, content={"error": str(exc), "format": exc.fmt, "hint": exc.hint}
        )
    except (EncryptedFileError, EncryptedPdfError) as exc:
        return JSONResponse(
            status_code=422, content={"error": str(exc), "code": "encrypted"}
        )
    except UnreadablePdfError as exc:
        return JSONResponse(status_code=422, content={"error": str(exc), "code": "unreadable"})
    except Exception as exc:  # noqa: BLE001
        logger.exception("falha ao parsear %s", filename)
        raise HTTPException(status_code=422, detail=f"falha ao ler o extrato: {exc}") from exc

    logger.info(
        "parse ok: %s formato=%s txns=%d", filename, result.format, len(result.transactions)
    )
    return result
