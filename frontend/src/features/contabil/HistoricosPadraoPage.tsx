import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ApiError } from '@/lib/api';
import type { HistoricoPadrao } from '@/lib/types';
import {
  useCreateHistoricoPadrao,
  useDeleteHistoricoPadrao,
  useHistoricosPadrao,
  useUpdateHistoricoPadrao,
} from './api';

export function HistoricosPadraoPage() {
  const { data: historicos, isLoading, error } = useHistoricosPadrao();
  const createMut = useCreateHistoricoPadrao();
  const updateMut = useUpdateHistoricoPadrao();
  const deleteMut = useDeleteHistoricoPadrao();

  const [codigo, setCodigo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draftDescricao, setDraftDescricao] = useState('');
  const [deleting, setDeleting] = useState<HistoricoPadrao | null>(null);

  function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!codigo.trim() || !descricao.trim()) return;
    createMut.mutate(
      { codigo: codigo.trim(), descricao: descricao.trim() },
      { onSuccess: () => { setCodigo(''); setDescricao(''); } },
    );
  }

  function salvarDescricao(h: HistoricoPadrao) {
    const d = draftDescricao.trim();
    if (!d || d === h.descricao) {
      setEditing(null);
      return;
    }
    updateMut.mutate({ id: h.id, input: { descricao: d } }, { onSuccess: () => setEditing(null) });
  }

  const createErr =
    createMut.error instanceof ApiError
      ? createMut.error.message
      : createMut.error
        ? 'Falha ao criar'
        : null;

  return (
    <section className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Históricos padrão</h1>
        <p className="text-sm text-slate-500">
          Catálogo único do escritório — vale para qualquer cliente. Use o código na hora de fazer
          um lançamento contábil, ou digite um histórico livre quando não tiver um padrão.
        </p>
      </div>

      <form onSubmit={criar} className="card flex flex-wrap items-end gap-2 p-4">
        <div className="w-24">
          <label className="label">Código</label>
          <input
            className="input h-9"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
            placeholder="ex: 1"
            inputMode="numeric"
          />
        </div>
        <div className="min-w-[240px] flex-1">
          <label className="label">Descrição</label>
          <input
            className="input h-9"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="ex: CONFORME NOTA FISCAL SUPRACITADA"
          />
        </div>
        <button
          className="btn-primary h-9 px-4"
          disabled={!codigo.trim() || !descricao.trim() || createMut.isPending}
        >
          {createMut.isPending ? 'Adicionando…' : 'Adicionar'}
        </button>
      </form>
      {createErr && <p className="text-xs text-red-600">{createErr}</p>}

      <div className="card p-0">
        {isLoading ? (
          <p className="p-4 text-sm text-slate-400">Carregando…</p>
        ) : error ? (
          <p className="p-4 text-sm text-red-600">
            {error instanceof Error ? error.message : 'Falha ao carregar'}
          </p>
        ) : !historicos?.length ? (
          <p className="p-4 text-sm text-slate-400">Nenhum histórico padrão cadastrado ainda.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {historicos.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="w-14 shrink-0 font-mono text-slate-500">{h.codigo}</span>
                {editing === h.id ? (
                  <span className="flex flex-1 gap-1">
                    <input
                      className="input h-8 flex-1 px-2 text-xs"
                      value={draftDescricao}
                      autoFocus
                      onChange={(e) => setDraftDescricao(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && salvarDescricao(h)}
                    />
                    <button className="btn-ghost h-8 px-2 text-xs" onClick={() => salvarDescricao(h)}>
                      ok
                    </button>
                  </span>
                ) : (
                  <button
                    className={`flex-1 text-left hover:text-brand-600 hover:underline ${
                      h.ativo ? 'text-slate-700' : 'text-slate-400 line-through'
                    }`}
                    onClick={() => {
                      setEditing(h.id);
                      setDraftDescricao(h.descricao);
                    }}
                  >
                    {h.descricao}
                  </button>
                )}
                <button
                  className="text-xs text-slate-400 hover:text-slate-600"
                  title={h.ativo ? 'Desativar (não aparece mais pra escolher)' : 'Reativar'}
                  onClick={() => updateMut.mutate({ id: h.id, input: { ativo: !h.ativo } })}
                >
                  {h.ativo ? 'desativar' : 'reativar'}
                </button>
                <button
                  className="text-xs text-slate-400 hover:text-red-600"
                  onClick={() => setDeleting(h)}
                >
                  excluir
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={!!deleting}
        title="Excluir histórico padrão"
        message={`Excluir o histórico "${deleting?.codigo} — ${deleting?.descricao}"?`}
        busy={deleteMut.isPending}
        error={
          deleteMut.isError
            ? deleteMut.error instanceof ApiError
              ? deleteMut.error.message
              : 'Falha ao excluir'
            : null
        }
        onConfirm={() => deleting && deleteMut.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
        onCancel={() => {
          setDeleting(null);
          deleteMut.reset();
        }}
      />
    </section>
  );
}
