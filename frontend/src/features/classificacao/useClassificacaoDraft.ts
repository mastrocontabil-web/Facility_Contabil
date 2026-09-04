import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Transaction } from '@/lib/types';

type DraftMap = Map<string, string | null>;

/** Rascunho local de `classificacao_id` por lançamento — mesmo padrão do
 *  useRevisaoDraft, só que com um campo em vez de conta/histórico/ignorado. */
export function useClassificacaoDraft(transactions: Transaction[]) {
  const initial = useMemo<DraftMap>(() => {
    const m = new Map<string, string | null>();
    for (const t of transactions) m.set(t.id, t.classificacao_id);
    return m;
  }, [transactions]);

  const [draft, setDraft] = useState<DraftMap>(() => new Map(initial));

  useEffect(() => setDraft(new Map(initial)), [initial]);

  const get = useCallback((id: string): string | null => draft.get(id) ?? null, [draft]);

  const patchRow = useCallback((id: string, classificacaoId: string | null) => {
    setDraft((d) => {
      if (!d.has(id)) return d;
      const next = new Map(d);
      next.set(id, classificacaoId);
      return next;
    });
  }, []);

  const patchMany = useCallback(
    (predicate: (t: Transaction) => boolean, classificacaoId: string | null) => {
      setDraft((d) => {
        const next = new Map(d);
        for (const t of transactions) {
          if (next.has(t.id) && predicate(t)) next.set(t.id, classificacaoId);
        }
        return next;
      });
    },
    [transactions],
  );

  const reset = useCallback(() => setDraft(new Map(initial)), [initial]);

  const changes = useMemo(() => {
    const out: { id: string; classificacao_id: string | null }[] = [];
    for (const t of transactions) {
      const d = draft.get(t.id);
      const base = initial.get(t.id);
      if (d === undefined || d === base) continue;
      out.push({ id: t.id, classificacao_id: d });
    }
    return out;
  }, [transactions, draft, initial]);

  return { get, patchRow, patchMany, reset, changes, isDirty: changes.length > 0 };
}
