import { Link } from 'react-router-dom';
import { MODULES } from '@/lib/modules';
import { FinanceIllustration } from '@/components/FinanceIllustration';

function saudacao(d = new Date()) {
  const h = d.getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function HubPage() {
  return (
    <section className="flex min-h-[calc(100vh-8rem)] flex-col justify-center gap-10 lg:flex-row lg:items-center lg:gap-8">
      <div className="max-w-md shrink-0">
        <p className="text-sm font-medium uppercase tracking-wide text-brand-500">{saudacao()}</p>
        <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-800 sm:text-4xl">
          Facility Contábil
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-slate-500">
          Otimize a sua gestão: transforme o extrato bancário em lançamentos para o Domínio com
          classificações automáticas.
        </p>
        <p className="mt-4 text-sm text-slate-400">
          Escolha um módulo na barra lateral para iniciar.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          {MODULES.map((m) => (
            <Link
              key={m.id}
              to={m.home}
              className="group flex items-center justify-between rounded-xl border border-brand-200 bg-white px-4 py-3 text-sm transition-colors hover:border-brand-300 hover:bg-brand-50"
            >
              <span className="font-medium text-slate-800">{m.label}</span>
              <span className="text-brand-500 transition-transform group-hover:translate-x-0.5">→</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <FinanceIllustration className="mx-auto w-full max-w-xl" />
      </div>
    </section>
  );
}
