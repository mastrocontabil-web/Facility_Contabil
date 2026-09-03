import { useState } from 'react';

type Dir = 'entrada' | 'saida';
export type ComplementoModo = 'extrato' | 'complemento' | 'ambos';

const MODO_LABEL: Record<ComplementoModo, string> = {
  ambos: 'Histórico do extrato + complemento',
  extrato: 'Somente o histórico do extrato',
  complemento: 'Somente o complemento',
};

export function BulkBar({
  onApplyConta,
  onApplyHist,
  onIgnore,
  complementoModo,
  onComplementoModo,
  savingModo,
}: {
  onApplyConta: (dir: Dir, conta: string) => void;
  onApplyHist: (dir: Dir, hist: string) => void;
  onIgnore: (target: 'entrada' | 'saida' | 'reativar') => void;
  complementoModo: ComplementoModo;
  onComplementoModo: (m: ComplementoModo) => void;
  savingModo: boolean;
}) {
  const [conta, setConta] = useState('');
  const [hist, setHist] = useState('');
  const [dir, setDir] = useState<Dir>('saida');

  return (
    <div className="card space-y-3 p-4">
      <p className="text-sm font-medium text-slate-700">Ações em massa</p>

      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col">
          <span className="mb-1 text-xs text-slate-500">Aplicar em</span>
          <select className="input h-9 w-32" value={dir} onChange={(e) => setDir(e.target.value as Dir)}>
            <option value="saida">todas as saídas</option>
            <option value="entrada">todas as entradas</option>
          </select>
        </label>

        <label className="flex flex-col">
          <span className="mb-1 text-xs text-slate-500">Conta contábil</span>
          <div className="flex gap-1">
            <input
              className="input h-9 w-36"
              value={conta}
              onChange={(e) => setConta(e.target.value)}
              placeholder="ex: 10004"
            />
            <button
              className="btn-ghost h-9 px-3"
              disabled={!conta.trim()}
              onClick={() => onApplyConta(dir, conta.trim())}
            >
              aplicar
            </button>
          </div>
        </label>

        <label className="flex flex-col">
          <span className="mb-1 text-xs text-slate-500">Cód. histórico</span>
          <div className="flex gap-1">
            <input
              className="input h-9 w-24"
              value={hist}
              inputMode="numeric"
              onChange={(e) => setHist(e.target.value)}
              placeholder="138"
            />
            <button
              className="btn-ghost h-9 px-3"
              disabled={!hist.trim()}
              onClick={() => onApplyHist(dir, hist.trim())}
            >
              aplicar
            </button>
          </div>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-sm">
        <span className="text-xs text-slate-500">Complemento no arquivo:</span>
        <select
          className="input h-9 w-72"
          value={complementoModo}
          disabled={savingModo}
          onChange={(e) => onComplementoModo(e.target.value as ComplementoModo)}
        >
          {(Object.keys(MODO_LABEL) as ComplementoModo[]).map((m) => (
            <option key={m} value={m}>
              {MODO_LABEL[m]}
            </option>
          ))}
        </select>
        {savingModo && <span className="text-xs text-slate-400">salvando…</span>}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 text-sm">
        <span className="self-center text-xs text-slate-500">Inativar:</span>
        <button
          className="btn border border-red-200 bg-red-50 px-3 py-1.5 text-red-700 hover:bg-red-100"
          onClick={() => onIgnore('saida')}
        >
          todas as saídas
        </button>
        <button
          className="btn border border-red-200 bg-red-50 px-3 py-1.5 text-red-700 hover:bg-red-100"
          onClick={() => onIgnore('entrada')}
        >
          todas as entradas
        </button>
        <button
          className="btn border border-slate-300 bg-white px-3 py-1.5 text-slate-600 hover:bg-slate-100"
          onClick={() => onIgnore('reativar')}
        >
          reativar todos
        </button>
      </div>
    </div>
  );
}
