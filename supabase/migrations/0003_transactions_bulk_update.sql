-- ==========================================================================
-- 0003_transactions_bulk_update.sql
-- Atualiza várias transações de um statement numa tacada só (a tela de Revisão
-- pode ter 500+ linhas). Uma única UPDATE com join no jsonb.
-- SECURITY INVOKER: roda como o usuário, então a RLS (owner_id = auth.uid())
-- continua valendo.
-- ==========================================================================

create or replace function public.update_transactions_bulk(
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
    conta_contabil       = nullif(btrim(u.conta_contabil), ''),
    hist_code            = nullif(btrim(u.hist_code), ''),
    hist_complemento     = u.hist_complemento,
    cod_complemento_hist = coalesce(nullif(btrim(u.cod_complemento_hist), ''), '0'),
    ignorado             = coalesce(u.ignorado, false),
    origem_preenchimento = case
      when nullif(btrim(u.conta_contabil), '') is not null
        and t.origem_preenchimento = 'vazio'
      then 'manual'
      else t.origem_preenchimento
    end,
    updated_at = now()
  from jsonb_to_recordset(p_updates) as u(
    id                   uuid,
    conta_contabil       text,
    hist_code            text,
    hist_complemento     text,
    cod_complemento_hist text,
    ignorado             boolean
  )
  where t.id = u.id
    and t.statement_id = p_statement
    and t.owner_id = auth.uid();

  get diagnostics affected = row_count;
  return affected;
end;
$$;

comment on function public.update_transactions_bulk is
  'Atualiza em lote as transações de um statement (tela de Revisão).';
