import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildDominioFile,
  buildDominioFileFromLancamentos,
  ExportError,
  type ExportContabilLancamento,
  type ExportLancamento,
} from './exporter.js';

function lanc(over: Partial<ExportLancamento>): ExportLancamento {
  return {
    data: '2026-07-10',
    ordem: 0,
    direction: 'saida',
    valor_cents: 10258,
    conta_contabil: '272',
    hist_code: '186',
    descricao_raw: 'ELASTICO ROLICO',
    hist_complemento: '',
    ...over,
  };
}

const base = {
  empresa_dominio: '168',
  cnpj: '11222333000181',
  periodo_inicio: '2026-07-01',
  periodo_fim: '2026-07-31',
  lote_numero: 1,
  conta_banco: '10002',
  complemento_modo: 'extrato' as const,
};

/** linhas do arquivo, sem BOM, decodificado Latin-1 */
function linhasDe(r: { content: Buffer }): string[] {
  return r.content.toString('latin1').replace(/\r\n$/, '').split('\r\n');
}

describe('buildDominioFile — formato (bate com export real do Domínio)', () => {
  it('SEM BOM, CRLF inclusive no fim, registros 01/02/03/99 com larguras certas', () => {
    const r = buildDominioFile({ ...base, lancamentos: [lanc({})] });
    expect(r.content.slice(0, 2).toString('latin1')).toBe('01'); // nada de BOM antes
    expect(r.content.toString('latin1').endsWith('\r\n')).toBe(true);
    const l = linhasDe(r);
    expect(l).toHaveLength(4);
    expect(l[0]).toHaveLength(55);
    expect(l[1]).toHaveLength(165);
    expect(l[2]).toHaveLength(664);
    expect(l[3]).toBe('9'.repeat(100));
  });

  it('registro 01: empresa/CNPJ zero-pad, datas dd/mm/aaaa, N05 + lote(8) + 1', () => {
    const r = buildDominioFile({ ...base, lote_numero: 18, lancamentos: [lanc({})] });
    expect(linhasDe(r)[0]).toBe('0100001681122233300018101/07/202631/07/2026N05000000181');
  });

  it('registro 02: seq ímpar, X, data, flag N na posição 65', () => {
    const r = buildDominioFile({ ...base, lancamentos: [lanc({ data: '2026-07-10' })] });
    const l02 = linhasDe(r)[1];
    expect(l02.slice(0, 2)).toBe('02');
    expect(l02.slice(2, 9)).toBe('0000001');
    expect(l02.slice(9, 10)).toBe('X');
    expect(l02.slice(10, 20)).toBe('10/07/2026');
    expect(l02[65]).toBe('N');
  });

  it('registro 03 saída: D contrapartida / C banco; cód. histórico é 7 dígitos', () => {
    const r = buildDominioFile({
      ...base,
      lancamentos: [lanc({ direction: 'saida', valor_cents: 10258, hist_code: '186' })],
    });
    const l03 = linhasDe(r)[2];
    expect(l03.slice(0, 2)).toBe('03');
    expect(l03.slice(2, 9)).toBe('0000002');
    expect(l03.slice(9, 16)).toBe('0000272'); // débito = contrapartida
    expect(l03.slice(16, 23)).toBe('0010002'); // crédito = banco
    expect(l03.slice(23, 38)).toBe('000000000010258'); // valor em centavos
    expect(l03.slice(38, 45)).toBe('0000186'); // cód. histórico — 7 dígitos!
    expect(l03.slice(557, 564)).toBe('0000168'); // código da empresa no fim
  });

  it('registro 03 entrada: D banco / C contrapartida', () => {
    const r = buildDominioFile({
      ...base,
      lancamentos: [lanc({ direction: 'entrada', conta_contabil: '10004', hist_code: '138' })],
    });
    const l03 = linhasDe(r)[2];
    expect(l03.slice(9, 16)).toBe('0010002');
    expect(l03.slice(16, 23)).toBe('0010004');
    expect(l03.slice(38, 45)).toBe('0000138');
  });

  it('campos de conta são SEMPRE 7 chars, mesmo em plano de código curto', () => {
    const r = buildDominioFile({
      ...base,
      conta_banco: '10018',
      lancamentos: [lanc({ direction: 'saida', conta_contabil: '467' })],
    });
    const l03 = linhasDe(r)[2];
    expect(l03).toHaveLength(664);
    expect(l03.slice(9, 16)).toBe('0000467');
    expect(l03.slice(16, 23)).toBe('0010018');
  });

  it('ordena cronológico (data asc, ordem asc); sequencial global ímpar/par', () => {
    const r = buildDominioFile({
      ...base,
      lancamentos: [
        lanc({ ordem: 0, data: '2026-07-31', descricao_raw: 'C' }),
        lanc({ ordem: 1, data: '2026-07-01', descricao_raw: 'A' }),
        lanc({ ordem: 2, data: '2026-07-15', descricao_raw: 'B' }),
      ],
    });
    const l = linhasDe(r);
    expect(l[2].slice(45, 46)).toBe('A');
    expect(l[4].slice(45, 46)).toBe('B');
    expect(l[6].slice(45, 46)).toBe('C');
    expect(l[5].slice(2, 9)).toBe('0000005'); // 02 do 3º lançamento
    expect(l[6].slice(2, 9)).toBe('0000006'); // 03 do 3º lançamento
  });

  it('complemento: uppercase, modo "ambos" junta os dois, campo de 512, corta o excesso', () => {
    const r = buildDominioFile({
      ...base,
      complemento_modo: 'ambos',
      lancamentos: [lanc({ descricao_raw: 'pix recebido', hist_complemento: 'venda fisica' })],
    });
    expect(linhasDe(r)[2].slice(45, 557).trimEnd()).toBe('PIX RECEBIDO VENDA FISICA');

    const r2 = buildDominioFile({
      ...base,
      complemento_modo: 'complemento',
      lancamentos: [lanc({ hist_complemento: 'X'.repeat(600) })],
    });
    expect(linhasDe(r2)[2].slice(45, 557)).toBe('X'.repeat(512));
  });

  it('complemento: modo "extrato_classificacao" junta extrato + classificação (ignora hist_complemento)', () => {
    const r = buildDominioFile({
      ...base,
      complemento_modo: 'extrato_classificacao',
      lancamentos: [
        lanc({
          descricao_raw: 'pix recebido',
          hist_complemento: 'ignorado neste modo',
          classificacao_nome: 'agua e esgoto',
        }),
      ],
    });
    expect(linhasDe(r)[2].slice(45, 557).trimEnd()).toBe('PIX RECEBIDO AGUA E ESGOTO');
  });

  it('acento no complemento sobrevive em Latin-1', () => {
    const r = buildDominioFile({
      ...base,
      complemento_modo: 'complemento',
      lancamentos: [lanc({ hist_complemento: 'serviços prestados à vista' })],
    });
    expect(linhasDe(r)[2].slice(45, 557).trimEnd()).toBe('SERVIÇOS PRESTADOS À VISTA');
    // e continua com 664 CARACTERES apesar dos acentos
    expect(linhasDe(r)[2]).toHaveLength(664);
  });

  it('totais de débito e crédito batem (partida dobrada)', () => {
    const r = buildDominioFile({
      ...base,
      lancamentos: [lanc({ valor_cents: 100 }), lanc({ ordem: 1, valor_cents: 250, direction: 'entrada' })],
    });
    expect(r.total_debito_cents).toBe(350);
    expect(r.total_credito_cents).toBe(350);
    expect(r.qtd_lancamentos).toBe(2);
    expect(r.linhas).toBe(6); // 01 + 2·2 + 99
  });
});

