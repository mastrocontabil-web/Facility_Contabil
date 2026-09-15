import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { useClients } from '@/features/clients/api';
import { formatCompetencia } from '@/lib/format';
import { useExportarBalancetePdf, usePeriodos, useSaldos } from './api';
import { SaldoRow } from './SaldoRow';

export function RelatorioBalancetePage() {
  const { data: clients, isLoading: loadingClients } = useClients({ ativo: 'true' });
  const [clientId, setClientId] = useState('');
  const [periodoId, setPeriodoId] = useState('');

  const { data: periodos, isLoading: loadingPeriodos } = usePeriodos(clientId || undefined);
  const { data: saldos, isLoading: loadingSaldos, error } = useSaldos(periodoId || undefined);
  const exportarMut = useExportarBalancetePdf();

  const errMsg =
    exportarMut.error instanceof ApiError
      ? exportarMut.error.message
      : exportarMut.error
        ? String(exportarMut.error)
        : null;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Relatório Balancete</h1>
        <p className="text-sm text-slate-500">
          Saldo de cada conta no período selecionado — fechado (importado do Domínio) ou aberto
          (calculado a partir dos lançamentos).
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

        {periodoId && (
          <button
            type="button"
            className="btn-primary"
            disabled={exportarMut.isPending}
            onClick={() => exportarMut.mutate(periodoId)}
          >
            {exportarMut.isPending ? 'Gerando PDF…' : 'Exportar PDF'}
          </button>
        )}
      </div>

      {errMsg && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errMsg}</p>}

      {!clientId ? (
        <p className="card p-6 text-sm text-slate-400">Escolha um cliente.</p>
      ) : !periodoId ? (
        <p className="card p-6 text-sm text-slate-400">Escolha um período.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          {loadingSaldos ? (
            <p className="p-4 text-sm text-slate-400">Carregando…</p>
          ) : error ? (
            <p className="p-4 text-sm text-red-600">
              {error instanceof Error ? error.message : 'Falha ao carregar'}
            </p>
          ) : !saldos?.length ? (
            <p className="p-4 text-sm text-slate-400">Nenhum saldo nesse período.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2">Código</th>
                  <th className="px-4 py-2">Conta</th>
                  <th className="px-4 py-2 text-right">Saldo anterior</th>
                  <th className="px-4 py-2 text-right">Débito</th>
                  <th className="px-4 py-2 text-right">Crédito</th>
                  <th className="px-4 py-2 text-right">Saldo atual</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {saldos.map((s) => (
                  <SaldoRow key={s.id} saldo={s} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
