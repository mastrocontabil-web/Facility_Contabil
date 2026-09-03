import { useForm } from 'react-hook-form';
import type { Client, ClientInput } from '@/lib/types';
import { ApiError } from '@/lib/api';

type FormValues = {
  razao_social: string;
  cnpj: string;
  dominio_code: string;
  banco_conta_contabil: string;
  hist_code_entrada: string;
  hist_code_saida: string;
  conta_width: number;
  saldo_inicial: string;
  ativo: boolean;
  observacoes: string;
};

function toDefaults(c?: Client): FormValues {
  return {
    razao_social: c?.razao_social ?? '',
    cnpj: c?.cnpj ?? '',
    dominio_code: c?.dominio_code ?? '',
    banco_conta_contabil: c?.banco_conta_contabil ?? '',
    hist_code_entrada: c?.hist_code_entrada ?? '138',
    hist_code_saida: c?.hist_code_saida ?? '186',
    conta_width: c?.conta_width ?? 7,
    saldo_inicial: c ? String(Number(c.saldo_inicial ?? 0)).replace('.', ',') : '0',
    ativo: c?.ativo ?? true,
    observacoes: c?.observacoes ?? '',
  };
}

export function ClientForm({
  client,
  onSubmit,
  onCancel,
  submitting,
  error,
}: {
  client?: Client;
  onSubmit: (input: ClientInput) => void;
  onCancel: () => void;
  submitting: boolean;
  error?: unknown;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: toDefaults(client) });

  const submit = handleSubmit((v) => {
    onSubmit({
      razao_social: v.razao_social.trim(),
      cnpj: v.cnpj,
      dominio_code: v.dominio_code.trim(),
      banco_conta_contabil: v.banco_conta_contabil.trim() || null,
      hist_code_entrada: v.hist_code_entrada.trim() || '138',
      hist_code_saida: v.hist_code_saida.trim() || '186',
      conta_width: Number(v.conta_width) || 7,
      saldo_inicial: v.saldo_inicial.trim() || '0',
      ativo: v.ativo,
      observacoes: v.observacoes.trim() || null,
    });
  });

  const apiMsg =
    error instanceof ApiError
      ? `${error.message}${error.details ? ` — ${JSON.stringify(error.details)}` : ''}`
      : error
        ? String(error)
        : null;

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label">Razão social</label>
        <input className="input" {...register('razao_social', { required: true, minLength: 2 })} />
        {errors.razao_social && <p className="mt-1 text-xs text-red-600">obrigatório</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">CNPJ / CPF</label>
          <input
            className="input"
            placeholder="00.000.000/0000-00"
            {...register('cnpj', { required: true })}
          />
        </div>
        <div>
          <label className="label">Código no Domínio</label>
          <input
            className="input"
            placeholder="168"
            inputMode="numeric"
            {...register('dominio_code', { required: true, pattern: /^\d{1,7}$/ })}
          />
          {errors.dominio_code && (
            <p className="mt-1 text-xs text-red-600">só números, até 7 dígitos</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="label">Conta contábil do banco (padrão)</label>
          <input
            className="input"
            placeholder="ex: 10002 — pode deixar em branco"
            {...register('banco_conta_contabil')}
          />
        </div>
        <div>
          <label className="label">Saldo inicial da conta bancária</label>
          <input
            className="input"
            inputMode="decimal"
            placeholder="0,00"
            {...register('saldo_inicial')}
          />
          <p className="mt-1 text-xs text-slate-400">
            usado na conferência do saldo ao importar o extrato
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="label">Cód. histórico entrada</label>
          <input className="input" inputMode="numeric" {...register('hist_code_entrada')} />
        </div>
        <div>
          <label className="label">Cód. histórico saída</label>
          <input className="input" inputMode="numeric" {...register('hist_code_saida')} />
        </div>
        <div>
          <label className="label">Dígitos da conta</label>
          <input
            className="input"
            type="number"
            min={1}
            max={20}
            {...register('conta_width', { valueAsNumber: true })}
          />
        </div>
      </div>

      <div>
        <label className="label">Observações</label>
        <textarea className="input" rows={2} {...register('observacoes')} />
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" {...register('ativo')} />
        Cliente ativo
      </label>

      {apiMsg && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{apiMsg}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Salvando…' : client ? 'Salvar' : 'Cadastrar'}
        </button>
      </div>
    </form>
  );
}
