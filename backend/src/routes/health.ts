import { Router } from 'express';
import { config } from '../config.js';
import { anonClient } from '../supabase.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({ ok: true, service: 'backend', time: new Date().toISOString() });
});

/** Verifica dependências externas (Supabase + parser). */
healthRouter.get('/deep', async (_req, res) => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // Supabase: consulta a tabela clients. 200/[] = ok; "não existe" = migrations
  // ainda não rodaram; erro de rede/chave = falha.
  try {
    const { error } = await anonClient.from('clients').select('id').limit(1);
    if (!error) {
      checks.supabase = { ok: true };
    } else if (error.code === 'PGRST205' || /schema cache|does not exist/i.test(error.message)) {
      checks.supabase = { ok: false, detail: 'tabelas não criadas — rode as migrations' };
    } else {
      checks.supabase = { ok: false, detail: error.message };
    }
  } catch (err) {
    checks.supabase = { ok: false, detail: (err as Error).message };
  }

  try {
    const r = await fetch(`${config.parser.url}/health`, { signal: AbortSignal.timeout(4000) });
    checks.parser = r.ok ? { ok: true } : { ok: false, detail: `HTTP ${r.status}` };
  } catch (err) {
    checks.parser = { ok: false, detail: (err as Error).message };
  }

  const ok = Object.values(checks).every((c) => c.ok);
  res.status(ok ? 200 : 503).json({ ok, checks });
});
