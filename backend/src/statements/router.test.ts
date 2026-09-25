import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('./parserClient.js', () => ({ callParser: vi.fn(), callParserExcel: vi.fn(), lerPlanilha: vi.fn() }));
import { callParser, callParserExcel, lerPlanilha } from './parserClient.js';
import { statementsRouter } from './router.js';
import { errorHandler } from '../middleware/error.js';
import { makeFakeSupabase, type FakeHandler, type FakeOp } from '../test/fakeSupabase.js';
import { unprocessable } from '../lib/httpError.js';

const mockedParser = vi.mocked(callParser);
const mockedParserExcel = vi.mocked(callParserExcel);
const mockedLerPlanilha = vi.mocked(lerPlanilha);

function appWith(handler: FakeHandler) {
  const { client, ops, storageOps } = makeFakeSupabase(handler);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: 'u1', email: 'a@b.com', token: 't' };
    req.supabase = client;
    next();
  });
  app.use('/statements', statementsRouter);
  app.use(errorHandler);
  return { app, ops, storageOps };
}

/** Handler que responde por (tabela, verbo). */
function handlerFor(map: Record<string, (op: FakeOp) => unknown>): FakeHandler {
  return (op) => {
    const key = `${op.table}.${op.verb}`;
    const fn = map[key] ?? map[op.table];
    return { data: fn ? fn(op) : null, error: null };
  };
}

/** Linhas servidas como o PostgREST do Supabase: a fatia do .range(), no máximo 1000. */
function paginado<T>(linhas: T[]) {
  return (op: FakeOp) => {
    const [de, ate] = op.range ?? [0, linhas.length - 1];
    return linhas.slice(de, Math.min(ate + 1, de + 1000));
  };
}

const parseResult = {
  format: 'ofx' as const,
  bank_id: '0260',
  account_id: '123-4',
  period_start: '2026-07-01',
  period_end: '2026-07-31',
  warnings: [],
  transactions: [
    { date: '2026-07-01', description: 'PIX ENVIADO', amount_cents: 1000, direction: 'saida' as const, raw: {} },
    { date: '2026-07-05', description: 'PIX RECEBIDO', amount_cents: 234055, direction: 'entrada' as const, raw: {} },
  ],
};

beforeEach(() => {
  mockedParser.mockReset();
  mockedParserExcel.mockReset();
  mockedLerPlanilha.mockReset();
});

