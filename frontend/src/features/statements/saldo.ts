import type { Transaction } from '@/lib/types';

const cents = (v: string) => Math.round(Number(v) * 100);

export type SaldoInfo = {
  inicialCents: number;
  finalCents: number;
  entradasCents: number;
  saidasCents: number;
  /** saldo (em centavos) logo APÓS cada lançamento, por id */
  aposPorId: Map<string, number>;
  /** transações em ordem cronológica (data, depois ordem do arquivo) */
  cronologica: Transaction[];
};

/**
 * Saldo acumulado: parte do saldo inicial e vai somando entradas / subtraindo
 * saídas na ordem cronológica. Inclui TODAS as transações (mesmo as inativadas)
 * — o saldo do banco mexeu de qualquer jeito.
 */
export function computeSaldo(transactions: Transaction[], saldoInicial: number): SaldoInfo {
  const inicialCents = Math.round(saldoInicial * 100);
  const cronologica = [...transactions].sort(
    (a, b) => a.data.localeCompare(b.data) || a.ordem - b.ordem,
  );

  const aposPorId = new Map<string, number>();
  let running = inicialCents;
  let entradasCents = 0;
  let saidasCents = 0;

  for (const t of cronologica) {
    const v = cents(t.valor);
    if (t.direction === 'entrada') {
      running += v;
      entradasCents += v;
    } else {
      running -= v;
      saidasCents += v;
    }
    aposPorId.set(t.id, running);
  }

  return { inicialCents, finalCents: running, entradasCents, saidasCents, aposPorId, cronologica };
}
