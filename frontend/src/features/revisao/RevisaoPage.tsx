import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { Transaction } from '@/lib/types';
import {
  useGenerateDominio,
  useSaveTransactions,
  useStatement,
  useUpdateStatementHeader,
} from '@/features/statements/api';
import { SaldoReconciliacao } from '@/features/statements/SaldoReconciliacao';
import { ReimportarExtrato } from '@/features/statements/ReimportarExtrato';
import { useClassificacoes } from '@/features/classificacao/api';
import { BulkBar } from './BulkBar';
import { TransactionRow } from './TransactionRow';
import { useRevisaoDraft } from './useRevisaoDraft';

type Filter = 'todas' | 'entrada' | 'saida' | 'pendentes' | 'conferir' | 'inativadas';

export function RevisaoPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useStatement(id);
  const save = useSaveTransactions(id);
  const header = useUpdateStatementHeader(id);
  const gerar = useGenerateDominio(id);
  const [filter, setFilter] = useState<Filter>('saida');
  const [confirmSair, setConfirmSair] = useState(false);

  const transactions = useMemo(() => data?.transactions ?? [], [data]);
  const { get, patchRow, patchMany, reset, changes, isDirty } = useRevisaoDraft(transactions);

  // extratos que vieram do módulo Classificação trazem a categoria de cada
  // lançamento — mostra o nome como contexto pra escolher a conta contábil.
  const clientId = data?.statement.client_id;
  const { data: entradasClassif } = useClassificacoes(clientId, 'entrada');
  const { data: saidasClassif } = useClassificacoes(clientId, 'saida');
  const classificacaoPorId = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of [...(entradasClassif ?? []), ...(saidasClassif ?? [])]) m.set(c.id, c.nome);
    return m;
  }, [entradasClassif, saidasClassif]);

  // avisa antes de fechar a aba/atualizar com alterações não salvas
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
    let pend = 0;
    let prontos = 0;
    let inut = 0;
    let conferir = 0;
    for (const t of transactions) {
      const d = get(t.id);
      if (d.ignorado) inut++;
      else if (d.conta_contabil.trim() && d.hist_code.trim()) {
        prontos++;
        if (t.origem_preenchimento === 'conferir') conferir++;
      } else pend++;
    }
    return { pend, prontos, inut, conferir, ativos: transactions.length - inut };
  }, [transactions, get]);

  const shown = useMemo(() => {
    return transactions.filter((t) => {
      const d = get(t.id);
      if (filter === 'todas') return true;
      if (filter === 'inativadas') return d.ignorado;
      if (filter === 'pendentes')
        return !d.ignorado && !(d.conta_contabil.trim() && d.hist_code.trim());
      if (filter === 'conferir') return !d.ignorado && t.origem_preenchimento === 'conferir';
      return !d.ignorado && t.direction === filter;
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
  const complementoModo = st.complemento_modo ?? 'extrato';
  const saldoInicial = Number(st.saldo_inicial ?? 0) || 0;

  function applyConta(dir: 'entrada' | 'saida', conta: string) {
    patchMany((tx) => tx.direction === dir && !get(tx.id).ignorado, { conta_contabil: conta });
  }
  function applyHist(dir: 'entrada' | 'saida', hist: string) {
    patchMany((tx) => tx.direction === dir && !get(tx.id).ignorado, { hist_code: hist });
  }
  function bulkIgnore(target: 'entrada' | 'saida' | 'reativar') {
    if (target === 'reativar') patchMany(() => true, { ignorado: false });
    else patchMany((tx) => tx.direction === target, { ignorado: true });
  }

  function onSave() {
    if (!isDirty) return;
    save.mutate(changes);
  }

  const saveErr =
    save.error instanceof ApiError ? save.error.message : save.error ? String(save.error) : null;

  const gerarErr =
    gerar.error instanceof ApiError
      ? gerar.error.message +
        (gerar.error.details && typeof gerar.error.details === 'object' && 'ordens' in gerar.error.details
          ? ` (linhas ${(gerar.error.details as { ordens: number[] }).ordens.map((o) => o + 1).join(', ')})`
          : '')
      : gerar.error
        ? String(gerar.error)
        : null;

  const podeGerar = !isDirty && stats.pend === 0 && stats.ativos > 0 && !gerar.isPending;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Revisão</h1>
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
            onClick={() => (isDirty ? setConfirmSair(true) : navigate('/historico'))}
          >
            Voltar
          </button>
          <ReimportarExtrato statementId={id} qtd={transactions.length} as="button" />
          <button className="btn-primary" onClick={onSave} disabled={!isDirty || save.isPending}>
            {save.isPending ? 'Salvando…' : isDirty ? `Salvar (${changes.length})` : 'Salvo'}
          </button>
        </div>
      </div>

      {st.erro_msg && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{st.erro_msg}</p>
      )}
      {saveErr && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{saveErr}</p>
      )}
      {stats.conferir > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {stats.conferir} lançamento(s) preenchido(s) pela memória, mas a descrição já teve outras
          contas — confira o filtro "Conferir".
        </p>
      )}

      <HeaderForm
        st={{
          banco_conta_contabil: st.banco_conta_contabil ?? '',
          hist_code_entrada: st.hist_code_entrada,
          hist_code_saida: st.hist_code_saida,
          lote_numero: st.lote_numero,
        }}
        onSave={(f) => header.mutate(f)}
        saving={header.isPending}
      />

      <SaldoReconciliacao
        transactions={transactions}
        saldoInicial={saldoInicial}
        onSaldoInicial={(v) => header.mutate({ saldo_inicial: v.toFixed(2) })}
      />

      <div className="card grid grid-cols-2 gap-x-6 gap-y-1 p-3 text-sm sm:grid-cols-5">
        <Stat label="Ativos" value={String(stats.ativos)} />
        <Stat label="Prontos" value={String(stats.prontos)} tone="green" />
        <Stat label="Pendentes" value={String(stats.pend)} tone={stats.pend ? 'amber' : undefined} />
        <Stat
          label="Conferir"
          value={String(stats.conferir)}
          tone={stats.conferir ? 'amber' : undefined}
        />
        <Stat label="Inativados" value={String(stats.inut)} />
      </div>

      <BulkBar
        onApplyConta={applyConta}
        onApplyHist={applyHist}
        onIgnore={bulkIgnore}
        complementoModo={complementoModo}
        onComplementoModo={(m) => header.mutate({ complemento_modo: m })}
        savingModo={header.isPending}
      />

      <div className="flex flex-wrap gap-1 text-sm">
        {(
          [
            ['saida', `Saídas`],
            ['entrada', `Entradas`],
            ['pendentes', `Pendentes (${stats.pend})`],
            ...(stats.conferir ? [['conferir', `Conferir (${stats.conferir})`] as [Filter, string]] : []),
            ['inativadas', `Inativadas (${stats.inut})`],
            ['todas', `Todas`],
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
              <th className="px-2 py-2">Inativar</th>
              <th className="px-2 py-2">Data</th>
              <th className="px-2 py-2">Histórico do extrato</th>
              <th className="px-2 py-2 text-right">Valor</th>
              <th className="px-2 py-2">Tipo</th>
              <th className="px-2 py-2">Classificação</th>
              <th className="px-2 py-2">Conta contábil</th>
              <th className="px-2 py-2">Cód. hist.</th>
              <th className="px-2 py-2">Complemento</th>
              <th className="px-2 py-2">No arquivo →</th>
              <th className="px-2 py-2 text-center">Memória</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((txn: Transaction) => (
              <TransactionRow
                key={txn.id}
                txn={txn}
                draft={get(txn.id)}
                onPatch={(p) => patchRow(txn.id, p)}
                complementoModo={complementoModo}
                classificacaoNome={txn.classificacao_id ? classificacaoPorId.get(txn.classificacao_id) : null}
              />
            ))}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className="p-6 text-sm text-slate-400">Nenhum lançamento neste filtro.</p>
        )}
      </div>

      {gerarErr && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{gerarErr}</p>
      )}
      {gerar.isSuccess && gerar.data && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          Arquivo <span className="font-mono">{gerar.data.filename}</span> gerado ({gerar.data.linhas}{' '}
          linhas) e baixado. Importe no Domínio: Utilitários → Importação → Lançamentos contábeis em
          lote.
        </p>
      )}

      <div className="flex items-center justify-between rounded-md bg-slate-100 px-3 py-2 text-sm">
        <span className="text-slate-500">
          {isDirty
            ? 'Salve as alterações antes de gerar o arquivo.'
            : stats.pend > 0
              ? `${stats.pend} lançamento(s) ainda sem conta contábil ou código de histórico.`
              : `Pronto: ${stats.ativos} lançamento(s) ativo(s).`}
        </span>
        <div className="flex gap-2">
          {isDirty && (
            <button className="btn-ghost" onClick={reset}>
              Descartar alterações
            </button>
          )}
          <button
            className="btn-primary"
            disabled={!podeGerar}
            title={
              isDirty
                ? 'Salve as alterações primeiro'
                : stats.pend > 0
                  ? 'Classifique os lançamentos pendentes'
                  : 'Gera o .txt no Leiaute Domínio'
            }
            onClick={() => gerar.mutate()}
          >
            {gerar.isPending
              ? 'Gerando…'
              : st.status === 'gerado'
                ? 'Gerar de novo'
                : 'Gerar arquivo Domínio'}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmSair}
        title="Sair sem salvar?"
        message={`Você tem ${changes.length} alteração(ões) não salva(s). Se sair agora, elas se perdem.`}
        confirmLabel="Sair sem salvar"
        onConfirm={() => navigate('/historico')}
        onCancel={() => setConfirmSair(false)}
      />
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'green' | 'amber';
}) {
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

function HeaderForm({
  st,
  onSave,
  saving,
}: {
  st: {
    banco_conta_contabil: string;
    hist_code_entrada: string;
    hist_code_saida: string;
    lote_numero: number;
  };
  onSave: (f: {
    banco_conta_contabil?: string;
    hist_code_entrada?: string;
    hist_code_saida?: string;
    lote_numero?: number;
  }) => void;
  saving: boolean;
}) {
  const [banco, setBanco] = useState(st.banco_conta_contabil);
  const [he, setHe] = useState(st.hist_code_entrada);
  const [hs, setHs] = useState(st.hist_code_saida);
  const [lote, setLote] = useState(st.lote_numero);

  // useState só pega o valor inicial no primeiro mount — se o cabeçalho ainda
  // não tinha conta/histórico quando a página abriu (ex: acabou de ser puxado
  // do módulo Classificação, com o fetch antigo em cache) e o refetch chega
  // um instante depois, resincroniza os campos com o valor que veio do servidor.
  useEffect(() => {
    setBanco(st.banco_conta_contabil);
    setHe(st.hist_code_entrada);
    setHs(st.hist_code_saida);
    setLote(st.lote_numero);
  }, [st.banco_conta_contabil, st.hist_code_entrada, st.hist_code_saida, st.lote_numero]);

  const dirty =
    banco !== st.banco_conta_contabil ||
    he !== st.hist_code_entrada ||
    hs !== st.hist_code_saida ||
    lote !== st.lote_numero;

  return (
    <div className="card flex flex-wrap items-end gap-3 p-3 text-sm">
      <Field label="Conta do banco">
        <input className="input h-9 w-28" value={banco} onChange={(e) => setBanco(e.target.value)} />
      </Field>
      <Field label="Hist. entrada">
        <input className="input h-9 w-20" value={he} onChange={(e) => setHe(e.target.value)} />
      </Field>
      <Field label="Hist. saída">
        <input className="input h-9 w-20" value={hs} onChange={(e) => setHs(e.target.value)} />
      </Field>
      <Field label="Lote Domínio">
        <input
          className="input h-9 w-24"
          type="number"
          value={lote}
          onChange={(e) => setLote(Number(e.target.value))}
        />
      </Field>
      <button
        className="btn-ghost h-9"
        disabled={!dirty || saving}
        onClick={() =>
          onSave({
            banco_conta_contabil: banco,
            hist_code_entrada: he,
            hist_code_saida: hs,
            lote_numero: lote,
          })
        }
      >
        {saving ? 'Salvando…' : 'Salvar cabeçalho'}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col">
      <span className="mb-1 text-xs text-slate-500">{label}</span>
      {children}
    </label>
  );
}
