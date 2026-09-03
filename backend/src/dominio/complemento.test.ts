import { describe, expect, it } from 'vitest';
import { composeComplemento } from './complemento.js';

describe('composeComplemento', () => {
  it('extrato: só a descrição do extrato', () => {
    expect(composeComplemento('extrato', '  PIX RECEBIDO  ', 'venda')).toBe('PIX RECEBIDO');
  });
  it('complemento: só o texto digitado', () => {
    expect(composeComplemento('complemento', 'PIX RECEBIDO', '  frete  ')).toBe('frete');
  });
  it('ambos: junta os dois com espaço', () => {
    expect(composeComplemento('ambos', 'PIX RECEBIDO', 'venda física')).toBe(
      'PIX RECEBIDO venda física',
    );
  });
  it('ambos: ignora parte vazia', () => {
    expect(composeComplemento('ambos', 'PIX RECEBIDO', '')).toBe('PIX RECEBIDO');
    expect(composeComplemento('ambos', '', 'só isso')).toBe('só isso');
  });
});
