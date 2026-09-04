import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiDownload, saveBlob } from '@/lib/api';
import type { Statement, Transaction } from '@/lib/types';

export type StatementDetail = { statement: Statement; transactions: Transaction[] };
export type ImportResult = StatementDetail & { warnings: string[] };

export type CreateStatementInput = {
  client_id: string;
  banco_conta_contabil: string;
  hist_code_entrada?: string;
  hist_code_saida?: string;
  lote_numero?: number;
  saldo_inicial?: string;
  pdf_password?: string;
  file: File;
};

export function useStatements(
  filter: { client_id?: string; status?: string } = {},
  opts: { enabled?: boolean } = {},
) {
  const params = new URLSearchParams();
  if (filter.client_id) params.set('client_id', filter.client_id);
  if (filter.status) params.set('status', filter.status);
  const qs = params.toString();
  return useQuery({
    queryKey: ['statements', filter],
    queryFn: () => api<{ statements: Statement[] }>(`/api/statements${qs ? `?${qs}` : ''}`),
    select: (d) => d.statements,
    enabled: opts.enabled ?? true,
  });
}

export function useStatement(id: string | undefined) {
  return useQuery({
    queryKey: ['statements', 'one', id],
    queryFn: () => api<StatementDetail>(`/api/statements/${id}`),
    enabled: !!id,
  });
}

export function useCreateStatement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStatementInput) => {
      const fd = new FormData();
      fd.append('file', input.file);
      fd.append('client_id', input.client_id);
      fd.append('banco_conta_contabil', input.banco_conta_contabil);
      if (input.hist_code_entrada) fd.append('hist_code_entrada', input.hist_code_entrada);
      if (input.hist_code_saida) fd.append('hist_code_saida', input.hist_code_saida);
      if (input.lote_numero != null) fd.append('lote_numero', String(input.lote_numero));
      if (input.saldo_inicial != null) fd.append('saldo_inicial', input.saldo_inicial);
      if (input.pdf_password) fd.append('pdf_password', input.pdf_password);
      return api<ImportResult>('/api/statements', { method: 'POST', body: fd });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['statements'] }),
  });
}

export function useDeleteStatement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/statements/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['statements'] }),
  });
}

export function useDeleteStatements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await api(`/api/statements/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['statements'] }),
  });
}

export function useReimportStatement(statementId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { file: File; pdf_password?: string }) => {
      const fd = new FormData();
      fd.append('file', input.file);
      if (input.pdf_password) fd.append('pdf_password', input.pdf_password);
      return api<ImportResult>(`/api/statements/${statementId}/reimport`, {
        method: 'POST',
        body: fd,
      });
    },
    onSuccess: (data) => {
      qc.setQueryData(['statements', 'one', statementId], {
        statement: data.statement,
        transactions: data.transactions,
      });
      qc.invalidateQueries({ queryKey: ['statements'] });
    },
  });
}

export type TransactionUpdate = {
  id: string;
  conta_contabil: string | null;
  hist_code: string;
  hist_complemento: string;
  ignorado: boolean;
  origem_preenchimento: 'vazio' | 'manual' | 'regra' | 'memoria' | 'conferir';
};

export function useSaveTransactions(statementId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: TransactionUpdate[]) =>
      api<StatementDetail>(`/api/statements/${statementId}/transactions`, {
        method: 'PATCH',
        body: { updates },
      }),
    onSuccess: (data) => {
      qc.setQueryData(['statements', 'one', statementId], data);
      qc.invalidateQueries({ queryKey: ['statements'] });
    },
  });
}

export type DominioExport = { filename: string; linhas: number; sha256: string };

export function useGenerateDominio(statementId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<DominioExport> => {
      const { blob, filename, headers } = await apiDownload(
        `/api/statements/${statementId}/export`,
        { method: 'POST' },
      );
      saveBlob(blob, filename);
      return {
        filename,
        linhas: Number(headers.get('x-export-linhas') ?? 0),
        sha256: headers.get('x-export-sha256') ?? '',
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['statements'] });
    },
  });
}

export function useUpdateStatementHeader(statementId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: {
      banco_conta_contabil?: string;
      hist_code_entrada?: string;
      hist_code_saida?: string;
      lote_numero?: number;
      saldo_inicial?: string;
      complemento_modo?: 'extrato' | 'complemento' | 'ambos';
    }) =>
      api<{ statement: Statement }>(`/api/statements/${statementId}`, {
        method: 'PATCH',
        body: fields,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['statements'] });
    },
  });
}
