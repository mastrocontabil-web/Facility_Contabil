import { formatDate, formatMoney } from '@/lib/format';
import type { Statement, StatementTotais } from '@/lib/types';

function hasTotais(t: Statement['totais']): t is StatementTotais {
  return typeof (t as StatementTotais)?.qtd === 'number';
}

export function StatementSummary({ statement }: { statement: Statement }) {
  const t = statement.totais;
  const periodo =
    statement.period_start && statement.period_end
      ? `${formatDate(statement.period_start)} a ${formatDate(statement.period_end)}`
      : '—';

  return (
    <div className="card grid grid-cols-2 gap-x-8 gap-y-2 p-4 text-sm sm:grid-cols-4">
      <Info label="Arquivo" value={`${statement.arquivo_nome} (${statement.formato.toUpperCase()})`} />
      <Info label="Período" value={periodo} />
      <Info label="Conta do banco" value={statement.banco_conta_contabil ?? '—'} />
      <Info label="Lote Domínio" value={String(statement.lote_numero)} />
      {hasTotais(t) && (
        <>
          <Info label="Lançamentos" value={String(t.qtd)} />
          <Info
            label="Entradas"
            value={`${t.entradas.n} · ${formatMoney(t.entradas.valor_cents)}`}
            tone="green"
          />
          <Info
            label="Saídas"
            value={`${t.saidas.n} · ${formatMoney(t.saidas.valor_cents)}`}
            tone="red"
          />
          <Info
            label="Resultado"
            value={formatMoney(t.entradas.valor_cents - t.saidas.valor_cents)}
          />
        </>
      )}
    </div>
  );
}

function Info({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'green' | 'red';
}) {
  return (
    <div>
      <p className="text-xs uppercase text-slate-400">{label}</p>
      <p
        className={
          tone === 'green'
            ? 'font-medium text-green-700'
            : tone === 'red'
              ? 'font-medium text-red-700'
              : 'font-medium text-slate-800'
        }
      >
        {value}
      </p>
    </div>
  );
}
