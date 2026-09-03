# Arquitetura

```
┌───────────┐   HTTPS + JWT   ┌───────────┐   HTTP + segredo   ┌──────────┐
│ frontend  │ ──────────────► │  backend  │ ─────────────────► │  parser  │
│  (React)  │                 │  (Node)   │                    │ (Python) │
└─────┬─────┘                 └─────┬─────┘                    └──────────┘
      │ Supabase Auth (login)       │ PostgREST + Storage (contexto do usuário)
      ▼                             ▼
┌──────────────────────────────────────────┐
│                Supabase                   │
│  Auth  ·  Postgres (RLS)  ·  Storage      │
└──────────────────────────────────────────┘
```

## Decisões

- **Frontend só fala com o backend.** O Supabase JS no frontend é usado apenas
  para autenticação (login, sessão, refresh de token). Todo dado passa pelo
  backend — uma superfície só.
- **Backend usa o JWT do usuário** (não a `service_role`) para PostgREST e
  Storage. Assim a RLS do Postgres é a barreira real de isolamento e
  `auth.uid()` resolve. A `service_role` fica reservada para tarefas
  administrativas (validar token, jobs).
- **Parser é stateless e isolado.** Não tem acesso ao banco. Recebe um arquivo,
  devolve JSON normalizado. Protegido por segredo compartilhado (`X-Parser-Secret`).
  Fica em Python porque o ecossistema de leitura de PDF/OFX/XLS é muito melhor lá
  (`pdfplumber`, `ofxparse`, `pandas`).
- **Geração do arquivo Domínio no backend** (`src/dominio/exporter.ts`), num
  módulo isolado, testado byte a byte contra um arquivo real.

## Fluxo de uma importação

1. Frontend faz `POST /api/statements` (multipart: client_id, conta banco, arquivo).
2. Backend valida, sobe o arquivo pro Storage (`statements/<uid>/<id>/<arquivo>`),
   cria a linha `statements` (status `parsing`).
3. Backend chama `POST parser/parse` com o arquivo.
4. Parser devolve `{ transactions: [...] , period, bank_id }`.
5. Backend grava as `transactions`, classifica entrada/saída, aplica
   `mapping_rules` do cliente, muda status para `revisao`.
6. Frontend abre a tela de Revisão (`GET /api/statements/:id`).
7. Usuário edita, salva regras (`POST /api/rules`), valida.
8. `POST /api/statements/:id/export` → backend gera o `.txt`, valida
   Σdébito = Σcrédito, guarda em `exports/`, devolve para download.
