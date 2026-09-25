import { Router } from 'express';
import multer from 'multer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LIMITE_LINHAS, lerTodas, mapPgrstError } from '../lib/pgrst.js';
import { badRequest, notFound } from '../lib/httpError.js';
import { logger } from '../lib/logger.js';
import {
  bulkUpdateClassificacaoSchema,
  bulkUpdateTransactionsSchema,
  classificarStatementSchema,
  createStatementExcelSchema,
  createStatementSchema,
  lerPlanilhaSchema,
  listStatementsQuerySchema,
  updateStatementSchema,
  type CreateStatement,
  type ExcelMapeamento,
} from './schema.js';
import { callParser, callParserExcel, lerPlanilha, type ParseResult } from './parserClient.js';
import { classify, memoryKey, type Rule } from '../rules/match.js';
import { buildDominioFile, ExportError, type ExportLancamento } from '../dominio/exporter.js';
import type { ComplementoModo } from '../dominio/complemento.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

const BUCKET = 'statements';
const STMT_COLS =
  'id, client_id, arquivo_nome, storage_path, formato, banco_id, conta_ofx, period_start, period_end, banco_conta_contabil, hist_code_entrada, hist_code_saida, lote_numero, saldo_inicial, saldo_final, complemento_modo, status, origem_modulo, excel_mapeamento, erro_msg, totais, created_at, updated_at';
const TXN_COLS =
  'id, ordem, data, descricao_raw, valor, direction, conta_contabil, hist_code, hist_complemento, cod_complemento_hist, ignorado, regra_id, origem_preenchimento, classificacao_id';

/** Soma líquida (em centavos) de TODOS os lançamentos — inativados inclusos. */
function movimentoCents(txns: Array<{ direction: string; valor: string | number }>): number {
  return txns.reduce((acc, t) => {
    const v = Math.round(Number(t.valor) * 100);
    return acc + (t.direction === 'entrada' ? v : -v);
  }, 0);
}

export const statementsRouter = Router();

function db(req: { supabase?: SupabaseClient }): SupabaseClient {
  if (!req.supabase) throw new Error('supabase client ausente');
  return req.supabase;
}

const EXT_TO_FORMAT: Record<string, string> = {
  pdf: 'pdf',
  ofx: 'ofx',
  qfx: 'ofx',
  csv: 'csv',
  txt: 'csv',
  xls: 'xls',
  xlsx: 'xlsx',
};

function detectFormat(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_FORMAT[ext] ?? null;
}

/** Nova importação Excel: só planilha (.xlsm é .xlsx com macro — lido igual). */
function formatoPlanilha(filename: string): 'xls' | 'xlsx' | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'xls') return 'xls';
  if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx';
  return null;
}

function sanitizeName(name: string): string {
  const parts = name.split('.');
  const ext = parts.length > 1 ? `.${parts.pop()!.toLowerCase()}` : '';
  const base = parts
    .join('.')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80);
  return `${base || 'extrato'}${ext}`;
}

/** Por que o resultado do parser não pode ser gravado — null quando pode. */
function motivoRecusa(parseErr: unknown, parsed: ParseResult | null): string | null {
  if (parseErr) return parseErr instanceof Error ? parseErr.message : 'falha ao ler o extrato';
  if (!parsed?.transactions.length) return parsed?.warnings[0] ?? 'Nenhum lançamento encontrado no extrato';
  if (parsed.transactions.length > LIMITE_LINHAS) {
    return (
      `O extrato tem ${parsed.transactions.length.toLocaleString('pt-BR')} lançamentos — o limite é ` +
      `${LIMITE_LINHAS.toLocaleString('pt-BR')}. Divida em períodos menores.`
    );
  }
  return null;
}

function buildTotais(txns: ParseResult['transactions']) {
  const entradas = txns.filter((t) => t.direction === 'entrada');
  const saidas = txns.filter((t) => t.direction === 'saida');
  const sum = (arr: typeof txns) => arr.reduce((a, t) => a + t.amount_cents, 0);
  return {
    qtd: txns.length,
    entradas: { n: entradas.length, valor_cents: sum(entradas) },
    saidas: { n: saidas.length, valor_cents: sum(saidas) },
  };
}

