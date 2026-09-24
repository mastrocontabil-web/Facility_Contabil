import { describe, expect, it } from 'vitest';
import { aplicarMovimento, somarSaldos, recomputeSaldosCascade } from './saldoEngine.js';
import { makeFakeSupabase, type FakeHandler, type FakeOp } from '../test/fakeSupabase.js';

describe('aplicarMovimento', () => {
  it('saldo zero fica com natureza nula (não "D") — caso real da conta FÉRIAS do Balancete', () => {
    // "335 FÉRIAS 0,00 250,00 0,00 250,00D" — saldo anterior zero (sem D/C),
    // débito 250, credito 0, fecha em 250,00D.
    const r = aplicarMovimento({ cents: 0, natureza: null }, 25000, 0);
    expect(r).toEqual({ cents: 25000, natureza: 'D' });
  });

  it('débito aumenta um saldo devedor', () => {
    const r = aplicarMovimento({ cents: 1000, natureza: 'D' }, 500, 0);
    expect(r).toEqual({ cents: 1500, natureza: 'D' });
  });

  it('crédito que zera exatamente um saldo devedor vira natureza nula, não "C"', () => {
    const r = aplicarMovimento({ cents: 1000, natureza: 'D' }, 0, 1000);
    expect(r).toEqual({ cents: 0, natureza: null });
  });

  it('crédito que ultrapassa um saldo devedor inverte pra credor', () => {
    const r = aplicarMovimento({ cents: 1000, natureza: 'D' }, 0, 1500);
    expect(r).toEqual({ cents: 500, natureza: 'C' });
  });

  it('movimento num saldo credor', () => {
    const r = aplicarMovimento({ cents: 1000, natureza: 'C' }, 200, 500);
    // signed: -1000 + 200 - 500 = -1300
    expect(r).toEqual({ cents: 1300, natureza: 'C' });
  });
});

describe('somarSaldos', () => {
  it('soma saldos devedores', () => {
    const r = somarSaldos([
      { cents: 100, natureza: 'D' },
      { cents: 200, natureza: 'D' },
    ]);
    expect(r).toEqual({ cents: 300, natureza: 'D' });
  });

  it('soma que zera exatamente vira natureza nula', () => {
    const r = somarSaldos([
      { cents: 500, natureza: 'D' },
      { cents: 500, natureza: 'C' },
    ]);
    expect(r).toEqual({ cents: 0, natureza: null });
  });

  it('lista vazia soma zero/nula (grupo sem filhos com saldo)', () => {
    expect(somarSaldos([])).toEqual({ cents: 0, natureza: null });
  });
});

// --------------------------------------------------------------------------- #
// recomputeSaldosCascade — cenário completo com fake do Supabase
// --------------------------------------------------------------------------- #

const CID = '11111111-1111-1111-1111-111111111111';
const OWNER = 'user-1';

// Árvore de 3 níveis com `grau` deliberadamente errado/invertido — prova que
// o motor usa parent_id (não grau) pra decidir a ordem de processamento.
const CONTA_ATIVO = { id: 'c-ativo', codigo: '1', nome: 'ATIVO', tipo: 'S', classificacao: '1', parent_id: null, grau: 99 };
const CONTA_CIRCULANTE = { id: 'c-circ', codigo: '1.1', nome: 'CIRCULANTE', tipo: 'S', classificacao: '1.1', parent_id: 'c-ativo', grau: 1 };
const CONTA_CAIXA = { id: 'c-caixa', codigo: '1.1.1', nome: 'CAIXA', tipo: 'A', classificacao: '1.1.1', parent_id: 'c-circ', grau: 1 };
const PLANO = [CONTA_ATIVO, CONTA_CIRCULANTE, CONTA_CAIXA];

const P_FECHADO = { id: 'p-mai', ano: 2026, mes: 5, status: 'fechado' };
const P_JUN = { id: 'p-jun', ano: 2026, mes: 6, status: 'aberto' };
const P_JUL = { id: 'p-jul', ano: 2026, mes: 7, status: 'aberto' };
const PERIODOS = [P_FECHADO, P_JUN, P_JUL];

const SALDOS_ANCORA = [
  { codigo: '1', saldo_atual_cents: 10000, saldo_atual_natureza: 'D' },
  { codigo: '1.1', saldo_atual_cents: 10000, saldo_atual_natureza: 'D' },
  { codigo: '1.1.1', saldo_atual_cents: 10000, saldo_atual_natureza: 'D' },
];

/** Handler genérico: períodos, plano de contas e saldos-âncora fixos;
 * lançamentos/partidas por período vêm de `lancamentosPorPeriodo`. */
