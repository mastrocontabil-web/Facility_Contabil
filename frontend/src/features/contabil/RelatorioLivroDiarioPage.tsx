import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { useClients } from '@/features/clients/api';
import { formatCompetencia, formatDate } from '@/lib/format';
import { useExportarLivroDiarioPdf, useLancamentos, usePeriodos } from './api';
import { Dinheiro, Historico } from './SaldoRow';

export function RelatorioLivroDiarioPage() {
  const { data: clients, isLoading: loadingClients } = useClients({ ativo: 'true' });
  const [clientId, setClientId] = useState('');
  const [periodoId, setPeriodoId] = useState('');

  const { data: periodos, isLoading: loadingPeriodos } = usePeriodos(clientId || undefined);
  const { data: lancamentos, isLoading, error } = useLancamentos(periodoId || undefined);
  const exportarMut = useExportarLivroDiarioPdf();

  const periodoSelecionado = periodos?.find((p) => p.id === periodoId);

  const errMsg =
    exportarMut.error instanceof ApiError
      ? exportarMut.error.message
      : exportarMut.error
        ? String(exportarMut.error)
        : null;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Livro Diário</h1>
        <p className="text-sm text-slate-500">
          Lista cronológica de todos os lançamentos do período, com débito e crédito de cada
          partida.
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

      {periodoSelecionado?.status === 'fechado' && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Este período está fechado (saldo importado do Balancete) — o livro diário mostra só os
          lançamentos manuais registrados neste sistema, que podem não refletir a escrituração
          completa do período.
        </p>
      )}

      {!clientId ? (
        <p className="card p-6 text-sm text-slate-400">Escolha um cliente.</p>
      ) : !periodoId ? (
        <p className="card p-6 text-sm text-slate-400">Escolha um período.</p>
      ) : (
        <div className="card overflow-x-auto p-0">
          {isLoading ? (
            <p className="p-4 text-sm text-slate-400">Carregando…</p>
          ) : error ? (
            <p className="p-4 text-sm text-red-600">
              {error instanceof Error ? error.message : 'Falha ao carregar'}
            </p>
          ) : !lancamentos?.length ? (
            <p className="p-4 text-sm text-slate-400">Nenhum lançamento nesse período.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2">#</th>
                  <th className="px-4 py-2">Data</th>
                  <th className="px-4 py-2">Histórico</th>
                  <th className="px-4 py-2">Conta</th>
                  <th className="px-4 py-2 text-right">D/C</th>
                  <th className="px-4 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lancamentos.map((l, i) =>
                  l.partidas.map((p, j) => (
                    <tr key={p.id} className="align-top text-slate-600">
                      {j === 0 && (
                        <>
                          <td className="whitespace-nowrap px-4 py-1.5 text-slate-400" rowSpan={l.partidas.length}>
                            {i + 1}
                          </td>
                          <td className="whitespace-nowrap px-4 py-1.5" rowSpan={l.partidas.length}>
                            {formatDate(l.data)}
                          </td>
                          <td className="px-4 py-1.5" rowSpan={l.partidas.length}>
                            <Historico codigo={l.historico_codigo} complemento={l.historico_complemento} />
                          </td>
                        </>
                      )}
                      <td className="px-4 py-1.5">
                        {p.plano_conta ? `${p.plano_conta.codigo} — ${p.plano_conta.nome}` : '—'}
                      </td>
                      <td className="px-4 py-1.5 text-right">{p.tipo}</td>
                      <td className="whitespace-nowrap px-4 py-1.5 text-right">
                        <Dinheiro cents={p.valor_cents} natureza={null} />
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
