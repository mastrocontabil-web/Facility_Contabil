import { z } from 'zod';

const codigoConta = z
  .string()
  .trim()
  .transform((s) => s.replace(/\D/g, ''))
  .refine((s) => s.length > 0, 'código da conta obrigatório');

const classificacao = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)*$/, 'classificação deve ser dígitos separados por ponto (ex: 1.1.1.02)');

export const planoContaCreateSchema = z.object({
  client_id: z.string().uuid(),
  codigo: codigoConta,
  tipo: z.enum(['S', 'A']),
  classificacao,
  nome: z.string().trim().min(1, 'nome obrigatório').max(200),
  grau: z.coerce.number().int().min(1).max(5),
  natureza: z.enum(['devedora', 'credora']).optional().nullable(),
  ativo: z.boolean().default(true),
});

export const planoContaUpdateSchema = planoContaCreateSchema.partial().omit({ client_id: true });

export const planoContaListQuerySchema = z.object({
  client_id: z.string().uuid(),
});

export const importarPlanoContasSchema = z.object({
  client_id: z.string().uuid(),
  pdf_password: z.string().max(200).optional(),
});

const codigoHistorico = z
  .string()
  .trim()
  .regex(/^\d{1,6}$/, 'código de histórico deve ser numérico (até 6 dígitos)');

export const historicoPadraoCreateSchema = z.object({
  codigo: codigoHistorico,
  descricao: z.string().trim().min(2, 'descrição muito curta').max(300),
  ativo: z.boolean().default(true),
});

export const historicoPadraoUpdateSchema = historicoPadraoCreateSchema.partial();

export const importarBalanceteSchema = z.object({
  client_id: z.string().uuid(),
  pdf_password: z.string().max(200).optional(),
});

export const periodosListQuerySchema = z.object({
  client_id: z.string().uuid(),
});

export const saldosListQuerySchema = z.object({
  periodo_id: z.string().uuid(),
});

export type PlanoContaCreate = z.infer<typeof planoContaCreateSchema>;
export type PlanoContaUpdate = z.infer<typeof planoContaUpdateSchema>;
export type HistoricoPadraoCreate = z.infer<typeof historicoPadraoCreateSchema>;
export type HistoricoPadraoUpdate = z.infer<typeof historicoPadraoUpdateSchema>;
