from __future__ import annotations

import io
import re
from contextlib import contextmanager
from datetime import date
from decimal import Decimal

from ..schemas import NormalizedTransaction, ParseResult
from .common import parse_date, to_cents


class EncryptedPdfError(Exception):
    pass


class UnreadablePdfError(Exception):
    pass


_MONEY = r"\d{1,3}(?:\.\d{3})*,\d{2}"
_DATE = r"\d{2}[/.]\d{2}[/.]\d{4}"
_DATE_SHORT = r"\d{2}/\d{2}(?:/\d{2,4})?"

_MESES = {
    "janeiro": 1, "fevereiro": 2, "março": 3, "marco": 3, "abril": 4, "maio": 5,
    "junho": 6, "julho": 7, "agosto": 8, "setembro": 9, "outubro": 10,
    "novembro": 11, "dezembro": 12,
}
_MESES_ABREV = {
    "jan": 1, "fev": 2, "mar": 3, "abr": 4, "mai": 5, "jun": 6,
    "jul": 7, "ago": 8, "set": 9, "out": 10, "nov": 11, "dez": 12,
}

_PERIODO_RE = re.compile(rf"per[íi]odo[^0-9]{{0,25}}({_DATE})\D+?({_DATE})", re.IGNORECASE)
_PERIODO_EXTENSO_RE = re.compile(
    r"(\d{1,2})\s+DE\s+([A-Za-zçãÇÃ]+)\s+DE\s+(\d{4})\s+(?:a|at[ée])\s+"
    r"(\d{1,2})\s+DE\s+([A-Za-zçãÇÃ]+)\s+DE\s+(\d{4})",
    re.IGNORECASE,
)

_SKIP_DESC = re.compile(
    r"saldo\s+anterior|saldo\s+bloquead|^s\s*a\s*l\s*d\s*o\b|saldo\s+do\s+dia|"
    r"saldo\s+final|saldo\s+em\s+conta|saldo\s+inicial|saldo\s+total|saldo\s+ant|"
    r"^lan[çc]amentos?\b|dt\.?\s*balancete|saldo\s+por\s+transa|"
    r"saldo\s+anterior|saldo\s+atual|saldo\s+dispon",
    re.IGNORECASE,
)

# linha de cabeçalho/rodapé de página (aparece repetida, com valores que NÃO são lançamentos)
_HEADER_LINE = re.compile(
    r"dispon[íi]vel\s+para\s+uso|^\s*limite\s+da\s+conta\b|cheque\s+especial\s+contratad|"
    r"^\s*per[íi]odos?\s*[:e]|conta\s+total\s+dispon|internet\s+banking|"
    r"^\s*saldo\s+total\s+limite|total\s+dispon[íi]vel\s*\(|investimento\s+sem\s+baixa|"
    r"^\s*\d{4,6}\s*\|\s*[\d-]+\s+[\d.]+,\d{2}|^\s*extrato\s+de\s*:\s*ag|"
    r"valor\s+saldo\s+por\s+transa",
    re.IGNORECASE,
)

# valor monetário com sinal/prefixo: -R$ 1.234,56 | R$ -1.234,56 | (1.234,56) | 1.234,56-
# o "-" final só conta se estiver GRUDADO no número (senão rouba o sinal do próximo).
_MONEY_TOKEN_RE = re.compile(
    rf"(?<![\d.,\w])(\(?)\s?(-)?\s?(R\$)?\s?(-)?\s?({_MONEY})(-)?\s?(\)?)"
)


