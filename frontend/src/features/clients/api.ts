import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Client, ClientInput } from '@/lib/types';

export type ClientsFilter = { q?: string; ativo?: 'true' | 'false' | 'all' };

export function useClients(filter: ClientsFilter = {}) {
  const params = new URLSearchParams();
  if (filter.q) params.set('q', filter.q);
  if (filter.ativo && filter.ativo !== 'all') params.set('ativo', filter.ativo);
  const qs = params.toString();

  return useQuery({
    queryKey: ['clients', filter],
    queryFn: () => api<{ clients: Client[] }>(`/api/clients${qs ? `?${qs}` : ''}`),
    select: (d) => d.clients,
  });
}

export function useClient(id: string | undefined) {
  return useQuery({
    queryKey: ['clients', 'one', id],
    queryFn: () => api<{ client: Client }>(`/api/clients/${id}`),
    select: (d) => d.client,
    enabled: !!id,
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ClientInput) =>
      api<{ client: Client }>('/api/clients', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
}

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<ClientInput> }) =>
      api<{ client: Client }>(`/api/clients/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
}

export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/clients/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
}
