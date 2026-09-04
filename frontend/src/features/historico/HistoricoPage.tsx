import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { Statement, StatementStatus } from '@/lib/types';
import { useDeleteStatement, useStatements } from '@/features/statements/api';
import { BaixarDominio } from '@/features/statements/BaixarDominio';
import { ReimportarExtrato } from '@/features/statements/ReimportarExtrato';

const STATUS_LABEL: Record<StatementStatus, { text: string; cls: string }> = {
  parsing: { text: 'lendo', cls: 'bg-slate-100 text-slate-600' },
  revisao: { text: 'em revisão', cls: 'bg-amber-100 text-amber-800' },
  gerado: { text: 'arquivo gerado', cls: 'bg-green-100 text-green-700' },
  erro: { text: 'erro', cls: 'bg-red-100 text-red-700' },
};

export function HistoricoPage() {
  const { data: statements, isLoading, error } = useStatements();
  const delMut = useDeleteStatement();
  const [deleting, setDeleting] = useState<Statement | null>(null);

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-800">Histórico de importações</h1>

      <div className="card overflow-x-auto">
        {isLoading ? (
          <p className="p-6 text-sm text-slate-400">Carregando…</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-600">
            {error instanceof Error ? error.message : 'Falha ao carregar'}
          </p>
        ) : !statements?.length ? (
          <p className="p-6 text-sm text-slate-400">Nenhuma importação ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">Arquivo</th>
                <th className="px-4 py-2">Período</th>
                <th className="px-4 py-2">Lanç.</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {statements.map((s: Statement) => {
                const st = STATUS_LABEL[s.status];
                const totais = 'qtd' in s.totais ? s.totais : null;
                return (
                  <tr key={s.id}>
                    <td className="px-4 py-2 font-medium text-slate-800">
                      {s.client?.razao_social ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {s.arquivo_nome}
                      <span className="ml-1 text-xs text-slate-400">
                        {s.formato.toUpperCase()}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                      {s.period_start && s.period_end
                        ? `${formatDate(s.period_start)}–${formatDate(s.period_end)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{totais?.qtd ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${st.cls}`}>
                        {st.text}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {s.status !== 'parsing' && (
                        <Link to={`/revisao/${s.id}`} className="text-brand-600 hover:underline">
                          abrir
                        </Link>
                      )}
                      {s.status === 'gerado' && (
                        <>
                          <span className="mx-2 text-slate-300">·</span>
                          <BaixarDominio statementId={s.id} />
                        </>
                      )}
                      {s.status !== 'parsing' && (
                        <>
                          <span className="mx-2 text-slate-300">·</span>
                          <ReimportarExtrato statementId={s.id} qtd={totais?.qtd ?? 0} />
                        </>
                      )}
                      <button
                        className="ml-3 text-slate-400 hover:text-red-600"
                        onClick={() => setDeleting(s)}
                      >
                        excluir
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={!!deleting}
        title="Excluir importação"
        message={`Excluir a importação de "${deleting?.arquivo_nome}"? Os lançamentos lidos serão apagados.`}
        busy={delMut.isPending}
        error={
          delMut.isError
            ? delMut.error instanceof ApiError
              ? delMut.error.message
              : 'Falha ao excluir'
            : null
        }
        onConfirm={() =>
          deleting && delMut.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
        }
        onCancel={() => {
          setDeleting(null);
          delMut.reset();
        }}
      />
    </section>
  );
}