@contextmanager
def open_pdf(content: bytes, password: str | None):
    """Abre um PDF (com senha) traduzindo erros de leitura/senha; compartilhado
    com os parsers do módulo Contábil. O `yield` fica dentro do try/except, então
    uma exceção lançada pelo código chamador (durante a extração de uma página,
    por exemplo) também é capturada e traduzida aqui — mesma cobertura de erro
    de quando o open+extração inteiros viviam num try/except só."""
    import pdfplumber
    from pdfminer.pdfdocument import PDFPasswordIncorrect

    try:
        with pdfplumber.open(io.BytesIO(content), password=password or "") as pdf:
            yield pdf
    except PDFPasswordIncorrect as e:
        raise EncryptedPdfError(
            "PDF protegido por senha. Informe a senha do extrato, ou mande em OFX/CSV."
        ) from e
    except Exception as e:  # noqa: BLE001
        msg = str(e).lower()
        if "password" in msg or "encrypt" in msg:
            raise EncryptedPdfError(
                "PDF protegido por senha. Informe a senha do extrato, ou mande em OFX/CSV."
            ) from e
        raise UnreadablePdfError(f"não consegui ler o PDF: {e}") from e


def extract_pdf_text(content: bytes, password: str | None) -> str:
    """Extrai texto de PDF (com senha); compartilhado com os parsers do módulo Contábil."""
    with open_pdf(content, password) as pdf:
        parts = []
        for p in pdf.pages:
            parts.append(p.extract_text(layout=True) or p.extract_text() or "")
        return "\n".join(parts)


def _period(text: str, seen: list[date]) -> tuple[date | None, date | None]:
    if seen:
        return (min(seen), max(seen))
    m = _PERIODO_RE.search(text)
    if m:
        a, b = parse_date(m.group(1)), parse_date(m.group(2))
        if a and b:
            return a, b
    m = _PERIODO_EXTENSO_RE.search(text)
    if m:
        try:
            a = date(int(m.group(3)), _MESES[m.group(2).lower()], int(m.group(1)))
            b = date(int(m.group(6)), _MESES[m.group(5).lower()], int(m.group(4)))
            return a, b
        except (KeyError, ValueError):
            pass
    return (None, None)


def _money_tokens(line: str) -> list[tuple[int, int, Decimal, bool]]:
    """Todos os valores monetários da linha: (início, fim, valor, negativo?)."""
    out: list[tuple[int, int, Decimal, bool]] = []
    for m in _MONEY_TOKEN_RE.finditer(line):
        paren_o, s1, _rs, s2, num, s3, paren_c = m.groups()
        neg = bool(s1 or s2 or s3) or (paren_o == "(" and paren_c == ")")
        try:
            val = Decimal(num.replace(".", "").replace(",", "."))
        except Exception:  # noqa: BLE001
            continue
        out.append((m.start(), m.end(), val, neg))
    return out


def _guess_year(text: str) -> int | None:
    # 1º ano plausível (19xx/20xx). Evita cair no "/0001" de um CNPJ.
    m = re.search(r"(?<!\d)(19|20)\d{2}(?!\d)", text)
    return int(m.group(0)) if m else None


def _clean_desc(s: str) -> str:
    s = re.sub(r"^\d{2}[/.]\d{2}(?:[/.]\d{2,4})?\s+", "", s.strip())  # data à esquerda
    s = re.sub(r"^\d{2}[/.]\d{2}(?:[/.]\d{2,4})?\s+", "", s)  # 2ª data (extrato com data cont.)
    s = re.sub(r"\s+\d{1,3}(?:\.\d{3}){2,}\s*$", "", s)  # documento formatado no fim
    s = re.sub(r"\s{2,}", " ", s)
    return s.strip(" -\t·—")


# --------------------------------------------------------------------------- #
# detecção de banco
# --------------------------------------------------------------------------- #
def _looks_like_nubank(t: str) -> bool:
    low = t.lower()
    return "movimenta" in low and "total de entradas" in low and (
        "saldo do dia" in low or "nu pagamentos" in low
    )


def _looks_like_sicoob(t: str) -> bool:
    return "sicoob" in t.lower()


def _looks_like_bb_consultas(t: str) -> bool:
    low = t.lower()
    return "dt. balancete" in low or "consultas - extrato de conta corrente" in low or (
        "ag. origem" in low and "lote" in low and "hist" in low and "documento" in low
    )


_BB_CC_HEADER_RE = re.compile(r"\bDia\s+Lote\s+Documento\s+Hist[óo]rico\s+Valor\b")
_BB_CC_SINAL_RE = re.compile(rf"{_MONEY}\s*\([+-]\)")


