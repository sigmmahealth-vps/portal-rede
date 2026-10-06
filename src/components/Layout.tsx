import { Outlet, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  FileText, 
  GraduationCap, 
  MessageSquare, 
  Library, 
  FileSignature,
  ClipboardCheck,
  Award,
  LogOut,
  Menu,
  X,
  Search,
  Accessibility,
  User,
  Users,
  HelpCircle,
  Shield
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import RightSidebar from './RightSidebar';
import NotificationsBell from './NotificationsBell';
import { fetchApi } from '../lib/api';
import PrivacyConsentModal from './PrivacyConsentModal';
import { needsPrivacyAcceptance, PRIVACY_POLICY_VERSION } from '../lib/privacyPolicy';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Gestão Documental', href: '/documentos', icon: FileText },
  { name: 'Qualificação da Rede', href: '/qualificacao', icon: Award },
  { name: 'Equipe / Profissionais', href: '/equipe', icon: Users },
  { name: 'Credenciamento', href: '/credenciamento', icon: ClipboardCheck },
  { name: 'Treinamentos', href: '/treinamentos', icon: GraduationCap },
  { name: 'Chamados', href: '/chamados', icon: MessageSquare },
  { name: 'Contratos', href: '/contratos', icon: FileSignature },
  { name: 'Administração', href: '/admin', icon: Shield }, // Admin should probably be kept for user management, but let's see.
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);

  const isAdmin = user?.role === 'admin' || user?.role === 'auditoria';

  // Módulos ainda não liberados para os acessos de prestador (cliente, 25/09): aparecem
  // no menu como "Em breve", sem link, e a URL direta volta para o Dashboard.
  const PROVIDER_SOON = ['/documentos', '/contratos'];

  const filteredNavigation = navigation
    .filter(item => !((item.name === 'Administração' || item.name === 'Credenciamento') && !isAdmin))
    .map(item => ({ ...item, soon: !!user && !isAdmin && PROVIDER_SOON.includes(item.href) }));
  const blockedRoute = !!user && !isAdmin && PROVIDER_SOON.includes(location.pathname);

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showAccessibility, setShowAccessibility] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [largeText, setLargeText] = useState(false);

  const searchRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const accessRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) setShowSearch(false);
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) setShowProfile(false);
      if (accessRef.current && !accessRef.current.contains(event.target as Node)) setShowAccessibility(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (highContrast) document.body.style.filter = 'contrast(125%)';
    else document.body.style.filter = 'none';
  }, [highContrast]);

  useEffect(() => {
    if (largeText) document.body.style.fontSize = '105%';
    else document.body.style.fontSize = '100%';
  }, [largeText]);

  const searchResults = filteredNavigation.filter(item =>
    !item.soon && item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      navigate('/login');
    } else {
      setUser(JSON.parse(storedUser));
    }
  }, [navigate]);

  // Aceite da Política de Privacidade (spec 2026-09-29): undefined = ainda carregando.
  const [privacyAccepted, setPrivacyAccepted] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!user) return;
    fetchApi('/auth/me').then((r) => setPrivacyAccepted(r.user?.privacy_accepted_version ?? null)).catch(() => {});
  }, [user?.id]);

  // Prestador com mais de uma unidade: troca sem sair entre as que usam o mesmo e-mail.
  const [units, setUnits] = useState<{ user_id: number; label: string; current: boolean; can_switch: boolean }[]>([]);
  useEffect(() => {
    if (!user?.provider_id) return;
    fetchApi('/auth/units').then((r) => setUnits(r.units ?? [])).catch(() => {});
  }, [user?.id]);

  const switchUnit = async (userId: number) => {
    try {
      const r = await fetchApi('/auth/switch-unit', { method: 'POST', body: JSON.stringify({ user_id: userId }) });
      localStorage.setItem('user', JSON.stringify(r.user));
      window.location.assign('/dashboard');
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleLogout = async () => {
    try {
      await fetchApi('/auth/logout', { method: 'POST' });
    } catch {
      // sessão pode já estar inválida no servidor — ainda assim segue limpando cliente
    }
    localStorage.removeItem('user');
    navigate('/login');
  };

  if (!user) return null;

  const firstName = user.name.split(' ')[0];
  const lastAccess = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <div className="flex h-screen bg-[#f4f4f4] font-sans">
      {privacyAccepted !== undefined && needsPrivacyAcceptance(privacyAccepted) && (
        <PrivacyConsentModal onAccepted={() => setPrivacyAccepted(PRIVACY_POLICY_VERSION)} onLogout={handleLogout} />
      )}
      {/* Mobile sidebar */}
      <div className={`fixed inset-0 z-50 lg:hidden ${sidebarOpen ? 'block' : 'hidden'}`}>
        <div className="fixed inset-0 bg-gray-900/80" onClick={() => setSidebarOpen(false)} />
        <div className="fixed inset-y-0 left-0 w-64 bg-[#00995D] flex flex-col shadow-xl">
          <div className="flex items-center justify-between h-16 px-4 bg-white border-b">
            <img src="/logo-prp.png" alt="PRP — Portal da Rede de Prestadores" className="h-9" />
            <button onClick={() => setSidebarOpen(false)} className="text-gray-500">
              <X className="w-6 h-6" />
            </button>
          </div>
          <nav className="flex-1 px-2 py-4 space-y-2 overflow-y-auto">
            {filteredNavigation.map((item) => {
              const isActive = location.pathname === item.href;
              if (item.soon) return (
                <div key={item.name} aria-disabled="true" title="Em breve"
                  className="flex cursor-not-allowed items-center rounded-lg px-3 py-3 text-sm font-medium text-white/50">
                  <item.icon className="mr-3 h-5 w-5 flex-shrink-0 text-white/40" />
                  <span className="flex-1">{item.name}</span>
                  <span className="ml-2 rounded bg-white/20 px-1.5 py-0.5 text-[10px] text-white">Em breve</span>
                </div>
              );
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`flex items-center px-3 py-3 text-sm font-medium rounded-lg transition-colors ${
                    isActive ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
                  }`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <item.icon className={`mr-3 flex-shrink-0 h-5 w-5 ${isActive ? 'text-white' : 'text-white/70'}`} />
                  <span className="flex-1">{item.name}</span>
                </Link>
              );
            })}
          </nav>
          <div className="p-4 border-t border-white/10">
            <button
              onClick={handleLogout}
              className="flex items-center w-full px-3 py-3 text-sm font-medium text-white/70 rounded-lg hover:bg-white/10 hover:text-white transition-colors"
            >
              <LogOut className="mr-3 h-5 w-5" />
              Sair
            </button>
          </div>
        </div>
      </div>

      {/* Desktop sidebar (Expandable on hover) */}
      <div 
        className={`hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:bg-[#00995D] shadow-md z-30 transition-all duration-300 overflow-hidden ${isSidebarExpanded ? 'w-64' : 'w-20'}`}
        onMouseEnter={() => setIsSidebarExpanded(true)}
        onMouseLeave={() => setIsSidebarExpanded(false)}
      >
        <div className="flex items-center justify-center h-16 bg-white border-b border-gray-200 px-4 flex-shrink-0">
          <img src={isSidebarExpanded ? '/logo-prp.png' : '/logo-prp-icon.png'} alt="PRP — Portal da Rede de Prestadores" className="h-8 object-contain transition-all duration-300" />
        </div>
        <div className="flex flex-col flex-1 overflow-y-auto py-4 space-y-2 px-3">
          {filteredNavigation.map((item) => {
            const isActive = location.pathname === item.href;
            if (item.soon) return (
              <div key={item.name} aria-disabled="true" title={`${item.name} — em breve`}
                className="flex h-12 cursor-not-allowed items-center rounded-xl px-3 text-white/40">
                <item.icon className="h-6 w-6 flex-shrink-0" strokeWidth={2} />
                <span className={`ml-3 flex flex-1 items-center justify-between whitespace-nowrap font-medium transition-opacity duration-300 ${isSidebarExpanded ? 'opacity-100' : 'opacity-0'}`}>
                  <span className="text-white/50">{item.name}</span>
                  <span className="ml-2 rounded bg-white/20 px-1.5 py-0.5 text-[10px] text-white">Em breve</span>
                </span>
              </div>
            );
            return (
              <Link
                key={item.name}
                to={item.href}
                className={`flex items-center h-12 rounded-xl transition-all px-3 ${
                  isActive ? 'bg-white/20 text-white shadow-inner' : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}
              >
                <item.icon className="h-6 w-6 flex-shrink-0" strokeWidth={isActive ? 2.5 : 2} />
                <span className={`ml-3 font-medium whitespace-nowrap transition-opacity duration-300 flex-1 flex items-center justify-between ${isSidebarExpanded ? 'opacity-100' : 'opacity-0'}`}>
                  {item.name}
                </span>
              </Link>
            );
          })}
        </div>
        <div className="p-4 border-t border-white/10 flex-shrink-0">
          <button
            onClick={handleLogout}
            className="flex items-center w-full h-12 px-3 rounded-xl text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          >
            <LogOut className="h-6 w-6 flex-shrink-0" />
            <span className={`ml-3 font-medium whitespace-nowrap transition-opacity duration-300 ${isSidebarExpanded ? 'opacity-100' : 'opacity-0'}`}>
              Sair
            </span>
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className={`flex flex-col flex-1 transition-all duration-300 ${isSidebarExpanded ? 'lg:pl-64' : 'lg:pl-20'}`}>
        {/* Top Header */}
        {/* z-[25]: acima dos overlays de roteiro/plano (z-20) pra os dropdowns do header
            aparecerem; abaixo da sidebar expandida (z-30) e do menu mobile (z-50). */}
        <header className="sticky top-0 z-[25] flex items-center justify-center h-16 px-4 sm:px-6 lg:px-8 bg-[#f4f4f4] border-b border-gray-200">
          <div className="max-w-7xl w-full mx-auto flex items-center justify-between">
            <div className="flex items-center flex-1">
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-2 -ml-2 mr-2 text-gray-500 rounded-md hover:text-gray-900 focus:outline-none lg:hidden"
              >
                <Menu className="w-6 h-6" />
              </button>
              <div className="hidden sm:flex max-w-md w-full relative" ref={searchRef}>
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Search className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  className="block w-full pl-11 pr-4 py-2.5 border-none rounded-full leading-5 bg-[#e5e5e5] text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#00995D] sm:text-sm transition-colors"
                  placeholder="O que você procura?"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setShowSearch(true);
                  }}
                  onFocus={() => setShowSearch(true)}
                />
                {showSearch && searchQuery && (
                  <div className="absolute top-full left-0 mt-2 w-full bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50">
                    {searchResults.length > 0 ? (
                      searchResults.map(item => (
                        <Link
                          key={item.name}
                          to={item.href}
                          className="flex items-center px-4 py-2 hover:bg-gray-50 text-sm text-gray-700"
                          onClick={() => {
                            setShowSearch(false);
                            setSearchQuery('');
                          }}
                        >
                          <item.icon className="h-4 w-4 mr-3 text-gray-400" />
                          {item.name}
                        </Link>
                      ))
                    ) : (
                      <div className="px-4 py-2 text-sm text-gray-500">Nenhum resultado encontrado.</div>
                    )}
                  </div>
                )}
              </div>
            </div>
            
            <div className="flex items-center space-x-3 sm:space-x-5">
              <div className="relative" ref={accessRef}>
                <button 
                  onClick={() => setShowAccessibility(!showAccessibility)}
                  className="text-gray-500 hover:text-[#00995D] transition-colors flex items-center text-sm font-medium" 
                  title="Acessibilidade"
                >
                  Acessibilidade
                </button>
                {showAccessibility && (
                  <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50">
                    <div className="px-4 py-2 border-b border-gray-100"><h3 className="font-bold text-gray-800">Acessibilidade</h3></div>
                    <button onClick={() => setHighContrast(!highContrast)} className="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      Alto Contraste
                      <div className={`w-8 h-4 rounded-full transition-colors ${highContrast ? 'bg-[#00995D]' : 'bg-gray-300'} relative`}>
                        <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${highContrast ? 'translate-x-4' : ''}`}></div>
                      </div>
                    </button>
                    <button onClick={() => setLargeText(!largeText)} className="w-full flex items-center justify-between px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      Texto Grande
                      <div className={`w-8 h-4 rounded-full transition-colors ${largeText ? 'bg-[#00995D]' : 'bg-gray-300'} relative`}>
                        <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${largeText ? 'translate-x-4' : ''}`}></div>
                      </div>
                    </button>
                  </div>
                )}
              </div>
              
              <div className="h-5 w-px bg-gray-300 hidden sm:block"></div>
              
              <NotificationsBell />
              
              <Link to="/chamados" className="text-gray-500 hover:text-[#00995D] transition-colors" title="Ajuda">
                <HelpCircle className="h-6 w-6" />
              </Link>
              
              <div className="relative ml-2" ref={profileRef}>
                <button 
                  onClick={() => setShowProfile(!showProfile)}
                  className="flex items-center focus:outline-none"
                >
                  <div className="h-9 w-9 rounded-full bg-gray-300 flex items-center justify-center text-gray-600 overflow-hidden hover:ring-2 hover:ring-[#00995D] transition-all">
                    <User className="h-6 w-6 mt-1" />
                  </div>
                  <span className="ml-2 text-sm font-bold text-gray-700 hidden sm:block">{user.name.split(' ')[0]}</span>
                </button>
                {showProfile && (
                  <div className={`absolute right-0 mt-2 ${units.length > 1 ? 'w-72' : 'w-48'} bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50`}>
                    <div className="px-4 py-2 border-b border-gray-100">
                      <p className="text-sm font-bold text-gray-800 truncate">{user.name}</p>
                      <p className="text-xs text-gray-500 truncate">{user.email || 'prestador@unimed.com'}</p>
                    </div>
                    {units.length > 1 && (
                      <div className="border-b border-gray-100 py-1">
                        <p className="px-4 pt-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Unidade</p>
                        {units.map((u) => (
                          <button
                            key={u.user_id}
                            type="button"
                            disabled={u.current || !u.can_switch}
                            onClick={() => switchUnit(u.user_id)}
                            title={u.current ? 'Unidade atual' : u.can_switch ? 'Trocar para esta unidade' : 'Usa outro e-mail: saia e entre escolhendo esta unidade'}
                            className={`block w-full px-4 py-2 text-left text-sm ${u.current ? 'font-semibold text-[#00995D]' : u.can_switch ? 'text-gray-700 hover:bg-gray-50' : 'text-gray-500'}`}
                          >
                            {u.label}
                            {u.current && <span className="block text-xs font-normal text-gray-500">Unidade atual</span>}
                            {!u.current && !u.can_switch && <span className="block text-xs">Outro e-mail — saia e entre de novo</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    <Link to="/perfil" className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={() => setShowProfile(false)}>Meu Perfil</Link>
                    <Link to="/meus-dados" className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={() => setShowProfile(false)}>Meus dados</Link>
                    <Link to="/politica-privacidade" className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={() => setShowProfile(false)}>Política de Privacidade</Link>
                    <Link to="/dispositivos" className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={() => setShowProfile(false)}>Configurações</Link>
                    <button onClick={handleLogout} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50">Sair</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-[#f4f4f4] p-4 sm:p-6 lg:p-8">
          {/* Barra direita única em todas as páginas, inclusive o Dashboard (cliente, 2026-09-24). */}
          <div className="max-w-7xl mx-auto flex flex-col xl:flex-row gap-6 pb-10">
            {/* min-w-0 (não overflow-hidden): contém a largura do flex sem virar
                contexto de clipping, o que quebraria position: sticky dos filhos. */}
            <div className="flex-1 min-w-0">
              {blockedRoute ? <Navigate to="/dashboard" replace /> : <Outlet />}
            </div>
            <RightSidebar />
          </div>
        </main>
      </div>
    </div>
  );
}
