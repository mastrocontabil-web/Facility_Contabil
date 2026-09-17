-- ==========================================================================
-- 0015_contabil_modelos_lancamento.sql
-- Módulo Contábil (C9): modelos reutilizáveis de lançamento recorrente —
-- molde de histórico + partidas (com valor sugerido opcional), usado só pra
-- pré-preencher o formulário de lançamento manual (C3); nunca materializado
-- direto no backend.
-- ==========================================================================

create table public.lancamento_modelos (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id              uuid not null references public.clients (id) on delete cascade,
  nome                   text not null,
  historico_codigo       text references public.historicos_padrao (codigo) on delete set null,
  historico_complemento  text not null default '',
  ativo                  boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index lancamento_modelos_client_idx on public.lancamento_modelos (client_id);
create trigger lancamento_modelos_set_updated_at before update on public.lancamento_modelos
  for each row execute function public.set_updated_at();

alter table public.lancamento_modelos enable row level security;
create policy lancamento_modelos_select on public.lancamento_modelos for select
  using (owner_id = auth.uid());
create policy lancamento_modelos_insert on public.lancamento_modelos for insert
  with check (owner_id = auth.uid());
create policy lancamento_modelos_update on public.lancamento_modelos for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy lancamento_modelos_delete on public.lancamento_modelos for delete
  using (owner_id = auth.uid());

-- --------------------------------------------------------------------------
-- lancamento_modelo_partidas — mesmo padrão de lancamento_partidas, mas com
-- valor opcional (null = varia a cada geração, ex: comissão).
-- --------------------------------------------------------------------------
create table public.lancamento_modelo_partidas (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  modelo_id           uuid not null references public.lancamento_modelos (id) on delete cascade,
  plano_conta_id      uuid not null references public.plano_contas (id) on delete restrict,
  tipo                text not null check (tipo in ('D', 'C')),
  valor_cents_padrao  bigint check (valor_cents_padrao is null or valor_cents_padrao > 0),
  ordem               integer not null
);
create index lancamento_modelo_partidas_modelo_idx on public.lancamento_modelo_partidas (modelo_id);

alter table public.lancamento_modelo_partidas enable row level security;
create policy lancamento_modelo_partidas_select on public.lancamento_modelo_partidas for select
  using (owner_id = auth.uid());
create policy lancamento_modelo_partidas_insert on public.lancamento_modelo_partidas for insert
  with check (owner_id = auth.uid());
create policy lancamento_modelo_partidas_update on public.lancamento_modelo_partidas for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy lancamento_modelo_partidas_delete on public.lancamento_modelo_partidas for delete
  using (owner_id = auth.uid());

comment on table public.lancamento_modelos is
  'Molde reutilizável de lançamento recorrente (C9) — nome + histórico '
  'padrão + partidas com valor sugerido opcional. Gerar um lançamento a '
  'partir de um modelo é uma ação de FRONTEND (pré-preenche o formulário '
  'normal de lançamento); não existe endpoint de "materializar".';
comment on column public.lancamento_modelo_partidas.valor_cents_padrao is
  'Sugestão de valor pra essa partida quando o modelo for usado — null '
  'quando o valor sempre varia (ex: comissão) e deve ser digitado na hora.';
