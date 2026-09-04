import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { ApiError } from '@/lib/api';
import { useReimportStatement } from './api';

const ACCEPT = '.pdf,.ofx,.qfx,.csv,.txt,.xls,.xlsx';

/**
 * Troca o arquivo de uma importação existente. Substitui os lançamentos e volta
 * o extrato pra "em revisão". Cliente, lote e saldo inicial são mantidos.
 */
export function ReimportarExtrato({
  statementId,
  qtd,
  as = 'link',
}: {
  statementId: string;
  qtd: number;
  as?: 'link' | 'button';
}) {
  const navigate = useNavigate();
  const reimport = useReimportStatement(statementId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pdfPassword, setPdfPassword] = useState('');

  const isPdf = file?.name.toLowerCase().endsWith('.pdf');
  const err =
    reimport.error instanceof ApiError
      ? reimport.error.message +
        (reimport.error.details ? ` (${JSON.stringify(reimport.error.details)})` : '')
      : reimport.error
        ? String(reimport.error)
        : null;

  function fechar() {
    if (reimport.isPending) return;
    setFile(null);
    setPdfPassword('');
    reimport.reset();
  }

  function confirmar() {
    if (!file) return;
    reimport.mutate(
      { file, pdf_password: pdfPassword || undefined },
      { onSuccess: () => navigate(`/revisao/${statementId}`) },
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className={as === 'button' ? 'btn-ghost' : 'text-brand-600 hover:underline'}
        onClick={() => inputRef.current?.click()}
      >
        reimportar
      </button>

      <Modal open={!!file} onClose={fechar} title="Reimportar extrato">
        <p className="text-sm text-slate-600">
          Trocar pelo arquivo <span className="font-medium">"{file?.name}"</span>? Os{' '}
          <span className="font-medium">{qtd}</span> lançamento(s) atuais serão substituídos.
          Suas classificações se perdem — a memória do cliente reaplica o que puder.
        </p>

        {isPdf && (
          <div className="mt-3">
            <label className="label">Senha do PDF (se tiver)</label>
            <input
              className="input"
              type="password"
              value={pdfPassword}
              onChange={(e) => setPdfPassword(e.target.value)}
              placeholder="deixe em branco se não tem"
            />
          </div>
        )}

        {err && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={fechar} disabled={reimport.isPending}>
            Cancelar
          </button>
          <button
            className="btn bg-red-600 text-white hover:bg-red-700"
            onClick={confirmar}
            disabled={reimport.isPending}
          >
            {reimport.isPending ? 'Lendo…' : 'Reimportar'}
          </button>
        </div>
      </Modal>
    </>
  );
}