describe('buildDominioFile — validação', () => {
  it('sem lançamentos', () => {
    expect(() => buildDominioFile({ ...base, lancamentos: [] })).toThrow(ExportError);
  });
  it('lançamento sem conta contábil', () => {
    expect(() =>
      buildDominioFile({ ...base, lancamentos: [lanc({ conta_contabil: '' })] }),
    ).toThrow(/sem conta contábil/);
  });
  it('lançamento sem código de histórico', () => {
    expect(() =>
      buildDominioFile({ ...base, lancamentos: [lanc({ hist_code: '' })] }),
    ).toThrow(/código de histórico/);
  });
  it('conta com mais de 7 dígitos', () => {
    expect(() =>
      buildDominioFile({ ...base, lancamentos: [lanc({ conta_contabil: '12345678' })] }),
    ).toThrow(/7 dígitos/);
  });
  it('banco sem conta contábil', () => {
    expect(() =>
      buildDominioFile({ ...base, conta_banco: '', lancamentos: [lanc({})] }),
    ).toThrow(/conta contábil do banco/);
  });
});

// --------------------------------------------------------------------------- #
// buildDominioFileFromLancamentos (C7) — módulo Contábil, D/C explícito por
// partida, pode ter mais de 1 débito/crédito por lançamento.
// --------------------------------------------------------------------------- #

