/**
 * Exportador do arquivo "Lançamentos Contábeis em Lote" (Leiaute Domínio
 * Sistemas). Formato validado byte-a-byte contra um EXPORT REAL do Domínio
 * (`Utilitários > Exportação > Lançamentos`), não contra o modelo antigo.
 *
 * - Texto posicional, SEM BOM, encoding Latin-1 (Windows-1252).
 * - Quebras CRLF, inclusive depois da última linha.
 * - Registros: 01 (cabeçalho, 55) · 02 (lançamento, 165) + 03 (partida, 664)
 *   por lançamento · 99 (rodapé, 100). Sequencial GLOBAL: 02 ímpar, 03 par.
 * - Entrada  → débito no banco,  crédito na contrapartida.
 * - Saída    → débito na contrapartida, crédito no banco.
 */
import { createHash } from 'node:crypto';
import { composeComplemento, type ComplementoModo } from './complemento.js';

export type ExportLancamento = {
  data: string; // ISO 'YYYY-MM-DD'
  ordem: number; // ordem de origem (0..n)
  direction: 'entrada' | 'saida';
  valor_cents: number;
  conta_contabil: string; // contrapartida (só dígitos, já validada)
  hist_code: string;
  descricao_raw: string;
  hist_complemento: string;
  classificacao_nome?: string;
};

export type ExportInput = {
  empresa_dominio: string; // clients.dominio_code
  cnpj: string; // só dígitos (11 ou 14)
  periodo_inicio: string; // ISO
  periodo_fim: string; // ISO
  lote_numero: number;
  conta_banco: string; // só dígitos
  complemento_modo: ComplementoModo;
  lancamentos: ExportLancamento[];
};

export type ExportResult = {
  content: Buffer; // Latin-1, sem BOM
  filename: string;
  linhas: number; // total de registros (01 + 2·n + 99)
  qtd_lancamentos: number;
  total_debito_cents: number;
  total_credito_cents: number;
  sha256: string;
};

export class ExportError extends Error {
  detalhes: unknown;
  constructor(message: string, detalhes?: unknown) {
    super(message);
    this.name = 'ExportError';
    this.detalhes = detalhes;
  }
}

// Larguras fixas do leiaute (em caracteres).
const CONTA_LEN = 7; // conta reduzida no registro 03 — SEMPRE 7 (zero à esquerda)
const HIST_LEN = 7; // código de histórico no registro 03 — 7 dígitos
const COMPLEMENTO_LEN = 512;
const REC01_LEN = 55;
const REC02_LEN = 165;
const REC03_LEN = 664;
const REC02_FLAG_POS = 65; // posição da flag "N" no registro 02

const pad0 = (v: string | number, n: number) => String(v).padStart(n, '0');
const padR = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
const onlyDigits = (s: string) => (s ?? '').replace(/\D/g, '');
const centsField = (c: number) => pad0(Math.round(Math.abs(c)), 15);

function brDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new ExportError(`data inválida: ${iso}`);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Deixa o texto pronto pro campo posicional: uppercase, sem quebras, e só
 *  caracteres que existem em Latin-1 (o resto vira aproximação ASCII). */
function sanitize(texto: string): string {
  return texto
    .toUpperCase()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\xFF]/g, ''); // fora do Latin-1
}

