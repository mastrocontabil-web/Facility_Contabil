import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiDownload, saveBlob } from '@/lib/api';
import type {
  DiagnosticoPeriodo,
  DreRelatorio,
  HistoricoPadrao,
  Lancamento,
  LancamentoModelo,
  NaturezaDC,
  PeriodoContabil,
  PlanoConta,
  RazaoRelatorio,
  SaldoContabil,
} from '@/lib/types';

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

export function useLancamentos(periodoId: string | undefined) {
  return useQuery({
    queryKey: ['lancamentos', periodoId],
    queryFn: () => api<{ lancamentos: Lancamento[] }>(`/api/contabil/lancamentos?periodo_id=${periodoId}`),
    select: (d) => d.lancamentos,
    enabled: !!periodoId,
  });
}

export type LancamentoPartidaInput = { plano_conta_id: string; tipo: NaturezaDC; valor_cents: number };

export type LancamentoInput = {
  client_id: string;
  data: string;
  historico_codigo?: string | null;
  historico_complemento: string;
  partidas: LancamentoPartidaInput[];
};

export function useCreateLancamento(periodoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LancamentoInput) =>
      api<{ lancamento: Lancamento }>('/api/contabil/lancamentos', { method: 'POST', body: input }),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['lancamentos', data.lancamento.periodo_id] });
      if (periodoId) qc.invalidateQueries({ queryKey: ['lancamentos', periodoId] });
      // pode ter aberto um período novo (mês sem período ainda) — atualiza o seletor.
      qc.invalidateQueries({ queryKey: ['periodos', vars.client_id] });
    },
  });
}

export function useUpdateLancamento(periodoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Omit<LancamentoInput, 'client_id'> }) =>
      api<{ lancamento: Lancamento }>(`/api/contabil/lancamentos/${id}`, { method: 'PATCH', body: input }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['lancamentos', data.lancamento.periodo_id] });
      if (periodoId) qc.invalidateQueries({ queryKey: ['lancamentos', periodoId] });
      // edição pode ter mudado a data pra um mês sem período ainda — não sabemos o
      // client_id aqui (PATCH não manda), então invalida todo mundo (raro, barato).
      qc.invalidateQueries({ queryKey: ['periodos'] });
    },
  });
}

export function useDeleteLancamento(periodoId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/contabil/lancamentos/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lancamentos', periodoId] }),
  });
}

export function useDre(periodoId: string | undefined) {
  return useQuery({
    queryKey: ['dre', periodoId],
    queryFn: () => api<DreRelatorio>(`/api/contabil/relatorios/dre?periodo_id=${periodoId}`),
    enabled: !!periodoId,
  });
}

export function useExportarBalancetePdf() {
  return useMutation({
    mutationFn: async (periodoId: string) => {
      const { blob, filename } = await apiDownload(`/api/contabil/relatorios/balancete/pdf?periodo_id=${periodoId}`);
      saveBlob(blob, filename);
    },
  });
}

export function useExportarDrePdf() {
  return useMutation({
    mutationFn: async (periodoId: string) => {
      const { blob, filename } = await apiDownload(`/api/contabil/relatorios/dre/pdf?periodo_id=${periodoId}`);
      saveBlob(blob, filename);
    },
  });
}

export function useRazao(periodoId: string | undefined, planoContaId: string | undefined) {
  return useQuery({
    queryKey: ['razao', periodoId, planoContaId],
    queryFn: () =>
      api<RazaoRelatorio>(
        `/api/contabil/relatorios/razao?periodo_id=${periodoId}&plano_conta_id=${planoContaId}`,
      ),
    enabled: !!periodoId && !!planoContaId,
  });
}

export function useExportarRazaoPdf() {
  return useMutation({
    mutationFn: async ({ periodoId, planoContaId }: { periodoId: string; planoContaId: string }) => {
      const { blob, filename } = await apiDownload(
        `/api/contabil/relatorios/razao/pdf?periodo_id=${periodoId}&plano_conta_id=${planoContaId}`,
      );
      saveBlob(blob, filename);
    },
  });
}

