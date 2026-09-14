import { config } from '../config.js';
import { badGateway, unprocessable } from '../lib/httpError.js';

export type PlanoContaItem = {
  codigo: string;
  tipo: 'S' | 'A';
  classificacao: string;
  nome: string;
  grau: number;
};

export type PlanoContasParseResult = {
  items: PlanoContaItem[];
  warnings: string[];
};

export type BalanceteContaItem = {
  codigo: string;
  nome: string;
  tipo: 'S' | 'A';
  saldo_anterior_cents: number;
  saldo_anterior_natureza: 'D' | 'C' | null;
  debito_cents: number;
  credito_cents: number;
  saldo_atual_cents: number;
  saldo_atual_natureza: 'D' | 'C' | null;
};

export type BalanceteParseResult = {
  periodo: { ano: number; mes: number };
  items: BalanceteContaItem[];
  warnings: string[];
};

type ParserErrorBody = { error?: string; code?: string };

/** Chama um endpoint /parse/... do serviço Python. Erros do parser viram 422. */
async function callParser<T>(
  path: string,
  file: { buffer: Buffer; originalname: string; mimetype: string },
  opts: { pdfPassword?: string } = {},
): Promise<T> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' }),
    file.originalname || 'arquivo.pdf',
  );
  if (opts.pdfPassword) form.append('pdf_password', opts.pdfPassword);

  const headers: Record<string, string> = {};
  if (config.parser.sharedSecret) headers['X-Parser-Secret'] = config.parser.sharedSecret;

  let res: Response;
  try {
    res = await fetch(`${config.parser.url}${path}`, {
      method: 'POST',
      body: form,
      headers,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw badGateway('Serviço de leitura de PDF indisponível', {
      detail: (err as Error).message,
    });
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (res.status === 422) {
    const b = (body ?? {}) as ParserErrorBody;
    throw unprocessable(b.error ?? 'Não foi possível ler o arquivo', { code: b.code });
  }
  if (!res.ok) {
    throw badGateway(`Parser retornou HTTP ${res.status}`, { detail: body });
  }

  return body as T;
}

export async function callPlanoContasParser(
  file: { buffer: Buffer; originalname: string; mimetype: string },
  opts: { pdfPassword?: string } = {},
): Promise<PlanoContasParseResult> {
  return callParser<PlanoContasParseResult>('/parse/plano-contas', file, opts);
}

export async function callBalanceteParser(
  file: { buffer: Buffer; originalname: string; mimetype: string },
  opts: { pdfPassword?: string } = {},
): Promise<BalanceteParseResult> {
  return callParser<BalanceteParseResult>('/parse/balancete', file, opts);
}
