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
  lancamentoCreateSchema,
  lancamentoUpdateSchema,
  lancamentosListQuerySchema,
  periodosListQuerySchema,
  planoContaCreateSchema,
  planoContaListQuerySchema,
  planoContaUpdateSchema,
  razaoQuerySchema,
  recalcularSaldosSchema,
  saldosListQuerySchema,
} from './schema.js';
import {
  callBalanceteParser,
  callGerarBalancetePdf,
  callGerarDrePdf,
  callGerarLivroDiarioPdf,
  callGerarRazaoPdf,
  callPlanoContasParser,
} from './parserClient.js';
import { recomputeSaldosCascade } from './saldoEngine.js';
import { montarDreRelatorio } from './dreEngine.js';
import { montarRazao, type RazaoLinha } from './razaoEngine.js';

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
const LANC_TABLE = 'lancamentos';
const PARTIDA_TABLE = 'lancamento_partidas';
const LANC_COLS =
  'id, periodo_id, data, historico_codigo, historico_complemento, created_at, updated_at, ' +
  'partidas:lancamento_partidas(id, plano_conta_id, tipo, valor_cents, ordem, ' +
  'plano_conta:plano_contas(codigo, nome))';

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

/**
 * Garante que existe um período 'aberto' pro (cliente, ano, mês) e devolve
 * seu id/status. Nunca reabre um período já 'fechado' — o upsert usa
 * ignoreDuplicates (DO NOTHING no conflito), então não dá pra confiar num
 * .select() encadeado nesse insert (não retorna linha quando pula); por
 * isso relê à parte pra saber o estado VERDADEIRO atual.
 */
async function resolvePeriodoAberto(
  supabase: SupabaseClient,
  ownerId: string,
  clientId: string,
  ano: number,
  mes: number,
): Promise<{ id: string; status: string }> {
  const { error: upErr } = await supabase
    .from(PERIODO_TABLE)
    .upsert(
      { owner_id: ownerId, client_id: clientId, ano, mes, status: 'aberto' },
      { onConflict: 'client_id,ano,mes', ignoreDuplicates: true },
    );
  if (upErr) throw mapPgrstError(upErr, 'abrir período');

  const { data: periodo, error: selErr } = await supabase
    .from(PERIODO_TABLE)
    .select('id, status')
    .eq('client_id', clientId)
    .eq('ano', ano)
    .eq('mes', mes)
    .single();
  if (selErr) throw mapPgrstError(selErr, 'ler período');
  if (periodo.status === 'fechado') {
    throw badRequest('Esse período já está fechado — não é possível lançar nele.');
  }
  return periodo as { id: string; status: string };
}

/**
 * Confere que toda plano_conta_id citada nas partidas existe, pertence a
 * esse cliente, é analítica (só folha recebe lançamento — sintética é
 * rollup) e está ativa. Sem isso, um POST direto (sem passar pelo filtro
 * do frontend) poderia postar numa conta de outro cliente ou num grupo.
 */
async function assertPartidasContasValidas(
  supabase: SupabaseClient,
  clientId: string,
  partidas: { plano_conta_id: string }[],
): Promise<void> {
  const ids = [...new Set(partidas.map((p) => p.plano_conta_id))];
  const { data: contas, error } = await supabase
    .from(PLANO_TABLE)
    .select('id, client_id, tipo, ativo')
    .in('id', ids);
  if (error) throw mapPgrstError(error, 'validar contas do lançamento');
  const porId = new Map((contas ?? []).map((c) => [c.id as string, c]));
  for (const id of ids) {
    const c = porId.get(id);
    if (!c) throw badRequest(`Conta ${id} não encontrada.`);
    if (c.client_id !== clientId) throw badRequest(`Conta ${id} não pertence a esse cliente.`);
    if (c.tipo !== 'A') {
      throw badRequest(`Conta ${id} é sintética — só contas analíticas recebem lançamento.`);
    }
    if (!c.ativo) throw badRequest(`Conta ${id} está inativa.`);
  }
}

/** dto.data já vem validado pelo zod como YYYY-MM-DD (10 chars fixos). */
function anoMesDe(data: string): [number, number] {
  return [Number(data.slice(0, 4)), Number(data.slice(5, 7))];
}

