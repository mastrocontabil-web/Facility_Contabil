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
      sanitize(composeComplemento(complemento_modo, t.descricao_raw, t.hist_complemento)).replace(
        / +$/,
        '',
      ),
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