def _looks_like_bb_extrato_cc(t: str) -> bool:
    return (
        "extrato de conta corrente" in t.lower()
        and bool(_BB_CC_HEADER_RE.search(t))
        and bool(_BB_CC_SINAL_RE.search(t))
    )


# --------------------------------------------------------------------------- #
# Nubank — extrato em "prosa"
# --------------------------------------------------------------------------- #
_NU_DAY_RE = re.compile(r"^\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\b")
_NU_VALUE_RE = re.compile(rf"(?:^|\s)(-?\s?R?\$?\s?{_MONEY})\s*$")


def _parse_nubank_pdf(text: str) -> ParseResult:
    lines = text.splitlines()
    txns: list[NormalizedTransaction] = []
    seen: list[date] = []
    cur_date: date | None = None
    cur_dir: str | None = None

    for i, raw in enumerate(lines):
        ln = raw.strip()
        if not ln:
            continue
        md = _NU_DAY_RE.match(ln)
        if md:
            mes = _MESES_ABREV.get(md.group(2).lower())
            if mes:
                try:
                    cur_date = date(int(md.group(3)), mes, int(md.group(1)))
                except ValueError:
                    cur_date = None
            ln = ln[md.end():].strip()

        low = ln.lower()
        if low.startswith("total de entrada"):
            cur_dir = "entrada"
            continue
        if low.startswith(("total de saída", "total de saida")):
            cur_dir = "saida"
            continue
        if low.startswith("saldo") or not ln:
            continue

        mv = _NU_VALUE_RE.search(ln)
        if not mv or cur_date is None or cur_dir is None:
            continue
        toks = _money_tokens(mv.group(1))
        if not toks or toks[0][2] == 0:
            continue

        desc = ln[: mv.start()].strip(" -\t")
        j = i + 1
        while j < len(lines) and j < i + 4:
            nxt = lines[j].strip()
            if not nxt or _NU_DAY_RE.match(nxt) or _NU_VALUE_RE.search(nxt):
                break
            if nxt.lower().startswith(("total de", "saldo")):
                break
            desc = f"{desc} {nxt}"
            j += 1
        desc = re.sub(r"\s+", " ", desc).strip(" -")
        if not desc:
            continue

        seen.append(cur_date)
        txns.append(
            NormalizedTransaction(
                date=cur_date.isoformat(),
                description=desc,
                amount_cents=to_cents(toks[0][2]),
                direction=cur_dir,
                raw={"ordem": i},
            )
        )
    return _result(text, txns, seen)


# --------------------------------------------------------------------------- #
# Sicoob — valor com sufixo C/D: "R$ 35,00D"
# --------------------------------------------------------------------------- #
_SICOOB_LINE = re.compile(
    rf"^\s*(?P<d>\d{{2}}/\d{{2}}(?:/\d{{4}})?)\s+(?P<doc>\d+\s+)?(?P<mid>.*?)\s+"
    rf"R?\$?\s*(?P<val>{_MONEY})\s*(?P<dc>[CD*])\s*$"
)


def _parse_sicoob_pdf(text: str) -> ParseResult:
    year = _guess_year(text) or date.today().year
    txns: list[NormalizedTransaction] = []
    seen: list[date] = []
    for i, raw in enumerate(text.splitlines()):
        ln = raw.strip()
        m = _SICOOB_LINE.match(ln)
        if not m:
            continue
        g = m.groupdict()
        if g["dc"] == "*":  # saldo bloqueado
            continue
        d = parse_date(g["d"] if len(g["d"]) > 5 else f"{g['d']}/{year}")
        val = Decimal(g["val"].replace(".", "").replace(",", "."))
        if not d or val == 0:
            continue
        desc = _clean_desc((g["doc"] or "") + g["mid"])
        if not desc or _SKIP_DESC.search(desc):
            continue
        seen.append(d)
        txns.append(
            NormalizedTransaction(
                date=d.isoformat(),
                description=desc,
                amount_cents=to_cents(val),
                direction="saida" if g["dc"] == "D" else "entrada",
                raw={"ordem": i},
            )
        )
    return _result(text, txns, seen)


