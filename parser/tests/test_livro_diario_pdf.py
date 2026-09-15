from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

_PAYLOAD = {
    "cliente": {"razao_social": "CLIENTE TESTE LTDA", "cnpj": "12345678000199"},
    "periodo": {"ano": 2026, "mes": 7},
    "lancamentos": [
        {
            "data": "2026-07-10",
            "historico_codigo": "138",
            "historico_complemento": "Pagamento fornecedor X",
            "partidas": [
                {"conta_codigo": "2.1.1.01", "conta_nome": "FORNECEDORES", "tipo": "D", "valor_cents": 10000},
                {"conta_codigo": "1.1.1.01", "conta_nome": "CAIXA", "tipo": "C", "valor_cents": 10000},
            ],
        },
        {
            "data": "2026-07-10",
            "historico_codigo": None,
            "historico_complemento": "Recebimento diverso",
            "partidas": [
                {"conta_codigo": "1.1.1.01", "conta_nome": "CAIXA", "tipo": "D", "valor_cents": 5000},
                {"conta_codigo": "4.1.1.01", "conta_nome": "RECEITA DE VENDAS", "tipo": "C", "valor_cents": 5000},
            ],
        },
    ],
}


def test_gerar_livro_diario_pdf_ok():
    r = client.post("/gerar/livro-diario-pdf", json=_PAYLOAD)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")


def test_gerar_livro_diario_pdf_periodo_sem_lancamentos():
    payload = {**_PAYLOAD, "lancamentos": []}
    r = client.post("/gerar/livro-diario-pdf", json=payload)
    assert r.status_code == 200
    assert r.content.startswith(b"%PDF")


def test_gerar_livro_diario_pdf_payload_invalido_da_422():
    r = client.post("/gerar/livro-diario-pdf", json={"cliente": {}, "periodo": {}})
    assert r.status_code == 422
