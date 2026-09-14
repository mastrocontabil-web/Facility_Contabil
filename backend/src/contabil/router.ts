import { Router } from 'express';
import multer from 'multer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mapPgrstError } from '../lib/pgrst.js';
import { badRequest, notFound } from '../lib/httpError.js';
import {
  historicoPadraoCreateSchema,
  historicoPadraoUpdateSchema,
  importarBalanceteSchema,
  importarPlanoContasSchema,
  periodosListQuerySchema,
  planoContaCreateSchema,
  planoContaListQuerySchema,
  planoContaUpdateSchema,
  saldosListQuerySchema,
} from './schema.js';
import { callBalanceteParser, callPlanoContasParser } from './parserClient.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

const PLANO_TABLE = 'plano_contas';
const PLANO_COLS =
  'id, client_id, codigo, tipo, classificacao, nome, grau, parent_id, natureza, ativo, created_at, updated_at';
const HIST_TABLE = 'historicos_padrao';
const HIST_COLS = 'id, codigo, descricao, ativo, created_at, updated_at';
const PERIODO_TABLE = 'periodos_contabeis';
const PERIODO_COLS = 'id, client_id, ano, mes, status, fechado_em, created_at, updated_at';
const SALDO_TABLE = 'saldos_contabeis';
const SALDO_COLS =
  'id, periodo_id, plano_conta_id, codigo, nome, tipo, ordem, saldo_anterior_cents, ' +
  'saldo_anterior_natureza, debito_cents, credito_cents, saldo_atual_cents, ' +
  'saldo_atual_natureza, created_at, updated_at';

export const contabilRouter = Router();

function db(req: { supabase?: SupabaseClient }): SupabaseClient {
  if (!req.supabase) throw new Error('supabase client ausente (middleware de auth?)');
  return req.supabase;
}

/**
 * Recalcula parent_id de TODAS as contas do cliente a partir da classificação
 * (pai de "1.1.1.02.000003" é a conta com classificação "1.1.1.02"; raiz = null).
 * Roda de novo a cada import/criação/edição pra manter a árvore sempre consistente.
 * Feito via RPC (não upsert parcial) porque client_id/codigo/etc são NOT NULL —
 * um upsert só com {id, parent_id} falha na validação da linha candidata do
 * INSERT antes mesmo de chegar no ON CONFLICT DO UPDATE.
 */
async function relinkParents(supabase: SupabaseClient, clientId: string): Promise<void> {
  const { error } = await supabase.rpc('relink_plano_contas_parents', { p_client: clientId });
  if (error) throw mapPgrstError(error, 'religar hierarquia do plano de contas');
}