function lancContabil(over: Partial<ExportContabilLancamento>): ExportContabilLancamento {
  return {
    data: '2026-07-10',
    created_at: '2026-07-10T10:00:00.000Z',
    historico_codigo: '186',
    historico_complemento: 'servicos prestados',
    partidas: [
      { plano_conta_codigo: '272', tipo: 'D', valor_cents: 10258, ordem: 0 },
      { plano_conta_codigo: '10002', tipo: 'C', valor_cents: 10258, ordem: 1 },
    ],
    ...over,
  };
}

const baseContabil = {
  empresa_dominio: '168',
  cnpj: '11222333000181',
  periodo_inicio: '2026-07-01',
  periodo_fim: '2026-07-31',
  lote_numero: 1,
};

describe('buildDominioFileFromLancamentos — formato', () => {
  it('partida simples: mesmo layout de registro 01/02/03/99, sequencial contínuo', () => {
    const r = buildDominioFileFromLancamentos({ ...baseContabil, lancamentos: [lancContabil({})] });
    expect(r.content.slice(0, 2).toString('latin1')).toBe('01');
    expect(r.content.toString('latin1').endsWith('\r\n')).toBe(true);
    const l = linhasDe(r);
    expect(l).toHaveLength(4);
    expect(l[0]).toHaveLength(55);
    expect(l[1]).toHaveLength(165);
    expect(l[2]).toHaveLength(664);
    expect(l[3]).toBe('9'.repeat(100));

    const l01 = l[0]!;
    expect(l01.slice(0, 2)).toBe('01');
    expect(l01.slice(2, 9)).toBe('0000168');
    expect(l01.slice(9, 23)).toBe('11222333000181');
    expect(l01.slice(23, 33)).toBe('01/07/2026');
    expect(l01.slice(33, 43)).toBe('31/07/2026');
    expect(l01.slice(43, 46)).toBe('N05');
    expect(l01.slice(46, 54)).toBe('00000001');
    expect(l01.slice(54, 55)).toBe('1');

    const l02 = l[1]!;
    expect(l02.slice(2, 9)).toBe('0000001');
    expect(l02[65]).toBe('N');

    const l03 = l[2]!;
    expect(l03.slice(2, 9)).toBe('0000002');
    expect(l03.slice(9, 16)).toBe('0000272'); // débito
    expect(l03.slice(16, 23)).toBe('0010002'); // crédito
    expect(l03.slice(23, 38)).toBe('000000000010258');
    expect(l03.slice(38, 45)).toBe('0000186');
    expect(l03.slice(45, 557).trimEnd()).toBe('SERVICOS PRESTADOS');
    expect(l03.slice(557, 564)).toBe('0000168');
    expect(r.warnings).toEqual([]);
    expect(r.total_debito_cents).toBe(10258);
    expect(r.total_credito_cents).toBe(10258);
  });

  it('histórico nulo (lançamento em texto livre) não lança erro — vira 0000000', () => {
    const r = buildDominioFileFromLancamentos({
      ...baseContabil,
      lancamentos: [lancContabil({ historico_codigo: null })],
    });
    expect(linhasDe(r)[2]!.slice(38, 45)).toBe('0000000');
  });

  it('partida múltipla (2 créditos): decompõe em pares elementares e avisa', () => {
    const r = buildDominioFileFromLancamentos({
      ...baseContabil,
      lancamentos: [
        lancContabil({
          partidas: [
            { plano_conta_codigo: '100', tipo: 'D', valor_cents: 10000, ordem: 0 },
            { plano_conta_codigo: '200', tipo: 'C', valor_cents: 6000, ordem: 0 },
            { plano_conta_codigo: '300', tipo: 'C', valor_cents: 4000, ordem: 1 },
          ],
        }),
      ],
    });
    const l = linhasDe(r);
    expect(l).toHaveLength(5); // 01 + 02 + 03 + 03 + 99

    const l03a = l[2]!;
    expect(l03a.slice(2, 9)).toBe('0000002');
    expect(l03a.slice(9, 16)).toBe('0000100'); // débito A
    expect(l03a.slice(16, 23)).toBe('0000200'); // crédito B
    expect(l03a.slice(23, 38)).toBe('000000000006000');

    const l03b = l[3]!;
    expect(l03b.slice(2, 9)).toBe('0000003'); // sequencial contínuo, não "par"
    expect(l03b.slice(9, 16)).toBe('0000100'); // débito A de novo (mesma conta, 2º par)
    expect(l03b.slice(16, 23)).toBe('0000300'); // crédito C
    expect(l03b.slice(23, 38)).toBe('000000000004000');

    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/partida múltipla/);
    expect(r.total_debito_cents).toBe(10000);
    expect(r.total_credito_cents).toBe(10000);
  });

  it('ordena por data e depois created_at (não um índice sintético)', () => {
    const r = buildDominioFileFromLancamentos({
      ...baseContabil,
      lancamentos: [
        lancContabil({ data: '2026-07-15', created_at: '2026-07-15T09:00:00.000Z', historico_complemento: 'B' }),
        lancContabil({ data: '2026-07-01', created_at: '2026-07-01T09:00:00.000Z', historico_complemento: 'A' }),
        lancContabil({ data: '2026-07-15', created_at: '2026-07-15T14:00:00.000Z', historico_complemento: 'C' }),
      ],
    });
    const l = linhasDe(r);
    expect(l[2]!.slice(45, 46)).toBe('A');
    expect(l[4]!.slice(45, 46)).toBe('B');
    expect(l[6]!.slice(45, 46)).toBe('C');
  });
});

