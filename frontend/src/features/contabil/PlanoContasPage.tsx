import { useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useClients } from '@/features/clients/api';
import { FileDrop } from '@/components/FileDrop';
import type { PlanoConta } from '@/lib/types';
import { useImportarPlanoContas, usePlanoContas, useUpdatePlanoConta } from './api';

export function PlanoContasPage() {
  const { data: clients, isLoading: loadingClients } = useClients({ ativo: 'true' });
  const [clientId, setClientId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [pdfPassword, setPdfPassword] = useState('');
  const [busca, setBusca] = useState('');
  const [resultado, setResultado] = useState<{
    criadas: number;
    atualizadas: number;
    warnings: string[];
  } | null>(null);

  const { data: contas, isLoading: loadingContas, error } = usePlanoContas(clientId || undefined);
  const importMut = useImportarPlanoContas();

  const isPdf = file?.name.toLowerCase().endsWith('.pdf');

  function importar(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId || !file) return;
    importMut.mutate(
      { client_id: clientId, file, pdf_password: pdfPassword || undefined },
      {
        onSuccess: (r) => {
          setResultado({ criadas: r.criadas, atualizadas: r.atualizadas, warnings: r.warnings });
          setFile(null);
        },
      },
    );
  }

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return contas ?? [];
    return (contas ?? []).filter(
      (c) =>
        c.codigo.includes(termo) ||
        c.nome.toLowerCase().includes(termo) ||
        c.classificacao.includes(termo),
    );
  }, [contas, busca]);

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
        <h1 className="text-xl font-semibold text-slate-800">Plano de contas</h1>
        <p className="text-sm text-slate-500">
          Importe o relatório "Plano de Contas" do Domínio pra trazer as contas do cliente pra cá.
          Reimportar atualiza pelo código — nunca apaga contas existentes.
        </p>
      </div>

      <select
        className="input max-w-md"
        value={clientId}
        onChange={(e) => {
          setClientId(e.target.value);
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
              <label className="label">PDF do plano de contas</label>
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
              {importMut.isPending ? 'Lendo o PDF…' : 'Importar plano de contas'}
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

          <input
            className="input max-w-sm"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por código, classificação ou nome…"
          />

          <div className="card overflow-x-auto p-0">
            {loadingContas ? (
              <p className="p-4 text-sm text-slate-400">Carregando…</p>
            ) : error ? (
              <p className="p-4 text-sm text-red-600">
                {error instanceof Error ? error.message : 'Falha ao carregar'}
              </p>
            ) : !filtradas.length ? (
              <p className="p-4 text-sm text-slate-400">
                {contas?.length ? 'Nenhuma conta bate com a busca.' : 'Nenhuma conta importada ainda.'}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-2">Código</th>
                    <th className="px-4 py-2">Classificação</th>
                    <th className="px-4 py-2">Nome</th>
                    <th className="px-4 py-2">Grau</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtradas.map((c) => (
                    <ContaRow key={c.id} conta={c} clientId={clientId} />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function ContaRow({ conta, clientId }: { conta: PlanoConta; clientId: string }) {
  const sintetica = conta.tipo === 'S';
  const updateMut = useUpdatePlanoConta(clientId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conta.nome);

  function salvar() {
    const nome = draft.trim();
    if (!nome || nome === conta.nome) {
      setEditing(false);
      return;
    }
    updateMut.mutate({ id: conta.id, input: { nome } }, { onSuccess: () => setEditing(false) });
  }

  return (
    <tr className={sintetica ? 'bg-slate-50/60 font-medium text-slate-800' : 'text-slate-600'}>
      <td className="whitespace-nowrap px-4 py-1.5 font-mono">{conta.codigo}</td>
      <td className="whitespace-nowrap px-4 py-1.5 font-mono text-slate-400">{conta.classificacao}</td>
      <td className="px-4 py-1.5" style={{ paddingLeft: `${(conta.grau - 1) * 14 + 16}px` }}>
        {editing ? (
          <span className="flex gap-1">
            <input
              className="input h-7 flex-1 px-2 text-xs font-normal"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && salvar()}
            />
            <button className="btn-ghost h-7 px-2 text-xs" onClick={salvar}>
              ok
            </button>
          </span>
        ) : (
          <button
            className="text-left hover:text-brand-600 hover:underline"
            title="Editar nome"
            onClick={() => {
              setDraft(conta.nome);
              setEditing(true);
            }}
          >
            {conta.nome}
          </button>
        )}
      </td>
      <td className="px-4 py-1.5 text-slate-400">{conta.grau}</td>
    </tr>
  );
}