// --------------------------------------------------------------------------- #
// GET /plano-contas?client_id=  — lista ordenada pela hierarquia
// --------------------------------------------------------------------------- #
contabilRouter.get('/plano-contas', async (req, res, next) => {
  try {
    const { client_id } = planoContaListQuerySchema.parse(req.query);
    const { data, error } = await db(req)
      .from(PLANO_TABLE)
      .select(PLANO_COLS)
      .eq('client_id', client_id)
      .order('classificacao', { ascending: true });
    if (error) throw mapPgrstError(error, 'listar plano de contas');
    res.json({ contas: data ?? [] });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// POST /plano-contas/importar  — upload do PDF, lê e grava (upsert por código)
// --------------------------------------------------------------------------- #
contabilRouter.post('/plano-contas/importar', upload.single('file'), async (req, res, next) => {
  const supabase = db(req);
  const userId = req.auth!.userId;

  try {
    if (!req.file) throw badRequest('Arquivo do plano de contas é obrigatório (campo "file")');
    const dto = importarPlanoContasSchema.parse(req.body);

    const { data: client, error: cErr } = await supabase
      .from('clients')
      .select('id')
      .eq('id', dto.client_id)
      .maybeSingle();
    if (cErr) throw mapPgrstError(cErr, 'validar cliente');
    if (!client) throw notFound('Cliente não encontrado');

    const { data: existentes, error: eErr } = await supabase
      .from(PLANO_TABLE)
      .select('codigo')
      .eq('client_id', dto.client_id);
    if (eErr) throw mapPgrstError(eErr, 'ler plano de contas atual');
    const codigosExistentes = new Set((existentes ?? []).map((c) => c.codigo as string));

    const parsed = await callPlanoContasParser(
      { buffer: req.file.buffer, originalname: req.file.originalname, mimetype: req.file.mimetype },
      { pdfPassword: dto.pdf_password },
    );
    if (!parsed.items.length) {
      throw badRequest('Nenhuma conta encontrada no PDF', { warnings: parsed.warnings });
    }

    const rows = parsed.items.map((item) => ({
      owner_id: userId,
      client_id: dto.client_id,
      codigo: item.codigo,
      tipo: item.tipo,
      classificacao: item.classificacao,
      nome: item.nome,
      grau: item.grau,
    }));
    const { error: upErr } = await supabase
      .from(PLANO_TABLE)
      .upsert(rows, { onConflict: 'client_id,codigo' });
    if (upErr) throw mapPgrstError(upErr, 'gravar plano de contas');

    await relinkParents(supabase, dto.client_id);

    const { data: contas, error: lErr } = await supabase
      .from(PLANO_TABLE)
      .select(PLANO_COLS)
      .eq('client_id', dto.client_id)
      .order('classificacao', { ascending: true });
    if (lErr) throw mapPgrstError(lErr, 'reler plano de contas');

    const criadas = parsed.items.filter((i) => !codigosExistentes.has(i.codigo)).length;
    res.status(201).json({
      contas: contas ?? [],
      warnings: parsed.warnings,
      criadas,
      atualizadas: parsed.items.length - criadas,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// POST /plano-contas  — criar uma conta na mão
// --------------------------------------------------------------------------- #
contabilRouter.post('/plano-contas', async (req, res, next) => {
  try {
    const dto = planoContaCreateSchema.parse(req.body);
    const supabase = db(req);
    const { data, error } = await supabase
      .from(PLANO_TABLE)
      .insert({ ...dto, owner_id: req.auth!.userId })
      .select(PLANO_COLS)
      .single();
    if (error) {
      if (error.code === '23505') {
        throw badRequest('Já existe uma conta com esse código para esse cliente.');
      }
      throw mapPgrstError(error, 'criar conta');
    }
    await relinkParents(supabase, dto.client_id);
    const { data: fresh } = await supabase
      .from(PLANO_TABLE)
      .select(PLANO_COLS)
      .eq('id', data.id)
      .maybeSingle();
    res.status(201).json({ conta: fresh ?? data });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// PATCH /plano-contas/:id
// --------------------------------------------------------------------------- #
contabilRouter.patch('/plano-contas/:id', async (req, res, next) => {
  try {
    const dto = planoContaUpdateSchema.parse(req.body);
    if (Object.keys(dto).length === 0) throw badRequest('Nada para atualizar');
    const supabase = db(req);
    const { data, error } = await supabase
      .from(PLANO_TABLE)
      .update(dto)
      .eq('id', req.params.id)
      .select(PLANO_COLS)
      .maybeSingle();
    if (error) {
      if (error.code === '23505') {
        throw badRequest('Já existe uma conta com esse código para esse cliente.');
      }
      throw mapPgrstError(error, 'atualizar conta');
    }
    if (!data) throw notFound('Conta não encontrada');
    if (dto.classificacao) await relinkParents(supabase, data.client_id as string);
    res.json({ conta: data });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// DELETE /plano-contas/:id  — bloqueia se tiver conta filha
// --------------------------------------------------------------------------- #
contabilRouter.delete('/plano-contas/:id', async (req, res, next) => {
  try {
    const supabase = db(req);

    const { count: filhas, error: fErr } = await supabase
      .from(PLANO_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', req.params.id);
    if (fErr) throw mapPgrstError(fErr, 'verificar contas filhas');
    if (filhas) {
      throw badRequest(
        `Essa conta tem ${filhas} conta(s) filha(s) e não pode ser excluída. Exclua as filhas primeiro.`,
      );
    }

    const { error, count } = await supabase
      .from(PLANO_TABLE)
      .delete({ count: 'exact' })
      .eq('id', req.params.id);
    if (error) throw mapPgrstError(error, 'excluir conta');
    if (!count) throw notFound('Conta não encontrada');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// Históricos padrão — catálogo único do escritório (sem client_id)
// --------------------------------------------------------------------------- #
contabilRouter.get('/historicos', async (req, res, next) => {
  try {
    const { data, error } = await db(req)
      .from(HIST_TABLE)
      .select(HIST_COLS)
      .order('codigo', { ascending: true });
    if (error) throw mapPgrstError(error, 'listar históricos padrão');
    res.json({ historicos: data ?? [] });
  } catch (err) {
    next(err);
  }
});

contabilRouter.post('/historicos', async (req, res, next) => {
  try {
    const dto = historicoPadraoCreateSchema.parse(req.body);
    const { data, error } = await db(req)
      .from(HIST_TABLE)
      .insert({ ...dto, owner_id: req.auth!.userId })
      .select(HIST_COLS)
      .single();
    if (error) {
      if (error.code === '23505') throw badRequest('Já existe um histórico padrão com esse código.');
      throw mapPgrstError(error, 'criar histórico padrão');
    }
    res.status(201).json({ historico: data });
  } catch (err) {
    next(err);
  }
});

contabilRouter.patch('/historicos/:id', async (req, res, next) => {
  try {
    const dto = historicoPadraoUpdateSchema.parse(req.body);
    if (Object.keys(dto).length === 0) throw badRequest('Nada para atualizar');
    const { data, error } = await db(req)
      .from(HIST_TABLE)
      .update(dto)
      .eq('id', req.params.id)
      .select(HIST_COLS)
      .maybeSingle();
    if (error) {
      if (error.code === '23505') throw badRequest('Já existe um histórico padrão com esse código.');
      throw mapPgrstError(error, 'atualizar histórico padrão');
    }
    if (!data) throw notFound('Histórico padrão não encontrado');
    res.json({ historico: data });
  } catch (err) {
    next(err);
  }
});

contabilRouter.delete('/historicos/:id', async (req, res, next) => {
  try {
    const { error, count } = await db(req)
      .from(HIST_TABLE)
      .delete({ count: 'exact' })
      .eq('id', req.params.id);
    if (error) throw mapPgrstError(error, 'excluir histórico padrão');
    if (!count) throw notFound('Histórico padrão não encontrado');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// POST /balancete/importar  — upload do PDF, lê e grava saldos do período
// --------------------------------------------------------------------------- #
contabilRouter.post('/balancete/importar', upload.single('file'), async (req, res, next) => {
  const supabase = db(req);
  const userId = req.auth!.userId;

  try {
    if (!req.file) throw badRequest('Arquivo do balancete é obrigatório (campo "file")');
    const dto = importarBalanceteSchema.parse(req.body);

    const { data: client, error: cErr } = await supabase
      .from('clients')
      .select('id')
      .eq('id', dto.client_id)
      .maybeSingle();
    if (cErr) throw mapPgrstError(cErr, 'validar cliente');
    if (!client) throw notFound('Cliente não encontrado');

    const parsed = await callBalanceteParser(
      { buffer: req.file.buffer, originalname: req.file.originalname, mimetype: req.file.mimetype },
      { pdfPassword: dto.pdf_password },
    );
    if (!parsed.items.length) {
      throw badRequest('Nenhuma conta encontrada no balancete', { warnings: parsed.warnings });
    }

    const { data: periodoRow, error: pErr } = await supabase
      .from(PERIODO_TABLE)
      .upsert(
        {
          owner_id: userId,
          client_id: dto.client_id,
          ano: parsed.periodo.ano,
          mes: parsed.periodo.mes,
          status: 'fechado',
          fechado_em: new Date().toISOString(),
        },
        { onConflict: 'client_id,ano,mes' },
      )
      .select(PERIODO_COLS)
      .single();
    if (pErr) throw mapPgrstError(pErr, 'gravar período contábil');

    const { data: existentes, error: eErr } = await supabase
      .from(SALDO_TABLE)
      .select('codigo')
      .eq('periodo_id', periodoRow.id);
    if (eErr) throw mapPgrstError(eErr, 'ler saldos do período');
    const codigosExistentes = new Set((existentes ?? []).map((s) => s.codigo as string));

    const { data: plano, error: plErr } = await supabase
      .from(PLANO_TABLE)
      .select('id, codigo, tipo')
      .eq('client_id', dto.client_id);
    if (plErr) throw mapPgrstError(plErr, 'ler plano de contas do cliente');
    const planoPorCodigo = new Map((plano ?? []).map((p) => [p.codigo as string, p]));

    const warnings = [...parsed.warnings];
    const rows = parsed.items.map((item, ordem) => {
      const vinculo = planoPorCodigo.get(item.codigo);
      if (!vinculo) {
        warnings.push(
          `conta ${item.codigo} (${item.nome}) não encontrada no plano de contas — saldo importado sem vínculo`,
        );
      } else if (vinculo.tipo !== item.tipo) {
        warnings.push(
          `conta ${item.codigo}: tipo no balancete (${item.tipo}) diverge do plano de contas (${vinculo.tipo})`,
        );
      }
      return {
        owner_id: userId,
        periodo_id: periodoRow.id,
        plano_conta_id: vinculo?.id ?? null,
        codigo: item.codigo,
        nome: item.nome,
        tipo: item.tipo,
        ordem,
        saldo_anterior_cents: item.saldo_anterior_cents,
        saldo_anterior_natureza: item.saldo_anterior_natureza,
        debito_cents: item.debito_cents,
        credito_cents: item.credito_cents,
        saldo_atual_cents: item.saldo_atual_cents,
        saldo_atual_natureza: item.saldo_atual_natureza,
      };
    });

    const { error: upErr } = await supabase
      .from(SALDO_TABLE)
      .upsert(rows, { onConflict: 'periodo_id,codigo' });
    if (upErr) throw mapPgrstError(upErr, 'gravar saldos do período');

    const { data: saldos, error: lErr } = await supabase
      .from(SALDO_TABLE)
      .select(SALDO_COLS)
      .eq('periodo_id', periodoRow.id)
      .order('ordem', { ascending: true });
    if (lErr) throw mapPgrstError(lErr, 'reler saldos do período');

    const criadas = parsed.items.filter((i) => !codigosExistentes.has(i.codigo)).length;
    res.status(201).json({
      periodo: periodoRow,
      saldos: saldos ?? [],
      warnings,
      criadas,
      atualizadas: parsed.items.length - criadas,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// GET /periodos?client_id=  — lista períodos do cliente, mais recente primeiro
// --------------------------------------------------------------------------- #
contabilRouter.get('/periodos', async (req, res, next) => {
  try {
    const { client_id } = periodosListQuerySchema.parse(req.query);
    const { data, error } = await db(req)
      .from(PERIODO_TABLE)
      .select(PERIODO_COLS)
      .eq('client_id', client_id)
      .order('ano', { ascending: false })
      .order('mes', { ascending: false });
    if (error) throw mapPgrstError(error, 'listar períodos');
    res.json({ periodos: data ?? [] });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// GET /saldos?periodo_id=  — saldos de um período, na ordem do balancete
// --------------------------------------------------------------------------- #
contabilRouter.get('/saldos', async (req, res, next) => {
  try {
    const { periodo_id } = saldosListQuerySchema.parse(req.query);
    const { data, error } = await db(req)
      .from(SALDO_TABLE)
      .select(SALDO_COLS)
      .eq('periodo_id', periodo_id)
      .order('ordem', { ascending: true });
    if (error) throw mapPgrstError(error, 'listar saldos');
    res.json({ saldos: data ?? [] });
  } catch (err) {
    next(err);
  }
});