/**
 * Classifica os lançamentos lidos (memória do cliente), grava na `transactions`
 * e finaliza o `statement` (período, totais, saldo_final, status final dado).
 * Usado pela importação nova, pela reimportação e pelo módulo Classificação.
 */
async function gravarLancamentos(
  supabase: SupabaseClient,
  p: {
    ownerId: string;
    statementId: string;
    clientId: string;
    histEntrada: string;
    histSaida: string;
    saldoInicial: number;
    parsed: ParseResult;
    arquivoNome: string;
    formato: string;
    storagePath: string | null;
    statusFinal: 'revisao' | 'classificacao';
  },
) {
  // memória só ajuda a pré-preencher: se a leitura falhar, grava sem ela
  let rules: Rule[] = [];
  try {
    rules = await lerTodas<Rule>(
      (de, ate) =>
        supabase
          .from('mapping_rules')
          .select(
            'id, direction, match_type, pattern, conta_contabil, hist_code, hist_complemento_template, prioridade, hits, last_used_at',
          )
          .eq('client_id', p.clientId)
          .eq('ativo', true)
          .order('id')
          .range(de, ate),
      'ler as memórias do cliente',
      { passouDoLimite: 'avisar' },
    );
  } catch (err) {
    logger.warn({ err }, 'falha ao ler memórias (segue sem pré-preencher)');
  }

  const rows = p.parsed.transactions.map((t, i) => {
    const m = classify(rules, { direction: t.direction, description: t.description });
    const histPadrao = t.direction === 'entrada' ? p.histEntrada : p.histSaida;
    return {
      owner_id: p.ownerId,
      statement_id: p.statementId,
      ordem: i,
      data: t.date,
      descricao_raw: t.description,
      valor: (t.amount_cents / 100).toFixed(2),
      direction: t.direction,
      conta_contabil: m?.rule.conta_contabil ?? null,
      hist_code: m?.rule.hist_code ?? histPadrao,
      hist_complemento: m?.rule.hist_complemento_template ?? '',
      cod_complemento_hist: '0',
      regra_id: m?.rule.id ?? null,
      origem_preenchimento: m?.origem ?? 'vazio',
      raw: t.raw ?? {},
    };
  });
  const { error: tErr } = await supabase.from('transactions').insert(rows);
  if (tErr) throw mapPgrstError(tErr, 'gravar lançamentos');

  const totais = buildTotais(p.parsed.transactions);
  const saldoFinal =
    (Math.round(p.saldoInicial * 100) + totais.entradas.valor_cents - totais.saidas.valor_cents) /
    100;
  const { data: statement, error: uErr } = await supabase
    .from('statements')
    .update({
      status: p.statusFinal,
      erro_msg: null,
      arquivo_nome: p.arquivoNome,
      formato: p.formato,
      storage_path: p.storagePath,
      period_start: p.parsed.period_start,
      period_end: p.parsed.period_end,
      banco_id: p.parsed.bank_id,
      conta_ofx: p.parsed.account_id,
      totais,
      saldo_final: saldoFinal,
    })
    .eq('id', p.statementId)
    .select(STMT_COLS)
    .single();
  if (uErr) throw mapPgrstError(uErr, 'finalizar importação');

  const transactions = await lerTodas(
    (de, ate) =>
      supabase.from('transactions').select(TXN_COLS).eq('statement_id', p.statementId).order('ordem').range(de, ate),
    'reler os lançamentos',
  );

  return { statement, transactions };
}

/**
 * Importação nova no módulo Importação (extrato lido automaticamente ou
 * planilha Excel com as colunas escolhidas): cria o extrato, guarda o arquivo,
 * lê com `ler` e grava os lançamentos. Se a leitura falha ou não serve, o
 * extrato fica com status 'erro' (aparece no Histórico) e o erro sobe.
 */
