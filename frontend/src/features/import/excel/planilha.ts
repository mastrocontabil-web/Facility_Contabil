import type { ExcelMapeamento, Planilha } from '@/lib/types';

/** Função de cada coluna escolhida na tela (null = ainda não escolhida). */
export type Colunas = { data: number | null; valor: number | null; historico: number[] };
export type Funcao = 'data' | 'valor' | 'historico';

export type Situacao = 'entra' | 'sem_data' | 'sem_valor' | 'valor_zero';

/** Uma linha da planilha lida pelas colunas escolhidas. */
export type LinhaLida = {
  n: number;
  situacao: Situacao;
  /** histórico começa com "saldo"/"total": nasce fora da importação */
  pareceSaldo: boolean;
  data?: string;
  /** centavos com sinal: negativo = saída, positivo = entrada */
  valor?: number;
  historico: string;
};

export const SEM_COLUNAS: Colunas = { data: null, valor: null, historico: [] };

/** 0 → A, 25 → Z, 26 → AA. */
export function letraColuna(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function funcaoDa(colunas: Colunas, col: number): Funcao | null {
  if (colunas.data === col) return 'data';
  if (colunas.valor === col) return 'valor';
  return colunas.historico.includes(col) ? 'historico' : null;
}

/** Dá uma função à coluna. Data e Valor são de uma coluna só (escolher em outra
 *  tira da anterior); Histórico pode ter várias — os textos são juntados. */
export function definirFuncao(colunas: Colunas, col: number, funcao: Funcao | null): Colunas {
  const sem: Colunas = {
    data: colunas.data === col ? null : colunas.data,
    valor: colunas.valor === col ? null : colunas.valor,
    historico: colunas.historico.filter((h) => h !== col),
  };
  if (funcao === 'data') return { ...sem, data: col };
  if (funcao === 'valor') return { ...sem, valor: col };
  if (funcao === 'historico') return { ...sem, historico: [...sem.historico, col].sort((a, b) => a - b) };
  return sem;
}

/** Só as colunas que existem numa planilha com `n` colunas. */
export function colunasQueCabem(colunas: Colunas, n: number): Colunas {
  const cabe = (i: number | null) => i != null && i < n;
  return {
    data: cabe(colunas.data) ? colunas.data : null,
    valor: cabe(colunas.valor) ? colunas.valor : null,
    historico: colunas.historico.filter(cabe),
  };
}

/** Colunas pra abrir a tela: as da última importação Excel do cliente, senão as
 *  achadas pelo cabeçalho da planilha. */
export function colunasIniciais(
  planilha: Planilha,
  anterior: ExcelMapeamento | null,
): { colunas: Colunas; origem: 'anterior' | 'cabecalho' | null } {
  if (anterior) {
    const c = colunasQueCabem(
      { data: anterior.data, valor: anterior.valor, historico: anterior.historico },
      planilha.colunas,
    );
    if (c.data != null && c.valor != null && c.historico.length) return { colunas: c, origem: 'anterior' };
  }
  const s = planilha.sugestao;
  if (s) {
    const c = colunasQueCabem(
      { data: s.data ?? null, valor: s.valor ?? null, historico: s.historico ?? [] },
      planilha.colunas,
    );
    if (c.data != null || c.valor != null || c.historico.length) return { colunas: c, origem: 'cabecalho' };
  }
  return { colunas: SEM_COLUNAS, origem: null };
}

// "saldo", "saldo anterior", "saldo do dia", "total", "subtotal"... — mas não
// "saldo de salário". Mesma regra do teste da bateria (parser/tests/test_sefip_bancos.py).
const PARECE_SALDO = /^(s\s*a\s*l\s*d\s*o\b(?!\s+de\b)|(sub\s*)?tota(l|is)\b)/;

function normalizar(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Lê cada linha pelas colunas escolhidas. Mesma ordem de checagem do parser
 * (`parse_planilha` em parser/app/parsers/planilha.py) — a prévia bate com o
 * que é gravado: sem data → fora; sem valor → fora; valor zero → fora.
 */
export function lerLinhas(planilha: Planilha, colunas: Colunas): LinhaLida[] {
  const historico = [...colunas.historico].sort((a, b) => a - b);
  return planilha.linhas.map((l) => {
    const cel = (i: number | null) => (i == null ? null : (l.c[i] ?? null));
    const texto = historico
      .map((i) => cel(i)?.t ?? '')
      .filter(Boolean)
      .join(' - ');
    const data = cel(colunas.data)?.d;
    const valor = cel(colunas.valor)?.v;
    const situacao: Situacao = !data
      ? 'sem_data'
      : valor == null
        ? 'sem_valor'
        : valor === 0
          ? 'valor_zero'
          : 'entra';
    return {
      n: l.n,
      situacao,
      pareceSaldo: situacao === 'entra' && PARECE_SALDO.test(normalizar(texto)),
      data: data ?? undefined,
      valor: valor ?? undefined,
      historico: texto,
    };
  });
}

/** Vai pra importação? As que "entram", menos as de saldo/total — o operador
 *  inverte qualquer uma delas (`invertidas`). */
export function incluida(l: LinhaLida, invertidas: ReadonlySet<number>): boolean {
  if (l.situacao !== 'entra') return false;
  return l.pareceSaldo ? invertidas.has(l.n) : !invertidas.has(l.n);
}

export type Resumo = {
  lancamentos: number;
  entradas: { n: number; cents: number };
  saidas: { n: number; cents: number };
  inicio: string | null;
  fim: string | null;
  fora: { total: number; semData: number; semValor: number; zero: number; saldo: number; tiradas: number };
};

export function resumir(linhas: LinhaLida[], invertidas: ReadonlySet<number>): Resumo {
  const r: Resumo = {
    lancamentos: 0,
    entradas: { n: 0, cents: 0 },
    saidas: { n: 0, cents: 0 },
    inicio: null,
    fim: null,
    fora: { total: 0, semData: 0, semValor: 0, zero: 0, saldo: 0, tiradas: 0 },
  };
  for (const l of linhas) {
    if (incluida(l, invertidas)) {
      r.lancamentos++;
      const lado = l.valor! < 0 ? r.saidas : r.entradas;
      lado.n++;
      lado.cents += Math.abs(l.valor!);
      if (!r.inicio || l.data! < r.inicio) r.inicio = l.data!;
      if (!r.fim || l.data! > r.fim) r.fim = l.data!;
      continue;
    }
    r.fora.total++;
    if (l.situacao === 'sem_data') r.fora.semData++;
    else if (l.situacao === 'sem_valor') r.fora.semValor++;
    else if (l.situacao === 'valor_zero') r.fora.zero++;
    else if (l.pareceSaldo) r.fora.saldo++;
    else r.fora.tiradas++;
  }
  return r;
}

/** A escolha que vai pro backend — null enquanto falta Data, Valor ou Histórico. */
export function mapeamentoFinal(
  aba: number,
  colunas: Colunas,
  linhas: LinhaLida[],
  invertidas: ReadonlySet<number>,
): ExcelMapeamento | null {
  if (colunas.data == null || colunas.valor == null || !colunas.historico.length) return null;
  return {
    aba,
    data: colunas.data,
    valor: colunas.valor,
    historico: [...colunas.historico].sort((a, b) => a - b),
    excluir: linhas.filter((l) => l.situacao === 'entra' && !incluida(l, invertidas)).map((l) => l.n),
  };
}
