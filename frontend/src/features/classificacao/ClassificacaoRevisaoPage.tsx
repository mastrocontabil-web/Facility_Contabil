import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import type { Direction, Transaction } from '@/lib/types';
import { useStatement } from '@/features/statements/api';
import { StatementSummary } from '@/features/statements/StatementSummary';
import { useClassificacoes, useSaveClassificacoes } from './api';
import { useClassificacaoDraft } from './useClassificacaoDraft';
import { ClassificacaoSelect } from './ClassificacaoSelect';

type Filter = 'todas' | 'entrada' | 'saida' | 'pendentes';

export function ClassificacaoRevisaoPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useStatement(id);
  const save = useSaveClassificacoes(id);
  const [filter, setFilter] = useState<Filter>('saida');
  const [confirmSair, setConfirmSair] = useState(false);
  const [bulkDir, setBulkDir] = useState<Direction>('saida');
  const [bulkClassif, setBulkClassif] = useState('');

  const clientId = data?.statement.client_id ?? '';
  const transactions = useMemo(() => data?.transactions ?? [], [data]);
  const { get, patchRow, patchMany, reset, changes, isDirty } = useClassificacaoDraft(transactions);

  const { data: entradas } = useClassificacoes(clientId, 'entrada');
  const { data: saidas } = useClassificacoes(clientId, 'saida');
  const catalogo = useMemo(
    () => ({ entrada: entradas ?? [], saida: saidas ?? [] }),
    [entradas, saidas],
  );

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const stats = useMemo(() => {
    let classificados = 0;
    let pend = 0;
    const ativos = transactions.filter((t) => !t.ignorado);
    for (const t of ativos) {
      if (get(t.id)) classificados++;
      else pend++;
    }
    return { ativos: ativos.length, classificados, pend };
  }, [transactions, get]);

  const shown = useMemo(() => {
    return transactions.filter((t) => {
      if (t.ignorado) return false;
      if (filter === 'todas') return true;
      if (filter === 'pendentes') return !get(t.id);
      return t.direction === filter;
    });
  }, [transactions, get, filter]);

  if (isLoading) return <p className="text-sm text-slate-400">Carregando…</p>;
  if (error || !data)
    return (
      <p className="text-sm text-red-600">
        {error instanceof Error ? error.message : 'Importação não encontrada'}
      </p>
    );

  const st = data.statement;
  const jaPuxado = st.status !== 'classificacao';

  function onSave() {
    if (!isDirty) return;
    save.mutate(changes);
  }

  const saveErr =
    save.error instanceof ApiError ? save.error.message : save.error ? String(save.error) : null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Classificação</h1>
          <p className="text-sm text-slate-500">
            {st.client?.razao_social ?? 'cliente'} · {st.arquivo_nome} ·{' '}
            {st.period_start && st.period_end
              ? `${formatDate(st.period_start)}–${formatDate(st.period_end)}`
              : 'sem período'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost"
            onClick={() => (isDirty ? setConfirmSair(true) : navigate('/classificacao/historico'))}
          >
            Voltar
          </button>
          <button className="btn-primary" onClick={onSave} disabled={!isDirty || save.isPending}>
            {save.isPending ? 'Salvando…' : isDirty ? `Salvar (${changes.length})` : 'Salvo'}
          </button>
        </div>
      </div>

      {jaPuxado && (
        <p className="rounded-md bg-brand-50 px-3 py-2 text-sm text-brand-800">
          Este extrato já foi puxado pro módulo Importação (status atual: {st.status}). Você ainda
          pode ajustar as classificações aqui — elas seguem valendo pro arquivo do Domínio.
        </p>
      )}

      {st.erro_msg && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{st.erro_msg}</p>
      )}
      {saveErr && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{saveErr}</p>}

      <StatementSummary statement={st} />

      <div className="card grid grid-cols-3 gap-x-6 gap-y-1 p-3 text-sm">
        <Stat label="Ativos" value={String(stats.ativos)} />
        <Stat label="Classificados" value={String(stats.classificados)} tone="green" />
        <Stat label="Pendentes" value={String(stats.pend)} tone={stats.pend ? 'amber' : undefined} />
      </div>

      <div className="card flex flex-wrap items-end gap-2 p-4 text-sm">
        <p className="mb-1 w-full text-sm font-medium text-slate-700">Classificar em massa</p>
        <label className="flex flex-col">
          <span className="mb-1 text-xs text-slate-500">Aplicar em</span>
          <select
            className="input h-9 w-32"
            value={bulkDir}
            onChange={(e) => {
              setBulkDir(e.target.value as Direction);
              setBulkClassif('');
            }}
          >
            <option value="saida">todas as saídas</option>
            <option value="entrada">todas as entradas</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="mb-1 text-xs text-slate-500">Classificação</span>
          <ClassificacaoSelect
            clientId={clientId}
            direction={bulkDir}
            options={catalogo[bulkDir]}
            value={bulkClassif || null}
            onChange={(v) => setBulkClassif(v ?? '')}
            className="input h-9 w-56"
          />
        </label>
        <button
          className="btn-ghost h-9 px-3"
          disabled={!bulkClassif}
          onClick={() => patchMany((tx) => tx.direction === bulkDir && !tx.ignorado, bulkClassif || null)}
        >
          aplicar
        </button>
      </div>

      <div className="flex flex-wrap gap-1 text-sm">
        {(
          [
            ['saida', 'Saídas'],
            ['entrada', 'Entradas'],
            ['pendentes', `Pendentes (${stats.pend})`],
            ['todas', 'Todas'],
          ] as [Filter, string][]
        ).map(([f, label]) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1.5 font-medium ${
              filter === f ? 'bg-brand-600 text-white' : 'border border-slate-300 bg-white text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-[10px] uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Data</th>
              <th className="px-2 py-2">Histórico do extrato</th>
              <th className="px-2 py-2 text-right">Valor</th>
              <th className="px-2 py-2">Tipo</th>
              <th className="px-2 py-2">Classificação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((txn: Transaction) => (
              <tr key={txn.id}>
                <td className="whitespace-nowrap px-2 py-1 text-xs">{formatDate(txn.data)}</td>
                <td className="px-2 py-1 text-xs text-slate-700">{txn.descricao_raw}</td>
                <td className="whitespace-nowrap px-2 py-1 text-right text-xs tabular-nums">
                  {formatMoney(Math.round(Number(txn.valor) * 100))}
                </td>
                <td className="px-2 py-1">
                  <span
                    className={`rounded px-1 py-0.5 text-[10px] font-medium ${
                      txn.direction === 'entrada'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {txn.direction === 'entrada' ? 'ent' : 'saí'}
                  </span>
                </td>
                <td className="px-1 py-1">
                  <ClassificacaoSelect
                    clientId={clientId}
                    direction={txn.direction}
                    options={catalogo[txn.direction]}
                    value={get(txn.id)}
                    onChange={(v) => patchRow(txn.id, v)}
                    className="input h-8 w-56 px-2 py-1 text-xs"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className="p-6 text-sm text-slate-400">Nenhum lançamento neste filtro.</p>
        )}
      </div>

      <div className="flex items-center justify-between rounded-md bg-slate-100 px-3 py-2 text-sm">
        <span className="text-slate-500">
          {isDirty
            ? 'Salve as alterações antes de ir pra Importação.'
            : stats.pend > 0
              ? `${stats.pend} lançamento(s) ainda sem classificação.`
              : `Tudo classificado (${stats.classificados}/${stats.ativos}).`}
        </span>
        <div className="flex gap-2">
          {isDirty && (
            <button className="btn-ghost" onClick={reset}>
              Descartar alterações
            </button>
          )}
          <button
            className="btn-primary"
            disabled={isDirty}
            title={isDirty ? 'Salve as alterações primeiro' : 'Ir definir as contas contábeis'}
            onClick={() => navigate(`/importar?puxar=${st.id}`)}
          >
            {jaPuxado ? 'Ir para Importação →' : 'Puxar para Importação →'}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmSair}
        title="Sair sem salvar?"
        message={`Você tem ${changes.length} alteração(ões) não salva(s). Se sair agora, elas se perdem.`}
        confirmLabel="Sair sem salvar"
        onConfirm={() => navigate('/classificacao/historico')}
        onCancel={() => setConfirmSair(false)}
      />
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'amber' }) {
  return (
    <div>
      <p className="text-[10px] uppercase text-slate-400">{label}</p>
      <p
        className={`font-semibold ${
          tone === 'green' ? 'text-green-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-800'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
