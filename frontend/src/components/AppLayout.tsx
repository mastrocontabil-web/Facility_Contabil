import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';

const nav = [
  { to: '/clientes', label: 'Clientes' },
  { to: '/memoria', label: 'Memória' },
  { to: '/importar', label: 'Nova importação' },
  { to: '/historico', label: 'Histórico' },
];

export function AppLayout() {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="font-semibold text-slate-800">Extrato → Domínio</span>
            <nav className="flex gap-1">
              {nav.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) =>
                    `rounded-md px-3 py-1.5 text-sm font-medium ${
                      isActive
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`
                  }
                >
                  {n.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span className="hidden sm:inline">{user?.email}</span>
            <button className="btn-ghost px-3 py-1.5" onClick={() => void signOut()}>
              Sair
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
