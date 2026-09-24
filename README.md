# Facility Contábil

Web app para transformar **extrato bancário** (PDF/OFX/CSV/XLS/XLSX) em **arquivo de
importação de lançamentos contábeis em lote** no **Leiaute Domínio Sistemas** — e,
desde o módulo Contábil, também fazer a **escrituração contábil em partida dobrada**
por dentro do próprio sistema (plano de contas, lançamentos, saldos e relatórios).

Depois do login cai num **hub** com quatro módulos:

- **Cadastros** — clientes: código no Domínio, conta contábil do banco, códigos
  de histórico padrão e o **saldo inicial da conta bancária**.
- **Importação** — o fluxo contábil de ponta a ponta a partir do extrato bancário
  (abaixo).
- **Classificação** — categoriza os lançamentos do extrato por tipo de despesa/
  receita (água, energia, recebimento de clientes…) **antes** de virar
  contabilidade; serve pra quem quer separar "o que aconteceu no extrato" de
  "qual conta contábil isso vira".
- **Contábil** — plano de contas, históricos padrão, importar balancete,
  lançamento manual em partida dobrada, cálculo automático de saldo por
  período e relatórios (Balancete, DRE, Razão, Livro Diário) com exportação
  em PDF de verdade (abaixo).

## Fluxo — Importação

1. **Escolhe o cliente** e **sobe o extrato do mês** (PDF/OFX/CSV/XLS/XLSX) — ou
   **puxa um extrato já classificado** no módulo Classificação, sem reimportar o
   arquivo. O sistema lê os lançamentos, separa entradas/saídas e mostra o
   **saldo bancário acumulado por lançamento** com um painel de conferência —
   pra bater com o saldo do extrato no fim do mês. O saldo inicial vem
   **encadeado** do extrato anterior daquele cliente (fecha um mês, abre o
   próximo).
2. **Revisa** — por linha: conta contábil da contrapartida, código de histórico e
   complemento (texto livre). Ações em massa por entrada/saída, e dá pra **inativar**
   lançamentos que não devem ir pro arquivo. Ao salvar, cada classificação vira
   **memória do cliente** (`descrição do extrato → conta`) e volta pré-preenchida
   no mês seguinte; descrição já usada com contas diferentes vem marcada
   "conferir". Quando o extrato veio do módulo Classificação, a categoria de
   cada lançamento aparece como contexto e pode entrar no complemento do
   arquivo junto com (ou no lugar do) texto digitado.
3. **Gera o `.txt`** no Leiaute Domínio e baixa — pronto pra importar em
   Utilitários → Importação → Lançamentos contábeis em lote (testado, importa
   sem erro).

## Fluxo — Classificação

1. Escolhe o cliente e sobe o extrato (mesmo parser da Importação) — aqui não
   pede conta do banco nem código de histórico, só o essencial pra ler.