describe('buildDominioFileFromLancamentos — validação', () => {
  it('sem lançamentos', () => {
    expect(() => buildDominioFileFromLancamentos({ ...baseContabil, lancamentos: [] })).toThrow(ExportError);
  });

  it('conta com mais de 7 dígitos', () => {
    expect(() =>
      buildDominioFileFromLancamentos({
        ...baseContabil,
        lancamentos: [
          lancContabil({
            partidas: [
              { plano_conta_codigo: '123456789', tipo: 'D', valor_cents: 100, ordem: 0 },
              { plano_conta_codigo: '272', tipo: 'C', valor_cents: 100, ordem: 1 },
            ],
          }),
        ],
      }),
    ).toThrow(/7 dígitos/);
  });

  it('débito e crédito que não fecham lança erro nomeando o lançamento — nunca decompõe sem revalidar', () => {
    expect(() =>
      buildDominioFileFromLancamentos({
        ...baseContabil,
        lancamentos: [
          lancContabil({
            data: '2026-07-05',
            partidas: [
              { plano_conta_codigo: '100', tipo: 'D', valor_cents: 10000, ordem: 0 },
              { plano_conta_codigo: '200', tipo: 'C', valor_cents: 6000, ordem: 0 },
              { plano_conta_codigo: '300', tipo: 'C', valor_cents: 3000, ordem: 1 },
            ],
          }),
        ],
      }),
    ).toThrow(/2026-07-05/);
  });
});

// --------------------------------------------------------------------------- #
// Golden — compara com um EXPORT REAL do Domínio (lancto.txt), se acessível.
// Prova que os registros 01/02/03/99 que geramos têm a MESMA estrutura de um
// arquivo que o próprio Domínio produziu. Roda só com DOMINIO_GOLDEN ou
// C:\SEFIP\lancto.txt presente.
// --------------------------------------------------------------------------- #
const GOLDEN = process.env.DOMINIO_GOLDEN ?? 'C:/SEFIP/lancto.txt';
const GOLDEN_OK = existsSync(GOLDEN);

