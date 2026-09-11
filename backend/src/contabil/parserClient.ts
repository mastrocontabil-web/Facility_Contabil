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

type ParserErrorBody = { error?: string; code?: string };

/** Chama o serviço Python de parsing do plano de contas. Erros do parser viram 422. */
export async function callPlanoContasParser(
  file: { buffer: Buffer; originalname: string; mimetype: string },
  opts: { pdfPassword?: string } = {},
): Promise<PlanoContasParseResult> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' }),
    file.originalname || 'plano-de-contas.pdf',
  );
  if (opts.pdfPassword) form.append('pdf_password', opts.pdfPassword);

  const headers: Record<string, string> = {};
  if (config.parser.sharedSecret) headers['X-Parser-Secret'] = config.parser.sharedSecret;

  let res: Response;
  try {
    res = await fetch(`${config.parser.url}/parse/plano-contas`, {
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
    throw unprocessable(b.error ?? 'Não foi possível ler o plano de contas', { code: b.code });
  }
  if (!res.ok) {
    throw badGateway(`Parser retornou HTTP ${res.status}`, { detail: body });
  }

  return body as PlanoContasParseResult;
}
