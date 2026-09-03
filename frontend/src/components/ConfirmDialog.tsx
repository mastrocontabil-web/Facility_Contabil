import { Modal } from './Modal';

export function ConfirmDialog({
  open,
  title = 'Confirmar',
  message,
  confirmLabel = 'Excluir',
  danger = true,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={busy ? () => {} : onCancel} title={title}>
      <p className="text-sm text-slate-600">{message}</p>
      {error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </button>
        <button
          className={danger ? 'btn bg-red-600 text-white hover:bg-red-700' : 'btn-primary'}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Excluindo…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
