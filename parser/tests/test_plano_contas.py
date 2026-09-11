"""Golden test do parser de Plano de Contas contra o PDF real do Domínio.

Pulado se tests/local_paths.py não tiver o caminho (ver conftest.py).
"""

from __future__ import annotations

from app.parsers.plano_contas import parse_plano_contas_pdf


def test_parse_plano_contas_real_pdf(plano_contas_pdf_bytes: bytes) -> None:
    result = parse_plano_contas_pdf(plano_contas_pdf_bytes)

    assert len(result.items) > 500, "esperava várias centenas de contas nesse plano real"

    codigos = [i.codigo for i in result.items]
    assert len(codigos) == len(set(codigos)), "código deveria ser único por conta"

    for item in result.items:
        assert 1 <= item.grau <= 5
        assert item.tipo in ("S", "A")
        assert item.nome.strip() != ""
        assert all(seg.isdigit() for seg in item.classificacao.split("."))

    # O plano de contas padrão do Domínio traz vários grupos "de prateleira" que o
    # escritório nunca chega a usar (comércio exterior, aeronaves...), então nem
    # toda sintética tem filha — mas se a maioria estivesse vazia seria sinal de
    # que a hierarquia não está sendo lida corretamente.
    classificacoes = {i.classificacao for i in result.items}
    sinteticas = [i for i in result.items if i.tipo == "S"]
    assert sinteticas, "esperava contas sintéticas (grupos) no plano"

    def tem_filha(grupo) -> bool:
        prefixo = f"{grupo.classificacao}."
        return any(c.startswith(prefixo) for c in classificacoes if c != grupo.classificacao)

    com_filha = sum(1 for g in sinteticas if tem_filha(g))
    assert com_filha / len(sinteticas) > 0.5

    # Problemas reais conhecidos nesse PDF — viram aviso, não erro silencioso
    # nem exceção. Cabeçalho/rodapé de página NÃO deve gerar aviso (senão
    # qualquer PDF de várias páginas dispara um aviso por página) — por isso o
    # length exato, não "pelo menos".
    # 1 linha com nome grudado no grau (sem espaço) + 4 contas cujo nome tem
    # "Ç" seguido de vogal — pdfplumber falha em decodificar esse glifo
    # específico de forma inconsistente entre chamadas (replacement char, byte
    # de controle ou mojibake variam); o parser não tenta adivinhar/corrigir,
    # só sinaliza pra conferência manual e mantém o dado bruto extraído.
    assert len(result.warnings) == 5
    assert any("ESCRITORIO INTELIGENTE" in w for w in result.warnings)
    for codigo_suspeito in ("10002", "10071", "10076", "10083"):
        assert any(codigo_suspeito in w for w in result.warnings), f"esperava aviso pra conta {codigo_suspeito}"

    raiz = next(i for i in result.items if i.classificacao == "1")
    assert raiz.nome.upper() == "ATIVO"
    assert raiz.tipo == "S"
    assert raiz.grau == 1
