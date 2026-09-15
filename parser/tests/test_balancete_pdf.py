from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

_PAYLOAD = {
    "cliente": {"razao_social": "CLIENTE TESTE LTDA", "cnpj": "12345678000199"},
    "periodo": {"ano": 2026, "mes": 7},
    "linhas": [
        {
            "codigo": "1",
            "nome": "ATIVO",
            "tipo": "S",
            "saldo_anterior_cents": 100000,
            "saldo_anterior_natureza": "D",
            "debito_cents": 5000,
            "credito_cents": 2000,
            "saldo_atual_cents": 103000,
            "saldo_atual_natureza": "D",
        },
        {
            "codigo": "4",
            "nome": "CAIXA GERAL",
            "tipo": "A",
            "saldo_anterior_cents": 100000,
            "saldo_anterior_natureza": "D",
            "debito_cents": 5000,
            "credito_cents": 2000,
            "saldo_atual_cents": 103000,
            "saldo_atual_natureza": "D",
        },
    ],
}


def test_gerar_balancete_pdf_ok():
    r = client.post("/gerar/balancete-pdf", json=_PAYLOAD)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF")


def test_gerar_balancete_pdf_lista_vazia():
    payload = {**_PAYLOAD, "linhas": []}
    r = client.post("/gerar/balancete-pdf", json=payload)
    assert r.status_code == 200
    assert r.content.startswith(b"%PDF")


def test_gerar_balancete_pdf_payload_invalido_da_422():
    r = client.post("/gerar/balancete-pdf", json={"cliente": {}, "periodo": {}, "linhas": []})
    assert r.status_code == 422
