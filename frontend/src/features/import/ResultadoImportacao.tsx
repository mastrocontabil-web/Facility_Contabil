import { useNavigate } from 'react-router-dom';
import { useUpdateStatementHeader, type ImportResult } from '@/features/statements/api';
import { StatementSummary } from '@/features/statements/StatementSummary';
import { TransactionsTable } from '@/features/statements/TransactionsTable';
import { SaldoReconciliacao } from '@/features/statements/SaldoReconciliacao';

/** Tela depois de ler o arquivo: resumo, conferência do saldo, avisos e lançamentos → Revisão. */
export function ResultadoImportacao({
  titulo,
  result,
  saldoInicial,
  onSaldoInicial,
  onNova,
}: {
  titulo: string;
  result: ImportResult;
  saldoInicial: number;
  /** "ajustar saldo inicial": atualiza o campo da tela (o extrato já é gravado aqui) */
  onSaldoInicial: (v: number) => void;
  onNova: () => void;
}) {
  const navigate = useNavigate();
  const headerMut = useUpdateStatementHeader(result.statement.id);
  const porMemoria = result.transactions.filter(
    (t) => t.origem_preenchimento === 'memoria' || t.origem_preenchimento === 'conferir',
  ).length;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">{titulo}</h1>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={onNova}>
            Nova importação
          </button>
          <button
            className="btn-primary"
            onClick={() => navigate(`/revisao/${result.statement.id}`)}
          >
            Ir para revisão →
          </button>
        </div>
      </div>

      <StatementSummary statement={result.statement} />

      {porMemoria > 0 && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          {porMemoria} lançamento{porMemoria > 1 ? 's já vieram' : ' já veio'} preenchido
          {porMemoria > 1 ? 's' : ''} pela memória do cliente.
        </p>
      )}

      <SaldoReconciliacao
        transactions={result.transactions}
        saldoInicial={saldoInicial}
        onSaldoInicial={(v) => {
          onSaldoInicial(v);
          headerMut.mutate({ saldo_inicial: v.toFixed(2) });
        }}
      />

      {result.warnings.length > 0 && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <p className="font-medium">Avisos do leitor:</p>
          <ul className="ml-4 list-disc">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <TransactionsTable transactions={result.transactions} readOnly saldoInicial={saldoInicial} />
    </section>
  );
}
