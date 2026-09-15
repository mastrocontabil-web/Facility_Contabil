import type { SupabaseClient } from '@supabase/supabase-js';
import { mapPgrstError } from '../lib/pgrst.js';
import { badRequest, notFound } from '../lib/httpError.js';
import type { Natureza, Saldo } from './saldoEngine.js';

const PLANO_TABLE = 'plano_contas';
const PERIODO_TABLE = 'periodos_contabeis';
const SALDO_TABLE = 'saldos_contabeis';
const SALDO_COLS =
  'id, periodo_id, plano_conta_id, codigo, nome, tipo, ordem, saldo_anterior_cents, ' +
  'saldo_anterior_natureza, debito_cents, credito_cents, saldo_atual_cents, ' +
  'saldo_atual_natureza, created_at, updated_at';

// Mesmo raciocínio do saldoEngine.ts: o plano de contas real já tem ~927
// linhas, perto do limite padrão de 1000 do PostgREST.
const LIMITE_LINHAS = 5000;

type Periodo = {
  id: string;
  client_id: string;
  ano: number;
  mes: number;
  status: string;
  fechado_em: string | null;
  created_at: string;
  updated_at: string;
};

type Conta = {
  id: string;
  codigo: string;
  nome: string;
  tipo: 'S' | 'A';
  grau: number;
  parent_id: string | null;
};

type SaldoRow = {
  id: string;
  periodo_id: string;
  plano_conta_id: string | null;
  codigo: string;
  nome: string;
  tipo: 'S' | 'A';
  ordem: number;
  saldo_anterior_cents: number;
  saldo_anterior_natureza: Natureza | null;
  debito_cents: number;
  credito_cents: number;
  saldo_atual_cents: number;
  saldo_atual_natureza: Natureza | null;
  created_at: string;
  updated_at: string;
};

export type GrupoDre = { raiz: SaldoRow; linhas: SaldoRow[] };

export type DreRelatorio = {
  periodo: Periodo;
  receitas: GrupoDre;
  despesas: GrupoDre;
  resultado_mes_cents: number;
  resultado_mes_natureza: Natureza | null;
  resultado_exercicio_cents: number;
  resultado_exercicio_natureza: Natureza | null;
};

/**
 * Mede um saldo pela ótica do lado em que ele DEVERIA estar: positivo se bate
 * com `ladoEsperado`, negativo se invertido. Não é o mesmo que `toSigned` do
 * saldoEngine.ts — aquela função fixa "D é positivo" globalmente, que é a
 * convenção errada aqui (receita espera C, despesa espera D — lados opostos).
 */
export function magnitudeComoEsperado(saldo: Saldo, ladoEsperado: Natureza): number {
  if (saldo.natureza === null) return 0;
  return saldo.natureza === ladoEsperado ? saldo.cents : -saldo.cents;
}

/** Resultado do exercício: receita (espera C) menos despesa (espera D), cada uma
 * medida pela própria ótica — inverte certo se qualquer lado estiver invertido. */
export function calcularResultado(receita: Saldo, despesa: Saldo): Saldo {
  const signed = magnitudeComoEsperado(receita, 'C') - magnitudeComoEsperado(despesa, 'D');
  if (signed === 0) return { cents: 0, natureza: null };
  return { cents: Math.abs(signed), natureza: signed > 0 ? 'C' : 'D' };
}

/**
 * Acha a única conta de grau 1 cujo nome bate com `regex`. Filtra por
 * `grau === 1`, não só `parent_id IS NULL` — esse também é setado como
 * fallback silencioso pelo `relink_plano_contas_parents` quando uma conta
 * órfã não acha pai nenhum, então sozinho não garante "é raiz de verdade";
 * `grau` vem direto do PDF do plano de contas, é uma fonte independente.
 * 0 ou 2+ candidatas é erro — nunca adivinha qual usar.
 */
export function encontrarRaizUnica(contas: Conta[], regex: RegExp, rotulo: string): Conta {
  const candidatas = contas.filter((c) => c.grau === 1 && regex.test(c.nome));
  const [raiz, ...resto] = candidatas;
  if (!raiz) {
    throw badRequest(
      `Não encontrei o grupo de ${rotulo} no plano de contas desse cliente — confira se a ` +
        'conta de grau 1 correspondente tem o nome padrão do Domínio.',
    );
  }
  if (resto.length > 0) {
    throw badRequest(
      `Mais de uma conta de grau 1 corresponde a ${rotulo}: ` +
        `${candidatas.map((c) => `${c.codigo} (${c.nome})`).join(', ')} — não dá pra saber qual usar.`,
    );
  }
  return raiz;
}

/** Anda a árvore de verdade (parent_id) a partir da raiz — não usa prefixo de
 * `classificacao` (ver saldoEngine.ts: classificação não é única, 0011). */
