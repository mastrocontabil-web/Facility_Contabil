import { describe, expect, it } from 'vitest';
import { formatCnpjCpf, isValidCnpj, isValidCnpjOrCpf, isValidCpf, onlyDigits } from './br.js';

describe('CNPJ/CPF', () => {
  it('valida CNPJ com dígito verificador correto', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000181')).toBe(true);
  });

  it('rejeita CNPJ com DV errado', () => {
    expect(isValidCnpj('11222333000180')).toBe(false);
    expect(isValidCnpj('11111111111111')).toBe(false);
    expect(isValidCnpj('123')).toBe(false);
  });

  it('valida CPF', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('52998224726')).toBe(false);
  });

  it('isValidCnpjOrCpf aceita os dois tamanhos', () => {
    expect(isValidCnpjOrCpf('11222333000181')).toBe(true);
    expect(isValidCnpjOrCpf('52998224725')).toBe(true);
    expect(isValidCnpjOrCpf('123456')).toBe(false);
  });

  it('onlyDigits e formatação', () => {
    expect(onlyDigits('11.222.333/0001-81')).toBe('11222333000181');
    expect(formatCnpjCpf('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatCnpjCpf('52998224725')).toBe('529.982.247-25');
  });
});
