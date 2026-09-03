from __future__ import annotations

import os

# Antes de importar a app: nos testes o parser roda SEM segredo compartilhado
# (não depende do parser/.env do dev). Precisa vir antes do load_dotenv() em
# app.config (que não sobrescreve env já setada).
os.environ["PARSER_SHARED_SECRET"] = ""

from pathlib import Path  # noqa: E402

import pytest  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"

# ---------------------------------------------------------------------------
# Amostras de extratos REAIS de clientes (não versionadas). Os caminhos ficam
# em tests/local_paths.py (gitignored) — um dict `PATHS` com chaves como
# "golden_dir", "extratos_dir", "bb_dir", etc. Sem esse arquivo, todos os
# testes que dependem de amostra real são simplesmente pulados.
# ---------------------------------------------------------------------------
try:
    from tests.local_paths import PATHS  # type: ignore
except Exception:  # pragma: no cover - só quando rodando sem os caminhos locais
    PATHS = {}


def _p(key: str, env: str | None = None) -> Path | None:
    raw = (env and os.getenv(env)) or PATHS.get(key)
    return Path(raw) if raw else None


def _read_long(path: Path) -> bytes:
    """Lê arquivo mesmo com caminho > 260 chars no Windows (prefixo \\\\?\\)."""
    if os.name == "nt":
        p = "\\\\?\\" + str(path.resolve())
        return Path(p).read_bytes()
    return path.read_bytes()


def _need(key: str, env: str | None = None) -> Path:
    base = _p(key, env)
    if base is None or not base.exists():
        pytest.skip(f"amostra real não configurada ({key}) — ver tests/local_paths.py")
    return base


@pytest.fixture
def sample_ofx_bytes() -> bytes:
    return (FIXTURES / "sample.ofx").read_bytes()


@pytest.fixture
def golden_ofx_bytes() -> bytes:
    p = _need("golden_dir", "GOLDEN_DIR") / "OFX-Soph-07.ofx"
    if not p.exists():
        pytest.skip(f"golden OFX não acessível: {p}")
    return p.read_bytes()


@pytest.fixture
def golden_dominio_text() -> str:
    p = _need("golden_dir", "GOLDEN_DIR") / "(168) Dominio.txt"
    if not p.exists():
        pytest.skip(f"golden TXT não acessível: {p}")
    return p.read_text(encoding="utf-8-sig")


@pytest.fixture
def bb_samples() -> dict[str, bytes]:
    base = _need("bb_dir")
    return {
        "csv": (base / "Extrato531976679.csv").read_bytes(),
        "ofx": (base / "Extrato531976679.ofx").read_bytes(),
        "pdf": (base / "00901102025.pdf").read_bytes(),
    }


@pytest.fixture
def nubank_samples() -> dict[str, bytes]:
    base = _need("nubank_dir")
    stem = "69adb71e-f83e-4d03-ba9d-b4744d781737-2026-07-01-2026-07-31"
    return {
        "csv": _read_long(base / f"{stem}.csv"),
        "ofx": _read_long(base / f"{stem}.ofx"),
    }


@pytest.fixture
def nubank_pdf_samples() -> dict[str, bytes]:
    base = _need("nubank_pdf_dir")
    stem = "67865573-2fed-4add-a236-e30d8fa6442d-2026-08-01-2026-08-31"
    return {
        "ofx": _read_long(base / f"{stem}.ofx"),
        "csv": _read_long(base / f"{stem}.csv"),
        "pdf": _read_long(base / f"{stem}.pdf"),
    }


@pytest.fixture
def c6_encrypted_xls() -> bytes:
    p = _need("c6_xls_dir") / "extrato-da-sua-conta-01KXNF0KZDC7T61XQ4HTJGSYT3.xlsx"
    if not p.exists():
        pytest.skip(f"planilha C6 não acessível: {p}")
    return p.read_bytes()


@pytest.fixture
def itau_samples() -> dict[str, bytes]:
    base = _need("itau_dir")
    stem = "Extrato_8403_992681_07-07-2026"
    return {
        "ofx": _read_long(base / f"{stem}.ofx"),
        "pdf": _read_long(base / f"{stem}.pdf"),
    }
