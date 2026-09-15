import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { useClients } from '@/features/clients/api';
import { formatCompetencia } from '@/lib/format';
import type { GrupoDre } from '@/lib/types';
import { useDre, useExportarDrePdf, usePeriodos } from './api';
import { Dinheiro, SaldoRow } from './SaldoRow';

export function RelatorioDrePage() {
  const { data: clients, isLoading: loadingClients } = useClients({ ativo: 'true' });
  const [clientId, setClientId] = useState('');
  const [periodoId, setPeriodoId] = useState('');

  const { data: periodos, isLoading: loadingPeriodos } = usePeriodos(clientId || undefined);
  const { data: dre, isLoading: loadingDre, error } = useDre(periodoId || undefined);
  const exportarMut = useExportarDrePdf();

  const errMsg =
    exportarMut.error instanceof ApiError
      ? exportarMut.error.message
      : exportarMut.error
        ? String(exportarMut.error)
        : null;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">DRE</h1>
        <p className="text-sm text-slate-500">
          Demonstração do Resultado do Exercício — receitas, despesas e o resultado do mês e do
          exercício.
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
      ) : loadingDre ? (
        <p className="card p-6 text-sm text-slate-400">Carregando…</p>
      ) : error ? (
        <p className="card p-6 text-sm text-red-600">
          {error instanceof Error ? error.message : 'Falha ao carregar'}
        </p>
      ) : dre ? (
        <div className="space-y-4">
          <GrupoTable titulo="Receitas" grupo={dre.receitas} />
          <GrupoTable titulo="Despesas" grupo={dre.despesas} />
          <div className="card space-y-2 p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Resultado do mês</span>
              <span className="font-medium text-slate-800">
                <Dinheiro cents={dre.resultado_mes_cents} natureza={dre.resultado_mes_natureza} />
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Resultado do exercício</span>
              <span className="font-medium text-slate-800">
                <Dinheiro
                  cents={dre.resultado_exercicio_cents}
                  natureza={dre.resultado_exercicio_natureza}
                />
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function GrupoTable({ titulo, grupo }: { titulo: string; grupo: GrupoDre }) {
  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold text-slate-700">{titulo}</h2>
      <div className="card overflow-x-auto p-0">
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
            {grupo.linhas.map((s) => (
              <SaldoRow key={s.id} saldo={s} />
            ))}
            <SaldoRow key={grupo.raiz.id} saldo={grupo.raiz} />
          </tbody>
        </table>
      </div>
    </div>
  );
}