# --------------------------------------------------------------------------- #
# Banco do Brasil "Consultas - Extrato de conta corrente" — valor + letra D/C
# --------------------------------------------------------------------------- #
_BB_LINE = re.compile(
    rf"^\s*(?P<d>{_DATE})\s+(?P<mid>.+?)\s+(?P<val>{_MONEY})\s+(?P<dc>[DC])"
    rf"(?:\s+{_MONEY}\s+[DC])?\s*$"
)
_BB_PREFIX = re.compile(r"^\d{4}\s+\d{6,10}\s+")


def _bb_unstick(line: str) -> str:
    line = re.sub(r"\b([DC])(\d{1,3}(?:\.\d{3})*,\d{2})", r"\1 \2", line)
    line = re.sub(r"(\d,\d{2})(\d)", r"\1 \2", line)
    line = re.sub(r"([A-Za-zçãáéíóúâêô])(\d{1,3}(?:\.\d{3}){2,})", r"\1 \2", line)
    # nº de lote/documento colado no valor: "70.10110.000,00" -> "70.101 10.000,00"
    # (grupo de 3 dígitos seguido de dígito que inicia um valor com ,NN)
    line = re.sub(r"(\.\d{3})(\d{1,3}(?:\.\d{3})*,\d{2}\b)", r"\1 \2", line)
    return line


def _parse_bb_consultas_pdf(text: str) -> ParseResult:
    lines = text.splitlines()
    txns: list[NormalizedTransaction] = []
    seen: list[date] = []
    for i, raw in enumerate(lines):
        ln = _bb_unstick(raw.rstrip())
        m = _BB_LINE.match(ln)
        if not m:
            continue
        g = m.groupdict()
        d = parse_date(g["d"])
        val = Decimal(g["val"].replace(".", "").replace(",", "."))
        if not d or val == 0:
            continue
        desc = _clean_desc(_BB_PREFIX.sub("", g["mid"]))
        if not desc and i > 0:
            prev = _bb_unstick(lines[i - 1].rstrip()).strip()
            if prev and not _BB_LINE.match(prev) and not _SKIP_DESC.search(prev) and len(prev) < 90:
                desc = _clean_desc(_BB_PREFIX.sub("", prev))
        if not desc or _SKIP_DESC.search(desc):
            continue
        nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
        if (
            nxt and not _BB_LINE.match(_bb_unstick(nxt)) and len(nxt) < 90
            and not _SKIP_DESC.search(nxt)
            and not re.match(r"^(Página|Pagina|SAC|Ouvidoria|www\.|Dt\.)", nxt, re.I)
        ):
            desc = f"{desc} - {nxt}".strip(" -")
        seen.append(d)
        txns.append(
            NormalizedTransaction(
                date=d.isoformat(),
                description=re.sub(r"\s+", " ", desc).strip(),
                amount_cents=to_cents(val),
                direction="saida" if g["dc"] == "D" else "entrada",
                raw={"ordem": i},
            )
        )
    return _result(text, txns, seen)


# --------------------------------------------------------------------------- #
# Banco do Brasil "Extrato de Conta Corrente" — tabela Dia/Lote/Documento/
# Histórico/Valor, valor com "(+)"/"(-)" e histórico em até 2 linhas. Lido pelas
# posições na página, não pelo texto corrido: cada lançamento fica entre duas
# linhas horizontais da tabela, mas as colunas são centralizadas na altura da
# célula — o título do histórico às vezes fica ACIMA da data (Pix), e no texto
# corrido as partes de lançamentos vizinhos se misturam.
# --------------------------------------------------------------------------- #
_BB_CC_DIRECAO = {"(+)": "entrada", "(-)": "saida"}


