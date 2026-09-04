import { Link } from 'react-router-dom';
import { MODULES } from '@/lib/modules';

export function HubPage() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">O que você quer fazer?</h1>
        <p className="mt-1 text-sm text-slate-500">Escolha um módulo pra continuar.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((m) => (
          <Link
            key={m.id}
            to={m.home}
            className="card flex flex-col gap-2 p-5 transition-colors hover:border-brand-300 hover:bg-brand-50/40"
          >
            <span className="text-base font-semibold text-slate-800">{m.label}</span>
            <span className="text-sm text-slate-500">{m.description}</span>
            <span className="mt-2 text-sm font-medium text-brand-600">Abrir →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
