import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, X, Eye, EyeOff } from 'lucide-react';
import PasswordInput from '../components/PasswordInput';

// Unidade do prestador devolvida pelo login por CPF/CNPJ (1 acesso por unidade).
interface LoginUnit { user_id: number; label: string; has_email: boolean; must_change_password: boolean; email_masked: string | null; suggested_email: string | null; }

export default function Login() {
  const [email, setEmail] = useState(''); // CPF/CNPJ (prestador) ou e-mail (equipe interna)
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showCredenciamentoModal, setShowCredenciamentoModal] = useState(false);
  const [credenciamentoSuccess, setCredenciamentoSuccess] = useState(false);
  const [credenciamentoLoading, setCredenciamentoLoading] = useState(false);
  const [step, setStep] = useState<'password' | 'unit' | 'otp'>('password');
  // Etapa 'unit' (só prestador): escolha da unidade e, no primeiro acesso, nova senha e e-mail da unidade.
  // units = só as unidades em que a senha digitada confere (a senha é de cada unidade).
  const [pre, setPre] = useState<{ pre_token: string; units: LoginUnit[] } | null>(null);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [newPassword2, setNewPassword2] = useState('');
  const [unitEmail, setUnitEmail] = useState('');
  const [allUnits, setAllUnits] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState('');
  const [challengeId, setChallengeId] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(true);
  const [resendCooldown, setResendCooldown] = useState(0);
  const navigate = useNavigate();

  const selectedUnit = pre?.units.find((u) => u.user_id === unitId) ?? null;
  const needsEmail = !!selectedUnit && !selectedUnit.has_email;
  const mustChange = !!selectedUnit?.must_change_password;
  const hasOtherUnits = !!pre && pre.units.length > 1;

  const selectUnit = (u: LoginUnit) => {
    setUnitId(u.user_id);
    setUnitEmail(u.suggested_email ?? '');
  };

  // Resposta comum às etapas: ou pede o código, ou a sessão já saiu (dispositivo confiável).
  const afterAuth = (data: any) => {
    if (data.needs_otp) {
      setChallengeId(data.challenge_id);
      setMaskedEmail(data.email_masked ?? '');
      setCode('');
      setStep('otp');
      setResendCooldown(60);
    } else {
      localStorage.setItem('user', JSON.stringify(data.user));
      navigate('/dashboard');
    }
  };

  const enterUnit = async (body: Record<string, unknown>) => {
    const response = await fetch('/api/auth/unit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Erro ao entrar na unidade');
    afterAuth(data);
  };

  const handleUnitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pre) return;
    setError('');
    if (mustChange && newPassword !== newPassword2) {
      setError('As senhas não conferem.');
      return;
    }
    setLoading(true);
    try {
      await enterUnit({
        pre_token: pre.pre_token,
        user_id: unitId,
        new_password: mustChange ? newPassword : undefined,
        email: needsEmail ? unitEmail : undefined,
        all_units: needsEmail && allUnits,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const backToPassword = () => {
    setStep('password'); setError(''); setCode(''); setPassword('');
    setPre(null); setUnitId(null); setNewPassword(''); setNewPassword2(''); setUnitEmail(''); setAllUnits(false);
  };

  React.useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

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
        credentials: 'include',
        body: JSON.stringify({ login: email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Erro ao fazer login');
      }

      if (data.needs_unit) {
        const units: LoginUnit[] = data.units;
        // Nada a escolher nem a cadastrar: segue direto para o código.
        if (units.length === 1 && units[0].has_email && !units[0].must_change_password) {
          await enterUnit({ pre_token: data.pre_token, user_id: units[0].user_id });
        } else {
          setPre(data);
          if (units.length === 1) selectUnit(units[0]);
          setStep('unit');
        }
      } else {
        afterAuth(data);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ challenge_id: challengeId, code, trust_device: trustDevice, pre_token: pre?.pre_token }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Código inválido');
      localStorage.setItem('user', JSON.stringify(data.user));
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setError('');
    try {
      const response = await fetch('/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ challenge_id: challengeId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erro ao reenviar');
      setResendCooldown(60);
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Login Form */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center bg-[#f4f4f4] px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-md flex flex-col items-center mb-8">
          <img src="/logo-prp.png" alt="PRP — Portal da Rede de Prestadores" className="h-14 mb-4" />
          <p className="text-center text-gray-600 font-medium">
            Acesse o portal da rede de prestadores
          </p>
        </div>

        <div className="w-full max-w-md bg-white rounded-2xl shadow-sm p-8 border border-gray-100">
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-[#00995D]">Acesso</h2>
            <p className="text-sm text-gray-500 mt-1">
              {step === 'unit'
                ? (pre?.units.some((u) => u.must_change_password) ? 'Primeiro acesso: escolha a unidade e defina a senha dela' : 'Escolha a unidade para continuar')
                : step === 'otp' ? 'Confirme o código enviado por e-mail'
                : 'Use seu CPF/CNPJ e senha para entrar'}
            </p>
          </div>

          {step === 'password' ? (
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
                CPF/CNPJ
              </label>
              <input
                id="email"
                name="login"
                type="text"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full px-4 py-3 bg-[#f0f0f0] border border-transparent rounded-lg focus:bg-white focus:ring-2 focus:ring-[#00995D] focus:border-transparent transition-colors sm:text-sm"
                placeholder="CPF ou CNPJ do prestador"
              />
              <p className="mt-1 text-xs text-gray-500">Equipe Unimed: entre com o seu e-mail.</p>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Senha
                </label>
                <Link to="/esqueci-senha" className="text-xs font-medium text-gray-500 hover:text-[#00995D] underline decoration-gray-300 underline-offset-2">
                  Esqueceu sua senha?
                </Link>
              </div>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full px-4 py-3 pr-11 bg-[#f0f0f0] border border-transparent rounded-lg focus:bg-white focus:ring-2 focus:ring-[#00995D] focus:border-transparent transition-colors sm:text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-[#00995D]/40 rounded"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
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
          ) : step === 'unit' && pre ? (
          <form className="space-y-5" onSubmit={handleUnitSubmit}>
            {error && (
              <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-md">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" aria-hidden="true" />
                  <p className="ml-3 text-sm text-red-700">{error}</p>
                </div>
              </div>
            )}

            {pre.units.length > 1 && (
              <fieldset>
                <legend className="block text-sm font-medium text-gray-700 mb-2">Unidade</legend>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {pre.units.map((u) => (
                    <label
                      key={u.user_id}
                      className={`flex items-start gap-3 rounded-lg border p-3 text-sm cursor-pointer ${unitId === u.user_id ? 'border-[#00995D] bg-emerald-50' : 'border-gray-200 hover:bg-gray-50'}`}
                    >
                      <input type="radio" name="unit" required className="mt-1" checked={unitId === u.user_id} onChange={() => selectUnit(u)} />
                      <span>
                        <span className="block font-medium text-gray-800">{u.label}</span>
                        <span className="block text-xs text-gray-500">
                          {u.email_masked ? `Código enviado para ${u.email_masked}` : 'Ainda sem e-mail cadastrado'}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {mustChange && (
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  Você entrou com a senha provisória. Crie a senha definitiva desta unidade — cada unidade tem a própria senha.
                </p>
                <div>
                  <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1">Nova senha</label>
                  <PasswordInput id="new-password" required autoComplete="new-password" value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)} className="block w-full px-4 py-3 bg-[#f0f0f0] border border-transparent rounded-lg focus:bg-white focus:ring-2 focus:ring-[#00995D] focus:border-transparent transition-colors sm:text-sm" />
                </div>
                <div>
                  <label htmlFor="new-password2" className="block text-sm font-medium text-gray-700 mb-1">Confirmar nova senha</label>
                  <PasswordInput id="new-password2" required autoComplete="new-password" value={newPassword2}
                    onChange={(e) => setNewPassword2(e.target.value)} className="block w-full px-4 py-3 bg-[#f0f0f0] border border-transparent rounded-lg focus:bg-white focus:ring-2 focus:ring-[#00995D] focus:border-transparent transition-colors sm:text-sm" />
                </div>
                <p className="text-xs text-gray-500">Mínimo de 8 caracteres, com letra maiúscula, minúscula, número e símbolo.</p>
              </div>
            )}

            {needsEmail && (
              <div>
                <label htmlFor="unit-email" className="block text-sm font-medium text-gray-700 mb-1">E-mail da unidade</label>
                <input id="unit-email" type="email" required autoComplete="email" value={unitEmail}
                  onChange={(e) => setUnitEmail(e.target.value)} className="block w-full px-4 py-3 bg-[#f0f0f0] border border-transparent rounded-lg focus:bg-white focus:ring-2 focus:ring-[#00995D] focus:border-transparent transition-colors sm:text-sm" placeholder="contato@unidade.com.br" />
                <p className="mt-1 text-xs text-gray-500">
                  Este e-mail receberá o código de verificação e os avisos desta unidade. Vamos enviar um código para confirmá-lo.
                </p>
                {hasOtherUnits && (
                  <label className="mt-2 flex items-start gap-2 text-sm text-gray-700">
                    <input type="checkbox" className="mt-1" checked={allUnits} onChange={(e) => setAllUnits(e.target.checked)} />
                    Usar este e-mail para todas as unidades
                  </label>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-3 px-4 rounded-lg text-sm font-bold text-white bg-[#00995D] hover:bg-[#007A4A] disabled:opacity-50"
            >
              {loading ? 'Enviando...' : 'Continuar'}
            </button>
            <button type="button" onClick={backToPassword} className="text-xs text-gray-500 hover:text-[#00995D]">
              Voltar
            </button>
          </form>
          ) : (
          <form className="space-y-5" onSubmit={handleVerifyOtp}>
            {error && (
              <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-md">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" aria-hidden="true" />
                  <p className="ml-3 text-sm text-red-700">{error}</p>
                </div>
              </div>
            )}
            <p className="text-sm text-gray-600">
              Enviamos um código de 6 dígitos para <strong>{maskedEmail}</strong>.
            </p>
            <div>
              <label htmlFor="otp" className="block text-sm font-medium text-gray-700 mb-1">Código</label>
              <input
                id="otp"
                name="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
                className="block w-full px-4 py-3 bg-[#f0f0f0] border border-transparent rounded-lg focus:bg-white focus:ring-2 focus:ring-[#00995D] tracking-[0.5em] text-center text-lg sm:text-sm"
                placeholder="000000"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={trustDevice}
                onChange={(e) => setTrustDevice(e.target.checked)}
              />
              Confiar neste dispositivo por 90 dias
            </label>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-3 px-4 rounded-lg text-sm font-bold text-white bg-[#00995D] hover:bg-[#007A4A] disabled:opacity-50"
            >
              {loading ? 'Verificando...' : 'Verificar código'}
            </button>
            <div className="flex justify-between text-xs">
              <button
                type="button"
                onClick={backToPassword}
                className="text-gray-500 hover:text-[#00995D]"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={resendCooldown > 0}
                className="text-gray-500 hover:text-[#00995D] disabled:opacity-50"
              >
                {resendCooldown > 0 ? `Reenviar em ${resendCooldown}s` : 'Reenviar código'}
              </button>
            </div>
          </form>
          )}
        </div>

        <div className="w-full max-w-md mt-8">
          <img src="/logo-unimed-criciuma.png" alt="Unimed Criciúma" className="h-10 mx-auto" />
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nome do prestador</label>
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

      {/* Right Side - Background Image */}
      <div
        className="hidden lg:block lg:w-1/2 bg-[#0b1f14] bg-cover bg-center"
        style={{ backgroundImage: "url('/login-bg.jpg')" }}
      />
    </div>
  );
}
