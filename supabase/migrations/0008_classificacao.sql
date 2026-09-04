-- ==========================================================================
-- 0008_classificacao.sql
-- Módulo Classificação: catálogo de classificações por cliente (ÁGUA E ESGOTO,
-- ENERGIA ELÉTRICA, RECEBIMENTO DE CLIENTES...) + os lançamentos ganham uma
-- classificação, além da conta contábil que já tinham.
--
-- Fluxo: o extrato pode nascer no módulo Classificação (origem_modulo, status
-- inicial 'classificacao') e, quando "puxado" pra Importação, vira o MESMO
-- registro — só troca de status pra 'revisao' e segue o fluxo contábil normal.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- classificacoes — catálogo por cliente
-- --------------------------------------------------------------------------
create table public.classificacoes (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id   uuid not null references public.clients (id) on delete cascade,
  direction   text not null check (direction in ('entrada', 'saida')),
  nome        text not null,
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (client_id, direction, nome)
);
create index classificacoes_client_idx on public.classificacoes (client_id, direction, ativo);
create trigger classificacoes_set_updated_at before update on public.classificacoes
  for each row execute function public.set_updated_at();

alter table public.classificacoes enable row level security;
create policy classificacoes_select on public.classificacoes for select
  using (owner_id = auth.uid());
create policy classificacoes_insert on public.classificacoes for insert
  with check (owner_id = auth.uid());
create policy classificacoes_update on public.classificacoes for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy classificacoes_delete on public.classificacoes for delete
  using (owner_id = auth.uid());

-- --------------------------------------------------------------------------
-- transactions — ganha a classificação (independente da conta contábil)
-- --------------------------------------------------------------------------
alter table public.transactions
  add column if not exists classificacao_id uuid references public.classificacoes (id) on delete set null;

-- --------------------------------------------------------------------------
-- statements — de qual módulo nasceu + novo status intermediário
-- --------------------------------------------------------------------------
alter table public.statements
  add column if not exists origem_modulo text not null default 'importacao'
    check (origem_modulo in ('importacao', 'classificacao'));

alter table public.statements drop constraint if exists statements_status_check;
alter table public.statements add constraint statements_status_check
  check (status in ('parsing', 'classificacao', 'revisao', 'gerado', 'erro'));

-- complemento_modo ganha as combinações com a classificação
alter table public.statements drop constraint if exists statements_complemento_modo_check;
alter table public.statements add constraint statements_complemento_modo_check
  check (complemento_modo in ('extrato', 'complemento', 'ambos', 'extrato_classificacao', 'tudo'));

comment on column public.statements.origem_modulo is
  'Módulo que criou o extrato: importacao (fluxo direto) ou classificacao (passa pela categorização antes).';
comment on column public.transactions.classificacao_id is
  'Classificação do módulo Classificação (categoria do lançamento) — independente da conta contábil.';

-- --------------------------------------------------------------------------
-- update_transactions_classificacao — bulk update só da classificação
-- (não mexe em conta/histórico — aqueles são do fluxo contábil da Importação)
-- --------------------------------------------------------------------------
create or replace function public.update_transactions_classificacao(
  p_statement uuid,
  p_updates jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  affected integer;
begin
  update public.transactions t
  set
    classificacao_id = u.classificacao_id,
    updated_at = now()
  from jsonb_to_recordset(p_updates) as u(
    id uuid,
    classificacao_id uuid
  )
  where t.id = u.id
    and t.statement_id = p_statement
    and t.owner_id = auth.uid();

  get diagnostics affected = row_count;
  return affected;
end;
$$;

comment on function public.update_transactions_classificacao is
  'Atualiza em lote a classificação (categoria) dos lançamentos de um extrato.';
