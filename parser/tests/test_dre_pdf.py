from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

# Números reais do cliente GABRIEL PINHEIRO, período 06/2026 (RESUMO DO
# BALANCETE) — validados cent-a-cent no C5 contra a fórmula de resultado.
_PAYLOAD = {
    "cliente": {"razao_social": "CLIENTE TESTE LTDA", "cnpj": "12345678000199"},
    "periodo": {"ano": 2026, "mes": 6},
    "receitas": {
        "raiz": {
            "codigo": "4",
            "nome": "CONTAS DE RESULTADO - RECEITAS",
            "tipo": "S",
            "saldo_anterior_cents": 23747756,
            "saldo_anterior_natureza": "C",
            "debito_cents": 326806,
            "credito_cents": 4329927,
            "saldo_atual_cents": 27750877,
            "saldo_atual_natureza": "C",
        },
        "linhas": [],
    },
    "despesas": {
        "raiz": {
            "codigo": "5",
            "nome": "CONTAS DE RESULTADOS - CUSTOS E DESPESAS",
            "tipo": "S",
            "saldo_anterior_cents": 4780637,
            "saldo_anterior_natureza": "D",
            "debito_cents": 730756,
            "credito_cents": 0,
            "saldo_atual_cents": 5511393,
            "saldo_atual_natureza": "D",
        },
        "linhas": [],
    },
    "resultado_mes": {"cents": 3272365, "natureza": "C"},
    "resultado_exercicio": {"cents": 22239484, "natureza": "C"},
}


def test_gerar_dre_pdf_ok():
    r = client.post("/gerar/dre-pdf", json=_PAYLOAD)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")


def test_gerar_dre_pdf_resultado_nulo():
    payload = {
        **_PAYLOAD,
        "resultado_mes": {"cents": 0, "natureza": None},
        "resultado_exercicio": {"cents": 0, "natureza": None},
    }
    r = client.post("/gerar/dre-pdf", json=payload)
    assert r.status_code == 200
    assert r.content.startswith(b"%PDF")


def test_gerar_dre_pdf_payload_invalido_da_422():
    r = client.post("/gerar/dre-pdf", json={"cliente": {}, "periodo": {}})
    assert r.status_code == 422