def _bb_cc_colunas(words: list[dict]) -> tuple[float, dict[str, float]] | None:
    """Topo da linha de cabeçalho da tabela e x0 das colunas Lote/Documento/Histórico."""
    for dia in (w for w in words if w["text"] == "Dia"):
        x: dict[str, float] = {}
        for w in words:
            if abs(w["top"] - dia["top"]) >= 2:
                continue
            if w["text"] == "Lote":
                x["lote"] = w["x0"]
            elif w["text"] == "Documento":
                x["doc"] = w["x0"]
            elif re.fullmatch(r"Hist[óo]rico", w["text"]):
                x["hist"] = w["x0"]
        if len(x) == 3:
            return dia["top"], x
    return None


def _parse_bb_extrato_cc_pdf(content: bytes, password: str | None, text: str) -> ParseResult:
    txns: list[NormalizedTransaction] = []
    seen: list[date] = []
    with open_pdf(content, password) as pdf:
        for page in pdf.pages:
            words = page.extract_words()
            cab = _bb_cc_colunas(words)
            if cab is None:
                continue
            topo_cab, x = cab
            seps = sorted(
                {round(e["top"], 1) for e in page.edges if e["orientation"] == "h" and e["top"] > topo_cab}
            )
            seps.append(page.height)

            for a, b in zip(seps, seps[1:]):
                faixa = [w for w in words if a <= w["top"] < b]
                sinais = [w for w in faixa if w["text"] in _BB_CC_DIRECAO]
                if not sinais:
                    continue
                sinal = max(sinais, key=lambda w: w["x0"])
                valores = [
                    w for w in faixa
                    if abs(w["top"] - sinal["top"]) < 1.5
                    and w["x1"] <= sinal["x0"] + 1
                    and re.fullmatch(_MONEY, w["text"])
                ]
                if not valores:
                    continue
                valor = max(valores, key=lambda w: w["x0"])

                # "Saldo do dia" vem com data 00/00/0000 (parse_date devolve None)
                d = next(
                    (parse_date(w["text"]) for w in faixa if w["x0"] < x["lote"] and re.fullmatch(_DATE, w["text"])),
                    None,
                )
                if d is None:
                    continue

                linhas: list[list[dict]] = []
                hist = [w for w in faixa if w["x0"] >= x["hist"] and w is not valor and w is not sinal]
                for w in sorted(hist, key=lambda w: (w["top"], w["x0"])):
                    if linhas and abs(linhas[-1][0]["top"] - w["top"]) < 2:
                        linhas[-1].append(w)
                    else:
                        linhas.append([w])
                desc = " - ".join(
                    " ".join(w["text"] for w in sorted(linha, key=lambda w: w["x0"])) for linha in linhas
                )
                desc = re.sub(r"\s+", " ", desc).strip()
                val = Decimal(valor["text"].replace(".", "").replace(",", "."))
                if not desc or val == 0 or _SKIP_DESC.search(desc):
                    continue

                seen.append(d)
                txns.append(
                    NormalizedTransaction(
                        date=d.isoformat(),
                        description=desc,
                        amount_cents=to_cents(val),
                        direction=_BB_CC_DIRECAO[sinal["text"]],
                        raw={
                            "ordem": len(txns),
                            "lote": " ".join(w["text"] for w in faixa if x["lote"] <= w["x0"] < x["doc"]),
                            "doc": " ".join(w["text"] for w in faixa if x["doc"] <= w["x0"] < x["hist"]),
                        },
                    )
                )
    return _result(text, txns, seen)


# --------------------------------------------------------------------------- #
# Mercado Pago "EXTRATO DE CONTA" — tabela Data/Descrição/ID da operação/Valor/
# Saldo, data com hífen ("01-08-2026") e valor com sinal ("R$ -1.000,00"). Lido
# pelas posições, igual ao BB "Extrato de Conta Corrente": cada lançamento fica
# entre dois separadores horizontais da tabela e a descrição quebra em até 3
# linhas centralizadas na altura da célula (parte ACIMA da linha da data). Duas
# pegadinhas vistas no extrato real: o cabeçalho da tabela não se repete em toda
# página, e uma célula pode começar no fim de uma página e terminar no topo da
# seguinte. A coluna Saldo confere cada lançamento lido.
# --------------------------------------------------------------------------- #
_MP_DATA_RE = re.compile(r"(\d{2})-(\d{2})-(\d{4})")
_MP_VALOR_RE = re.compile(rf"-?{_MONEY}")
_MP_SALDO_IMPRESSO_RE = re.compile(rf"Saldo (inicial|final):\s*R\$\s*(-?{_MONEY})")


