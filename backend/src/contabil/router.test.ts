import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('./parserClient.js', () => ({ callPlanoContasParser: vi.fn(), callBalanceteParser: vi.fn() }));
import { callBalanceteParser, callPlanoContasParser } from './parserClient.js';
import { contabilRouter } from './router.js';
import { errorHandler } from '../middleware/error.js';
import { makeFakeSupabase, type FakeHandler, type FakeOp } from '../test/fakeSupabase.js';

const mockedParser = vi.mocked(callPlanoContasParser);
const mockedBalanceteParser = vi.mocked(callBalanceteParser);

function appWith(handler: FakeHandler) {
  const { client, ops, rpcOps } = makeFakeSupabase(handler);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: 'user-1', email: 'a@b.com', token: 't' };
    req.supabase = client;
    next();
  });
  app.use('/contabil', contabilRouter);
  app.use(errorHandler);
  return { app, ops, rpcOps };
}

/** Handler que responde por (tabela, verbo). */
function handlerFor(map: Record<string, (op: FakeOp) => unknown>): FakeHandler {
  return (op) => {
    const key = `${op.table}.${op.verb}`;
    const fn = map[key] ?? map[op.table];
    return { data: fn ? fn(op) : null, error: null };
  };
}

const CID = '11111111-1111-1111-1111-111111111111';
const contaSample = {
  id: 'pc-1',
  client_id: CID,
  codigo: '1',
  tipo: 'S',
  classificacao: '1',
  nome: 'ATIVO',
  grau: 1,
  parent_id: null,
  natureza: null,
  ativo: true,
};

const PERIODO_ID = '22222222-2222-2222-2222-222222222222';
const periodoSample = {
  id: PERIODO_ID,
  client_id: CID,
  ano: 2026,
  mes: 6,
  status: 'fechado',
  fechado_em: '2026-06-30T00:00:00.000Z',
};
const saldoSample = {
  id: 's1',
  periodo_id: PERIODO_ID,
  plano_conta_id: 'pc-1',
  codigo: '1',
  nome: 'ATIVO',
  tipo: 'S',
  ordem: 0,
  saldo_anterior_cents: 100,
  saldo_anterior_natureza: 'D',
  debito_cents: 0,
  credito_cents: 0,
  saldo_atual_cents: 100,
  saldo_atual_natureza: 'D',
};

beforeEach(() => {
  mockedParser.mockReset();
  mockedBalanceteParser.mockReset();
});

describe('GET /contabil/plano-contas', () => {
  it('exige client_id', async () => {
    const { app } = appWith(() => ({ data: [], error: null }));
    const res = await request(app).get('/contabil/plano-contas');
    expect(res.status).toBe(400);
  });

  it('lista ordenado por classificação', async () => {
    const { app, ops } = appWith(() => ({ data: [contaSample], error: null }));
    const res = await request(app).get(`/contabil/plano-contas?client_id=${CID}`);
    expect(res.status).toBe(200);
    expect(res.body.contas).toHaveLength(1);
    expect(ops[0]).toMatchObject({ orderBy: 'classificacao' });
  });
});

