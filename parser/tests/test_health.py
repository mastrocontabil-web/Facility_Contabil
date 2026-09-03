from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "service": "parser"}


def test_parse_requires_file():
    r = client.post("/parse")
    assert r.status_code == 422  # falta o campo file


def test_parse_ofx_sample(sample_ofx_bytes: bytes):
    r = client.post("/parse", files={"file": ("sample.ofx", sample_ofx_bytes, "application/octet-stream")})
    assert r.status_code == 200
    body = r.json()
    assert body["format"] == "ofx"
    assert body["bank_id"] == "0260"
    assert body["period_start"] == "2026-07-01"
    assert body["period_end"] == "2026-07-31"
    assert len(body["transactions"]) == 3

    t0, t1, t2 = body["transactions"]
    assert t0["direction"] == "saida" and t0["amount_cents"] == 1000
    assert t1["direction"] == "entrada" and t1["amount_cents"] == 234055
    assert "&" in t1["description"]  # &amp; desescapado
    assert t2["direction"] == "entrada" and t2["amount_cents"] == 10000


def test_parse_csv_ok():
    csv = b"Data,Valor,Descricao\n01/07/2026,-10,00,Teste\n05/07/2026,20,50,Outro\n"
    r = client.post("/parse", files={"file": ("x.csv", csv, "text/csv")})
    assert r.status_code == 200
    assert r.json()["format"] == "csv"


def test_parse_pdf_texto_invalido_da_422():
    r = client.post("/parse", files={"file": ("x.pdf", b"%PDF-1.4 lixo", "application/pdf")})
    assert r.status_code == 422