describe('POST /statements', () => {
  it('sobe o arquivo, chama o parser e devolve status revisao', async () => {
    mockedParser.mockResolvedValue(parseResult);
    const { app, ops, storageOps } = appWith(
      handlerFor({
        'clients.select': () => ({ id: 'c1' }),
        'statements.insert': () => ({ id: 's1' }),
        'statements.update': () => ({ id: 's1', status: 'revisao', totais: {} }),
        'transactions.insert': () => null,
        'transactions.select': () => [
          { id: 't1', ordem: 0, direction: 'saida' },
          { id: 't2', ordem: 1, direction: 'entrada' },
        ],
      }),
    );

    const res = await request(app)
      .post('/statements')
      .field('client_id', '11111111-1111-1111-1111-111111111111')
      .field('banco_conta_contabil', '10002')
      .attach('file', Buffer.from('OFXHEADER:100\n<OFX></OFX>'), 'extrato.ofx');

    expect(res.status).toBe(201);
    expect(res.body.statement.status).toBe('revisao');
    expect(res.body.transactions).toHaveLength(2);
    expect(mockedParser).toHaveBeenCalledOnce();
    expect(storageOps[0]).toMatchObject({ bucket: 'statements', action: 'upload' });

    const txnInsert = ops.find((o) => o.table === 'transactions' && o.verb === 'insert');
    const rows = txnInsert?.payload as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ direction: 'saida', hist_code: '186', valor: '10.00' });
    expect(rows[1]).toMatchObject({ direction: 'entrada', hist_code: '138', valor: '2340.55' });
  });

  it('pré-preenche pela memória do cliente (descrição exata)', async () => {
    mockedParser.mockResolvedValue(parseResult);
    const { app, ops } = appWith(
      handlerFor({
        'clients.select': () => ({ id: 'c1' }),
        'mapping_rules.select': () => [
          {
            id: 'mem-1',
            direction: 'saida',
            match_type: 'exact',
            pattern: 'PIX ENVIADO',
            conta_contabil: '5010',
            hist_code: '190',
            hist_complemento_template: 'PIX programado',
            prioridade: 50,
            hits: 3,
          },
        ],
        'statements.insert': () => ({ id: 's1' }),
        'statements.update': () => ({ id: 's1', status: 'revisao', totais: {} }),
        'transactions.insert': () => null,
        'transactions.select': () => [{ id: 't1', ordem: 0, direction: 'saida' }],
      }),
    );

    await request(app)
      .post('/statements')
      .field('client_id', '11111111-1111-1111-1111-111111111111')
      .field('banco_conta_contabil', '10002')
      .attach('file', Buffer.from('OFXHEADER:100\n<OFX></OFX>'), 'e.ofx');

    const rows = ops.find((o) => o.table === 'transactions' && o.verb === 'insert')
      ?.payload as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      conta_contabil: '5010',
      hist_code: '190',
      hist_complemento: 'PIX programado',
      regra_id: 'mem-1',
      origem_preenchimento: 'memoria',
    });
    // lançamento sem memória
    expect(rows[1]).toMatchObject({ regra_id: null, origem_preenchimento: 'vazio', hist_code: '138' });
  });

  it('descrição com contas diferentes na memória → origem "conferir"', async () => {
    mockedParser.mockResolvedValue(parseResult);
    const { app, ops } = appWith(
      handlerFor({
        'clients.select': () => ({ id: 'c1' }),
        'mapping_rules.select': () => [
          { id: 'a', direction: 'saida', match_type: 'exact', pattern: 'PIX ENVIADO', conta_contabil: '5010', hist_code: '186', prioridade: 50, hits: 1 },
          { id: 'b', direction: 'saida', match_type: 'exact', pattern: 'PIX ENVIADO', conta_contabil: '4020', hist_code: '186', prioridade: 50, hits: 8 },
        ],
        'statements.insert': () => ({ id: 's1' }),
        'statements.update': () => ({ id: 's1', status: 'revisao', totais: {} }),
        'transactions.insert': () => null,
        'transactions.select': () => [{ id: 't1', ordem: 0, direction: 'saida' }],
      }),
    );

    await request(app)
      .post('/statements')
      .field('client_id', '11111111-1111-1111-1111-111111111111')
      .field('banco_conta_contabil', '10002')
      .attach('file', Buffer.from('OFXHEADER:100\n<OFX></OFX>'), 'e.ofx');

    const rows = ops.find((o) => o.table === 'transactions' && o.verb === 'insert')
      ?.payload as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ conta_contabil: '4020', origem_preenchimento: 'conferir' });
  });

  it('sem saldo informado usa o do cadastro, mesmo com extrato anterior (não encadeia)', async () => {
    mockedParser.mockResolvedValue(parseResult);
    const { app, ops } = appWith(
      handlerFor({
        'clients.select': () => ({ id: 'c1', saldo_inicial: '1000.00' }),
        'statements.select': () => [{ saldo_final: '5000.00', period_end: '2026-06-30' }],
        'statements.insert': () => ({ id: 's1' }),
        'statements.update': () => ({ id: 's1', status: 'revisao', totais: {} }),
        'transactions.insert': () => null,
        'transactions.select': () => [{ id: 't1', ordem: 0, direction: 'saida' }],
      }),
    );

    await request(app)
      .post('/statements')
      .field('client_id', '11111111-1111-1111-1111-111111111111')
      .field('banco_conta_contabil', '10002')
      .attach('file', Buffer.from('OFXHEADER:100\n<OFX></OFX>'), 'e.ofx');

    const insert = ops.find((o) => o.table === 'statements' && o.verb === 'insert');
    expect((insert?.payload as { saldo_inicial: number }).saldo_inicial).toBe(1000);
    expect(ops.some((o) => o.table === 'statements' && o.verb === 'select')).toBe(false);

    // saldo_final = 1000 + 2340,55 (entrada) − 10,00 (saída) = 3330,55
    const saldoFinal = ops
      .filter((o) => o.table === 'statements' && o.verb === 'update')
      .map((o) => (o.payload as { saldo_final?: number }).saldo_final)
      .find((v) => v != null);
    expect(saldoFinal).toBe(3330.55);
  });

  it('saldo inicial informado na importação tem prioridade sobre o do cadastro', async () => {
    mockedParser.mockResolvedValue(parseResult);
    const { app, ops } = appWith(
      handlerFor({
        'clients.select': () => ({ id: 'c1', saldo_inicial: '1000.00' }),
        'statements.select': () => [{ saldo_final: '5000.00', period_end: '2026-06-30' }],
        'statements.insert': () => ({ id: 's1' }),
        'statements.update': () => ({ id: 's1', status: 'revisao', totais: {} }),
        'transactions.insert': () => null,
        'transactions.select': () => [{ id: 't1', ordem: 0, direction: 'saida' }],
      }),
    );

    await request(app)
      .post('/statements')
      .field('client_id', '11111111-1111-1111-1111-111111111111')
      .field('banco_conta_contabil', '10002')
      .field('saldo_inicial', '250,00')
      .attach('file', Buffer.from('OFXHEADER:100\n<OFX></OFX>'), 'e.ofx');

    const insert = ops.find((o) => o.table === 'statements' && o.verb === 'insert');
    expect((insert?.payload as { saldo_inicial: number }).saldo_inicial).toBe(250);
  });

  it('400 sem arquivo', async () => {
    const { app } = appWith(handlerFor({}));
    const res = await request(app)
      .post('/statements')
      .field('client_id', '11111111-1111-1111-1111-111111111111')
      .field('banco_conta_contabil', '10002');
    expect(res.status).toBe(400);
  });

  it('404 quando o cliente não é do usuário', async () => {
    const { app } = appWith(handlerFor({ 'clients.select': () => null }));
    const res = await request(app)
      .post('/statements')
      .field('client_id', '11111111-1111-1111-1111-111111111111')
      .field('banco_conta_contabil', '10002')
      .attach('file', Buffer.from('x'), 'e.ofx');
    expect(res.status).toBe(404);
  });

  it('erro do parser marca o statement como erro e devolve 422', async () => {
    mockedParser.mockRejectedValueOnce(unprocessable('PDF protegido por senha.'));
    const updates: FakeOp[] = [];
    const { app } = appWith((op) => {
      if (op.table === 'statements' && op.verb === 'update') updates.push(op);
      const data =
        op.table === 'clients'
          ? { id: 'c1' }
          : op.table === 'statements' && op.verb === 'insert'
            ? { id: 's1' }
            : null;
      return { data, error: null };
    });

    const res = await request(app)
      .post('/statements')
      .field('client_id', '11111111-1111-1111-1111-111111111111')
      .field('banco_conta_contabil', '10002')
      .attach('file', Buffer.from('%PDF'), 'e.pdf');

    expect(res.status).toBe(422);
    expect(updates.some((u) => (u.payload as { status?: string }).status === 'erro')).toBe(true);
  });

  it('422 de formato desconhecido', async () => {
    const { app } = appWith(handlerFor({ 'clients.select': () => ({ id: 'c1' }) }));
    const res = await request(app)
      .post('/statements')
      .field('client_id', '11111111-1111-1111-1111-111111111111')
      .field('banco_conta_contabil', '10002')
      .attach('file', Buffer.from('x'), 'foto.jpg');
    expect(res.status).toBe(400);
  });

  it('recusa extrato com mais de 10.000 lançamentos antes de gravar qualquer um', async () => {
    const t = parseResult.transactions[0]!;
    mockedParser.mockResolvedValue({ ...parseResult, transactions: Array.from({ length: 10_001 }, () => t) });
    const { app, ops } = appWith(
      handlerFor({
        'clients.select': () => ({ id: 'c1' }),
        'statements.insert': () => ({ id: 's1' }),
        'statements.update': () => null,
      }),
    );

    const res = await request(app)
      .post('/statements')
      .field('client_id', '11111111-1111-1111-1111-111111111111')
      .field('banco_conta_contabil', '10002')
      .attach('file', Buffer.from('OFXHEADER:100\n<OFX></OFX>'), 'e.ofx');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/10\.001 lançamentos — o limite é 10\.000/);
    expect(ops.some((o) => o.table === 'transactions' && o.verb === 'insert')).toBe(false);
    expect(
      ops.some((o) => o.table === 'statements' && (o.payload as { status?: string } | undefined)?.status === 'erro'),
    ).toBe(true);
  });
});