function montarHandler(lancamentosPorPeriodo: Record<string, { plano_conta_id: string; tipo: 'D' | 'C'; valor_cents: number }[]>): FakeHandler {
  const lancIds = Object.keys(lancamentosPorPeriodo).map((periodoId) => `lanc-${periodoId}`);
  return (op: FakeOp) => {
    if (op.table === 'periodos_contabeis' && op.single === 'maybeSingle') {
      const id = op.filters.find(([c]) => c === 'id')?.[1];
      const p = PERIODOS.find((x) => x.id === id);
      return { data: p ? { id: p.id, client_id: CID, status: p.status } : null, error: null };
    }
    if (op.table === 'plano_contas') {
      return { data: PLANO, error: null };
    }
    if (op.table === 'periodos_contabeis') {
      // lista completa, ordenada (já vem ordenada na fixture)
      return { data: PERIODOS, error: null };
    }
    if (op.table === 'saldos_contabeis' && op.verb === 'select') {
      return { data: SALDOS_ANCORA, error: null };
    }
    if (op.table === 'lancamentos') {
      const periodoIds = (op.filters.find(([c]) => c === 'periodo_id')?.[1] as string[]) ?? [];
      const rows = periodoIds
        .filter((pid) => lancamentosPorPeriodo[pid])
        .map((pid) => ({ id: `lanc-${pid}`, periodo_id: pid }));
      return { data: rows, error: null };
    }
    if (op.table === 'lancamento_partidas') {
      const ids = (op.filters.find(([c]) => c === 'lancamento_id')?.[1] as string[]) ?? [];
      const rows = ids.flatMap((lancId) => {
        const periodoId = lancId.replace('lanc-', '');
        return (lancamentosPorPeriodo[periodoId] ?? []).map((p) => ({ lancamento_id: lancId, ...p }));
      });
      return { data: rows, error: null };
    }
    if (op.table === 'saldos_contabeis' && op.verb === 'upsert') {
      return { data: null, error: null };
    }
    return { data: null, error: null };
  };
}

