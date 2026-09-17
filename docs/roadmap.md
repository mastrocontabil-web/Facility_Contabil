# Roadmap / Milestones

| # | Milestone | Estado |
|---|-----------|--------|
| 1 | Scaffold + Auth + Supabase (schema, RLS, health, parser OFX) | ✅ feito |
| 2 | Clientes — CRUD | ✅ feito (verificado E2E no Supabase real) |
| 3 | Upload + Parser (OFX/CSV/XLS/XLSX/PDF) + endpoints + tela de importação | ✅ feito (verificado E2E) |
| 4 | Tela de Revisão — edição inline das contas, ações em massa, inativar, saldo | ✅ feito |
| 5 | Regras / memória por cliente | ✅ feito |
| 6 | Exportador Domínio + teste golden + download | ✅ feito (golden byte-a-byte, importou no Domínio real) |
| 7 | Reimportar + histórico + polimento | ✅ feito |
| 8 | Deploy + docs de operação | ⏳ próximo |

## Módulo Contábil (C1-C11)

Escrituração contábil em partida dobrada por dentro do próprio sistema —
roadmap e numeração próprios ("C" de Contábil), independentes do M1-M8 acima
(módulo Importação/Classificação). Todos os 11 milestones entregues.

| # | Milestone | Estado |
|---|-----------|--------|
| C1 | Plano de contas (import PDF + manual) + históricos padrão | ✅ feito |
| C2 | Importar balancete (fecha o período, vira autoridade) | ✅ feito |
| C3 | Lançamento manual em partida dobrada (simples/múltipla) | ✅ feito |
| C4 | Motor de saldos (recalcula em cascata, ancorado no último fechado) | ✅ feito |
| C5 | Relatórios Balancete + DRE, PDF de verdade (parser/reportlab) | ✅ feito (DRE bate cent-a-cent com o Domínio) |
| C6 | Relatórios Razão + Livro Diário, PDF | ✅ feito |
| C7 | Exportar pro Domínio a partir dos lançamentos + fechar período | ✅ feito |
| C8 | Importar lançamentos do módulo Importação | ✅ feito |
| C9 | Lançamentos recorrentes (modelo genérico) | ✅ feito |
| C10 | Trilha de auditoria + guarda-corpos + diagnóstico do fechamento | ✅ feito |
| C11 | Acabamento — sub-nav, polimento, mobile, docs | ✅ feito |

### C1 — Plano de contas + históricos padrão

`backend/src/contabil/`: `plano_contas` (hierárquica — `tipo` sintética/
analítica, `classificacao` tipo "1.1.1.02", `parent_id`) e `historicos_padrao`
(catálogo único do escritório, sem `client_id`). `parent_id` de toda conta do
cliente é recalculado via RPC (`relink_plano_contas_parents`) a cada import ou
edição — nunca mantido manualmente. Import lê o PDF "Plano de Contas" do
Domínio no parser Python; cadastro manual pela tela cobre o caso avulso.

### C2 — Importar balancete

Sobe o PDF "Balancete" do Domínio, grava uma linha de `saldos_contabeis` por
conta naquele período (vinculando por código ao plano de contas) e o período
nasce **fechado** — vira autoridade: nenhum lançamento manual entra ali, e o
motor de saldos (C4) nunca recalcula por cima. Conta do balancete sem
correspondência no plano de contas entra **sem vínculo** (linha órfã, com
aviso), em vez de travar a importação inteira.

### C3 — Lançamento manual em partida dobrada

`lancamentos` (cabeçalho: data, histórico) + `lancamento_partidas` (linhas
D/C, `valor_cents`, `plano_conta_id not null`) — soma dos débitos precisa
igualar a soma dos créditos, validado no backend (zod), não como CHECK (regra
cruza linhas). O período do mês da data lançada **abre sozinho**
(`resolvePeriodoAberto`, upsert com `ignoreDuplicates`); nunca lança nem edita
num período já fechado. Editar/excluir sempre apaga e recria as partidas (nunca
edição em lugar), mesmo padrão de "reimportar" do módulo Importação.

### C4 — Motor de saldos

`saldoEngine.ts`: recalcula o saldo de toda conta (inclusive sintética, por
rollup dos filhos) sempre que um lançamento entra, sai ou muda num período
aberto. Convenção de aritmética com sinal (D positivo, C negativo — zero é
natureza `null`) simplifica a soma em vez de ramificar por natureza a cada
operação. Ancora sempre no saldo do **último período fechado** daquele
cliente e recalcula o trecho aberto inteiro a partir dali; nunca sobrescreve
saldo de um período fechado (Balancete ou fechamento manual são autoridade).

### C5 — Relatórios Balancete + DRE

Primeira geração de PDF de verdade do sistema: o parser (Python + reportlab)
monta os bytes a partir de um JSON já pronto que o backend monta; o backend só
busca dado e formata pro parser, nunca desenha PDF. DRE identifica
receita/despesa pelo padrão de nomes de conta do Domínio (não por um campo
próprio) — verificado ao vivo batendo cent-a-cent com o Resumo do Balancete do
Domínio real.

### C6 — Relatórios Razão + Livro Diário

Razão: saldo anterior de uma conta analítica + cada movimento em ordem
cronológica com saldo corrente + saldo atual — mesmo motor de PDF do C5.
Livro Diário: lista cronológica de todos os lançamentos do período (não por
conta). Os dois avisam explicitamente quando o período é de Balancete
(fechado sem lançamento manual) em vez de fingir que o número mostrado é a
escrituração completa do mês.

### C7 — Exportar pro Domínio + fechar período

