import type { NextFunction, Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, decodeProtectedHeader } from 'jose';
import { config } from '../config.js';
import { anonClient, userClient } from '../supabase.js';
import { unauthorized } from '../lib/httpError.js';

type Identity = { userId: string; email: string | null };
type CacheEntry = Identity & { exp: number };

const tokenCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

const jwks = createRemoteJWKSet(new URL(config.supabase.jwksUrl));
const expectedIssuer = `${config.supabase.url}/auth/v1`;

function decodeSegment(part: string): Record<string, unknown> {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as Record<string, unknown>;
}

/** Verificação assimétrica (ES256/RS256) via JWKS — padrão dos projetos Supabase novos. */
async function verifyJwks(token: string): Promise<Identity | null> {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: expectedIssuer,
      // Supabase usa aud "authenticated" para usuários logados.
      audience: 'authenticated',
    });
    if (typeof payload.sub !== 'string') return null;
    return { userId: payload.sub, email: typeof payload.email === 'string' ? payload.email : null };
  } catch {
    return null;
  }
}

/** Verificação simétrica HS256 (projetos legados). */
function verifyHs256(token: string): Identity | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts as [string, string, string];

  const expected = createHmac('sha256', config.supabase.jwtSecret)
    .update(`${header}.${payload}`)
    .digest();
  const got = Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;

  let claims: Record<string, unknown>;
  try {
    claims = decodeSegment(payload);
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === 'number' && claims.exp < now) return null;
  if (typeof claims.sub !== 'string' || claims.sub === '') return null;
  return { userId: claims.sub, email: typeof claims.email === 'string' ? claims.email : null };
}

/** Último recurso: pergunta pra API de Auth do Supabase (a anon key basta). */
async function verifyRemote(token: string): Promise<Identity | null> {
  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data.user) return null;
  return { userId: data.user.id, email: data.user.email ?? null };
}

async function resolveIdentity(token: string): Promise<Identity | null> {
  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    return null; // nem parece um JWT
  }

  if (alg === 'HS256') {
    if (config.supabase.jwtSecret) return verifyHs256(token);
    return verifyRemote(token);
  }

  // ES256 / RS256 / EdDSA -> JWKS
  return (await verifyJwks(token)) ?? (await verifyRemote(token));
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) throw unauthorized('Token ausente (header Authorization: Bearer ...)');
    const token = match[1]!.trim();

    const cached = tokenCache.get(token);
    let identity: Identity | null =
      cached && cached.exp > Date.now() ? { userId: cached.userId, email: cached.email } : null;

    if (!identity) {
      identity = await resolveIdentity(token);
      if (!identity) throw unauthorized('Token inválido ou expirado');
      if (tokenCache.size > 5000) tokenCache.clear();
      tokenCache.set(token, { ...identity, exp: Date.now() + CACHE_TTL_MS });
    }

    req.auth = { ...identity, token };
    req.supabase = userClient(token);
    next();
  } catch (err) {
    next(err);
  }
}