describe.runIf(GOLDEN_OK)('buildDominioFile — golden (export real do Domínio)', () => {
  const g = GOLDEN_OK ? readFileSync(GOLDEN).toString('latin1').replace(/\r\n$/, '').split('\r\n') : [];
  const g02 = g.filter((l) => l.startsWith('02'));
  const g03 = g.filter((l) => l.startsWith('03'));

  // conta do banco = a que mais aparece nos dois lados dos registros 03
  const cnt: Record<string, number> = {};
  for (const l of g03) {
    cnt[l.slice(9, 16)] = (cnt[l.slice(9, 16)] ?? 0) + 1;
    cnt[l.slice(16, 23)] = (cnt[l.slice(16, 23)] ?? 0) + 1;
  }
  const bancoField = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  it('sem BOM, encoding Latin-1, CRLF no fim, larguras 55/165/664/100', () => {
    expect(readFileSync(GOLDEN).slice(0, 2).toString('latin1')).toBe('01');
    expect(g[0]).toHaveLength(55);
    expect(g02[0]).toHaveLength(165);
    expect(g03[0]).toHaveLength(664);
    expect(g.at(-1)).toBe('9'.repeat(100));
    expect(g02[0][65]).toBe('N');
  });

  it('cada 02+03 de partida simples é reproduzido igual (fora o sequencial)', () => {
    // agrupa: cada 02 e os 03 que vêm logo depois dele
    const grupos: { l02: string; l03s: string[] }[] = [];
    for (const l of g) {
      if (l.startsWith('02')) grupos.push({ l02: l, l03s: [] });
      else if (l.startsWith('03') && grupos.length) grupos.at(-1)!.l03s.push(l);
    }
    void bancoField;
    const simples = grupos.filter((x) => x.l03s.length === 1);
    expect(simples.length).toBeGreaterThan(10);

    const h = g[0];
    const isoDate = (br: string) => {
      const [d, m, y] = br.split('/');
      return `${y}-${m}-${d}`;
    };
    let conferidos = 0;
    for (const { l02, l03s } of simples) {
      const l3 = l03s[0];
      const deb = l3.slice(9, 16);
      const cred = l3.slice(16, 23);
      const [dd, mm, yy] = l02.slice(10, 20).split('/');

      // reproduz esse 03 exato: "saída" põe D=contrapartida, C=banco.
      // logo: contrapartida = débito real, banco = crédito real.
      const r = buildDominioFile({
        empresa_dominio: String(Number(h.slice(2, 9))),
        cnpj: h.slice(9, 23),
        periodo_inicio: isoDate(h.slice(23, 33)),
        periodo_fim: isoDate(h.slice(33, 43)),
        lote_numero: Number(h.slice(46, 54)),
        conta_banco: String(Number(cred)),
        complemento_modo: 'complemento',
        lancamentos: [
          {
            data: `${yy}-${mm}-${dd}`,
            ordem: 0,
            direction: 'saida',
            valor_cents: Number(l3.slice(23, 38)),
            conta_contabil: String(Number(deb)),
            hist_code: String(Number(l3.slice(38, 45)) || 0),
            descricao_raw: '',
            hist_complemento: l3.slice(45, 45 + 512).replace(/ +$/, ''),
          },
        ],
      });
      const mine = r.content.toString('latin1').replace(/\r\n$/, '').split('\r\n');
      expect(mine[0]).toBe(h); // cabeçalho idêntico ao do Domínio
      expect(mine.at(-1)).toBe(g.at(-1)); // rodapé idêntico
      expect(mine[2].slice(9)).toBe(l3.slice(9)); // registro 03 IGUAL (menos o seq)
      // registro 02 igual fora o campo de texto livre [20:65] (nome do usuário Domínio)
      expect(mine[1].slice(9, 20)).toBe(l02.slice(9, 20));
      expect(mine[1].slice(65)).toBe(l02.slice(65));
      conferidos++;
    }
    expect(conferidos).toBe(simples.length);
  });
});
