import { useMemo, useState } from 'react';
import { formatMoney } from '@/lib/format';
import type { Transaction } from '@/lib/types';
import { computeSaldo } from './saldo';

/**
 * Painel de conferência do saldo bancário.
 * saldoInicial: número (reais). Se não bater com o extrato, o operador ajusta.
 */
export function SaldoReconciliacao({
  transactions,
  saldoInicial,
  onSaldoInicial,
}: {
  transactions: Transaction[];
  saldoInicial: number;
  onSaldoInicial?: (v: number) => void;
}) {
  const info = useMemo(() => computeSaldo(transactions, saldoInicial), [transactions, saldoInicial]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(saldoInicial).replace('.', ','));

  const linha = (label: string, cents: number, tone?: 'green' | 'red' | 'strong') => (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span
        className={
          tone === 'green'
            ? 'font-medium text-green-700'
            : tone === 'red'
              ? 'font-medium text-red-700'
              : tone === 'strong'
                ? 'text-base font-semibold text-slate-800'
                : 'text-slate-700'
        }
      >
        {formatMoney(cents)}
      </span>
    </div>
  );

  return (
    <div className="card space-y-1.5 p-4 text-sm">
      <div className="flex items-center justify-between">
        <p className="font-medium text-slate-700">Conferência do saldo bancário</p>
        {onSaldoInicial && !editing && (
          <button className="text-xs text-brand-600 hover:underline" onClick={() => setEditing(true)}>
            ajustar saldo inicial
          </button>
        )}
      </div>

      {editing && onSaldoInicial ? (
        <div className="flex items-center gap-2 py-1">
          <span className="text-slate-500">Saldo inicial R$</span>
          <input
            className="input h-8 w-32"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            className="btn-primary h-8 px-3"
            onClick={() => {
              onSaldoInicial(Number(draft.replace(/\./g, '').replace(',', '.')) || 0);
              setEditing(false);
            }}
          >
            ok
          </button>
          <button className="btn-ghost h-8 px-3" onClick={() => setEditing(false)}>
            cancelar
          </button>
        </div>
      ) : (
        linha('Saldo inicial', info.inicialCents)
      )}

      {linha(`Entradas (${info.cronologica.filter((t) => t.direction === 'entrada').length})`, info.entradasCents, 'green')}
      {linha(`Saídas (${info.cronologica.filter((t) => t.direction === 'saida').length})`, -info.saidasCents, 'red')}
      <div className="border-t border-slate-200 pt-1.5">
        {linha('Saldo final calculado', info.finalCents, 'strong')}
      </div>
      <p className="pt-1 text-xs text-slate-400">
        Compare o "saldo final calculado" com o saldo do extrato no fim do período. Se não bater,
        confira o saldo inicial ou algum lançamento faltando.
      </p>
    </div>
  );
}
