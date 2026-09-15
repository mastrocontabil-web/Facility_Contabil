-- ==========================================================================
-- 0013_contabil_lancamentos.sql
-- Módulo Contábil (C3): lançamentos manuais em partida dobrada (simples ou
-- múltipla), vinculados ao plano_contas (C1) e a um período (C2).
-- ==========================================================================

-- --------------------------------------------------------------------------
-- lancamentos — cabeçalho (data + histórico); sem client_id, igual
-- saldos_contabeis (periodo_id já leva ao cliente via periodos_contabeis).
-- --------------------------------------------------------------------------
create table public.lancamentos (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  periodo_id             uuid not null references public.periodos_contabeis (id) on delete cascade,
  data                   date not null,
  historico_codigo       text references public.historicos_padrao (codigo) on delete set null,
  historico_complemento  text not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index lancamentos_periodo_idx on public.lancamentos (periodo_id, data);
create trigger lancamentos_set_updated_at before update on public.lancamentos
  for each row execute function public.set_updated_at();

alter table public.lancamentos enable row level security;
create policy lancamentos_select on public.lancamentos for select
  using (owner_id = auth.uid());
create policy lancamentos_insert on public.lancamentos for insert
  with check (owner_id = auth.uid());
create policy lancamentos_update on public.lancamentos for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy lancamentos_delete on public.lancamentos for delete
  using (owner_id = auth.uid());

comment on column public.lancamentos.historico_codigo is
  'Código do catálogo historicos_padrao (opcional — pode lançar com texto '
  'livre em historico_complemento sem escolher um código).';

-- --------------------------------------------------------------------------
-- lancamento_partidas — linhas de débito/crédito de um lançamento. Nunca
-- editadas em lugar: PATCH sempre apaga tudo e recria (mesmo padrão de
-- reimportar extrato em transactions).
-- --------------------------------------------------------------------------
create table public.lancamento_partidas (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lancamento_id   uuid not null references public.lancamentos (id) on delete cascade,
  plano_conta_id  uuid not null references public.plano_contas (id) on delete restrict,
  tipo            text not null check (tipo in ('D', 'C')),
  valor_cents     bigint not null check (valor_cents > 0),
  ordem           integer not null
);
create index lancamento_partidas_lancamento_idx on public.lancamento_partidas (lancamento_id);

alter table public.lancamento_partidas enable row level security;
create policy lancamento_partidas_select on public.lancamento_partidas for select
  using (owner_id = auth.uid());
create policy lancamento_partidas_insert on public.lancamento_partidas for insert
  with check (owner_id = auth.uid());
create policy lancamento_partidas_update on public.lancamento_partidas for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy lancamento_partidas_delete on public.lancamento_partidas for delete
  using (owner_id = auth.uid());

comment on column public.lancamento_partidas.plano_conta_id is
  '"on delete restrict" (não "set null" como em saldos_contabeis) — aqui a '
  'conta é referência ativa de uma partida lançada, não um snapshot '
  'histórico denormalizado. Excluir uma conta com lançamentos deve falhar.';
comment on table public.lancamento_partidas is
  'Soma dos valor_cents com tipo=D precisa ser igual à soma com tipo=C por '
  'lancamento_id — validado no backend (zod), não como CHECK aqui (regra '
  'cruza linhas).';