async function novaImportacao(
  supabase: SupabaseClient,
  p: {
    userId: string;
    file: Express.Multer.File;
    dto: Omit<CreateStatement, 'pdf_password'>;
    formato: string;
    ler: () => Promise<ParseResult>;
    /** colunas a mais no insert do extrato (ex.: excel_mapeamento) */
    extras?: Record<string, unknown>;
  },
) {
  const { userId, file, dto, formato } = p;

  // cliente existe / é do usuário
  const { data: client, error: cErr } = await supabase
    .from('clients')
    .select('id, saldo_inicial')
    .eq('id', dto.client_id)
    .maybeSingle();
  if (cErr) throw mapPgrstError(cErr, 'validar cliente');
  if (!client) throw notFound('Cliente não encontrado');

  // Só o que o operador informou: digitado na importação, senão o do cadastro.
  // Não encadeia do saldo final do extrato anterior — isso trazia saldo de
  // outro mês/conta sem o operador perceber.
  const saldoInicial = dto.saldo_inicial ?? Number(client.saldo_inicial ?? 0);

  // cria o statement (parsing)
  const { data: stmt, error: sErr } = await supabase
    .from('statements')
    .insert({
      owner_id: userId,
      client_id: dto.client_id,
      arquivo_nome: file.originalname,
      formato,
      banco_conta_contabil: dto.banco_conta_contabil,
      hist_code_entrada: dto.hist_code_entrada,
      hist_code_saida: dto.hist_code_saida,
      lote_numero: dto.lote_numero,
      saldo_inicial: saldoInicial,
      status: 'parsing',
      ...p.extras,
    })
    .select('id')
    .single();
  if (sErr) throw mapPgrstError(sErr, 'criar importação');
  const statementId = stmt.id as string;

  // upload no storage
  const path = `${userId}/${statementId}/${sanitizeName(file.originalname)}`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: true });
  if (upErr) {
    logger.warn({ upErr }, 'falha ao subir arquivo no storage (segue mesmo assim)');
  } else {
    await supabase.from('statements').update({ storage_path: path }).eq('id', statementId);
  }

  // parser
  let parsed: ParseResult | null = null;
  let parseErr: unknown = null;
  try {
    parsed = await p.ler();
  } catch (e) {
    parseErr = e;
  }

  const recusa = motivoRecusa(parseErr, parsed);
  if (recusa || !parsed) {
    const msg = recusa ?? 'falha ao ler o extrato';
    await supabase.from('statements').update({ status: 'erro', erro_msg: msg }).eq('id', statementId);
    throw parseErr ?? badRequest(msg, { warnings: parsed?.warnings ?? [] });
  }

  const { statement, transactions } = await gravarLancamentos(supabase, {
    ownerId: userId,
    statementId,
    clientId: dto.client_id,
    histEntrada: dto.hist_code_entrada,
    histSaida: dto.hist_code_saida,
    saldoInicial,
    parsed,
    arquivoNome: file.originalname,
    formato,
    storagePath: upErr ? null : path,
    statusFinal: 'revisao',
  });

  return { statement, transactions, warnings: parsed.warnings };
}

/** O arquivo do upload no formato que o parserClient espera. */
function arquivo(file: Express.Multer.File) {
  return { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype };
}

// --------------------------------------------------------------------------- #
// POST /  — upload + parse
// --------------------------------------------------------------------------- #
statementsRouter.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw badRequest('Arquivo do extrato é obrigatório (campo "file")');
    const dto = createStatementSchema.parse(req.body);

    const formato = detectFormat(req.file.originalname);
    if (!formato) {
      throw badRequest('Formato não reconhecido — use PDF, OFX, CSV, XLS ou XLSX');
    }

    const file = req.file;
    const out = await novaImportacao(db(req), {
      userId: req.auth!.userId,
      file,
      dto,
      formato,
      ler: () => callParser(arquivo(file), { pdfPassword: dto.pdf_password }),
    });
    res.status(201).json(out);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// Nova importação Excel — planilha própria do cliente (controle interno), com o
// operador dizendo qual coluna é Data, Valor e Histórico. Separada da leitura
// automática: nada de adivinhar layout. Valor negativo = saída, positivo = entrada.
// --------------------------------------------------------------------------- #

