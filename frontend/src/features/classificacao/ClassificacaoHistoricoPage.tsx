import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { Statement, StatementStatus } from '@/lib/types';
import { useClients } from '@/features/clients/api';
import { useDeleteStatement, useStatements } from '@/features/statements/api';

const STATUS_LABEL: Partial<Record<StatementStatus, { text: string; cls: string }>> = {
  parsing: { text: 'lendo', cls: 'bg-slate-100 text-slate-600' },
  classificacao: { text: 'classificando', cls: 'bg-brand-100 text-brand-800' },
  revisao: { text: 'puxado p/ importação', cls: 'bg-amber-100 text-amber-800' },
  gerado: { text: 'arquivo gerado', cls: 'bg-green-100 text-green-700' },
  erro: { text: 'erro', cls: 'bg-red-100 text-red-700' },
};

export function ClassificacaoHistoricoPage() {
  const { data: clients } = useClients({ ativo: 'all' });
  const [clientId, setClientId] = useState('');
  const { data: statements, isLoading, error } = useStatements({
    client_id: clientId || undefined,
    origem_modulo: 'classificacao',
  });

  const delMut = useDeleteStatement();
  const [deleting, setDeleting] = useState<Statement | null>(null);

  const shown = statements ?? [];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Histórico — Classificação</h1>
        <Link to="/classificacao" className="btn-primary">
          + Classificar extrato
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className="input max-w-xs" value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">Todos os clientes</option>
          {clients?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.razao_social}
            </option>
          ))}
        </select>
        {clientId && (
          <button className="text-sm text-slate-400 hover:text-slate-600" onClick={() => setClientId('')}>
            limpar filtro
          </button>
        )}
      </div>

      <div className="card overflow-x-auto">
        {isLoading ? (
          <p className="p-6 text-sm text-slate-400">Carregando…</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-600">
            {error instanceof Error ? error.message : 'Falha ao carregar'}
          </p>
        ) : !shown.length ? (
          <p className="p-6 text-sm text-slate-400">
            {clientId ? 'Nenhum extrato com esse filtro.' : 'Nenhum extrato classificado ainda.'}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">Arquivo</th>
                <th className="px-4 py-2">Período</th>
                <th className="px-4 py-2 text-right">Lanç.</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((s: Statement) => {
                const st = STATUS_LABEL[s.status] ?? { text: s.status, cls: 'bg-slate-100 text-slate-600' };
                const totais = 'qtd' in s.totais ? s.totais : null;
                const destino = s.status === 'classificacao' ? `/classificacao/revisao/${s.id}` : `/revisao/${s.id}`;
                return (
                  <tr key={s.id}>
                    <td className="px-4 py-2 font-medium text-slate-800">{s.client?.razao_social ?? '—'}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {s.arquivo_nome}
                      <span className="ml-1 text-xs text-slate-400">{s.formato.toUpperCase()}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                      {s.period_start && s.period_end
                        ? `${formatDate(s.period_start)}–${formatDate(s.period_end)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-600">{totais?.qtd ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.text}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      {s.status !== 'parsing' && (
                        <Link to={destino} className="text-brand-600 hover:underline">
                          {s.status === 'classificacao' ? 'classificar' : 'abrir'}
                        </Link>
                      )}
                      <button className="ml-3 text-slate-400 hover:text-red-600" onClick={() => setDeleting(s)}>
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
        title="Excluir extrato"
        message={`Excluir o extrato "${deleting?.arquivo_nome}"? Os lançamentos e classificações serão apagados.`}
        busy={delMut.isPending}
        error={
          delMut.isError ? (delMut.error instanceof ApiError ? delMut.error.message : 'Falha ao excluir') : null
        }
        onConfirm={() => deleting && delMut.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
        onCancel={() => {
          setDeleting(null);
          delMut.reset();
        }}
      />
    </section>
  );
}
