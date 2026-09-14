import { useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useClients } from '@/features/clients/api';
import { FileDrop } from '@/components/FileDrop';
import type { PlanoConta } from '@/lib/types';
import {
  useCreatePlanoConta,
  useImportarPlanoContas,
  usePlanoContas,
  useUpdatePlanoConta,
} from './api';

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
  const createMut = useCreatePlanoConta();

  const [mostrarCriar, setMostrarCriar] = useState(false);
  const [novoCodigo, setNovoCodigo] = useState('');
  const [novoTipo, setNovoTipo] = useState<'S' | 'A'>('A');
  const [novaClassificacao, setNovaClassificacao] = useState('');
  const [novoNome, setNovoNome] = useState('');
  const [novoGrau, setNovoGrau] = useState('5');

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

  function criarConta(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId || !novoCodigo.trim() || !novaClassificacao.trim() || !novoNome.trim()) return;
    createMut.mutate(
      {
        client_id: clientId,
        codigo: novoCodigo.trim(),
        tipo: novoTipo,
        classificacao: novaClassificacao.trim(),
        nome: novoNome.trim(),
        grau: Number(novoGrau),
      },
      {
        onSuccess: () => {
          setNovoCodigo('');
          setNovaClassificacao('');
          setNovoNome('');
          setNovoTipo('A');
          setNovoGrau('5');
          setMostrarCriar(false);
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

          <div className="flex items-center gap-3">
            <input
              className="input max-w-sm"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por código, classificação ou nome…"
            />
            <button
              type="button"
              className="text-xs text-slate-400 hover:text-brand-600"
              onClick={() => setMostrarCriar((v) => !v)}
            >
              {mostrarCriar ? 'cancelar' : '+ cadastrar conta manualmente'}
            </button>
          </div>

          {mostrarCriar && (
            <form onSubmit={criarConta} className="card flex flex-wrap items-end gap-2 p-4">
              <div className="w-28">
                <label className="label">Código</label>
                <input
                  className="input h-9"
                  value={novoCodigo}
                  onChange={(e) => setNovoCodigo(e.target.value.replace(/\D/g, ''))}
                  placeholder="ex: 10298"
                  inputMode="numeric"
                />
              </div>
              <div className="w-24">
                <label className="label">Tipo</label>
                <select
                  className="input h-9"
                  value={novoTipo}
                  onChange={(e) => setNovoTipo(e.target.value as 'S' | 'A')}
                >
                  <option value="A">A (analítica)</option>
                  <option value="S">S (sintética)</option>
                </select>
              </div>
              <div className="w-44">
                <label className="label">Classificação</label>
                <input
                  className="input h-9"
                  value={novaClassificacao}
                  onChange={(e) => setNovaClassificacao(e.target.value)}
                  placeholder="ex: 1.1.1.02.000003"
                />
              </div>
              <div className="w-20">
                <label className="label">Grau</label>
                <select className="input h-9" value={novoGrau} onChange={(e) => setNovoGrau(e.target.value)}>
                  {[1, 2, 3, 4, 5].map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-[240px] flex-1">
                <label className="label">Nome</label>
                <input
                  className="input h-9"
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  placeholder="nome da conta"
                />
              </div>
              <button
                className="btn-primary h-9 px-4"
                disabled={
                  !novoCodigo.trim() || !novaClassificacao.trim() || !novoNome.trim() || createMut.isPending
                }
              >
                {createMut.isPending ? 'Cadastrando…' : 'Cadastrar'}
              </button>
              {createMut.error && (
                <p className="w-full text-xs text-red-600">
                  {createMut.error instanceof ApiError ? createMut.error.message : 'Falha ao cadastrar'}
                </p>
              )}
            </form>
          )}

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