2. Classifica cada lançamento por categoria (não por conta contábil) usando um
   catálogo próprio do cliente — cria categoria nova direto na tela ("+ nova
   classificação…"), em massa por entrada/saída. As categorias e as
   classificações de cada lançamento ficam salvas e valem pra qualquer mês.
   Uma categoria **em uso não pode ser excluída** (só desativada).
3. Quando terminar, **puxa pra Importação** — escolhe a conta do banco, os
   códigos de histórico e o lote, e o mesmo registro segue pro fluxo normal de
   Revisão/exportação (sem duplicar o extrato).

## Fluxo — Contábil

1. **Plano de contas**: importa o PDF "Plano de Contas" do Domínio (ou cadastra
   conta por conta na tela) — a hierarquia sintética/analítica é montada
   automaticamente a partir da classificação. Catálogo de **históricos
   padrão** (código + descrição) fica à parte, reaproveitado em qualquer
   lançamento.
2. **Importar balancete**: sobe o PDF "Balancete" do Domínio — grava o saldo de
   cada conta naquele mês, vinculando por código ao plano de contas, e
   **fecha o período** (vira autoridade: nada recalcula por cima dele depois).
3. **Lançamentos**: lança manualmente em partida dobrada (um débito e um
   crédito, ou múltiplos) — o período do mês da data lançada **abre sozinho**;
   não dá pra lançar num período já fechado. Editar ou excluir um lançamento
   recalcula o saldo das contas afetadas na hora (inclusive as sintéticas, por
   soma dos filhos).
4. **Relatórios**, todos com botão **Exportar PDF** (gerado de verdade no
   backend, não é print da tela):
   - **Balancete** — saldo de cada conta no período selecionado.
   - **DRE** — receitas, despesas e o resultado do mês e do exercício.
   - **Razão** — livro-razão de uma conta: saldo anterior, cada movimento em
     ordem cronológica com saldo corrente, saldo atual.
   - **Livro Diário** — lista cronológica de todos os lançamentos do período.

   Período **fechado** (importado via Balancete) não tem lançamento manual por
   definição — Razão e Livro Diário avisam isso na tela em vez de fingir que o
   número mostrado é a escrituração completa do mês.

## Serviços

| Pasta       | Stack                       | Porta | Papel |
|-------------|-----------------------------|-------|-------|
| `frontend/` | React + Vite + TS + Tailwind | 5173 | SPA |
| `backend/`  | Node + Express + TS          | 8080 | API, memória de classificação, geração do arquivo Domínio, motor de saldos contábeis |
| `parser/`   | Python + FastAPI             | 8100 | leitura dos extratos/PDFs contábeis → JSON normalizado; geração dos PDFs dos relatórios (reportlab) |
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

Hoje: **274 testes no backend**, **67 no parser**.

`backend/src/dominio/exporter.test.ts` tem um **golden test** que compara o
arquivo gerado com um export real do Domínio (roda se `C:\SEFIP\lancto.txt`
existir). Os testes do parser comparam PDF/CSV vs OFX pra cada pasta em
`C:\SEFIP\EXTRATOS`. Tudo que depende de arquivo de cliente é pulado quando o
caminho não existe (não quebra em outra máquina).

## Documentação

- [`docs/supabase-setup.md`](docs/supabase-setup.md) — criar o projeto Supabase
- [`docs/leiaute-dominio.md`](docs/leiaute-dominio.md) — o formato do arquivo gerado
- [`docs/arquitetura.md`](docs/arquitetura.md) — visão geral
- [`docs/roadmap.md`](docs/roadmap.md) — milestones dos dois roadmaps: módulos de Importação/Classificação (M1-M8) e módulo Contábil (C1-C11)

## Estado atual

**Milestones 1–7 e 9 entregues** (ver [`docs/roadmap.md`](docs/roadmap.md)); o
**8 (deploy)** ainda não:

- **1** — scaffold, Supabase Auth (ES256/JWKS), schema + RLS por `owner_id`, health checks.
- **2** — CRUD de clientes isolado por usuário, validação de CNPJ/CPF.
- **3** — upload + parser (OFX/CSV/XLS/XLSX/PDF) + tela de importação. Leitura
  verificada contra extratos reais de **Nubank, BB, Itaú, Inter, Bradesco,
  Santander, C6, Sicoob, PagBank e Mercado Pago** (PDF/CSV batendo com o OFX, ou
  com o resumo impresso no próprio extrato quando o banco só dá PDF).
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
- **9** — rebrand pra **Facility Contábil** + tela de **hub** com os módulos.
  Módulo **Classificação** novo: importa o extrato e categoriza cada
  lançamento por tipo de despesa/receita (catálogo por cliente, criado na
  hora), independente da conta contábil; extrato classificado é **puxado** pra
  Importação (mesmo registro, sem duplicar) pra virar contabilidade e gerar o
  arquivo do Domínio. Complemento do arquivo ganha os modos "extrato +
  classificação" e "extrato + complemento + classificação". Classificação em
  uso não pode ser excluída (só desativada).

**Módulo Contábil (novo, roadmap próprio C1–C11, todos entregues):**

- **C1** — plano de contas: importa o PDF "Plano de Contas" do Domínio ou
  cadastra manualmente; hierarquia sintética/analítica calculada a partir da
  classificação (`parent_id`, religado via RPC a cada import/edição). Catálogo
  de históricos padrão.
- **C2** — importar balancete: lê o PDF "Balancete" do Domínio, grava o saldo
  de cada conta no período (fecha o mês), vincula por código ao plano de
  contas; conta sem correspondência entra sem vínculo (com aviso) em vez de
  travar a importação.
- **C3** — lançamento manual em partida dobrada (simples ou múltipla); o
  período abre sozinho no mês da data lançada, nunca lança num período já
  fechado.
- **C4** — motor que recalcula o saldo de toda conta (inclusive sintética, por
  rollup dos filhos) sempre que um lançamento entra num período aberto.
  Ancora sempre no último período fechado e recalcula o trecho aberto inteiro
  a partir dali; nunca sobrescreve um período fechado (Balancete é
  autoridade).
- **C5** — relatório Balancete e DRE (identifica receita/despesa pelo padrão de
  nomes do Domínio). Primeira geração de PDF de verdade do sistema: o parser
  (Python + reportlab) monta os bytes, o backend busca o dado e devolve pro
  navegador — verificado ao vivo, DRE bate cent-a-cent com o Resumo do
  Balancete do Domínio.
- **C6** — relatório Razão (saldo anterior + cada movimento cronológico com
  saldo corrente, por conta analítica) e Livro Diário (lista cronológica de
  lançamentos), os dois com exportação em PDF.
- **C7** — exportar o período fechado pro arquivo Domínio a partir dos
  lançamentos do Contábil (não só do Balancete): lançamento com mais de um
  débito/crédito é decomposto em pares elementares D/C (best-effort, pendente
  de confirmação contra um import real com partida múltipla — ver
  `docs/leiaute-dominio.md`). Ação de **fechar período** manualmente
  introduzida aqui (mínimo necessário; guarda-corpos completos ficaram pro
  C10).
- **C8** — importar lançamentos do módulo Importação: transações já
  classificadas (extrato → conta contábil) viram lançamento de partida
  dobrada, sem digitar de novo. Idempotente (`origem_transaction_id` único,
  reimportar não duplica); pula transação sem conta resolvida ou já
  importada, com aviso; nunca lançamento "pela metade".
- **C9** — lançamentos recorrentes: **modelo genérico** (nome + histórico +
  partidas com valor opcional) reutilizável — carregar um modelo só
  pré-preenche o formulário de lançamento normal, sem endpoint ou validação
  nova. Tela própria (`/contabil/modelos`) de CRUD.
- **C10** — trilha de auditoria (`fechado`/`reaberto`/`dominio_exportado`,
  append-only) e guarda-corpos no fechamento/reabertura de período: não fecha
  fora de ordem cronológica (período anterior aberto) nem reabre fora de
  ordem (período posterior fechado). Diagnóstico do período expõe os dois
  avisos + histórico antes do usuário tentar a ação.
- **C11** — acabamento: layout responsivo da linha de partida (D/C + conta +
  valor) nos formulários de lançamento e modelo, barra de ações da tela de
  Lançamentos reorganizada pra mobile; `docs/roadmap.md` ganhou a seção do
  módulo Contábil e este README foi atualizado.

**Próximo:** Milestone 8 (deploy) do módulo Importação/Classificação — o
módulo Contábil está com o roadmap C1–C11 completo.

## Uso no dia a dia

`iniciar.bat` sobe os 3 serviços com um clique e abre o navegador sozinho.

## Rodar em outra máquina

Leva o sistema (com os `.env` já preenchidos) pra outro computador sem repetir
o setup do Supabase do zero — só funciona pro **mesmo projeto Supabase**
(as chaves nos `.env` viajam junto com o `.zip`).

**Na máquina atual:**

1. `powershell -ExecutionPolicy Bypass -File empacotar.ps1` — gera
   `extrato-dominio.zip` na Área de trabalho, com o código e os `.env` (sem
   `node_modules`/`.venv`/`.git`/`dist`).

**Na máquina nova** (precisa ter **Node.js 20+** e **Python 3.12+** instalados):

2. Descompacta o `.zip` em qualquer pasta.
3. Roda `configurar.bat` (clique duplo) — instala as dependências do npm e
   cria o ambiente Python do parser. Só precisa rodar **uma vez**.
4. Roda `iniciar.bat` sempre que for usar — sobe os 3 serviços e abre
   `http://localhost:5173` sozinho.

Se faltar algum `.env` (não veio no `.zip`, ou é uma instalação nova sem
Supabase configurado ainda), `configurar.bat` avisa quais faltam — copie de
`.env.example` e siga o [Setup](#setup) acima.
