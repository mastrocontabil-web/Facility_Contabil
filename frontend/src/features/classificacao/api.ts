import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Classificacao, Direction, Transaction } from '@/lib/types';
import type { StatementDetail } from '@/features/statements/api';

export type ClassificarResult = StatementDetail & { warnings: string[] };

export function useClassificacoes(clientId: string | undefined, direction?: Direction) {
  const params = new URLSearchParams();
  if (clientId) params.set('client_id', clientId);
  if (direction) params.set('direction', direction);
  return useQuery({
    queryKey: ['classificacoes', clientId, direction],
    queryFn: () => api<{ classificacoes: Classificacao[] }>(`/api/classificacoes?${params}`),
    select: (d) => d.classificacoes,
    enabled: !!clientId,
  });
}

export type ClassificacaoInput = { client_id: string; direction: Direction; nome: string };

export function useCreateClassificacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ClassificacaoInput) =>
      api<{ classificacao: Classificacao }>('/api/classificacoes', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classificacoes'] }),
  });
}

export function useUpdateClassificacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<Pick<Classificacao, 'nome' | 'ativo'>> }) =>
      api<{ classificacao: Classificacao }>(`/api/classificacoes/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classificacoes'] }),
  });
}

export function useDeleteClassificacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/classificacoes/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classificacoes'] }),
  });
}

export type CreateClassificarInput = {
  client_id: string;
  pdf_password?: string;
  file: File;
};

export function useCreateStatementClassificar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateClassificarInput) => {
      const fd = new FormData();
      fd.append('file', input.file);
      fd.append('client_id', input.client_id);
      if (input.pdf_password) fd.append('pdf_password', input.pdf_password);
      return api<ClassificarResult>('/api/statements/classificar', { method: 'POST', body: fd });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['statements'] }),
  });
}

export function useSaveClassificacoes(statementId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: { id: string; classificacao_id: string | null }[]) =>
      api<{ transactions: Transaction[]; updated: number }>(
        `/api/statements/${statementId}/classificacao`,
        { method: 'PATCH', body: { updates } },
      ),
    onSuccess: (data) => {
      qc.setQueryData(['statements', 'one', statementId], (cur: StatementDetail | undefined) =>
        cur ? { ...cur, transactions: data.transactions } : cur,
      );
      qc.invalidateQueries({ queryKey: ['statements'] });
    },
  });
}
