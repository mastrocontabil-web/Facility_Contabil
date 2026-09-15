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

export type RelatorioCliente = { razao_social: string; cnpj: string };
type RelatorioPeriodo = { ano: number; mes: number };
type ResultadoFigura = { cents: number; natureza: 'D' | 'C' | null };

export type GerarBalancetePdfPayload = {
  cliente: RelatorioCliente;
  periodo: RelatorioPeriodo;
  linhas: BalanceteContaItem[];
};

export type GerarDrePdfPayload = {
  cliente: RelatorioCliente;
  periodo: RelatorioPeriodo;
  receitas: { raiz: BalanceteContaItem; linhas: BalanceteContaItem[] };
  despesas: { raiz: BalanceteContaItem; linhas: BalanceteContaItem[] };
  resultado_mes: ResultadoFigura;
  resultado_exercicio: ResultadoFigura;
};

/**
 * Chama um endpoint /gerar/...-pdf do parser: manda JSON, recebe bytes de
 * volta. Sentido oposto de callParser<T> (que manda FormData e recebe JSON) —
 * por isso não reusa aquela função. Sem o caso especial de 422 de lá: aqui os
 * dois lados da chamada são código nosso, então qualquer não-2xx é bug de
 * formato de payload (nosso), não entrada de usuário — tudo vira badGateway.
 */
async function callGerarPdf(path: string, payload: unknown): Promise<Buffer> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.parser.sharedSecret) headers['X-Parser-Secret'] = config.parser.sharedSecret;

  let res: Response;
  try {
    res = await fetch(`${config.parser.url}${path}`, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw badGateway('Serviço de geração de PDF indisponível', { detail: (err as Error).message });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw badGateway(`Parser retornou HTTP ${res.status} ao gerar PDF`, { detail });
  }

  return Buffer.from(await res.arrayBuffer());
}

export async function callGerarBalancetePdf(payload: GerarBalancetePdfPayload): Promise<Buffer> {
  return callGerarPdf('/gerar/balancete-pdf', payload);
}

export async function callGerarDrePdf(payload: GerarDrePdfPayload): Promise<Buffer> {
  return callGerarPdf('/gerar/dre-pdf', payload);
}

type RazaoLinhaPayload = {
  data: string;
  historico_codigo: string | null;
  historico_complemento: string;
  tipo: 'D' | 'C';
  valor_cents: number;
  saldo_cents: number;
  saldo_natureza: 'D' | 'C' | null;
};

export type GerarRazaoPdfPayload = {
  cliente: RelatorioCliente;
  periodo: RelatorioPeriodo;
  conta: { codigo: string; nome: string };
  saldo_anterior_cents: number;
  saldo_anterior_natureza: 'D' | 'C' | null;
  linhas: RazaoLinhaPayload[];
  saldo_atual_cents: number;
  saldo_atual_natureza: 'D' | 'C' | null;
};

type LivroDiarioLancamentoPayload = {
  data: string;
  historico_codigo: string | null;
  historico_complemento: string;
  partidas: Array<{ conta_codigo: string; conta_nome: string; tipo: 'D' | 'C'; valor_cents: number }>;
};

export type GerarLivroDiarioPdfPayload = {
  cliente: RelatorioCliente;
  periodo: RelatorioPeriodo;
  lancamentos: LivroDiarioLancamentoPayload[];
};

export async function callGerarRazaoPdf(payload: GerarRazaoPdfPayload): Promise<Buffer> {
  return callGerarPdf('/gerar/razao-pdf', payload);
}

export async function callGerarLivroDiarioPdf(payload: GerarLivroDiarioPdfPayload): Promise<Buffer> {
  return callGerarPdf('/gerar/livro-diario-pdf', payload);
}