// --------------------------------------------------------------------------- #
// Nova importação Excel
// --------------------------------------------------------------------------- #
const CLIENTE = '11111111-1111-1111-1111-111111111111';
const MAPA = { aba: 0, data: 0, valor: 3, historico: [1, 2], excluir: [4] };
const planilha = {
  formato: 'xlsx' as const,
  abas: [{ nome: 'Agosto' }],
  aba: 0,
  colunas: 4,
  linhas: [
    { n: 3, c: [{ t: 'Data' }, { t: 'Histórico' }, { t: 'Cliente' }, { t: 'Valor' }] },
    { n: 5, c: [{ t: '03/08/2026', d: '2026-08-03' }, { t: 'Venda' }, null, { t: '350,5', v: 35050 }] },
  ],
  total_linhas: 2,
  truncado: false,
  sugestao: { data: 0, valor: 3, historico: [1] },
};

describe('POST /statements/excel/planilha', () => {
  it('devolve a aba como grade + as colunas da última importação Excel do cliente, sem gravar nada', async () => {
    mockedLerPlanilha.mockResolvedValue(planilha);
    const anterior = { aba: 1, data: 0, valor: 3, historico: [1], excluir: [4] };
    const { app, ops } = appWith(handlerFor({ 'statements.select': () => ({ excel_mapeamento: anterior }) }));

    const res = await request(app)
      .post('/statements/excel/planilha')
      .field('client_id', CLIENTE)
      .attach('file', Buffer.from('PK'), 'controle.xlsx');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ planilha, mapeamento_anterior: anterior });
    // sem aba escolhida na tela: abre na aba da última importação
    expect(mockedLerPlanilha).toHaveBeenCalledWith(expect.objectContaining({ originalname: 'controle.xlsx' }), 1);
    expect(ops).toHaveLength(1);
    const [busca] = ops;
    expect(busca).toMatchObject({ table: 'statements', verb: 'select', limit: 1, single: 'maybeSingle' });
    expect(busca!.filters).toEqual([['client_id', CLIENTE]]);
    expect(busca!.notFilters).toEqual([
      { col: 'excel_mapeamento', op: 'is', val: null },
      { col: 'status', op: 'eq', val: 'erro' },
    ]);
    expect(busca!.orderCalls).toEqual([{ col: 'created_at', ascending: false, foreignTable: undefined }]);
  });

  it('aba escolhida na tela vale mais que a da última importação', async () => {
    mockedLerPlanilha.mockResolvedValue(planilha);
    const { app } = appWith(handlerFor({ 'statements.select': () => ({ excel_mapeamento: { ...MAPA, aba: 2 } }) }));
    const res = await request(app)
      .post('/statements/excel/planilha')
      .field('client_id', CLIENTE)
      .field('aba', '0')
      .attach('file', Buffer.from('PK'), 'controle.xlsx');
    expect(res.status).toBe(200);
    expect(mockedLerPlanilha).toHaveBeenCalledWith(expect.anything(), 0);
  });

  it('cliente sem importação Excel anterior (ou sem cliente): só lê a planilha', async () => {
    mockedLerPlanilha.mockResolvedValue(planilha);
    const { app, ops } = appWith(handlerFor({ 'statements.select': () => null }));

    const com = await request(app)
      .post('/statements/excel/planilha')
      .field('client_id', CLIENTE)
      .attach('file', Buffer.from('PK'), 'controle.xlsx');
    expect(com.status).toBe(200);
    expect(com.body.mapeamento_anterior).toBeNull();
    expect(mockedLerPlanilha).toHaveBeenLastCalledWith(expect.anything(), undefined);

    const sem = await request(app).post('/statements/excel/planilha').attach('file', Buffer.from('x'), 'c.xls');
    expect(sem.status).toBe(200);
    expect(ops).toHaveLength(1); // só a busca do primeiro pedido
  });

  it('falha ao buscar a última importação não impede de abrir a planilha', async () => {
    mockedLerPlanilha.mockResolvedValue(planilha);
    const { app } = appWith(() => ({ data: null, error: { message: 'boom', code: 'XX000' } }));
    const res = await request(app)
      .post('/statements/excel/planilha')
      .field('client_id', CLIENTE)
      .attach('file', Buffer.from('PK'), 'controle.xlsx');
    expect(res.status).toBe(200);
    expect(res.body.mapeamento_anterior).toBeNull();
  });

  it('400 quando o arquivo não é planilha Excel', async () => {
    const { app } = appWith(handlerFor({}));
    for (const nome of ['extrato.pdf', 'extrato.csv', 'extrato.ofx']) {
      const res = await request(app).post('/statements/excel/planilha').attach('file', Buffer.from('x'), nome);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/planilha Excel/);
    }
    expect(mockedLerPlanilha).not.toHaveBeenCalled();
  });

  it('erro de leitura da planilha (ex.: senha) sobe como 422', async () => {
    mockedLerPlanilha.mockRejectedValue(unprocessable('planilha protegida por senha', { code: 'encrypted' }));
    const { app } = appWith(handlerFor({}));
    const res = await request(app).post('/statements/excel/planilha').attach('file', Buffer.from('x'), 'c.xlsx');
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/senha/);
  });
});

