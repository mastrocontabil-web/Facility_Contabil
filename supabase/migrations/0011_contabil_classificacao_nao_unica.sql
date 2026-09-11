-- ==========================================================================
-- 0011_contabil_classificacao_nao_unica.sql
-- Teste com o plano de contas REAL do cliente GABRIEL PINHEIRO (927 contas)
-- mostrou que classificação NÃO é única de verdade: os códigos 114
-- (EDIFÍCIOS) e 115 (CONSTRUÇÕES) têm a mesma classificação
-- "1.2.4.01.000002" no Domínio. O identificador único de fato é o código
-- (mesma "moeda" do conta_contabil usado no resto do sistema) — classificação
-- é só um rótulo estrutural/hierárquico, não obrigatoriamente 1:1.
-- ==========================================================================
alter table public.plano_contas drop constraint if exists plano_contas_client_id_classificacao_key;

-- relink: com classificação podendo repetir, a subquery de "quem é o pai" pode
-- casar mais de uma linha — desempata por codigo pra nunca estourar
-- "more than one row returned by a subquery used as an expression".
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
      order by parent.codigo
      limit 1
    )
  end
  where child.client_id = p_client;
$$;
