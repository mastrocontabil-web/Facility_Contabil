import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { useClients } from '@/features/clients/api';
import {
  useCreateStatement,
  useStatements,
  useUpdateStatementHeader,
  type ImportResult,
} from '@/features/statements/api';
import { FileDrop } from '@/components/FileDrop';
import { StatementSummary } from '@/features/statements/StatementSummary';
import { TransactionsTable } from '@/features/statements/TransactionsTable';
import { SaldoReconciliacao } from '@/features/statements/SaldoReconciliacao';
import { PuxarClassificacaoForm } from './PuxarClassificacaoForm';

type Origem = 'novo' | 'classificacao';

/** "1.234,56" → 1234.56 ; "" → 0 */
function parseMoney(s: string): number {
  return Number(s.replace(/\./g, '').replace(',', '.')) || 0;
}

/** 1234.56 → "1234,56" (pro campo de texto) */
function moneyToInput(v: string | number | null | undefined): string {
  return String(Number(v ?? 0)).replace('.', ',');
}

export function ImportPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const puxarId = params.get('puxar') ?? undefined;
  const [origem, setOrigem] = useState<Origem>(puxarId ? 'classificacao' : 'novo');
  const { data: clients, isLoading: loadingClients } = useClients({ ativo: 'true' });
  const createMut = useCreateStatement();

  const [clientId, setClientId] = useState('');
  const [contaBanco, setContaBanco] = useState('');
  const [histEntrada, setHistEntrada] = useState('138');
  const [histSaida, setHistSaida] = useState('186');
  const [lote, setLote] = useState(1);
  const [saldoInicial, setSaldoInicial] = useState('0');
  const [file, setFile] = useState<File | null>(null);
  const [pdfPassword, setPdfPassword] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  const headerMut = useUpdateStatementHeader(result?.statement.id ?? '');
  const saldoInicialNum = parseMoney(saldoInicial);
  const saldoTocado = useRef(false);

  const selected = useMemo(
    () => clients?.find((c) => c.id === clientId),
    [clients, clientId],
  );

  // Extratos anteriores do cliente — pra encadear o saldo (fecha um mês, abre o próximo).
  const { data: clientStmts } = useStatements(
    { client_id: clientId },
    { enabled: !!clientId },
  );
  const extratoAnterior = useMemo(() => {
    const comSaldo = (clientStmts ?? []).filter((s) => s.saldo_final != null);
    if (!comSaldo.length) return null;
    return [...comSaldo].sort((a, b) =>
      String(b.period_end ?? b.created_at).localeCompare(String(a.period_end ?? a.created_at)),
    )[0];
  }, [clientStmts]);

  useEffect(() => {
    if (selected) {
      setContaBanco(selected.banco_conta_contabil ?? '');
      setHistEntrada(selected.hist_code_entrada);
      setHistSaida(selected.hist_code_saida);
    }
  }, [selected]);

  // Ao trocar de cliente, volta a preencher o saldo automaticamente.
  useEffect(() => {
    saldoTocado.current = false;
  }, [clientId]);

  // Saldo inicial = saldo final do último extrato do cliente; senão, o do cadastro.
  useEffect(() => {
    if (!selected || saldoTocado.current) return;
    setSaldoInicial(
      moneyToInput(extratoAnterior?.saldo_final ?? selected.saldo_inicial ?? 0),
    );
  }, [selected, extratoAnterior]);

  const isPdf = file?.name.toLowerCase().endsWith('.pdf');
  const canSubmit = clientId && contaBanco.trim() && file && !createMut.isPending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !file) return;
    createMut.mutate(
      {
        client_id: clientId,
        banco_conta_contabil: contaBanco,
        hist_code_entrada: histEntrada,
        hist_code_saida: histSaida,
        lote_numero: lote,
        saldo_inicial: saldoInicial || '0',
        pdf_password: pdfPassword || undefined,
        file,
      },
      { onSuccess: (r) => setResult(r) },
    );
  }

  const err = createMut.error;
  const errMsg =
    err instanceof ApiError
      ? err.message + (err.details ? ` (${JSON.stringify(err.details)})` : '')
      : err
        ? String(err)
        : null;

  if (result) {
    const porMemoria = result.transactions.filter(
      (t) => t.origem_preenchimento === 'memoria' || t.origem_preenchimento === 'conferir',
    ).length;
    return (
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-800">Extrato lido</h1>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => setResult(null)}>
              Nova importação
            </button>
            <button
              className="btn-primary"
              onClick={() => navigate(`/revisao/${result.statement.id}`)}
            >
              Ir para revisão →
            </button>
          </div>
        </div>

        <StatementSummary statement={result.statement} />

        {porMemoria > 0 && (
          <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
            {porMemoria} lançamento{porMemoria > 1 ? 's já vieram' : ' já veio'} preenchido
            {porMemoria > 1 ? 's' : ''} pela memória do cliente.
          </p>
        )}

        <SaldoReconciliacao
          transactions={result.transactions}
          saldoInicial={saldoInicialNum}
          onSaldoInicial={(v) => {
            setSaldoInicial(v.toFixed(2).replace('.', ','));
            headerMut.mutate({ saldo_inicial: v.toFixed(2) });
          }}
        />

        {result.warnings.length > 0 && (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <p className="font-medium">Avisos do leitor:</p>
            <ul className="ml-4 list-disc">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        <TransactionsTable
          transactions={result.transactions}
          readOnly
          saldoInicial={saldoInicialNum}
        />
      </section>
    );
  }

  return (
    <section className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold text-slate-800">Nova importação</h1>

      <div className="flex gap-1 text-sm">
        <button
          className={`rounded-md px-3 py-1.5 font-medium ${
            origem === 'novo' ? 'bg-brand-600 text-white' : 'border border-slate-300 bg-white text-slate-600'
          }`}
          onClick={() => setOrigem('novo')}
        >
          Importar extrato do zero
        </button>
        <button
          className={`rounded-md px-3 py-1.5 font-medium ${
            origem === 'classificacao'
              ? 'bg-brand-600 text-white'
              : 'border border-slate-300 bg-white text-slate-600'
          }`}
          onClick={() => setOrigem('classificacao')}
        >
          Puxar do módulo Classificação
        </button>
      </div>

      {origem === 'classificacao' ? (
        <PuxarClassificacaoForm initialStatementId={puxarId} />
      ) : (
        <form onSubmit={submit} className="card space-y-4 p-6">
          <div>
            <label className="label">Cliente</label>
            <select
              className="input"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={loadingClients}
              required
            >
              <option value="">{loadingClients ? 'Carregando…' : 'Selecione…'}</option>
              {clients?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.razao_social} — Domínio {c.dominio_code}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Conta contábil do banco</label>
              <input
                className="input"
                value={contaBanco}
                onChange={(e) => setContaBanco(e.target.value)}
                placeholder="ex: 10002"
                required
              />
            </div>
            <div>
              <label className="label">Número do lote (Domínio)</label>
              <input
                className="input"
                type="number"
                min={0}
                value={lote}
                onChange={(e) => setLote(Number(e.target.value))}
              />
            </div>
            <div>
              <label className="label">Cód. histórico entrada</label>
              <input
                className="input"
                value={histEntrada}
                onChange={(e) => setHistEntrada(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Cód. histórico saída</label>
              <input
                className="input"
                value={histSaida}
                onChange={(e) => setHistSaida(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label">Saldo inicial da conta bancária</label>
            <input
              className="input"
              inputMode="decimal"
              value={saldoInicial}
              onChange={(e) => {
                setSaldoInicial(e.target.value);
                saldoTocado.current = true;
              }}
              placeholder="0,00"
            />
            {selected && extratoAnterior ? (
              <p className="mt-1 text-xs text-slate-400">
                Continua do extrato anterior deste cliente
                {extratoAnterior.period_end ? ` (até ${formatDate(extratoAnterior.period_end)})` : ''} —
                saldo final {formatMoney(Math.round(Number(extratoAnterior.saldo_final) * 100))}. Ajuste
                se precisar.
              </p>
            ) : (
              <p className="mt-1 text-xs text-slate-400">
                {selected
                  ? 'Primeiro extrato deste cliente — usando o saldo inicial do cadastro.'
                  : 'Vem do último extrato do cliente (ou do cadastro, no primeiro). Serve para conferir o saldo do fim do mês.'}
              </p>
            )}
          </div>

          <div>
            <label className="label">Extrato bancário</label>
            <FileDrop file={file} onFile={setFile} />
          </div>

          {isPdf && (
            <div>
              <label className="label">Senha do PDF (se tiver)</label>
              <input
                className="input"
                type="password"
                value={pdfPassword}
                onChange={(e) => setPdfPassword(e.target.value)}
                placeholder="deixe em branco se o PDF não tem senha"
              />
            </div>
          )}

          {errMsg && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errMsg}</p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={!canSubmit}>
            {createMut.isPending ? 'Lendo o extrato…' : 'Ler extrato'}
          </button>
        </form>
      )}

      {origem === 'novo' && selected && (
        <p className="text-xs text-slate-400">
          Entradas serão lançadas a débito da conta {contaBanco || '—'} e crédito da conta que
          você classificar; saídas o contrário. Você ajusta tudo na próxima tela.{' '}
          {selected.banco_conta_contabil
            ? ''
            : '(esse cliente ainda não tem conta do banco no cadastro)'}
        </p>
      )}
    </section>
  );
}