describe('POST /statements/excel', () => {
  const lidos = {
    ...parseResult,
    format: 'xlsx' as const,
    bank_id: null,
    account_id: null,
    warnings: ['1 linha(s) tiradas da importação por você: 4'],
  };

  function importar(app: express.Express, mapeamento: unknown = MAPA, nome = 'controle.xlsx') {
    return request(app)
      .post('/statements/excel')
      .field('client_id', CLIENTE)
      .field('banco_conta_contabil', '10002')
      .field('mapeamento', typeof mapeamento === 'string' ? mapeamento : JSON.stringify(mapeamento))
      .attach('file', Buffer.from('PK'), nome);
  }

  it('lê pelas colunas escolhidas, guarda a escolha no extrato e segue pra revisão', async () => {
    mockedParserExcel.mockResolvedValue(lidos);
    const { app, ops, storageOps } = appWith(
      handlerFor({
        'clients.select': () => ({ id: 'c1', saldo_inicial: '100.00' }),
        'statements.insert': () => ({ id: 's1' }),
        'statements.update': (op) => ({ id: 's1', status: 'revisao', ...(op.payload as object) }),
        'transactions.insert': () => null,
        'transactions.select': () => [
          { id: 't1', ordem: 0, direction: 'saida' },
          { id: 't2', ordem: 1, direction: 'entrada' },
        ],
      }),
    );

    const res = await importar(app);

    expect(res.status).toBe(201);
    expect(res.body.statement.status).toBe('revisao');
    expect(res.body.transactions).toHaveLength(2);
    expect(res.body.warnings).toEqual(lidos.warnings);
    expect(mockedParser).not.toHaveBeenCalled();
    expect(mockedParserExcel).toHaveBeenCalledWith(expect.objectContaining({ originalname: 'controle.xlsx' }), MAPA);
    expect(storageOps[0]).toMatchObject({ bucket: 'statements', action: 'upload' });

    const insert = ops.find((o) => o.table === 'statements' && o.verb === 'insert');
    expect(insert?.payload).toMatchObject({
      formato: 'xlsx',
      banco_conta_contabil: '10002',
      saldo_inicial: 100,
      status: 'parsing',
      excel_mapeamento: MAPA,
    });
    const rows = ops.find((o) => o.table === 'transactions' && o.verb === 'insert')?.payload as Array<
      Record<string, unknown>
    >;
    expect(rows.map((r) => [r.direction, r.valor, r.hist_code])).toEqual([
      ['saida', '10.00', '186'],
      ['entrada', '2340.55', '138'],
    ]);
  });

  it('.xls fica como xls, .xlsm como xlsx; sem "excluir" grava lista vazia', async () => {
    mockedParserExcel.mockResolvedValue(lidos);
    const { app, ops } = appWith(
      handlerFor({
        'clients.select': () => ({ id: 'c1' }),
        'statements.insert': () => ({ id: 's1' }),
        'statements.update': () => ({ id: 's1', status: 'revisao' }),
        'transactions.select': () => [],
      }),
    );
    const semExcluir = { aba: 0, data: 0, valor: 3, historico: [1, 2] };
    expect((await importar(app, semExcluir, 'controle.xls')).status).toBe(201);
    expect((await importar(app, MAPA, 'controle.xlsm')).status).toBe(201);
    const inserts = ops.filter((o) => o.table === 'statements' && o.verb === 'insert');
    expect(inserts.map((o) => (o.payload as { formato: string }).formato)).toEqual(['xls', 'xlsx']);
    expect((inserts[0]!.payload as { excel_mapeamento: unknown }).excel_mapeamento).toEqual({
      ...semExcluir,
      excluir: [],
    });
  });

  it('400 quando a escolha de colunas não serve — antes de criar o extrato', async () => {
    const { app, ops } = appWith(handlerFor({ 'clients.select': () => ({ id: 'c1' }) }));
    const invalidos = [
      '{nao é json',
      { ...MAPA, valor: 0 }, // Data e Valor na mesma coluna
      { ...MAPA, historico: [1, 3] }, // Valor também como histórico
      { ...MAPA, historico: [] }, // sem histórico
      { aba: 0, valor: 3, historico: [1] }, // sem data
      { ...MAPA, data: 60 }, // além da última coluna que a tela mostra
    ];
    for (const m of invalidos) {
      const res = await importar(app, m);
      expect(res.status, JSON.stringify(m)).toBe(400);
    }
    expect(ops.some((o) => o.table === 'statements')).toBe(false);
    expect(mockedParserExcel).not.toHaveBeenCalled();
  });

  it('400 quando o arquivo não é planilha Excel', async () => {
    const { app } = appWith(handlerFor({ 'clients.select': () => ({ id: 'c1' }) }));
    const res = await importar(app, MAPA, 'extrato.csv');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/planilha Excel/);
    expect(mockedParserExcel).not.toHaveBeenCalled();
  });

  it('nenhum lançamento nas colunas escolhidas: extrato vira erro com o motivo do leitor', async () => {
    mockedParserExcel.mockResolvedValue({
      ...lidos,
      transactions: [],
      warnings: ['40 linha(s) sem data na coluna B ficaram de fora (cabeçalho, títulos...): 1, 2, 3'],
    });
    const { app, ops } = appWith(
      handlerFor({
        'clients.select': () => ({ id: 'c1' }),
        'statements.insert': () => ({ id: 's1' }),
        'statements.update': () => null,
      }),
    );
    const res = await importar(app);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sem data na coluna B/);
    expect(ops.some((o) => o.table === 'transactions')).toBe(false);
    expect(
      ops.some((o) => o.table === 'statements' && (o.payload as { status?: string } | undefined)?.status === 'erro'),
    ).toBe(true);
  });
});

