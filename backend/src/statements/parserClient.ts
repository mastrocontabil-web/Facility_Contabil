import { config } from '../config.js';
import { badGateway, unprocessable } from '../lib/httpError.js';
import type { ExcelMapeamento } from './schema.js';

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

/** Célula da planilha: texto, e já lida como data (ISO) e valor (centavos com sinal) quando der. */
export type PlanilhaCelula = { t: string; d?: string; v?: number };

/** Uma aba de planilha como grade — a tela da "Nova importação Excel" escolhe as colunas em cima dela. */
export type Planilha = {
  formato: 'xls' | 'xlsx';
  abas: Array<{ nome: string; oculta?: boolean }>;
  aba: number;
  colunas: number;
  linhas: Array<{ n: number; c: Array<PlanilhaCelula | null> }>;
  total_linhas: number;
  truncado: boolean;
  sugestao?: { data?: number; valor?: number; historico?: number[] };
};

type Arquivo = { buffer: Buffer; originalname: string; mimetype: string };
type ParserErrorBody = { error?: string; code?: string; hint?: string; format?: string };

function formComArquivo(file: Arquivo): FormData {
  const form = new FormData();
  form.append(
    'file',
    new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' }),
    file.originalname || 'extrato',
  );
  return form;
}

const COM_ARTIGO = { extrato: 'o extrato', planilha: 'a planilha' } as const;

/** POST no serviço Python de parsing. Erros do parser viram 422 (mensagem pro usuário). */
async function postParser<T>(path: string, form: FormData, oQue: keyof typeof COM_ARTIGO): Promise<T> {
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
    throw badGateway(`Serviço de leitura de ${oQue} indisponível`, {
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
    throw unprocessable(b.error ?? `Não foi possível ler ${COM_ARTIGO[oQue]}`, {
      code: b.code,
      hint: b.hint,
      format: b.format,
    });
  }
  if (!res.ok) {
    throw badGateway(`Parser retornou HTTP ${res.status}`, { detail: body });
  }

  return body as T;
}

/** Extrato lido automaticamente (PDF/OFX/CSV/planilha de banco). */
export async function callParser(file: Arquivo, opts: { pdfPassword?: string } = {}): Promise<ParseResult> {
  const form = formComArquivo(file);
  if (opts.pdfPassword) form.append('pdf_password', opts.pdfPassword);
  return postParser<ParseResult>('/parse', form, 'extrato');
}

/** Nova importação Excel, etapa 1: a aba da planilha como grade (sem `aba`, a aba ativa). */
export async function lerPlanilha(file: Arquivo, aba?: number): Promise<Planilha> {
  const form = formComArquivo(file);
  if (aba !== undefined) form.append('aba', String(aba));
  return postParser<Planilha>('/excel/planilha', form, 'planilha');
}

/** Nova importação Excel, etapa 2: os lançamentos pelas colunas escolhidas. */
export async function callParserExcel(file: Arquivo, mapeamento: ExcelMapeamento): Promise<ParseResult> {
  const form = formComArquivo(file);
  form.append('mapeamento', JSON.stringify(mapeamento));
  return postParser<ParseResult>('/parse/excel', form, 'planilha');
}
