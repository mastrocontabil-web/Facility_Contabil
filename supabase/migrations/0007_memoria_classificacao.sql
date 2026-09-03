-- ==========================================================================
-- 0007_memoria_classificacao.sql
-- Memória de classificação AUTO-APRENDIDA. Ao salvar a revisão, cada lançamento
-- classificado vira uma regra `match_type = 'exact'` (descrição → conta/hist/
-- complemento). No próximo import, lançamento com a mesma descrição já vem
-- preenchido. Descrição usada com contas diferentes → "conferir".
-- ==========================================================================

alter table public.mapping_rules
  add column if not exists auto boolean not null default false;

-- dedupe antes de criar o índice único (dados de teste podem ter duplicado)
delete from public.mapping_rules a
using public.mapping_rules b
where a.id < b.id
  and a.client_id = b.client_id
  and a.direction = b.direction
  and a.match_type = b.match_type
  and a.pattern = b.pattern
  and coalesce(a.conta_contabil, '') = coalesce(b.conta_contabil, '');

create unique index if not exists mapping_rules_memoria_uk
  on public.mapping_rules (client_id, direction, match_type, pattern, coalesce(conta_contabil, ''));

-- novos estados de preenchimento do lançamento
alter table public.transactions drop constraint if exists transactions_origem_preenchimento_check;
alter table public.transactions
  add constraint transactions_origem_preenchimento_check
  check (origem_preenchimento in ('vazio', 'manual', 'regra', 'memoria', 'conferir'));

-- --------------------------------------------------------------------------
-- learn_classifications — upsert das memórias a partir dos lançamentos salvos
-- --------------------------------------------------------------------------
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
  from jsonb_to_recordset(p_rows) as r(
    direction text, pattern text, conta_contabil text, hist_code text, hist_complemento text
  )
  where btrim(coalesce(r.pattern, '')) <> '' and btrim(coalesce(r.conta_contabil, '')) <> ''
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

comment on function public.learn_classifications is
  'Aprende/reforça as memórias de classificação (descrição → conta) de um cliente.';

-- --------------------------------------------------------------------------
-- update_transactions_bulk — agora respeita o origem_preenchimento enviado
-- (a tela de Revisão manda 'manual' quando o operador mexeu na linha)
-- --------------------------------------------------------------------------
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
    origem_preenchimento = coalesce(nullif(btrim(u.origem_preenchimento), ''), t.origem_preenchimento),
    updated_at = now()
  from jsonb_to_recordset(p_updates) as u(
    id                   uuid,
    conta_contabil       text,
    hist_code            text,
    hist_complemento     text,
    cod_complemento_hist text,
    ignorado             boolean,
    origem_preenchimento text
  )
  where t.id = u.id
    and t.statement_id = p_statement
    and t.owner_id = auth.uid();

  get diagnostics affected = row_count;
  return affected;
end;
$$;
