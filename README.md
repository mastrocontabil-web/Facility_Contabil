# Sistema Extrato → Domínio

Web app para transformar **extrato bancário** (PDF/OFX/CSV/XLS/XLSX) em **arquivo de
importação de lançamentos contábeis em lote** no **Leiaute Domínio Sistemas**.

Fluxo:

1. **Cadastra o cliente** — código da empresa no Domínio, conta contábil do banco,
   códigos de histórico padrão e o **saldo inicial da conta bancária**.
2. **Sobe o extrato do mês** (PDF/OFX/CSV/XLS/XLSX). O sistema lê os lançamentos,
   separa entradas/saídas e mostra o **saldo bancário acumulado por lançamento**
   com um painel de conferência — pra bater com o saldo do extrato no fim do mês.
   O saldo inicial vem **encadeado** do extrato anterior daquele cliente (fecha um
   mês, abre o próximo).
3. **Revisa** — por linha: conta contábil da contrapartida, código de histórico e
   complemento (texto livre). Ações em massa por entrada/saída, e dá pra **inativar**
   lançamentos que não devem ir pro arquivo. Ao salvar, cada classificação vira
   **memória do cliente** (`descrição do extrato → conta`) e volta pré-preenchida
   no mês seguinte; descrição já usada com contas diferentes vem marcada
   "conferir".
4. **Gera o `.txt`** no Leiaute Domínio e baixa — pronto pra importar em
   Utilitários → Importação → Lançamentos contábeis em lote (testado, importa
   sem erro).

## Serviços

| Pasta       | Stack                       | Porta | Papel |
|-------------|-----------------------------|-------|-------|
| `frontend/` | React + Vite + TS + Tailwind | 5173 | SPA |
| `backend/`  | Node + Express + TS          | 8080 | API, memória de classificação, geração do arquivo Domínio |
| `parser/`   | Python + FastAPI             | 8100 | leitura dos extratos → JSON normalizado |
| `supabase/` | migrations SQL + RLS         | —    | Postgres, Auth, Storage (projeto cloud) |

O frontend só fala com o `backend`. O `backend` chama o `parser` (protegido por
segredo compartilhado) e o Supabase (no contexto do usuário, com RLS).

## Pré-requisitos

- **Node.js 20+** e npm
- **Python 3.12+**
- Uma conta no **[Supabase](https://app.supabase.com)** (plano free serve)
- (opcional) Docker, se quiser rodar via `docker compose`

## Setup

### 1. Supabase

Siga [`docs/supabase-setup.md`](docs/supabase-setup.md) até a parte das chaves. No
fim você terá: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_JWT_SECRET` e `SUPABASE_DB_URL`. As tabelas/buckets entram no passo 4.

### 2. Variáveis de ambiente

```bash
cp .env.example .env                    # referência central
cp backend/.env.example  backend/.env   # preencha com os dados do Supabase
cp frontend/.env.example frontend/.env  # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
cp parser/.env.example   parser/.env    # PARSER_SHARED_SECRET (invente um)
```

`PARSER_SHARED_SECRET` deve ser **o mesmo** em `backend/.env` e `parser/.env`.

### 3. Instalar dependências

```bash
npm install                              # frontend + backend (workspaces)
cd parser && python -m venv .venv && .venv\Scripts\pip install -r requirements.txt && cd ..
```

### 4. Aplicar as migrations

Com `SUPABASE_DB_URL` preenchido em `backend/.env` (ver `docs/supabase-setup.md`):

```bash
npm run migrate -w backend               # idempotente; roda supabase/migrations/*.sql
```

### 5. Rodar (dev)

```bash
# 3 terminais, ou:
npm run dev            # sobe frontend + backend + parser juntos
```

- Frontend: http://localhost:5173
- Backend:  http://localhost:8080/api/health
- Parser:   http://localhost:8100/health

Crie um usuário em **Supabase → Authentication → Users → Add user** e faça login.

### Com Docker (alternativa)

```bash
docker compose up --build   # sobe backend + parser; rode o frontend com `npm run dev -w frontend`
```

## Testes

```bash
npm test                    # backend (vitest) + parser (pytest)
npm run test -w backend
cd parser && .venv\Scripts\pytest
```

Hoje: **95 testes no backend**, **26 no parser**.

`backend/src/dominio/exporter.test.ts` tem um **golden test** que compara o
arquivo gerado com um export real do Domínio (roda se `C:\SEFIP\lancto.txt`
existir). Os testes do parser comparam PDF/CSV vs OFX pra cada pasta em
`C:\SEFIP\EXTRATOS`. Tudo que depende de arquivo de cliente é pulado quando o
caminho não existe (não quebra em outra máquina).

## Documentação

- [`docs/supabase-setup.md`](docs/supabase-setup.md) — criar o projeto Supabase
- [`docs/leiaute-dominio.md`](docs/leiaute-dominio.md) — o formato do arquivo gerado
- [`docs/arquitetura.md`](docs/arquitetura.md) — visão geral
- [`docs/roadmap.md`](docs/roadmap.md) — milestones

## Estado atual

**Milestones 1–7 entregues** (ver [`docs/roadmap.md`](docs/roadmap.md)):

- **1** — scaffold, Supabase Auth (ES256/JWKS), schema + RLS por `owner_id`, health checks.
- **2** — CRUD de clientes isolado por usuário, validação de CNPJ/CPF.
- **3** — upload + parser (OFX/CSV/XLS/XLSX/PDF) + tela de importação. Leitura
  verificada contra extratos reais de **Nubank, BB, Itaú, Inter, Bradesco,
  Santander, C6, Sicoob e PagBank** (PDF/CSV batendo com o OFX).
- **4** — tela de Revisão: edição inline, ações em massa, **inativar** lançamentos,
  modo do complemento, conferência do **saldo bancário** encadeado entre extratos.
- **5** — **memória de classificação automática**: ao salvar a revisão, cada
  `descrição do extrato → conta/histórico/complemento` fica memorizada por
  cliente e volta pré-preenchida no mês seguinte; descrição já usada com contas
  diferentes vem marcada "conferir". Menu **Memória** pra ver/editar/apagar.
- **6** — **exportador do arquivo Domínio** (Leiaute Domínio Sistemas) + download.
  **Testado ponta a ponta: importa no Domínio Contábil sem erro.** Formato
  decodificado de um export real do Domínio; golden test byte-a-byte.
- **7** — **reimportar** um extrato (troca o arquivo sem recadastrar), histórico
  com filtro por cliente/status e exclusão em massa, polimento de UX
  (responsivo, aviso antes de sair da revisão sem salvar).

**Próximo: Milestone 8** — deploy (hospedar de verdade, fora do `localhost`).

## Uso no dia a dia

`iniciar.bat` sobe os 3 serviços com um clique. Pra rodar em outra máquina,
`empacotar.ps1` gera um `.zip` (com os `.env`, sem `node_modules`/`.venv`) e
`configurar.bat` instala tudo na máquina nova — ver os comentários de cada
script.
