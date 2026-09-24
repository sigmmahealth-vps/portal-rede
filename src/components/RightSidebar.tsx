import { Link } from 'react-router-dom';
import { FileText, GraduationCap, FileSignature, Award, MessageSquare, Library } from 'lucide-react';
import { useState, useEffect } from 'react';
import WhatsAppIcon from './WhatsAppIcon';

export default function RightSidebar() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  const isAdminOrAuditor = user?.role === 'admin' || user?.role === 'auditoria';

  return (
    <div className="w-full xl:w-80 space-y-6 flex-shrink-0">
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

      {/* Atalhos */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="text-sm font-bold text-gray-800 mb-4">Atalhos</h3>
        <div className="grid grid-cols-2 gap-3">
          {isAdminOrAuditor && (
            <Link to="/credenciamento" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
              <FileText className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
              <span className="text-xs font-medium text-gray-600 text-center">Credenciamento</span>
            </Link>
          )}
          <Link to="/documentos" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
            <FileText className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
            <span className="text-xs font-medium text-gray-600 text-center">Documentação</span>
          </Link>
          <Link to="/treinamentos" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
            <GraduationCap className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
            <span className="text-xs font-medium text-gray-600 text-center">Treinamentos</span>
          </Link>
          <Link to="/contratos" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
            <FileSignature className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
            <span className="text-xs font-medium text-gray-600 text-center">Contratos</span>
          </Link>
          <Link to="/qualificacao" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
            <Award className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
            <span className="text-xs font-medium text-gray-600 text-center">Qualificação</span>
          </Link>
          <Link to="/chamados" className="flex flex-col items-center justify-center p-4 rounded-xl border border-gray-100 hover:border-[#00995D] hover:shadow-sm transition-all group">
            <MessageSquare className="h-6 w-6 text-[#00995D] mb-2" strokeWidth={1.5} />
            <span className="text-xs font-medium text-gray-600 text-center">Chamados</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
