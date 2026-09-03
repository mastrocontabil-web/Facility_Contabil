import { env } from './env';
import { supabase } from './supabase';

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

type ApiOptions = Omit<RequestInit, 'body'> & { body?: unknown; auth?: boolean };

/**
 * fetch com base no backend + injeção automática do token do Supabase.
 * `path` começa com "/api/...".
 */
export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { body, auth = true, headers, ...rest } = opts;

  const finalHeaders = new Headers(headers);
  let payload: BodyInit | undefined;

  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    finalHeaders.set('Content-Type', 'application/json');
    payload = JSON.stringify(body);
  }

  if (auth) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) finalHeaders.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${env.apiUrl}${path}`, { ...rest, headers: finalHeaders, body: payload });

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const body = (data ?? {}) as { error?: unknown; details?: unknown };
    const message = typeof body.error === 'string' ? body.error : `Erro ${res.status}`;
    throw new ApiError(res.status, message, body.details);
  }

  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * POST/GET que devolve um arquivo. Retorna o blob + o nome sugerido pelo
 * Content-Disposition + os headers. Erros viram ApiError (lê o JSON de erro).
 */
export async function apiDownload(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<{ blob: Blob; filename: string; headers: Headers }> {
  const headers = new Headers();
  let payload: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    payload = JSON.stringify(opts.body);
  }
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${env.apiUrl}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: payload,
  });

  if (!res.ok) {
    const body = (safeJson(await res.text().catch(() => '')) ?? {}) as {
      error?: unknown;
      details?: unknown;
    };
    const message = typeof body.error === 'string' ? body.error : `Erro ${res.status}`;
    throw new ApiError(res.status, message, body.details);
  }

  const cd = res.headers.get('content-disposition') ?? '';
  const filename = /filename="?([^"]+)"?/.exec(cd)?.[1] ?? 'download.txt';
  return { blob: await res.blob(), filename, headers: res.headers };
}

/** Dispara o download de um blob no navegador. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
