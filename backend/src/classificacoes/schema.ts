import { z } from 'zod';

export const classificacaoCreateSchema = z.object({
  client_id: z.string().uuid(),
  direction: z.enum(['entrada', 'saida']),
  nome: z.string().trim().min(2, 'nome muito curto').max(120),
  ativo: z.boolean().default(true),
});

export const classificacaoUpdateSchema = classificacaoCreateSchema.partial().omit({ client_id: true });

export const classificacaoListQuerySchema = z.object({
  client_id: z.string().uuid(),
  direction: z.enum(['entrada', 'saida']).optional(),
});

export type ClassificacaoCreate = z.infer<typeof classificacaoCreateSchema>;
export type ClassificacaoUpdate = z.infer<typeof classificacaoUpdateSchema>;