describe('POST /statements/classificar', () => {
  it('sobe o arquivo sem conta do banco, cria com origem_modulo=classificacao', async () => {
    mockedParser.mockResolvedValue(parseResult);
    const { app, ops } = appWith(
      handlerFor({
        'clients.select': () => ({ id: 'c1' }),
        'statements.insert': () => ({ id: 's1' }),
        'statements.update': () => ({ id: 's1', status: 'classificacao', totais: {} }),
        'transactions.insert': () => null,
        'transactions.select': () => [
          { id: 't1', ordem: 0, direction: 'saida' },
          { id: 't2', ordem: 1, direction: 'entrada' },
        ],
      }),
    );

    const res = await request(app)
      .post('/statements/classificar')
      .field('client_id', '11111111-1111-1111-1111-111111111111')
      .attach('file', Buffer.from('OFXHEADER:100\n<OFX></OFX>'), 'extrato.ofx');

    expect(res.status).toBe(201);
    expect(res.body.statement.status).toBe('classificacao');

    const insert = ops.find((o) => o.table === 'statements' && o.verb === 'insert');
    expect(insert?.payload).toMatchObject({ origem_modulo: 'classificacao' });
    expect(insert?.payload).not.toHaveProperty('banco_conta_contabil');
  });

  it('saldo inicial vem do cadastro, não do extrato anterior', async () => {
    mockedParser.mockResolvedValue(parseResult);
    const { app, ops } = appWith(
      handlerFor({
        'clients.select': () => ({ id: 'c1', saldo_inicial: '1000.00' }),
        'statements.select': () => [{ saldo_final: '5000.00', period_end: '2026-06-30' }],
        'statements.insert': () => ({ id: 's1' }),
        'statements.update': () => ({ id: 's1', status: 'classificacao', totais: {} }),
        'transactions.insert': () => null,
        'transactions.select': () => [{ id: 't1', ordem: 0, direction: 'saida' }],
      }),
    );

    await request(app)
      .post('/statements/classificar')
      .field('client_id', '11111111-1111-1111-1111-111111111111')
      .attach('file', Buffer.from('OFXHEADER:100\n<OFX></OFX>'), 'extrato.ofx');

    const insert = ops.find((o) => o.table === 'statements' && o.verb === 'insert');
    expect((insert?.payload as { saldo_inicial: number }).saldo_inicial).toBe(1000);
  });

  it('404 quando o cliente não é do usuário', async () => {
    const { app } = appWith(handlerFor({ 'clients.select': () => null }));
    const res = await request(app)
      .post('/statements/classificar')
      .field('client_id', '11111111-1111-1111-1111-111111111111')
      .attach('file', Buffer.from('x'), 'e.ofx');
    expect(res.status).toBe(404);
  });

  it('erro do parser marca o statement como erro e devolve 422', async () => {
    mockedParser.mockRejectedValueOnce(unprocessable('PDF protegido por senha.'));
    const updates: FakeOp[] = [];
    const { app } = appWith((op) => {
      if (op.table === 'statements' && op.verb === 'update') updates.push(op);
      const data =
        op.table === 'clients'
          ? { id: 'c1' }
          : op.table === 'statements' && op.verb === 'insert'
            ? { id: 's1' }
            : null;
      return { data, error: null };
    });

    const res = await request(app)
      .post('/statements/classificar')
      .field('client_id', '11111111-1111-1111-1111-111111111111')
      .attach('file', Buffer.from('%PDF'), 'e.pdf');

    expect(res.status).toBe(422);
    expect(updates.some((u) => (u.payload as { status?: string }).status === 'erro')).toBe(true);
  });
});

