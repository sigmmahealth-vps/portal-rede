import { Link } from 'react-router-dom';
import { Award } from 'lucide-react';
import { useState, useEffect } from 'react';
import WhatsAppIcon from './WhatsAppIcon';
import { fetchApi } from '../lib/api';
import { fmtData } from '../lib/formatDate';
import { currentCertificate } from '../lib/sealVigente';

// Estilo do selo (cor de fundo, texto e rótulo) por nível.
const sealStyle = (seal: string | null) => {
  switch (seal) {
    case 'Ouro': return { bg: 'bg-[#FFD700]', border: 'border-yellow-200', text: 'text-yellow-800', label: 'SELO\nOURO' };
    case 'Prata': return { bg: 'bg-gray-300', border: 'border-gray-200', text: 'text-gray-700', label: 'SELO\nPRATA' };
    case 'Bronze': return { bg: 'bg-orange-300', border: 'border-orange-200', text: 'text-orange-900', label: 'SELO\nBRONZE' };
    default: return { bg: 'bg-gray-100', border: 'border-gray-200', text: 'text-gray-400', label: 'SEM\nSELO' };
  }
};

// Barra lateral única de todas as páginas (inclusive o Dashboard), fixa ao rolar em telas largas.
// Pedido do cliente (2026-09-24): selo só com certificado vigente; mesma barra em todo o portal.
export default function RightSidebar() {
  const [user, setUser] = useState<any>(null);
  const [cert, setCert] = useState<any>(null);
  const [providerSince, setProviderSince] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    const u = stored ? JSON.parse(stored) : null;
    setUser(u);
    if (!u?.provider_id) return;   // staff: sem selo/tempo de casa (não é prestador)
    fetchApi('/me/certificates').then((cs: any[]) => setCert(currentCertificate(cs || []))).catch(() => setCert(null));
    fetchApi('/me/provider').then((p: any) => setProviderSince(p?.created_at ?? null)).catch(() => {});
  }, []);

  const isProvider = !!user?.provider_id;
  const seal: string | null = cert?.seal ?? null;
  const st = sealStyle(seal);
  const pct = cert?.percentual != null ? `${Number(cert.percentual).toFixed(2).replace('.', ',')}%` : null;
  const years = providerSince
    ? Math.floor((Date.now() - new Date(providerSince).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
    : null;

  return (
    <aside className="w-full xl:w-80 space-y-6 flex-shrink-0 xl:sticky xl:top-0 xl:self-start">
      {/* Selo: só com certificado vigente */}
      {isProvider && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex flex-col items-center text-center">
          <div className={`w-24 h-24 ${st.bg} rounded-full flex items-center justify-center mb-4 shadow-inner border-4 ${st.border}`}>
            <span className={`text-xl font-black ${st.text} tracking-tighter leading-none`}>
              {st.label.split('\n').map((line, i) => <span key={i} className="block">{line}</span>)}
            </span>
          </div>
          <h3 className="text-sm font-bold text-gray-800">Sua qualificação na rede</h3>
          <p className="text-4xl font-black text-[#00995D] my-2">{pct ?? '—'}</p>
          {cert?.valid_until && <p className="text-xs text-gray-500">Certificado válido até {fmtData(cert.valid_until)}</p>}
          <Link
            to={cert ? '/qualificacao?aba=certificados' : '/qualificacao'}
            className="mt-3 px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium rounded-lg transition-colors"
          >
            {cert ? 'Ver meu certificado' : 'Responder roteiro'}
          </Link>
        </div>
      )}

      {/* Tempo de casa */}
      {isProvider && years != null && years >= 1 && (
        <div className="bg-[#e6f4ea] rounded-xl shadow-sm border border-[#cce8d6] p-5 relative overflow-hidden">
          <Award className="absolute -right-4 -bottom-4 h-24 w-24 text-[#00995D] opacity-10" />
          <h3 className="text-sm font-bold text-[#00995D] mb-2">Obrigado por fazer parte!</h3>
          <p className="text-xs text-gray-700 leading-relaxed">
            Você já integra a rede da <strong>Unimed Criciúma</strong> há <strong className="text-[#00995D]">{years} {years === 1 ? 'ano' : 'anos'}</strong>. Obrigado por fazer parte!
          </p>
        </div>
      )}

      {/* Precisa de ajuda */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <img src="/ajuda-suporte.webp" alt="Atendente do suporte Unimed com headset" className="w-full h-36 object-cover object-[center_30%]" />
        <div className="p-5">
          <h3 className="text-sm font-bold text-gray-800 mb-2">Precisa de ajuda?</h3>
          <p className="text-xs text-gray-500 mb-4">Nossa equipe de suporte está pronta para te auxiliar com qualquer dúvida.</p>
          <a href="https://wa.me/5548999999999" target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors">
            <WhatsAppIcon className="h-4 w-4 text-[#25D366]" /> Falar no WhatsApp
          </a>
        </div>
      </div>
    </aside>
  );
}
