import type { SupabaseClient } from '@supabase/supabase-js';
import { emLotes, lerTodas, mapPgrstError } from '../lib/pgrst.js';
import { badRequest, notFound } from '../lib/httpError.js';

export type Natureza = 'D' | 'C';
export type Saldo = { cents: number; natureza: Natureza | null };

const PLANO_TABLE = 'plano_contas';
const PERIODO_TABLE = 'periodos_contabeis';
const SALDO_TABLE = 'saldos_contabeis';
const LANC_TABLE = 'lancamentos';
const PARTIDA_TABLE = 'lancamento_partidas';

function toSigned(s: Saldo): number {
  if (s.natureza === null) return 0;
  return s.natureza === 'D' ? s.cents : -s.cents;
}

function fromSigned(signed: number): Saldo {
  if (signed === 0) return { cents: 0, natureza: null };
  return { cents: Math.abs(signed), natureza: signed > 0 ? 'D' : 'C' };
}

/** D é a direção positiva — mesma aritmética validada contra o Balancete real do C2. */
export function aplicarMovimento(anterior: Saldo, debitoCents: number, creditoCents: number): Saldo {
  return fromSigned(toSigned(anterior) + debitoCents - creditoCents);
}

/** Rollup de conta sintética: soma com sinal dos saldos dos filhos. */
export function somarSaldos(saldos: Saldo[]): Saldo {
  return fromSigned(saldos.reduce((acc, s) => acc + toSigned(s), 0));
}

type Conta = {
  id: string;
  codigo: string;
  nome: string;
  tipo: 'S' | 'A';
  classificacao: string;
  parent_id: string | null;
};

/**
 * Ordena em pós-ordem a partir de parent_id (não de `grau` — grau vem de
 * uma coluna impressa no PDF do plano de contas, independente de
 * parent_id/classificacao; nada garante que bate com a profundidade real
 * da árvore). Pós-ordem garante que toda conta sintética só é processada
 * depois de todas as suas descendentes.
 */
function ordenarPosOrdem(contas: Conta[]): Conta[] {
  const filhosPorPai = new Map<string | null, Conta[]>();
  for (const c of contas) {
    const key = c.parent_id;
    if (!filhosPorPai.has(key)) filhosPorPai.set(key, []);
    filhosPorPai.get(key)!.push(c);
  }

  const resultado: Conta[] = [];
  const visitado = new Set<string>();

  function visitar(conta: Conta): void {
    const filhos = filhosPorPai.get(conta.id) ?? [];
    if (filhos.length > 0 && conta.tipo === 'A') {
      throw badRequest(
        `Conta ${conta.codigo} (${conta.nome}) é analítica mas tem conta(s)-filha no plano de ` +
          'contas — corrija a hierarquia antes de calcular saldos.',
      );
    }
    for (const filho of filhos) visitar(filho);
    visitado.add(conta.id);
    resultado.push(conta);
  }

  for (const raiz of filhosPorPai.get(null) ?? []) visitar(raiz);

  if (visitado.size !== contas.length) {
    const faltando = contas.filter((c) => !visitado.has(c.id)).map((c) => c.codigo);
    throw badRequest(`Conta(s) fora da árvore do plano de contas (parent_id inválido/cíclico): ${faltando.join(', ')}`);
  }

  return resultado;
}

function ordenarImpressao(contas: Conta[]): Map<string, number> {
  const ordenadas = [...contas].sort((a, b) =>
    a.classificacao === b.classificacao
      ? a.codigo.localeCompare(b.codigo)
      : a.classificacao.localeCompare(b.classificacao),
  );
  return new Map(ordenadas.map((c, i) => [c.codigo, i]));
}

/**
 * Recalcula saldos_contabeis pro trecho de períodos abertos que contém
 * `periodoId`. Nunca mexe num período fechado (Balancete é autoridade).
 *
 * O escopo NÃO é "periodoId em diante" — é "todo período aberto desde o
 * último fechado (ou desde o início) até o fim da lista". Isso importa
 * porque o período logo antes do alvo pode ele mesmo nunca ter sido
 * calculado ainda; ancorar sempre no último fechado torna a função
 * idempotente e independente de qual período do trecho quebrado você chama.
 */
