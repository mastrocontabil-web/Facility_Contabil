import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';
import { RequireAuth } from '@/auth/RequireAuth';
import { LoginPage } from '@/pages/LoginPage';
import { HubPage } from '@/pages/HubPage';
import { ClientsPage } from '@/features/clients/ClientsPage';
import { ImportPage } from '@/features/import/ImportPage';
import { ExcelImportPage } from '@/features/import/excel/ExcelImportPage';
import { RevisaoPage } from '@/features/revisao/RevisaoPage';
import { HistoricoPage } from '@/features/historico/HistoricoPage';
import { MemoriaPage } from '@/features/rules/MemoriaPage';
import { ClassificarPage } from '@/features/classificacao/ClassificarPage';
import { ClassificacaoRevisaoPage } from '@/features/classificacao/ClassificacaoRevisaoPage';
import { ClassificacaoHistoricoPage } from '@/features/classificacao/ClassificacaoHistoricoPage';
import { CategoriasPage } from '@/features/classificacao/CategoriasPage';
import { PlanoContasPage } from '@/features/contabil/PlanoContasPage';
import { HistoricosPadraoPage } from '@/features/contabil/HistoricosPadraoPage';
import { BalancetePage } from '@/features/contabil/BalancetePage';
import { LancamentosPage } from '@/features/contabil/LancamentosPage';
import { ModelosPage } from '@/features/contabil/ModelosPage';
import { RelatorioBalancetePage } from '@/features/contabil/RelatorioBalancetePage';
import { RelatorioDrePage } from '@/features/contabil/RelatorioDrePage';
import { RelatorioRazaoPage } from '@/features/contabil/RelatorioRazaoPage';
import { RelatorioLivroDiarioPage } from '@/features/contabil/RelatorioLivroDiarioPage';

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
        <Route path="/importar/excel" element={<ExcelImportPage />} />
        <Route path="/revisao/:id" element={<RevisaoPage />} />
        <Route path="/historico" element={<HistoricoPage />} />
        <Route path="/classificacao" element={<ClassificarPage />} />
        <Route path="/classificacao/revisao/:id" element={<ClassificacaoRevisaoPage />} />
        <Route path="/classificacao/historico" element={<ClassificacaoHistoricoPage />} />
        <Route path="/classificacao/categorias" element={<CategoriasPage />} />
        <Route path="/contabil/plano-de-contas" element={<PlanoContasPage />} />
        <Route path="/contabil/historicos" element={<HistoricosPadraoPage />} />
        <Route path="/contabil/balancete" element={<BalancetePage />} />
        <Route path="/contabil/lancamentos" element={<LancamentosPage />} />
        <Route path="/contabil/modelos" element={<ModelosPage />} />
        <Route path="/contabil/relatorios/balancete" element={<RelatorioBalancetePage />} />
        <Route path="/contabil/relatorios/dre" element={<RelatorioDrePage />} />
        <Route path="/contabil/relatorios/razao" element={<RelatorioRazaoPage />} />
        <Route path="/contabil/relatorios/livro-diario" element={<RelatorioLivroDiarioPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
