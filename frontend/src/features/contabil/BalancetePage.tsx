import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { useClients } from '@/features/clients/api';
import { FileDrop } from '@/components/FileDrop';
import { formatCompetencia } from '@/lib/format';
import { useImportarBalancete, usePeriodos, useSaldos } from './api';
import { SaldoRow } from './SaldoRow';

export function BalancetePage() {
  const { data: clients, isLoading: loadingClients } = useClients({ ativo: 'true' });
  const [clientId, setClientId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pdfPassword, setPdfPassword] = useState('');
  const [periodoId, setPeriodoId] = useState('');
  const [resultado, setResultado] = useState<{
    criadas: number;
    atualizadas: number;
    warnings: string[];
  } | null>(null);

  const { data: periodos, isLoading: loadingPeriodos } = usePeriodos(clientId || undefined);
  const { data: saldos, isLoading: loadingSaldos, error } = useSaldos(periodoId || undefined);
  const importMut = useImportarBalancete();

  const isPdf = file?.name.toLowerCase().endsWith('.pdf');

  function importar(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId || !file) return;
    importMut.mutate(
      { client_id: clientId, file, pdf_password: pdfPassword || undefined },
      {
        onSuccess: (r) => {
          setResultado({ criadas: r.criadas, atualizadas: r.atualizadas, warnings: r.warnings });
          setPeriodoId(r.periodo.id);
          setFile(null);
        },
      },
    );
  }

  const errMsg =
    importMut.error instanceof ApiError
      ? importMut.error.message +
        (importMut.error.details ? ` (${JSON.stringify(importMut.error.details)})` : '')
      : importMut.error
        ? String(importMut.error)
        : null;

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Importar balancete</h1>
        <p className="text-sm text-slate-500">
          Importe o relatório "Balancete" do Domínio pra trazer o saldo de cada conta no período. O
          período é lido do próprio PDF — importar fecha aquele mês. Reimportar o mesmo mês atualiza
          pelo código, sem duplicar.
        </p>
      </div>

      <select
        className="input max-w-md"
        value={clientId}
        onChange={(e) => {
          setClientId(e.target.value);
          setPeriodoId('');
          setResultado(null);
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

      {!clientId ? (
        <p className="card p-6 text-sm text-slate-400">Escolha um cliente.</p>
      ) : (
        <>
          <form onSubmit={importar} className="card space-y-3 p-4">
            <div>
              <label className="label">PDF do balancete</label>
              <FileDrop file={file} onFile={setFile} />
            </div>
            {isPdf && (
              <div>
                <label className="label">Senha do PDF (se tiver)</label>
                <input
                  className="input max-w-xs"
                  type="password"
                  value={pdfPassword}
                  onChange={(e) => setPdfPassword(e.target.value)}
                  placeholder="deixe em branco se não tem senha"
                />
              </div>
            )}
            {errMsg && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errMsg}</p>}
            <button type="submit" className="btn-primary" disabled={!file || importMut.isPending}>
              {importMut.isPending ? 'Lendo o PDF…' : 'Importar balancete'}
            </button>
          </form>

          {resultado && (
            <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              <p>
                {resultado.criadas} conta{resultado.criadas === 1 ? '' : 's'} nova
                {resultado.criadas === 1 ? '' : 's'}, {resultado.atualizadas} atualizada
                {resultado.atualizadas === 1 ? '' : 's'}.
              </p>
              {resultado.warnings.length > 0 && (
                <ul className="ml-4 mt-1 list-disc text-amber-800">
                  {resultado.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <select
            className="input max-w-xs"
            value={periodoId}
            onChange={(e) => setPeriodoId(e.target.value)}
            disabled={loadingPeriodos}
          >
            <option value="">
              {loadingPeriodos ? 'Carregando…' : 'Selecione um período importado…'}
            </option>
            {periodos?.map((p) => (
              <option key={p.id} value={p.id}>
                {formatCompetencia(p.ano, p.mes)} {p.status === 'fechado' ? '🔒 fechado' : ''}
              </option>
            ))}
          </select>

          {periodoId && (
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
        </>
      )}
    </section>
  );
}