export async function recomputeSaldosCascade(
  supabase: SupabaseClient,
  ownerId: string,
  periodoId: string,
): Promise<void> {
  const { data: alvo, error: alvoErr } = await supabase
    .from(PERIODO_TABLE)
    .select('id, client_id, status')
    .eq('id', periodoId)
    .maybeSingle();
  if (alvoErr) throw mapPgrstError(alvoErr, 'buscar período pro motor de saldos');
  if (!alvo) throw notFound('Período não encontrado');
  if (alvo.status === 'fechado') return; // Balancete é autoridade — nunca recalcula por cima

  const clientId = alvo.client_id as string;

  // lido inteiro (em páginas): conta faltando aqui corrompe saldo sem erro nenhum
  const contas = (await lerTodas(
    (de, ate) =>
      supabase
        .from(PLANO_TABLE)
        .select('id, codigo, nome, tipo, classificacao, parent_id')
        .eq('client_id', clientId)
        .order('id')
        .range(de, ate),
    'ler plano de contas pro motor de saldos',
  )) as Conta[];

  const posOrdem = ordenarPosOrdem(contas);
  const ordemPorCodigo = ordenarImpressao(contas);
  const filhosPorPai = new Map<string | null, string[]>();
  for (const c of contas) {
    if (!filhosPorPai.has(c.parent_id)) filhosPorPai.set(c.parent_id, []);
    filhosPorPai.get(c.parent_id)!.push(c.id);
  }

  const { data: periodosRaw, error: periodosErr } = await supabase
    .from(PERIODO_TABLE)
    .select('id, ano, mes, status')
    .eq('client_id', clientId)
    .order('ano', { ascending: true })
    .order('mes', { ascending: true });
  if (periodosErr) throw mapPgrstError(periodosErr, 'ler períodos pro motor de saldos');
  const periodos = (periodosRaw ?? []) as Array<{ id: string; ano: number; mes: number; status: string }>;

  const alvoIdx = periodos.findIndex((p) => p.id === periodoId);
  let ancoraIdx = -1;
  for (let i = alvoIdx; i >= 0; i--) {
    if (periodos[i]?.status === 'fechado') {
      ancoraIdx = i;
      break;
    }
  }
  const escopo = periodos.slice(ancoraIdx + 1).filter((p) => p.status === 'aberto');
  if (escopo.length === 0) return;

  let saldoPorCodigo = new Map<string, Saldo>();
  const ancoraId = ancoraIdx >= 0 ? (periodos[ancoraIdx]?.id ?? null) : null;
  if (ancoraId) {
    const saldosAncora = await lerTodas(
      (de, ate) =>
        supabase
          .from(SALDO_TABLE)
          .select('codigo, saldo_atual_cents, saldo_atual_natureza')
          .eq('periodo_id', ancoraId)
          .order('codigo')
          .range(de, ate),
      'ler saldos do período âncora',
    );
    for (const row of saldosAncora) {
      const cents = row.saldo_atual_cents as number;
      const natureza = row.saldo_atual_natureza as Natureza | null;
      if ((cents === 0) !== (natureza === null)) {
        throw badRequest(
          `Saldo inconsistente na conta ${row.codigo as string} do período de referência ` +
            `(centavos=${cents}, natureza=${natureza}) — corrija antes de recalcular.`,
        );
      }
      saldoPorCodigo.set(row.codigo as string, { cents, natureza });
    }
  }

  const periodoIds = escopo.map((p) => p.id);
  const lancsRaw = await lerTodas(
    (de, ate) =>
      supabase.from(LANC_TABLE).select('id, periodo_id').in('periodo_id', periodoIds).order('id').range(de, ate),
    'ler lançamentos pro motor de saldos',
  );
  const periodoDoLancamento = new Map(lancsRaw.map((l) => [l.id as string, l.periodo_id as string]));
  const lancamentoIds = [...periodoDoLancamento.keys()];

  const movimentoPorPeriodoConta = new Map<string, Map<string, { debito: number; credito: number }>>();
  if (lancamentoIds.length > 0) {
    // em lotes: .in() com milhares de ids de lançamento estoura a URL
    const partidasRaw: unknown[] = [];
    for (const lote of emLotes(lancamentoIds)) {
      partidasRaw.push(
        ...(await lerTodas(
          (de, ate) =>
            supabase
              .from(PARTIDA_TABLE)
              .select('lancamento_id, plano_conta_id, tipo, valor_cents')
              .in('lancamento_id', lote)
              .order('id')
              .range(de, ate),
          'ler partidas pro motor de saldos',
        )),
      );
    }
    for (const p of partidasRaw as Array<{
      lancamento_id: string;
      plano_conta_id: string;
      tipo: Natureza;
      valor_cents: number;
    }>) {
      const periodoId2 = periodoDoLancamento.get(p.lancamento_id);
      if (!periodoId2) continue;
      if (!movimentoPorPeriodoConta.has(periodoId2)) movimentoPorPeriodoConta.set(periodoId2, new Map());
      const porConta = movimentoPorPeriodoConta.get(periodoId2)!;
      if (!porConta.has(p.plano_conta_id)) porConta.set(p.plano_conta_id, { debito: 0, credito: 0 });
      const m = porConta.get(p.plano_conta_id)!;
      if (p.tipo === 'D') m.debito += p.valor_cents;
      else m.credito += p.valor_cents;
    }
  }

  const rows: Record<string, unknown>[] = [];

  for (const periodo of escopo) {
    const movimentoPorConta = movimentoPorPeriodoConta.get(periodo.id) ?? new Map();
    const resultadoPorId = new Map<string, { saldo: Saldo; debito: number; credito: number }>();
    const novaSaldoPorCodigo = new Map<string, Saldo>();

    for (const conta of posOrdem) {
      const anterior = saldoPorCodigo.get(conta.codigo) ?? { cents: 0, natureza: null };
      let saldo: Saldo;
      let debito: number;
      let credito: number;

      if (conta.tipo === 'A') {
        const mov = movimentoPorConta.get(conta.id) ?? { debito: 0, credito: 0 };
        debito = mov.debito;
        credito = mov.credito;
        saldo = aplicarMovimento(anterior, debito, credito);
      } else {
        const filhos = (filhosPorPai.get(conta.id) ?? []).map((id) => resultadoPorId.get(id)!);
        debito = filhos.reduce((s, f) => s + f.debito, 0);
        credito = filhos.reduce((s, f) => s + f.credito, 0);
        saldo = somarSaldos(filhos.map((f) => f.saldo));
      }

      resultadoPorId.set(conta.id, { saldo, debito, credito });
      novaSaldoPorCodigo.set(conta.codigo, saldo);

      rows.push({
        owner_id: ownerId,
        periodo_id: periodo.id,
        plano_conta_id: conta.id,
        codigo: conta.codigo,
        nome: conta.nome,
        tipo: conta.tipo,
        ordem: ordemPorCodigo.get(conta.codigo) ?? 0,
        saldo_anterior_cents: anterior.cents,
        saldo_anterior_natureza: anterior.natureza,
        debito_cents: debito,
        credito_cents: credito,
        saldo_atual_cents: saldo.cents,
        saldo_atual_natureza: saldo.natureza,
      });
    }

    saldoPorCodigo = novaSaldoPorCodigo;
  }

  if (rows.length > 0) {
    const { error: upsertErr } = await supabase.from(SALDO_TABLE).upsert(rows, { onConflict: 'periodo_id,codigo' });
    if (upsertErr) throw mapPgrstError(upsertErr, 'gravar saldos calculados');
  }
}
