-- ==========================================================================
-- 0001_schema.sql — esquema inicial
-- Sistema: Extrato bancário -> Lançamentos contábeis em lote (Leiaute Domínio)
--
-- Modelo de acesso: o BACKEND chama o PostgREST/Storage usando o JWT DO
-- USUÁRIO (não a service_role) para as operações normais, então a RLS abaixo
-- é a barreira real de isolamento por usuário. `owner_id` default = auth.uid().
-- ==========================================================================

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- util: updated_at automático
-- --------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- --------------------------------------------------------------------------
-- clients — cliente do escritório + dados p/ o Domínio
-- --------------------------------------------------------------------------
create table public.clients (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  razao_social          text not null,
  cnpj                  text not null,                       -- só dígitos (11 ou 14)
  dominio_code          text not null,                       -- código da empresa no Domínio (ex: "168")
  banco_conta_contabil  text,                                -- conta contábil do banco (código reduzido) — default p/ importações
  hist_code_entrada     text not null default '138',
  hist_code_saida       text not null default '186',
  conta_width           integer not null default 7 check (conta_width between 1 and 20),
  ativo                 boolean not null default true,
  observacoes           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint clients_cnpj_digits check (cnpj ~ '^[0-9]{11}$' or cnpj ~ '^[0-9]{14}$'),
  constraint clients_dominio_code_digits check (dominio_code ~ '^[0-9]{1,7}$'),
  unique (owner_id, cnpj)
);
create index clients_owner_idx on public.clients (owner_id);
create trigger clients_set_updated_at before update on public.clients
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- chart_accounts — plano de contas do cliente (autocomplete/validação). Opcional.
-- --------------------------------------------------------------------------
create table public.chart_accounts (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id        uuid not null references public.clients (id) on delete cascade,
  codigo_reduzido  text not null,
  nome             text not null,
  tipo             text,                                     -- 'receita' | 'despesa' | 'banco' | ... (livre)
  created_at       timestamptz not null default now(),
  unique (client_id, codigo_reduzido)
);
create index chart_accounts_client_idx on public.chart_accounts (client_id);

-- --------------------------------------------------------------------------
-- mapping_rules — memória de classificação por cliente
-- (criada antes de transactions por causa da FK regra_id)
-- --------------------------------------------------------------------------
create table public.mapping_rules (
  id                        uuid primary key default gen_random_uuid(),
  owner_id                  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id                 uuid not null references public.clients (id) on delete cascade,
  direction                 text not null check (direction in ('entrada','saida')),
  match_type                text not null default 'contains'
                              check (match_type in ('contains','starts_with','regex','exact')),
  pattern                   text not null,
  conta_contabil            text,
  hist_code                 text,
  hist_complemento_template text,                            -- ex: "PIX RECEBIDO {contraparte}"; null = usa descrição do extrato
  prioridade                integer not null default 100,
  hits                      integer not null default 0,
  last_used_at              timestamptz,
  ativo                     boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index mapping_rules_lookup_idx on public.mapping_rules (client_id, direction, ativo, prioridade);
create trigger mapping_rules_set_updated_at before update on public.mapping_rules
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- statements — um lote de importação (um extrato)
-- --------------------------------------------------------------------------
create table public.statements (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id             uuid not null references public.clients (id) on delete restrict,
  arquivo_nome          text not null,
  storage_path          text,
  formato               text not null check (formato in ('pdf','ofx','csv','xls','xlsx')),
  banco_id              text,                                -- BANKID/COMPE detectado
  conta_ofx             text,                                -- ACCTID detectado
  period_start          date,
  period_end            date,
  banco_conta_contabil  text,                                -- snapshot (editável na importação)
  hist_code_entrada     text not null default '138',
  hist_code_saida       text not null default '186',
  lote_numero           integer not null default 1,
  status                text not null default 'parsing'
                          check (status in ('parsing','revisao','gerado','erro')),
  erro_msg              text,
  totais                jsonb not null default '{}'::jsonb,  -- { qtd, entradas:{n,valor}, saidas:{n,valor} }
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index statements_client_idx on public.statements (client_id, created_at desc);
create index statements_owner_idx on public.statements (owner_id, created_at desc);
create trigger statements_set_updated_at before update on public.statements
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- transactions — lançamentos lidos do extrato
-- --------------------------------------------------------------------------
create table public.transactions (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  statement_id          uuid not null references public.statements (id) on delete cascade,
  ordem                 integer not null,
  data                  date not null,
  descricao_raw         text not null default '',
  valor                 numeric(14,2) not null check (valor >= 0),
  direction             text not null check (direction in ('entrada','saida')),
  conta_contabil        text,
  hist_code             text,
  hist_complemento      text,
  cod_complemento_hist  text not null default '0',
  ignorado              boolean not null default false,
  regra_id              uuid references public.mapping_rules (id) on delete set null,
  origem_preenchimento  text not null default 'vazio'
                          check (origem_preenchimento in ('regra','manual','vazio')),
  raw                   jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index transactions_statement_idx on public.transactions (statement_id, ordem);
create trigger transactions_set_updated_at before update on public.transactions
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- export_files — arquivos gerados no leiaute Domínio
-- --------------------------------------------------------------------------
create table public.export_files (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  statement_id      uuid not null references public.statements (id) on delete cascade,
  storage_path      text,
  filename          text not null,
  linhas            integer not null,
  total_debito      numeric(14,2) not null,
  total_credito     numeric(14,2) not null,
  lote_numero       integer,
  conteudo_sha256   text,
  gerado_em         timestamptz not null default now(),
  gerado_por        uuid not null default auth.uid()
);
create index export_files_statement_idx on public.export_files (statement_id, gerado_em desc);

-- ==========================================================================
-- RLS — tudo isolado por owner_id = auth.uid()
-- ==========================================================================
alter table public.clients        enable row level security;
alter table public.chart_accounts enable row level security;
alter table public.mapping_rules  enable row level security;
alter table public.statements     enable row level security;
alter table public.transactions   enable row level security;
alter table public.export_files   enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'clients','chart_accounts','mapping_rules','statements','transactions','export_files'
  ]
  loop
    execute format($f$
      create policy %1$I_select on public.%1$I for select
        using (owner_id = auth.uid());
      create policy %1$I_insert on public.%1$I for insert
        with check (owner_id = auth.uid());
      create policy %1$I_update on public.%1$I for update
        using (owner_id = auth.uid()) with check (owner_id = auth.uid());
      create policy %1$I_delete on public.%1$I for delete
        using (owner_id = auth.uid());
    $f$, t);
  end loop;
end $$;
