from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

_PAYLOAD = {
    "cliente": {"razao_social": "CLIENTE TESTE LTDA", "cnpj": "12345678000199"},
    "periodo": {"ano": 2026, "mes": 7},
    "conta": {"codigo": "5", "nome": "CAIXA GERAL"},
    "saldo_anterior_cents": 918694900,
    "saldo_anterior_natureza": "D",
    "linhas": [
        {
            "data": "2026-07-10",
            "historico_codigo": "138",
            "historico_complemento": "Pagamento cliente X",
            "tipo": "C",
            "valor_cents": 15000,
            "saldo_cents": 917194900,
            "saldo_natureza": "D",
        }
    ],
    "saldo_atual_cents": 917194900,
    "saldo_atual_natureza": "D",
}


def test_gerar_razao_pdf_ok():
    r = client.post("/gerar/razao-pdf", json=_PAYLOAD)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")


def test_gerar_razao_pdf_sem_movimento_no_periodo():
    payload = {
        **_PAYLOAD,
        "linhas": [],
        "saldo_atual_cents": _PAYLOAD["saldo_anterior_cents"],
        "saldo_atual_natureza": _PAYLOAD["saldo_anterior_natureza"],
    }
    r = client.post("/gerar/razao-pdf", json=payload)
    assert r.status_code == 200
    assert r.content.startswith(b"%PDF")


def test_gerar_razao_pdf_saldo_zerado_sem_natureza():
    payload = {**_PAYLOAD, "saldo_anterior_cents": 0, "saldo_anterior_natureza": None}
    r = client.post("/gerar/razao-pdf", json=payload)
    assert r.status_code == 200


def test_gerar_razao_pdf_payload_invalido_da_422():
    r = client.post("/gerar/razao-pdf", json={"cliente": {}, "periodo": {}})
    assert r.status_code == 422
