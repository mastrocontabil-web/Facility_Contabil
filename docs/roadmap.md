# Roadmap / Milestones

| # | Milestone | Estado |
|---|-----------|--------|
| 1 | Scaffold + Auth + Supabase (schema, RLS, health, parser OFX) | ✅ feito |
| 2 | Clientes — CRUD | ✅ feito (verificado E2E no Supabase real) |
| 3 | Upload + Parser (OFX/CSV/XLS/XLSX/PDF) + endpoints + tela de importação | ✅ feito (verificado E2E) |
| 4 | Tela de Revisão — edição inline das contas, ações em massa, inativar, saldo | ✅ feito |
| 5 | Regras / memória por cliente | ✅ feito |
| 6 | Exportador Domínio + teste golden + download | ✅ feito (golden byte-a-byte) |
| 7 | Histórico + polimento | ⏳ próximo |
| 8 | Deploy + docs de operação | ⬜ |

## Milestone 4 — entregue

- `/revisao/:id` editável: por linha → conta contábil, código de histórico,
  complemento (**texto livre**, começa vazio) e checkbox **inativar** o lançamento.
- Modo do complemento no arquivo: histórico do extrato + complemento / só o
  histórico / só o complemento. Código do complemento fixo em `0000000`.
- Ações em massa: aplicar conta / cód. histórico a todas as entradas ou saídas;
  **inativar todas as saídas / todas as entradas / reativar todos**.
- Filtros (saídas / entradas / pendentes / inativadas / todas), contadores,
  edição do cabeçalho (conta banco, hist codes, lote), Salvar com dirty state.
- Backend: `PATCH /api/statements/:id/transactions` + RPC
  `update_transactions_bulk` (uma UPDATE pra 500+ linhas). Recalcula totais
  (só não-ignorados). migration 0003/0004.
- **Saldo bancário**: cadastro do cliente ganha `saldo_inicial`; cada extrato
  guarda `saldo_inicial` e `saldo_final`. Tela de importação e revisão mostram o
  saldo acumulado por lançamento + painel de conferência. Saldo inicial
  **encadeado** entre extratos do cliente (fecha um mês → abre o próximo);
  editável, e recalcula o `saldo_final`. migrations 0005/0006.

## Milestone 5 — entregue (reformulado: memória automática)

A 1ª versão (formulário "+ regra" na revisão) não pegou — o operador achou
pesado. Reformulado pra **aprender sozinho**:

- Ao **salvar a revisão**, cada lançamento classificado vira memória do cliente
  (`descrição do extrato → conta/hist/complemento`), via RPC
  `learn_classifications` — regras `match_type='exact'`, `auto=true`. `hits`
  conta quantas vezes aquela combinação foi confirmada.
- Na **importação**, `classify()` pré-preenche pela memória:
  - descrição com **1 conta** → `origem_preenchimento='memoria'`
  - descrição já usada com **contas diferentes** → preenche a mais usada e marca
    `origem_preenchimento='conferir'`
  - senão, cai nas regras manuais (`contains`/`regex`) → `'regra'`
- Revisão: coluna "Memória" (selo verde "memória" / âmbar "conferir"), filtro e
  contador "Conferir". Ao mexer numa linha, ela volta pra `'manual'`.
- Página `/memoria` (era `/regras`): lista o que foi aprendido agrupado por
  descrição, edita a conta, exclui. Sem formulário de criar.
- migration 0007 (`mapping_rules.auto`, índice único, RPCs).

## Milestone 6 — entregue

- `backend/src/dominio/exporter.ts` — arquivo posicional Leiaute Domínio.
  **Testado ponta a ponta: importa no Domínio Contábil sem erro.**
- 1ª tentativa falhou (formato do arquivo modelo antigo estava errado). Formato
  correto decodificado de um **export real do Domínio**: SEM BOM, Latin-1, CRLF;
  reg 01 (55 chars) / 02 (165) + 03 (664) por lançamento / 99; cód. histórico é
  campo de 7 dígitos; débito/crédito **sempre 7 chars** (não seguem
  `conta_width`); entrada → D banco / C contrapartida; saída → inverso.
  Golden test em `exporter.test.ts` reproduz um export real byte-a-byte.
- `POST /api/statements/:id/export` — valida (pendentes, conta > 7 dígitos),
  gera, guarda no bucket `exports` + `export_files`, marca `status='gerado'`,
  devolve o `.txt` pra download. Frontend: botão na Revisão + "baixar" no
  Histórico. Zero migration.
- Detalhe `docs/leiaute-dominio.md`.

## Onde paramos (2026-09-03)

