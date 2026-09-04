import { useState } from 'react';
import type { Classificacao, Direction } from '@/lib/types';
import { NovaClassificacaoModal } from './NovaClassificacaoModal';

const NOVA = '__nova__';

export function ClassificacaoSelect({
  clientId,
  direction,
  options,
  value,
  disabled,
  onChange,
  className,
}: {
  clientId: string;
  direction: Direction;
  options: Classificacao[];
  value: string | null;
  disabled?: boolean;
  onChange: (id: string | null) => void;
  className?: string;
}) {
  const [creating, setCreating] = useState(false);

  return (
    <>
      <select
        className={className ?? 'input h-8 px-2 py-1 text-xs disabled:bg-slate-100'}
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === NOVA) {
            setCreating(true);
            return;
          }
          onChange(e.target.value || null);
        }}
      >
        <option value="">— sem classificação —</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
          </option>
        ))}
        <option value={NOVA}>+ nova classificação…</option>
      </select>

      <NovaClassificacaoModal
        open={creating}
        clientId={clientId}
        direction={direction}
        onClose={() => setCreating(false)}
        onCreated={(c) => onChange(c.id)}
      />
    </>
  );
}
