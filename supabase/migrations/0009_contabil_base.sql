-- ==========================================================================
-- 0009_contabil_base.sql
-- Módulo Contábil (C1): plano de contas hierárquico por cliente + catálogo
-- único de históricos padrão do escritório. Base pros próximos milestones
-- (importação de balancete, lançamentos, motor de saldos, relatórios).
-- ==========================================================================

-- --------------------------------------------------------------------------
-- plano_contas — plano de contas do cliente, importado do PDF do Domínio
-- --------------------------------------------------------------------------
create table public.plano_contas (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id       uuid not null references public.clients (id) on delete cascade,
  codigo          text not null check (codigo ~ '^[0-9]+$'),
  tipo            text not null check (tipo in ('S', 'A')),
  classificacao   text not null check (classificacao ~ '^[0-9]+(\.[0-9]+)*$'),
  nome            text not null,
  grau            integer not null check (grau between 1 and 5),
  parent_id       uuid references public.plano_contas (id) on delete set null,
  natureza        text check (natureza in ('devedora', 'credora')),
  ativo           boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (client_id, codigo),
  unique (client_id, classificacao)
);
create index plano_contas_client_idx on public.plano_contas (client_id, classificacao);
create index plano_contas_parent_idx on public.plano_contas (parent_id);
create trigger plano_contas_set_updated_at before update on public.plano_contas
  for each row execute function public.set_updated_at();

alter table public.plano_contas enable row level security;
create policy plano_contas_select on public.plano_contas for select
  using (owner_id = auth.uid());
create policy plano_contas_insert on public.plano_contas for insert
  with check (owner_id = auth.uid());
create policy plano_contas_update on public.plano_contas for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy plano_contas_delete on public.plano_contas for delete
  using (owner_id = auth.uid());

comment on column public.plano_contas.codigo is
  'Código reduzido — mesma "moeda" do conta_contabil usado em transactions/mapping_rules.';
comment on column public.plano_contas.classificacao is
  'Código hierárquico pontuado (ex: 1.1.1.02.000003), como no PDF do plano de contas.';
comment on column public.plano_contas.parent_id is
  'Calculado na importação (prefixo da classificação com um segmento a menos). Raiz = null.';
comment on column public.plano_contas.natureza is
  'Devedora/credora — não vem do PDF de plano de contas. Preenchido a partir do C4 (motor de saldos).';

-- --------------------------------------------------------------------------
-- historicos_padrao — catálogo único do escritório (não por cliente)
-- --------------------------------------------------------------------------
create table public.historicos_padrao (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  codigo      text not null check (codigo ~ '^[0-9]{1,6}$'),
  descricao   text not null,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (codigo)
);
create trigger historicos_padrao_set_updated_at before update on public.historicos_padrao
  for each row execute function public.set_updated_at();

alter table public.historicos_padrao enable row level security;
create policy historicos_padrao_select on public.historicos_padrao for select
  using (owner_id = auth.uid());
create policy historicos_padrao_insert on public.historicos_padrao for insert
  with check (owner_id = auth.uid());
create policy historicos_padrao_update on public.historicos_padrao for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy historicos_padrao_delete on public.historicos_padrao for delete
  using (owner_id = auth.uid());
