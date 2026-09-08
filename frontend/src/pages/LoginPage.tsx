import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/auth/useAuth';
import { FinanceIllustration } from '@/components/FinanceIllustration';

export function LoginPage() {
  const { session, signIn } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session) {
    const to = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';
    return <Navigate to={to} replace />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao entrar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-cream lg:grid-cols-2">
      {/* painel da marca */}
      <div className="relative hidden flex-col overflow-hidden bg-brand-800 p-10 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-300 text-sm font-bold text-brand-900">
            FC
          </span>
          <span className="text-base font-semibold">Facility Contábil</span>
        </div>
        <div className="flex flex-1 items-center justify-center py-8">
          <FinanceIllustration className="w-full max-w-lg" />
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-white/55">
          Do extrato bancário ao arquivo do Domínio — importação, classificação e conferência
          num lugar só.
        </p>
      </div>

      {/* formulário */}
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-800 text-sm font-bold text-cream">
              FC
            </span>
            <span className="text-base font-semibold text-slate-800">Facility Contábil</span>
          </div>

          <h1 className="text-xl font-semibold text-slate-800">Entrar</h1>
          <p className="mt-1 text-sm text-slate-500">Use a conta do escritório.</p>

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label className="label" htmlFor="email">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                Senha
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
