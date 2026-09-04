import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { ComplementoModo } from '@/lib/types';
import { useClients } from '@/features/clients/api';
import { useStatement, useStatements, useUpdateStatementHeader } from '@/features/statements/api';

const MODO_OPTIONS: { value: ComplementoModo; label: string }[] = [
  { value: 'extrato_classificacao', label: 'Histórico do extrato + classificação' },
  { value: 'tudo', label: 'Histórico do extrato + complemento + classificação' },
  { value: 'ambos', label: 'Histórico do extrato + complemento' },
  { value: 'extrato', label: 'Somente o histórico do extrato' },
  { value: 'complemento', label: 'Somente o complemento' },
];

/** Segunda opção de entrada da Importação: puxa um extrato já lido e
 *  classificado no módulo Classificação, define a conta do banco/histórico e
 *  manda pra Revisão — mesmo lançamento, sem reimportar o arquivo. */
export function PuxarClassificacaoForm({ initialStatementId }: { initialStatementId?: string }) {
  const navigate = useNavigate();
  const { data: clients, isLoading: loadingClients } = useClients({ ativo: 'true' });
  const { data: preselected } = useStatement(initialStatementId);

  const [clientId, setClientId] = useState('');
  const [selectedId, setSelectedId] = useState(initialStatementId ?? '');

  useEffect(() => {
    if (preselected) setClientId(preselected.statement.client_id);
  }, [preselected]);

  const selected = useMemo(() => clients?.find((c) => c.id === clientId), [clients, clientId]);

  const { data: pendentes, isLoading: loadingStmts } = useStatements(
    { client_id: clientId, status: 'classificacao' },
    { enabled: !!clientId },
  );

  const [contaBanco, setContaBanco] = useState('');
  const [histEntrada, setHistEntrada] = useState('138');
  const [histSaida, setHistSaida] = useState('186');
  const [lote, setLote] = useState(1);
  const [modo, setModo] = useState<ComplementoModo>('extrato_classificacao');

  useEffect(() => {
    if (selected) {
      setContaBanco(selected.banco_conta_contabil ?? '');
      setHistEntrada(selected.hist_code_entrada);
      setHistSaida(selected.hist_code_saida);
    }
  }, [selected]);

  const header = useUpdateStatementHeader(selectedId);
  const canSubmit = !!selectedId && contaBanco.trim() && !header.isPending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    header.mutate(
      {
        banco_conta_contabil: contaBanco,
        hist_code_entrada: histEntrada,
        hist_code_saida: histSaida,
        lote_numero: lote,
        complemento_modo: modo,
        status: 'revisao',
      },
      { onSuccess: () => navigate(`/revisao/${selectedId}`) },
    );
  }

  const err = header.error;
  const errMsg = err instanceof ApiError ? err.message : err ? String(err) : null;

  return (
    <form onSubmit={submit} className="card space-y-4 p-6">
      <div>
        <label className="label">Cliente</label>
        <select
          className="input"
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setSelectedId('');
          }}
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

      {clientId && (
        <div>
          <label className="label">Extrato classificado</label>
          {loadingStmts ? (
            <p className="text-sm text-slate-400">Carregando…</p>
          ) : !pendentes?.length ? (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
              Nenhum extrato pendente de puxar pra esse cliente.{' '}
              <Link to="/classificacao" className="text-brand-600 hover:underline">
                Classifique um extrato primeiro →
              </Link>
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {pendentes.map((s) => {
                const totais = 'qtd' in s.totais ? s.totais : null;
                return (
                  <li key={s.id}>
                    <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                      <input
                        type="radio"
                        name="statement"
                        checked={selectedId === s.id}
                        onChange={() => setSelectedId(s.id)}
                      />
                      <span className="flex-1">
                        {s.arquivo_nome}
                        {s.period_start && s.period_end && (
                          <span className="ml-2 text-xs text-slate-400">
                            {formatDate(s.period_start)}–{formatDate(s.period_end)}
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-slate-400">{totais?.qtd ?? 0} lanç.</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {selectedId && (
        <>
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
              <input className="input" value={histEntrada} onChange={(e) => setHistEntrada(e.target.value)} />
            </div>
            <div>
              <label className="label">Cód. histórico saída</label>
              <input className="input" value={histSaida} onChange={(e) => setHistSaida(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="label">Complemento no arquivo do Domínio</label>
            <select className="input" value={modo} onChange={(e) => setModo(e.target.value as ComplementoModo)}>
              {MODO_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">Dá pra trocar depois, na tela de Revisão.</p>
          </div>
        </>
      )}

      {errMsg && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errMsg}</p>}

      <button type="submit" className="btn-primary w-full" disabled={!canSubmit}>
        {header.isPending ? 'Enviando…' : 'Ir para revisão →'}
      </button>
    </form>
  );
}
