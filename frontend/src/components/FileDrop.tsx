import { useRef, useState } from 'react';

const ACCEPT = '.pdf,.ofx,.qfx,.csv,.txt,.xls,.xlsx';

export function FileDrop({
  file,
  onFile,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-8 text-center text-sm transition-colors ${
        over ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <div>
          <p className="font-medium text-slate-800">{file.name}</p>
          <p className="text-slate-400">{(file.size / 1024).toFixed(0)} KB — clique para trocar</p>
          <button
            type="button"
            className="mt-2 text-xs text-red-600 hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              onFile(null);
            }}
          >
            remover
          </button>
        </div>
      ) : (
        <div className="text-slate-500">
          <p className="font-medium">Arraste o extrato aqui ou clique para escolher</p>
          <p className="mt-1 text-xs">PDF, OFX, CSV, XLS ou XLSX</p>
        </div>
      )}
    </div>
  );
}
