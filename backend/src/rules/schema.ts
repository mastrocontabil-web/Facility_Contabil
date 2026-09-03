import { z } from 'zod';

const contaOpt = z
  .string()
  .trim()
  .transform((s) => s.replace(/[^0-9]/g, ''))
  .transform((s) => s || null)
  .nullable();

const histOpt = z
  .string()
  .trim()
  .regex(/^\d{0,6}$/, 'código de histórico numérico (até 6 dígitos)')
  .transform((s) => s || null)
  .nullable();

const matchType = z.enum(['contains', 'starts_with', 'regex', 'exact']);

const pattern = z
  .string()
  .trim()
  .min(1, 'padrão obrigatório')
  .max(200);

const baseRule = z.object({
  direction: z.enum(['entrada', 'saida']),
  match_type: matchType.default('contains'),
  pattern,
  conta_contabil: contaOpt.optional().default(null),
  hist_code: histOpt.optional().default(null),
  hist_complemento_template: z
    .string()
    .trim()
    .max(511)
    .transform((s) => s || null)
    .nullable()
    .optional()
    .default(null),
  prioridade: z.coerce.number().int().min(0).max(9999).default(100),
  ativo: z.boolean().default(true),
});

/** regex precisa compilar */
function regexOk(v: { match_type: string; pattern: string }): boolean {
  if (v.match_type !== 'regex') return true;
  try {
    new RegExp(v.pattern);
    return true;
  } catch {
    return false;
  }
}

/** pelo menos um efeito: conta, histórico ou complemento */
function temEfeito(v: {
  conta_contabil: string | null;
  hist_code: string | null;
  hist_complemento_template: string | null;
}): boolean {
  return !!(v.conta_contabil || v.hist_code || v.hist_complemento_template);
}

export const ruleCreateSchema = baseRule
  .extend({ client_id: z.string().uuid() })
  .refine(regexOk, { message: 'expressão regular inválida', path: ['pattern'] })
  .refine(temEfeito, {
    message: 'a regra precisa preencher pelo menos conta contábil, código de histórico ou complemento',
    path: ['conta_contabil'],
  });

export const ruleUpdateSchema = baseRule
  .partial()
  .refine((v) => v.match_type !== 'regex' || !v.pattern || regexOk({ match_type: 'regex', pattern: v.pattern }), {
    message: 'expressão regular inválida',
    path: ['pattern'],
  });

export const ruleListQuerySchema = z.object({
  client_id: z.string().uuid(),
});

export type RuleCreate = z.infer<typeof ruleCreateSchema>;
export type RuleUpdate = z.infer<typeof ruleUpdateSchema>;
