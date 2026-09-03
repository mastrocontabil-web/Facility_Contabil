-- ==========================================================================
-- 0006_saldo_final.sql
-- Saldo ao fim do período de cada extrato. É o saldo inicial do PRÓXIMO
-- extrato daquele cliente (conciliação encadeada: fecha um mês, abre o outro).
--   saldo_final = saldo_inicial + entradas − saídas  (TODOS os lançamentos,
--                 inativados inclusos — o saldo do banco mexeu de qualquer jeito)
-- ==========================================================================

alter table public.statements
  add column if not exists saldo_final numeric(14, 2);

comment on column public.statements.saldo_final is
  'Saldo ao fim do período (saldo_inicial + entradas − saídas de todos os lançamentos). Vira o saldo inicial do próximo extrato do cliente.';

-- Backfill dos extratos que já existem, pra corrente já ficar encadeada.
update public.statements s
set saldo_final = coalesce(s.saldo_inicial, 0) + coalesce((
  select sum(case when t.direction = 'entrada' then t.valor else -t.valor end)
  from public.transactions t
  where t.statement_id = s.id
), 0)
where s.saldo_final is null;