describe('POST /contabil/plano-contas/importar', () => {
  it('exige arquivo', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).post('/contabil/plano-contas/importar').field('client_id', CID);
    expect(res.status).toBe(400);
  });

  it('lê o PDF e grava por upsert (código novo = criada)', async () => {
    mockedParser.mockResolvedValue({
      items: [
        { codigo: '1', tipo: 'S', classificacao: '1', nome: 'ATIVO', grau: 1 },
        { codigo: '2', tipo: 'A', classificacao: '1.1', nome: 'CAIXA', grau: 2 },
      ],
      warnings: [],
    });

    let planoSelectCalls = 0;
    const { app, ops, rpcOps } = appWith((op) => {
      if (op.table === 'clients') return { data: { id: CID }, error: null };
      if (op.table === 'plano_contas' && op.verb === 'select') {
        planoSelectCalls++;
        if (planoSelectCalls === 1) return { data: [], error: null }; // nada existente ainda
        return {
          data: [
            { ...contaSample, id: 'p1' },
            {
              ...contaSample,
              id: 'p2',
              codigo: '2',
              tipo: 'A',
              classificacao: '1.1',
              nome: 'CAIXA',
              grau: 2,
              parent_id: 'p1',
            },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const res = await request(app)
      .post('/contabil/plano-contas/importar')
      .field('client_id', CID)
      .attach('file', Buffer.from('%PDF-fake'), 'plano.pdf');

    expect(res.status).toBe(201);
    expect(res.body.criadas).toBe(2);
    expect(res.body.atualizadas).toBe(0);
    expect(res.body.contas).toHaveLength(2);

    const upsertOp = ops.find((o) => o.table === 'plano_contas' && o.verb === 'upsert');
    expect(upsertOp?.onConflict).toBe('client_id,codigo');
    // parent_id é religado via RPC no servidor, nunca por upsert parcial (client_id
    // é NOT NULL e um upsert só com {id, parent_id} quebra na validação da linha).
    expect(rpcOps).toContainEqual({ fn: 'relink_plano_contas_parents', args: { p_client: CID } });
  });

  it('404 quando o cliente não existe', async () => {
    mockedParser.mockResolvedValue({ items: [], warnings: [] });
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app)
      .post('/contabil/plano-contas/importar')
      .field('client_id', CID)
      .attach('file', Buffer.from('%PDF-fake'), 'plano.pdf');
    expect(res.status).toBe(404);
  });
});

describe('DELETE /contabil/plano-contas/:id', () => {
  it('bloqueia quando a conta tem filhas', async () => {
    const { app, ops } = appWith((op) =>
      op.table === 'plano_contas' && op.verb === 'select'
        ? { data: null, error: null, count: 3 }
        : { data: null, error: null, count: 1 },
    );
    const res = await request(app).delete('/contabil/plano-contas/pc-1');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/filha/i);
    expect(ops.some((o) => o.table === 'plano_contas' && o.verb === 'delete')).toBe(false);
  });

  it('204 quando não tem filhas', async () => {
    const { app } = appWith((op) =>
      op.table === 'plano_contas' && op.verb === 'select'
        ? { data: null, error: null, count: 0 }
        : { data: null, error: null, count: 1 },
    );
    const res = await request(app).delete('/contabil/plano-contas/pc-1');
    expect(res.status).toBe(204);
  });
});

describe('históricos padrão', () => {
  it('POST /historicos cria e injeta owner_id', async () => {
    const sample = { id: 'h1', codigo: '1', descricao: 'CONFORME NOTA FISCAL', ativo: true };
    const { app, ops } = appWith(handlerFor({ 'historicos_padrao.insert': () => sample }));
    const res = await request(app)
      .post('/contabil/historicos')
      .send({ codigo: '1', descricao: 'Conforme nota fiscal' });
    expect(res.status).toBe(201);
    const payload = ops[0]?.payload as Record<string, unknown>;
    expect(payload.owner_id).toBe('user-1');
  });

  it('POST /historicos 400 em código duplicado', async () => {
    const { app } = appWith(() => ({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    }));
    const res = await request(app)
      .post('/contabil/historicos')
      .send({ codigo: '1', descricao: 'Conforme nota fiscal' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/já existe/i);
  });

  it('PATCH /historicos/:id atualiza só o que veio', async () => {
    const { app, ops } = appWith(() => ({
      data: { id: 'h1', codigo: '1', descricao: 'X', ativo: false },
      error: null,
    }));
    const res = await request(app).patch('/contabil/historicos/h1').send({ ativo: false });
    expect(res.status).toBe(200);
    expect(Object.keys(ops[0]?.payload as object)).toEqual(['ativo']);
  });

  it('DELETE /historicos/:id 404 quando não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null, count: 0 }));
    const res = await request(app).delete('/contabil/historicos/h1');
    expect(res.status).toBe(404);
  });
});

describe('POST /contabil/balancete/importar', () => {
  it('exige arquivo', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).post('/contabil/balancete/importar').field('client_id', CID);
    expect(res.status).toBe(400);
  });

  it('404 quando o cliente não existe', async () => {
    mockedBalanceteParser.mockResolvedValue({ periodo: { ano: 2026, mes: 6 }, items: [], warnings: [] });
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app)
      .post('/contabil/balancete/importar')
      .field('client_id', CID)
      .attach('file', Buffer.from('%PDF-fake'), 'balancete.pdf');
    expect(res.status).toBe(404);
  });

  it('400 quando o balancete não tem contas', async () => {
    mockedBalanceteParser.mockResolvedValue({ periodo: { ano: 2026, mes: 6 }, items: [], warnings: [] });
    const { app } = appWith((op) =>
      op.table === 'clients' ? { data: { id: CID }, error: null } : { data: null, error: null },
    );
    const res = await request(app)
      .post('/contabil/balancete/importar')
      .field('client_id', CID)
      .attach('file', Buffer.from('%PDF-fake'), 'balancete.pdf');
    expect(res.status).toBe(400);
  });

  it('lê o PDF, fecha o período e grava saldos linkando por código (upsert)', async () => {
    mockedBalanceteParser.mockResolvedValue({
      periodo: { ano: 2026, mes: 6 },
      items: [
        {
          codigo: '1',
          nome: 'ATIVO',
          tipo: 'S',
          saldo_anterior_cents: 100,
          saldo_anterior_natureza: 'D',
          debito_cents: 0,
          credito_cents: 0,
          saldo_atual_cents: 100,
          saldo_atual_natureza: 'D',
        },
      ],
      warnings: [],
    });

    let saldoSelectCalls = 0;
    const { app, ops } = appWith((op) => {
      if (op.table === 'clients') return { data: { id: CID }, error: null };
      if (op.table === 'periodos_contabeis') return { data: periodoSample, error: null };
      if (op.table === 'plano_contas') return { data: [{ id: 'pc-1', codigo: '1', tipo: 'S' }], error: null };
      if (op.table === 'saldos_contabeis' && op.verb === 'select') {
        saldoSelectCalls++;
        return { data: saldoSelectCalls === 1 ? [] : [saldoSample], error: null }; // 1ª: nada existente; 2ª: releitura
      }
      return { data: null, error: null };
    });

    const res = await request(app)
      .post('/contabil/balancete/importar')
      .field('client_id', CID)
      .attach('file', Buffer.from('%PDF-fake'), 'balancete.pdf');

    expect(res.status).toBe(201);
    expect(res.body.criadas).toBe(1);
    expect(res.body.atualizadas).toBe(0);
    expect(res.body.periodo).toMatchObject({ ano: 2026, mes: 6, status: 'fechado' });
    expect(res.body.saldos).toHaveLength(1);
    expect(res.body.warnings).toEqual([]);

    const periodoUpsert = ops.find((o) => o.table === 'periodos_contabeis' && o.verb === 'upsert');
    expect(periodoUpsert?.onConflict).toBe('client_id,ano,mes');
    expect(periodoUpsert?.payload).toMatchObject({ ano: 2026, mes: 6, status: 'fechado' });

    const saldoUpsert = ops.find((o) => o.table === 'saldos_contabeis' && o.verb === 'upsert');
    expect(saldoUpsert?.onConflict).toBe('periodo_id,codigo');
    const payload = saldoUpsert?.payload as Array<Record<string, unknown>>;
    expect(payload[0]).toMatchObject({ codigo: '1', plano_conta_id: 'pc-1', ordem: 0 });
  });

  it('conta do balancete não encontrada no plano de contas: salva sem vínculo e avisa (caso real: código 10298)', async () => {
    mockedBalanceteParser.mockResolvedValue({
      periodo: { ano: 2026, mes: 6 },
      items: [
        {
          codigo: '10298',
          nome: 'ESCRITORIO INTELIGENTE DESENVOLVIMENTOS, COMERCIO E SERVICOS EM INFORMATICA LTDA',
          tipo: 'A',
          saldo_anterior_cents: 0,
          saldo_anterior_natureza: null,
          debito_cents: 81290,
          credito_cents: 81290,
          saldo_atual_cents: 0,
          saldo_atual_natureza: null,
        },
      ],
      warnings: [],
    });

    let saldoSelectCalls = 0;
    const { app, ops } = appWith((op) => {
      if (op.table === 'clients') return { data: { id: CID }, error: null };
      if (op.table === 'periodos_contabeis') return { data: periodoSample, error: null };
      if (op.table === 'plano_contas') return { data: [], error: null }; // 10298 não está cadastrado
      if (op.table === 'saldos_contabeis' && op.verb === 'select') {
        saldoSelectCalls++;
        return {
          data: saldoSelectCalls === 1 ? [] : [{ ...saldoSample, codigo: '10298', plano_conta_id: null }],
          error: null,
        };
      }
      return { data: null, error: null };
    });

    const res = await request(app)
      .post('/contabil/balancete/importar')
      .field('client_id', CID)
      .attach('file', Buffer.from('%PDF-fake'), 'balancete.pdf');

    expect(res.status).toBe(201);
    expect(
      res.body.warnings.some((w: string) => w.includes('10298') && w.includes('não encontrada no plano de contas')),
    ).toBe(true);

    const saldoUpsert = ops.find((o) => o.table === 'saldos_contabeis' && o.verb === 'upsert');
    const payload = saldoUpsert?.payload as Array<Record<string, unknown>>;
    expect(payload[0]).toMatchObject({ codigo: '10298', plano_conta_id: null });
  });
});

describe('GET /contabil/periodos', () => {
  it('exige client_id', async () => {
    const { app } = appWith(() => ({ data: [], error: null }));
    const res = await request(app).get('/contabil/periodos');
    expect(res.status).toBe(400);
  });

  it('lista períodos do cliente', async () => {
    const { app, ops } = appWith(() => ({ data: [periodoSample], error: null }));
    const res = await request(app).get(`/contabil/periodos?client_id=${CID}`);
    expect(res.status).toBe(200);
    expect(res.body.periodos).toHaveLength(1);
    expect(ops[0]?.filters).toContainEqual(['client_id', CID]);
  });
});

describe('GET /contabil/saldos', () => {
  it('exige periodo_id', async () => {
    const { app } = appWith(() => ({ data: [], error: null }));
    const res = await request(app).get('/contabil/saldos');
    expect(res.status).toBe(400);
  });

  it('lista saldos do período, ordenado por ordem', async () => {
    const { app, ops } = appWith(() => ({ data: [saldoSample], error: null }));
    const res = await request(app).get(`/contabil/saldos?periodo_id=${PERIODO_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.saldos).toHaveLength(1);
    expect(ops[0]).toMatchObject({ orderBy: 'ordem' });
  });
});
