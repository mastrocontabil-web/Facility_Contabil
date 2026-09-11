import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('./parserClient.js', () => ({ callPlanoContasParser: vi.fn() }));
import { callPlanoContasParser } from './parserClient.js';
import { contabilRouter } from './router.js';
import { errorHandler } from '../middleware/error.js';
import { makeFakeSupabase, type FakeHandler, type FakeOp } from '../test/fakeSupabase.js';

const mockedParser = vi.mocked(callPlanoContasParser);

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

beforeEach(() => mockedParser.mockReset());

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
