import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { RequireAuth } from '@/auth/RequireAuth';
import { LoginPage } from '@/pages/LoginPage';
import { HubPage } from '@/pages/HubPage';
import { ClientsPage } from '@/features/clients/ClientsPage';
import { ImportPage } from '@/features/import/ImportPage';
import { RevisaoPage } from '@/features/revisao/RevisaoPage';
import { HistoricoPage } from '@/features/historico/HistoricoPage';
import { MemoriaPage } from '@/features/rules/MemoriaPage';
import { ClassificarPage } from '@/features/classificacao/ClassificarPage';
import { ClassificacaoRevisaoPage } from '@/features/classificacao/ClassificacaoRevisaoPage';
import { ClassificacaoHistoricoPage } from '@/features/classificacao/ClassificacaoHistoricoPage';
import { CategoriasPage } from '@/features/classificacao/CategoriasPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<HubPage />} />
        <Route path="/clientes" element={<ClientsPage />} />
        <Route path="/memoria" element={<MemoriaPage />} />
        <Route path="/importar" element={<ImportPage />} />
        <Route path="/revisao/:id" element={<RevisaoPage />} />
        <Route path="/historico" element={<HistoricoPage />} />
        <Route path="/classificacao" element={<ClassificarPage />} />
        <Route path="/classificacao/revisao/:id" element={<ClassificacaoRevisaoPage />} />
        <Route path="/classificacao/historico" element={<ClassificacaoHistoricoPage />} />
        <Route path="/classificacao/categorias" element={<CategoriasPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
