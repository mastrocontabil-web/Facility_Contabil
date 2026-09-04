import { describe, expect, it } from 'vitest';
import { clientCreateSchema, clientListQuerySchema, clientUpdateSchema, money } from './schema.js';

describe('money', () => {
  it('aceita formatos BR e US', () => {
    expect(money.parse('1.234,56')).toBe(1234.56);
    expect(money.parse('1234.56')).toBe(1234.56);
    expect(money.parse('R$ -50,00')).toBe(-50);
    expect(money.parse(1234.5)).toBe(1234.5);
    expect(money.parse('')).toBe(0);
    expect(money.parse('0')).toBe(0);
  });
  it('texto sem número vira 0', () => {
    expect(money.parse('abc')).toBe(0);
  });
  it('só ponto com 3 dígitos depois é separador de milhar, não decimal', () => {
    expect(money.parse('1.500')).toBe(1500);
    expect(money.parse('100.000')).toBe(100000);
    expect(money.parse('1.234.567')).toBe(1234567);
  });
  it('só ponto com 1-2 dígitos depois continua decimal', () => {
    expect(money.parse('1500.5')).toBe(1500.5);
    expect(money.parse('1500.50')).toBe(1500.5);
    expect(money.parse('0.99')).toBe(0.99);
  });
});

describe('clientCreateSchema', () => {
  const base = {
    razao_social: 'EMPRESA EXEMPLO LTDA',
    cnpj: '11.222.333/0001-81',
    dominio_code: '168',
  };

  it('normaliza cnpj e aplica defaults', () => {
    const r = clientCreateSchema.parse(base);
    expect(r.cnpj).toBe('11222333000181');
    expect(r.hist_code_entrada).toBe('138');
    expect(r.hist_code_saida).toBe('186');
    expect(r.conta_width).toBe(7);
    expect(r.ativo).toBe(true);
  });

  it('limpa a conta contábil do banco pra só dígitos', () => {
    const r = clientCreateSchema.parse({ ...base, banco_conta_contabil: '1.00.02' });
    expect(r.banco_conta_contabil).toBe('10002');
  });

  it('rejeita cnpj inválido', () => {
    expect(clientCreateSchema.safeParse({ ...base, cnpj: '66703280000100' }).success).toBe(false);
  });

  it('rejeita dominio_code não numérico', () => {
    expect(clientCreateSchema.safeParse({ ...base, dominio_code: 'ABC' }).success).toBe(false);
    expect(clientCreateSchema.safeParse({ ...base, dominio_code: '12345678' }).success).toBe(false);
  });

  it('rejeita hist_code não numérico', () => {
    expect(clientCreateSchema.safeParse({ ...base, hist_code_entrada: 'x' }).success).toBe(false);
  });
});

describe('clientUpdateSchema', () => {
  it('aceita parcial', () => {
    const r = clientUpdateSchema.parse({ razao_social: 'Novo Nome' });
    expect(r).toEqual({ razao_social: 'Novo Nome' });
  });
});

describe('clientListQuerySchema', () => {
  it('defaults', () => {
    expect(clientListQuerySchema.parse({})).toEqual({ ativo: 'all', limit: 200 });
  });
  it('coerce limit', () => {
    expect(clientListQuerySchema.parse({ limit: '10' }).limit).toBe(10);
  });
});
