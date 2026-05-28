import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, X } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCredenciamentoModal, setShowCredenciamentoModal] = useState(false);
  const [credenciamentoSuccess, setCredenciamentoSuccess] = useState(false);
  const [credenciamentoLoading, setCredenciamentoLoading] = useState(false);
  const navigate = useNavigate();

  const handleCredenciamentoSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCredenciamentoLoading(true);
    
    const formData = new FormData(e.currentTarget);
    
    try {
      const response = await fetch('/api/credentialing-requests', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Erro ao enviar solicitação');
      }

      setCredenciamentoSuccess(true);
    } catch (err: any) {
      alert(`Erro ao enviar solicitação: ${err.message}`);
    } finally {
      setCredenciamentoLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao fazer login');
      }

      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Login Form */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center bg-[#f4f4f4] px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-md flex flex-col items-center mb-8">
          <img src="/logo.svg" alt="Unimed Rede+" className="h-16 mb-4" />
          <p className="text-center text-gray-600 font-medium">
            Acesse o portal da rede de prestadores
          </p>
        </div>

        <div className="w-full max-w-md bg-white rounded-2xl shadow-sm p-8 border border-gray-100">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-[#00995D]">Acesso</h2>
            <p className="text-sm text-gray-500 mt-1">
              Use seu e-mail e senha para entrar
            </p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-md">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" aria-hidden="true" />
                  <p className="ml-3 text-sm text-red-700">{error}</p>
                </div>
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                E-mail
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full px-4 py-3 bg-[#f0f0f0] border border-transparent rounded-lg focus:bg-white focus:ring-2 focus:ring-[#00995D] focus:border-transparent transition-colors sm:text-sm"
                placeholder="seu.email@exemplo.com"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Senha
                </label>
                <a href="#" className="text-xs font-medium text-gray-500 hover:text-[#00995D] underline decoration-gray-300 underline-offset-2">
                  Esqueceu sua senha?
                </a>
              </div>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full px-4 py-3 bg-[#f0f0f0] border border-transparent rounded-lg focus:bg-white focus:ring-2 focus:ring-[#00995D] focus:border-transparent transition-colors sm:text-sm"
              />
            </div>

            <div className="pt-2 space-y-3">
              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-bold text-white bg-[#00995D] hover:bg-[#007A4A] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#00995D] transition-colors disabled:opacity-50"
              >
                {loading ? 'Entrando...' : 'Entrar'}
              </button>
              
              <button
                type="button"
                onClick={() => setShowCredenciamentoModal(true)}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg text-sm font-bold text-gray-700 bg-[#e5e5e5] hover:bg-[#d4d4d4] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 transition-colors"
              >
                Quero ser credenciado
              </button>
            </div>
          </form>

          <div className="mt-8 pt-6 border-t border-gray-100">
            <div className="bg-blue-50 p-4 rounded-lg text-xs text-blue-800">
              <strong className="block mb-1">Credenciais de Teste (MVP):</strong>
              <ul className="list-disc pl-4 space-y-1">
                <li>prestador@unimed.com / senha123</li>
                <li>cooperado@unimed.com / senha123</li>
                <li>admin@unimed.com / senha123</li>
                <li>auditoria@unimed.com / senha123</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Credenciamento Modal */}
      {showCredenciamentoModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center shrink-0">
              <h3 className="text-lg font-bold text-gray-900">Quero ser credenciado</h3>
              <button onClick={() => { setShowCredenciamentoModal(false); setCredenciamentoSuccess(false); }} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            {credenciamentoSuccess ? (
              <div className="p-8 text-center overflow-y-auto">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                  </svg>
                </div>
                <h4 className="text-xl font-bold text-gray-900 mb-2">Solicitação Enviada!</h4>
                <p className="text-gray-600 mb-6">
                  Sua solicitação de credenciamento foi enviada com sucesso. Nossa equipe analisará as informações e entrará em contato via e-mail em breve.
                </p>
                <button
                  onClick={() => { setShowCredenciamentoModal(false); setCredenciamentoSuccess(false); }}
                  className="w-full py-2 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-[#00995D] hover:bg-[#007A4A] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#00995D]"
                >
                  Fechar
                </button>
              </div>
            ) : (
              <form onSubmit={handleCredenciamentoSubmit} className="p-6 space-y-4 overflow-y-auto">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nome Completo / Razão Social</label>
                  <input type="text" name="name" required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00995D]" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
                  <input type="email" name="email" required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00995D]" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
                  <input type="tel" name="phone" required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00995D]" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Especialidade / Serviço</label>
                  <select name="specialty" required className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00995D]">
                    <option value="">Selecione um serviço...</option>
                    <option value="Clinica">Clínica</option>
                    <option value="Laboratorio">Laboratório</option>
                    <option value="Hospital">Hospital</option>
                    <option value="SADT">SADT (Serviço de Apoio Diagnóstico Terapêutico)</option>
                    <option value="Terapias">Terapias (Psicologia, Fisioterapia, etc)</option>
                    <option value="Home Care">Home Care</option>
                    <option value="Odontologia">Odontologia</option>
                    <option value="Outros">Outros Serviços</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Currículo / Portfólio / Apresentação (Opcional)</label>
                  <input type="file" name="file" accept=".pdf,.doc,.docx,.ppt,.pptx" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00995D] text-sm" />
                </div>
                <div className="pt-4 flex justify-end space-x-3 shrink-0">
                  <button type="button" onClick={() => setShowCredenciamentoModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                    Cancelar
                  </button>
                  <button type="submit" disabled={credenciamentoLoading} className="px-4 py-2 text-sm font-medium text-white bg-[#00995D] hover:bg-[#007A4A] rounded-lg transition-colors disabled:opacity-50">
                    {credenciamentoLoading ? 'Enviando...' : 'Enviar Solicitação'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Right Side - Background Pattern */}
      <div className="hidden lg:block lg:w-1/2 relative bg-[#041d10] overflow-hidden">
        {/* Abstract Network Pattern Simulation */}
        <div className="absolute inset-0 opacity-40" style={{
          backgroundImage: `radial-gradient(circle at 20% 30%, rgba(0, 255, 100, 0.15) 0%, transparent 50%),
                            radial-gradient(circle at 80% 70%, rgba(0, 255, 100, 0.15) 0%, transparent 50%),
                            radial-gradient(circle at 50% 50%, rgba(0, 255, 100, 0.1) 0%, transparent 60%)`
        }}></div>
        
        {/* Dots and lines simulation using SVG */}
        <svg className="absolute inset-0 w-full h-full opacity-30" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="network" x="0" y="0" width="100" height="100" patternUnits="userSpaceOnUse">
              <circle cx="20" cy="20" r="2" fill="#4ade80" />
              <circle cx="80" cy="40" r="3" fill="#4ade80" />
              <circle cx="40" cy="80" r="1.5" fill="#4ade80" />
              <circle cx="90" cy="90" r="2.5" fill="#4ade80" />
              <line x1="20" y1="20" x2="80" y2="40" stroke="#4ade80" strokeWidth="0.5" />
              <line x1="20" y1="20" x2="40" y2="80" stroke="#4ade80" strokeWidth="0.5" />
              <line x1="80" y1="40" x2="90" y2="90" stroke="#4ade80" strokeWidth="0.5" />
              <line x1="40" y1="80" x2="90" y2="90" stroke="#4ade80" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect x="0" y="0" width="100%" height="100%" fill="url(#network)" />
        </svg>
      </div>
    </div>
  );
}
