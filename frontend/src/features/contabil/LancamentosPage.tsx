import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ApiError } from '@/lib/api';
import { useClients } from '@/features/clients/api';
import { formatCompetencia, formatDate, formatMoney } from '@/lib/format';
import type { Lancamento } from '@/lib/types';
import { useDeleteLancamento, useLancamentos, usePeriodos } from './api';
import { LancamentoModal } from './LancamentoModal';
import { Historico } from './SaldoRow';

export function LancamentosPage() {
  const { data: clients, isLoading: loadingClients } = useClients({ ativo: 'true' });
  const [clientId, setClientId] = useState('');
  const [periodoId, setPeriodoId] = useState('');
  const [modal, setModal] = useState<{ lancamento: Lancamento | null } | null>(null);
  const [deleting, setDeleting] = useState<Lancamento | null>(null);

  const { data: periodos, isLoading: loadingPeriodos } = usePeriodos(clientId || undefined);
  const { data: lancamentos, isLoading, error } = useLancamentos(periodoId || undefined);
  const deleteMut = useDeleteLancamento(periodoId || undefined);

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Lançamentos</h1>
        <p className="text-sm text-slate-500">
          Lançamento manual em partida dobrada (simples ou múltipla). O período abre sozinho como
          "aberto" no mês da data lançada — não dá pra lançar num período já fechado (importado pelo
          Balancete).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          className="input max-w-md"
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setPeriodoId('');
          }}
          disabled={loadingClients}
        >
          <option value="">{loadingClients ? 'Carregando…' : 'Selecione o cliente…'}</option>
          {clients?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.razao_social} — Domínio {c.dominio_code}
            </option>
          ))}
        </select>

        {clientId && (
          <select
            className="input max-w-xs"
            value={periodoId}
            onChange={(e) => setPeriodoId(e.target.value)}
            disabled={loadingPeriodos}
          >
            <option value="">{loadingPeriodos ? 'Carregando…' : 'Selecione um período…'}</option>
            {periodos?.map((p) => (
              <option key={p.id} value={p.id}>
                {formatCompetencia(p.ano, p.mes)} {p.status === 'fechado' ? '🔒 fechado' : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      {!clientId ? (
        <p className="card p-6 text-sm text-slate-400">Escolha um cliente.</p>
      ) : (
        <>
          <div className="flex justify-end">
            <button className="btn-primary" onClick={() => setModal({ lancamento: null })}>
              + novo lançamento
            </button>
          </div>

          {!periodoId ? (
            <p className="card p-6 text-sm text-slate-400">
              {periodos?.length
                ? 'Escolha um período acima pra ver os lançamentos.'
                : 'Esse cliente ainda não tem período nenhum — crie o primeiro lançamento acima (o período abre sozinho).'}
            </p>
          ) : (
            <div className="card overflow-x-auto p-0">
              {isLoading ? (
                <p className="p-4 text-sm text-slate-400">Carregando…</p>
              ) : error ? (
                <p className="p-4 text-sm text-red-600">
                  {error instanceof Error ? error.message : 'Falha ao carregar'}
                </p>
              ) : !lancamentos?.length ? (
                <p className="p-4 text-sm text-slate-400">Nenhum lançamento nesse período ainda.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-4 py-2">Data</th>
                      <th className="px-4 py-2">Histórico</th>
                      <th className="px-4 py-2">Partidas</th>
                      <th className="px-4 py-2 text-right">Valor</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {lancamentos.map((l) => (
                      <LancamentoRow
                        key={l.id}
                        lancamento={l}
                        onEdit={() => setModal({ lancamento: l })}
                        onDelete={() => setDeleting(l)}
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}

      {modal && (
        <LancamentoModal
          key={modal.lancamento?.id ?? 'novo'}
          clientId={clientId}
          periodoId={periodoId}
          lancamento={modal.lancamento}
          onClose={() => setModal(null)}
          onSaved={(l) => {
            setPeriodoId(l.periodo_id);
            setModal(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Excluir lançamento"
        message={`Excluir o lançamento de ${deleting ? formatDate(deleting.data) : ''} — "${deleting?.historico_complemento}"?`}
        busy={deleteMut.isPending}
        error={
          deleteMut.isError
            ? deleteMut.error instanceof ApiError
              ? deleteMut.error.message
              : 'Falha ao excluir'
            : null
        }
        onConfirm={() => deleting && deleteMut.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
        onCancel={() => {
          setDeleting(null);
          deleteMut.reset();
        }}
      />
    </section>
  );
}

function LancamentoRow({
  lancamento,
  onEdit,
  onDelete,
}: {
  lancamento: Lancamento;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const partidas = lancamento.partidas.slice().sort((a, b) => a.ordem - b.ordem);
  const totalDebito = partidas.filter((p) => p.tipo === 'D').reduce((s, p) => s + p.valor_cents, 0);

  const [primeira, segunda] = partidas;
  const resumo =
    primeira && segunda && partidas.length === 2
      ? `${nomeConta(primeira)} → ${nomeConta(segunda)}`
      : `${partidas.length} contas`;

  return (
    <tr className="text-slate-600">
      <td className="whitespace-nowrap px-4 py-1.5">{formatDate(lancamento.data)}</td>
      <td className="px-4 py-1.5">
        <Historico codigo={lancamento.historico_codigo} complemento={lancamento.historico_complemento} />
      </td>
      <td className="px-4 py-1.5 text-xs text-slate-500">{resumo}</td>
      <td className="whitespace-nowrap px-4 py-1.5 text-right">{formatMoney(totalDebito)}</td>
      <td className="whitespace-nowrap px-4 py-1.5 text-right text-xs">
        <button className="text-slate-400 hover:text-brand-600" onClick={onEdit}>
          editar
        </button>
        <button className="ml-3 text-slate-400 hover:text-red-600" onClick={onDelete}>
          excluir
        </button>
      </td>
    </tr>
  );
}

function nomeConta(p: Lancamento['partidas'][number]): string {
  return p.plano_conta ? `${p.plano_conta.codigo} ${p.plano_conta.nome}` : p.plano_conta_id;
}
