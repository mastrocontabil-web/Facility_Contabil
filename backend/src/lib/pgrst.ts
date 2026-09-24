import type { PostgrestError } from '@supabase/supabase-js';
import { HttpError, badRequest, notFound } from './httpError.js';
import { logger } from './logger.js';

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

/**
 * Teto de linhas numa leitura. O PostgREST do Supabase corta toda resposta no
 * "max rows" do projeto (1000 por padrão) SEM dar erro — e pedir um .limit()
 * maior não adianta. Um extrato do Mercado Pago já passa de 1.200 lançamentos
 * num mês, então toda leitura que pode crescer assim passa por lerTodas().
 */
export const LIMITE_LINHAS = 10_000;

/** Linhas por página — o "max rows" padrão do Supabase. */
const PAGINA = 1000;

type Resposta<T> = { data: T[] | null; error: PostgrestError | null };

/**
 * Lê uma consulta inteira em páginas. `pagina(de, ate)` monta a consulta com
 * `.range(de, ate)` — sempre com um `.order()` que não empata, senão uma linha
 * pode repetir ou sumir entre as páginas. Passou de LIMITE_LINHAS: erro, ou
 * (`passouDoLimite: 'avisar'`, pra leitura que só ajuda, como a memória de
 * classificação) aviso no log e segue com as primeiras.
 */
export async function lerTodas<T>(
  pagina: (de: number, ate: number) => PromiseLike<Resposta<T>>,
  contexto: string,
  { passouDoLimite = 'erro' }: { passouDoLimite?: 'erro' | 'avisar' } = {},
): Promise<T[]> {
  const linhas: T[] = [];
  // pede até LIMITE_LINHAS + 1 linhas: a que sobra é o sinal de que passou
  for (let de = 0; de <= LIMITE_LINHAS; de += PAGINA) {
    const ate = Math.min(de + PAGINA - 1, LIMITE_LINHAS);
    const { data, error } = await pagina(de, ate);
    if (error) throw mapPgrstError(error, contexto);
    const lote = data ?? [];
    linhas.push(...lote);
    if (lote.length < ate - de + 1) break;
  }
  if (linhas.length > LIMITE_LINHAS) {
    const limite = LIMITE_LINHAS.toLocaleString('pt-BR');
    if (passouDoLimite === 'erro') {
      throw badRequest(`Mais de ${limite} registros ao ${contexto} — acima do limite do sistema.`);
    }
    logger.warn({ contexto }, `mais de ${limite} registros — usando só os primeiros`);
    linhas.length = LIMITE_LINHAS;
  }
  return linhas;
}

/** Divide uma lista em lotes: `.in()` com milhares de ids estoura o tamanho de
 *  URL aceito pelo gateway do Supabase. */
export function emLotes<T>(itens: T[], tamanho = 100): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}
