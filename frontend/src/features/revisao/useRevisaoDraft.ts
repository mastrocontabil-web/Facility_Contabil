import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Transaction } from '@/lib/types';
import type { TransactionUpdate } from '@/features/statements/api';

export type RowDraft = {
  conta_contabil: string;
  hist_code: string;
  hist_complemento: string;
  ignorado: boolean;
};

function fromTxn(t: Transaction): RowDraft {
  return {
    conta_contabil: t.conta_contabil ?? '',
    hist_code: t.hist_code ?? '',
    hist_complemento: t.hist_complemento ?? '',
    ignorado: t.ignorado,
  };
}

function eq(a: RowDraft, b: RowDraft): boolean {
  return (
    a.conta_contabil === b.conta_contabil &&
    a.hist_code === b.hist_code &&
    a.hist_complemento === b.hist_complemento &&
    a.ignorado === b.ignorado
  );
}

type DraftMap = Map<string, RowDraft>;

export function useRevisaoDraft(transactions: Transaction[]) {
  const initial = useMemo<DraftMap>(() => {
    const m = new Map<string, RowDraft>();
    for (const t of transactions) m.set(t.id, fromTxn(t));
    return m;
  }, [transactions]);

  const [draft, setDraft] = useState<DraftMap>(() => new Map(initial));

  useEffect(() => setDraft(new Map(initial)), [initial]);

  const get = useCallback(
    (id: string): RowDraft =>
      draft.get(id) ?? { conta_contabil: '', hist_code: '', hist_complemento: '', ignorado: false },
    [draft],
  );

  const patchRow = useCallback((id: string, patch: Partial<RowDraft>) => {
    setDraft((d) => {
      const cur = d.get(id);
      if (!cur) return d;
      const next = new Map(d);
      next.set(id, { ...cur, ...patch });
      return next;
    });
  }, []);

  const patchMany = useCallback(
    (predicate: (t: Transaction) => boolean, patch: Partial<RowDraft>) => {
      setDraft((d) => {
        const next = new Map(d);
        for (const t of transactions) {
          const cur = next.get(t.id);
          if (cur && predicate(t)) next.set(t.id, { ...cur, ...patch });
        }
        return next;
      });
    },
    [transactions],
  );

  const reset = useCallback(() => setDraft(new Map(initial)), [initial]);

  const changes = useMemo<TransactionUpdate[]>(() => {
    const out: TransactionUpdate[] = [];
    for (const t of transactions) {
      const d = draft.get(t.id);
      const base = initial.get(t.id);
      if (!d || !base || eq(d, base)) continue;
      // mexeu na classificação → vira 'manual'; só (in)ativou → mantém a origem
      const mexeuClassif =
        d.conta_contabil !== base.conta_contabil ||
        d.hist_code !== base.hist_code ||
        d.hist_complemento !== base.hist_complemento;
      out.push({
        id: t.id,
        conta_contabil: d.conta_contabil.trim() || null,
        hist_code: d.hist_code.trim(),
        hist_complemento: d.hist_complemento.trim(),
        ignorado: d.ignorado,
        origem_preenchimento: mexeuClassif ? 'manual' : t.origem_preenchimento,
      });
    }
    return out;
  }, [transactions, draft, initial]);

  return { get, patchRow, patchMany, reset, changes, isDirty: changes.length > 0 };
}
