#!/usr/bin/env node
/**
 * Roda os arquivos de supabase/migrations/*.sql contra o Postgres do Supabase.
 * Precisa de SUPABASE_DB_URL no backend/.env (Supabase > Settings > Database >
 * Connection string > URI). Idempotente: registra o que já aplicou numa tabela
 * _migrations.
 *
 *   npm run migrate         -w backend
 *   npm run migrate:status  -w backend
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '..', '..', 'supabase', 'migrations');

const dbUrl = process.env.SUPABASE_DB_URL?.trim();
if (!dbUrl) {
  console.error(
    'SUPABASE_DB_URL não configurado em backend/.env.\n' +
      'Pegue em Supabase > Settings > Database > Connection string > URI\n' +
      '(ou rode as migrations manualmente pelo SQL Editor).',
  );
  process.exit(1);
}

const statusOnly = process.argv.includes('--status');

/**
 * Parser tolerante: senhas do Supabase costumam ter #, @, ! etc. sem
 * percent-encoding (o painel entrega assim). new URL() quebra nesses casos,
 * então extraímos os campos na mão.
 */
function parseDbUrl(raw) {
  const m = /^postgres(?:ql)?:\/\/([^:]+):(.*)@([^@:/]+):(\d+)\/([^?]+)(?:\?(.*))?$/.exec(raw.trim());
  if (!m) {
    // talvez já esteja bem-formada — deixa o pg tentar
    return { connectionString: raw, ssl: { rejectUnauthorized: false } };
  }
  const [, user, password, host, port, database] = m;
  return {
    user: decodeURIComponent(user),
    password: /%[0-9A-Fa-f]{2}/.test(password) ? decodeURIComponent(password) : password,
    host,
    port: Number(port),
    database,
    ssl: { rejectUnauthorized: false },
  };
}

const client = new pg.Client(parseDbUrl(dbUrl));

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

await client.connect();
try {
  await client.query(`
    create table if not exists public._migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);
  const { rows } = await client.query('select name from public._migrations');
  const applied = new Set(rows.map((r) => r.name));

  if (statusOnly) {
    for (const f of files) console.log(`${applied.has(f) ? '✓' : '·'} ${f}`);
    process.exit(0);
  }

  let ran = 0;
  for (const f of files) {
    if (applied.has(f)) {
      console.log(`✓ ${f} (já aplicada)`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, f), 'utf8');
    process.stdout.write(`→ ${f} ... `);
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into public._migrations (name) values ($1)', [f]);
      await client.query('commit');
      console.log('ok');
      ran++;
    } catch (err) {
      await client.query('rollback');
      console.log('ERRO');
      throw err;
    }
  }
  console.log(ran ? `\n${ran} migration(s) aplicada(s).` : '\nNada novo.');
} finally {
  await client.end();
}
