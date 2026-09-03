-- ==========================================================================
-- 0004_complemento_modo.sql
-- Como montar o "complemento do histórico" no arquivo de importação do Domínio:
--   extrato     -> usa a descrição que veio do extrato
--   complemento -> usa só o texto digitado na tela de Revisão
--   ambos       -> "<descrição do extrato> <texto digitado>"
-- ==========================================================================

alter table public.statements
  add column if not exists complemento_modo text not null default 'extrato'
    check (complemento_modo in ('extrato', 'complemento', 'ambos'));

comment on column public.statements.complemento_modo is
  'Como compor o complemento do histórico no arquivo Domínio: extrato | complemento | ambos';
