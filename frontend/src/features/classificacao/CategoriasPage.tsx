import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ApiError } from '@/lib/api';
import type { Classificacao, Direction } from '@/lib/types';
import { useClients } from '@/features/clients/api';
import {
  useClassificacoes,
  useCreateClassificacao,
  useDeleteClassificacao,
  useUpdateClassificacao,
} from './api';

export function CategoriasPage() {
  const { data: clients, isLoading: loadingClients } = useClients({ ativo: 'true' });
  const [clientId, setClientId] = useState('');
  const { data: entradas, isLoading: le, error: ee } = useClassificacoes(clientId || undefined, 'entrada');
  const { data: saidas, isLoading: ls, error: es } = useClassificacoes(clientId || undefined, 'saida');

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Classificações</h1>
        <p className="text-sm text-slate-500">
          Categorias que você usa pra classificar os lançamentos no módulo Classificação (água,
          energia, telefone, recebimento de clientes…). Ficam salvas por cliente e valem pra
          qualquer mês.
        </p>
      </div>

      <select
        className="input max-w-md"
        value={clientId}
        onChange={(e) => setClientId(e.target.value)}
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Catalogo
            clientId={clientId}
            direction="saida"
            titulo="Saídas"
            items={saidas}
            isLoading={ls}
            error={es}
          />
          <Catalogo
            clientId={clientId}
            direction="entrada"
            titulo="Entradas"
            items={entradas}
            isLoading={le}
            error={ee}
          />
        </div>
      )}
    </section>
  );
}

function Catalogo({
  clientId,
  direction,
  titulo,
  items,
  isLoading,
  error,
}: {
  clientId: string;
  direction: Direction;
  titulo: string;
  items: Classificacao[] | undefined;
  isLoading: boolean;
  error: unknown;
}) {
  const createMut = useCreateClassificacao();
  const updateMut = useUpdateClassificacao();
  const deleteMut = useDeleteClassificacao();

  const [novoNome, setNovoNome] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draftNome, setDraftNome] = useState('');
  const [deleting, setDeleting] = useState<Classificacao | null>(null);

  function criar(e: React.FormEvent) {
    e.preventDefault();
    const nome = novoNome.trim();
    if (!nome) return;
    createMut.mutate(
      { client_id: clientId, direction, nome },
      { onSuccess: () => setNovoNome('') },
    );
  }

  function salvarNome(c: Classificacao) {
    const nome = draftNome.trim();
    if (!nome || nome === c.nome) {
      setEditing(null);
      return;
    }
    updateMut.mutate({ id: c.id, input: { nome } }, { onSuccess: () => setEditing(null) });
  }

  const createErr =
    createMut.error instanceof ApiError ? createMut.error.message : createMut.error ? 'Falha ao criar' : null;

  return (
    <div className="card p-4">
      <p className="mb-2 text-sm font-medium text-slate-700">{titulo}</p>

      <form onSubmit={criar} className="mb-3 flex gap-2">
        <input
          className="input h-9 flex-1"
          value={novoNome}
          onChange={(e) => setNovoNome(e.target.value)}
          placeholder={direction === 'saida' ? 'ex: ÁGUA E ESGOTO' : 'ex: RECEBIMENTO DE CLIENTES'}
        />
        <button className="btn-primary h-9 px-3" disabled={!novoNome.trim() || createMut.isPending}>
          {createMut.isPending ? 'Criando…' : 'Adicionar'}
        </button>
      </form>
      {createErr && <p className="mb-3 text-xs text-red-600">{createErr}</p>}

      {isLoading ? (
        <p className="text-sm text-slate-400">Carregando…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error instanceof Error ? error.message : 'Falha ao carregar'}</p>
      ) : !items?.length ? (
        <p className="text-sm text-slate-400">Nenhuma classificação ainda.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              {editing === c.id ? (
                <span className="flex flex-1 gap-1">
                  <input
                    className="input h-8 flex-1 px-2 text-xs"
                    value={draftNome}
                    autoFocus
                    onChange={(e) => setDraftNome(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && salvarNome(c)}
                  />
                  <button className="btn-ghost h-8 px-2 text-xs" onClick={() => salvarNome(c)}>
                    ok
                  </button>
                </span>
              ) : (
                <button
                  className={`flex-1 text-left hover:text-brand-600 hover:underline ${
                    c.ativo ? 'text-slate-700' : 'text-slate-400 line-through'
                  }`}
                  onClick={() => {
                    setEditing(c.id);
                    setDraftNome(c.nome);
                  }}
                >
                  {c.nome}
                </button>
              )}
              <button
                className="text-xs text-slate-400 hover:text-slate-600"
                title={c.ativo ? 'Desativar (não aparece mais pra escolher)' : 'Reativar'}
                onClick={() => updateMut.mutate({ id: c.id, input: { ativo: !c.ativo } })}
              >
                {c.ativo ? 'desativar' : 'reativar'}
              </button>
              <button className="text-xs text-slate-400 hover:text-red-600" onClick={() => setDeleting(c)}>
                excluir
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Excluir classificação"
        message={`Excluir "${deleting?.nome}"? Lançamentos já classificados com ela ficam sem classificação.`}
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
    </div>
  );
}
