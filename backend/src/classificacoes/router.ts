import { Router } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mapPgrstError } from '../lib/pgrst.js';
import { badRequest, notFound } from '../lib/httpError.js';
import {
  classificacaoCreateSchema,
  classificacaoListQuerySchema,
  classificacaoUpdateSchema,
} from './schema.js';

const TABLE = 'classificacoes';
const COLUMNS = 'id, client_id, direction, nome, ativo, created_at, updated_at';

export const classificacoesRouter = Router();

function db(req: { supabase?: SupabaseClient }): SupabaseClient {
  if (!req.supabase) throw new Error('supabase client ausente (middleware de auth?)');
  return req.supabase;
}

// GET /api/classificacoes?client_id=...&direction=entrada|saida
classificacoesRouter.get('/', async (req, res, next) => {
  try {
    const { client_id, direction } = classificacaoListQuerySchema.parse(req.query);
    let q = db(req)
      .from(TABLE)
      .select(COLUMNS)
      .eq('client_id', client_id)
      .order('nome', { ascending: true });
    if (direction) q = q.eq('direction', direction);
    const { data, error } = await q;
    if (error) throw mapPgrstError(error, 'listar classificações');
    res.json({ classificacoes: data ?? [] });
  } catch (err) {
    next(err);
  }
});

// POST /api/classificacoes
classificacoesRouter.post('/', async (req, res, next) => {
  try {
    const dto = classificacaoCreateSchema.parse(req.body);
    const { data, error } = await db(req)
      .from(TABLE)
      .insert({ ...dto, owner_id: req.auth!.userId })
      .select(COLUMNS)
      .single();
    if (error) {
      if (error.code === '23505') {
        throw badRequest('Já existe uma classificação com esse nome para essa direção.');
      }
      throw mapPgrstError(error, 'criar classificação');
    }
    res.status(201).json({ classificacao: data });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/classificacoes/:id
classificacoesRouter.patch('/:id', async (req, res, next) => {
  try {
    const dto = classificacaoUpdateSchema.parse(req.body);
    if (Object.keys(dto).length === 0) throw badRequest('Nada para atualizar');
    const { data, error } = await db(req)
      .from(TABLE)
      .update(dto)
      .eq('id', req.params.id)
      .select(COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === '23505') {
        throw badRequest('Já existe uma classificação com esse nome para essa direção.');
      }
      throw mapPgrstError(error, 'atualizar classificação');
    }
    if (!data) throw notFound('Classificação não encontrada');
    res.json({ classificacao: data });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/classificacoes/:id
classificacoesRouter.delete('/:id', async (req, res, next) => {
  try {
    const supabase = db(req);

    // em uso em algum lançamento → não deixa excluir (só desativar)
    const { count: emUso, error: uErr } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('classificacao_id', req.params.id);
    if (uErr) throw mapPgrstError(uErr, 'verificar uso da classificação');
    if (emUso) {
      throw badRequest(
        `Essa classificação está em uso em ${emUso} lançamento(s) e não pode ser excluída. Desative em vez de excluir.`,
      );
    }

    const { error, count } = await supabase
      .from(TABLE)
      .delete({ count: 'exact' })
      .eq('id', req.params.id);
    if (error) throw mapPgrstError(error, 'excluir classificação');
    if (!count) throw notFound('Classificação não encontrada');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
