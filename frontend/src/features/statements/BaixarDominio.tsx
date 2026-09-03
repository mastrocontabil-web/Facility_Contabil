import { ApiError } from '@/lib/api';
import { useGenerateDominio } from './api';

/** Botão "baixar" pro arquivo Domínio de uma importação já gerada. */
export function BaixarDominio({ statementId }: { statementId: string }) {
  const gerar = useGenerateDominio(statementId);
  const err =
    gerar.error instanceof ApiError ? gerar.error.message : gerar.error ? 'falhou' : null;

  return (
    <span className="inline-flex items-center gap-1">
      <button
        className="text-brand-600 hover:underline disabled:opacity-50"
        disabled={gerar.isPending}
        onClick={() => gerar.mutate()}
        title="Gera e baixa o .txt no Leiaute Domínio"
      >
        {gerar.isPending ? 'gerando…' : 'baixar'}
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </span>
  );
}
