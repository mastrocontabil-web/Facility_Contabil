import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

type DeepHealth = {
  ok: boolean;
  checks: Record<string, { ok: boolean; detail?: string }>;
};

export function BackendStatus() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['health', 'deep'],
    queryFn: () => api<DeepHealth>('/api/health/deep'),
    refetchInterval: 30_000,
  });

  return (
    <div className="card p-4 text-sm">
      <p className="font-medium text-slate-700">Status dos serviços</p>
      {isLoading && <p className="mt-2 text-slate-400">verificando…</p>}
      {error && <p className="mt-2 text-red-600">backend inacessível</p>}
      {data && (
        <ul className="mt-2 space-y-1">
          {Object.entries(data.checks).map(([name, c]) => (
            <li key={name} className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${c.ok ? 'bg-green-500' : 'bg-red-500'}`}
              />
              <span className="text-slate-600">{name}</span>
              {c.detail && <span className="text-slate-400">— {c.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
