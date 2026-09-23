-- ==========================================================================
-- 0017_memoria_dedupe.sql
-- Corrige learn_classifications: quando o mesmo extrato tinha dois lançamentos
-- com a mesma descrição e a mesma conta (ex.: dois PIX iguais pro mesmo
-- favorecido), o INSERT ... ON CONFLICT DO UPDATE tentava atualizar a mesma
-- memória duas vezes no mesmo comando. O Postgres rejeita isso ("ON CONFLICT
-- DO UPDATE command cannot affect row a second time") e a função inteira
-- falhava — nenhuma memória daquele extrato era gravada. Agora deduplica antes.
-- ==========================================================================

create or replace function public.learn_classifications(p_client uuid, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  insert into public.mapping_rules (
    owner_id, client_id, direction, match_type, pattern,
    conta_contabil, hist_code, hist_complemento_template,
    auto, prioridade, hits, last_used_at
  )
  select
    auth.uid(), p_client, r.direction, 'exact', r.pattern,
    r.conta_contabil, nullif(btrim(r.hist_code), ''), nullif(btrim(r.hist_complemento), ''),
    true, 50, 1, now()
  from (
    -- uma linha por memória: a mesma (direção, descrição, conta) repetida fica
    -- só com a última ocorrência (mesmo resultado de gravar uma por uma).
    select distinct on (e.val->>'direction', e.val->>'pattern', e.val->>'conta_contabil')
      e.val->>'direction'        as direction,
      e.val->>'pattern'          as pattern,
      e.val->>'conta_contabil'   as conta_contabil,
      e.val->>'hist_code'        as hist_code,
      e.val->>'hist_complemento' as hist_complemento
    from jsonb_array_elements(p_rows) with ordinality as e(val, ord)
    where btrim(coalesce(e.val->>'pattern', '')) <> ''
      and btrim(coalesce(e.val->>'conta_contabil', '')) <> ''
    order by e.val->>'direction', e.val->>'pattern', e.val->>'conta_contabil', e.ord desc
  ) r
  on conflict (client_id, direction, match_type, pattern, coalesce(conta_contabil, '')) do update set
    hits = public.mapping_rules.hits + 1,
    hist_code = excluded.hist_code,
    hist_complemento_template = excluded.hist_complemento_template,
    ativo = true,
    last_used_at = now(),
    updated_at = now();

  get diagnostics n = row_count;
  return n;
end;
$$;
