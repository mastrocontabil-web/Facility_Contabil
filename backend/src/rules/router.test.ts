import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { rulesRouter } from './router.js';
import { errorHandler } from '../middleware/error.js';
import { makeFakeSupabase, type FakeHandler } from '../test/fakeSupabase.js';

function appWith(handler: FakeHandler) {
  const { client, ops } = makeFakeSupabase(handler);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.auth = { userId: 'user-1', email: 'a@b.com', token: 't' };
    req.supabase = client;
    next();
  });
  app.use('/rules', rulesRouter);
  app.use(errorHandler);
  return { app, ops };
}

const CID = '11111111-1111-1111-1111-111111111111';
const sample = {
  id: 'r1',
  client_id: CID,
  direction: 'saida',
  match_type: 'contains',
  pattern: 'ENERGISA',
  conta_contabil: '4010',
  hist_code: '186',
  prioridade: 100,
  hits: 0,
  ativo: true,
};

describe('rulesRouter', () => {
  it('GET / exige client_id', async () => {
    const { app } = appWith(() => ({ data: [], error: null }));
    const res = await request(app).get('/rules');
    expect(res.status).toBe(400);
  });

  it('GET /?client_id lista na ordem prioridade/hits', async () => {
    const { app, ops } = appWith(() => ({ data: [sample], error: null }));
    const res = await request(app).get(`/rules?client_id=${CID}`);
    expect(res.status).toBe(200);
    expect(res.body.rules).toHaveLength(1);
    expect(ops[0]?.filters).toContainEqual(['client_id', CID]);
  });

  it('POST / cria e injeta owner_id', async () => {
    const { app, ops } = appWith(() => ({ data: sample, error: null }));
    const res = await request(app).post('/rules').send({
      client_id: CID,
      direction: 'saida',
      pattern: '  energisa  ',
      conta_contabil: '4.010',
      hist_code: '186',
    });
    expect(res.status).toBe(201);
    const payload = ops[0]?.payload as Record<string, unknown>;
    expect(payload.owner_id).toBe('user-1');
    expect(payload.pattern).toBe('energisa');
    expect(payload.conta_contabil).toBe('4010');
    expect(payload.match_type).toBe('contains');
  });

  it('POST / 400 quando a regra não preenche nada', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app)
      .post('/rules')
      .send({ client_id: CID, direction: 'saida', pattern: 'X' });
    expect(res.status).toBe(400);
  });

  it('POST / 400 em regex inválida', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).post('/rules').send({
      client_id: CID,
      direction: 'entrada',
      match_type: 'regex',
      pattern: 'PIX[',
      conta_contabil: '1',
    });
    expect(res.status).toBe(400);
  });

  it('PATCH /:id atualiza só o que veio (não zera os outros campos)', async () => {
    const { app, ops } = appWith(() => ({ data: { ...sample, ativo: false }, error: null }));
    const res = await request(app).patch('/rules/r1').send({ ativo: false });
    expect(res.status).toBe(200);
    expect(res.body.rule.ativo).toBe(false);
    expect(ops[0]).toMatchObject({ verb: 'update' });
    expect(Object.keys(ops[0]?.payload as object)).toEqual(['ativo']);
  });

  it('PATCH /:id normaliza a conta e mantém o resto intacto', async () => {
    const { app, ops } = appWith(() => ({ data: sample, error: null }));
    await request(app).patch('/rules/r1').send({ conta_contabil: '1.2.3', prioridade: 5 });
    const payload = ops[0]?.payload as Record<string, unknown>;
    expect(payload).toEqual({ conta_contabil: '123', prioridade: 5 });
  });

  it('PATCH /:id 400 sem campos', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).patch('/rules/r1').send({});
    expect(res.status).toBe(400);
  });

  it('DELETE /:id 204', async () => {
    const { app } = appWith(() => ({ data: null, error: null, count: 1 }));
    const res = await request(app).delete('/rules/r1');
    expect(res.status).toBe(204);
  });

  it('DELETE /:id 404 quando não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null, count: 0 }));
    const res = await request(app).delete('/rules/r1');
    expect(res.status).toBe(404);
  });
});
