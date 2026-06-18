import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchApi } from '../lib/api';
import { 
  UploadCloud, 
  Monitor, 
  FileText, 
  Search, 
  DownloadCloud, 
  CreditCard, 
  Award, 
  File,
  Briefcase,
  Pill,
  TrendingUp,
  LineChart,
  Calendar,
  Grid,
  CheckCircle,
  AlertCircle,
  Clock,
  BookOpen,
  Video,
  Users,
  ArrowRight,
  X,
  Download,
  ClipboardCheck
} from 'lucide-react';

export default function Dashboard() {
  const [user, setUser] = useState<any>(null);
  const [adminData, setAdminData] = useState<any>(null);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [hasAnsweredSurvey, setHasAnsweredSurvey] = useState(false);
  const [settings, setSettings] = useState<any>({});
  const [loading, setLoading] = useState(true);
  
  // Modal states
  const [showExtratoModal, setShowExtratoModal] = useState(false);
  const [extratoMonth, setExtratoMonth] = useState('');
  const [extratoYear, setExtratoYear] = useState('');
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      setUser(parsedUser);
      
      Promise.all([
        fetchApi('/dashboard').catch(() => null),
        fetchApi('/announcements').catch(() => []),
        fetchApi('/surveys').catch(() => []),
        fetchApi('/settings').catch(() => ({}))
      ])
        .then(([dashboardData, announcementsData, surveysData, settingsData]) => {
          if (dashboardData) setAdminData(dashboardData);
          setAnnouncements(announcementsData || []);
          if (surveysData && surveysData.length > 0) {
            setHasAnsweredSurvey(true);
          }
          setSettings(settingsData || {});
        })
        .catch(err => console.error(err))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const handleEmitirExtrato = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!extratoMonth || !extratoYear) return alert('Preencha o mês e o ano.');
    
    setIsDownloading(true);
    // Simula o tempo de geração do PDF
    setTimeout(() => {
      setIsDownloading(false);
      setShowExtratoModal(false);
      alert(`Extrato de ${extratoMonth}/${extratoYear} gerado e baixado com sucesso!`);
      setExtratoMonth('');
      setExtratoYear('');
    }, 1500);
  };

  const firstName = user?.name?.split(' ')[0] || 'Usuário';
  const lastAccess = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const isAdmin = user?.role === 'admin' || user?.role === 'auditoria';
  const isCooperado = user?.role === 'cooperado';
  const isPrestador = user?.role === 'prestador';

  const getRoleGreeting = () => {
    if (isCooperado) return 'Bem-vindo(a) ao portal do Cooperado Unimed';
    if (isPrestador) return 'Bem-vindo(a) ao portal da Rede Prestadora';
    return 'Bem-vindo(a) ao Unimed Rede+';
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Carregando dashboard...</div>;
  }

  if (isAdmin) {
    return (
      <div className="max-w-7xl mx-auto pb-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Visão Geral - Administração</h1>
          <p className="text-sm text-gray-500">Último acesso: {lastAccess}</p>
        </div>

        {/* Admin Top Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center">
            <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mr-4">
              <Users className="h-7 w-7 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Total de Prestadores</p>
              <p className="text-3xl font-bold text-gray-800">669</p>
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center">
            <div className="w-14 h-14 rounded-full bg-blue-100 flex items-center justify-center mr-4">
              <AlertCircle className="h-7 w-7 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">OS SGU-Card Abertas</p>
              <p className="text-3xl font-bold text-gray-800">44</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center">
            <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mr-4">
              <FileText className="h-7 w-7 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Docs. Legais Pendentes</p>
              <p className="text-3xl font-bold text-gray-800">11%</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center">
            <div className="w-14 h-14 rounded-full bg-purple-100 flex items-center justify-center mr-4">
              <Calendar className="h-7 w-7 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Consultas (Consulta Já)</p>
              <p className="text-3xl font-bold text-gray-800">250</p>
            </div>
          </div>

          <Link to="/credenciamento" className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center hover:border-[#00995D] hover:shadow-md transition-all cursor-pointer">
            <div className="w-14 h-14 rounded-full bg-[#00995D]/10 flex items-center justify-center mr-4">
              <ClipboardCheck className="h-7 w-7 text-[#00995D]" />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Novos Credenciamentos</p>
              <p className="text-3xl font-bold text-gray-800">{adminData?.pendingCredentialingCount?.count || 0}</p>
            </div>
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Qualificação da Rede */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-800">Qualificação da Rede (2025)</h3>
              <Link to="/qualificacao" className="text-sm font-medium text-emerald-600 hover:text-emerald-700 flex items-center">
                Ver detalhes <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </div>
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center">
                    <Award className="h-5 w-5 text-yellow-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-800">Selo Ouro</p>
                    <p className="text-xs text-gray-500">Crescimento de 13.54% para 16.27%</p>
                  </div>
                </div>
                <span className="text-lg font-bold text-gray-800">16,27%</span>
              </div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                    <Award className="h-5 w-5 text-gray-500" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-800">Selo Prata</p>
                    <p className="text-xs text-gray-500">Crescimento de 67.55% para 82.16%</p>
                  </div>
                </div>
                <span className="text-lg font-bold text-gray-800">82,16%</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
                    <Award className="h-5 w-5 text-orange-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-800">Selo Bronze</p>
                    <p className="text-xs text-gray-500">Redução de 13.35% para 1.57%</p>
                  </div>
                </div>
                <span className="text-lg font-bold text-gray-800">1,57%</span>
              </div>
            </div>
          </div>

          {/* Atendimento à Rede */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-800">Atendimento à Rede</h3>
              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">Jan a Out/2025</span>
            </div>
            <div className="p-5">
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-gray-700">E-mail</span>
                    <span className="font-bold text-gray-800">4.230</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full" style={{ width: '45%' }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-gray-700">WhatsApp</span>
                    <span className="font-bold text-gray-800">2.892</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-emerald-500 h-2 rounded-full" style={{ width: '31%' }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-gray-700">Ligação</span>
                    <span className="font-bold text-gray-800">2.100</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-orange-500 h-2 rounded-full" style={{ width: '22%' }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-gray-700">CRM / Presencial</span>
                    <span className="font-bold text-gray-800">60</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="bg-purple-500 h-2 rounded-full" style={{ width: '2%' }}></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isCooperado) {
    const openTickets = adminData?.tickets?.filter((t: any) => t.status !== 'encerrado').length || 0;
    const pendingTrainings = adminData?.trainings?.filter((t: any) => t.status !== 'concluido').length || 0;
    return (
      <div className="max-w-7xl mx-auto pb-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Olá, {firstName}. {getRoleGreeting()}</h1>
          <p className="text-sm text-gray-500">Último acesso: {lastAccess}</p>
        </div>

        {/* Top Cards (foco no médico cooperado — sem itens financeiros/PJ) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Link to="/qualificacao" className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex items-center h-28 hover:border-[#00995D] hover:shadow-md transition-all">
            <div className="w-12 h-12 rounded-full bg-[#FFD700]/20 flex items-center justify-center mr-4 flex-shrink-0">
              <Award className="h-6 w-6 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Minha Qualificação</p>
              <p className="text-base font-bold text-gray-800">Responder roteiro</p>
            </div>
          </Link>
          <Link to="/treinamentos" className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between h-28 hover:border-[#00995D] hover:shadow-md transition-all">
            <p className="text-sm text-gray-500 font-medium">Treinamentos a concluir</p>
            <div className="flex justify-between items-end">
              <p className="text-2xl font-bold text-gray-800">{pendingTrainings}</p>
              <span className="bg-[#ff4d4f] text-white text-[10px] font-bold px-2 py-1 rounded-full">Pendentes</span>
            </div>
          </Link>
          <Link to="/chamados" className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between h-28 hover:border-[#00995D] hover:shadow-md transition-all">
            <p className="text-sm text-gray-500 font-medium">Chamados Abertos</p>
            <div className="flex justify-between items-end">
              <p className="text-2xl font-bold text-gray-800">{openTickets}</p>
              <span className="bg-[#c2d82e] text-gray-800 text-[10px] font-bold px-2 py-1 rounded-full">Em andamento</span>
            </div>
          </Link>
        </div>

        {/* Banner Pesquisa */}
        {!hasAnsweredSurvey && (
          <Link to="/pesquisa" className="relative rounded-xl overflow-hidden h-44 shadow-sm block hover:shadow-md transition-shadow group mb-6">
            <img
              src="https://images.pexels.com/photos/5215024/pexels-photo-5215024.jpeg?auto=compress&cs=tinysrgb&w=1200"
              alt="Médica no consultório"
              className="absolute inset-0 w-full h-full object-cover object-[center_40%] group-hover:scale-105 transition-transform duration-500"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-black/80 to-transparent"></div>
            <div className="absolute inset-0 p-6 flex flex-col justify-center w-2/3">
              <h2 className="text-xl font-bold text-white mb-2">Participe da Pesquisa de Qualificação</h2>
              <p className="text-white/80 text-sm mb-4">Sua opinião ajuda a aprimorar o relacionamento com a cooperativa.</p>
              <div>
                <span className="inline-block bg-[#00995D] group-hover:bg-[#007A4A] text-white text-sm font-bold py-2 px-4 rounded-lg transition-colors">Responder Pesquisa</span>
              </div>
            </div>
          </Link>
        )}

        {/* Acesso Rápido (cooperado) */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
          <h3 className="text-lg font-bold text-gray-800 mb-1">Acesso Rápido</h3>
          <p className="text-sm text-gray-500 mb-4">Atalhos para o seu dia a dia como cooperado.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Link to="/qualificacao" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all">
              <Award className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
              <span className="text-xs font-medium text-gray-600 text-center">Minha Qualificação</span>
            </Link>
            <Link to="/chamados" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all">
              <Monitor className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
              <span className="text-xs font-medium text-gray-600 text-center">Abrir Chamado</span>
            </Link>
            <Link to="/treinamentos" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all">
              <Video className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
              <span className="text-xs font-medium text-gray-600 text-center">Treinamentos</span>
            </Link>
            <Link to="/biblioteca" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all">
              <BookOpen className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
              <span className="text-xs font-medium text-gray-600 text-center">Biblioteca Técnica</span>
            </Link>
          </div>
        </div>

        {/* Comunicados Importantes */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <h3 className="text-lg font-bold text-gray-800 mb-1">Comunicados Importantes</h3>
          <p className="text-sm text-gray-500 mb-4">Fique por dentro das últimas novidades e atualizações</p>
          {announcements.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {announcements.slice(0, 3).map((announcement) => (
                <div key={announcement.id} className="border border-gray-100 rounded-xl overflow-hidden flex flex-col">
                  <div className="relative h-24 bg-gray-100">
                    {announcement.image_url ? (
                      <img src={announcement.image_url} alt={announcement.category} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400"><FileText className="w-8 h-8 opacity-50" /></div>
                    )}
                    <span className="absolute top-2 left-2 text-white text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500">{announcement.category}</span>
                  </div>
                  <div className="p-3 flex flex-col flex-1 justify-between">
                    <div>
                      <h4 className="text-sm font-bold text-[#00995D] leading-tight mb-1">{announcement.title}</h4>
                      <p className="text-xs text-gray-400 text-right">{new Date(announcement.date).toLocaleDateString('pt-BR')}</p>
                    </div>
                    <button className="mt-3 w-full py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">Saiba Mais</button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 text-sm">Nenhum comunicado no momento.</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto pb-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Olá, {firstName}. {getRoleGreeting()}</h1>
        <p className="text-sm text-gray-500">Último acesso: {lastAccess}</p>
      </div>

      <div className="flex flex-col xl:flex-row gap-6">
        {/* Main Content Column */}
        <div className="flex-1 space-y-6">
          
          {/* Top Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Link to="/em-construcao" className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between h-28 hover:border-[#00995D] hover:shadow-md transition-all cursor-pointer">
              <div className="flex justify-between items-start">
                <p className="text-sm text-gray-500 font-medium">Competência</p>
                {settings.payment_date && (
                  <span className="bg-green-50 text-[#00995D] text-[10px] font-bold px-2 py-1 rounded-full">
                    Pagamento: {new Date(settings.payment_date + 'T12:00:00Z').toLocaleDateString('pt-BR')}
                  </span>
                )}
              </div>
              <div className="flex justify-between items-end">
                <p className="text-2xl font-bold text-gray-800">
                  {settings.current_competence 
                    ? (() => {
                        const [year, month] = settings.current_competence.split('-');
                        return `${month}/${year}`;
                      })()
                    : '--/----'}
                </p>
              </div>
            </Link>
            <Link to="/chamados" className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between h-28 hover:border-[#00995D] hover:shadow-md transition-all cursor-pointer">
              <p className="text-sm text-gray-500 font-medium">Chamados Abertos</p>
              <div className="flex justify-between items-end">
                <p className="text-2xl font-bold text-gray-800">
                  {adminData?.tickets?.filter((t: any) => t.status !== 'encerrado').length || 0}
                </p>
                <span className="bg-[#c2d82e] text-gray-800 text-[10px] font-bold px-2 py-1 rounded-full">Em andamento</span>
              </div>
            </Link>
            <Link to="/treinamentos" className="bg-white p-5 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-between h-28 hover:border-[#00995D] hover:shadow-md transition-all cursor-pointer">
              <p className="text-sm text-gray-500 font-medium">Treinamentos</p>
              <div className="flex justify-between items-end">
                <p className="text-2xl font-bold text-gray-800">
                  {adminData?.trainings?.length || 0}
                </p>
                <span className="bg-[#ff4d4f] text-white text-[10px] font-bold px-2 py-1 rounded-full">A concluir</span>
              </div>
            </Link>
          </div>

          {/* Banner */}
          {!hasAnsweredSurvey ? (
            <Link to="/pesquisa" className="relative rounded-xl overflow-hidden h-48 shadow-sm block hover:shadow-md transition-shadow group">
              <img 
                src="https://images.pexels.com/photos/5215024/pexels-photo-5215024.jpeg?auto=compress&cs=tinysrgb&w=1200" 
                alt="Médica no consultório" 
                className="absolute inset-0 w-full h-full object-cover object-[center_40%] group-hover:scale-105 transition-transform duration-500"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-r from-black/80 to-transparent"></div>
              <div className="absolute inset-0 p-6 flex flex-col justify-center w-2/3">
                <h2 className="text-2xl font-bold text-white mb-2">Participe da Pesquisa de Qualificação da Rede</h2>
                <p className="text-white/80 text-sm mb-4">Sua opinião é fundamental para aprimorarmos nossos serviços e o relacionamento com nossa rede de prestadores.</p>
                <div>
                  <span className="inline-block bg-[#00995D] group-hover:bg-[#007A4A] text-white text-sm font-bold py-2 px-4 rounded-lg transition-colors">
                    Responder Pesquisa
                  </span>
                </div>
              </div>
            </Link>
          ) : (
            <div className="relative rounded-xl overflow-hidden h-48 shadow-sm block bg-gradient-to-r from-[#00995D] to-[#007A4A]">
              <div className="absolute inset-0 p-6 flex flex-col justify-center items-center text-center">
                <CheckCircle className="h-12 w-12 text-white mb-4" />
                <h2 className="text-2xl font-bold text-white mb-2">Pesquisa Respondida!</h2>
                <p className="text-white/90 text-sm max-w-md">
                  Agradecemos muito pela sua participação. Suas respostas nos ajudam a construir uma rede ainda mais forte e qualificada.
                </p>
              </div>
            </div>
          )}

          {/* Acesso Rápido */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-1">Acesso Rápido</h3>
            <p className="text-sm text-gray-500 mb-4">Atalhos para as funcionalidades mais utilizadas no seu dia a dia.</p>
            
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {isAdmin && (
                <Link to="/em-construcao" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
                  <UploadCloud className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
                  <span className="text-xs font-medium text-gray-600 text-center">Enviar NF-e</span>
                </Link>
              )}
              <Link to="/chamados" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
                <Monitor className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
                <span className="text-xs font-medium text-gray-600 text-center">Abrir Chamado</span>
              </Link>
              <button onClick={() => setShowExtratoModal(true)} className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group w-full">
                <FileText className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
                <span className="text-xs font-medium text-gray-600 text-center">Emitir Extrato</span>
              </button>
              <Link to="/em-construcao" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
                <Search className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
                <span className="text-xs font-medium text-gray-600 text-center">Consultar Glosas</span>
              </Link>
              <a href="https://app-agendamento-hml.criciuma.unimedsc.com.br/login" target="_blank" rel="noreferrer" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
                <DownloadCloud className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
                <span className="text-xs font-medium text-gray-600 text-center">Consulta Já</span>
              </a>
              <a href="https://rda.unimedsc.com.br/cmagnet/Login.do" target="_blank" rel="noreferrer" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
                <CreditCard className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
                <span className="text-xs font-medium text-gray-600 text-center">SGU - Card</span>
              </a>
              <Link to="/qualificacao" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
                <Award className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
                <span className="text-xs font-medium text-gray-600 text-center">Qualificação da Rede</span>
              </Link>
              <Link to="/documentos" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
                <File className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
                <span className="text-xs font-medium text-gray-600 text-center">Documentos</span>
              </Link>
            </div>
          </div>

          {/* Comunicados Importantes */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-1">Comunicados Importantes</h3>
            <p className="text-sm text-gray-500 mb-4">Fique por dentro das últimas novidades e atualizações</p>
            
            {announcements.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                {announcements.slice(0, 3).map((announcement) => (
                  <div key={announcement.id} className="border border-gray-100 rounded-xl overflow-hidden flex flex-col">
                    <div className="relative h-24 bg-gray-100">
                      {announcement.image_url ? (
                        <img src={announcement.image_url} alt={announcement.category} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-400">
                          <FileText className="w-8 h-8 opacity-50" />
                        </div>
                      )}
                      <span className={`absolute top-2 left-2 text-white text-[10px] font-bold px-2 py-0.5 rounded ${
                        announcement.category === 'Processos' ? 'bg-[#00995D]' :
                        announcement.category === 'Campanhas' ? 'bg-[#f59e0b]' :
                        announcement.category === 'Faturamento' ? 'bg-[#c2d82e] text-gray-800' :
                        'bg-blue-500'
                      }`}>
                        {announcement.category}
                      </span>
                    </div>
                    <div className="p-3 flex flex-col flex-1 justify-between">
                      <div>
                        <h4 className="text-sm font-bold text-[#00995D] leading-tight mb-1">{announcement.title}</h4>
                        <p className="text-xs text-gray-400 text-right">{new Date(announcement.date).toLocaleDateString('pt-BR')}</p>
                      </div>
                      <button className="mt-3 w-full py-1.5 border border-gray-200 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">Saiba Mais</button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 text-sm">
                Nenhum comunicado no momento.
              </div>
            )}
            
            {announcements.length > 3 && (
              <div className="flex justify-center">
                <button className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors">
                  Ver mais
                </button>
              </div>
            )}
          </div>

          {/* Ferramentas Operacionais */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-lg font-bold text-gray-800 mb-4">Ferramentas Operacionais</h3>
            
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Link to="/biblioteca" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
                <BookOpen className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
                <span className="text-xs font-medium text-gray-600 text-center">Biblioteca Técnica</span>
              </Link>
              <Link to="/ferramentas" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
                <Briefcase className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
                <span className="text-xs font-medium text-gray-600 text-center">Caixa de Ferramentas</span>
              </Link>
              <Link to="/medicacoes" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
                <Pill className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
                <span className="text-xs font-medium text-gray-600 text-center">Medicações</span>
              </Link>
              <Link to="/em-construcao" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
                <TrendingUp className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
                <span className="text-xs font-medium text-gray-600 text-center">Indicadores</span>
              </Link>
              <Link to="/producao" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
                <LineChart className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
                <span className="text-xs font-medium text-gray-600 text-center">Produção</span>
              </Link>
              <Link to="/agenda" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
                <Calendar className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
                <span className="text-xs font-medium text-gray-600 text-center">Agenda de Visitas</span>
              </Link>
              <Link to="/tabelas" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
                <Grid className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
                <span className="text-xs font-medium text-gray-600 text-center">Tabelas de Preço</span>
              </Link>
            </div>
          </div>

        </div>

        {/* Right Sidebar */}
        <div className="w-full xl:w-80 space-y-6">
          
          {/* Qualificação */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-center text-center">
            <div className="w-24 h-24 bg-[#FFD700] rounded-full flex items-center justify-center mb-4 shadow-inner border-4 border-yellow-200">
              <span className="text-xl font-black text-yellow-800 tracking-tighter leading-none">SELO<br/>OURO</span>
            </div>
            <h3 className="text-sm font-bold text-gray-800">Sua qualificação na rede</h3>
            <p className="text-4xl font-black text-[#00995D] my-2">92%</p>
            <Link to="/qualificacao" className="mt-2 px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium rounded-lg transition-colors">
              Ver detalhes da sua avaliação
            </Link>
          </div>

          {/* Parabéns */}
          <div className="bg-[#e6f4ea] rounded-xl shadow-sm border border-[#cce8d6] p-5 relative overflow-hidden">
            <Award className="absolute -right-4 -bottom-4 h-24 w-24 text-[#00995D] opacity-10" />
            <h3 className="text-sm font-bold text-[#00995D] mb-2">Parabéns!</h3>
            <p className="text-xs text-gray-700 leading-relaxed">
              Hoje você completa <strong className="text-[#00995D]">3 anos</strong> como prestador da <strong>Unimed Criciúma</strong>! Obrigado por fazer parte da nossa rede.
            </p>
          </div>

          {/* Precisa de ajuda */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <img src="https://picsum.photos/seed/support/400/200" alt="Suporte" className="w-full h-32 object-cover" referrerPolicy="no-referrer" />
            <div className="p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-2">Precisa de ajuda?</h3>
              <p className="text-xs text-gray-500 mb-4">Nossa equipe de suporte está pronta para te auxiliar com qualquer dúvida.</p>
              <a href="https://wa.me/5548999999999" target="_blank" rel="noreferrer" className="block text-center w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors">
                Falar no WhatsApp
              </a>
            </div>
          </div>

          {/* Área de Inovação */}
          <div className="bg-gradient-to-br from-[#00995D] to-[#007A4A] rounded-xl shadow-sm p-6 text-white relative overflow-hidden">
            <div className="absolute -right-6 -top-6 w-24 h-24 bg-white opacity-10 rounded-full"></div>
            <h3 className="text-sm font-bold mb-2">Inovação Unimed</h3>
            <p className="text-xs text-white/90 mb-4 leading-relaxed">
              Descubra as novas tendências em saúde e tecnologia. Assista aos nossos vídeos institucionais.
            </p>
            <button className="px-4 py-2 bg-white text-[#00995D] text-xs font-bold rounded-lg hover:bg-gray-50 transition-colors">
              Explorar Novidades
            </button>
          </div>

          {/* Atualizações */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="text-sm font-bold text-gray-800 mb-4">Atualizações</h3>
            <ul className="space-y-4">
              <li className="flex items-start">
                <CheckCircle className="h-4 w-4 text-[#00995D] mt-0.5 mr-3 flex-shrink-0" />
                <span className="text-xs text-gray-600">Treinamento "Segurança do Paciente" concluído</span>
              </li>
              <li className="flex items-start">
                <AlertCircle className="h-4 w-4 text-[#f59e0b] mt-0.5 mr-3 flex-shrink-0" />
                <span className="text-xs text-gray-600">Chamado #2345 atualizado</span>
              </li>
              <li className="flex items-start">
                <FileText className="h-4 w-4 text-blue-500 mt-0.5 mr-3 flex-shrink-0" />
                <span className="text-xs text-gray-600">Novo Manual de Faturamento publicado</span>
              </li>
              <li className="flex items-start">
                <Clock className="h-4 w-4 text-red-500 mt-0.5 mr-3 flex-shrink-0" />
                <span className="text-xs text-gray-600">Documento CRM vence em 30 dias</span>
              </li>
            </ul>
            <div className="mt-5 flex justify-center">
              <button className="px-6 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium rounded-lg transition-colors">
                Ver mais
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* Emitir Extrato Modal */}
      {showExtratoModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-900">Emitir Extrato</h3>
              <button onClick={() => setShowExtratoModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleEmitirExtrato} className="p-6 space-y-4">
              <p className="text-sm text-gray-600 mb-4">Selecione o período para gerar o extrato de faturamento.</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Mês</label>
                  <select 
                    className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D]"
                    value={extratoMonth}
                    onChange={(e) => setExtratoMonth(e.target.value)}
                    required
                  >
                    <option value="">Selecione</option>
                    <option value="01">Janeiro</option>
                    <option value="02">Fevereiro</option>
                    <option value="03">Março</option>
                    <option value="04">Abril</option>
                    <option value="05">Maio</option>
                    <option value="06">Junho</option>
                    <option value="07">Julho</option>
                    <option value="08">Agosto</option>
                    <option value="09">Setembro</option>
                    <option value="10">Outubro</option>
                    <option value="11">Novembro</option>
                    <option value="12">Dezembro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ano</label>
                  <select 
                    className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D]"
                    value={extratoYear}
                    onChange={(e) => setExtratoYear(e.target.value)}
                    required
                  >
                    <option value="">Selecione</option>
                    <option value="2025">2025</option>
                    <option value="2024">2024</option>
                    <option value="2023">2023</option>
                  </select>
                </div>
              </div>
              <div className="pt-4 flex justify-end space-x-3">
                <button 
                  type="button" 
                  onClick={() => setShowExtratoModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={isDownloading}
                  className="flex items-center px-4 py-2 text-sm font-medium text-white bg-[#00995D] hover:bg-[#007A4A] rounded-lg transition-colors disabled:opacity-50"
                >
                  {isDownloading ? (
                    'Gerando...'
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Baixar PDF
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
