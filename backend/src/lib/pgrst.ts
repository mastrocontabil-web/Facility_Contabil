import type { PostgrestError } from '@supabase/supabase-js';
import { HttpError, badRequest, notFound } from './httpError.js';

/** Traduz um erro do PostgREST/Supabase para um HttpError com status adequado. */
export function mapPgrstError(error: PostgrestError, context = 'operação'): HttpError {
  const code = error.code ?? '';

  // violação de unique
  if (code === '23505') {
    return new HttpError(409, 'Registro duplicado', { detail: error.details });
  }
  // violação de FK
  if (code === '23503') {
    return badRequest('Referência inválida (registro relacionado não existe)', {
      detail: error.details,
    });
  }
  // violação de check / not-null
  if (code === '23514' || code === '23502') {
    return badRequest(`Dados inválidos para ${context}`, { detail: error.message });
  }
  // RLS negou / linha não encontrada no .single()
  if (code === 'PGRST116') {
    return notFound();
  }
  // tabela não existe (migrations não rodaram)
  if (code === 'PGRST205') {
    return new HttpError(503, 'Banco não inicializado — rode as migrations', {
      detail: error.message,
    });
  }

  return new HttpError(500, `Falha em ${context}`, { code, detail: error.message });
}
