import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { moduleAtPath } from '@/lib/modules';
import { SidebarNav } from './Sidebar';

export function AppLayout() {
  const location = useLocation();
  const mod = moduleAtPath(location.pathname);
  const [menuOpen, setMenuOpen] = useState(false);

  // fecha a gaveta ao trocar de rota
  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen bg-cream">
      {/* sidebar fixa — desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 md:block">
        <SidebarNav />
      </aside>

      {/* topbar — mobile */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-brand-200 bg-cream/90 px-4 py-3 backdrop-blur md:hidden">
        <Link to="/" className="flex items-center gap-2 font-semibold text-slate-800">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-800 text-xs font-bold text-cream">
            FC
          </span>
          {mod ? mod.label : 'Facility Contábil'}
        </Link>
        <button
          onClick={() => setMenuOpen(true)}
          className="rounded-lg border border-brand-200 bg-white p-2 text-slate-700"
          aria-label="Abrir menu"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </header>

      {/* gaveta — mobile */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-brand-900/50"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-64 shadow-xl">
            <SidebarNav onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      )}

      <div className="md:pl-64">
        <main className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
