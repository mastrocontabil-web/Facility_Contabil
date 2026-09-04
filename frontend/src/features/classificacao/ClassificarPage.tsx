import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '@/lib/api';
import { useClients } from '@/features/clients/api';
import { FileDrop } from '@/components/FileDrop';
import { useCreateStatementClassificar } from './api';

export function ClassificarPage() {
  const navigate = useNavigate();
  const { data: clients, isLoading: loadingClients } = useClients({ ativo: 'true' });
  const createMut = useCreateStatementClassificar();

  const [clientId, setClientId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pdfPassword, setPdfPassword] = useState('');

  const isPdf = file?.name.toLowerCase().endsWith('.pdf');
  const canSubmit = clientId && file && !createMut.isPending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !file) return;
    createMut.mutate(
      { client_id: clientId, pdf_password: pdfPassword || undefined, file },
      { onSuccess: (r) => navigate(`/classificacao/revisao/${r.statement.id}`) },
    );
  }

  const err = createMut.error;
  const errMsg =
    err instanceof ApiError
      ? err.message + (err.details ? ` (${JSON.stringify(err.details)})` : '')
      : err
        ? String(err)
        : null;

  return (
    <section className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Classificar extrato</h1>
        <p className="text-sm text-slate-500">
          Importe o extrato e categorize cada lançamento (água, energia, telefone, recebimento de
          clientes…). Depois é só puxar esse extrato já classificado lá no módulo Importação pra
          definir as contas contábeis e gerar o arquivo do Domínio.
        </p>
      </div>

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

        {errMsg && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errMsg}</p>}

        <button type="submit" className="btn-primary w-full" disabled={!canSubmit}>
          {createMut.isPending ? 'Lendo o extrato…' : 'Ler extrato'}
        </button>
      </form>
    </section>
  );
}
