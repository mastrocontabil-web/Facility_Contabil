import { z } from 'zod';
import { money } from '../clients/schema.js';

const conta = z
  .string()
  .trim()
  .transform((s) => s.replace(/\D/g, ''))
  .refine((s) => s.length > 0, 'conta contábil obrigatória');

const histCode = z
  .string()
  .trim()
  .regex(/^\d{1,6}$/, 'código de histórico deve ser numérico');

/** Campos do multipart no POST /api/statements (tudo chega como string). */
export const createStatementSchema = z.object({
  client_id: z.string().uuid(),
  banco_conta_contabil: conta,
  hist_code_entrada: histCode.default('138'),
  hist_code_saida: histCode.default('186'),
  lote_numero: z.coerce.number().int().min(0).max(99_999_999).default(1),
  saldo_inicial: money.optional(),
  pdf_password: z.string().max(200).optional(),
});

export const listStatementsQuerySchema = z.object({
  client_id: z.string().uuid().optional(),
  status: z.enum(['parsing', 'revisao', 'gerado', 'erro']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const updateStatementSchema = z.object({
  banco_conta_contabil: conta.optional(),
  hist_code_entrada: histCode.optional(),
  hist_code_saida: histCode.optional(),
  lote_numero: z.coerce.number().int().min(0).max(99_999_999).optional(),
  saldo_inicial: money.optional(),
  complemento_modo: z.enum(['extrato', 'complemento', 'ambos']).optional(),
  status: z.enum(['revisao', 'gerado']).optional(),
});

const contaOpt = z
  .string()
  .trim()
  .transform((s) => s.replace(/[^0-9]/g, ''))
  .transform((s) => s || null)
  .nullable();

export const transactionUpdateSchema = z.object({
  id: z.string().uuid(),
  conta_contabil: contaOpt.optional().default(null),
  hist_code: z
    .string()
    .trim()
    .regex(/^\d{0,6}$/, 'código de histórico numérico')
    .optional()
    .default(''),
  hist_complemento: z.string().trim().max(511).optional().default(''),
  cod_complemento_hist: z
    .string()
    .trim()
    .regex(/^\d{0,7}$/)
    .optional()
    .default('0'),
  ignorado: z.boolean().optional().default(false),
  origem_preenchimento: z
    .enum(['vazio', 'manual', 'regra', 'memoria', 'conferir'])
    .optional()
    .default('manual'),
});

export const bulkUpdateTransactionsSchema = z.object({
  updates: z.array(transactionUpdateSchema).min(1).max(2000),
});

export type CreateStatement = z.infer<typeof createStatementSchema>;