def _looks_like_mercadopago(t: str) -> bool:
    low = t.lower()
    return "extrato de conta" in low and "detalhe dos movimentos" in low and "id da opera" in low


def _mp_colunas(words: list[dict]) -> tuple[float, dict[str, float]] | None:
    """Topo da linha de cabeçalho da tabela e x0 das colunas Data/Descrição/ID."""
    for data in (w for w in words if w["text"] == "Data"):
        x: dict[str, float] = {"data": data["x0"]}
        for w in words:
            if abs(w["top"] - data["top"]) >= 2:
                continue
            if w["text"].startswith("Descri"):
                x["desc"] = w["x0"]
            elif w["text"] == "ID":
                x["id"] = w["x0"]
        if len(x) == 3:
            return data["top"], x
    return None


def _mp_centavos(valor: str) -> int:
    """'-1.000,00' -> -100000 (centavos, com sinal)."""
    c = to_cents(Decimal(valor.lstrip("-").replace(".", "").replace(",", ".")))
    return -c if valor.startswith("-") else c


def _mp_texto(words: list[dict]) -> str:
    """Palavras -> linhas (mesma altura) -> uma frase só: a descrição é um texto
    único quebrado pela largura da coluna, então as linhas se juntam com espaço."""
    linhas: list[list[dict]] = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if linhas and abs(linhas[-1][0]["top"] - w["top"]) < 2:
            linhas[-1].append(w)
        else:
            linhas.append([w])
    return " ".join(" ".join(w["text"] for w in sorted(linha, key=lambda w: w["x0"])) for linha in linhas)


def _parse_mercadopago_pdf(content: bytes, password: str | None, text: str) -> ParseResult:
    txns: list[NormalizedTransaction] = []
    seen: list[date] = []
    avisos: list[str] = []
    impressos = {nome: _mp_centavos(v) for nome, v in _MP_SALDO_IMPRESSO_RE.findall(text)}
    saldo = impressos.get("inicial")
    x: dict[str, float] | None = None
    pendente = ""  # começo de descrição que ficou no fim da página anterior

    with open_pdf(content, password) as pdf:
        for page in pdf.pages:
            words = page.extract_words()
            cab = _mp_colunas(words)
            if cab is not None:
                topo, x = cab
            elif x is None:
                continue  # a tabela ainda não começou
            else:
                topo = 0.0  # página sem o cabeçalho: a tabela vem desde o topo
            seps = [
                topo,
                *sorted({round(e["top"], 1) for e in page.edges if e["orientation"] == "h" and e["top"] > topo}),
                page.height,
            ]

            for a, b in zip(seps, seps[1:]):
                faixa = [w for w in words if a <= w["top"] < b]
                na_coluna = [w for w in faixa if x["desc"] - 1 <= w["x0"] < x["id"] - 1]
                datas = [w for w in faixa if abs(w["x0"] - x["data"]) < 3 and _MP_DATA_RE.fullmatch(w["text"])]
                if not datas:
                    # célula quebrada entre páginas: guarda o texto pro lançamento
                    # seguinte. Linha com texto fora da coluna (rodapé) não entra.
                    fora = [w for w in faixa if w not in na_coluna]
                    resto = [w for w in na_coluna if not any(abs(f["top"] - w["top"]) < 2 for f in fora)]
                    if resto:
                        pendente = f"{pendente} {_mp_texto(resto)}".strip()
                    continue

                for dw in datas:
                    linha = [w for w in faixa if abs(w["top"] - dw["top"]) < 2]
                    valores = sorted(
                        (w for w in linha if w["x0"] > x["id"] and _MP_VALOR_RE.fullmatch(w["text"])),
                        key=lambda w: w["x0"],
                    )
                    if len(valores) < 2:  # Valor + Saldo
                        continue
                    valor = _mp_centavos(valores[0]["text"])
                    saldo_linha = _mp_centavos(valores[-1]["text"])
                    # sem separador entre dois lançamentos, cada um fica só com a própria linha
                    desc_ws = na_coluna if len(datas) == 1 else [w for w in na_coluna if w in linha]
                    desc = re.sub(r"\s+", " ", f"{pendente} {_mp_texto(desc_ws)}").strip()
                    pendente = ""
                    ident = next(
                        (w["text"] for w in linha if abs(w["x0"] - x["id"]) < 3 and w["text"].isdigit()), ""
                    )

                    if saldo is not None and saldo + valor != saldo_linha:
                        avisos.append(
                            f"lançamento de {dw['text'].replace('-', '/')} (ID {ident}): o valor lido não "
                            "fecha com o saldo impresso na linha — confira esse lançamento"
                        )
                    saldo = saldo_linha

                    dia, mes, ano = (int(g) for g in _MP_DATA_RE.fullmatch(dw["text"]).groups())
                    try:
                        d = date(ano, mes, dia)
                    except ValueError:
                        continue
                    if valor == 0:
                        continue
                    seen.append(d)
                    txns.append(
                        NormalizedTransaction(
                            date=d.isoformat(),
                            description=desc,
                            amount_cents=abs(valor),
                            direction="saida" if valor < 0 else "entrada",
                            raw={"ordem": len(txns), "id_operacao": ident},
                        )
                    )

    if txns and "final" in impressos and saldo != impressos["final"]:
        avisos.append(
            "o saldo do último lançamento lido não bate com o saldo final impresso no extrato — "
            "pode estar faltando lançamento"
        )
    r = _result(text, txns, seen)
    r.warnings = [*avisos, *r.warnings]
    return r


