import React, { useState, useEffect } from 'react';
import { fetchApi } from '../lib/api';
import ImportRoteiroModal from './qualificacao/ImportRoteiroModal';
import RoteiroAlerts from './qualificacao/RoteiroAlerts';
import ConfirmDeleteRoteiroModal from './qualificacao/ConfirmDeleteRoteiroModal';
import {
  Users, 
  GraduationCap, 
  Megaphone, 
  Image as ImageIcon,
  Search,
  Plus,
  Filter,
  MoreVertical,
  Building2,
  Stethoscope,
  Microscope,
  Activity,
  UserPlus,
  Settings,
  ClipboardList,
  Save,
  X,
  CheckCircle,
  Trash2,
  Mail,
  ShieldCheck,
  XCircle,
  LayoutGrid,
  List
} from 'lucide-react';

const TABS = [
  { id: 'prestadores', label: 'Rede de Prestadores', icon: Users },
  { id: 'roteiros', label: 'Roteiros de Avaliação', icon: CheckCircle },
  { id: 'treinamentos', label: 'Cursos e Treinamentos', icon: GraduationCap },
  { id: 'comunicados', label: 'Comunicados', icon: Megaphone },
  { id: 'emails', label: 'Disparo de E-mails', icon: Mail },
  { id: 'banners', label: 'Banners', icon: ImageIcon },
  { id: 'pesquisas', label: 'Pesquisas', icon: ClipboardList },
  { id: 'acessos', label: 'Trilha de Acesso', icon: ShieldCheck },
  { id: 'configuracoes', label: 'Configurações', icon: Settings },
];

// Dados fictícios baseados nas informações fornecidas
const STATS = [
  { label: 'Total de Prestadores', value: '669', icon: Building2, color: 'bg-blue-500' },
  { label: 'Médicos Cooperados', value: '456', icon: Stethoscope, color: 'bg-[#00995D]' },
  { label: 'Médicos Credenciados', value: '35', icon: UserPlus, color: 'bg-teal-500' },
  { label: 'Recursos Próprios', value: '25', icon: Activity, color: 'bg-orange-500' },
  { label: 'Clínicas Médicas', value: '39', icon: Building2, color: 'bg-indigo-500' },
  { label: 'Prof. Não Médicos e Clin. Multi', value: '74', icon: Users, color: 'bg-purple-500' },
  { label: 'Laboratórios/Anátomos', value: '20', icon: Microscope, color: 'bg-pink-500' },
];

const PRESTADORES_MOCK = [
  { id: 1, nome: 'Dr. Carlos Eduardo Silva', tipo: 'Médico Cooperado', especialidade: 'Cardiologia', status: 'Ativo' },
  { id: 2, nome: 'Dra. Ana Paula Mendes', tipo: 'Médico Cooperado', especialidade: 'Pediatria', status: 'Ativo' },
  { id: 3, nome: 'Clínica São João', tipo: 'Clínica Médica', especialidade: 'Multidisciplinar', status: 'Ativo' },
  { id: 4, nome: 'Laboratório Vida e Saúde', tipo: 'Laboratório', especialidade: 'Análises Clínicas', status: 'Ativo' },
  { id: 5, nome: 'Dr. Roberto Alves', tipo: 'Médico Credenciado', especialidade: 'Ortopedia', status: 'Afastado' },
  { id: 6, nome: 'Centro de Imagem Criciúma', tipo: 'Clínica de Imagem', especialidade: 'Radiologia', status: 'Ativo' },
  { id: 7, nome: 'Dra. Juliana Costa', tipo: 'Médico Cooperado', especialidade: 'Ginecologia e Obstetrícia', status: 'Ativo' },
  { id: 8, nome: 'Hospital São José', tipo: 'Hospital', especialidade: 'Geral', status: 'Ativo' },
];

