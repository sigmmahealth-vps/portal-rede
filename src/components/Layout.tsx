import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  FileText, 
  GraduationCap, 
  DollarSign, 
  BarChart3, 
  MessageSquare, 
  Library, 
  FileSignature,
  ClipboardCheck,
  Award,
  LogOut,
  Menu,
  X,
  Search,
  Bell,
  Accessibility,
  User,
  Users,
  HelpCircle,
  Shield
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import RightSidebar from './RightSidebar';
import { fetchApi } from '../lib/api';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Gestão Documental', href: '/documentos', icon: FileText },
  { name: 'Qualificação da Rede', href: '/qualificacao', icon: Award },
  { name: 'Equipe / Profissionais', href: '/equipe', icon: Users },
  { name: 'Credenciamento', href: '/credenciamento', icon: ClipboardCheck },
  { name: 'Treinamentos', href: '/treinamentos', icon: GraduationCap },
  { name: 'Financeiro', href: '/em-construcao', icon: DollarSign, standby: true },
  { name: 'Indicadores', href: '/em-construcao', icon: BarChart3, standby: true },
  { name: 'Chamados', href: '/chamados', icon: MessageSquare },
  { name: 'Contratos', href: '/contratos', icon: FileSignature },
  { name: 'Agenda de Auditorias', href: '/em-construcao', icon: ClipboardCheck, standby: true },
  { name: 'Administração', href: '/admin', icon: Shield }, // Admin should probably be kept for user management, but let's see.
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);

  const isAdmin = user?.role === 'admin' || user?.role === 'auditoria';
  const isCooperado = user?.role === 'cooperado';

  // Módulos de pessoa jurídica (prestador/PJ) que não se aplicam ao médico cooperado (PF).
  const COOPERADO_HIDDEN = ['Gestão Documental', 'Contratos', 'Financeiro'];

  const filteredNavigation = navigation.filter(item => {
    if ((item.name === 'Administração' || item.name === 'Credenciamento') && !isAdmin) return false;
    if (isCooperado && COOPERADO_HIDDEN.includes(item.name)) return false;

    return true;
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showAccessibility, setShowAccessibility] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [largeText, setLargeText] = useState(false);

  const searchRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const accessRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) setShowSearch(false);
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) setShowNotifications(false);
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
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      navigate('/login');
    } else {
      setUser(JSON.parse(storedUser));
    }
  }, [navigate]);

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
      {/* Mobile sidebar */}
      <div className={`fixed inset-0 z-50 lg:hidden ${sidebarOpen ? 'block' : 'hidden'}`}>
        <div className="fixed inset-0 bg-gray-900/80" onClick={() => setSidebarOpen(false)} />
        <div className="fixed inset-y-0 left-0 w-64 bg-[#00995D] flex flex-col shadow-xl">
          <div className="flex items-center justify-between h-16 px-4 bg-white border-b">
            <img src="/logo.svg" alt="Unimed Rede+" className="h-10" />
            <button onClick={() => setSidebarOpen(false)} className="text-gray-500">
              <X className="w-6 h-6" />
            </button>
          </div>
          <nav className="flex-1 px-2 py-4 space-y-2 overflow-y-auto">
            {filteredNavigation.map((item) => {
              const isActive = location.pathname === item.href;
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  className={`flex items-center px-3 py-3 text-sm font-medium rounded-lg transition-colors ${
                    isActive ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
                  } ${item.standby ? 'opacity-50' : ''}`}
                  onClick={() => setSidebarOpen(false)}
                >
                  <item.icon className={`mr-3 flex-shrink-0 h-5 w-5 ${isActive ? 'text-white' : 'text-white/70'}`} />
                  <span className="flex-1">{item.name}</span>
                  {item.standby && (
                    <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded text-white ml-2">Em breve</span>
                  )}
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
          <img src="/logo.svg" alt="Unimed" className="h-8 object-contain transition-all duration-300" />
        </div>
        <div className="flex flex-col flex-1 overflow-y-auto py-4 space-y-2 px-3">
          {filteredNavigation.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.name}
                to={item.href}
                className={`flex items-center h-12 rounded-xl transition-all px-3 ${
                  isActive ? 'bg-white/20 text-white shadow-inner' : 'text-white/70 hover:bg-white/10 hover:text-white'
                } ${item.standby ? 'opacity-50' : ''}`}
              >
                <item.icon className="h-6 w-6 flex-shrink-0" strokeWidth={isActive ? 2.5 : 2} />
                <span className={`ml-3 font-medium whitespace-nowrap transition-opacity duration-300 flex-1 flex items-center justify-between ${isSidebarExpanded ? 'opacity-100' : 'opacity-0'}`}>
                  {item.name}
                  {item.standby && (
                    <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded text-white ml-2">Em breve</span>
                  )}
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
        <header className="sticky top-0 z-10 flex items-center justify-center h-16 px-4 sm:px-6 lg:px-8 bg-[#f4f4f4] border-b border-gray-200">
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
              
              <div className="relative" ref={notifRef}>
                <button 
                  onClick={() => setShowNotifications(!showNotifications)}
                  className="text-gray-500 hover:text-[#00995D] transition-colors relative" 
                  title="Notificações"
                >
                  <Bell className="h-6 w-6" />
                  <span className="absolute top-0 right-0 block h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-[#f4f4f4]" />
                </button>
                {showNotifications && (
                  <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50">
                    <div className="px-4 py-2 border-b border-gray-100"><h3 className="font-bold text-gray-800">Notificações</h3></div>
                    <div className="max-h-64 overflow-y-auto">
                      <div className="px-4 py-3 hover:bg-gray-50 border-b border-gray-50 cursor-pointer">
                        <p className="text-sm text-gray-800 font-medium">Novo documento disponível</p>
                        <p className="text-xs text-gray-500">Manual de Faturamento 2026</p>
                      </div>
                      <div className="px-4 py-3 hover:bg-gray-50 border-b border-gray-50 cursor-pointer">
                        <p className="text-sm text-gray-800 font-medium">Chamado #2345 atualizado</p>
                        <p className="text-xs text-gray-500">Sua solicitação foi respondida.</p>
                      </div>
                    </div>
                    <div className="px-4 py-2 text-center border-t border-gray-100">
                      <button className="text-xs font-bold text-[#00995D]">Ver todas</button>
                    </div>
                  </div>
                )}
              </div>
              
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
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-50">
                    <div className="px-4 py-2 border-b border-gray-100">
                      <p className="text-sm font-bold text-gray-800 truncate">{user.name}</p>
                      <p className="text-xs text-gray-500 truncate">{user.email || 'prestador@unimed.com'}</p>
                    </div>
                    <Link to="/perfil" className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={() => setShowProfile(false)}>Meu Perfil</Link>
                    <Link to="/meus-dados" className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={() => setShowProfile(false)}>Meus dados</Link>
                    <Link to="/dispositivos" className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50" onClick={() => setShowProfile(false)}>Configurações</Link>
                    <button onClick={handleLogout} className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50">Sair</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-[#f4f4f4] p-4 sm:p-6 lg:p-8">
          {location.pathname === '/dashboard' ? (
            <Outlet />
          ) : (
            <div className="max-w-7xl mx-auto flex flex-col xl:flex-row gap-6 pb-10">
              <div className="flex-1 overflow-hidden">
                <Outlet />
              </div>
              <RightSidebar />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
