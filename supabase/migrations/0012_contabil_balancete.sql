-- ==========================================================================
-- 0012_contabil_balancete.sql
-- Módulo Contábil (C2): importação do Balancete mensal do Domínio — saldo de
-- cada conta no período, vinculado por código ao plano_contas (C1).
-- ==========================================================================

-- --------------------------------------------------------------------------
-- periodos_contabeis — um período (mês) por cliente; nasce fechado ao
-- importar o balancete daquele mês (ver comentário em "status" abaixo)
-- --------------------------------------------------------------------------
create table public.periodos_contabeis (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  client_id    uuid not null references public.clients (id) on delete cascade,
  ano          integer not null,
  mes          integer not null check (mes between 1 and 12),
  status       text not null default 'aberto' check (status in ('aberto', 'fechado')),
  fechado_em   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (client_id, ano, mes)
);
create trigger periodos_contabeis_set_updated_at before update on public.periodos_contabeis
  for each row execute function public.set_updated_at();

alter table public.periodos_contabeis enable row level security;
create policy periodos_contabeis_select on public.periodos_contabeis for select
  using (owner_id = auth.uid());
create policy periodos_contabeis_insert on public.periodos_contabeis for insert
  with check (owner_id = auth.uid());
create policy periodos_contabeis_update on public.periodos_contabeis for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy periodos_contabeis_delete on public.periodos_contabeis for delete
  using (owner_id = auth.uid());

comment on column public.periodos_contabeis.status is
  'Nasce "fechado" ao importar o balancete daquele mês (é o próprio fechamento). '
  '"aberto" ainda não é usado no C2 — é base pro C3 (lançamentos manuais só '
  'valem num período aberto).';

-- --------------------------------------------------------------------------
-- saldos_contabeis — saldo de uma conta num período, importado do balancete.
-- Sem client_id (period_id já leva a ele via periodos_contabeis, mesmo
-- padrão de transactions/export_files não denormalizarem o avô).
-- --------------------------------------------------------------------------
create table public.saldos_contabeis (
  id                      uuid primary key default gen_random_uuid(),
  owner_id                uuid not null default auth.uid() references auth.users (id) on delete cascade,
  periodo_id              uuid not null references public.periodos_contabeis (id) on delete cascade,
  plano_conta_id          uuid references public.plano_contas (id) on delete set null,
  codigo                  text not null check (codigo ~ '^[0-9]+$'),
  nome                    text not null,
  tipo                    text not null check (tipo in ('S', 'A')),
  ordem                   integer not null,
  saldo_anterior_cents    bigint not null default 0,
  saldo_anterior_natureza text check (saldo_anterior_natureza in ('D', 'C')),
  debito_cents            bigint not null default 0,
  credito_cents           bigint not null default 0,
  saldo_atual_cents       bigint not null default 0,
  saldo_atual_natureza    text check (saldo_atual_natureza in ('D', 'C')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (periodo_id, codigo)
);
create trigger saldos_contabeis_set_updated_at before update on public.saldos_contabeis
  for each row execute function public.set_updated_at();

alter table public.saldos_contabeis enable row level security;
create policy saldos_contabeis_select on public.saldos_contabeis for select
  using (owner_id = auth.uid());
create policy saldos_contabeis_insert on public.saldos_contabeis for insert
  with check (owner_id = auth.uid());
create policy saldos_contabeis_update on public.saldos_contabeis for update
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy saldos_contabeis_delete on public.saldos_contabeis for delete
  using (owner_id = auth.uid());

comment on column public.saldos_contabeis.plano_conta_id is
  'Vínculo com o plano de contas, resolvido por código na importação. Pode '
  'ser null (conta do balancete ainda não cadastrada no plano) — seguro '
  'porque codigo/nome/tipo abaixo já vêm denormalizados do PDF, então a '
  'linha continua exibível mesmo sem vínculo.';
comment on column public.saldos_contabeis.codigo is
  'Denormalizado do balancete (não é FK) — mesmo com plano_conta_id nulo, '
  'a linha continua identificável e reconciliável numa reimportação futura.';
comment on column public.saldos_contabeis.ordem is
  'Ordem de impressão no balancete (índice na importação) — usada pra '
  'exibição, já que esse relatório não traz classificação/grau. Mesmo '
  'padrão de transactions.ordem.';