/** Colunas da última importação Excel do cliente — a próxima planilha abre com elas. */
async function mapeamentoAnterior(supabase: SupabaseClient, clientId: string): Promise<ExcelMapeamento | null> {
  const { data, error } = await supabase
    .from('statements')
    .select('excel_mapeamento')
    .eq('client_id', clientId)
    .not('excel_mapeamento', 'is', null)
    .neq('status', 'erro')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  // só ajuda a pré-preencher: se a leitura falhar, a tela abre sem ela
  if (error) {
    logger.warn({ err: error }, 'falha ao ler a última importação Excel do cliente (segue sem)');
    return null;
  }
  return (data?.excel_mapeamento as ExcelMapeamento | null | undefined) ?? null;
}

// POST /excel/planilha — a aba como grade, pra escolher as colunas (não grava nada)
statementsRouter.post('/excel/planilha', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw badRequest('Arquivo da planilha é obrigatório (campo "file")');
    const dto = lerPlanilhaSchema.parse(req.body);
    if (!formatoPlanilha(req.file.originalname)) {
      throw badRequest('Envie uma planilha Excel (.xls ou .xlsx)');
    }

    const anterior = dto.client_id ? await mapeamentoAnterior(db(req), dto.client_id) : null;
    // sem aba escolhida: a da última importação do cliente (o parser volta pra
    // aba ativa se essa não existir na planilha nova)
    const planilha = await lerPlanilha(arquivo(req.file), dto.aba ?? anterior?.aba);
    res.json({ planilha, mapeamento_anterior: anterior });
  } catch (err) {
    next(err);
  }
});