describe('POST /statements/:id/reimport', () => {
  it('troca os lançamentos, mantém cliente/hist/saldo, volta pra revisão', async () => {
    mockedParser.mockResolvedValue(parseResult);
    const { app, ops } = appWith(
      handlerFor({
        'statements.select': () => ({
          id: 's1',
          client_id: 'c1',
          hist_code_entrada: '138',
          hist_code_saida: '186',
          saldo_inicial: '500.00',
        }),
        'statements.update': (op) => ({ id: 's1', ...(op.payload as Record<string, unknown>) }),
        'transactions.delete': () => null,
        'transactions.insert': () => null,
        'transactions.select': () => [{ id: 't1', ordem: 0, direction: 'saida' }],
        'mapping_rules.select': () => [],
      }),
    );

    const res = await request(app)
      .post('/statements/s1/reimport')
      .attach('file', Buffer.from('OFXHEADER:100\n<OFX></OFX>'), 'novo.ofx');

    expect(res.status).toBe(200);
    expect(res.body.statement.status).toBe('revisao');
    expect(res.body.statement.arquivo_nome).toBe('novo.ofx');
    // apagou os antigos antes de inserir
    const del = ops.findIndex((o) => o.table === 'transactions' && o.verb === 'delete');
    const ins = ops.findIndex((o) => o.table === 'transactions' && o.verb === 'insert');
    expect(del).toBeGreaterThanOrEqual(0);
    expect(del).toBeLessThan(ins);
  });

  it('404 se a importação não existe', async () => {
    mockedParser.mockResolvedValue(parseResult);
    const { app } = appWith(handlerFor({ 'statements.select': () => null }));
    const res = await request(app)
      .post('/statements/nope/reimport')
      .attach('file', Buffer.from('x'), 'e.ofx');
    expect(res.status).toBe(404);
  });

  it('extrato ainda no módulo Classificação: reimportar mantém status classificacao', async () => {
    mockedParser.mockResolvedValue(parseResult);
    const { app } = appWith(
      handlerFor({
        'statements.select': () => ({
          id: 's1',
          client_id: 'c1',
          hist_code_entrada: '138',
          hist_code_saida: '186',
          saldo_inicial: '0',
          status: 'classificacao',
        }),
        'statements.update': (op) => ({ id: 's1', ...(op.payload as Record<string, unknown>) }),
        'transactions.delete': () => null,
        'transactions.insert': () => null,
        'transactions.select': () => [{ id: 't1', ordem: 0, direction: 'saida' }],
        'mapping_rules.select': () => [],
      }),
    );

    const res = await request(app)
      .post('/statements/s1/reimport')
      .attach('file', Buffer.from('OFXHEADER:100\n<OFX></OFX>'), 'novo.ofx');

    expect(res.status).toBe(200);
    expect(res.body.statement.status).toBe('classificacao');
  });

  it('extrato da Nova importação Excel não é relido pela leitura automática', async () => {
    const { app, ops, storageOps } = appWith(
      handlerFor({
        'statements.select': () => ({
          id: 's1',
          client_id: 'c1',
          hist_code_entrada: '138',
          hist_code_saida: '186',
          saldo_inicial: '0',
          status: 'revisao',
          excel_mapeamento: { aba: 0, data: 0, valor: 3, historico: [1], excluir: [] },
        }),
      }),
    );
    const res = await request(app)
      .post('/statements/s1/reimport')
      .attach('file', Buffer.from('PK'), 'controle-setembro.xlsx');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nova importação Excel/);
    expect(mockedParser).not.toHaveBeenCalled();
    expect(storageOps).toHaveLength(0);
    expect(ops.some((o) => o.table === 'transactions')).toBe(false);
  });

  it('erro do parser marca status erro e NÃO apaga os lançamentos', async () => {
    mockedParser.mockRejectedValueOnce(unprocessable('PDF protegido por senha.'));
    const { app, ops } = appWith(
      handlerFor({
        'statements.select': () => ({
          id: 's1',
          client_id: 'c1',
          hist_code_entrada: '138',
          hist_code_saida: '186',
          saldo_inicial: '0',
        }),
        'statements.update': () => ({ id: 's1', status: 'erro' }),
      }),
    );
    const res = await request(app)
      .post('/statements/s1/reimport')
      .attach('file', Buffer.from('%PDF'), 'e.pdf');
    expect(res.status).toBe(422);
    expect(ops.some((o) => o.table === 'transactions' && o.verb === 'delete')).toBe(false);
  });
});

