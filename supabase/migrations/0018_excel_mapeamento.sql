-- ==========================================================================
-- 0018_excel_mapeamento.sql
-- "Nova importação Excel" (módulo Importação): planilha própria do cliente
-- (controle interno), com o operador dizendo qual coluna é Data, Valor e
-- Histórico. A escolha fica gravada no extrato — é por ela que a próxima
-- planilha do mesmo cliente já abre com as mesmas colunas, e que a
-- reimportação sabe que esse extrato não é de leitura automática.
-- ==========================================================================

alter table public.statements
  add column if not exists excel_mapeamento jsonb;

comment on column public.statements.excel_mapeamento is
  'Nova importação Excel: colunas escolhidas pelo operador — {aba, data, valor, historico[], excluir[]}, '
  'índice 0 = coluna A, excluir = linhas da planilha tiradas da importação. Null nas importações lidas '
  'automaticamente (PDF/OFX/CSV/planilha de banco).';
