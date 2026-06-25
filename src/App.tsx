/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Layout from './components/Layout';
import Documentos from './pages/Documentos';
import Chamados from './pages/Chamados';
import Treinamentos from './pages/Treinamentos';
import Financeiro from './pages/Financeiro';
import Indicadores from './pages/Indicadores';
import Comunicados from './pages/Comunicados';
import Auditorias from './pages/Auditorias';
import Biblioteca from './pages/Biblioteca';
import Contratos from './pages/Contratos';
import Qualificacao from './pages/qualificacao';
import Tabelas from './pages/Tabelas';
import Perfil from './pages/Perfil';
import Ferramentas from './pages/Ferramentas';
import EmConstrucao from './pages/EmConstrucao';
import Pesquisa from './pages/Pesquisa';
import Admin from './pages/Admin';
import Credenciamento from './pages/Credenciamento';
import Equipe from './pages/Equipe';
import Dispositivos from './pages/Dispositivos';
import EsqueciSenha from './pages/EsqueciSenha';
import DefinirSenha from './pages/DefinirSenha';

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/esqueci-senha" element={<EsqueciSenha />} />
        <Route path="/definir-senha" element={<DefinirSenha />} />
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="documentos" element={<Documentos />} />
          <Route path="chamados" element={<Chamados />} />
          <Route path="treinamentos" element={<Treinamentos />} />
          <Route path="financeiro" element={<Financeiro />} />
          <Route path="indicadores" element={<Indicadores />} />
          <Route path="comunicados" element={<Comunicados />} />
          <Route path="auditorias" element={<Auditorias />} />
          <Route path="biblioteca" element={<Biblioteca />} />
          <Route path="contratos" element={<Contratos />} />
          <Route path="qualificacao" element={<Qualificacao />} />
          <Route path="pesquisa" element={<Pesquisa />} />
          <Route path="admin" element={<Admin />} />
          <Route path="credenciamento" element={<Credenciamento />} />
          <Route path="equipe" element={<Equipe />} />
          <Route path="tabelas" element={<Tabelas />} />
          <Route path="perfil" element={<Perfil />} />
          <Route path="dispositivos" element={<Dispositivos />} />
          <Route path="ferramentas" element={<Ferramentas />} />
          <Route path="medicacoes" element={<EmConstrucao />} />
          <Route path="producao" element={<EmConstrucao />} />
          <Route path="agenda" element={<EmConstrucao />} />
          <Route path="*" element={<EmConstrucao />} />
        </Route>
      </Routes>
    </Router>
  );
}
