import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mapPgrstError } from '../lib/pgrst.js';
import { badRequest, notFound } from '../lib/httpError.js';
import { ruleCreateSchema, ruleListQuerySchema, ruleUpdateSchema } from './schema.js';

const TABLE = 'mapping_rules';
const COLUMNS =
  'id, client_id, direction, match_type, pattern, conta_contabil, hist_code, hist_complemento_template, prioridade, hits, last_used_at, ativo, auto, created_at, updated_at';

export const rulesRouter = Router();

function db(req: { supabase?: SupabaseClient }): SupabaseClient {
  if (!req.supabase) throw new Error('supabase client ausente (middleware de auth?)');
  return req.supabase;
}

// GET /api/rules?client_id=... — regras de um cliente, na ordem de aplicação
rulesRouter.get('/', async (req, res, next) => {
  try {
    const { client_id } = ruleListQuerySchema.parse(req.query);
    const { data, error } = await db(req)
      .from(TABLE)
      .select(COLUMNS)
      .eq('client_id', client_id)
      .order('pattern', { ascending: true })
      .order('hits', { ascending: false });
    if (error) throw mapPgrstError(error, 'listar memórias');
    res.json({ rules: data ?? [] });
  } catch (err) {
    next(err);
  }
});

// POST /api/rules
rulesRouter.post('/', async (req, res, next) => {
  try {
    const dto = ruleCreateSchema.parse(req.body);
    const { data, error } = await db(req)
      .from(TABLE)
      .insert({ ...dto, owner_id: req.auth!.userId })
      .select(COLUMNS)
      .single();
    if (error) throw mapPgrstError(error, 'criar regra');
    res.status(201).json({ rule: data });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/rules/:id
rulesRouter.patch('/:id', async (req, res, next) => {
  try {
    const dto = ruleUpdateSchema.parse(req.body);
    if (Object.keys(dto).length === 0) throw badRequest('Nada para atualizar');
    const { data, error } = await db(req)
      .from(TABLE)
      .update(dto)
      .eq('id', req.params.id)
      .select(COLUMNS)
      .maybeSingle();
    if (error) throw mapPgrstError(error, 'atualizar regra');
    if (!data) throw notFound('Regra não encontrada');
    res.json({ rule: data });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/rules/:id
rulesRouter.delete('/:id', async (req, res, next) => {
  try {
    const { error, count } = await db(req)
      .from(TABLE)
      .delete({ count: 'exact' })
      .eq('id', req.params.id);
    if (error) throw mapPgrstError(error, 'excluir regra');
    if (!count) throw notFound('Regra não encontrada');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
