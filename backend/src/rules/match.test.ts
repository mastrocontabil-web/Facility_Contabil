import { describe, expect, it } from 'vitest';
import { classify, matchRule, memoryKey, ruleMatches, suggestPattern, type Rule } from './match.js';

const rule = (over: Partial<Rule>): Rule => ({
  id: 'r1',
  direction: 'saida',
  match_type: 'exact',
  pattern: 'PIX EMIT.OUTRA IF',
  conta_contabil: '467',
  hist_code: '186',
  hist_complemento_template: null,
  prioridade: 50,
  hits: 1,
  last_used_at: null,
  ...over,
});

describe('memoryKey', () => {
  it('uppercase, colapsa espaços, trim', () => {
    expect(memoryKey('  pix   emit.outra  if ')).toBe('PIX EMIT.OUTRA IF');
  });
});

describe('ruleMatches', () => {
  it('exact é case/espaço-insensível', () => {
    expect(ruleMatches({ match_type: 'exact', pattern: 'tarifa bancaria' }, ' TARIFA  BANCARIA ')).toBe(true);
    expect(ruleMatches({ match_type: 'exact', pattern: 'TARIFA' }, 'TARIFA X')).toBe(false);
  });
  it('contains / starts_with', () => {
    expect(ruleMatches({ match_type: 'contains', pattern: 'energisa' }, 'PAG ENERGISA MT')).toBe(true);
    expect(ruleMatches({ match_type: 'starts_with', pattern: 'PIX ENV' }, 'Pix enviado')).toBe(true);
  });
  it('regex inválida não quebra', () => {
    expect(ruleMatches({ match_type: 'regex', pattern: '[' }, 'x')).toBe(false);
  });
});

describe('classify — memória', () => {
  it('memória exata única → origem "memoria"', () => {
    const r = classify([rule({})], { direction: 'saida', description: 'PIX EMIT.OUTRA IF' });
    expect(r?.origem).toBe('memoria');
    expect(r?.rule.conta_contabil).toBe('467');
  });

  it('mesma descrição com contas diferentes → "conferir", pega a mais usada', () => {
    const rules = [
      rule({ id: 'a', conta_contabil: '467', hits: 2 }),
      rule({ id: 'b', conta_contabil: '10024', hits: 9 }),
      rule({ id: 'c', conta_contabil: '492', hits: 1 }),
    ];
    const r = classify(rules, { direction: 'saida', description: 'PIX EMIT.OUTRA IF' });
    expect(r?.origem).toBe('conferir');
    expect(r?.rule.conta_contabil).toBe('10024'); // maior hits
  });

  it('filtra por direção', () => {
    const r = classify([rule({ direction: 'entrada' })], {
      direction: 'saida',
      description: 'PIX EMIT.OUTRA IF',
    });
    expect(r).toBeNull();
  });

  it('sem memória, cai na regra manual (contains) → origem "regra"', () => {
    const manual = rule({ id: 'm', match_type: 'contains', pattern: 'ENERGISA', conta_contabil: '4010' });
    const r = classify([manual], { direction: 'saida', description: 'PAG ENERGISA MT 05/06' });
    expect(r?.origem).toBe('regra');
    expect(r?.rule.conta_contabil).toBe('4010');
  });

  it('memória exata tem prioridade sobre regra manual', () => {
    const mem = rule({ id: 'x', conta_contabil: '999' });
    const manual = rule({ id: 'm', match_type: 'contains', pattern: 'PIX', conta_contabil: '111' });
    const r = classify([manual, mem], { direction: 'saida', description: 'PIX EMIT.OUTRA IF' });
    expect(r?.rule.id).toBe('x');
    expect(r?.origem).toBe('memoria');
  });

  it('nada casa → null', () => {
    expect(classify([rule({})], { direction: 'saida', description: 'CEMIG' })).toBeNull();
  });
});

describe('matchRule (só regras manuais)', () => {
  it('ignora regras exact', () => {
    expect(matchRule([rule({})], { direction: 'saida', description: 'PIX EMIT.OUTRA IF' })).toBeNull();
  });
  it('respeita prioridade e depois hits', () => {
    const a = rule({ id: 'a', match_type: 'contains', pattern: 'PIX', prioridade: 50, hits: 1 });
    const b = rule({ id: 'b', match_type: 'contains', pattern: 'PIX', prioridade: 10, hits: 0 });
    expect(matchRule([a, b], { direction: 'saida', description: 'PIX X' })?.id).toBe('b');
  });
});

describe('suggestPattern', () => {
  it('tira data, hora, valor e documento', () => {
    expect(suggestPattern('PIX ENVIADO 05/06/2026 14:32 R$ 1.234,56 000123456789 ENERGISA MT')).toBe(
      'PIX ENVIADO ENERGISA MT',
    );
  });
});
