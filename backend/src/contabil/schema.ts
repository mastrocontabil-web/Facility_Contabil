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

const partidaSchema = z.object({
  plano_conta_id: z.string().uuid(),
  tipo: z.enum(['D', 'C']),
  valor_cents: z.coerce.number().int().positive(),
});

function partidasBalanceadas(partidas: { tipo: 'D' | 'C'; valor_cents: number }[]): boolean {
  const d = partidas.filter((p) => p.tipo === 'D').reduce((s, p) => s + p.valor_cents, 0);
  const c = partidas.filter((p) => p.tipo === 'C').reduce((s, p) => s + p.valor_cents, 0);
  return d === c && d > 0;
}

const lancamentoBaseSchema = z.object({
  client_id: z.string().uuid(),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'data inválida (esperado YYYY-MM-DD)'),
  historico_codigo: codigoHistorico.optional().nullable(),
  historico_complemento: z.string().trim().min(1, 'histórico obrigatório').max(500),
  partidas: z.array(partidaSchema).min(2, 'precisa de pelo menos 1 débito e 1 crédito'),
});

const balancoRefinement = {
  message: 'soma dos débitos precisa ser igual à soma dos créditos',
  path: ['partidas'],
};

export const lancamentoCreateSchema = lancamentoBaseSchema.refine(
  (d) => partidasBalanceadas(d.partidas),
  balancoRefinement,
);

// Não é .partial(): PATCH sempre manda o conjunto completo de partidas
// (apaga tudo e recria), então não existe "atualização parcial" aqui.
export const lancamentoUpdateSchema = lancamentoBaseSchema
  .omit({ client_id: true })
  .refine((d) => partidasBalanceadas(d.partidas), balancoRefinement);

export const lancamentosListQuerySchema = z.object({
  periodo_id: z.string().uuid(),
});

export const recalcularSaldosSchema = z.object({
  periodo_id: z.string().uuid(),
});

export const razaoQuerySchema = z.object({
  periodo_id: z.string().uuid(),
  plano_conta_id: z.string().uuid(),
});

export const importarTransacoesSchema = z.object({
  client_id: z.string().uuid(),
  ano: z.coerce.number().int().min(2000).max(2100),
  mes: z.coerce.number().int().min(1).max(12),
});

const modeloPartidaSchema = z.object({
  plano_conta_id: z.string().uuid(),
  tipo: z.enum(['D', 'C']),
  valor_cents_padrao: z.coerce.number().int().positive().optional().nullable(),
});

function modeloPartidasBalanceadasSeCompletas(
  partidas: { tipo: 'D' | 'C'; valor_cents_padrao?: number | null }[],
): boolean {
  if (partidas.some((p) => p.valor_cents_padrao == null)) return true; // incompleto: não valida aqui
  const d = partidas.filter((p) => p.tipo === 'D').reduce((s, p) => s + (p.valor_cents_padrao ?? 0), 0);
  const c = partidas.filter((p) => p.tipo === 'C').reduce((s, p) => s + (p.valor_cents_padrao ?? 0), 0);
  return d === c && d > 0;
}

const modeloRefinement = {
  message: 'se todos os valores forem preenchidos, débito e crédito precisam bater',
  path: ['partidas'],
};

const modeloBaseSchema = z.object({
  client_id: z.string().uuid(),
  nome: z.string().trim().min(1, 'nome obrigatório').max(200),
  historico_codigo: codigoHistorico.optional().nullable(),
  historico_complemento: z.string().trim().max(500).default(''),
  partidas: z.array(modeloPartidaSchema).min(2, 'precisa de pelo menos 1 débito e 1 crédito'),
});

export const modeloCreateSchema = modeloBaseSchema.refine(
  (d) => modeloPartidasBalanceadasSeCompletas(d.partidas),
  modeloRefinement,
);

export const modeloUpdateSchema = modeloBaseSchema
  .omit({ client_id: true })
  .extend({ ativo: z.boolean().optional() })
  .refine((d) => modeloPartidasBalanceadasSeCompletas(d.partidas), modeloRefinement);

export const modelosListQuerySchema = z.object({ client_id: z.string().uuid() });

export const exportarDominioQuerySchema = z.object({
  periodo_id: z.string().uuid(),
  // mesmo limite de statements/schema.ts (registro 01 empacota em 8 dígitos
  // via pad0 — um valor maior não erra, só corrompe o fim do registro em silêncio).
  lote_numero: z.coerce.number().int().min(0).max(99_999_999).default(1),
});

export type PlanoContaCreate = z.infer<typeof planoContaCreateSchema>;
export type PlanoContaUpdate = z.infer<typeof planoContaUpdateSchema>;
export type HistoricoPadraoCreate = z.infer<typeof historicoPadraoCreateSchema>;
export type HistoricoPadraoUpdate = z.infer<typeof historicoPadraoUpdateSchema>;
export type LancamentoCreate = z.infer<typeof lancamentoCreateSchema>;
export type LancamentoUpdate = z.infer<typeof lancamentoUpdateSchema>;
export type ModeloCreate = z.infer<typeof modeloCreateSchema>;
export type ModeloUpdate = z.infer<typeof modeloUpdateSchema>;
