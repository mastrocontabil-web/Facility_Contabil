from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

Direction = Literal["entrada", "saida"]
FileFormat = Literal["pdf", "ofx", "csv", "xls", "xlsx"]


class NormalizedTransaction(BaseModel):
    date: str = Field(description="Data do lançamento, ISO YYYY-MM-DD")
    description: str = Field(default="", description="Histórico do extrato (texto livre)")
    amount_cents: int = Field(ge=0, description="Valor absoluto em centavos")
    direction: Direction
    raw: dict[str, Any] = Field(default_factory=dict)


class ParseResult(BaseModel):
    format: FileFormat
    bank_id: str | None = None
    account_id: str | None = None
    period_start: str | None = None
    period_end: str | None = None
    transactions: list[NormalizedTransaction] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ParseError(BaseModel):
    error: str
    format: FileFormat | None = None
    hint: str | None = None


class PlanoContaItem(BaseModel):
    codigo: str = Field(description="Código reduzido")
    tipo: Literal["S", "A"] = Field(description="S = sintética (grupo), A = analítica (lançável)")
    classificacao: str = Field(description="Código hierárquico pontuado, ex: 1.1.1.02.000003")
    nome: str
    grau: int = Field(ge=1, le=5)


class PlanoContasParseResult(BaseModel):
    items: list[PlanoContaItem] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
