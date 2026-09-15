import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { useClients } from '@/features/clients/api';
import { formatCompetencia, formatDate } from '@/lib/format';
import { useExportarRazaoPdf, usePeriodos, usePlanoContas, useRazao } from './api';
import { Dinheiro, Historico } from './SaldoRow';

export function RelatorioRazaoPage() {
  const { data: clients, isLoading: loadingClients } = useClients({ ativo: 'true' });
  const [clientId, setClientId] = useState('');
  const [periodoId, setPeriodoId] = useState('');
  const [planoContaId, setPlanoContaId] = useState('');

  const { data: periodos, isLoading: loadingPeriodos } = usePeriodos(clientId || undefined);
  const { data: contas, isLoading: loadingContas } = usePlanoContas(clientId || undefined);
  const { data: razao, isLoading: loadingRazao, error } = useRazao(
    periodoId || undefined,
    planoContaId || undefined,
  );
  const exportarMut = useExportarRazaoPdf();

  const contasAnaliticas = (contas ?? []).filter((c) => c.tipo === 'A');
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
        <h1 className="text-xl font-semibold text-slate-800">Razão</h1>
        <p className="text-sm text-slate-500">
          Livro-razão de uma conta analítica — saldo anterior, cada movimento em ordem cronológica
          com saldo corrente, e saldo atual.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          className="input max-w-md"
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setPeriodoId('');
            setPlanoContaId('');
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

        {clientId && (
          <select
            className="input max-w-sm"
            value={planoContaId}
            onChange={(e) => setPlanoContaId(e.target.value)}
            disabled={loadingContas}
          >
            <option value="">{loadingContas ? 'Carregando…' : 'Selecione a conta…'}</option>
            {contasAnaliticas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.codigo} — {c.nome}
                {!c.ativo ? ' (inativa)' : ''}
              </option>
            ))}
          </select>
        )}

        {periodoId && planoContaId && (
          <button
            type="button"
            className="btn-primary"
            disabled={exportarMut.isPending}
            onClick={() => exportarMut.mutate({ periodoId, planoContaId })}
          >
            {exportarMut.isPending ? 'Gerando PDF…' : 'Exportar PDF'}
          </button>
        )}
      </div>

      {errMsg && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errMsg}</p>}

      {periodoSelecionado?.status === 'fechado' && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Este período está fechado (saldo importado do Balancete) — o razão mostra só os
          lançamentos manuais registrados neste sistema, que podem não refletir a escrituração
          completa do período.
        </p>
      )}

      {!clientId ? (
        <p className="card p-6 text-sm text-slate-400">Escolha um cliente.</p>
      ) : !periodoId || !planoContaId ? (
        <p className="card p-6 text-sm text-slate-400">Escolha um período e uma conta.</p>
      ) : loadingRazao ? (
        <p className="card p-6 text-sm text-slate-400">Carregando…</p>
      ) : error ? (
        <p className="card p-6 text-sm text-red-600">
          {error instanceof Error ? error.message : 'Falha ao carregar'}
        </p>
      ) : razao ? (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2">Data</th>
                <th className="px-4 py-2">Histórico</th>
                <th className="px-4 py-2 text-right">D/C</th>
                <th className="px-4 py-2 text-right">Valor</th>
                <th className="px-4 py-2 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr className="bg-slate-50/60 font-medium text-slate-800">
                <td className="px-4 py-1.5" />
                <td className="px-4 py-1.5">Saldo anterior</td>
                <td className="px-4 py-1.5" />
                <td className="px-4 py-1.5" />
                <td className="whitespace-nowrap px-4 py-1.5 text-right">
                  <Dinheiro cents={razao.saldo_anterior_cents} natureza={razao.saldo_anterior_natureza} />
                </td>
              </tr>
              {razao.linhas.map((l) => (
                <tr key={l.lancamento_id + l.saldo_cents} className="text-slate-600">
                  <td className="whitespace-nowrap px-4 py-1.5">{formatDate(l.data)}</td>
                  <td className="px-4 py-1.5">
                    <Historico codigo={l.historico_codigo} complemento={l.historico_complemento} />
                  </td>
                  <td className="px-4 py-1.5 text-right">{l.tipo}</td>
                  <td className="whitespace-nowrap px-4 py-1.5 text-right">
                    <Dinheiro cents={l.valor_cents} natureza={null} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-1.5 text-right">
                    <Dinheiro cents={l.saldo_cents} natureza={l.saldo_natureza} />
                  </td>
                </tr>
              ))}
              {!razao.linhas.length && (
                <tr>
                  <td colSpan={5} className="p-4 text-sm text-slate-400">
                    Nenhum lançamento manual nessa conta nesse período.
                  </td>
                </tr>
              )}
              <tr className="bg-slate-50/60 font-medium text-slate-800">
                <td className="px-4 py-1.5" />
                <td className="px-4 py-1.5">Saldo atual</td>
                <td className="px-4 py-1.5" />
                <td className="px-4 py-1.5" />
                <td className="whitespace-nowrap px-4 py-1.5 text-right">
                  <Dinheiro cents={razao.saldo_atual_cents} natureza={razao.saldo_atual_natureza} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
