import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../app.js';

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signHs256(payload: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  return `${header}.${body}.${b64url(sig)}`;
}

describe('requireAuth (HS256 local)', () => {
  const app = createApp();
  const secret = process.env.SUPABASE_JWT_SECRET!;

  it('aceita token HS256 válido', async () => {
    const token = signHs256(
      { sub: 'user-123', email: 'a@b.com', exp: Math.floor(Date.now() / 1000) + 3600 },
      secret,
    );
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: 'user-123', email: 'a@b.com' });
  });

  it('rejeita assinatura errada', async () => {
    const token = signHs256(
      { sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 3600 },
      'secret-errado',
    );
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejeita token expirado', async () => {
    const token = signHs256(
      { sub: 'user-123', exp: Math.floor(Date.now() / 1000) - 10 },
      secret,
    );
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});
