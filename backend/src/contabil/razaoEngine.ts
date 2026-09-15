import type { SupabaseClient } from '@supabase/supabase-js';
import { mapPgrstError } from '../lib/pgrst.js';
import { badRequest, notFound } from '../lib/httpError.js';
import { aplicarMovimento, type Natureza, type Saldo } from './saldoEngine.js';

const PLANO_TABLE = 'plano_contas';
const PERIODO_TABLE = 'periodos_contabeis';
const SALDO_TABLE = 'saldos_contabeis';
const LANC_TABLE = 'lancamentos';
const PARTIDA_TABLE = 'lancamento_partidas';

// Mesmo raciocínio do saldoEngine.ts/dreEngine.ts — perto do limite padrão de
// 1000 linhas do PostgREST se o projeto não configurar db-max-rows.
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
  client_id: string;
  codigo: string;
  nome: string;
  tipo: 'S' | 'A';
};

type LancInfo = {
  id: string;
  data: string;
  historico_codigo: string | null;
  historico_complemento: string;
  created_at: string;
};

type PartidaInfo = {
  id: string;
  lancamento_id: string;
  tipo: Natureza;
  valor_cents: number;
  ordem: number;
};

export type RazaoLinha = {
  lancamento_id: string;
  data: string;
  historico_codigo: string | null;
  historico_complemento: string;
  tipo: Natureza;
  valor_cents: number;
  saldo_cents: number;
  saldo_natureza: Natureza | null;
};

export type RazaoRelatorio = {
  periodo: Periodo;
  conta: { codigo: string; nome: string };
  saldo_anterior_cents: number;
  saldo_anterior_natureza: Natureza | null;
  linhas: RazaoLinha[];
  saldo_atual_cents: number;
  saldo_atual_natureza: Natureza | null;
};

/**
 * Razão de UMA conta analítica: saldo anterior (lido verbatim de
 * saldos_contabeis) + cada partida em ordem cronológica com saldo corrente.
 *
 * NÃO cruza o resultado do walk com saldos_contabeis.saldo_atual — período
 * fechado tem lancamentos tipicamente vazio/parcial (só período aberto
 * recebe lançamento manual; POST /balancete/importar fecha o período por
 * cima e grava saldos_contabeis a partir do PDF, uma fonte independente).
 * Divergir nesse caso é esperado, não um bug — o saldo_atual devolvido aqui
 * é sempre "o que os lançamentos visíveis somam", nunca uma alegação sobre
 * o saldo oficial do período.
 */
export async function montarRazao(
  supabase: SupabaseClient,
  periodoId: string,
  planoContaId: string,
): Promise<RazaoRelatorio> {
  const { data: periodo, error: perErr } = await supabase
    .from(PERIODO_TABLE)
    .select('id, client_id, ano, mes, status, fechado_em, created_at, updated_at')
    .eq('id', periodoId)
    .maybeSingle();
  if (perErr) throw mapPgrstError(perErr, 'buscar período pro razão');
  if (!periodo) throw notFound('Período não encontrado');
  const periodoRow = periodo as Periodo;

  const { data: conta, error: contaErr } = await supabase
    .from(PLANO_TABLE)
    .select('id, client_id, codigo, nome, tipo')
    .eq('id', planoContaId)
    .maybeSingle();
  if (contaErr) throw mapPgrstError(contaErr, 'buscar conta pro razão');
  if (!conta) throw notFound('Conta não encontrada');
  const contaRow = conta as Conta;
  if (contaRow.client_id !== periodoRow.client_id) {
    throw badRequest('Essa conta não pertence ao cliente desse período.');
  }
  if (contaRow.tipo !== 'A') {
    throw badRequest('Conta sintética não tem razão — selecione uma conta analítica.');
  }

  const { data: saldoRow, error: saldoErr } = await supabase
    .from(SALDO_TABLE)
    .select('saldo_anterior_cents, saldo_anterior_natureza')
    .eq('periodo_id', periodoId)
    .eq('plano_conta_id', planoContaId)
    .maybeSingle();
  if (saldoErr) throw mapPgrstError(saldoErr, 'buscar saldo anterior pro razão');
  const saldoAnterior: Saldo = saldoRow
    ? {
        cents: saldoRow.saldo_anterior_cents as number,
        natureza: saldoRow.saldo_anterior_natureza as Natureza | null,
      }
    : { cents: 0, natureza: null };

  const { data: lancsRaw, error: lancsErr } = await supabase
    .from(LANC_TABLE)
    .select('id, data, historico_codigo, historico_complemento, created_at')
    .eq('periodo_id', periodoId)
    .limit(LIMITE_LINHAS);
  if (lancsErr) throw mapPgrstError(lancsErr, 'ler lançamentos pro razão');
  const lancamentos = (lancsRaw ?? []) as LancInfo[];
  const lancamentoPorId = new Map(lancamentos.map((l) => [l.id, l]));
  const lancamentoIds = lancamentos.map((l) => l.id);

  let partidas: PartidaInfo[] = [];
  if (lancamentoIds.length > 0) {
    const { data: partidasRaw, error: partidasErr } = await supabase
      .from(PARTIDA_TABLE)
      .select('id, lancamento_id, tipo, valor_cents, ordem')
      .eq('plano_conta_id', planoContaId)
      .in('lancamento_id', lancamentoIds)
      .limit(LIMITE_LINHAS);
    if (partidasErr) throw mapPgrstError(partidasErr, 'ler partidas pro razão');
    partidas = (partidasRaw ?? []) as PartidaInfo[];
  }

  // Ordena por (data, created_at do lançamento, ordem da partida) — três
  // chaves, não duas: nada impede duas partidas do MESMO lançamento baterem
  // na mesma conta (zod só valida soma D=C, não unicidade de conta por
  // lançamento), e nesse caso as duas compartilham (data, created_at)
  // idênticos — só `ordem` desempata de forma estável.
  const combinadas = partidas
    .map((partida) => ({ partida, lancamento: lancamentoPorId.get(partida.lancamento_id) }))
    .filter((c): c is { partida: PartidaInfo; lancamento: LancInfo } => !!c.lancamento)
    .sort((a, b) => {
      if (a.lancamento.data !== b.lancamento.data) return a.lancamento.data.localeCompare(b.lancamento.data);
      if (a.lancamento.created_at !== b.lancamento.created_at) {
        return a.lancamento.created_at.localeCompare(b.lancamento.created_at);
      }
      return a.partida.ordem - b.partida.ordem;
    });

  let corrente = saldoAnterior;
  const linhas: RazaoLinha[] = combinadas.map(({ partida, lancamento }) => {
    const debito = partida.tipo === 'D' ? partida.valor_cents : 0;
    const credito = partida.tipo === 'C' ? partida.valor_cents : 0;
    corrente = aplicarMovimento(corrente, debito, credito);
    return {
      lancamento_id: lancamento.id,
      data: lancamento.data,
      historico_codigo: lancamento.historico_codigo,
      historico_complemento: lancamento.historico_complemento,
      tipo: partida.tipo,
      valor_cents: partida.valor_cents,
      saldo_cents: corrente.cents,
      saldo_natureza: corrente.natureza,
    };
  });

  return {
    periodo: periodoRow,
    conta: { codigo: contaRow.codigo, nome: contaRow.nome },
    saldo_anterior_cents: saldoAnterior.cents,
    saldo_anterior_natureza: saldoAnterior.natureza,
    linhas,
    saldo_atual_cents: corrente.cents,
    saldo_atual_natureza: corrente.natureza,
  };
}
