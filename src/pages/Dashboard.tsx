import { useEffect, useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { fetchApi } from '../lib/api';
import { welcomeLine } from '../lib/greeting';
import { fmtPct } from '../lib/formatDate';
import { 
  UploadCloud, 
  FileText, 
  DownloadCloud, 
  CreditCard, 
  Award, 
  File,
  Calendar,
  AlertCircle,
  Clock,
  Video,
  Users,
  ArrowRight,
  ClipboardCheck
} from 'lucide-react';

export default function Dashboard() {
  const [user, setUser] = useState<any>(null);
  const [adminData, setAdminData] = useState<any>(null);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      setUser(parsedUser);
      
      Promise.all([
        fetchApi('/dashboard').catch(() => null),
        fetchApi('/announcements').catch(() => []),
      ])
        .then(([dashboardData, announcementsData]) => {
          if (dashboardData) setAdminData(dashboardData);
          setAnnouncements(announcementsData || []);
        })
        .catch(err => console.error(err))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const greeting = welcomeLine(user?.last_login_at);
  const lastAccess = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const isAdmin = user?.role === 'admin' || user?.role === 'auditoria';
  const isCooperado = user?.is_cooperado === true;

  // Formata percentual em pt-BR (vírgula). Valores numeric do Postgres chegam como string.

  // Distribuição de selos da rede (admin) — vinda de eval_instances via /dashboard.
  const sealRows: any[] = adminData?.sealDistribution || [];
  const sealTotal = sealRows.reduce((acc, r) => acc + Number(r.count || 0), 0);
  const getSeal = (name: string) => {
    const count = Number(sealRows.find(r => r.seal === name)?.count || 0);
    return { count, pct: sealTotal > 0 ? (count / sealTotal) * 100 : 0 };
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Carregando dashboard...</div>;
  }

  if (isAdmin) {
    return (
      <div className="max-w-7xl mx-auto pb-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">Visão Geral - {user?.role === 'auditoria' ? 'Auditor' : 'Administração'}</h1>
          <p className="text-sm text-gray-500">Último acesso: {lastAccess}</p>
        </div>

        {/* Admin Top Cards */}
        {/* Cards em coluna (ícone + rótulo em cima, número embaixo): cabem nas 5 colunas sem quebrar o rótulo em 3–4 linhas. */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
          <TopCard icon={Users} tone="bg-emerald-50 text-emerald-600" label="Total de prestadores"
            value={Number(adminData?.providersCount?.count) || 0} />
          <TopCard icon={AlertCircle} tone="bg-blue-50 text-blue-600" label="OS SGU-Card abertas" />
          <TopCard icon={FileText} tone="bg-amber-50 text-amber-600" label="Docs. legais pendentes"
            value={Number(adminData?.pendingDocsCount?.count) || 0} />
          <TopCard icon={Calendar} tone="bg-purple-50 text-purple-600" label="Consultas (Consulta Já)" />
          <TopCard icon={ClipboardCheck} tone="bg-[#00995D]/10 text-[#00995D]" label="Novos credenciamentos" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Qualificação da Rede */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-800">Qualificação da Rede</h3>
              <Link to="/qualificacao" className="text-sm font-medium text-emerald-600 hover:text-emerald-700 flex items-center">
                Ver detalhes <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </div>
            <div className="p-5">
              {(() => {
                const pendingEvals = Number(adminData?.pendingEvaluationsCount?.count || 0);
                const hasContent = sealTotal > 0 || pendingEvals > 0;
                return (
                  <>
                    {pendingEvals > 0 && (
                      <Link
                        to="/qualificacao"
                        className="mb-4 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 transition-colors hover:bg-amber-100"
                      >
                        <div className="flex items-center gap-3">
                          <div className="grid h-10 w-10 place-items-center rounded-full bg-amber-100">
                            <Clock className="h-5 w-5 text-amber-600" />
                          </div>
                          <div>
                            <p className="text-sm font-bold text-amber-900">Pendentes de análise</p>
                            <p className="text-xs text-amber-700">
                              {pendingEvals === 1
                                ? '1 avaliação aguardando auditoria'
                                : `${pendingEvals} avaliações aguardando auditoria`}
                            </p>
                          </div>
                        </div>
                        <span className="text-xl font-bold tabular-nums text-amber-900">{pendingEvals}</span>
                      </Link>
                    )}
                    {sealTotal > 0 && (
                      <div className="space-y-4">
                        {[
                          { name: 'Ouro', icon: 'bg-yellow-100', color: 'text-yellow-600' },
                          { name: 'Prata', icon: 'bg-gray-100', color: 'text-gray-500' },
                          { name: 'Bronze', icon: 'bg-orange-100', color: 'text-orange-600' },
                        ].map(({ name, icon, color }) => {
                          const { count, pct } = getSeal(name);
                          return (
                            <div key={name} className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 rounded-full ${icon} flex items-center justify-center`}>
                                  <Award className={`h-5 w-5 ${color}`} />
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-gray-800">Selo {name}</p>
                                  <p className="text-xs text-gray-500">{count} {count === 1 ? 'prestador avaliado' : 'prestadores avaliados'}</p>
                                </div>
                              </div>
                              <span className="text-lg font-bold text-gray-800">{fmtPct(pct)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {!hasContent && (
                      <div className="text-center py-6 text-gray-500 text-sm">Nenhuma avaliação finalizada nem pendente ainda.</div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>

          {/* Atendimento à Rede */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-800">Atendimento à Rede</h3>
              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">Em breve</span>
            </div>
            <div className="p-5">
              <div className="space-y-4">
                {['E-mail', 'WhatsApp', 'Ligação', 'CRM / Presencial'].map((canal) => (
                  <div key={canal}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium text-gray-700">{canal}</span>
                      <span className="font-bold text-gray-400">—</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className="bg-gray-200 h-2 rounded-full" style={{ width: '0%' }}></div>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-gray-400 pt-1">Disponível após a integração com os canais de atendimento.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isCooperado) {
    return (
      <div className="max-w-7xl mx-auto pb-10">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800">{greeting}</h1>
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
        </div>

        {/* Acesso Rápido (cooperado) */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
          <h3 className="text-lg font-bold text-gray-800 mb-1">Acesso Rápido</h3>
          <p className="text-sm text-gray-500 mb-4">Atalhos para o seu dia a dia como cooperado.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Link to="/qualificacao" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all">
              <Award className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
              <span className="text-xs font-medium text-gray-600 text-center">Minha Qualificação</span>
            </Link>
            <Link to="/treinamentos" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all">
              <Video className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
              <span className="text-xs font-medium text-gray-600 text-center">Treinamentos</span>
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
        <h1 className="text-2xl font-bold text-gray-800">{greeting}</h1>
        <p className="text-sm text-gray-500">Último acesso: {lastAccess}</p>
      </div>

        <div className="flex-1 space-y-6">
          
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

        </div>
    </div>
  );
}

// Card do topo da visão geral (admin/auditoria). Sem `value` = indicador ainda não
// integrado: mostra a etiqueta "Em breve" no lugar do número.
function TopCard({ icon: Icon, tone, label, value }: {
  icon: ComponentType<{ className?: string }>; tone: string; label: string; value?: number;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tone}`}>
          <Icon className="h-5 w-5" />
        </span>
        <p className="text-xs font-semibold leading-snug text-gray-500">{label}</p>
      </div>
      {value === undefined
        ? <span className="mt-4 inline-block self-start rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">Em breve</span>
        : <p className="mt-3 text-3xl font-bold tabular-nums text-gray-800">{value.toLocaleString('pt-BR')}</p>}
    </div>
  );
}