describe('recomputeSaldosCascade', () => {
  it('nunca mexe num período fechado (no-op)', async () => {
    const { client, ops } = makeFakeSupabase(montarHandler({}));
    await recomputeSaldosCascade(client, OWNER, P_FECHADO.id);
    expect(ops.some((o) => o.table === 'saldos_contabeis' && o.verb === 'upsert')).toBe(false);
  });

  it('calcula rollup de 3 níveis a partir do período fechado (grau errado não atrapalha)', async () => {
    const { client, ops } = makeFakeSupabase(
      montarHandler({ [P_JUN.id]: [{ plano_conta_id: CONTA_CAIXA.id, tipo: 'D', valor_cents: 500 }] }),
    );
    await recomputeSaldosCascade(client, OWNER, P_JUN.id);

    const upsertOp = ops.find((o) => o.table === 'saldos_contabeis' && o.verb === 'upsert');
    expect(upsertOp?.onConflict).toBe('periodo_id,codigo');
    const rows = upsertOp?.payload as Array<Record<string, unknown>>;
    // 3 contas x 2 períodos — o motor recalcula o trecho aberto INTEIRO (junho
    // e julho, os dois 'aberto' depois do fechado de maio), não só o alvo.
    expect(rows).toHaveLength(6);

    const caixa = rows.find((r) => r.periodo_id === P_JUN.id && r.codigo === '1.1.1')!;
    expect(caixa).toMatchObject({
      saldo_anterior_cents: 10000, saldo_anterior_natureza: 'D',
      debito_cents: 500, credito_cents: 0,
      saldo_atual_cents: 10500, saldo_atual_natureza: 'D',
    });
    // rollup: CIRCULANTE e ATIVO têm que refletir o mesmo movimento do único filho
    const circulante = rows.find((r) => r.periodo_id === P_JUN.id && r.codigo === '1.1')!;
    expect(circulante).toMatchObject({ debito_cents: 500, credito_cents: 0, saldo_atual_cents: 10500, saldo_atual_natureza: 'D' });
    const ativo = rows.find((r) => r.periodo_id === P_JUN.id && r.codigo === '1')!;
    expect(ativo).toMatchObject({ debito_cents: 500, credito_cents: 0, saldo_atual_cents: 10500, saldo_atual_natureza: 'D' });
  });

  it('mais de 100 lançamentos no período: lê as partidas em lotes e soma todas', async () => {
    // 150 lançamentos de R$ 1,00 a débito do CAIXA em junho — .in() com todos
    // os ids de uma vez estouraria a URL, então vão em lotes de 100
    const lancs = Array.from({ length: 150 }, (_, i) => ({ id: `lanc-${i}`, periodo_id: P_JUN.id }));
    const base = montarHandler({});
    const { client, ops } = makeFakeSupabase((op) => {
      if (op.table === 'lancamentos') return { data: lancs, error: null };
      if (op.table === 'lancamento_partidas') {
        const ids = (op.filters.find(([c]) => c === 'lancamento_id')?.[1] as string[]) ?? [];
        const rows = ids.map((id) => ({ lancamento_id: id, plano_conta_id: CONTA_CAIXA.id, tipo: 'D', valor_cents: 100 }));
        return { data: rows, error: null };
      }
      return base(op);
    });
    await recomputeSaldosCascade(client, OWNER, P_JUN.id);

    const lotes = ops
      .filter((o) => o.table === 'lancamento_partidas')
      .map((o) => (o.filters.find(([c]) => c === 'lancamento_id')?.[1] as string[]).length);
    expect(lotes).toEqual([100, 50]);
    const rows = ops.find((o) => o.table === 'saldos_contabeis' && o.verb === 'upsert')?.payload as Array<
      Record<string, unknown>
    >;
    const caixa = rows.find((r) => r.periodo_id === P_JUN.id && r.codigo === '1.1.1')!;
    expect(caixa).toMatchObject({ debito_cents: 15000, saldo_atual_cents: 25000, saldo_atual_natureza: 'D' });
  });

  it('recalcular um período do MEIO de uma sequência preenche corretamente o período anterior nunca calculado', async () => {
    // Junho nunca foi calculado (nenhum saldos_contabeis pra ele) e chamo
    // recompute direto em Julho — o motor tem que ancorar no fechado (Maio)
    // e recalcular Junho E Julho nessa ordem, não só Julho isolado.
    const { client, ops } = makeFakeSupabase(
      montarHandler({
        [P_JUN.id]: [{ plano_conta_id: CONTA_CAIXA.id, tipo: 'D', valor_cents: 500 }],
        [P_JUL.id]: [{ plano_conta_id: CONTA_CAIXA.id, tipo: 'C', valor_cents: 200 }],
      }),
    );
    await recomputeSaldosCascade(client, OWNER, P_JUL.id);

    const upsertOp = ops.find((o) => o.table === 'saldos_contabeis' && o.verb === 'upsert');
    const rows = upsertOp?.payload as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(6); // 3 contas x 2 períodos (junho + julho)

    const caixaJun = rows.find((r) => r.periodo_id === P_JUN.id && r.codigo === '1.1.1')!;
    expect(caixaJun).toMatchObject({ saldo_anterior_cents: 10000, saldo_atual_cents: 10500, saldo_atual_natureza: 'D' });

    // julho parte do saldo de junho recém-calculado (10500D), não de zero
    const caixaJul = rows.find((r) => r.periodo_id === P_JUL.id && r.codigo === '1.1.1')!;
    expect(caixaJul).toMatchObject({
      saldo_anterior_cents: 10500, saldo_anterior_natureza: 'D',
      debito_cents: 0, credito_cents: 200,
      saldo_atual_cents: 10300, saldo_atual_natureza: 'D',
    });
  });

  it('conta analítica com filha lança erro em vez de perder saldo em silêncio', async () => {
    const planoQuebrado = [
      { ...CONTA_ATIVO, tipo: 'A' }, // ATIVO virou analítica mas ainda é pai de CIRCULANTE
      CONTA_CIRCULANTE,
      CONTA_CAIXA,
    ];
    const handler: FakeHandler = (op) => {
      if (op.table === 'periodos_contabeis' && op.single === 'maybeSingle') {
        return { data: { id: P_JUN.id, client_id: CID, status: 'aberto' }, error: null };
      }
      if (op.table === 'plano_contas') return { data: planoQuebrado, error: null };
      if (op.table === 'periodos_contabeis') return { data: PERIODOS, error: null };
      return { data: [], error: null };
    };
    const { client } = makeFakeSupabase(handler);
    await expect(recomputeSaldosCascade(client, OWNER, P_JUN.id)).rejects.toThrow(/analítica/);
  });

  it('saldo-âncora inconsistente (centavos != 0 com natureza nula) lança erro', async () => {
    const handler: FakeHandler = (op) => {
      if (op.table === 'periodos_contabeis' && op.single === 'maybeSingle') {
        return { data: { id: P_JUN.id, client_id: CID, status: 'aberto' }, error: null };
      }
      if (op.table === 'plano_contas') return { data: PLANO, error: null };
      if (op.table === 'periodos_contabeis') return { data: PERIODOS, error: null };
      if (op.table === 'saldos_contabeis' && op.verb === 'select') {
        return { data: [{ codigo: '1.1.1', saldo_atual_cents: 500, saldo_atual_natureza: null }], error: null };
      }
      return { data: [], error: null };
    };
    const { client } = makeFakeSupabase(handler);
    await expect(recomputeSaldosCascade(client, OWNER, P_JUN.id)).rejects.toThrow(/[Ii]nconsistente/);
  });
});
