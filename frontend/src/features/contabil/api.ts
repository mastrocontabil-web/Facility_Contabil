import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { HistoricoPadrao, PeriodoContabil, PlanoConta, SaldoContabil } from '@/lib/types';

export function usePlanoContas(clientId: string | undefined) {
  return useQuery({
    queryKey: ['plano-contas', clientId],
    queryFn: () => api<{ contas: PlanoConta[] }>(`/api/contabil/plano-contas?client_id=${clientId}`),
    select: (d) => d.contas,
    enabled: !!clientId,
  });
}

export type ImportarPlanoContasInput = {
  client_id: string;
  pdf_password?: string;
  file: File;
};

export type ImportarPlanoContasResult = {
  contas: PlanoConta[];
  warnings: string[];
  criadas: number;
  atualizadas: number;
};

export function useImportarPlanoContas() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportarPlanoContasInput) => {
      const fd = new FormData();
      fd.append('file', input.file);
      fd.append('client_id', input.client_id);
      if (input.pdf_password) fd.append('pdf_password', input.pdf_password);
      return api<ImportarPlanoContasResult>('/api/contabil/plano-contas/importar', {
        method: 'POST',
        body: fd,
      });
    },
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: ['plano-contas', vars.client_id] }),
  });
}

export type PlanoContaInput = {
  client_id: string;
  codigo: string;
  tipo: 'S' | 'A';
  classificacao: string;
  nome: string;
  grau: number;
};

export function useCreatePlanoConta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PlanoContaInput) =>
      api<{ conta: PlanoConta }>('/api/contabil/plano-contas', { method: 'POST', body: input }),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['plano-contas', vars.client_id] }),
  });
}

export function useUpdatePlanoConta(clientId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<Omit<PlanoContaInput, 'client_id'>> }) =>
      api<{ conta: PlanoConta }>(`/api/contabil/plano-contas/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plano-contas', clientId] }),
  });
}

export function useDeletePlanoConta(clientId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/contabil/plano-contas/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plano-contas', clientId] }),
  });
}

export function useHistoricosPadrao() {
  return useQuery({
    queryKey: ['historicos-padrao'],
    queryFn: () => api<{ historicos: HistoricoPadrao[] }>('/api/contabil/historicos'),
    select: (d) => d.historicos,
  });
}

export type HistoricoPadraoInput = { codigo: string; descricao: string };

export function useCreateHistoricoPadrao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: HistoricoPadraoInput) =>
      api<{ historico: HistoricoPadrao }>('/api/contabil/historicos', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['historicos-padrao'] }),
  });
}

export function useUpdateHistoricoPadrao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<HistoricoPadraoInput & { ativo: boolean }> }) =>
      api<{ historico: HistoricoPadrao }>(`/api/contabil/historicos/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['historicos-padrao'] }),
  });
}

export function useDeleteHistoricoPadrao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/contabil/historicos/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['historicos-padrao'] }),
  });
}

export function usePeriodos(clientId: string | undefined) {
  return useQuery({
    queryKey: ['periodos', clientId],
    queryFn: () => api<{ periodos: PeriodoContabil[] }>(`/api/contabil/periodos?client_id=${clientId}`),
    select: (d) => d.periodos,
    enabled: !!clientId,
  });
}

export type ImportarBalanceteInput = {
  client_id: string;
  pdf_password?: string;
  file: File;
};

export type ImportarBalanceteResult = {
  periodo: PeriodoContabil;
  saldos: SaldoContabil[];
  warnings: string[];
  criadas: number;
  atualizadas: number;
};

export function useImportarBalancete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportarBalanceteInput) => {
      const fd = new FormData();
      fd.append('file', input.file);
      fd.append('client_id', input.client_id);
      if (input.pdf_password) fd.append('pdf_password', input.pdf_password);
      return api<ImportarBalanceteResult>('/api/contabil/balancete/importar', {
        method: 'POST',
        body: fd,
      });
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['periodos', vars.client_id] }),
  });
}

export function useSaldos(periodoId: string | undefined) {
  return useQuery({
    queryKey: ['saldos', periodoId],
    queryFn: () => api<{ saldos: SaldoContabil[] }>(`/api/contabil/saldos?periodo_id=${periodoId}`),
    select: (d) => d.saldos,
    enabled: !!periodoId,
  });
}
