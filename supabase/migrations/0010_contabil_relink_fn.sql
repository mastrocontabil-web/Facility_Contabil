-- ==========================================================================
-- 0010_contabil_relink_fn.sql
-- Corrige o religamento de parent_id do plano de contas: um upsert parcial
-- ({id, parent_id}) esbarra em NOT NULL de client_id/codigo/etc — o Postgres
-- valida a linha candidata do INSERT antes de decidir ir pro ON CONFLICT DO
-- UPDATE. Solução: recalcular parent_id inteiramente no servidor.
-- ==========================================================================
create or replace function public.relink_plano_contas_parents(p_client uuid)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.plano_contas child
  set parent_id = case
    when child.classificacao !~ '\.' then null
    else (
      select parent.id
      from public.plano_contas parent
      where parent.client_id = p_client
        and parent.classificacao = regexp_replace(child.classificacao, '\.[^.]+$', '')
    )
  end
  where child.client_id = p_client;
$$;

comment on function public.relink_plano_contas_parents is
  'Recalcula parent_id de todas as contas do cliente a partir da classificação (prefixo com um segmento a menos). Raiz (sem ponto) = null.';
