import type { SupabaseClient } from '@supabase/supabase-js';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        email: string | null;
        token: string;
      };
      /** Cliente Supabase já no contexto do usuário autenticado (RLS aplicada). */
      supabase?: SupabaseClient;
    }
  }
}

export {};