/** Embeds do Postgrest às vezes vêm como array-de-um em vez de objeto — mesma defesa que statements/router.ts já usa. */
function unwrapEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

type ContaItemLike = {
  codigo: string;
  nome: string;
  tipo: 'S' | 'A';
  saldo_anterior_cents: number;
  saldo_anterior_natureza: 'D' | 'C' | null;
  debito_cents: number;
  credito_cents: number;
  saldo_atual_cents: number;
  saldo_atual_natureza: 'D' | 'C' | null;
};

/** Reduz uma linha de saldos_contabeis (ou o SaldoRow do dreEngine, mesmo
 * formato de campos) pro shape que o parser espera — sem vazar id/ordem/timestamps. */
function toContaItem(s: ContaItemLike): ContaItemLike {
  return {
    codigo: s.codigo,
    nome: s.nome,
    tipo: s.tipo,
    saldo_anterior_cents: s.saldo_anterior_cents,
    saldo_anterior_natureza: s.saldo_anterior_natureza,
    debito_cents: s.debito_cents,
    credito_cents: s.credito_cents,
    saldo_atual_cents: s.saldo_atual_cents,
    saldo_atual_natureza: s.saldo_atual_natureza,
  };
}

/** Mesma convenção do dominio/exporter.ts: código Domínio só-dígitos entre
 * parênteses, "mm-yyyy" — nunca formatCompetencia() (a barra "06/2026" vira
 * separador de path no Windows ao salvar) nem razao_social (tem acento; todo
 * outro Content-Disposition desse projeto evita texto não-ASCII). */
function nomeArquivoRelatorio(tipo: string, dominioCode: string, ano: number, mes: number): string {
  return `(${dominioCode}) ${tipo} ${String(mes).padStart(2, '0')}-${ano}.pdf`;
}

/** Reduz uma RazaoLinha pro shape que o parser espera — sem vazar lancamento_id. */
function toRazaoLinha(l: RazaoLinha) {
  return {
    data: l.data,
    historico_codigo: l.historico_codigo,
    historico_complemento: l.historico_complemento,
    tipo: l.tipo,
    valor_cents: l.valor_cents,
    saldo_cents: l.saldo_cents,
    saldo_natureza: l.saldo_natureza,
  };
}

type LivroDiarioLancamentoLike = {
  data: string;
  historico_codigo: string | null;
  historico_complemento: string;
  partidas: Array<{ tipo: string; valor_cents: number; plano_conta: { codigo: string; nome: string } | null }>;
};

/** Reduz um lançamento (já normalizado — embed desembrulhado) pro shape que
 * o parser espera — sem vazar id/plano_conta_id/ordem internos. */
function toLivroDiarioLancamento(l: LivroDiarioLancamentoLike) {
  return {
    data: l.data,
    historico_codigo: l.historico_codigo,
    historico_complemento: l.historico_complemento,
    partidas: l.partidas.map((p) => ({
      conta_codigo: p.plano_conta?.codigo ?? '',
      conta_nome: p.plano_conta?.nome ?? '',
      tipo: p.tipo as 'D' | 'C',
      valor_cents: p.valor_cents,
    })),
  };
}

async function buscarClientePraRelatorio(
  supabase: SupabaseClient,
  clientId: string,
): Promise<{ razao_social: string; cnpj: string; dominio_code: string }> {
  const { data, error } = await supabase
    .from('clients')
    .select('razao_social, cnpj, dominio_code')
    .eq('id', clientId)
    .maybeSingle();
  if (error) throw mapPgrstError(error, 'buscar cliente pro relatório');
  if (!data) throw notFound('Cliente não encontrado');
  return data as { razao_social: string; cnpj: string; dominio_code: string };
}

type LancamentoRow = {
  id: string;
  periodo_id: string;
  data: string;
  historico_codigo: string | null;
  historico_complemento: string;
  created_at: string;
  updated_at: string;
  partidas: Array<{
    id: string;
    plano_conta_id: string;
    tipo: string;
    valor_cents: number;
    ordem: number;
    plano_conta: { codigo: string; nome: string } | { codigo: string; nome: string }[] | null;
  }> | null;
};

