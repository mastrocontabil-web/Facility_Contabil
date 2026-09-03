/**
 * Memória de classificação por cliente.
 *
 * Ao salvar a revisão, cada lançamento classificado vira uma memória
 * (`descrição do extrato → conta / histórico / complemento`) — regras com
 * `match_type = 'exact'`. Ao importar o extrato do mês seguinte, lançamentos
 * com a mesma descrição já vêm preenchidos.
 *
 * Descrição que já foi classificada com contas DIFERENTES → preenche com a
 * mais usada, mas marca o lançamento como "conferir".
 *
 * Regras manuais (`contains`/`starts_with`/`regex`) continuam funcionando como
 * fallback quando não há memória exata.
 */

export type Direction = 'entrada' | 'saida';
export type MatchType = 'contains' | 'starts_with' | 'regex' | 'exact';
export type Origem = 'memoria' | 'conferir' | 'regra';

export type Rule = {
  id: string;
  direction: Direction;
  match_type: MatchType;
  pattern: string;
  conta_contabil: string | null;
  hist_code: string | null;
  hist_complemento_template: string | null;
  prioridade: number;
  hits: number;
  last_used_at?: string | null;
};

/** Chave da memória: descrição normalizada (uppercase, espaços colapsados). */
export const memoryKey = (s: string) => (s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

/** A regra manual casa com a descrição? (regex inválida = não casa) */
export function ruleMatches(rule: Pick<Rule, 'match_type' | 'pattern'>, description: string): boolean {
  const desc = memoryKey(description);
  const pat = memoryKey(rule.pattern);
  if (!pat) return false;
  switch (rule.match_type) {
    case 'contains':
      return desc.includes(pat);
    case 'starts_with':
      return desc.startsWith(pat);
    case 'exact':
      return desc === pat;
    case 'regex':
      try {
        return new RegExp(rule.pattern, 'i').test(description);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/** Primeira regra manual (não-exact) que casa, na ordem prioridade→hits. */
export function matchRule(
  rules: Rule[],
  txn: { direction: Direction; description: string },
): Rule | null {
  const cand = rules
    .filter((r) => r.match_type !== 'exact' && r.direction === txn.direction)
    .sort((a, b) => a.prioridade - b.prioridade || b.hits - a.hits);
  return cand.find((r) => ruleMatches(r, txn.description)) ?? null;
}

/**
 * Classifica um lançamento pela memória do cliente.
 * - memória exata única  → { origem: 'memoria' }
 * - memória exata com >1 conta → { origem: 'conferir' } (usa a mais usada)
 * - senão, regra manual  → { origem: 'regra' }
 * - nada                 → null
 */
export function classify(
  rules: Rule[],
  txn: { direction: Direction; description: string },
): { rule: Rule; origem: Origem } | null {
  const key = memoryKey(txn.description);
  const exatas = rules
    .filter((r) => r.match_type === 'exact' && r.direction === txn.direction && memoryKey(r.pattern) === key)
    .sort(
      (a, b) =>
        b.hits - a.hits || String(b.last_used_at ?? '').localeCompare(String(a.last_used_at ?? '')),
    );

  const [best] = exatas;
  if (best) {
    const contas = new Set(exatas.map((r) => r.conta_contabil).filter(Boolean));
    return { rule: best, origem: contas.size > 1 ? 'conferir' : 'memoria' };
  }

  const manual = matchRule(rules, txn);
  return manual ? { rule: manual, origem: 'regra' } : null;
}

const LIXO = [
  /\b\d{2}\/\d{2}(\/\d{2,4})?\b/g,
  /\b\d{1,2}:\d{2}(:\d{2})?\b/g,
  /\b\d{1,3}(\.\d{3})*,\d{2}\b/g,
  /R\$\s*/gi,
  /\b\d{6,}\b/g,
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,
];

/** Sugestão de padrão pra regra manual: tira data/hora/valor/documento. */
export function suggestPattern(description: string): string {
  let s = ` ${description} `;
  for (const re of LIXO) s = s.replace(re, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.replace(/[^A-Za-zÀ-ÿ]/g, '').length < 3) return description.trim().slice(0, 40).trim();
  return s.slice(0, 60).trim();
}
