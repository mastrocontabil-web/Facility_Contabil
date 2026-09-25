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


# --------------------------------------------------------------------------- #
# Nova importação Excel — planilha própria do cliente, colunas escolhidas na mão
# --------------------------------------------------------------------------- #
class PlanilhaCelula(BaseModel):
    t: str = Field(description="Texto como aparece na célula")
    d: str | None = Field(default=None, description="A célula lida como data (ISO), se der")
    v: int | None = Field(default=None, description="A célula lida como valor, em centavos com sinal")


class PlanilhaLinha(BaseModel):
    n: int = Field(description="Número da linha na planilha (1 = primeira, como no Excel)")
    c: list[PlanilhaCelula | None] = Field(description="Células da linha; null = vazia")


class PlanilhaAba(BaseModel):
    nome: str
    oculta: bool = False


class PlanilhaSugestao(BaseModel):
    data: int | None = None
    valor: int | None = None
    historico: list[int] = Field(default_factory=list)


class PlanilhaResult(BaseModel):
    formato: Literal["xls", "xlsx"]
    abas: list[PlanilhaAba]
    aba: int = Field(description="Índice (0 = primeira) da aba lida")
    colunas: int
    linhas: list[PlanilhaLinha] = Field(description="Só as linhas com alguma célula preenchida")
    total_linhas: int = Field(description="Linhas preenchidas na aba (pode passar de `linhas` se truncado)")
    truncado: bool = False
    sugestao: PlanilhaSugestao | None = Field(
        default=None, description="Colunas de data/valor/histórico achadas pelo cabeçalho"
    )


class ExcelMapeamento(BaseModel):
    """Função de cada coluna (índice 0 = coluna A) escolhida pelo operador."""

    aba: int = Field(default=0, ge=0)
    data: int = Field(ge=0)
    valor: int = Field(ge=0)
    historico: list[int] = Field(min_length=1)
    excluir: list[int] = Field(
        default_factory=list, description="Linhas da planilha que o operador tirou da importação"
    )


class PlanoContaItem(BaseModel):
    codigo: str = Field(description="Código reduzido")
    tipo: Literal["S", "A"] = Field(description="S = sintética (grupo), A = analítica (lançável)")
    classificacao: str = Field(description="Código hierárquico pontuado, ex: 1.1.1.02.000003")
    nome: str
    grau: int = Field(ge=1, le=5)


class PlanoContasParseResult(BaseModel):
    items: list[PlanoContaItem] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


NaturezaDC = Literal["D", "C"]


class BalancetePeriodo(BaseModel):
    ano: int
    mes: int = Field(ge=1, le=12)


class BalanceteContaItem(BaseModel):
    codigo: str = Field(description="Código reduzido")
    nome: str
    tipo: Literal["S", "A"] = Field(description="S = sintética (grupo), A = analítica (lançável)")
    saldo_anterior_cents: int = Field(ge=0)
    saldo_anterior_natureza: NaturezaDC | None = Field(
        default=None, description="Null quando o saldo anterior é zero (sem D/C no PDF)"
    )
    debito_cents: int = Field(ge=0)
    credito_cents: int = Field(ge=0)
    saldo_atual_cents: int = Field(ge=0)
    saldo_atual_natureza: NaturezaDC | None = Field(
        default=None, description="Null quando o saldo atual é zero (sem D/C no PDF)"
    )


class BalanceteParseResult(BaseModel):
    periodo: BalancetePeriodo
    items: list[BalanceteContaItem] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class RelatorioCliente(BaseModel):
    razao_social: str
    cnpj: str


class ResultadoFigura(BaseModel):
    cents: int = Field(ge=0)
    natureza: NaturezaDC | None = None


class BalancetePdfRequest(BaseModel):
    cliente: RelatorioCliente
    periodo: BalancetePeriodo
    linhas: list[BalanceteContaItem] = Field(default_factory=list)


class GrupoDre(BaseModel):
    raiz: BalanceteContaItem
    linhas: list[BalanceteContaItem] = Field(default_factory=list)


class DrePdfRequest(BaseModel):
    cliente: RelatorioCliente
    periodo: BalancetePeriodo
    receitas: GrupoDre
    despesas: GrupoDre
    resultado_mes: ResultadoFigura
    resultado_exercicio: ResultadoFigura


class RazaoContaInfo(BaseModel):
    codigo: str
    nome: str


class RazaoLinha(BaseModel):
    data: str
    historico_codigo: str | None = None
    historico_complemento: str
    tipo: NaturezaDC
    valor_cents: int = Field(gt=0)
    saldo_cents: int = Field(ge=0)
    saldo_natureza: NaturezaDC | None = None


class RazaoPdfRequest(BaseModel):
    cliente: RelatorioCliente
    periodo: BalancetePeriodo
    conta: RazaoContaInfo
    saldo_anterior_cents: int = Field(ge=0)
    saldo_anterior_natureza: NaturezaDC | None = None
    linhas: list[RazaoLinha] = Field(default_factory=list)
    saldo_atual_cents: int = Field(ge=0)
    saldo_atual_natureza: NaturezaDC | None = None


class LivroDiarioPartida(BaseModel):
    conta_codigo: str
    conta_nome: str
    tipo: NaturezaDC
    valor_cents: int = Field(gt=0)


class LivroDiarioLancamento(BaseModel):
    data: str
    historico_codigo: str | None = None
    historico_complemento: str
    partidas: list[LivroDiarioPartida] = Field(default_factory=list)


class LivroDiarioPdfRequest(BaseModel):
    cliente: RelatorioCliente
    periodo: BalancetePeriodo
    lancamentos: list[LivroDiarioLancamento] = Field(default_factory=list)
