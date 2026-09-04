import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import type { Statement, StatementStatus } from '@/lib/types';
import { useClients } from '@/features/clients/api';
import { useDeleteStatement, useDeleteStatements, useStatements } from '@/features/statements/api';
import { BaixarDominio } from '@/features/statements/BaixarDominio';
import { ReimportarExtrato } from '@/features/statements/ReimportarExtrato';

const STATUS_LABEL: Partial<Record<StatementStatus, { text: string; cls: string }>> = {
  parsing: { text: 'lendo', cls: 'bg-slate-100 text-slate-600' },
  revisao: { text: 'em revisão', cls: 'bg-amber-100 text-amber-800' },
  gerado: { text: 'arquivo gerado', cls: 'bg-green-100 text-green-700' },
  erro: { text: 'erro', cls: 'bg-red-100 text-red-700' },
};

export function HistoricoPage() {
  const { data: clients } = useClients({ ativo: 'all' });
  const [clientId, setClientId] = useState('');
  const [status, setStatus] = useState<StatementStatus | ''>('');
  const { data: statements, isLoading, error } = useStatements({
    client_id: clientId || undefined,
    status: status || undefined,
  });

  const delMut = useDeleteStatement();
  const delManyMut = useDeleteStatements();
  const [deleting, setDeleting] = useState<Statement | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);

  // extratos ainda presos no módulo Classificação (não puxados) ficam só no
  // histórico de lá; se o filtro muda e a seleção não existe mais, tira ela.
  const shown = useMemo(
    () => (statements ?? []).filter((s) => s.status !== 'classificacao'),
    [statements],
  );
  const shownIds = useMemo(() => new Set(shown.map((s) => s.id)), [shown]);
  const selecionadosNaLista = [...selected].filter((id) => shownIds.has(id));
  const todosSelecionados = shown.length > 0 && selecionadosNaLista.length === shown.length;

  function toggleAll() {
    setSelected(todosSelecionados ? new Set() : new Set(shownIds));
  }
  function toggleUm(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Histórico de importações</h1>
        <Link to="/importar" className="btn-primary">
          + Nova importação
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
        <select
          className="input max-w-[10rem]"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatementStatus | '')}
        >
          <option value="">Todos os status</option>
          <option value="revisao">Em revisão</option>
          <option value="gerado">Arquivo gerado</option>
          <option value="erro">Erro</option>
          <option value="parsing">Lendo</option>
        </select>
        {(clientId || status) && (
          <button
            className="text-sm text-slate-400 hover:text-slate-600"
            onClick={() => {
              setClientId('');
              setStatus('');
            }}
          >
            limpar filtros
          </button>
        )}
      </div>

      {selecionadosNaLista.length > 0 && (
        <div className="flex items-center justify-between rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-800">
          <span>{selecionadosNaLista.length} selecionado(s)</span>
          <div className="flex gap-3">
            <button className="hover:underline" onClick={() => setSelected(new Set())}>
              limpar seleção
            </button>
            <button className="font-medium text-red-700 hover:underline" onClick={() => setConfirmBulk(true)}>
              excluir selecionados
            </button>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        {isLoading ? (
          <p className="p-6 text-sm text-slate-400">Carregando…</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-600">
            {error instanceof Error ? error.message : 'Falha ao carregar'}
          </p>
        ) : !shown.length ? (
          <p className="p-6 text-sm text-slate-400">
            {clientId || status ? 'Nenhuma importação com esse filtro.' : 'Nenhuma importação ainda.'}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="w-8 px-4 py-2">
                  <input type="checkbox" checked={todosSelecionados} onChange={toggleAll} />
                </th>
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">Arquivo</th>
                <th className="px-4 py-2">Período</th>
                <th className="px-4 py-2 text-right">Lanç.</th>
                <th className="px-4 py-2 text-right">Saldo final</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((s: Statement) => {
                const st = STATUS_LABEL[s.status] ?? { text: s.status, cls: 'bg-slate-100 text-slate-600' };
                const totais = 'qtd' in s.totais ? s.totais : null;
                return (
                  <tr key={s.id} className={selected.has(s.id) ? 'bg-brand-50/40' : ''}>
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={() => toggleUm(s.id)}
                      />
                    </td>
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
                    <td className="px-4 py-2 text-right text-slate-600">{totais?.qtd ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-600">
                      {s.saldo_final != null ? formatMoney(Math.round(Number(s.saldo_final) * 100)) : '—'}
                    </td>
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

      <ConfirmDialog
        open={confirmBulk}
        title="Excluir importações selecionadas"
        message={`Excluir ${selecionadosNaLista.length} importação(ões)? Os lançamentos lidos serão apagados. Essa ação não pode ser desfeita.`}
        busy={delManyMut.isPending}
        error={
          delManyMut.isError
            ? delManyMut.error instanceof ApiError
              ? delManyMut.error.message
              : 'Falha ao excluir'
            : null
        }
        onConfirm={() =>
          delManyMut.mutate(selecionadosNaLista, {
            onSuccess: () => {
              setSelected(new Set());
              setConfirmBulk(false);
            },
          })
        }
        onCancel={() => {
          setConfirmBulk(false);
          delManyMut.reset();
        }}
      />
    </section>
  );
}
