import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { classificacoesRouter } from './router.js';
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
  app.use('/classificacoes', classificacoesRouter);
  app.use(errorHandler);
  return { app, ops };
}

const CID = '11111111-1111-1111-1111-111111111111';
const sample = {
  id: 'cl-1',
  client_id: CID,
  direction: 'saida',
  nome: 'AGUA E ESGOTO',
  ativo: true,
};

describe('classificacoesRouter', () => {
  it('GET / exige client_id', async () => {
    const { app } = appWith(() => ({ data: [], error: null }));
    const res = await request(app).get('/classificacoes');
    expect(res.status).toBe(400);
  });

  it('GET /?client_id lista ordenado por nome, filtra por direção', async () => {
    const { app, ops } = appWith(() => ({ data: [sample], error: null }));
    const res = await request(app).get(`/classificacoes?client_id=${CID}&direction=saida`);
    expect(res.status).toBe(200);
    expect(res.body.classificacoes).toHaveLength(1);
    expect(ops[0]).toMatchObject({ orderBy: 'nome' });
    expect(ops[0]?.filters).toContainEqual(['client_id', CID]);
    expect(ops[0]?.filters).toContainEqual(['direction', 'saida']);
  });

  it('POST / cria e injeta owner_id', async () => {
    const { app, ops } = appWith(() => ({ data: sample, error: null }));
    const res = await request(app)
      .post('/classificacoes')
      .send({ client_id: CID, direction: 'saida', nome: '  Agua e Esgoto  ' });
    expect(res.status).toBe(201);
    const payload = ops[0]?.payload as Record<string, unknown>;
    expect(payload.owner_id).toBe('user-1');
    expect(payload.nome).toBe('Agua e Esgoto');
    expect(payload.ativo).toBe(true);
  });

  it('POST / 400 quando o nome é muito curto', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app)
      .post('/classificacoes')
      .send({ client_id: CID, direction: 'saida', nome: 'A' });
    expect(res.status).toBe(400);
  });

  it('POST / 400 em nome duplicado (mesma direção/cliente)', async () => {
    const { app } = appWith(() => ({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    }));
    const res = await request(app)
      .post('/classificacoes')
      .send({ client_id: CID, direction: 'saida', nome: 'AGUA E ESGOTO' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/já existe/i);
  });

  it('PATCH /:id atualiza só o que veio', async () => {
    const { app, ops } = appWith(() => ({ data: { ...sample, ativo: false }, error: null }));
    const res = await request(app).patch('/classificacoes/cl-1').send({ ativo: false });
    expect(res.status).toBe(200);
    expect(res.body.classificacao.ativo).toBe(false);
    expect(Object.keys(ops[0]?.payload as object)).toEqual(['ativo']);
  });

  it('PATCH /:id 400 sem campos', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).patch('/classificacoes/cl-1').send({});
    expect(res.status).toBe(400);
  });

  it('PATCH /:id 404 quando não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null }));
    const res = await request(app).patch('/classificacoes/cl-1').send({ nome: 'X e Y' });
    expect(res.status).toBe(404);
  });

  it('DELETE /:id 204', async () => {
    const { app } = appWith(() => ({ data: null, error: null, count: 1 }));
    const res = await request(app).delete('/classificacoes/cl-1');
    expect(res.status).toBe(204);
  });

  it('DELETE /:id 404 quando não existe', async () => {
    const { app } = appWith(() => ({ data: null, error: null, count: 0 }));
    const res = await request(app).delete('/classificacoes/cl-1');
    expect(res.status).toBe(404);
  });
});
