import { useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { BackendStatus } from '@/components/BackendStatus';
import { ApiError } from '@/lib/api';
import { formatCnpjCpf } from '@/lib/format';
import type { Client, ClientInput } from '@/lib/types';
import {
  useClients,
  useCreateClient,
  useDeleteClient,
  useUpdateClient,
  type ClientsFilter,
} from './api';
import { ClientForm } from './ClientForm';

export function ClientsPage() {
  const [search, setSearch] = useState('');
  const [ativo, setAtivo] = useState<ClientsFilter['ativo']>('all');
  const [editing, setEditing] = useState<Client | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Client | null>(null);

  const filter = useMemo<ClientsFilter>(() => ({ q: search || undefined, ativo }), [search, ativo]);
  const { data: clients, isLoading, error } = useClients(filter);

  const createMut = useCreateClient();
  const updateMut = useUpdateClient();
  const deleteMut = useDeleteClient();

  function handleCreate(input: ClientInput) {
    createMut.mutate(input, { onSuccess: () => setCreating(false) });
  }
  function handleUpdate(input: ClientInput) {
    if (!editing) return;
    updateMut.mutate({ id: editing.id, input }, { onSuccess: () => setEditing(null) });
  }
  function confirmDelete() {
    if (!deleting) return;
    deleteMut.mutate(deleting.id, { onSuccess: () => setDeleting(null) });
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Clientes</h1>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          + Novo cliente
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="Buscar por razão social ou CNPJ…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="input max-w-[10rem]"
          value={ativo}
          onChange={(e) => setAtivo(e.target.value as ClientsFilter['ativo'])}
        >
          <option value="all">Todos</option>
          <option value="true">Ativos</option>
          <option value="false">Inativos</option>
        </select>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-sm text-slate-400">Carregando…</p>
        ) : error ? (
          <p className="p-6 text-sm text-red-600">
            {error instanceof Error ? error.message : 'Falha ao carregar'}
          </p>
        ) : !clients?.length ? (
          <p className="p-6 text-sm text-slate-400">Nenhum cliente. Cadastre o primeiro.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2">Razão social</th>
                <th className="px-4 py-2">CNPJ / CPF</th>
                <th className="px-4 py-2">Cód. Domínio</th>
                <th className="px-4 py-2">Conta banco</th>
                <th className="px-4 py-2">Hist. E/S</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clients.map((c) => (
                <tr key={c.id} className={c.ativo ? '' : 'opacity-50'}>
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {c.razao_social}
                    {!c.ativo && <span className="ml-2 text-xs text-slate-400">(inativo)</span>}
                  </td>
                  <td className="px-4 py-2 text-slate-600">{formatCnpjCpf(c.cnpj)}</td>
                  <td className="px-4 py-2 text-slate-600">{c.dominio_code}</td>
                  <td className="px-4 py-2 text-slate-600">{c.banco_conta_contabil ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {c.hist_code_entrada} / {c.hist_code_saida}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button
                      className="text-brand-600 hover:underline"
                      onClick={() => setEditing(c)}
                    >
                      Editar
                    </button>
                    <button
                      className="ml-3 text-slate-400 hover:text-red-600"
                      onClick={() => setDeleting(c)}
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="Novo cliente" wide>
        <ClientForm
          onSubmit={handleCreate}
          onCancel={() => setCreating(false)}
          submitting={createMut.isPending}
          error={createMut.error}
        />
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Editar — ${editing?.razao_social ?? ''}`}
        wide
      >
        {editing && (
          <ClientForm
            client={editing}
            onSubmit={handleUpdate}
            onCancel={() => setEditing(null)}
            submitting={updateMut.isPending}
            error={updateMut.error}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Excluir cliente"
        message={`Excluir "${deleting?.razao_social}"? Essa ação não pode ser desfeita.`}
        busy={deleteMut.isPending}
        error={
          deleteMut.isError
            ? deleteMut.error instanceof ApiError
              ? deleteMut.error.message
              : 'Falha ao excluir'
            : null
        }
        onConfirm={confirmDelete}
        onCancel={() => {
          setDeleting(null);
          deleteMut.reset();
        }}
      />

      <details className="text-sm text-slate-500">
        <summary className="cursor-pointer">Status dos serviços</summary>
        <div className="mt-2 max-w-sm">
          <BackendStatus />
        </div>
      </details>
    </section>
  );
}
