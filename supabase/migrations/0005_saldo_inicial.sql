-- ==========================================================================
-- 0005_saldo_inicial.sql
-- Saldo inicial da conta bancária, pra conferência do saldo no fim do mês.
--   clients.saldo_inicial     -> ponto de partida cadastrado pelo operador
--   statements.saldo_inicial  -> saldo no início do período DESTA importação
--                                (default = o do cliente; editável na importação)
-- ==========================================================================

alter table public.clients
  add column if not exists saldo_inicial numeric(14, 2) not null default 0;

alter table public.statements
  add column if not exists saldo_inicial numeric(14, 2);

comment on column public.clients.saldo_inicial is
  'Saldo inicial da conta bancária (ponto de partida para conferência).';
comment on column public.statements.saldo_inicial is
  'Saldo no início do período deste extrato; usado no saldo acumulado por lançamento.';