M1–M6 prontos e o M6 já importou no Domínio de verdade. `npm run dev`
(3 serviços). 92 testes no backend, 22 no parser.

**Próximo: Milestone 7** — histórico + polimento (reimportar, apagar em massa,
UX), e depois **8** — deploy.

## Milestone 1 — entregue

- Monorepo (`frontend` / `backend` / `parser` / `supabase`).
- Migrations: `clients`, `chart_accounts`, `mapping_rules`, `statements`,
  `transactions`, `export_files` + RLS por `owner_id` + buckets `statements`/`exports`.
- Backend Express + TS: `/api/health`, `/api/health/deep`, `/api/me`,
  middleware de auth (JWT Supabase — HS256 local ou `getUser` remoto).
- Frontend React + Vite + Tailwind: login, rotas protegidas, layout, stubs das
  telas, painel de status dos serviços.
- Parser FastAPI: `/health`, `/parse` (OFX funcionando; CSV/XLS/PDF no M3).
- Testes: backend (vitest, 6) + parser (pytest, 5, inclui **golden test** com um
  extrato real).

## Milestone 2 — entregue

- `/api/clients` CRUD completo, isolado por usuário (RLS). Validação de CNPJ/CPF
  com dígito verificador.
- Tela Clientes: tabela, busca, filtro ativo/inativo, modal de cadastro/edição,
  exclusão com confirmação.
- Verificado ponta a ponta contra o Supabase real: login (ES256/JWKS), cadastro
  de cliente persistido com `owner_id` correto.
- 29 testes no backend.

## Milestone 3 — entregue

- Parser Python lê OFX, CSV (Nubank, BB, genérico), XLS/XLSX (+ detecta planilha
  protegida), PDF (**BB, Itaú e Nubank batem 100%** com CSV/OFX em extratos reais;
  outros bancos = melhor esforço com aviso). `parse_statement` aceita senha de PDF.
  Sempre que houver transações, o período = min/max delas (igual ao que o
  exportador Domínio usa).
- `POST /api/statements` (multipart): sobe no Storage, chama o parser, grava
  transactions com entrada/saída + hist_code por direção, status=revisao.
  `GET` (lista/detalhe), `PATCH`, `DELETE`.
- Frontend: tela de Nova Importação (cliente + conta banco + upload), resumo com
  totais, tabela de lançamentos (filtro entradas/saídas), `/revisao/:id`,
  `/historico`.
- **Verificado E2E** contra o Supabase real com extratos de verdade: Itaú (OFX
  44 lanç., PDF idem), Nubank (PDF 11 lanç. = OFX/CSV). Arquivos no
  Storage, RLS ok.
- 21 testes no parser, 36 no backend.

### Cobertura de leitura de extrato (testada contra extratos reais)

| Banco | OFX | CSV | PDF |
|-------|-----|-----|-----|
| Nubank | ✅ | ✅ | ✅ (layout em prosa) |
| Banco do Brasil ("Consultas" e app) | ✅ | ✅ | ✅ |
| Itaú | ✅ | — | ✅ |
| Banco Inter | ✅ | ✅ | ✅ |
| Bradesco | ✅ | ✅ | ✅ |
| Santander | ✅ | ✅ | ✅ |
| Banco C6 | ✅ | — | ✅ |
| Sicoob | — | — | ✅ (valor com sufixo C/D) |
| PagBank | ✅ | ✅ | ✅ |
| genérico (outros) | ✅ | ✅ (heurística) | melhor esforço + aviso |

Para cada pasta em `C:\SEFIP\EXTRATOS` com OFX, o teste
`test_sefip_bancos.py` confere que CSV e PDF dão o MESMO resultado do OFX.
XLS/XLSX: leitor genérico + detecção de planilha protegida (C6).

### Bugs corrigidos no caminho

- `formatDate` (frontend) deslocava datas-só um dia (Date() UTC vs UTC-3).
- `_guess_year` do PDF pegava o "/0001" de um CNPJ como ano.
- Extração de sinal `-` roubava o sinal do valor seguinte.
- Botão "Excluir" (Clientes/Histórico) usava `window.confirm`, bloqueado em
  alguns navegadores → modal próprio.

## Pendências conhecidas

- Campo "número do lote" no cabeçalho do arquivo Domínio (pos. 46 do registro 01)
  — confirmar no primeiro import real. Ver `docs/leiaute-dominio.md`.
- Largura do código de conta reduzido (default 7) — pode variar por plano de contas.
- PDF de bancos não listados acima: melhor esforço, com aviso pra conferir.
- XLS/XLSX genérico é fraco em planilhas com layout incomum.
