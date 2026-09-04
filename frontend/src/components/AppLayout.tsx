import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { moduleAtPath } from '@/lib/modules';

export function AppLayout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const mod = moduleAtPath(location.pathname);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Link to="/" className="shrink-0 font-semibold text-slate-800">
              Facility Contábil
            </Link>
            {mod && (
              <>
                <span className="shrink-0 text-slate-300">/</span>
                <span className="shrink-0 text-sm font-medium text-slate-500">{mod.label}</span>
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3 text-sm text-slate-500">
            <span className="hidden md:inline">{user?.email}</span>
            <button className="btn-ghost px-3 py-1.5" onClick={() => void signOut()}>
              Sair
            </button>
          </div>
        </div>
        {mod && mod.nav.length > 1 && (
          <div className="mx-auto max-w-6xl px-4 pb-2">
            <nav className="flex min-w-0 gap-1 overflow-x-auto">
              {mod.nav.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end
                  className={({ isActive }) =>
                    `shrink-0 rounded-md px-3 py-1.5 text-sm font-medium ${
                      isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                    }`
                  }
                >
                  {n.label}
                </NavLink>
              ))}
            </nav>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
