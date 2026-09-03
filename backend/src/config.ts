import process from 'node:process';

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return v;
}

function optional(name: string, fallback = ''): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v : fallback;
}

const supabaseUrl = required('SUPABASE_URL').replace(/\/$/, '');

export const config = {
  env: optional('NODE_ENV', 'development'),
  port: Number(optional('BACKEND_PORT', '8080')),
  isProd: optional('NODE_ENV', 'development') === 'production',

  supabase: {
    url: supabaseUrl,
    /** anon OU a nova publishable key (sb_publishable_...). */
    anonKey: required('SUPABASE_ANON_KEY'),
    /** service_role OU a nova secret key (sb_secret_...). Opcional. */
    serviceRoleKey: optional('SUPABASE_SERVICE_ROLE_KEY'),
    /** Legado HS256 — só usado se o projeto ainda assina tokens com HS256. */
    jwtSecret: optional('SUPABASE_JWT_SECRET'),
    /** JWKS para validar tokens assimétricos (ES256/RS256), padrão dos projetos novos. */
    jwksUrl: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
    /** Conexão direta com o Postgres — só o script de migrations usa. */
    dbUrl: optional('SUPABASE_DB_URL'),
  },

  parser: {
    url: optional('PARSER_URL', 'http://localhost:8100'),
    sharedSecret: optional('PARSER_SHARED_SECRET'),
  },

  frontendOrigin: optional('FRONTEND_ORIGIN', 'http://localhost:5173'),
} as const;

export type Config = typeof config;
