import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Direction, MappingRule } from '@/lib/types';

export function useRules(clientId: string | undefined) {
  return useQuery({
    queryKey: ['rules', clientId],
    queryFn: () => api<{ rules: MappingRule[] }>(`/api/rules?client_id=${clientId}`),
    select: (d) => d.rules,
    enabled: !!clientId,
  });
}

type RulePatch = {
  conta_contabil?: string | null;
  hist_code?: string | null;
  hist_complemento_template?: string | null;
  direction?: Direction;
  ativo?: boolean;
};

export function useUpdateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RulePatch }) =>
      api<{ rule: MappingRule }>(`/api/rules/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/api/rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  });
}
