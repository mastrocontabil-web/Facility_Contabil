import type { ComponentType, SVGProps } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { MODULES, moduleAtPath } from '@/lib/modules';
import { IconCadastros, IconClassificacao, IconContabil, IconImportacao, IconLogout } from './icons';

const MODULE_ICON: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  cadastros: IconCadastros,
  importacao: IconImportacao,
  classificacao: IconClassificacao,
  contabil: IconContabil,
};

/** Conteúdo da barra lateral — reaproveitado no fixo (desktop) e na gaveta (mobile). */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const activeMod = moduleAtPath(location.pathname);

  return (
    <div className="flex h-full flex-col bg-brand-800 text-white">
      <Link
        to="/"
        onClick={onNavigate}
        className="flex items-center gap-2.5 px-5 pb-4 pt-5 text-cream"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-300 text-sm font-bold text-brand-900">
          FC
        </span>
        <span className="text-[15px] font-semibold leading-tight">Facility Contábil</span>
      </Link>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {MODULES.map((m) => {
          const Icon = MODULE_ICON[m.id];
          const isActive = activeMod?.id === m.id;
          return (
            <div key={m.id}>
              <Link
                to={m.home}
                onClick={onNavigate}
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-brand-300 bg-white/[0.08] text-white'
                    : 'border-transparent text-white/60 hover:bg-white/[0.05] hover:text-white'
                }`}
              >
                {Icon && (
                  <Icon
                    className={`h-[19px] w-[19px] shrink-0 ${isActive ? 'text-brand-300' : ''}`}
                  />
                )}
                {m.label}
              </Link>

              {isActive && m.nav.length > 1 && (
                <div className="mb-1 mt-0.5 space-y-0.5 pb-1 pl-[38px] pr-1">
                  {m.nav.map((n) => (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end
                      onClick={onNavigate}
                      className={({ isActive: subActive }) =>
                        `block rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                          subActive
                            ? 'font-medium text-white'
                            : 'text-white/45 hover:text-white/80'
                        }`
                      }
                    >
                      {n.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-4 py-3">
        <p className="truncate px-1 pb-1.5 text-[11px] text-white/40">{user?.email}</p>
        <button
          onClick={() => void signOut()}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-white/70 transition-colors hover:bg-white/[0.05] hover:text-white"
        >
          <IconLogout className="h-[18px] w-[18px]" />
          Sair
        </button>
      </div>
    </div>
  );
}
