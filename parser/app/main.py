from __future__ import annotations

import logging

from fastapi import Depends, FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import JSONResponse

from .config import MAX_UPLOAD_BYTES
from .parsers import (
    EncryptedFileError,
    EncryptedPdfError,
    UnsupportedFormatError,
    parse_balancete_pdf,
    parse_plano_contas_pdf,
    parse_statement,
)
from .parsers.pdf import UnreadablePdfError
from .reports.balancete_pdf import build_balancete_pdf
from .reports.dre_pdf import build_dre_pdf
from .reports.livro_diario_pdf import build_livro_diario_pdf
from .reports.razao_pdf import build_razao_pdf
from .schemas import (
    BalancetePdfRequest,
    BalanceteParseResult,
    DrePdfRequest,
    LivroDiarioPdfRequest,
    ParseResult,
    PlanoContasParseResult,
    RazaoPdfRequest,
)
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


@app.post(
    "/parse/plano-contas",
    response_model=PlanoContasParseResult,
    dependencies=[Depends(require_shared_secret)],
)
async def parse_plano_contas(
    file: UploadFile = File(...),
    pdf_password: str | None = Form(default=None),
) -> PlanoContasParseResult:
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="arquivo muito grande")
    if not content:
        raise HTTPException(status_code=400, detail="arquivo vazio")

    filename = file.filename or "plano-de-contas.pdf"
    try:
        result = parse_plano_contas_pdf(content, pdf_password)
    except (EncryptedPdfError,) as exc:
        return JSONResponse(status_code=422, content={"error": str(exc), "code": "encrypted"})
    except UnreadablePdfError as exc:
        return JSONResponse(status_code=422, content={"error": str(exc), "code": "unreadable"})
    except Exception as exc:  # noqa: BLE001
        logger.exception("falha ao parsear plano de contas %s", filename)
        raise HTTPException(status_code=422, detail=f"falha ao ler o plano de contas: {exc}") from exc

    logger.info("parse plano-contas ok: %s contas=%d", filename, len(result.items))
    return result


@app.post(
    "/parse/balancete",
    response_model=BalanceteParseResult,
    dependencies=[Depends(require_shared_secret)],
)
async def parse_balancete(
    file: UploadFile = File(...),
    pdf_password: str | None = Form(default=None),
) -> BalanceteParseResult:
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="arquivo muito grande")
    if not content:
        raise HTTPException(status_code=400, detail="arquivo vazio")

    filename = file.filename or "balancete.pdf"
    try:
        result = parse_balancete_pdf(content, pdf_password)
    except (EncryptedPdfError,) as exc:
        return JSONResponse(status_code=422, content={"error": str(exc), "code": "encrypted"})
    except UnreadablePdfError as exc:
        return JSONResponse(status_code=422, content={"error": str(exc), "code": "unreadable"})
    except Exception as exc:  # noqa: BLE001
        logger.exception("falha ao parsear balancete %s", filename)
        raise HTTPException(status_code=422, detail=f"falha ao ler o balancete: {exc}") from exc

    logger.info(
        "parse balancete ok: %s período=%02d/%d contas=%d",
        filename, result.periodo.mes, result.periodo.ano, len(result.items),
    )
    return result


@app.post("/gerar/balancete-pdf", dependencies=[Depends(require_shared_secret)])
async def gerar_balancete_pdf(payload: BalancetePdfRequest) -> Response:
    pdf = build_balancete_pdf(payload)
    logger.info(
        "gerar balancete-pdf ok: período=%02d/%d contas=%d bytes=%d",
        payload.periodo.mes, payload.periodo.ano, len(payload.linhas), len(pdf),
    )
    return Response(content=pdf, media_type="application/pdf")


@app.post("/gerar/dre-pdf", dependencies=[Depends(require_shared_secret)])
async def gerar_dre_pdf(payload: DrePdfRequest) -> Response:
    pdf = build_dre_pdf(payload)
    logger.info(
        "gerar dre-pdf ok: período=%02d/%d bytes=%d",
        payload.periodo.mes, payload.periodo.ano, len(pdf),
    )
    return Response(content=pdf, media_type="application/pdf")


@app.post("/gerar/razao-pdf", dependencies=[Depends(require_shared_secret)])
async def gerar_razao_pdf(payload: RazaoPdfRequest) -> Response:
    pdf = build_razao_pdf(payload)
    logger.info(
        "gerar razao-pdf ok: conta=%s período=%02d/%d linhas=%d bytes=%d",
        payload.conta.codigo, payload.periodo.mes, payload.periodo.ano, len(payload.linhas), len(pdf),
    )
    return Response(content=pdf, media_type="application/pdf")


@app.post("/gerar/livro-diario-pdf", dependencies=[Depends(require_shared_secret)])
async def gerar_livro_diario_pdf(payload: LivroDiarioPdfRequest) -> Response:
    pdf = build_livro_diario_pdf(payload)
    logger.info(
        "gerar livro-diario-pdf ok: período=%02d/%d lancamentos=%d bytes=%d",
        payload.periodo.mes, payload.periodo.ano, len(payload.lancamentos), len(pdf),
    )
    return Response(content=pdf, media_type="application/pdf")