export default function Admin() {
  const [activeTab, setActiveTab] = useState('prestadores');
  const [searchTerm, setSearchTerm] = useState('');
  const [user, setUser] = useState<any>(null);
  
  const [providers, setProviders] = useState<any[]>([]);
  const [scripts, setScripts] = useState<any[]>([]);
  const [trainings, setTrainings] = useState<any[]>([]);
  const [surveys, setSurveys] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({ current_competence: '', payment_date: '' });
  const [accessLogs, setAccessLogs] = useState<any[]>([]);
  const [accessTotal, setAccessTotal] = useState(0);
  const [accessFilter, setAccessFilter] = useState<'all' | 'true' | 'false'>('all');
  const [loading, setLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Modals
  const [showProviderModal, setShowProviderModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [viewMode, setViewMode] = useState<'cards' | 'lista'>(
    () => (localStorage.getItem('roteirosViewMode') as 'cards' | 'lista') || 'cards',
  );
  const [showTrainingModal, setShowTrainingModal] = useState(false);
  const [revisoesAbertas, setRevisoesAbertas] = useState<Record<string, boolean>>({});

  // Provider Form
  const [providerForm, setProviderForm] = useState({ name: '', cnpj: '', code: '', provider_group: '', provider_type: '', area_atuacao: '', qualification_level: '', status: 'Ativo' });

  // Training Form
  const [trainingForm, setTrainingForm] = useState({ title: '', description: '', video_url: '', pdf_url: '', target_audience: 'geral', target_provider_id: '' });

  // Announcement Form
  const [announcementForm, setAnnouncementForm] = useState({ title: '', category: 'Avisos Gerais', target_audience: 'geral', target_provider_id: '', content: '', image_url: '' });

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  useEffect(() => {
    if (user && (user.role === 'admin' || user.role === 'auditoria')) {
      loadData();
    }
  }, [user, activeTab, accessFilter]);

  useEffect(() => {
    localStorage.setItem('roteirosViewMode', viewMode);
  }, [viewMode]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'prestadores') {
        const data = await fetchApi('/providers');
        setProviders(data);
      } else if (activeTab === 'roteiros') {
        const data = await fetchApi('/eval/scripts');
        setScripts(data);
      } else if (activeTab === 'treinamentos') {
        const data = await fetchApi('/trainings');
        setTrainings(data);
      } else if (activeTab === 'pesquisas') {
        const data = await fetchApi('/surveys');
        setSurveys(data);
      } else if (activeTab === 'configuracoes') {
        const data = await fetchApi('/settings');
        setSettings(data);
      } else if (activeTab === 'acessos') {
        const qs = accessFilter === 'all' ? '' : `?success=${accessFilter}`;
        const data = await fetchApi(`/access-logs${qs}`);
        setAccessLogs(data.logs || []);
        setAccessTotal(data.total || 0);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await fetchApi('/settings', {
        method: 'POST',
        body: JSON.stringify(settings)
      });
      alert('Configurações salvas com sucesso!');
    } catch (err: any) {
      alert(err.message || 'Erro ao salvar configurações');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleCreateProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetchApi('/providers', {
        method: 'POST',
        body: JSON.stringify(providerForm)
      });
      setShowProviderModal(false);
      setProviderForm({ name: '', cnpj: '', code: '', provider_group: '', provider_type: '', area_atuacao: '', qualification_level: '', status: 'Ativo' });
      loadData();
    } catch (err: any) {
      alert(err.message || 'Erro ao criar prestador');
    }
  };

  const handleDeleteScript = async (script: any) => {
    // Roteiro já usado em avaliações: exige confirmação forte (modal).
    if (Number(script?.usage_count ?? 0) > 0) {
      setDeleteTarget(script);
      return;
    }
    if (!window.confirm('Tem certeza que deseja excluir este roteiro?')) return;
    try {
      await fetchApi(`/eval/scripts/${script.id}`, { method: 'DELETE' });
      loadData();
    } catch (err: any) {
      alert(err.message || 'Erro ao excluir roteiro');
    }
  };

  const confirmDeleteScript = async () => {
    if (!deleteTarget) return;
    try {
      await fetchApi(`/eval/scripts/${deleteTarget.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirm: 'excluir roteiro' }),
      });
      setDeleteTarget(null);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Erro ao excluir roteiro');
    }
  };

  const handleCreateTraining = async (e: React.FormEvent) => {
    e.preventDefault();
    let target_type = 'geral';
    let target_group = null;
    if (trainingForm.target_audience.startsWith('grupo_')) {
      target_type = 'grupo';
      target_group = trainingForm.target_audience.replace('grupo_', '');
    } else if (trainingForm.target_audience === 'especifico') {
      target_type = 'especifico';
    }

    try {
      await fetchApi('/trainings', {
        method: 'POST',
        body: JSON.stringify({
          ...trainingForm,
          target_type,
          target_group,
          target_provider_id: trainingForm.target_provider_id || null
        })
      });
      setShowTrainingModal(false);
      setTrainingForm({ title: '', description: '', video_url: '', pdf_url: '', target_audience: 'geral', target_provider_id: '' });
      loadData();
    } catch (err: any) {
      alert(err.message || 'Erro ao criar treinamento');
    }
  };

  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    let target_type = 'geral';
    let target_group = null;
    if (announcementForm.target_audience.startsWith('grupo_')) {
      target_type = 'grupo';
      target_group = announcementForm.target_audience.replace('grupo_', '');
    } else if (announcementForm.target_audience === 'especifico') {
      target_type = 'especifico';
    }

    try {
      await fetchApi('/announcements', {
        method: 'POST',
        body: JSON.stringify({
          title: announcementForm.title,
          description: announcementForm.content,
          category: announcementForm.category,
          image_url: announcementForm.image_url,
          date: new Date().toISOString(),
          target_type,
          target_group,
          target_provider_id: announcementForm.target_provider_id || null
        })
      });
      setAnnouncementForm({ title: '', category: 'Avisos Gerais', target_audience: 'geral', target_provider_id: '', content: '', image_url: '' });
      alert('Comunicado publicado com sucesso!');
      loadData();
    } catch (err: any) {
      alert(err.message || 'Erro ao publicar comunicado');
    }
  };

  const handleDeleteTraining = async (id: number) => {
    if (!window.confirm('Tem certeza que deseja excluir este material?')) return;
    try {
      await fetchApi(`/trainings/${id}`, { method: 'DELETE' });
      loadData();
    } catch (err: any) {
      alert(err.message || 'Erro ao excluir material');
    }
  };

  const isAdmin = user?.role === 'admin' || user?.role === 'auditoria';

  const uniqueGroups = Array.from(new Set(providers.map(p => p.provider_group).filter(Boolean)));

  if (user && !isAdmin) {
    return (
      <div className="max-w-7xl mx-auto space-y-6 text-center py-12">
        <h1 className="text-2xl font-bold text-gray-800">Acesso Negado</h1>
        <p className="text-gray-500">Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Administração</h1>
          <p className="text-gray-500">Gerencie a rede de prestadores, conteúdos e comunicações.</p>
        </div>
        
        {activeTab === 'prestadores' && (
          <button 
            onClick={() => setShowProviderModal(true)}
            className="flex items-center gap-2 bg-[#00995D] text-white px-4 py-2 rounded-lg hover:bg-[#007A4A] transition-colors"
          >
            <Plus className="w-5 h-5" />
            <span>Novo Prestador</span>
          </button>
        )}
        {activeTab === 'roteiros' && (
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-2 bg-[#00995D] text-white px-4 py-2 rounded-lg hover:bg-[#007A4A] transition-colors"
          >
            <Plus className="w-5 h-5" />
            <span>Novo Roteiro</span>
          </button>
        )}
        {activeTab === 'treinamentos' && (
          <button 
            onClick={() => setShowTrainingModal(true)}
            className="flex items-center gap-2 bg-[#00995D] text-white px-4 py-2 rounded-lg hover:bg-[#007A4A] transition-colors"
          >
            <Plus className="w-5 h-5" />
            <span>Novo Material</span>
          </button>
        )}
        {activeTab !== 'prestadores' && activeTab !== 'roteiros' && activeTab !== 'treinamentos' && activeTab !== 'configuracoes' && activeTab !== 'pesquisas' && (
          <button className="flex items-center gap-2 bg-[#00995D] text-white px-4 py-2 rounded-lg hover:bg-[#007A4A] transition-colors">
            <Plus className="w-5 h-5" />
            <span>Adicionar Novo</span>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-2">
        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium transition-all text-sm ${
                  isActive 
                    ? 'bg-[#00995D] text-white shadow-sm' 
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 border border-transparent hover:border-gray-200'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-gray-400'}`} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        {activeTab === 'prestadores' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
              <h2 className="text-lg font-bold text-gray-800">Visão Geral da Rede (Janeiro a Outubro de 2025)</h2>
            </div>
            
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {STATS.map((stat, index) => {
                const Icon = stat.icon;
                return (
                  <div key={index} className="bg-gray-50 rounded-xl p-4 border border-gray-100 flex items-center gap-4">
                    <div className={`p-3 rounded-lg text-white ${stat.color}`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 font-medium">{stat.label}</p>
                      <p className="text-2xl font-bold text-gray-800">{stat.value}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-6">
              <div className="relative w-full md:w-96">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  placeholder="Buscar prestador, clínica ou médico..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00995D]/20 focus:border-[#00995D]"
                />
              </div>
              <button className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors w-full md:w-auto">
                <Filter className="w-5 h-5" />
                <span>Filtros</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 text-sm text-gray-500">
                    <th className="pb-3 font-medium">Nome</th>
                    <th className="pb-3 font-medium">CNPJ</th>
                    <th className="pb-3 font-medium">Código</th>
                    <th className="pb-3 font-medium">Tipo (SGU)</th>
                    <th className="pb-3 font-medium">Nível Qualificação</th>
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 font-medium text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {providers.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.cnpj.includes(searchTerm) || (p.code && p.code.includes(searchTerm))).map((prestador) => (
                    <tr key={prestador.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="py-4 font-medium text-gray-800">{prestador.name}</td>
                      <td className="py-4 text-gray-600">{prestador.cnpj}</td>
                      <td className="py-4 text-gray-600">{prestador.code || '-'}</td>
                      <td className="py-4 text-gray-600">{prestador.provider_type || '-'}</td>
                      <td className="py-4 text-gray-600">{prestador.qualification_level || '-'}</td>
                      <td className="py-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                          prestador.status === 'Ativo' 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {prestador.status}
                        </span>
                      </td>
                      <td className="py-4 text-right">
                        <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600">
                          <MoreVertical className="w-5 h-5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {providers.length === 0 && !loading && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-gray-500">Nenhum prestador encontrado.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            
            <div className="flex items-center justify-between mt-4 text-sm text-gray-500">
              <p>Mostrando {providers.length} prestadores</p>
            </div>
          </div>
        )}

        {activeTab === 'roteiros' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
              <h2 className="text-lg font-bold text-gray-800">Roteiros de Especialidade</h2>
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`p-2 rounded-md transition-colors ${viewMode === 'cards' ? 'bg-white shadow-sm text-[#00995D]' : 'text-gray-500'}`}
                  title="Ver como cards"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('lista')}
                  className={`p-2 rounded-md transition-colors ${viewMode === 'lista' ? 'bg-white shadow-sm text-[#00995D]' : 'text-gray-500'}`}
                  title="Ver como lista"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>

            {scripts.length === 0 && !loading && (
              <div className="text-center py-12 bg-gray-50 rounded-xl border border-gray-100">
                <ClipboardList className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-1">Nenhum roteiro cadastrado</h3>
                <p className="text-gray-500">Clique em "Novo Roteiro" para subir uma planilha (.xlsx).</p>
              </div>
            )}

            {viewMode === 'cards' && scripts.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {agruparPorRoteiro(scripts).map(({ key, vigente, anteriores }) => (
                  <div key={key} className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                    <div className="flex justify-between items-start mb-3">
                      <h3 className="text-lg font-bold text-gray-900">{vigente.title}</h3>
                      <button
                        onClick={() => handleDeleteScript(vigente)}
                        className="text-red-500 hover:text-red-700 p-1"
                        title="Excluir roteiro"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="flex flex-col gap-1 items-start mb-4">
                      <RevisaoBadge script={vigente} />
                      <RoteiroDatas script={vigente} />
                    </div>
                    <div className="mb-4">
                      <RoteiroAlerts alerts={vigente.alerts} />
                    </div>
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-gray-700">Itens do Checklist ({vigente.items.length}):</p>
                      <ul className="space-y-2">
                        {vigente.items.slice(0, 3).map((item: any) => (
                          <li key={item.id} className="text-sm text-gray-600 flex items-start gap-2">
                            <CheckCircle className="w-4 h-4 text-[#00995D] mt-0.5 flex-shrink-0" />
                            <span>{item.title}</span>
                          </li>
                        ))}
                        {vigente.items.length > 3 && (
                          <li className="text-sm text-gray-500 italic">+ {vigente.items.length - 3} outros itens...</li>
                        )}
                      </ul>
                    </div>
                    {anteriores.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <button
                          type="button"
                          onClick={() => setRevisoesAbertas((m) => ({ ...m, [key]: !m[key] }))}
                          className="text-xs text-blue-600 hover:underline"
                        >
                          {revisoesAbertas[key] ? '▾ ocultar' : '▸ ver'} revisões anteriores ({anteriores.length})
                        </button>
                        {revisoesAbertas[key] && (
                          <ul className="mt-3 space-y-2">
                            {anteriores.map((ant: any) => {
                              const revDate = formatBRDate(ant.revisao_date);
                              return (
                              <li key={ant.id} className="flex items-center justify-between gap-2 text-xs text-gray-500">
                                <span>
                                  Revisão {ant.version ?? '?'}
                                  {revDate ? ` — rev. ${revDate}` : ''}
                                </span>
                                <button
                                  onClick={() => handleDeleteScript(ant)}
                                  className="text-red-500 hover:text-red-700 p-1 flex-shrink-0"
                                  title="Excluir revisão"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {viewMode === 'lista' && scripts.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-100 text-sm text-gray-500">
                      <th className="pb-3 pr-4 font-medium text-left">Roteiro</th>
                      <th className="pb-3 pr-4 font-medium w-48 text-left whitespace-nowrap">Revisão</th>
                      <th className="pb-3 pr-4 font-medium w-28 text-left whitespace-nowrap">Implantação</th>
                      <th className="pb-3 pr-4 font-medium w-20 text-left whitespace-nowrap">Critérios</th>
                      <th className="pb-3 pr-4 font-medium w-40 text-left whitespace-nowrap">Alertas</th>
                      <th className="pb-3 font-medium text-left w-16 whitespace-nowrap">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {agruparPorRoteiro(scripts).map(({ key, vigente, anteriores }) => (
                      <React.Fragment key={key}>
                        <tr className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                          <td className="py-4 pr-4 align-top font-medium text-gray-800">
                            {vigente.title}
                            {anteriores.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setRevisoesAbertas((m) => ({ ...m, [key]: !m[key] }))}
                                className="block mt-1 text-xs text-blue-600 hover:underline"
                              >
                                {revisoesAbertas[key] ? '▾ ocultar' : '▸ ver'} revisões anteriores ({anteriores.length})
                              </button>
                            )}
                          </td>
                          <td className="py-4 pr-4 align-top">
                            <div className="flex flex-col gap-1 items-start">
                              <RevisaoBadge script={vigente} />
                              <RoteiroDatas script={vigente} />
                            </div>
                          </td>
                          <td className="py-4 pr-4 align-top text-center text-gray-600">{formatBRDate(vigente.implantacao_date) ?? '—'}</td>
                          <td className="py-4 pr-4 align-top text-center text-gray-600">{vigente.items.length}</td>
                          <td className="py-4 pr-4 align-top"><RoteiroAlerts alerts={vigente.alerts} /></td>
                          <td className="py-4 align-top text-center">
                            <button onClick={() => handleDeleteScript(vigente)} className="text-red-500 hover:text-red-700 p-1" title="Excluir roteiro">
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </td>
                        </tr>
                        {revisoesAbertas[key] && anteriores.map((ant: any) => (
                          <tr key={ant.id} className="border-b border-gray-50 bg-gray-50/40 text-gray-500">
                            <td className="py-3 pr-4 pl-6 align-top text-sm">{ant.title}</td>
                            <td className="py-3 pr-4 align-top">
                              <div className="flex flex-col gap-1 items-start">
                                <RevisaoBadge script={ant} />
                                <RoteiroDatas script={ant} />
                              </div>
                            </td>
                            <td className="py-3 pr-4 align-top text-center">{formatBRDate(ant.implantacao_date) ?? '—'}</td>
                            <td className="py-3 pr-4 align-top text-center">{ant.items.length}</td>
                            <td className="py-3 pr-4 align-top"><RoteiroAlerts alerts={ant.alerts} /></td>
                            <td className="py-3 align-top text-center">
                              <button onClick={() => handleDeleteScript(ant)} className="text-red-500 hover:text-red-700 p-1" title="Excluir revisão">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'treinamentos' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
              <h2 className="text-lg font-bold text-gray-800">Materiais de Apoio e Treinamentos</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {trainings.map(training => (
                <div key={training.id} className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm flex flex-col">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-gray-900 line-clamp-2">{training.title}</h3>
                      {training.target_type && training.target_type !== 'geral' && (
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800 mt-1 inline-block">
                          {training.target_type === 'grupo' ? `Grupo: ${training.target_group}` : 'Específico'}
                        </span>
                      )}
                    </div>
                    <button 
                      onClick={() => handleDeleteTraining(training.id)}
                      className="text-red-500 hover:text-red-700 p-1 flex-shrink-0"
                      title="Excluir material"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                  <p className="text-sm text-gray-600 mb-4 flex-1 line-clamp-3">{training.description}</p>
                  
                  <div className="space-y-2 mt-auto pt-4 border-t border-gray-100">
                    {training.video_url && (
                      <a href={training.video_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-[#00995D] hover:underline">
                        <Activity className="w-4 h-4" />
                        Ver Vídeo
                      </a>
                    )}
                    {training.pdf_url && (
                      <a href={training.pdf_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-[#00995D] hover:underline">
                        <ClipboardList className="w-4 h-4" />
                        Ver Material (PDF)
                      </a>
                    )}
                    {!training.video_url && !training.pdf_url && (
                      <span className="text-sm text-gray-400 italic">Nenhum anexo</span>
                    )}
                  </div>
                </div>
              ))}
              {trainings.length === 0 && !loading && (
                <div className="col-span-full text-center py-12 bg-gray-50 rounded-xl border border-gray-100">
                  <GraduationCap className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-1">Nenhum material cadastrado</h3>
                  <p className="text-gray-500">Adicione materiais de apoio ou treinamentos para a rede de prestadores.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'emails' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
              <h2 className="text-lg font-bold text-gray-800">Disparo de E-mails Automáticos</h2>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200">
              <h3 className="text-md font-bold text-gray-800 mb-4 border-b pb-2">Novo Disparo</h3>
              
              <form onSubmit={(e) => { e.preventDefault(); alert('E-mail enviado com sucesso! (Simulação)'); }} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Público-Alvo</label>
                    <select 
                      className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2 border"
                    >
                      <option value="todos">Todos os Prestadores</option>
                      <option value="grupo_medicos">Grupo: Médicos Cooperados</option>
                      <option value="grupo_clinicas">Grupo: Clínicas</option>
                      <option value="vencimento_docs">Prestadores com Documentos a Vencer (30 dias)</option>
                      <option value="especifico">Usuário Específico</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Assunto do E-mail</label>
                    <input 
                      type="text" 
                      required
                      placeholder="Ex: Aviso de Vencimento de Documento"
                      className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2 border"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Conteúdo da Mensagem</label>
                  <textarea 
                    required
                    rows={6}
                    placeholder="Digite a mensagem que será enviada..."
                    className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2 border"
                  ></textarea>
                </div>

                <div className="pt-4 flex justify-end">
                  <button type="submit" className="flex items-center gap-2 bg-[#00995D] text-white px-6 py-2 rounded-lg hover:bg-[#007A4A] transition-colors">
                    <Mail className="w-4 h-4" />
                    Enviar E-mail
                  </button>
                </div>
              </form>
            </div>
            
            <div className="bg-white p-6 rounded-xl border border-gray-200">
              <h3 className="text-md font-bold text-gray-800 mb-4 border-b pb-2">Histórico de Disparos</h3>
              <div className="text-center text-gray-500 py-8">
                Nenhum e-mail disparado recentemente.
              </div>
            </div>
          </div>
        )}

        {activeTab === 'comunicados' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
              <h2 className="text-lg font-bold text-gray-800">Gerenciar Comunicados</h2>
              <button className="flex items-center gap-2 bg-[#00995D] text-white px-4 py-2 rounded-lg hover:bg-[#007A4A] transition-colors">
                <Plus className="w-5 h-5" />
                <span>Novo Comunicado</span>
              </button>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200">
              <h3 className="text-md font-bold text-gray-800 mb-4 border-b pb-2">Criar Novo Comunicado</h3>
              
              <form onSubmit={handleCreateAnnouncement} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Título do Comunicado</label>
                  <input 
                    type="text" 
                    required
                    value={announcementForm.title}
                    onChange={e => setAnnouncementForm({...announcementForm, title: e.target.value})}
                    placeholder="Ex: Atualização do Manual de Faturamento"
                    className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2 border"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Imagem de Capa</label>
                  <input 
                    type="file" 
                    accept="image/*"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          setAnnouncementForm({...announcementForm, image_url: reader.result as string});
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                    className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2 border"
                  />
                  {announcementForm.image_url && (
                    <div className="mt-2">
                      <img src={announcementForm.image_url} alt="Preview" className="h-20 object-cover rounded" />
                    </div>
                  )}
                  <p className="text-xs text-gray-500 mt-1">Selecione uma imagem do seu computador para a capa do comunicado.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
                  <select 
                    value={announcementForm.category}
                    onChange={e => setAnnouncementForm({...announcementForm, category: e.target.value})}
                    className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2 border"
                  >
                    <option value="Avisos Gerais">Avisos Gerais</option>
                    <option value="Faturamento">Faturamento</option>
                    <option value="Auditoria">Auditoria</option>
                    <option value="Qualificação">Qualificação</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Segmentação de Público</label>
                  <select 
                    value={announcementForm.target_audience}
                    onChange={e => setAnnouncementForm({...announcementForm, target_audience: e.target.value})}
                    className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2 border mb-2"
                  >
                    <option value="geral">Geral (Todos os prestadores)</option>
                    {uniqueGroups.length > 0 && (
                      <optgroup label="Grupos Específicos">
                        {uniqueGroups.map((group: any) => (
                          <option key={group} value={`grupo_${group}`}>Grupo: {group}</option>
                        ))}
                      </optgroup>
                    )}
                    <option value="especifico">Específico (Prestador individual)</option>
                  </select>
                  
                  {announcementForm.target_audience === 'especifico' && (
                    <select
                      required
                      value={announcementForm.target_provider_id}
                      onChange={e => setAnnouncementForm({...announcementForm, target_provider_id: e.target.value})}
                      className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2 border mb-2"
                    >
                      <option value="">Selecione o prestador...</option>
                      {providers.map(p => (
                        <option key={p.id} value={p.id}>{p.name} ({p.cnpj})</option>
                      ))}
                    </select>
                  )}
                  
                  <p className="text-xs text-gray-500">Selecione quem receberá este comunicado e a notificação por e-mail.</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Conteúdo</label>
                  <textarea 
                    rows={4}
                    required
                    value={announcementForm.content}
                    onChange={e => setAnnouncementForm({...announcementForm, content: e.target.value})}
                    placeholder="Digite a mensagem do comunicado..."
                    className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2 border"
                  ></textarea>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <input type="checkbox" id="sendEmail" className="rounded text-[#00995D] focus:ring-[#00995D]" defaultChecked />
                  <label htmlFor="sendEmail" className="text-sm text-gray-700">Enviar notificação por e-mail para os usuários selecionados</label>
                </div>
                
                <div className="pt-4 flex justify-end">
                  <button type="submit" className="flex items-center gap-2 bg-[#00995D] text-white px-6 py-2 rounded-lg hover:bg-[#007A4A] transition-colors">
                    <Megaphone className="w-4 h-4" />
                    Publicar Comunicado
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {activeTab === 'banners' && (
          <div className="text-center py-12">
            <div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <ImageIcon className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-2">Gerenciar Banners</h3>
            <p className="text-gray-500 mb-6 max-w-md mx-auto">
              Atualize os banners da página inicial do portal dos prestadores.
            </p>
            <button className="bg-[#00995D] text-white px-6 py-2.5 rounded-lg hover:bg-[#007A4A] transition-colors font-medium">
              Adicionar Banner
            </button>
          </div>
        )}

        {activeTab === 'pesquisas' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
              <h2 className="text-lg font-bold text-gray-800">Gestão de Respostas - Pesquisa de Qualificação</h2>
            </div>
            
            {surveys.length === 0 ? (
              <div className="bg-gray-50 p-8 rounded-xl border border-gray-100 text-center">
                <ClipboardList className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-gray-800 mb-2">Nenhuma resposta recente</h3>
                <p className="text-gray-500 max-w-md mx-auto">
                  As respostas dos prestadores aparecerão aqui assim que a pesquisa for respondida.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {surveys.map((survey) => (
                  <div key={survey.id} className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                    <div className="flex justify-between items-start mb-4 border-b pb-4">
                      <div>
                        <h3 className="font-bold text-gray-900">{survey.provider_name}</h3>
                        <p className="text-sm text-gray-500">CNPJ: {survey.provider_cnpj}</p>
                      </div>
                      <span className="text-sm text-gray-500">
                        {new Date(survey.created_at).toLocaleDateString('pt-BR', {
                          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </span>
                    </div>
                    
                    <div className="space-y-4">
                      <div>
                        <p className="text-sm font-medium text-gray-700">1. Como você avalia o atendimento da Unimed Criciúma?</p>
                        <p className="text-sm text-gray-900 mt-1">{survey.atendimento}</p>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-700">2. Qual a sua satisfação com os canais de comunicação?</p>
                        <p className="text-sm text-gray-900 mt-1">{survey.comunicacao}</p>
                      </div>
                      {survey.sugestoes && (
                        <div>
                          <p className="text-sm font-medium text-gray-700">3. Sugestões ou comentários</p>
                          <p className="text-sm text-gray-900 mt-1 bg-gray-50 p-3 rounded-lg border border-gray-100">{survey.sugestoes}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'acessos' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-2">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Trilha de Acesso</h2>
                <p className="text-sm text-gray-500">Registro de tentativas de login (RN ANS nº 630/2024).</p>
              </div>
              <div className="flex items-center gap-2">
                {([
                  { id: 'all', label: 'Todos' },
                  { id: 'true', label: 'Sucesso' },
                  { id: 'false', label: 'Falha' },
                ] as const).map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setAccessFilter(opt.id)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      accessFilter === opt.id
                        ? 'bg-[#00995D] text-white'
                        : 'text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 text-sm text-gray-500">
                    <th className="pb-3 font-medium">Data/Hora</th>
                    <th className="pb-3 font-medium">Usuário</th>
                    <th className="pb-3 font-medium">E-mail</th>
                    <th className="pb-3 font-medium">Perfil</th>
                    <th className="pb-3 font-medium">IP</th>
                    <th className="pb-3 font-medium">Resultado</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {accessLogs.map((log) => (
                    <tr key={log.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 text-gray-600 whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString('pt-BR', {
                          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                        })}
                      </td>
                      <td className="py-3 font-medium text-gray-800">{log.user_name || <span className="text-gray-400 italic">—</span>}</td>
                      <td className="py-3 text-gray-600">{log.email || '-'}</td>
                      <td className="py-3 text-gray-600">{log.user_role || '-'}</td>
                      <td className="py-3 text-gray-600 font-mono text-xs">{log.ip || '-'}</td>
                      <td className="py-3">
                        {log.success ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            <CheckCircle className="w-3.5 h-3.5" /> Sucesso
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                            <XCircle className="w-3.5 h-3.5" /> Falha
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {accessLogs.length === 0 && !loading && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-gray-500">Nenhum acesso registrado.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-2 text-sm text-gray-500">
              <p>Mostrando {accessLogs.length} de {accessTotal} registro(s)</p>
            </div>
          </div>
        )}

        {activeTab === 'configuracoes' && (
          <div className="space-y-6 max-w-2xl">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
              <h2 className="text-lg font-bold text-gray-800">Configurações do Sistema</h2>
            </div>
            
            <div className="bg-white p-6 rounded-xl border border-gray-200">
              <h3 className="text-md font-bold text-gray-800 mb-4 border-b pb-2">Competência de Pagamento</h3>
              <p className="text-sm text-gray-500 mb-4">
                Defina a competência atual e a data prevista de pagamento que será exibida para os prestadores no Dashboard.
              </p>
              
              <form className="space-y-4" onSubmit={handleSaveSettings}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Mês/Ano de Competência</label>
                    <input 
                      type="month" 
                      value={settings.current_competence || ''}
                      onChange={(e) => setSettings({ ...settings, current_competence: e.target.value })}
                      className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2 border"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Data de Pagamento</label>
                    <input 
                      type="date" 
                      value={settings.payment_date || ''}
                      onChange={(e) => setSettings({ ...settings, payment_date: e.target.value })}
                      className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2 border"
                    />
                  </div>
                </div>
                
                <div className="pt-4">
                  <button 
                    type="submit" 
                    disabled={savingSettings}
                    className="flex items-center gap-2 bg-[#00995D] text-white px-4 py-2 rounded-lg hover:bg-[#007A4A] transition-colors disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    {savingSettings ? 'Salvando...' : 'Salvar Configurações'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showProviderModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-900">Novo Prestador</h3>
              <button onClick={() => setShowProviderModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateProvider} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome / Razão Social</label>
                <input 
                  type="text" 
                  required
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D]"
                  value={providerForm.name}
                  onChange={e => setProviderForm({...providerForm, name: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CNPJ</label>
                <input 
                  type="text" 
                  required
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D]"
                  value={providerForm.cnpj}
                  onChange={e => setProviderForm({...providerForm, cnpj: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Código do Prestador (Opcional)</label>
                <input 
                  type="text" 
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D]"
                  value={providerForm.code}
                  onChange={e => setProviderForm({...providerForm, code: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Grupo / Tipo de Prestador (Opcional)</label>
                <input 
                  type="text" 
                  placeholder="Ex: Clínicas, Hospitais, Laboratórios"
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D]"
                  value={providerForm.provider_group}
                  onChange={e => setProviderForm({...providerForm, provider_group: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo do Prestador (SGU)</label>
                <select
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D]"
                  value={providerForm.provider_type}
                  onChange={e => setProviderForm({...providerForm, provider_type: e.target.value})}
                >
                  <option value="">Selecione...</option>
                  <option value="CLINICA COOPERADO">Clínica Cooperado</option>
                  <option value="CLINICA CREDENCIADO">Clínica Credenciado</option>
                  <option value="HOSPITAL">Hospital</option>
                  <option value="LABORATORIO">Laboratório</option>
                  <option value="MEDICO COOPERADO">Médico Cooperado</option>
                  <option value="MEDICO CREDENCIADO">Médico Credenciado</option>
                  <option value="MEDICO PLANTONISTA">Médico Plantonista</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Área de Atuação (Opcional)</label>
                <input
                  type="text"
                  placeholder="Ex: Cardiologia, Pediatria (Pessoa Física)"
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D]"
                  value={providerForm.area_atuacao}
                  onChange={e => setProviderForm({...providerForm, area_atuacao: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nível de Qualificação (Opcional)</label>
                <select 
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D]"
                  value={providerForm.qualification_level}
                  onChange={e => setProviderForm({...providerForm, qualification_level: e.target.value})}
                >
                  <option value="">Nenhum</option>
                  <option value="A">Nível A</option>
                  <option value="B">Nível B</option>
                  <option value="C">Nível C</option>
                </select>
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button 
                  type="button"
                  onClick={() => setShowProviderModal(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 bg-[#00995D] text-white rounded-lg hover:bg-[#007A4A] transition-colors"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showImportModal && (
        <ImportRoteiroModal
          onClose={() => setShowImportModal(false)}
          onImported={loadData}
        />
      )}

      {deleteTarget && (
        <ConfirmDeleteRoteiroModal
          script={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDeleteScript}
        />
      )}

      {showTrainingModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-900">Novo Material / Treinamento</h3>
              <button onClick={() => setShowTrainingModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateTraining} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Título</label>
                <input
                  type="text"
                  required
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D]"
                  value={trainingForm.title}
                  onChange={e => setTrainingForm({...trainingForm, title: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                <textarea
                  rows={3}
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D]"
                  value={trainingForm.description}
                  onChange={e => setTrainingForm({...trainingForm, description: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Segmentação de Público</label>
                <select
                  value={trainingForm.target_audience}
                  onChange={e => setTrainingForm({...trainingForm, target_audience: e.target.value})}
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2 border mb-2"
                >
                  <option value="geral">Geral (Todos os prestadores)</option>
                  {uniqueGroups.length > 0 && (
                    <optgroup label="Grupos Específicos">
                      {uniqueGroups.map((group: any) => (
                        <option key={group} value={`grupo_${group}`}>Grupo: {group}</option>
                      ))}
                    </optgroup>
                  )}
                  <option value="especifico">Específico (Prestador individual)</option>
                </select>

                {trainingForm.target_audience === 'especifico' && (
                  <select
                    required
                    value={trainingForm.target_provider_id}
                    onChange={e => setTrainingForm({...trainingForm, target_provider_id: e.target.value})}
                    className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2 border mb-2"
                  >
                    <option value="">Selecione o prestador...</option>
                    {providers.map(p => (
                      <option key={p.id} value={p.id}>{p.name} ({p.cnpj})</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL do Vídeo (Opcional)</label>
                <input
                  type="url"
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D]"
                  value={trainingForm.video_url}
                  onChange={e => setTrainingForm({...trainingForm, video_url: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">URL do Material/PDF (Opcional)</label>
                <input
                  type="url"
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D]"
                  value={trainingForm.pdf_url}
                  onChange={e => setTrainingForm({...trainingForm, pdf_url: e.target.value})}
                />
                <p className="text-xs text-gray-500 mt-1">Você pode adicionar apenas um PDF, apenas um vídeo, ou ambos.</p>
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowTrainingModal(false)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#00995D] text-white rounded-lg hover:bg-[#007A4A] transition-colors"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function formatBRDate(iso?: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : null;
}

function RevisaoBadge({ script }: { script: any }) {
  const vigente = script.is_current !== false;
  return (
    <span
      className={`px-2.5 py-1 rounded-full text-xs font-medium ${
        vigente ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
      }`}
    >
      Revisão {script.version ?? '?'} · {vigente ? 'vigente' : 'substituída'}
    </span>
  );
}

function RoteiroDatas({ script }: { script: any }) {
  const rev = formatBRDate(script.revisao_date);
  const impl = formatBRDate(script.implantacao_date);
  if (!rev && !impl) return null;
  return (
    <div className="text-xs text-gray-500 leading-tight">
      {rev && <div>rev. {rev}</div>}
      {impl && <div>implantação: {impl}</div>}
    </div>
  );
}

// Agrupa revisões por roteiro (source_file): vigente + anteriores (desc por revisão).
function agruparPorRoteiro(scripts: any[]): { key: string; vigente: any; anteriores: any[] }[] {
  const grupos = new Map<string, any[]>();
  for (const s of scripts) {
    const key = s.source_file ?? `__${s.id}`;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key)!.push(s);
  }
  const num = (v: any) => parseInt(String(v ?? '').replace(/[^0-9]/g, ''), 10) || 0;
  return Array.from(grupos.entries()).map(([key, lista]) => {
    const ordenada = [...lista].sort((a, b) => num(b.version) - num(a.version));
    const vigenteIdx = ordenada.findIndex((s) => s.is_current === true);
    const idx = vigenteIdx >= 0 ? vigenteIdx : 0;
    return { key, vigente: ordenada[idx], anteriores: ordenada.filter((_, i) => i !== idx) };
  });
}
