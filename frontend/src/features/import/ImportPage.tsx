import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import { useCreateStatement, type ImportResult } from '@/features/statements/api';
import { FileDrop } from '@/components/FileDrop';
import { PuxarClassificacaoForm } from './PuxarClassificacaoForm';
import { useCabecalhoImportacao } from './useCabecalhoImportacao';
import { CamposCabecalho, NotaContaBanco } from './CamposCabecalho';
import { ResultadoImportacao } from './ResultadoImportacao';

type Origem = 'novo' | 'classificacao';

export function ImportPage() {
  const [params] = useSearchParams();
  const puxarId = params.get('puxar') ?? undefined;
  const [origem, setOrigem] = useState<Origem>(puxarId ? 'classificacao' : 'novo');
  const cab = useCabecalhoImportacao();
  const createMut = useCreateStatement();

  const [file, setFile] = useState<File | null>(null);
  const [pdfPassword, setPdfPassword] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);

  const nome = file?.name.toLowerCase() ?? '';
  const isPdf = nome.endsWith('.pdf');
  // planilha que a leitura automática não entendeu → talvez seja controle do cliente
  const sugerirExcel =
    /\.(xls|xlsx|xlsm)$/.test(nome) &&
    createMut.error instanceof ApiError &&
    [400, 422].includes(createMut.error.status);
  const canSubmit = cab.completo && file && !createMut.isPending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !file) return;
    createMut.mutate(
      { ...cab.dados, pdf_password: pdfPassword || undefined, file },
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
    return (
      <ResultadoImportacao
        titulo="Extrato lido"
        result={result}
        saldoInicial={cab.saldoInicialNum}
        onSaldoInicial={(v) => cab.setSaldoInicial(v.toFixed(2).replace('.', ','))}
        onNova={() => setResult(null)}
      />
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
          <CamposCabecalho cab={cab} />

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
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              <p>{errMsg}</p>
              {sugerirExcel && (
                <p className="mt-1">
                  Planilha de controle do próprio cliente? Use a{' '}
                  <Link to="/importar/excel" className="font-medium underline">
                    Nova importação Excel
                  </Link>
                  , onde você escolhe a coluna de data, de valor e de histórico.
                </p>
              )}
            </div>
          )}

          <button type="submit" className="btn-primary w-full" disabled={!canSubmit}>
            {createMut.isPending ? 'Lendo o extrato…' : 'Ler extrato'}
          </button>
        </form>
      )}

      {origem === 'novo' && <NotaContaBanco cab={cab} />}
    </section>
  );
}
