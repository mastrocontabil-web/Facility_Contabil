-- ==========================================================================
-- 0014_contabil_origem_transacao.sql
-- Módulo Contábil (C8): rastreia quando um lançamento veio do módulo
-- Importação (transactions) em vez de digitado à mão.
-- ==========================================================================

alter table public.lancamentos
  add column origem_transaction_id uuid references public.transactions (id) on delete set null;

-- unique numa coluna nullable permite quantos NULL quiser (lançamento manual)
-- e ainda garante no banco que nunca duas linhas de Contábil apontem pra
-- mesma transação de origem — resolve "sem duplicar" sem lógica de dedupe.
alter table public.lancamentos
  add constraint lancamentos_origem_transaction_unique unique (origem_transaction_id);

comment on column public.lancamentos.origem_transaction_id is
  'Transação de origem (módulo Importação), se esse lançamento foi trazido '
  'de lá (C8) em vez de digitado à mão. on delete set null: reimportar um '
  'extrato apaga e recria as transactions com IDs novos — o lançamento aqui '
  'sobrevive (não mexe num período fechado por uma ação de outro módulo), só '
  'perde o selo de origem.';
