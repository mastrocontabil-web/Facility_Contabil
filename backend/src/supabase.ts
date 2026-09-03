import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';

/**
 * Cliente com a service_role / secret key — ignora RLS. Usar SÓ para tarefas
 * administrativas. `null` se SUPABASE_SERVICE_ROLE_KEY não estiver configurado
 * (o sistema funciona sem ela: auth via JWKS, CRUD no contexto do usuário).
 */
export const serviceClient: SupabaseClient | null = config.supabase.serviceRoleKey
  ? createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

/** Cliente anônimo (publishable key), sem usuário. Para checagens de saúde. */
export const anonClient: SupabaseClient = createClient(
  config.supabase.url,
  config.supabase.anonKey,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/**
 * Cliente "no contexto do usuário": anon/publishable key + o access token do
 * usuário no header Authorization. Com isso a RLS do Postgres/Storage é aplicada
 * e `auth.uid()` resolve — é a barreira de isolamento real.
 */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(config.supabase.url, config.supabase.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
