import { config } from '../config.js';
import { badGateway, unprocessable } from '../lib/httpError.js';

export type ParsedTransaction = {
  date: string;
  description: string;
  amount_cents: number;
  direction: 'entrada' | 'saida';
  raw: Record<string, unknown>;
};

export type ParseResult = {
  format: 'pdf' | 'ofx' | 'csv' | 'xls' | 'xlsx';
  bank_id: string | null;
  account_id: string | null;
  period_start: string | null;
  period_end: string | null;
  transactions: ParsedTransaction[];
  warnings: string[];
};

type ParserErrorBody = { error?: string; code?: string; hint?: string; format?: string };

/** Chama o serviço Python de parsing. Erros do parser viram 422 (mensagem pro usuário). */
export async function callParser(
  file: { buffer: Buffer; originalname: string; mimetype: string },
  opts: { pdfPassword?: string } = {},
): Promise<ParseResult> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' }),
    file.originalname || 'extrato',
  );
  if (opts.pdfPassword) form.append('pdf_password', opts.pdfPassword);

  const headers: Record<string, string> = {};
  if (config.parser.sharedSecret) headers['X-Parser-Secret'] = config.parser.sharedSecret;

  let res: Response;
  try {
    res = await fetch(`${config.parser.url}/parse`, {
      method: 'POST',
      body: form,
      headers,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw badGateway('Serviço de leitura de extrato indisponível', {
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
    throw unprocessable(b.error ?? 'Não foi possível ler o extrato', {
      code: b.code,
      hint: b.hint,
      format: b.format,
    });
  }
  if (!res.ok) {
    throw badGateway(`Parser retornou HTTP ${res.status}`, { detail: body });
  }

  return body as ParseResult;
}