export function useExportarLivroDiarioPdf() {
  return useMutation({
    mutationFn: async (periodoId: string) => {
      const { blob, filename } = await apiDownload(
        `/api/contabil/relatorios/livro-diario/pdf?periodo_id=${periodoId}`,
      );
      saveBlob(blob, filename);
    },
  });
}

export function useFecharPeriodo(clientId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (periodoId: string) =>
      api<{ periodo: PeriodoContabil }>(`/api/contabil/periodos/${periodoId}/fechar`, { method: 'POST' }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['periodos', clientId] });
      qc.invalidateQueries({ queryKey: ['lancamentos', data.periodo.id] });
      qc.invalidateQueries({ queryKey: ['saldos', data.periodo.id] });
      qc.invalidateQueries({ queryKey: ['diagnostico', data.periodo.id] });
    },
  });
}

export function useReabrirPeriodo(clientId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (periodoId: string) =>
      api<{ periodo: PeriodoContabil }>(`/api/contabil/periodos/${periodoId}/reabrir`, { method: 'POST' }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['periodos', clientId] });
      qc.invalidateQueries({ queryKey: ['lancamentos', data.periodo.id] });
      qc.invalidateQueries({ queryKey: ['saldos', data.periodo.id] });
      qc.invalidateQueries({ queryKey: ['diagnostico', data.periodo.id] });
    },
  });
}

export function useDiagnosticoPeriodo(periodoId: string | undefined) {
  return useQuery({
    queryKey: ['diagnostico', periodoId],
    queryFn: () => api<DiagnosticoPeriodo>(`/api/contabil/periodos/${periodoId}/diagnostico`),
    enabled: !!periodoId,
  });
}

export function useExportarDominio() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ periodoId, loteNumero }: { periodoId: string; loteNumero: number }) => {
      const { blob, filename } = await apiDownload(
        `/api/contabil/relatorios/exportar-dominio?periodo_id=${periodoId}&lote_numero=${loteNumero}`,
      );
      saveBlob(blob, filename);
    },
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['diagnostico', vars.periodoId] }),
  });
}

export function useModelos(clientId: string | undefined) {
  return useQuery({
    queryKey: ['modelos', clientId],
    queryFn: () => api<{ modelos: LancamentoModelo[] }>(`/api/contabil/modelos?client_id=${clientId}`),
    select: (d) => d.modelos,
    enabled: !!clientId,
  });
}

export type ModeloPartidaInput = { plano_conta_id: string; tipo: NaturezaDC; valor_cents_padrao?: number | null };

export type ModeloInput = {
  client_id: string;
  nome: string;
  historico_codigo?: string | null;
  historico_complemento: string;
  partidas: ModeloPartidaInput[];
};

export function useCreateModelo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ModeloInput) =>
      api<{ modelo: LancamentoModelo }>('/api/contabil/modelos', { method: 'POST', body: input }),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: ['modelos', vars.client_id] }),
  });
}

export function useUpdateModelo(clientId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Omit<ModeloInput, 'client_id'> & { ativo?: boolean } }) =>
      api<{ modelo: LancamentoModelo }>(`/api/contabil/modelos/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modelos', clientId] }),
  });
}

export function useDeleteModelo(clientId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/contabil/modelos/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modelos', clientId] }),
  });
}

export type ImportarTransacoesResult = {
  periodo: PeriodoContabil;
  importados: number;
  ignorados: number;
  warnings: string[];
};

export function useImportarTransacoes(clientId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { client_id: string; ano: number; mes: number }) =>
      api<ImportarTransacoesResult>('/api/contabil/lancamentos/importar-transacoes', {
        method: 'POST',
        body: input,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['lancamentos', data.periodo.id] });
      qc.invalidateQueries({ queryKey: ['saldos', data.periodo.id] });
      qc.invalidateQueries({ queryKey: ['periodos', clientId] });
    },
  });
}
