import hmac

from fastapi import Header, HTTPException, status

from .config import PARSER_SHARED_SECRET


async def require_shared_secret(x_parser_secret: str | None = Header(default=None)) -> None:
    """Confere o segredo compartilhado com o backend.

    Se PARSER_SHARED_SECRET estiver vazio (dev local), não exige nada.
    """
    if not PARSER_SHARED_SECRET:
        return
    if not x_parser_secret or not hmac.compare_digest(x_parser_secret, PARSER_SHARED_SECRET):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="segredo inválido")
