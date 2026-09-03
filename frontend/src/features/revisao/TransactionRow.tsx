import { memo } from 'react';
import { formatDate, formatMoney } from '@/lib/format';
import type { Transaction } from '@/lib/types';
import type { ComplementoModo } from './BulkBar';
import { composeComplemento } from './complemento';
import type { RowDraft } from './useRevisaoDraft';

export const TransactionRow = memo(function TransactionRow({
  txn,
  draft,
  onPatch,
  complementoModo,
}: {
  txn: Transaction;
  draft: RowDraft;
  onPatch: (patch: Partial<RowDraft>) => void;
  complementoModo: ComplementoModo;
}) {
  const ign = draft.ignorado;
  const cents = Math.round(Number(txn.valor) * 100);
  const preview = composeComplemento(complementoModo, txn.descricao_raw, draft.hist_complemento);

  return (
    <tr className={ign ? 'bg-slate-50 text-slate-400' : ''}>
      <td className="px-2 py-1 text-center">
        <input
          type="checkbox"
          title="Inativar este lançamento (não vai pro arquivo)"
          checked={ign}
          onChange={(e) => onPatch({ ignorado: e.target.checked })}
        />
      </td>
      <td className="whitespace-nowrap px-2 py-1 text-xs">{formatDate(txn.data)}</td>
      <td className={`px-2 py-1 text-xs ${ign ? 'line-through' : 'text-slate-700'}`}>
        {txn.descricao_raw}
      </td>
      <td className="whitespace-nowrap px-2 py-1 text-right text-xs tabular-nums">
        {formatMoney(cents)}
      </td>
      <td className="px-2 py-1">
        <span
          className={`rounded px-1 py-0.5 text-[10px] font-medium ${
            txn.direction === 'entrada'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          } ${ign ? 'opacity-40' : ''}`}
        >
          {txn.direction === 'entrada' ? 'ent' : 'saí'}
        </span>
      </td>
      <td className="px-1 py-1">
        <input
          className="input h-8 w-24 px-2 py-1 text-xs disabled:bg-slate-100"
          value={draft.conta_contabil}
          disabled={ign}
          onChange={(e) => onPatch({ conta_contabil: e.target.value })}
          placeholder="conta"
        />
      </td>
      <td className="px-1 py-1">
        <input
          className="input h-8 w-16 px-2 py-1 text-xs disabled:bg-slate-100"
          value={draft.hist_code}
          disabled={ign}
          inputMode="numeric"
          onChange={(e) => onPatch({ hist_code: e.target.value })}
          placeholder="hist"
        />
      </td>
      <td className="px-1 py-1">
        <input
          className="input h-8 w-full min-w-[13rem] px-2 py-1 text-xs disabled:bg-slate-100"
          value={draft.hist_complemento}
          disabled={ign}
          onChange={(e) => onPatch({ hist_complemento: e.target.value })}
          placeholder={
            complementoModo === 'extrato'
              ? '(usando o histórico do extrato)'
              : 'complemento do histórico'
          }
        />
      </td>
      <td className="px-2 py-1">
        <span
          className="block max-w-[18rem] truncate text-[11px] text-slate-500"
          title={preview}
        >
          {preview || <span className="text-slate-300">— vazio —</span>}
        </span>
      </td>
      <td className="whitespace-nowrap px-2 py-1 text-center">
        {txn.origem_preenchimento === 'memoria' && (
          <span
            className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700"
            title="Preenchido pela memória (você já classificou essa descrição antes)"
          >
            memória
          </span>
        )}
        {txn.origem_preenchimento === 'conferir' && (
          <span
            className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
            title="Essa descrição já foi classificada com contas diferentes — confira"
          >
            conferir
          </span>
        )}
      </td>
    </tr>
  );
});
