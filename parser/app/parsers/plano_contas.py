from __future__ import annotations

import re

from ..schemas import PlanoContaItem, PlanoContasParseResult
from .pdf import UnreadablePdfError, extract_pdf_text

_ROW_RE = re.compile(
    r"^(?P<codigo>\d+)\s+(?:(?P<tipo>S)\s+)?(?P<classificacao>\d+(?:\.\d+)*)\s+"
    r"(?P<nome>.+)\s+(?P<grau>[1-5])$"
)

# Cabeçalho/rodapé repetidos em toda página do relatório — não são linhas de conta.
# extract_text(layout=True) preserva espaçamento visual das colunas, então o
# cabeçalho pode vir com vários espaços entre as palavras — daí o \s+ solto.
_BOILERPLATE_RE = re.compile(
    r"^Empresa:.*Folha:\s*\d+$|^C\.N\.P\.J\.:|^PLANO DE CONTAS$|"
    r"^C[oó]digo\s+T\s+Classifica[çc][ãa]o\s+Nome\s+Grau$|^Sistema licenciado para "
)

# pdfplumber às vezes não consegue mapear um glifo específico da fonte do PDF
# (visto na prática numa letra acentuada) e o resultado varia entre chamadas —
# ora um replacement char solto, ora uma sequência tipo mojibake — não é um
# padrão fixo pra "limpar" com confiança. Em vez de adivinhar e arriscar trocar
# pelo caractere errado, só sinaliza pra conferência manual quando o nome tem
# algo fora do esperado (letra/dígito/espaço/pontuação comum), sem alterar o
# dado bruto extraído.
_UNEXPECTED_CHAR_RE = re.compile(r"[^\w\s.,/&()'-]", re.UNICODE)


def parse_plano_contas_pdf(content: bytes, password: str | None = None) -> PlanoContasParseResult:
    text = extract_pdf_text(content, password)

    items: list[PlanoContaItem] = []
    warnings: list[str] = []
    seen_codigos: set[str] = set()

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        m = _ROW_RE.match(line)
        if not m:
            if not _BOILERPLATE_RE.match(line):
                warnings.append(f"linha não reconhecida (verifique essa conta manualmente): {line}")
            continue
        codigo = m.group("codigo")
        if codigo in seen_codigos:
            warnings.append(f"código {codigo} duplicado no PDF — mantida a primeira ocorrência")
            continue
        seen_codigos.add(codigo)
        nome = m.group("nome").strip()
        if _UNEXPECTED_CHAR_RE.search(nome):
            warnings.append(
                f"nome da conta {codigo} pode estar com caractere corrompido pelo leitor de PDF "
                f"(provavelmente uma letra acentuada) — confira: \"{nome}\""
            )
        items.append(
            PlanoContaItem(
                codigo=codigo,
                tipo="S" if m.group("tipo") else "A",
                classificacao=m.group("classificacao"),
                nome=nome,
                grau=int(m.group("grau")),
            )
        )

    if not items:
        raise UnreadablePdfError(
            "não encontrei nenhuma conta no PDF — confira se é o relatório 'Plano de Contas' do Domínio"
        )

    return PlanoContasParseResult(items=items, warnings=warnings)