# --------------------------------------------------------------------------- #
# Layout genérico "assinado": data + descrição + valor (com sinal) [+ saldo]
# Cobre Bradesco, Inter, C6, Santander, PagBank, BB (app), Itaú, ...
# --------------------------------------------------------------------------- #
_DAY_HEADER_RE = re.compile(
    r"^\s*(\d{1,2})\s+de\s+([A-Za-zçãÇÃ]+)\s+de\s+(\d{4})\b", re.IGNORECASE
)
_ROW_DATE_RE = re.compile(rf"^\s*(?P<d>{_DATE}|\d{{2}}/\d{{2}})(?![/.\d])")

_DIR_ENTRADA_RE = re.compile(r"^(entrada|recebiment|cr[eé]dito|dep[oó]sito|rendiment)", re.I)
_DIR_SAIDA_RE = re.compile(
    r"^(sa[ií]da|pagamento|d[eé]bito|pix enviado|transf.*enviad|compra|tarifa|"
    r"pagto|débito)", re.I
)


def _parse_signed_pdf(text: str) -> ParseResult:
    lines = text.splitlines()
    year = _guess_year(text) or date.today().year
    txns: list[NormalizedTransaction] = []
    seen: list[date] = []
    cur_date: date | None = None

    for i, raw in enumerate(lines):
        ln = raw.rstrip()
        s = ln.strip()
        if not s:
            continue

        dh = _DAY_HEADER_RE.match(s)
        if dh:
            mes = _MESES.get(dh.group(2).lower())
            if mes:
                try:
                    cur_date = date(int(dh.group(3)), mes, int(dh.group(1)))
                except ValueError:
                    pass
            continue

        rd = _ROW_DATE_RE.match(s)
        if rd:
            raw_d = rd.group("d")
            got = parse_date(raw_d if len(raw_d) > 5 else f"{raw_d}/{year}")
            if got:
                cur_date = got  # a data "gruda" para as próximas linhas sem data
        row_date = cur_date

        toks = _money_tokens(ln)
        if not toks or row_date is None or _SKIP_DESC.search(s) or _HEADER_LINE.search(s):
            continue

        # valor = penúltimo token quando há saldo; único quando não há
        val_tok = toks[-2] if len(toks) >= 2 else toks[-1]
        val, neg = val_tok[2], val_tok[3]
        if val == 0:
            continue

        desc = _clean_desc(ln[: val_tok[0]])

        # descrição vazia/numérica -> tenta a(s) linha(s) anterior(es)
        if (not desc or desc.replace(" ", "").isdigit() or len(desc) < 4) and i > 0:
            for back in (1, 2):
                if i - back < 0:
                    break
                prev = lines[i - back].strip()
                if not prev or _money_tokens(prev) or _SKIP_DESC.search(prev):
                    break
                if _ROW_DATE_RE.match(prev) or _DAY_HEADER_RE.match(prev):
                    break
                desc = _clean_desc(prev) + (f" {desc}" if desc else "")
                if len(desc) >= 4:
                    break

        # continuação na linha seguinte (sem valor, curta)
        nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
        if (
            nxt and not _money_tokens(nxt) and not _ROW_DATE_RE.match(nxt)
            and not _DAY_HEADER_RE.match(nxt) and len(nxt) < 60
            and not re.match(r"^(saldo|total|p[áa]gina|SAC|ouvidor)", nxt, re.I)
        ):
            desc = f"{desc} {nxt}".strip()

        desc = re.sub(r"\s+", " ", desc).strip(" -·—")
        low = desc.lower()

        if (
            not desc
            or _SKIP_DESC.search(desc)
            or re.search(r"\b(saldo|totais?|total)\b", low)
            or re.match(r"^[a-z]\s*[-–]\s", low)  # "A – Saldo de Conta ..." / "J - ..."
            or low in ("d�bito", "cr�dito", "movimenta��o")
        ):
            continue

        # direção: sinal manda; senão, palavra-chave no início da descrição
        if neg:
            direction = "saida"
        elif _DIR_SAIDA_RE.match(desc):
            direction = "saida"
        elif _DIR_ENTRADA_RE.match(desc):
            direction = "entrada"
        else:
            direction = "entrada"

        seen.append(row_date)
        txns.append(
            NormalizedTransaction(
                date=row_date.isoformat(),
                description=desc,
                amount_cents=to_cents(val),
                direction=direction,
                raw={"ordem": i},
            )
        )
    return _result(text, txns, seen)


