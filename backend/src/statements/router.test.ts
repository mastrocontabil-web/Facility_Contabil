import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('./parserClient.js', () => ({ callParser: vi.fn() }));
import { callParser } from './parserClient.js';
import { statementsRouter } from './router.js';
import { errorHandler } from '../middleware/error.js';
import { makeFakeSupabase, type FakeHandler, type FakeOp } from '../test/fakeSupabase.js';
import { unprocessable } from '../lib/httpError.js';

const mockedParser = vi.mocked(callParser);

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

beforeEach(() => mockedParser.mockReset());

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

  it('encadeia: saldo inicial = saldo final do extrato anterior do cliente', async () => {
    mockedParser.mockResolvedValue(parseResult);
    const { app, ops } = appWith(
      handlerFor({
        'clients.select': () => ({ id: 'c1', saldo_inicial: '1000.00' }),
        'statements.select': () => [
          { saldo_final: '3000.00', period_end: '2026-05-31' },
          { saldo_final: '5000.00', period_end: '2026-06-30' },
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

    const insert = ops.find((o) => o.table === 'statements' && o.verb === 'insert');
    expect((insert?.payload as { saldo_inicial: number }).saldo_inicial).toBe(5000);

    // saldo_final = 5000 + 2340,55 (entrada) − 10,00 (saída) = 7330,55
    const saldoFinal = ops
      .filter((o) => o.table === 'statements' && o.verb === 'update')
      .map((o) => (o.payload as { saldo_final?: number }).saldo_final)
      .find((v) => v != null);
    expect(saldoFinal).toBe(7330.55);
  });

  it('primeiro extrato do cliente usa o saldo inicial do cadastro', async () => {
    mockedParser.mockResolvedValue(parseResult);
    const { app, ops } = appWith(
      handlerFor({
        'clients.select': () => ({ id: 'c1', saldo_inicial: '1234.56' }),
        'statements.select': () => [],
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
    expect((insert?.payload as { saldo_inicial: number }).saldo_inicial).toBe(1234.56);
  });

  it('saldo inicial informado na importação tem prioridade sobre o encadeado', async () => {
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
});

describe('GET /statements', () => {
  it('lista', async () => {
    const { app } = appWith(handlerFor({ 'statements.select': () => [{ id: 's1' }] }));
    const res = await request(app).get('/statements');
    expect(res.status).toBe(200);
    expect(res.body.statements).toHaveLength(1);
  });
});

describe('GET /statements/:id', () => {
  it('404 se não existe', async () => {
    const { app } = appWith(handlerFor({ 'statements.select': () => null }));
    const res = await request(app).get('/statements/s1');
    expect(res.status).toBe(404);
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
