-- ==========================================================================
-- 0016_contabil_auditoria.sql
-- Módulo Contábil (C10): trilha de auditoria do fechamento de período —
-- fechado / reaberto / exportado pro Domínio. Append-only por design.
-- ==========================================================================

create table public.contabil_auditoria (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  periodo_id  uuid not null references public.periodos_contabeis (id) on delete cascade,
  acao        text not null check (acao in ('fechado', 'reaberto', 'dominio_exportado')),
  detalhe     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index contabil_auditoria_periodo_idx on public.contabil_auditoria (periodo_id, created_at desc);

alter table public.contabil_auditoria enable row level security;
create policy contabil_auditoria_select on public.contabil_auditoria for select
  using (owner_id = auth.uid());
create policy contabil_auditoria_insert on public.contabil_auditoria for insert
  with check (owner_id = auth.uid());
-- sem policy de update/delete: trilha é append-only por design.

comment on table public.contabil_auditoria is
  'Trilha de eventos do fechamento de período (C10) — append-only, sem '
  'update/delete por design. acao=fechado: {qtd_lancamentos}. '
  'acao=reaberto: {}. acao=dominio_exportado: {lote_numero, '
  'qtd_lancamentos, sha256}.';
