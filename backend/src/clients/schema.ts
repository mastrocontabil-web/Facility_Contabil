import { z } from 'zod';
import { isValidCnpjOrCpf, onlyDigits } from '../lib/br.js';

const contaContabil = z
  .string()
  .trim()
  .regex(/^[0-9.\-/]{1,20}$/, 'conta contábil deve ter só dígitos e . - /')
  .transform((s) => s.replace(/\D/g, ''))
  .refine((s) => s.length > 0, 'conta contábil vazia');

const histCode = z
  .string()
  .trim()
  .regex(/^\d{1,6}$/, 'código de histórico deve ser numérico (até 6 dígitos)');

/**
 * Aceita "1.234,56", "1234.56", "-50", 1234.5 — devolve number com 2 casas.
 *
 * Só ponto (sem vírgula) é ambíguo: "1.500" pode ser 1500 (separador de
 * milhar, como o usuário digita no cadastro) ou 1,5. Resolve pelo nº de
 * dígitos depois do ÚLTIMO ponto — 3 dígitos (ou mais de um ponto) é sempre
 * separador de milhar; 1-2 dígitos é decimal. Sem essa regra, "1.500" virava
 * silenciosamente 1,50 e propagava saldo inicial errado pro cliente inteiro.
 */
export const money = z
  .union([z.string(), z.number()])
  .transform((v) => {
    if (typeof v === 'number') return v;
    const s = v.trim().replace(/[^\d,.-]/g, '');
    if (!s) return 0;
    if (s.includes(',') && s.includes('.')) return Number(s.replace(/\./g, '').replace(',', '.'));
    if (s.includes(',')) return Number(s.replace(',', '.'));
    const pontos = s.split('.').length - 1;
    if (pontos > 0) {
      const casasFinais = s.length - s.lastIndexOf('.') - 1;
      if (pontos > 1 || casasFinais === 3) return Number(s.replace(/\./g, ''));
    }
    return Number(s);
  })
  .refine((n) => Number.isFinite(n) && Math.abs(n) < 1e12, 'valor inválido')
  .transform((n) => Math.round(n * 100) / 100);

export const clientCreateSchema = z.object({
  razao_social: z.string().trim().min(2).max(200),
  cnpj: z
    .string()
    .transform(onlyDigits)
    .refine((d) => d.length === 11 || d.length === 14, 'CNPJ/CPF deve ter 11 ou 14 dígitos')
    .refine(isValidCnpjOrCpf, 'CNPJ/CPF inválido (dígito verificador)'),
  dominio_code: z
    .string()
    .trim()
    .regex(/^\d{1,7}$/, 'código Domínio deve ser numérico (até 7 dígitos)'),
  banco_conta_contabil: contaContabil.optional().nullable(),
  hist_code_entrada: histCode.default('138'),
  hist_code_saida: histCode.default('186'),
  conta_width: z.coerce.number().int().min(1).max(20).default(7),
  saldo_inicial: money.default(0),
  ativo: z.boolean().default(true),
  observacoes: z.string().trim().max(2000).optional().nullable(),
});

export const clientUpdateSchema = clientCreateSchema.partial();

export const clientListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  ativo: z
    .enum(['true', 'false', 'all'])
    .default('all')
    .transform((v) => v),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export type ClientCreate = z.infer<typeof clientCreateSchema>;
export type ClientUpdate = z.infer<typeof clientUpdateSchema>;
