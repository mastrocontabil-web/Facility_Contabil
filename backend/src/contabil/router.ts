import { Router } from 'express';
import multer from 'multer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mapPgrstError } from '../lib/pgrst.js';
import { badRequest, notFound } from '../lib/httpError.js';
import {
  exportarDominioQuerySchema,
  historicoPadraoCreateSchema,
  historicoPadraoUpdateSchema,
  importarBalanceteSchema,
  importarPlanoContasSchema,
  importarTransacoesSchema,
  lancamentoCreateSchema,
  lancamentoUpdateSchema,
  lancamentosListQuerySchema,
  modeloCreateSchema,
  modeloUpdateSchema,
  modelosListQuerySchema,
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
import { composeComplemento, type ComplementoModo } from '../dominio/complemento.js';
import {
  buildDominioFileFromLancamentos,
  ExportError,
  type ExportContabilLancamento,
} from '../dominio/exporter.js';

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
  'id, periodo_id, data, historico_codigo, historico_complemento, origem_transaction_id, ' +
  'created_at, updated_at, partidas:lancamento_partidas(id, plano_conta_id, tipo, valor_cents, ordem, ' +
  'plano_conta:plano_contas(codigo, nome))';
const AUDITORIA_TABLE = 'contabil_auditoria';
const MODELO_TABLE = 'lancamento_modelos';
const MODELO_PARTIDA_TABLE = 'lancamento_modelo_partidas';
const MODELO_COLS =
  'id, client_id, nome, historico_codigo, historico_complemento, ativo, created_at, updated_at, ' +
  'partidas:lancamento_modelo_partidas(id, plano_conta_id, tipo, valor_cents_padrao, ordem, ' +
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

type PeriodoRef = { id: string; ano: number; mes: number };

/**
 * Períodos de um cliente formam sempre um prefixo cronológico contíguo de
 * fechados (C10) — busca todos os períodos do cliente e filtra em JS (volume
 * sempre pequeno por cliente, e evita depender de filtro composto (ano,mes)
 * que o fakeSupabase não simula bem).
 */
async function periodoAnteriorAberto(
  supabase: SupabaseClient,
  clientId: string,
  ano: number,
  mes: number,
): Promise<PeriodoRef | null> {
  const { data, error } = await supabase
    .from(PERIODO_TABLE)
    .select('id, ano, mes, status')
    .eq('client_id', clientId);
  if (error) throw mapPgrstError(error, 'listar períodos do cliente');
  const anterior = (data ?? [])
    .filter((p) => p.status === 'aberto' && (p.ano < ano || (p.ano === ano && p.mes < mes)))
    .sort((a, b) => a.ano - b.ano || a.mes - b.mes);
  return anterior[0] ? { id: anterior[0].id, ano: anterior[0].ano, mes: anterior[0].mes } : null;
}

/** Espelho de periodoAnteriorAberto, na direção oposta (guarda-corpo da reabertura). */
async function periodoPosteriorFechado(
  supabase: SupabaseClient,
  clientId: string,
  ano: number,
  mes: number,
): Promise<PeriodoRef | null> {
  const { data, error } = await supabase
    .from(PERIODO_TABLE)
    .select('id, ano, mes, status')
    .eq('client_id', clientId);
  if (error) throw mapPgrstError(error, 'listar períodos do cliente');
  const posterior = (data ?? [])
    .filter((p) => p.status === 'fechado' && (p.ano > ano || (p.ano === ano && p.mes > mes)))
    .sort((a, b) => a.ano - b.ano || a.mes - b.mes);
  return posterior[0] ? { id: posterior[0].id, ano: posterior[0].ano, mes: posterior[0].mes } : null;
}

type AcaoAuditoria = 'fechado' | 'reaberto' | 'dominio_exportado';

async function registrarAuditoria(
  supabase: SupabaseClient,
  userId: string,
  periodoId: string,
  acao: AcaoAuditoria,
  detalhe: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from(AUDITORIA_TABLE)
    .insert({ owner_id: userId, periodo_id: periodoId, acao, detalhe });
  if (error) throw mapPgrstError(error, 'registrar evento de auditoria');
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
  origem_transaction_id: string | null;
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

type ModeloRow = {
  id: string;
  client_id: string;
  nome: string;
  historico_codigo: string | null;
  historico_complemento: string;
  ativo: boolean;
  created_at: string;
  updated_at: string;
  partidas: Array<{
    id: string;
    plano_conta_id: string;
    tipo: string;
    valor_cents_padrao: number | null;
    ordem: number;
    plano_conta: { codigo: string; nome: string } | { codigo: string; nome: string }[] | null;
  }> | null;
};

function normalizeModelo(row: ModeloRow) {
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
// Modelos de lançamento (C9) — molde reutilizável pra lançamento recorrente.
// Nunca mexe em período/saldo: é só dado, consumido pelo FRONTEND pra
// pré-preencher o formulário de "novo lançamento" (POST /lancamentos normal).
// --------------------------------------------------------------------------- #
contabilRouter.get('/modelos', async (req, res, next) => {
  try {
    const { client_id } = modelosListQuerySchema.parse(req.query);
    const { data, error } = await db(req)
      .from(MODELO_TABLE)
      .select(MODELO_COLS)
      .eq('client_id', client_id)
      .order('nome', { ascending: true });
    if (error) throw mapPgrstError(error, 'listar modelos de lançamento');
    res.json({ modelos: ((data ?? []) as unknown as ModeloRow[]).map(normalizeModelo) });
  } catch (err) {
    next(err);
  }
});

contabilRouter.post('/modelos', async (req, res, next) => {
  const supabase = db(req);
  const userId = req.auth!.userId;

  try {
    const dto = modeloCreateSchema.parse(req.body);

    const { data: client, error: cErr } = await supabase
      .from('clients')
      .select('id')
      .eq('id', dto.client_id)
      .maybeSingle();
    if (cErr) throw mapPgrstError(cErr, 'validar cliente');
    if (!client) throw notFound('Cliente não encontrado');

    await assertPartidasContasValidas(supabase, dto.client_id, dto.partidas);

    const { data: modelo, error: mErr } = await supabase
      .from(MODELO_TABLE)
      .insert({
        owner_id: userId,
        client_id: dto.client_id,
        nome: dto.nome,
        historico_codigo: dto.historico_codigo ?? null,
        historico_complemento: dto.historico_complemento,
      })
      .select('id')
      .single();
    if (mErr) throw mapPgrstError(mErr, 'criar modelo de lançamento');

    const partidasRows = dto.partidas.map((p, ordem) => ({
      owner_id: userId,
      modelo_id: modelo.id,
      plano_conta_id: p.plano_conta_id,
      tipo: p.tipo,
      valor_cents_padrao: p.valor_cents_padrao ?? null,
      ordem,
    }));
    const { error: pErr } = await supabase.from(MODELO_PARTIDA_TABLE).insert(partidasRows);
    if (pErr) throw mapPgrstError(pErr, 'gravar partidas do modelo');

    const { data: fresh, error: fErr } = await supabase
      .from(MODELO_TABLE)
      .select(MODELO_COLS)
      .eq('id', modelo.id)
      .single();
    if (fErr) throw mapPgrstError(fErr, 'reler modelo de lançamento');

    res.status(201).json({ modelo: normalizeModelo(fresh as unknown as ModeloRow) });
  } catch (err) {
    next(err);
  }
});

contabilRouter.patch('/modelos/:id', async (req, res, next) => {
  const supabase = db(req);
  const userId = req.auth!.userId;

  try {
    const dto = modeloUpdateSchema.parse(req.body);

    const { data: atual, error: aErr } = await supabase
      .from(MODELO_TABLE)
      .select('id, client_id')
      .eq('id', req.params.id)
      .maybeSingle();
    if (aErr) throw mapPgrstError(aErr, 'buscar modelo de lançamento');
    if (!atual) throw notFound('Modelo de lançamento não encontrado');

    await assertPartidasContasValidas(supabase, atual.client_id as string, dto.partidas);

    const { error: uErr } = await supabase
      .from(MODELO_TABLE)
      .update({
        nome: dto.nome,
        historico_codigo: dto.historico_codigo ?? null,
        historico_complemento: dto.historico_complemento,
        ...(dto.ativo !== undefined ? { ativo: dto.ativo } : {}),
      })
      .eq('id', req.params.id);
    if (uErr) throw mapPgrstError(uErr, 'atualizar modelo de lançamento');

    const { error: dErr } = await supabase
      .from(MODELO_PARTIDA_TABLE)
      .delete()
      .eq('modelo_id', req.params.id);
    if (dErr) throw mapPgrstError(dErr, 'limpar partidas antigas do modelo');

    const partidasRows = dto.partidas.map((p, ordem) => ({
      owner_id: userId,
      modelo_id: req.params.id,
      plano_conta_id: p.plano_conta_id,
      tipo: p.tipo,
      valor_cents_padrao: p.valor_cents_padrao ?? null,
      ordem,
    }));
    const { error: pErr } = await supabase.from(MODELO_PARTIDA_TABLE).insert(partidasRows);
    if (pErr) throw mapPgrstError(pErr, 'gravar partidas do modelo');

    const { data: fresh, error: fErr } = await supabase
      .from(MODELO_TABLE)
      .select(MODELO_COLS)
      .eq('id', req.params.id)
      .single();
    if (fErr) throw mapPgrstError(fErr, 'reler modelo de lançamento');

    res.json({ modelo: normalizeModelo(fresh as unknown as ModeloRow) });
  } catch (err) {
    next(err);
  }
});

contabilRouter.delete('/modelos/:id', async (req, res, next) => {
  try {
    const { error, count } = await db(req)
      .from(MODELO_TABLE)
      .delete({ count: 'exact' })
      .eq('id', req.params.id);
    if (error) throw mapPgrstError(error, 'excluir modelo de lançamento');
    if (!count) throw notFound('Modelo de lançamento não encontrado');
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

type ExportContabilLancamentoLike = {
  data: string;
  created_at: string;
  historico_codigo: string | null;
  historico_complemento: string;
  partidas: Array<{
    tipo: string;
    valor_cents: number;
    ordem: number;
    plano_conta: { codigo: string; nome: string } | null;
  }>;
};

/** Reduz um lançamento (já normalizado — embed desembrulhado) pro shape que
 * o exportador do Domínio espera. */
function toExportContabilLancamento(l: ExportContabilLancamentoLike): ExportContabilLancamento {
  return {
    data: l.data,
    created_at: l.created_at,
    historico_codigo: l.historico_codigo,
    historico_complemento: l.historico_complemento,
    partidas: l.partidas.map((p) => ({
      plano_conta_codigo: p.plano_conta?.codigo ?? '',
      tipo: p.tipo as 'D' | 'C',
      valor_cents: p.valor_cents,
      ordem: p.ordem,
    })),
  };
}

// --------------------------------------------------------------------------- #
// POST /periodos/:id/fechar  — fecha manualmente um período (sem Balancete).
// Guarda-corpo (C10): não fecha fora de ordem cronológica; registra o evento
// na trilha de auditoria.
// --------------------------------------------------------------------------- #
contabilRouter.post('/periodos/:id/fechar', async (req, res, next) => {
  try {
    const supabase = db(req);
    const userId = req.auth!.userId;

    const { data: periodo, error: perErr } = await supabase
      .from(PERIODO_TABLE)
      .select(PERIODO_COLS)
      .eq('id', req.params.id)
      .maybeSingle();
    if (perErr) throw mapPgrstError(perErr, 'buscar período');
    if (!periodo) throw notFound('Período não encontrado');
    if (periodo.status === 'fechado') throw badRequest('Esse período já está fechado.');

    const { count, error: cErr } = await supabase
      .from(LANC_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('periodo_id', req.params.id);
    if (cErr) throw mapPgrstError(cErr, 'verificar lançamentos do período');
    if (!count) throw badRequest('Esse período não tem nenhum lançamento — não há o que fechar.');

    const anterior = await periodoAnteriorAberto(
      supabase,
      periodo.client_id as string,
      periodo.ano as number,
      periodo.mes as number,
    );
    if (anterior) {
      throw badRequest(
        `Existe um período anterior (${anterior.mes}/${anterior.ano}) ainda aberto — feche os períodos em ordem cronológica antes deste.`,
      );
    }

    // SEMPRE antes de trocar o status: recomputeSaldosCascade é no-op se o
    // período já estiver fechado, então chamada DEPOIS nunca faria nada —
    // esse é o único jeito de garantir que o período fecha com o saldo em
    // dia (POST /lancamentos grava a partida e só depois chama o motor,
    // sem transação — se aquela chamada tiver falhado antes, é aqui que
    // isso se corrige, de graça, no único momento em que ainda dá tempo).
    await recomputeSaldosCascade(supabase, userId, req.params.id);

    const { data: fechado, error: upErr } = await supabase
      .from(PERIODO_TABLE)
      .update({ status: 'fechado', fechado_em: new Date().toISOString() })
      .eq('id', req.params.id)
      .select(PERIODO_COLS)
      .single();
    if (upErr) throw mapPgrstError(upErr, 'fechar período');

    await registrarAuditoria(supabase, userId, req.params.id, 'fechado', { qtd_lancamentos: count });

    res.json({ periodo: fechado });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// POST /periodos/:id/reabrir  — reabertura simples (C10): sem bloqueio mesmo
// se já exportado pro Domínio (fica registrado na trilha de auditoria); só
// bloqueia se isso quebraria a ordem cronológica dos fechamentos do cliente.
// --------------------------------------------------------------------------- #
contabilRouter.post('/periodos/:id/reabrir', async (req, res, next) => {
  try {
    const supabase = db(req);
    const userId = req.auth!.userId;

    const { data: periodo, error: perErr } = await supabase
      .from(PERIODO_TABLE)
      .select(PERIODO_COLS)
      .eq('id', req.params.id)
      .maybeSingle();
    if (perErr) throw mapPgrstError(perErr, 'buscar período');
    if (!periodo) throw notFound('Período não encontrado');
    if (periodo.status === 'aberto') throw badRequest('Esse período já está aberto.');

    const posterior = await periodoPosteriorFechado(
      supabase,
      periodo.client_id as string,
      periodo.ano as number,
      periodo.mes as number,
    );
    if (posterior) {
      throw badRequest(
        `Existe um período posterior (${posterior.mes}/${posterior.ano}) já fechado — reabra os períodos em ordem cronológica inversa a partir dele.`,
      );
    }

    const { data: reaberto, error: upErr } = await supabase
      .from(PERIODO_TABLE)
      .update({ status: 'aberto', fechado_em: null })
      .eq('id', req.params.id)
      .select(PERIODO_COLS)
      .single();
    if (upErr) throw mapPgrstError(upErr, 'reabrir período');

    await registrarAuditoria(supabase, userId, req.params.id, 'reaberto', {});

    res.json({ periodo: reaberto });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// GET /periodos/:id/diagnostico  — estado de saúde do período (C10): avisa
// proativamente os mesmos guarda-corpos de fechar/reabrir, e mostra a trilha
// de auditoria (mais recente primeiro).
// --------------------------------------------------------------------------- #
contabilRouter.get('/periodos/:id/diagnostico', async (req, res, next) => {
  try {
    const supabase = db(req);

    const { data: periodo, error: perErr } = await supabase
      .from(PERIODO_TABLE)
      .select(PERIODO_COLS)
      .eq('id', req.params.id)
      .maybeSingle();
    if (perErr) throw mapPgrstError(perErr, 'buscar período');
    if (!periodo) throw notFound('Período não encontrado');

    const { count, error: cErr } = await supabase
      .from(LANC_TABLE)
      .select('id', { count: 'exact', head: true })
      .eq('periodo_id', req.params.id);
    if (cErr) throw mapPgrstError(cErr, 'verificar lançamentos do período');

    const clientId = periodo.client_id as string;
    const ano = periodo.ano as number;
    const mes = periodo.mes as number;
    const periodoAnterior =
      periodo.status === 'aberto' ? await periodoAnteriorAberto(supabase, clientId, ano, mes) : null;
    const periodoPosterior =
      periodo.status === 'fechado' ? await periodoPosteriorFechado(supabase, clientId, ano, mes) : null;

    const { data: eventos, error: evErr } = await supabase
      .from(AUDITORIA_TABLE)
      .select('id, acao, detalhe, created_at')
      .eq('periodo_id', req.params.id)
      .order('created_at', { ascending: false });
    if (evErr) throw mapPgrstError(evErr, 'listar eventos de auditoria');

    res.json({
      periodo,
      qtd_lancamentos: count ?? 0,
      periodo_anterior_aberto: periodoAnterior,
      periodo_posterior_fechado: periodoPosterior,
      eventos: eventos ?? [],
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// GET /relatorios/exportar-dominio?periodo_id=&lote_numero=  — .txt Leiaute
// Domínio a partir dos lançamentos do Contábil (partida múltipla decomposta
// em pares elementares — ver docs/leiaute-dominio.md). Só período fechado.
// --------------------------------------------------------------------------- #
contabilRouter.get('/relatorios/exportar-dominio', async (req, res, next) => {
  try {
    const { periodo_id, lote_numero } = exportarDominioQuerySchema.parse(req.query);
    const supabase = db(req);

    const { data: periodo, error: perErr } = await supabase
      .from(PERIODO_TABLE)
      .select('client_id, ano, mes, status')
      .eq('id', periodo_id)
      .maybeSingle();
    if (perErr) throw mapPgrstError(perErr, 'buscar período pra exportar');
    if (!periodo) throw notFound('Período não encontrado');
    if (periodo.status !== 'fechado') {
      throw badRequest('Período precisa estar fechado pra exportar — feche o período antes.');
    }

    const { data: lancs, error: lancsErr } = await supabase
      .from(LANC_TABLE)
      .select(LANC_COLS)
      .eq('periodo_id', periodo_id)
      .order('data', { ascending: true })
      .order('created_at', { ascending: true })
      .order('ordem', { ascending: true, foreignTable: PARTIDA_TABLE });
    if (lancsErr) throw mapPgrstError(lancsErr, 'ler lançamentos pra exportar');

    const cliente = await buscarClientePraRelatorio(supabase, periodo.client_id as string);

    const ano = periodo.ano as number;
    const mes = periodo.mes as number;
    const periodo_inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const periodo_fim = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;

    let out;
    try {
      out = buildDominioFileFromLancamentos({
        empresa_dominio: cliente.dominio_code,
        cnpj: cliente.cnpj,
        periodo_inicio,
        periodo_fim,
        lote_numero,
        lancamentos: ((lancs ?? []) as unknown as LancamentoRow[])
          .map(normalizeLancamento)
          .map((l) => toExportContabilLancamento(l as unknown as ExportContabilLancamentoLike)),
      });
    } catch (e) {
      if (e instanceof ExportError) throw badRequest(e.message, e.detalhes);
      throw e;
    }

    await registrarAuditoria(supabase, req.auth!.userId, periodo_id, 'dominio_exportado', {
      lote_numero,
      qtd_lancamentos: out.qtd_lancamentos,
      sha256: out.sha256,
    });

    res.setHeader('Content-Type', 'text/plain; charset=iso-8859-1');
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.setHeader('X-Export-Sha256', out.sha256);
    res.setHeader('X-Export-Linhas', String(out.linhas));
    res.send(out.content);
  } catch (err) {
    next(err);
  }
});

type StatementInfo = { id: string; banco_conta_contabil: string | null; complemento_modo: string };
type TransacaoImportavel = {
  id: string;
  statement_id: string;
  ordem: number;
  data: string;
  descricao_raw: string;
  valor: string; // numeric vem como string do PostgREST
  direction: 'entrada' | 'saida';
  conta_contabil: string | null;
  hist_code: string | null;
  hist_complemento: string | null;
};

function ultimoDiaDoMes(ano: number, mes: number): string {
  const dia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// --------------------------------------------------------------------------- #
// POST /lancamentos/importar-transacoes  — traz transações já revisadas do
// módulo Importação pro Contábil (D banco / C contrapartida, mesma tabela
// de docs/leiaute-dominio.md). Todo o lote é sempre o mesmo período (ano/mes
// pedido) — se já fechado, nada é tocado. Transação que não resolve conta
// (ou já foi importada, ou tá ignorado=true) é pulada, não trava o lote —
// não dá pra gravar meia-partida (lancamento_partidas.plano_conta_id not null,
// diferente de saldos_contabeis do C2).
// --------------------------------------------------------------------------- #
contabilRouter.post('/lancamentos/importar-transacoes', async (req, res, next) => {
  try {
    const supabase = db(req);
    const userId = req.auth!.userId;
    const { client_id, ano, mes } = importarTransacoesSchema.parse(req.body);

    const { data: client, error: cErr } = await supabase
      .from('clients')
      .select('id')
      .eq('id', client_id)
      .maybeSingle();
    if (cErr) throw mapPgrstError(cErr, 'validar cliente');
    if (!client) throw notFound('Cliente não encontrado');

    const periodo = await resolvePeriodoAberto(supabase, userId, client_id, ano, mes);

    const { data: statementsRaw, error: stErr } = await supabase
      .from('statements')
      .select('id, banco_conta_contabil, complemento_modo')
      .eq('client_id', client_id);
    if (stErr) throw mapPgrstError(stErr, 'ler importações do cliente');
    const statements = (statementsRaw ?? []) as StatementInfo[];
    const statementPorId = new Map(statements.map((s) => [s.id, s]));
    const statementIds = statements.map((s) => s.id);

    const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const fim = ultimoDiaDoMes(ano, mes);

    let transacoes: TransacaoImportavel[] = [];
    if (statementIds.length > 0) {
      const { data: txRaw, error: tErr } = await supabase
        .from('transactions')
        .select(
          'id, statement_id, ordem, data, descricao_raw, valor, direction, conta_contabil, ' +
            'hist_code, hist_complemento',
        )
        .in('statement_id', statementIds)
        .gte('data', inicio)
        .lte('data', fim)
        .eq('ignorado', false)
        .order('data', { ascending: true })
        .order('ordem', { ascending: true });
      if (tErr) throw mapPgrstError(tErr, 'ler transações do módulo Importação');
      transacoes = (txRaw ?? []) as unknown as TransacaoImportavel[];
    }

    if (transacoes.length === 0) {
      res.json({ periodo, importados: 0, ignorados: 0, warnings: [] });
      return;
    }

    const idsTransacoes = transacoes.map((t) => t.id);
    const { data: jaImportadasRaw, error: jiErr } = await supabase
      .from(LANC_TABLE)
      .select('origem_transaction_id')
      .in('origem_transaction_id', idsTransacoes);
    if (jiErr) throw mapPgrstError(jiErr, 'verificar transações já importadas');
    const jaImportadas = new Set(
      (jaImportadasRaw ?? []).map((l) => l.origem_transaction_id as string),
    );

    const { data: contasRaw, error: pcErr } = await supabase
      .from(PLANO_TABLE)
      .select('id, codigo, tipo, ativo')
      .eq('client_id', client_id);
    if (pcErr) throw mapPgrstError(pcErr, 'ler plano de contas do cliente');
    const contaPorCodigo = new Map((contasRaw ?? []).map((c) => [c.codigo as string, c]));

    const { data: histRaw, error: hErr } = await supabase.from(HIST_TABLE).select('codigo');
    if (hErr) throw mapPgrstError(hErr, 'ler históricos padrão');
    const codigosHistoricos = new Set((histRaw ?? []).map((h) => h.codigo as string));

    function resolverConta(codigo: string | null): { id: string } | null {
      if (!codigo) return null;
      const c = contaPorCodigo.get(codigo);
      if (!c || c.tipo !== 'A' || !c.ativo) return null;
      return { id: c.id as string };
    }

    let importados = 0;
    let ignorados = 0;
    const warnings: string[] = [];

    for (const t of transacoes) {
      if (jaImportadas.has(t.id)) continue; // já importada — não conta nem como aviso

      const rotulo = `${t.data} "${t.descricao_raw}"`;

      if (!t.conta_contabil) {
        ignorados++;
        warnings.push(`${rotulo} — sem conta contábil classificada.`);
        continue;
      }
      const valorCents = Math.round(Number(t.valor) * 100);
      if (!(valorCents > 0)) {
        ignorados++;
        warnings.push(`${rotulo} — valor zero ou inválido.`);
        continue;
      }

      const statement = statementPorId.get(t.statement_id);
      const contaBanco = resolverConta(statement?.banco_conta_contabil ?? null);
      if (!contaBanco) {
        ignorados++;
        warnings.push(
          `${rotulo} — conta do banco (${statement?.banco_conta_contabil ?? '?'}) não encontrada/ativa no plano de contas.`,
        );
        continue;
      }
      const contaContrapartida = resolverConta(t.conta_contabil);
      if (!contaContrapartida) {
        ignorados++;
        warnings.push(`${rotulo} — conta ${t.conta_contabil} não encontrada/ativa no plano de contas.`);
        continue;
      }

      // entrada -> D banco / C contrapartida; saída -> D contrapartida / C banco
      // (mesma tabela de docs/leiaute-dominio.md, não uma regra nova).
      const partidas =
        t.direction === 'entrada'
          ? [
              { plano_conta_id: contaBanco.id, tipo: 'D' as const, valor_cents: valorCents },
              { plano_conta_id: contaContrapartida.id, tipo: 'C' as const, valor_cents: valorCents },
            ]
          : [
              { plano_conta_id: contaContrapartida.id, tipo: 'D' as const, valor_cents: valorCents },
              { plano_conta_id: contaBanco.id, tipo: 'C' as const, valor_cents: valorCents },
            ];

      try {
        await assertPartidasContasValidas(supabase, client_id, partidas);
      } catch {
        ignorados++;
        warnings.push(`${rotulo} — conta inválida pro lançamento.`);
        continue;
      }

      const historicoCodigo = t.hist_code && codigosHistoricos.has(t.hist_code) ? t.hist_code : null;
      const complemento = composeComplemento(
        (statement?.complemento_modo ?? 'extrato') as ComplementoModo,
        t.descricao_raw,
        t.hist_complemento ?? '',
        '',
      );

      const { data: lancamento, error: lErr } = await supabase
        .from(LANC_TABLE)
        .insert({
          owner_id: userId,
          periodo_id: periodo.id,
          data: t.data,
          historico_codigo: historicoCodigo,
          historico_complemento: complemento || t.descricao_raw.trim() || 'Importado do módulo Importação',
          origem_transaction_id: t.id,
        })
        .select('id')
        .single();
      if (lErr) throw mapPgrstError(lErr, 'criar lançamento importado');

      const partidasRows = partidas.map((p, ordem) => ({
        owner_id: userId,
        lancamento_id: lancamento.id,
        plano_conta_id: p.plano_conta_id,
        tipo: p.tipo,
        valor_cents: p.valor_cents,
        ordem,
      }));
      const { error: pErr } = await supabase.from(PARTIDA_TABLE).insert(partidasRows);
      if (pErr) throw mapPgrstError(pErr, 'gravar partidas do lançamento importado');

      importados++;
    }

    if (importados > 0) {
      await recomputeSaldosCascade(supabase, userId, periodo.id);
    }

    res.json({ periodo, importados, ignorados, warnings });
  } catch (err) {
    next(err);
  }
});