export function buildDominioFile(input: ExportInput): ExportResult {
  const {
    empresa_dominio,
    cnpj,
    periodo_inicio,
    periodo_fim,
    lote_numero,
    conta_banco,
    complemento_modo,
    lancamentos,
  } = input;

  if (!lancamentos.length) throw new ExportError('Nenhum lançamento para exportar.');

  const empresa = onlyDigits(empresa_dominio);
  const cnpjD = onlyDigits(cnpj);
  const banco = onlyDigits(conta_banco);
  if (!empresa) throw new ExportError('Cliente sem código do Domínio.');
  if (!cnpjD) throw new ExportError('Cliente sem CNPJ/CPF.');
  if (!banco) throw new ExportError('Defina a conta contábil do banco.');
  if (banco.length > CONTA_LEN) {
    throw new ExportError(`A conta contábil do banco (${banco}) tem mais de ${CONTA_LEN} dígitos.`);
  }

  const semConta = lancamentos.filter((l) => !onlyDigits(l.conta_contabil));
  if (semConta.length) {
    throw new ExportError(`${semConta.length} lançamento(s) sem conta contábil.`, {
      ordens: semConta.map((l) => l.ordem),
    });
  }
  const semHist = lancamentos.filter((l) => !/^\d{1,7}$/.test((l.hist_code ?? '').trim()));
  if (semHist.length) {
    throw new ExportError(`${semHist.length} lançamento(s) sem código de histórico.`, {
      ordens: semHist.map((l) => l.ordem),
    });
  }
  const contaLonga = lancamentos.find((l) => onlyDigits(l.conta_contabil).length > CONTA_LEN);
  if (contaLonga) {
    throw new ExportError(
      `A conta ${onlyDigits(contaLonga.conta_contabil)} tem mais de ${CONTA_LEN} dígitos.`,
    );
  }

  const B = pad0(banco, CONTA_LEN);
  const empresaField = pad0(empresa, CONTA_LEN);
  const ordenado = [...lancamentos].sort(
    (a, b) => a.data.localeCompare(b.data) || a.ordem - b.ordem,
  );

  const linhas: string[] = [];

  // 01 — cabeçalho (55)
  linhas.push(
    padR(
      `01${pad0(empresa, 7)}${pad0(cnpjD, 14)}${brDate(periodo_inicio)}${brDate(periodo_fim)}` +
        `N05${pad0(lote_numero, 8)}1`,
      REC01_LEN,
    ),
  );

  let totalCents = 0;
  ordenado.forEach((t, i) => {
    const C = pad0(onlyDigits(t.conta_contabil), CONTA_LEN);
    const [deb, cred] = t.direction === 'entrada' ? [B, C] : [C, B];
    const compl = padR(
      sanitize(
        composeComplemento(complemento_modo, t.descricao_raw, t.hist_complemento, t.classificacao_nome),
      ).replace(/ +$/, ''),
      COMPLEMENTO_LEN,
    );
    totalCents += Math.round(Math.abs(t.valor_cents));

    // 02 — lançamento (165): campo de texto livre fica em branco; flag "N"
    let r02 = `02${pad0(2 * i + 1, 7)}X${brDate(t.data)}`;
    r02 = padR(r02, REC02_FLAG_POS) + 'N';
    linhas.push(padR(r02, REC02_LEN));

    // 03 — partida (664)
    const r03 =
      `03${pad0(2 * i + 2, 7)}${deb}${cred}${centsField(t.valor_cents)}` +
      `${pad0(onlyDigits(t.hist_code), HIST_LEN)}${compl}${empresaField}`;
    linhas.push(padR(r03, REC03_LEN));
  });

  linhas.push('9'.repeat(100));

  const content = Buffer.from(linhas.join('\r\n') + '\r\n', 'latin1');
  const mm = brDate(periodo_fim).slice(3, 5);
  const yyyy = brDate(periodo_fim).slice(6);

  return {
    content,
    filename: `(${empresa}) Dominio ${mm}-${yyyy}.txt`,
    linhas: linhas.length,
    qtd_lancamentos: ordenado.length,
    total_debito_cents: totalCents,
    total_credito_cents: totalCents,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

// ============================================================================
// Exportação a partir do módulo Contábil (C7) — lançamento já vem com D/C
// explícito por partida (não por direção entrada/saída), e pode ter mais de
// uma partida de cada lado (partida múltipla). Reusa os mesmos primitivos de
// layout acima; NÃO reusa `ExportLancamento`/`ExportInput`/`buildDominioFile`
// (formato de entrada incompatível) nem os altera.
// ============================================================================

export type ExportContabilPartida = {
  plano_conta_codigo: string; // só dígitos, já validada
  tipo: 'D' | 'C';
  valor_cents: number;
  ordem: number;
};

export type ExportContabilLancamento = {
  data: string; // ISO 'YYYY-MM-DD'
  created_at: string; // ISO timestamp — desempate de ordem entre lançamentos do mesmo dia
  historico_codigo: string | null; // null = sem código padrão (lançamento em texto livre)
  historico_complemento: string;
  partidas: ExportContabilPartida[];
};

export type ExportContabilInput = {
  empresa_dominio: string; // clients.dominio_code
  cnpj: string;
  periodo_inicio: string; // ISO
  periodo_fim: string; // ISO
  lote_numero: number;
  lancamentos: ExportContabilLancamento[];
};

export type ExportContabilResult = {
  content: Buffer;
  filename: string;
  linhas: number;
  qtd_lancamentos: number;
  total_debito_cents: number;
  total_credito_cents: number;
  sha256: string;
  /** Lançamentos com mais de 1 débito ou crédito, decompostos em pares
   *  elementares — leiaute nunca validado contra um export real do Domínio
   *  com partida múltipla (ver docs/leiaute-dominio.md). Conferir no 1º uso. */
  warnings: string[];
};

/**
 * Decompõe uma lista de partidas (N débitos + M créditos, já validado que
 * ΣD=ΣC pelo chamador) numa sequência de pares débito/crédito elementares —
 * cada par usa o menor valor "restante" entre a cabeça das duas filas,
 * consumindo (e dividindo, se preciso) o lado maior. Ex: D A 100 / C B 60 /
 * C C 40 -> [(A,B,60), (A,C,40)]. Decisão do usuário pra C7: leiaute real do
 * Domínio pra partida múltipla nunca foi decodificado; isso é o melhor
 * esforço, a confirmar no 1º export real (mesmo espírito das pendências já
 * documentadas em docs/leiaute-dominio.md).
 */
function decomporPartidas(
  partidas: ExportContabilPartida[],
): Array<{ debito: string; credito: string; valor_cents: number }> {
  const debitos = partidas
    .filter((p) => p.tipo === 'D')
    .sort((a, b) => a.ordem - b.ordem)
    .map((p) => ({ conta: p.plano_conta_codigo, resto: p.valor_cents }));
  const creditos = partidas
    .filter((p) => p.tipo === 'C')
    .sort((a, b) => a.ordem - b.ordem)
    .map((p) => ({ conta: p.plano_conta_codigo, resto: p.valor_cents }));

  const pares: Array<{ debito: string; credito: string; valor_cents: number }> = [];
  let i = 0;
  let j = 0;
  while (i < debitos.length && j < creditos.length) {
    const d = debitos[i]!;
    const c = creditos[j]!;
    const valor = Math.min(d.resto, c.resto);
    pares.push({ debito: d.conta, credito: c.conta, valor_cents: valor });
    d.resto -= valor;
    c.resto -= valor;
    if (d.resto === 0) i++;
    if (c.resto === 0) j++;
  }
  return pares;
}

export function buildDominioFileFromLancamentos(input: ExportContabilInput): ExportContabilResult {
  const { empresa_dominio, cnpj, periodo_inicio, periodo_fim, lote_numero, lancamentos } = input;

  if (!lancamentos.length) throw new ExportError('Nenhum lançamento para exportar.');

  const empresa = onlyDigits(empresa_dominio);
  const cnpjD = onlyDigits(cnpj);
  if (!empresa) throw new ExportError('Cliente sem código do Domínio.');
  if (!cnpjD) throw new ExportError('Cliente sem CNPJ/CPF.');

  // Nunca decompor um lançamento cuja soma D/C não fecha — o algoritmo
  // assume ΣD=ΣC (só o zod garante isso na escrita, não há CHECK cruzando
  // linhas em lancamento_partidas); sem essa revalidação aqui, uma
  // divergência (bug futuro, correção manual no banco) faria uma das filas
  // esvaziar primeiro e o resto sumir do arquivo SEM erro nenhum.
  lancamentos.forEach((l, idx) => {
    const somaD = l.partidas.filter((p) => p.tipo === 'D').reduce((s, p) => s + p.valor_cents, 0);
    const somaC = l.partidas.filter((p) => p.tipo === 'C').reduce((s, p) => s + p.valor_cents, 0);
    if (somaD !== somaC) {
      throw new ExportError(
        `Lançamento de ${l.data} (posição ${idx}) tem débito (${somaD}) diferente de crédito (${somaC}) — não pode ser exportado.`,
      );
    }
  });

  const contaLonga = lancamentos
    .flatMap((l) => l.partidas)
    .find((p) => onlyDigits(p.plano_conta_codigo).length > CONTA_LEN);
  if (contaLonga) {
    throw new ExportError(
      `A conta ${onlyDigits(contaLonga.plano_conta_codigo)} tem mais de ${CONTA_LEN} dígitos.`,
    );
  }

  const empresaField = pad0(empresa, CONTA_LEN);
  const ordenado = [...lancamentos].sort(
    (a, b) => a.data.localeCompare(b.data) || a.created_at.localeCompare(b.created_at),
  );

  const linhas: string[] = [];
  const warnings: string[] = [];

  // 01 — cabeçalho (55) — idêntico ao de buildDominioFile
  linhas.push(
    padR(
      `01${pad0(empresa, 7)}${pad0(cnpjD, 14)}${brDate(periodo_inicio)}${brDate(periodo_fim)}` +
        `N05${pad0(lote_numero, 8)}1`,
      REC01_LEN,
    ),
  );

  // Sequencial GLOBAL único: +1 a cada registro 02 OU 03 emitido, em ordem
  // de arquivo. No caso 1 par por lançamento isso reproduz exatamente
  // 02=2i+1/03=2i+2 de hoje — mas "02 ímpar, 03 par" deixa de valer a
  // partir do primeiro lançamento com mais de um par (inevitável quando a
  // multiplicidade varia; ver pendência nova em docs/leiaute-dominio.md).
  let seq = 0;
  const proximoSeq = () => {
    seq += 1;
    return seq;
  };

  let totalDebitoCents = 0;
  let totalCreditoCents = 0;

  ordenado.forEach((l) => {
    // 02 — lançamento (165): campo de texto livre fica em branco; flag "N"
    let r02 = `02${pad0(proximoSeq(), 7)}X${brDate(l.data)}`;
    r02 = padR(r02, REC02_FLAG_POS) + 'N';
    linhas.push(padR(r02, REC02_LEN));

    const pares = decomporPartidas(l.partidas);
    if (pares.length > 1) {
      warnings.push(
        `Lançamento de ${l.data} ("${l.historico_complemento}") tem partida múltipla — ` +
          `decomposto em ${pares.length} registros 03. Layout não validado contra export real do Domínio.`,
      );
    }

    const histField = pad0(onlyDigits(l.historico_codigo ?? '0'), HIST_LEN);
    const compl = padR(sanitize(l.historico_complemento).replace(/ +$/, ''), COMPLEMENTO_LEN);

    for (const par of pares) {
      const deb = pad0(onlyDigits(par.debito), CONTA_LEN);
      const cred = pad0(onlyDigits(par.credito), CONTA_LEN);
      totalDebitoCents += Math.round(Math.abs(par.valor_cents));
      totalCreditoCents += Math.round(Math.abs(par.valor_cents));

      // 03 — partida (664)
      const r03 =
        `03${pad0(proximoSeq(), 7)}${deb}${cred}${centsField(par.valor_cents)}` +
        `${histField}${compl}${empresaField}`;
      linhas.push(padR(r03, REC03_LEN));
    }
  });

  linhas.push('9'.repeat(100));

  const content = Buffer.from(linhas.join('\r\n') + '\r\n', 'latin1');
  const mm = brDate(periodo_fim).slice(3, 5);
  const yyyy = brDate(periodo_fim).slice(6);

  return {
    content,
    filename: `(${empresa}) Dominio ${mm}-${yyyy}.txt`,
    linhas: linhas.length,
    qtd_lancamentos: ordenado.length,
    total_debito_cents: totalDebitoCents,
    total_credito_cents: totalCreditoCents,
    sha256: createHash('sha256').update(content).digest('hex'),
    warnings,
  };
}