# --------------------------------------------------------------------------- #
def _result(text: str, txns: list[NormalizedTransaction], seen: list[date]) -> ParseResult:
    warnings: list[str] = []
    if not txns:
        warnings.append(
            "não reconheci lançamentos no PDF — esse layout de banco pode não estar "
            "suportado ainda. Mande o extrato em OFX ou CSV."
        )
    else:
        warnings.append(
            "leitura de PDF é menos precisa que OFX/CSV — confira os valores e a "
            "quantidade de lançamentos antes de gerar o arquivo"
        )
        if all(t.direction == "entrada" for t in txns) and len(txns) > 4:
            warnings.append(
                "todos os lançamentos foram lidos como entrada — pode ser erro de leitura "
                "do PDF; confira com atenção ou use o OFX/CSV"
            )
    ds, de = _period(text, seen)
    return ParseResult(
        format="pdf",
        period_start=ds.isoformat() if ds else None,
        period_end=de.isoformat() if de else None,
        transactions=txns,
        warnings=warnings,
    )


def parse_pdf(content: bytes, password: str | None = None) -> ParseResult:
    text = extract_pdf_text(content, password)

    if _looks_like_mercadopago(text):
        r = _parse_mercadopago_pdf(content, password, text)
        if r.transactions:
            return r
    if _looks_like_nubank(text):
        return _parse_nubank_pdf(text)
    if _looks_like_sicoob(text):
        return _parse_sicoob_pdf(text)
    if _looks_like_bb_extrato_cc(text):
        r = _parse_bb_extrato_cc_pdf(content, password, text)
        if r.transactions:
            return r
    if _looks_like_bb_consultas(text):
        return _parse_bb_consultas_pdf(text)
    return _parse_signed_pdf(text)