export function coletarDescendentes(contas: Conta[], raizId: string): Set<string> {
  const filhosPorPai = new Map<string, string[]>();
  for (const c of contas) {
    if (!c.parent_id) continue;
    if (!filhosPorPai.has(c.parent_id)) filhosPorPai.set(c.parent_id, []);
    filhosPorPai.get(c.parent_id)!.push(c.id);
  }
  const out = new Set<string>();
  const pilha = [...(filhosPorPai.get(raizId) ?? [])];
  while (pilha.length > 0) {
    const id = pilha.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    pilha.push(...(filhosPorPai.get(id) ?? []));
  }
  return out;
}

/** Conta-raiz existe mas não tem linha em saldos_contabeis nesse período —
 * estado normal (nada lançado ainda daquele lado nesse mês), não erro. */
function linhaVirtual(conta: Conta, periodoId: string): SaldoRow {
  return {
    id: `virtual-${conta.id}`,
    periodo_id: periodoId,
    plano_conta_id: conta.id,
    codigo: conta.codigo,
    nome: conta.nome,
    tipo: conta.tipo,
    ordem: 0,
    saldo_anterior_cents: 0,
    saldo_anterior_natureza: null,
    debito_cents: 0,
    credito_cents: 0,
    saldo_atual_cents: 0,
    saldo_atual_natureza: null,
    created_at: '',
    updated_at: '',
  };
}

export async function montarDreRelatorio(supabase: SupabaseClient, periodoId: string): Promise<DreRelatorio> {
  const { data: periodo, error: perErr } = await supabase
    .from(PERIODO_TABLE)
    .select('id, client_id, ano, mes, status, fechado_em, created_at, updated_at')
    .eq('id', periodoId)
    .maybeSingle();
  if (perErr) throw mapPgrstError(perErr, 'buscar período pra DRE');
  if (!periodo) throw notFound('Período não encontrado');
  const periodoRow = periodo as Periodo;

  const { data: contasRaw, error: contasErr } = await supabase
    .from(PLANO_TABLE)
    .select('id, codigo, nome, tipo, grau, parent_id')
    .eq('client_id', periodoRow.client_id)
    .limit(LIMITE_LINHAS);
  if (contasErr) throw mapPgrstError(contasErr, 'ler plano de contas pra DRE');
  const contas = (contasRaw ?? []) as Conta[];

  const raizReceitas = encontrarRaizUnica(contas, /RECEITA/i, 'receitas');
  const raizDespesas = encontrarRaizUnica(contas, /DESPESA|CUSTO/i, 'despesas');
  const idsReceitas = coletarDescendentes(contas, raizReceitas.id);
  const idsDespesas = coletarDescendentes(contas, raizDespesas.id);

  // Busca todos os saldos do período de uma vez e particiona em memória — não
  // dá pra filtrar com .in('plano_conta_id', [...centenas de ids]), risco real
  // de estourar o tamanho da query string do PostgREST (mesmo raciocínio do
  // LIMITE_LINHAS do saldoEngine.ts).
  const { data: saldosRaw, error: saldosErr } = await supabase
    .from(SALDO_TABLE)
    .select(SALDO_COLS)
    .eq('periodo_id', periodoId)
    .limit(LIMITE_LINHAS);
  if (saldosErr) throw mapPgrstError(saldosErr, 'ler saldos pra DRE');
  const saldos = (saldosRaw ?? []) as unknown as SaldoRow[];
  const saldoPorContaId = new Map(
    saldos.filter((s) => s.plano_conta_id).map((s) => [s.plano_conta_id as string, s]),
  );

  function montarGrupo(raiz: Conta, ids: Set<string>): GrupoDre {
    const raizSaldo = saldoPorContaId.get(raiz.id) ?? linhaVirtual(raiz, periodoId);
    const linhas = saldos
      .filter((s) => s.plano_conta_id && ids.has(s.plano_conta_id))
      .sort((a, b) => a.ordem - b.ordem);
    return { raiz: raizSaldo, linhas };
  }

  const receitas = montarGrupo(raizReceitas, idsReceitas);
  const despesas = montarGrupo(raizDespesas, idsDespesas);

  const resultadoExercicio = calcularResultado(
    { cents: receitas.raiz.saldo_atual_cents, natureza: receitas.raiz.saldo_atual_natureza },
    { cents: despesas.raiz.saldo_atual_cents, natureza: despesas.raiz.saldo_atual_natureza },
  );

  // Resultado do mês usa as colunas de fluxo do período (débito/crédito),
  // sem natureza envolvida — sem a armadilha de sinal do resultado acima.
  const receitaLiquidaMes = receitas.raiz.credito_cents - receitas.raiz.debito_cents;
  const despesaLiquidaMes = despesas.raiz.debito_cents - despesas.raiz.credito_cents;
  const signedMes = receitaLiquidaMes - despesaLiquidaMes;
  const resultadoMes: Saldo =
    signedMes === 0
      ? { cents: 0, natureza: null }
      : { cents: Math.abs(signedMes), natureza: signedMes > 0 ? 'C' : 'D' };

  return {
    periodo: periodoRow,
    receitas,
    despesas,
    resultado_mes_cents: resultadoMes.cents,
    resultado_mes_natureza: resultadoMes.natureza,
    resultado_exercicio_cents: resultadoExercicio.cents,
    resultado_exercicio_natureza: resultadoExercicio.natureza,
  };
}
