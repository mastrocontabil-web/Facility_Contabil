import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mapPgrstError } from '../lib/pgrst.js';
import { notFound } from '../lib/httpError.js';
import { clientCreateSchema, clientListQuerySchema, clientUpdateSchema } from './schema.js';

const TABLE = 'clients';
const COLUMNS =
  'id, razao_social, cnpj, dominio_code, banco_conta_contabil, hist_code_entrada, hist_code_saida, conta_width, saldo_inicial, ativo, observacoes, created_at, updated_at';

// Sem o requireAuth aqui — quem monta (routes/index.ts) aplica. Assim os testes
// injetam req.auth / req.supabase próprios.
export const clientsRouter = Router();

function db(req: { supabase?: SupabaseClient }): SupabaseClient {
  if (!req.supabase) throw new Error('supabase client ausente (middleware de auth?)');
  return req.supabase;
}

clientsRouter.get('/', async (req, res, next) => {
  try {
    const { q, ativo, limit } = clientListQuerySchema.parse(req.query);
    let query = db(req).from(TABLE).select(COLUMNS).order('razao_social').limit(limit);

    if (ativo !== 'all') query = query.eq('ativo', ativo === 'true');
    if (q) {
      const digits = q.replace(/\D/g, '');
      const parts = [`razao_social.ilike.%${q}%`];
      if (digits) parts.push(`cnpj.ilike.%${digits}%`);
      query = query.or(parts.join(','));
    }

    const { data, error } = await query;
    if (error) throw mapPgrstError(error, 'listar clientes');
    res.json({ clients: data ?? [] });
  } catch (err) {
    next(err);
  }
});

clientsRouter.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await db(req)
      .from(TABLE)
      .select(COLUMNS)
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw mapPgrstError(error, 'buscar cliente');
    if (!data) throw notFound('Cliente não encontrado');
    res.json({ client: data });
  } catch (err) {
    next(err);
  }
});

clientsRouter.post('/', async (req, res, next) => {
  try {
    const dto = clientCreateSchema.parse(req.body);
    const { data, error } = await db(req)
      .from(TABLE)
      .insert({ ...dto, owner_id: req.auth!.userId })
      .select(COLUMNS)
      .single();
    if (error) throw mapPgrstError(error, 'criar cliente');
    res.status(201).json({ client: data });
  } catch (err) {
    next(err);
  }
});

clientsRouter.patch('/:id', async (req, res, next) => {
  try {
    const dto = clientUpdateSchema.parse(req.body);
    if (Object.keys(dto).length === 0) {
      res.status(400).json({ error: 'Nada para atualizar' });
      return;
    }
    const { data, error } = await db(req)
      .from(TABLE)
      .update(dto)
      .eq('id', req.params.id)
      .select(COLUMNS)
      .maybeSingle();
    if (error) throw mapPgrstError(error, 'atualizar cliente');
    if (!data) throw notFound('Cliente não encontrado');
    res.json({ client: data });
  } catch (err) {
    next(err);
  }
});

clientsRouter.delete('/:id', async (req, res, next) => {
  try {
    const { error, count } = await db(req)
      .from(TABLE)
      .delete({ count: 'exact' })
      .eq('id', req.params.id);
    if (error) {
      if (error.code === '23503') {
        res.status(409).json({
          error: 'Cliente tem importações registradas — desative em vez de excluir.',
        });
        return;
      }
      throw mapPgrstError(error, 'excluir cliente');
    }
    if (!count) throw notFound('Cliente não encontrado');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