`dominio/exporter.ts` ganha `buildDominioFileFromLancamentos` (ao lado da
função já existente do módulo Importação, sem alterá-la): um lançamento com
mais de um débito ou crédito é **decomposto em pares elementares** D/C
(greedy, consumindo o mínimo de cada fila ordenada por `ordem`) — abordagem
escolhida com o usuário por ser a única capaz de reproduzir o formato 1:1 já
homologado quando não há partida múltipla; sequência dos registros 02/03 vira
um contador único corrido (a regra documentada de "par/ímpar" era só um
artefato do formato antigo). **Pendente de confirmação contra um import real
do Domínio com partida múltipla** — ver `docs/leiaute-dominio.md`. Ação
`POST /periodos/:id/fechar` (mínimo necessário: bloqueia sem lançamento,
recalcula saldo antes de marcar fechado) introduzida aqui — guarda-corpos e
trilha de auditoria completos ficaram pro C10, de propósito.

### C8 — Importar lançamentos do módulo Importação

Primeira ponte NA OUTRA DIREÇÃO: `POST /lancamentos/importar-transacoes` pega
transações já revisadas no módulo Importação (extrato → conta contábil por
linha) e gera lançamento de partida dobrada, pro cliente que escritura pelo
Contábil sem digitar tudo de novo. `lancamentos.origem_transaction_id`
(nullable, `unique`, `on delete set null`) rastreia a origem e garante
idempotência de graça — reimportar o extrato de origem não duplica nem apaga
o lançamento já gerado, só perde o selo de origem. Transação sem conta
resolvida (banco ou contrapartida) é pulada com aviso, nunca lançamento "pela
metade" (`lancamento_partidas.plano_conta_id` é `not null`).

### C9 — Lançamentos recorrentes

Escopo decidido com o usuário: **modelo genérico**, não calculadoras de
depreciação/pró-labore/folha com lógica tributária própria.
`lancamento_modelos` + `lancamento_modelo_partidas` guardam nome + histórico +
partidas com **valor opcional** (fixo quando sempre igual, em branco quando
varia a cada geração). "Gerar lançamento a partir de um modelo" não é uma ação
de backend — é o frontend pré-preenchendo o formulário normal de lançamento
(`LancamentoModal`) a partir do modelo escolhido; salvar passa pelo
`POST /lancamentos` de sempre, reaproveitando 100% da validação existente.
Tela própria `/contabil/modelos` (CRUD).

### C10 — Trilha de auditoria + guarda-corpos + diagnóstico

`contabil_auditoria` (append-only — só policy de `select`/`insert`, nunca
`update`/`delete`) registra `fechado`/`reaberto`/`dominio_exportado` com um
`detalhe jsonb` por evento. Guarda-corpo novo no fechamento: não fecha um
período se o anterior do mesmo cliente ainda estiver aberto (senão o saldo
anterior dele pode mudar depois de já fechado/exportado). `POST
/periodos/:id/reabrir` (novo, reabertura simples decidida com o usuário — sem
bloqueio mesmo se já exportado, só registra) tem o guarda-corpo espelhado: não
reabre se um período posterior já está fechado. Os dois protegem a mesma
invariante ("períodos fechados formam um prefixo cronológico contíguo") a
partir de lados opostos. `GET /periodos/:id/diagnostico` expõe os dois avisos
+ a trilha de eventos ANTES do usuário tentar a ação e falhar.

### C11 — Acabamento

Sub-nav (barra lateral com submenu do módulo) já cabia bem com os 9 itens do
Contábil em desktop e no menu-gaveta mobile — verificado ao vivo, sem mudança.
Mobile: a linha de partida (tipo D/C + conta + valor) do formulário de
lançamento e de modelo ficava ilegível em telas estreitas — corrigido
empilhando o `<select>` de conta em linha própria abaixo do breakpoint `sm:`
(só Tailwind, sem componente novo); acerto de `min-w-0` necessário porque um
item flex não encolhe abaixo do seu conteúdo mínimo por padrão, o que
inicialmente quebrava o layout também em desktop. Barra de ações da tela de
Lançamentos reorganizada em coluna no mobile. Este documento.

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

## Milestone 7 — entregue

- **Reimportar**: `POST /api/statements/:id/reimport` troca o arquivo de uma
  importação existente — reparseia, apaga os lançamentos antigos, reaplica a
  memória, recalcula totais/saldo, volta pra "em revisão". Mantém cliente,
  conta banco, hist codes, lote, saldo inicial. Erro do parser marca
  `status='erro'` sem apagar os lançamentos atuais. Handler de import (`POST /`)
  refatorado pra compartilhar a lógica (`gravarLancamentos`).
- **Histórico**: filtro por cliente e status, coluna "Saldo final", seleção
  múltipla + exclusão em massa.
- **Polimento**: cabeçalho responsivo (nav com scroll próprio em tela
  estreita), formulários em 1 coluna no celular, tabela de clientes com
  `overflow-x-auto`, favicon, aviso antes de sair da revisão com alterações
  não salvas (beforeunload + confirmação no "Voltar").
- Bônus: 2 bugs de parser corrigidos rodando a bateria `C:\SEFIP\EXTRATOS`
  (PDF do BB "Consultas" lendo saldo em vez de valor; XLSX truncado pela
  openpyxl). `test_sefip_bancos.py` agora cobre todas as pastas, não só as
  com OFX. Repo publicado no GitHub (histórico zerado, sem dado de cliente).

## Onde paramos (2026-09-04)

M1–M7 prontos. `npm run dev` (3 serviços) ou `iniciar.bat`. 95 testes no
backend, 26 no parser.

**Próximo: Milestone 8** — deploy (hospedar de verdade, fora do
`localhost`) + docs de operação.

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
