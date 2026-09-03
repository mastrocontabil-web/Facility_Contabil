import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

describe('GET /api/health', () => {
  const app = createApp();

  it('responde ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, service: 'backend' });
  });
});

describe('GET /api/me', () => {
  const app = createApp();

  it('401 sem token', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });

  it('401 com token malformado', async () => {
    const res = await request(app).get('/api/me').set('Authorization', 'Bearer abc.def');
    expect(res.status).toBe(401);
  });
});