function normalizeLancamento(row: LancamentoRow) {
  return {
    ...row,
    partidas: (row.partidas ?? []).map((p) => ({ ...p, plano_conta: unwrapEmbed(p.plano_conta) })),
  };
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

// --------------------------------------------------------------------------- #
// POST /saldos/recalcular  — roda o motor de saldos manualmente (backfill /
// via de escape). Idempotente e independente de ordem: como o motor sempre
// ancora no último período fechado, chamar com qualquer período de um
// trecho aberto quebrado dá o mesmo resultado certo.
// --------------------------------------------------------------------------- #
contabilRouter.post('/saldos/recalcular', async (req, res, next) => {
  try {
    const supabase = db(req);
    const userId = req.auth!.userId;
    const { periodo_id } = recalcularSaldosSchema.parse(req.body);

    await recomputeSaldosCascade(supabase, userId, periodo_id);

    const { data: periodo, error: perErr } = await supabase
      .from(PERIODO_TABLE)
      .select(PERIODO_COLS)
      .eq('id', periodo_id)
      .maybeSingle();
    if (perErr) throw mapPgrstError(perErr, 'reler período');
    if (!periodo) throw notFound('Período não encontrado');

    const { data: saldos, error: salErr } = await supabase
      .from(SALDO_TABLE)
      .select(SALDO_COLS)
      .eq('periodo_id', periodo_id)
      .order('ordem', { ascending: true });
    if (salErr) throw mapPgrstError(salErr, 'reler saldos');

    res.json({ periodo, saldos: saldos ?? [] });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// POST /lancamentos  — lançamento manual (partida simples ou múltipla)
// --------------------------------------------------------------------------- #
contabilRouter.post('/lancamentos', async (req, res, next) => {
  const supabase = db(req);
  const userId = req.auth!.userId;

  try {
    const dto = lancamentoCreateSchema.parse(req.body);

    const { data: client, error: cErr } = await supabase
      .from('clients')
      .select('id')
      .eq('id', dto.client_id)
      .maybeSingle();
    if (cErr) throw mapPgrstError(cErr, 'validar cliente');
    if (!client) throw notFound('Cliente não encontrado');

    // valida as contas ANTES de mexer em período, pra não abrir período à
    // toa numa request que vai falhar de qualquer jeito.
    await assertPartidasContasValidas(supabase, dto.client_id, dto.partidas);

    const [ano, mes] = anoMesDe(dto.data);
    const periodo = await resolvePeriodoAberto(supabase, userId, dto.client_id, ano, mes);

    const { data: lancamento, error: lErr } = await supabase
      .from(LANC_TABLE)
      .insert({
        owner_id: userId,
        periodo_id: periodo.id,
        data: dto.data,
        historico_codigo: dto.historico_codigo ?? null,
        historico_complemento: dto.historico_complemento,
      })
      .select('id')
      .single();
    if (lErr) throw mapPgrstError(lErr, 'criar lançamento');

    const partidasRows = dto.partidas.map((p, ordem) => ({
      owner_id: userId,
      lancamento_id: lancamento.id,
      plano_conta_id: p.plano_conta_id,
      tipo: p.tipo,
      valor_cents: p.valor_cents,
      ordem,
    }));
    const { error: pErr } = await supabase.from(PARTIDA_TABLE).insert(partidasRows);
    if (pErr) throw mapPgrstError(pErr, 'gravar partidas do lançamento');

    await recomputeSaldosCascade(supabase, userId, periodo.id);

    const { data: fresh, error: fErr } = await supabase
      .from(LANC_TABLE)
      .select(LANC_COLS)
      .eq('id', lancamento.id)
      .single();
    if (fErr) throw mapPgrstError(fErr, 'reler lançamento');

    res.status(201).json({ lancamento: normalizeLancamento(fresh as unknown as LancamentoRow) });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// GET /lancamentos?periodo_id=  — lançamentos do período, em ordem cronológica
// --------------------------------------------------------------------------- #
contabilRouter.get('/lancamentos', async (req, res, next) => {
  try {
    const { periodo_id } = lancamentosListQuerySchema.parse(req.query);
    const { data, error } = await db(req)
      .from(LANC_TABLE)
      .select(LANC_COLS)
      .eq('periodo_id', periodo_id)
      .order('data', { ascending: true })
      .order('created_at', { ascending: true })
      .order('ordem', { ascending: true, foreignTable: PARTIDA_TABLE });
    if (error) throw mapPgrstError(error, 'listar lançamentos');
    res.json({ lancamentos: ((data ?? []) as unknown as LancamentoRow[]).map(normalizeLancamento) });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// PATCH /lancamentos/:id  — apaga+recria as partidas (nunca edita em lugar)
// --------------------------------------------------------------------------- #
contabilRouter.patch('/lancamentos/:id', async (req, res, next) => {
  const supabase = db(req);
  const userId = req.auth!.userId;

  try {
    const dto = lancamentoUpdateSchema.parse(req.body);

    const { data: atual, error: aErr } = await supabase
      .from(LANC_TABLE)
      .select('id, periodo_id')
      .eq('id', req.params.id)
      .maybeSingle();
    if (aErr) throw mapPgrstError(aErr, 'buscar lançamento');
    if (!atual) throw notFound('Lançamento não encontrado');

    const { data: periodoAtual, error: paErr } = await supabase
      .from(PERIODO_TABLE)
      .select('id, client_id, status')
      .eq('id', atual.periodo_id)
      .single();
    if (paErr) throw mapPgrstError(paErr, 'buscar período do lançamento');
    if (periodoAtual.status === 'fechado') {
      throw badRequest('O período desse lançamento está fechado — não é possível editá-lo.');
    }

    await assertPartidasContasValidas(supabase, periodoAtual.client_id as string, dto.partidas);

    // resolve o período do NOVO valor de `data` (pode ter mudado de mês) —
    // valida os dois períodos (velho e novo) ANTES de apagar qualquer
    // dado: se rejeitasse depois de apagar, um PATCH inválido destruiria
    // as partidas antigas sem gravar as novas.
    const [ano, mes] = anoMesDe(dto.data);
    const novoPeriodo = await resolvePeriodoAberto(
      supabase,
      userId,
      periodoAtual.client_id as string,
      ano,
      mes,
    );

    const { error: uErr } = await supabase
      .from(LANC_TABLE)
      .update({
        periodo_id: novoPeriodo.id,
        data: dto.data,
        historico_codigo: dto.historico_codigo ?? null,
        historico_complemento: dto.historico_complemento,
      })
      .eq('id', req.params.id);
    if (uErr) throw mapPgrstError(uErr, 'atualizar lançamento');

    const { error: dErr } = await supabase.from(PARTIDA_TABLE).delete().eq('lancamento_id', req.params.id);
    if (dErr) throw mapPgrstError(dErr, 'limpar partidas antigas');

    const partidasRows = dto.partidas.map((p, ordem) => ({
      owner_id: userId,
      lancamento_id: req.params.id,
      plano_conta_id: p.plano_conta_id,
      tipo: p.tipo,
      valor_cents: p.valor_cents,
      ordem,
    }));
    const { error: pErr } = await supabase.from(PARTIDA_TABLE).insert(partidasRows);
    if (pErr) throw mapPgrstError(pErr, 'gravar partidas do lançamento');

    // recalcula os dois períodos quando mudam de mês — não dá pra confiar
    // que a cascata de um alcança o outro (se houver um período FECHADO
    // entre os dois, a cascata de um nunca chega no outro).
    await recomputeSaldosCascade(supabase, userId, novoPeriodo.id);
    if (novoPeriodo.id !== periodoAtual.id) {
      await recomputeSaldosCascade(supabase, userId, periodoAtual.id as string);
    }

    const { data: fresh, error: fErr } = await supabase
      .from(LANC_TABLE)
      .select(LANC_COLS)
      .eq('id', req.params.id)
      .single();
    if (fErr) throw mapPgrstError(fErr, 'reler lançamento');

    res.json({ lancamento: normalizeLancamento(fresh as unknown as LancamentoRow) });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// DELETE /lancamentos/:id  — bloqueia se o período estiver fechado
// --------------------------------------------------------------------------- #
contabilRouter.delete('/lancamentos/:id', async (req, res, next) => {
  try {
    const supabase = db(req);
    const userId = req.auth!.userId;

    const { data: atual, error: aErr } = await supabase
      .from(LANC_TABLE)
      .select('id, periodo_id')
      .eq('id', req.params.id)
      .maybeSingle();
    if (aErr) throw mapPgrstError(aErr, 'buscar lançamento');
    if (!atual) throw notFound('Lançamento não encontrado');

    const { data: periodo, error: pErr } = await supabase
      .from(PERIODO_TABLE)
      .select('status')
      .eq('id', atual.periodo_id)
      .single();
    if (pErr) throw mapPgrstError(pErr, 'buscar período do lançamento');
    if (periodo.status === 'fechado') {
      throw badRequest('O período desse lançamento está fechado — não é possível excluí-lo.');
    }

    const { error, count } = await supabase
      .from(LANC_TABLE)
      .delete({ count: 'exact' })
      .eq('id', req.params.id);
    if (error) throw mapPgrstError(error, 'excluir lançamento');
    if (!count) throw notFound('Lançamento não encontrado');

    await recomputeSaldosCascade(supabase, userId, atual.periodo_id as string);

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// GET /relatorios/dre?periodo_id=  — receitas, despesas e os dois resultados
// --------------------------------------------------------------------------- #
contabilRouter.get('/relatorios/dre', async (req, res, next) => {
  try {
    const { periodo_id } = saldosListQuerySchema.parse(req.query);
    const dre = await montarDreRelatorio(db(req), periodo_id);
    res.json(dre);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// GET /relatorios/balancete/pdf?periodo_id=  — PDF gerado no parser (Python)
// --------------------------------------------------------------------------- #
contabilRouter.get('/relatorios/balancete/pdf', async (req, res, next) => {
  try {
    const { periodo_id } = saldosListQuerySchema.parse(req.query);
    const supabase = db(req);

    const { data: periodo, error: perErr } = await supabase
      .from(PERIODO_TABLE)
      .select('client_id, ano, mes')
      .eq('id', periodo_id)
      .maybeSingle();
    if (perErr) throw mapPgrstError(perErr, 'buscar período do balancete');
    if (!periodo) throw notFound('Período não encontrado');

    const { data: saldos, error: salErr } = await supabase
      .from(SALDO_TABLE)
      .select(SALDO_COLS)
      .eq('periodo_id', periodo_id)
      .order('ordem', { ascending: true });
    if (salErr) throw mapPgrstError(salErr, 'ler saldos do balancete');

    const cliente = await buscarClientePraRelatorio(supabase, periodo.client_id as string);

    const pdf = await callGerarBalancetePdf({
      cliente: { razao_social: cliente.razao_social, cnpj: cliente.cnpj },
      periodo: { ano: periodo.ano as number, mes: periodo.mes as number },
      linhas: (saldos ?? []).map((s) => toContaItem(s as unknown as ContaItemLike)),
    });

    const filename = nomeArquivoRelatorio('Balancete', cliente.dominio_code, periodo.ano as number, periodo.mes as number);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// GET /relatorios/dre/pdf?periodo_id=  — PDF gerado no parser (Python)
// --------------------------------------------------------------------------- #
contabilRouter.get('/relatorios/dre/pdf', async (req, res, next) => {
  try {
    const { periodo_id } = saldosListQuerySchema.parse(req.query);
    const supabase = db(req);

    const dre = await montarDreRelatorio(supabase, periodo_id);
    const cliente = await buscarClientePraRelatorio(supabase, dre.periodo.client_id);

    const pdf = await callGerarDrePdf({
      cliente: { razao_social: cliente.razao_social, cnpj: cliente.cnpj },
      periodo: { ano: dre.periodo.ano, mes: dre.periodo.mes },
      receitas: {
        raiz: toContaItem(dre.receitas.raiz),
        linhas: dre.receitas.linhas.map((l) => toContaItem(l)),
      },
      despesas: {
        raiz: toContaItem(dre.despesas.raiz),
        linhas: dre.despesas.linhas.map((l) => toContaItem(l)),
      },
      resultado_mes: { cents: dre.resultado_mes_cents, natureza: dre.resultado_mes_natureza },
      resultado_exercicio: { cents: dre.resultado_exercicio_cents, natureza: dre.resultado_exercicio_natureza },
    });

    const filename = nomeArquivoRelatorio('DRE', cliente.dominio_code, dre.periodo.ano, dre.periodo.mes);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// GET /relatorios/razao?periodo_id=&plano_conta_id=  — razão de uma conta analítica
// --------------------------------------------------------------------------- #
contabilRouter.get('/relatorios/razao', async (req, res, next) => {
  try {
    const { periodo_id, plano_conta_id } = razaoQuerySchema.parse(req.query);
    const razao = await montarRazao(db(req), periodo_id, plano_conta_id);
    res.json(razao);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// GET /relatorios/razao/pdf?periodo_id=&plano_conta_id=  — PDF gerado no parser
// --------------------------------------------------------------------------- #
contabilRouter.get('/relatorios/razao/pdf', async (req, res, next) => {
  try {
    const { periodo_id, plano_conta_id } = razaoQuerySchema.parse(req.query);
    const supabase = db(req);

    const razao = await montarRazao(supabase, periodo_id, plano_conta_id);
    const cliente = await buscarClientePraRelatorio(supabase, razao.periodo.client_id);

    const pdf = await callGerarRazaoPdf({
      cliente: { razao_social: cliente.razao_social, cnpj: cliente.cnpj },
      periodo: { ano: razao.periodo.ano, mes: razao.periodo.mes },
      conta: razao.conta,
      saldo_anterior_cents: razao.saldo_anterior_cents,
      saldo_anterior_natureza: razao.saldo_anterior_natureza,
      linhas: razao.linhas.map(toRazaoLinha),
      saldo_atual_cents: razao.saldo_atual_cents,
      saldo_atual_natureza: razao.saldo_atual_natureza,
    });

    // inclui o código da conta no nome — sem isso, duas contas do mesmo
    // período gerariam o mesmo nome de arquivo na pasta de downloads.
    const filename = nomeArquivoRelatorio(
      `Razao ${razao.conta.codigo}`,
      cliente.dominio_code,
      razao.periodo.ano,
      razao.periodo.mes,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// GET /relatorios/livro-diario/pdf?periodo_id=  — PDF gerado no parser (Python)
// --------------------------------------------------------------------------- #
contabilRouter.get('/relatorios/livro-diario/pdf', async (req, res, next) => {
  try {
    const { periodo_id } = lancamentosListQuerySchema.parse(req.query);
    const supabase = db(req);

    const { data: periodo, error: perErr } = await supabase
      .from(PERIODO_TABLE)
      .select('client_id, ano, mes')
      .eq('id', periodo_id)
      .maybeSingle();
    if (perErr) throw mapPgrstError(perErr, 'buscar período do livro diário');
    if (!periodo) throw notFound('Período não encontrado');

    const { data: lancs, error: lancsErr } = await supabase
      .from(LANC_TABLE)
      .select(LANC_COLS)
      .eq('periodo_id', periodo_id)
      .order('data', { ascending: true })
      .order('created_at', { ascending: true })
      .order('ordem', { ascending: true, foreignTable: PARTIDA_TABLE });
    if (lancsErr) throw mapPgrstError(lancsErr, 'ler lançamentos do livro diário');

    const cliente = await buscarClientePraRelatorio(supabase, periodo.client_id as string);

    const pdf = await callGerarLivroDiarioPdf({
      cliente: { razao_social: cliente.razao_social, cnpj: cliente.cnpj },
      periodo: { ano: periodo.ano as number, mes: periodo.mes as number },
      lancamentos: ((lancs ?? []) as unknown as LancamentoRow[])
        .map(normalizeLancamento)
        .map((l) => toLivroDiarioLancamento(l as unknown as LivroDiarioLancamentoLike)),
    });

    const filename = nomeArquivoRelatorio(
      'Livro Diario',
      cliente.dominio_code,
      periodo.ano as number,
      periodo.mes as number,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err) {
    next(err);
  }
});