describe('GET /statements', () => {
  it('lista', async () => {
    const { app } = appWith(handlerFor({ 'statements.select': () => [{ id: 's1' }] }));
    const res = await request(app).get('/statements');
    expect(res.status).toBe(200);
    expect(res.body.statements).toHaveLength(1);
  });

  it('filtra por origem_modulo', async () => {
    const { app, ops } = appWith(handlerFor({ 'statements.select': () => [{ id: 's1' }] }));
    const res = await request(app).get('/statements?origem_modulo=classificacao');
    expect(res.status).toBe(200);
    const sel = ops.find((o) => o.table === 'statements' && o.verb === 'select');
    expect(sel?.filters).toContainEqual(['origem_modulo', 'classificacao']);
  });
});

describe('GET /statements/:id', () => {
  it('404 se não existe', async () => {
    const { app } = appWith(handlerFor({ 'statements.select': () => null }));
    const res = await request(app).get('/statements/s1');
    expect(res.status).toBe(404);
  });

  it('devolve o extrato inteiro mesmo passando de 1000 lançamentos (lê em páginas)', async () => {
    const txns = Array.from({ length: 1211 }, (_, i) => ({ id: `t${i}`, ordem: i }));
    const { app, ops } = appWith(
      handlerFor({ 'statements.select': () => ({ id: 's1' }), 'transactions.select': paginado(txns) }),
    );
    const res = await request(app).get('/statements/s1');
    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(1211);
    expect(res.body.transactions.at(-1)).toEqual({ id: 't1210', ordem: 1210 });
    expect(ops.filter((o) => o.table === 'transactions').map((o) => o.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });
});

describe('POST /statements/:id/export', () => {
  const stmtRow = {
    id: 's1',
    banco_conta_contabil: '10002',
    lote_numero: 117,
    period_start: '2026-07-01',
    period_end: '2026-07-31',
    complemento_modo: 'extrato',
    client: { dominio_code: '168', cnpj: '11222333000181', conta_width: 7 },
  };

  it('gera o arquivo, marca status gerado e devolve pra download', async () => {
    const { app, ops, storageOps } = appWith(
      handlerFor({
        'statements.select': () => stmtRow,
        'transactions.select': () => [
          {
            ordem: 0,
            data: '2026-07-10',
            direction: 'saida',
            valor: '102.58',
            conta_contabil: '272',
            hist_code: '186',
            descricao_raw: 'ELASTICO ROLICO',
            hist_complemento: '',
            ignorado: false,
          },
        ],
        'export_files.insert': () => null,
        'statements.update': () => ({ id: 's1', status: 'gerado' }),
      }),
    );

    const res = await request(app).post('/statements/s1/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['content-disposition']).toContain('(168) Dominio 07-2026.txt');
    const body = res.body instanceof Buffer ? res.body : Buffer.from(res.text, 'latin1');
    expect(body.slice(0, 2).toString('latin1')).toBe('01'); // sem BOM
    expect(body.toString('latin1').split('\r\n')[0]).toMatch(/^0100001681122233300018101\/07\/2026/);

    expect(ops.some((o) => o.table === 'export_files' && o.verb === 'insert')).toBe(true);
    expect(
      ops.some(
        (o) =>
          o.table === 'statements' &&
          o.verb === 'update' &&
          (o.payload as { status?: string }).status === 'gerado',
      ),
    ).toBe(true);
    expect(storageOps[0]).toMatchObject({ bucket: 'exports', action: 'upload' });
  });

  it('400 quando há lançamento sem conta/histórico', async () => {
    const { app } = appWith(
      handlerFor({
        'statements.select': () => stmtRow,
        'transactions.select': () => [
          { ordem: 0, data: '2026-07-10', direction: 'saida', valor: '10.00', conta_contabil: null, hist_code: '186', descricao_raw: 'X', hist_complemento: '', ignorado: false },
        ],
      }),
    );
    const res = await request(app).post('/statements/s1/export');
    expect(res.status).toBe(400);
    expect(res.body.details.ordens).toEqual([0]);
  });

  it('400 quando não há lançamento ativo', async () => {
    const { app } = appWith(
      handlerFor({
        'statements.select': () => stmtRow,
        'transactions.select': () => [
          { ordem: 0, data: '2026-07-10', direction: 'saida', valor: '10.00', conta_contabil: '1', hist_code: '186', descricao_raw: 'X', hist_complemento: '', ignorado: true },
        ],
      }),
    );
    const res = await request(app).post('/statements/s1/export');
    expect(res.status).toBe(400);
  });

  it('404 quando a importação não existe', async () => {
    const { app } = appWith(handlerFor({ 'statements.select': () => null }));
    const res = await request(app).post('/statements/nope/export');
    expect(res.status).toBe(404);
  });

  it('o arquivo sai com TODOS os lançamentos, mesmo passando de 1000', async () => {
    const txns = Array.from({ length: 1211 }, (_, i) => ({
      ordem: i,
      data: '2026-07-10',
      direction: i % 2 ? 'saida' : 'entrada',
      valor: '1.00',
      conta_contabil: '272',
      hist_code: '186',
      descricao_raw: `LANC ${i}`,
      hist_complemento: '',
      ignorado: false,
    }));
    const { app } = appWith(
      handlerFor({
        'statements.select': () => stmtRow,
        'transactions.select': paginado(txns),
        'export_files.insert': () => null,
        'statements.update': () => ({ id: 's1', status: 'gerado' }),
      }),
    );
    const res = await request(app).post('/statements/s1/export');
    expect(res.status).toBe(200);
    // registro 01 + (02 e 03) por lançamento + 99
    expect(res.headers['x-export-linhas']).toBe(String(1 + 2 * 1211 + 1));
  });
});

describe('PATCH /statements/:id/transactions', () => {
  function appWithRpc(rpcData: unknown, txns: unknown[]) {
    const { client, rpcOps } = makeFakeSupabase(
      (op) => {
        if (op.table === 'transactions') return { data: txns, error: null };
        if (op.table === 'statements')
          return {
            data: { id: 's1', ...(op.payload as Record<string, unknown> | undefined) },
            error: null,
          };
        return { data: null, error: null };
      },
      () => ({ error: null }),
      () => ({ data: rpcData, error: null }),
    );
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { userId: 'u1', email: 'a@b.com', token: 't' };
      req.supabase = client;
      next();
    });
    app.use('/statements', statementsRouter);
    app.use(errorHandler);
    return { app, rpcOps };
  }

  const U1 = '11111111-1111-1111-1111-111111111111';
  const U2 = '22222222-2222-2222-2222-222222222222';

  it('aplica atualizações em lote e recalcula totais (ignorados fora)', async () => {
    const txns = [
      { id: U1, ordem: 0, direction: 'entrada', valor: '100.00', ignorado: false },
      { id: U2, ordem: 1, direction: 'saida', valor: '30.00', ignorado: true },
      { id: 't3', ordem: 2, direction: 'saida', valor: '20.00', ignorado: false },
    ];
    const { app, rpcOps } = appWithRpc(3, txns);
    const res = await request(app)
      .patch('/statements/s1/transactions')
      .send({
        updates: [
          { id: U1, conta_contabil: '4.01.001', hist_code: '138' },
          { id: U2, ignorado: true },
        ],
      });
    expect(res.status).toBe(200);
    expect(rpcOps[0]).toMatchObject({ fn: 'update_transactions_bulk' });
    expect(res.body.statement.totais).toEqual({
      qtd: 2,
      ignorados: 1,
      entradas: { n: 1, valor_cents: 10000 },
      saidas: { n: 1, valor_cents: 2000 },
    });
  });

  it('400 se updates vazio', async () => {
    const { app } = appWithRpc(0, []);
    const res = await request(app).patch('/statements/s1/transactions').send({ updates: [] });
    expect(res.status).toBe(400);
  });

  it('limpa a conta contábil (string vazia -> null)', async () => {
    const { app, rpcOps } = appWithRpc(1, []);
    await request(app)
      .patch('/statements/s1/transactions')
      .send({ updates: [{ id: '11111111-1111-1111-1111-111111111111', conta_contabil: '' }] });
    const sent = (rpcOps[0]?.args.p_updates as Array<{ conta_contabil: unknown }>)[0];
    expect(sent.conta_contabil).toBeNull();
  });
});

describe('PATCH /statements/:id/classificacao', () => {
  const U1 = '11111111-1111-1111-1111-111111111111';
  const CL1 = '33333333-3333-3333-3333-333333333333';

  function appWithRpc(rpcData: unknown, txns: unknown[]) {
    const { client, rpcOps } = makeFakeSupabase(
      (op) => ({ data: op.table === 'transactions' ? txns : null, error: null }),
      () => ({ error: null }),
      () => ({ data: rpcData, error: null }),
    );
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.auth = { userId: 'u1', email: 'a@b.com', token: 't' };
      req.supabase = client;
      next();
    });
    app.use('/statements', statementsRouter);
    app.use(errorHandler);
    return { app, rpcOps };
  }

  it('chama a RPC dedicada e devolve os lançamentos atualizados', async () => {
    const txns = [{ id: U1, ordem: 0, direction: 'saida', classificacao_id: CL1 }];
    const { app, rpcOps } = appWithRpc(1, txns);
    const res = await request(app)
      .patch('/statements/s1/classificacao')
      .send({ updates: [{ id: U1, classificacao_id: CL1 }] });

    expect(res.status).toBe(200);
    expect(rpcOps[0]).toMatchObject({
      fn: 'update_transactions_classificacao',
      args: { p_statement: 's1' },
    });
    expect(res.body.transactions).toEqual(txns);
    expect(res.body.updated).toBe(1);
  });

  it('não mexe em conta_contabil/hist_code — só manda id + classificacao_id pra RPC', async () => {
    const { app, rpcOps } = appWithRpc(1, []);
    await request(app)
      .patch('/statements/s1/classificacao')
      .send({ updates: [{ id: U1, classificacao_id: null }] });
    expect(rpcOps[0]?.args.p_updates).toEqual([{ id: U1, classificacao_id: null }]);
  });

  it('404 quando nenhum lançamento é atualizado', async () => {
    const { app } = appWithRpc(0, []);
    const res = await request(app)
      .patch('/statements/s1/classificacao')
      .send({ updates: [{ id: U1, classificacao_id: null }] });
    expect(res.status).toBe(404);
  });

  it('400 se updates vazio', async () => {
    const { app } = appWithRpc(0, []);
    const res = await request(app).patch('/statements/s1/classificacao').send({ updates: [] });
    expect(res.status).toBe(400);
  });
});