// POST /excel — importa pelas colunas escolhidas e segue o fluxo normal (Revisão)
statementsRouter.post('/excel', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw badRequest('Arquivo da planilha é obrigatório (campo "file")');
    const dto = createStatementExcelSchema.parse(req.body);
    const formato = formatoPlanilha(req.file.originalname);
    if (!formato) throw badRequest('Envie uma planilha Excel (.xls ou .xlsx)');

    const file = req.file;
    const out = await novaImportacao(db(req), {
      userId: req.auth!.userId,
      file,
      dto,
      formato,
      ler: () => callParserExcel(arquivo(file), dto.mapeamento),
      extras: { excel_mapeamento: dto.mapeamento },
    });
    res.status(201).json(out);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// POST /classificar  — upload + parse, direto pro módulo Classificação
// (sem conta do banco / histórico — isso só é definido quando "puxado" pra
// Importação). Mesma tabela `statements`, origem_modulo='classificacao'.
// --------------------------------------------------------------------------- #
statementsRouter.post('/classificar', upload.single('file'), async (req, res, next) => {
  const supabase = db(req);
  const userId = req.auth!.userId;
  let statementId: string | null = null;

  try {
    if (!req.file) throw badRequest('Arquivo do extrato é obrigatório (campo "file")');
    const dto = classificarStatementSchema.parse(req.body);

    const formato = detectFormat(req.file.originalname);
    if (!formato) {
      throw badRequest('Formato não reconhecido — use PDF, OFX, CSV, XLS ou XLSX');
    }

    const { data: client, error: cErr } = await supabase
      .from('clients')
      .select('id, saldo_inicial')
      .eq('id', dto.client_id)
      .maybeSingle();
    if (cErr) throw mapPgrstError(cErr, 'validar cliente');
    if (!client) throw notFound('Cliente não encontrado');

    const saldoInicial = Number(client.saldo_inicial ?? 0);

    const { data: stmt, error: sErr } = await supabase
      .from('statements')
      .insert({
        owner_id: userId,
        client_id: dto.client_id,
        arquivo_nome: req.file.originalname,
        formato,
        saldo_inicial: saldoInicial,
        status: 'parsing',
        origem_modulo: 'classificacao',
      })
      .select('id')
      .single();
    if (sErr) throw mapPgrstError(sErr, 'criar importação');
    statementId = stmt.id as string;

    const path = `${userId}/${statementId}/${sanitizeName(req.file.originalname)}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (upErr) {
      logger.warn({ upErr }, 'falha ao subir arquivo no storage (segue mesmo assim)');
    } else {
      await supabase.from('statements').update({ storage_path: path }).eq('id', statementId);
    }

    let parsed: ParseResult | null = null;
    let parseErr: unknown = null;
    try {
      parsed = await callParser(
        { buffer: req.file.buffer, originalname: req.file.originalname, mimetype: req.file.mimetype },
        { pdfPassword: dto.pdf_password },
      );
    } catch (e) {
      parseErr = e;
    }

    const recusa = motivoRecusa(parseErr, parsed);
    if (recusa || !parsed) {
      const msg = recusa ?? 'falha ao ler o extrato';
      await supabase.from('statements').update({ status: 'erro', erro_msg: msg }).eq('id', statementId);
      next(parseErr ?? badRequest(msg, { warnings: parsed?.warnings ?? [] }));
      return;
    }

    const { statement, transactions } = await gravarLancamentos(supabase, {
      ownerId: userId,
      statementId,
      clientId: dto.client_id,
      histEntrada: '138',
      histSaida: '186',
      saldoInicial,
      parsed,
      arquivoNome: req.file.originalname,
      formato,
      storagePath: upErr ? null : path,
      statusFinal: 'classificacao',
    });

    res.status(201).json({ statement, transactions, warnings: parsed.warnings });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// POST /:id/reimport  — troca o arquivo de uma importação, mantém o resto
// --------------------------------------------------------------------------- #
statementsRouter.post('/:id/reimport', upload.single('file'), async (req, res, next) => {
  const supabase = db(req);
  const userId = req.auth!.userId;
  const statementId = req.params.id as string;

  try {
    if (!req.file) throw badRequest('Arquivo do extrato é obrigatório (campo "file")');

    const formato = detectFormat(req.file.originalname);
    if (!formato) {
      throw badRequest('Formato não reconhecido — use PDF, OFX, CSV, XLS ou XLSX');
    }

    const { data: stmt, error: sErr } = await supabase
      .from('statements')
      .select('id, client_id, hist_code_entrada, hist_code_saida, saldo_inicial, status, excel_mapeamento')
      .eq('id', statementId)
      .maybeSingle();
    if (sErr) throw mapPgrstError(sErr, 'buscar importação');
    if (!stmt) throw notFound('Importação não encontrada');
    // A leitura automática não sabe as colunas escolhidas na mão — numa planilha
    // de controle do cliente ela adivinharia errado sem avisar.
    if (stmt.excel_mapeamento) {
      throw badRequest(
        'Essa importação veio de uma planilha Excel com as colunas escolhidas na mão — ' +
          'para trocar a planilha, faça uma nova importação Excel.',
      );
    }
    // Reimportar não "adianta" o fluxo: se ainda está no módulo Classificação,
    // continua lá; só quem já foi puxado pra Importação (revisao) permanece assim.
    const statusFinal = stmt.status === 'classificacao' ? 'classificacao' : 'revisao';

    const path = `${userId}/${statementId}/${sanitizeName(req.file.originalname)}`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (upErr) logger.warn({ upErr }, 'falha ao subir arquivo no storage (segue mesmo assim)');

    let parsed: ParseResult | null = null;
    let parseErr: unknown = null;
    try {
      parsed = await callParser(
        { buffer: req.file.buffer, originalname: req.file.originalname, mimetype: req.file.mimetype },
        { pdfPassword: typeof req.body?.pdf_password === 'string' ? req.body.pdf_password : undefined },
      );
    } catch (e) {
      parseErr = e;
    }

    const recusa = motivoRecusa(parseErr, parsed);
    if (recusa || !parsed) {
      const msg = recusa ?? 'falha ao ler o extrato';
      await supabase.from('statements').update({ status: 'erro', erro_msg: msg }).eq('id', statementId);
      next(parseErr ?? badRequest(msg, { warnings: parsed?.warnings ?? [] }));
      return;
    }

    // fora com os lançamentos antigos
    const { error: dErr } = await supabase
      .from('transactions')
      .delete()
      .eq('statement_id', statementId);
    if (dErr) throw mapPgrstError(dErr, 'limpar lançamentos antigos');

    const { statement, transactions } = await gravarLancamentos(supabase, {
      ownerId: userId,
      statementId,
      clientId: stmt.client_id,
      histEntrada: stmt.hist_code_entrada,
      histSaida: stmt.hist_code_saida,
      saldoInicial: Number(stmt.saldo_inicial ?? 0),
      parsed,
      arquivoNome: req.file.originalname,
      formato,
      storagePath: upErr ? null : path,
      statusFinal,
    });

    res.json({ statement, transactions, warnings: parsed.warnings });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// GET /  — lista
// --------------------------------------------------------------------------- #
statementsRouter.get('/', async (req, res, next) => {
  try {
    const { client_id, status, origem_modulo, limit } = listStatementsQuerySchema.parse(req.query);
    let q = db(req)
      .from('statements')
      .select(`${STMT_COLS}, client:clients(razao_social, cnpj, dominio_code)`)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (client_id) q = q.eq('client_id', client_id);
    if (status) q = q.eq('status', status);
    if (origem_modulo) q = q.eq('origem_modulo', origem_modulo);
    const { data, error } = await q;
    if (error) throw mapPgrstError(error, 'listar importações');
    res.json({ statements: data ?? [] });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// GET /:id  — statement + transações
// --------------------------------------------------------------------------- #
statementsRouter.get('/:id', async (req, res, next) => {
  try {
    const supabase = db(req);
    const { data: stmt, error } = await supabase
      .from('statements')
      .select(`${STMT_COLS}, client:clients(id, razao_social, cnpj, dominio_code, conta_width)`)
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw mapPgrstError(error, 'buscar importação');
    if (!stmt) throw notFound('Importação não encontrada');

    const txns = await lerTodas(
      (de, ate) =>
        supabase.from('transactions').select(TXN_COLS).eq('statement_id', req.params.id).order('ordem').range(de, ate),
      'buscar lançamentos',
    );

    res.json({ statement: stmt, transactions: txns });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// POST /:id/export  — gera o arquivo Domínio e devolve pra download
// --------------------------------------------------------------------------- #
const EXPORT_BUCKET = 'exports';

statementsRouter.post('/:id/export', async (req, res, next) => {
  try {
    const supabase = db(req);
    const userId = req.auth!.userId;
    const statementId = req.params.id;

    const { data: stmt, error } = await supabase
      .from('statements')
      .select(`${STMT_COLS}, client:clients(dominio_code, cnpj)`)
      .eq('id', statementId)
      .maybeSingle();
    if (error) throw mapPgrstError(error, 'buscar importação');
    if (!stmt) throw notFound('Importação não encontrada');
    const clientRaw = Array.isArray(stmt.client) ? stmt.client[0] : stmt.client;
    const client = clientRaw as { dominio_code: string; cnpj: string } | null | undefined;
    if (!client) throw badRequest('Cliente da importação não encontrado.');

    const txns = await lerTodas(
      (de, ate) =>
        supabase
          .from('transactions')
          .select(
            'ordem, data, direction, valor, conta_contabil, hist_code, descricao_raw, hist_complemento, ignorado, classificacao:classificacoes(nome)',
          )
          .eq('statement_id', statementId)
          .order('ordem')
          .range(de, ate),
      'buscar lançamentos',
    );

    const ativos = txns.filter((t) => !t.ignorado);
    if (!ativos.length) throw badRequest('Nenhum lançamento ativo para exportar.');

    const pendentes = ativos.filter(
      (t) => !String(t.conta_contabil ?? '').trim() || !String(t.hist_code ?? '').trim(),
    );
    if (pendentes.length) {
      throw badRequest(
        `${pendentes.length} lançamento(s) ainda sem conta contábil ou código de histórico.`,
        { ordens: pendentes.map((t) => t.ordem) },
      );
    }

    const datas = ativos.map((t) => t.data).sort();
    const lancamentos: ExportLancamento[] = ativos.map((t) => {
      const classifRaw = Array.isArray(t.classificacao) ? t.classificacao[0] : t.classificacao;
      const classif = classifRaw as { nome: string } | null | undefined;
      return {
        data: t.data,
        ordem: t.ordem,
        direction: t.direction as 'entrada' | 'saida',
        valor_cents: Math.round(Number(t.valor) * 100),
        conta_contabil: String(t.conta_contabil ?? ''),
        hist_code: String(t.hist_code ?? ''),
        descricao_raw: t.descricao_raw ?? '',
        hist_complemento: t.hist_complemento ?? '',
        classificacao_nome: classif?.nome ?? '',
      };
    });

    let out;
    try {
      out = buildDominioFile({
        empresa_dominio: client.dominio_code,
        cnpj: client.cnpj,
        periodo_inicio: stmt.period_start ?? datas[0],
        periodo_fim: stmt.period_end ?? datas[datas.length - 1],
        lote_numero: stmt.lote_numero ?? 1,
        conta_banco: stmt.banco_conta_contabil ?? '',
        complemento_modo: (stmt.complemento_modo ?? 'extrato') as ComplementoModo,
        lancamentos,
      });
    } catch (e) {
      if (e instanceof ExportError) throw badRequest(e.message, e.detalhes);
      throw e;
    }

    // guarda no bucket + registra (best-effort no storage)
    const path = `${userId}/${statementId}/${out.filename}`;
    const up = await supabase.storage
      .from(EXPORT_BUCKET)
      .upload(path, out.content, { contentType: 'text/plain; charset=iso-8859-1', upsert: true });
    if (up.error) logger.warn({ err: up.error }, 'falha ao subir arquivo de export (segue mesmo assim)');

    await supabase.from('export_files').insert({
      owner_id: userId,
      statement_id: statementId,
      storage_path: up.error ? null : path,
      filename: out.filename,
      linhas: out.linhas,
      total_debito: out.total_debito_cents / 100,
      total_credito: out.total_credito_cents / 100,
      lote_numero: stmt.lote_numero ?? 1,
      conteudo_sha256: out.sha256,
      gerado_por: userId,
    });
    await supabase.from('statements').update({ status: 'gerado' }).eq('id', statementId);

    res.setHeader('Content-Type', 'text/plain; charset=iso-8859-1');
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.setHeader('X-Export-Sha256', out.sha256);
    res.setHeader('X-Export-Linhas', String(out.linhas));
    res.send(out.content);
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// PATCH /:id/transactions  — edição em lote da tela de Revisão
// --------------------------------------------------------------------------- #
statementsRouter.patch('/:id/transactions', async (req, res, next) => {
  try {
    const supabase = db(req);
    const statementId = req.params.id;
    const { updates } = bulkUpdateTransactionsSchema.parse(req.body);

    const { data: affected, error } = await supabase.rpc('update_transactions_bulk', {
      p_statement: statementId,
      p_updates: updates,
    });
    if (error) throw mapPgrstError(error, 'salvar lançamentos');
    if (!affected) throw notFound('Nenhum lançamento atualizado (importação não encontrada?)');

    // recalcula os totais (só os não-ignorados) e devolve tudo fresco
    const txns = await lerTodas(
      (de, ate) =>
        supabase.from('transactions').select(TXN_COLS).eq('statement_id', statementId).order('ordem').range(de, ate),
      'recarregar lançamentos',
    );

    const { data: cur } = await supabase
      .from('statements')
      .select('client_id, saldo_inicial')
      .eq('id', statementId)
      .maybeSingle();

    // aprende: cada lançamento classificado vira memória do cliente
    if (cur?.client_id) {
      const memorias = txns
        .filter((t) => !t.ignorado && String(t.conta_contabil ?? '').trim())
        .map((t) => ({
          direction: t.direction,
          pattern: memoryKey(t.descricao_raw ?? ''),
          conta_contabil: String(t.conta_contabil).trim(),
          hist_code: String(t.hist_code ?? '').trim(),
          hist_complemento: String(t.hist_complemento ?? '').trim(),
        }));
      if (memorias.length) {
        const { error: lErr } = await supabase.rpc('learn_classifications', {
          p_client: cur.client_id,
          p_rows: memorias,
        });
        if (lErr) logger.warn({ err: lErr }, 'falha ao aprender memórias (segue mesmo assim)');
      }
    }

    const ativos = txns.filter((t) => !t.ignorado);
    const ent = ativos.filter((t) => t.direction === 'entrada');
    const sai = ativos.filter((t) => t.direction === 'saida');
    const cents = (arr: typeof ativos) =>
      arr.reduce((a, t) => a + Math.round(Number(t.valor) * 100), 0);
    const totais = {
      qtd: ativos.length,
      ignorados: txns.length - ativos.length,
      entradas: { n: ent.length, valor_cents: cents(ent) },
      saidas: { n: sai.length, valor_cents: cents(sai) },
    };

    // saldo_final acompanha TODOS os lançamentos (inativados inclusos)
    const saldoFinal =
      (Math.round(Number(cur?.saldo_inicial ?? 0) * 100) + movimentoCents(txns)) / 100;

    const { data: stmt, error: sErr } = await supabase
      .from('statements')
      .update({ totais, saldo_final: saldoFinal })
      .eq('id', statementId)
      .select(STMT_COLS)
      .maybeSingle();
    if (sErr) throw mapPgrstError(sErr, 'atualizar totais');

    res.json({ statement: stmt, transactions: txns, updated: affected });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// PATCH /:id/classificacao  — edição em lote da tela do módulo Classificação
// (só a categoria do lançamento; não mexe em conta/histórico nem em totais).
// --------------------------------------------------------------------------- #
statementsRouter.patch('/:id/classificacao', async (req, res, next) => {
  try {
    const supabase = db(req);
    const statementId = req.params.id;
    const { updates } = bulkUpdateClassificacaoSchema.parse(req.body);

    const { data: affected, error } = await supabase.rpc('update_transactions_classificacao', {
      p_statement: statementId,
      p_updates: updates,
    });
    if (error) throw mapPgrstError(error, 'salvar classificações');
    if (!affected) throw notFound('Nenhum lançamento atualizado (importação não encontrada?)');

    const txns = await lerTodas(
      (de, ate) =>
        supabase.from('transactions').select(TXN_COLS).eq('statement_id', statementId).order('ordem').range(de, ate),
      'recarregar lançamentos',
    );

    res.json({ transactions: txns, updated: affected });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// PATCH /:id  — cabeçalho
// --------------------------------------------------------------------------- #
statementsRouter.patch('/:id', async (req, res, next) => {
  try {
    const supabase = db(req);
    const dto = updateStatementSchema.parse(req.body);
    if (Object.keys(dto).length === 0) {
      res.status(400).json({ error: 'Nada para atualizar' });
      return;
    }
    const patch: Record<string, unknown> = { ...dto };

    // Mexeu no saldo inicial → recalcula o saldo final (base do próximo extrato).
    if (dto.saldo_inicial !== undefined) {
      const txns = await lerTodas(
        (de, ate) =>
          supabase
            .from('transactions')
            .select('direction, valor')
            .eq('statement_id', req.params.id)
            .order('ordem')
            .range(de, ate),
        'somar os lançamentos',
      );
      patch.saldo_final = (Math.round(dto.saldo_inicial * 100) + movimentoCents(txns)) / 100;
    }

    const { data, error } = await supabase
      .from('statements')
      .update(patch)
      .eq('id', req.params.id)
      .select(STMT_COLS)
      .maybeSingle();
    if (error) throw mapPgrstError(error, 'atualizar importação');
    if (!data) throw notFound('Importação não encontrada');
    res.json({ statement: data });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------------------- #
// DELETE /:id
// --------------------------------------------------------------------------- #
statementsRouter.delete('/:id', async (req, res, next) => {
  try {
    const supabase = db(req);
    const { data: stmt } = await supabase
      .from('statements')
      .select('id, storage_path')
      .eq('id', req.params.id)
      .maybeSingle();
    if (!stmt) throw notFound('Importação não encontrada');

    if (stmt.storage_path) {
      await supabase.storage.from(BUCKET).remove([stmt.storage_path as string]);
    }
    const { error } = await supabase.from('statements').delete().eq('id', req.params.id);
    if (error) throw mapPgrstError(error, 'excluir importação');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
