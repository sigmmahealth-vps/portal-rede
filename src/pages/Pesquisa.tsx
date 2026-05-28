import React, { useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { fetchApi } from '../lib/api';

export default function Pesquisa() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    
    const atendimento = formData.get('atendimento') as string;
    const comunicacao = formData.get('comunicacao') as string;
    const sugestoes = formData.get('sugestoes') as string;

    try {
      await fetchApi('/surveys', {
        method: 'POST',
        body: JSON.stringify({ atendimento, comunicacao, sugestoes })
      });
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Erro ao enviar pesquisa');
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
        <div className="flex justify-center mb-6">
          <CheckCircle className="h-20 w-20 text-[#00995D]" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Pesquisa Enviada!</h1>
        <p className="text-gray-600 mb-8">
          Agradecemos sua participação. Sua opinião é fundamental para aprimorarmos nossos serviços e o relacionamento com nossa rede de prestadores.
        </p>
        <button 
          onClick={() => window.history.back()}
          className="px-6 py-3 bg-[#00995D] text-white font-bold rounded-lg hover:bg-[#007A4A] transition-colors"
        >
          Voltar para o Início
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="relative h-48">
          <img 
            src="https://images.pexels.com/photos/5215024/pexels-photo-5215024.jpeg?auto=compress&cs=tinysrgb&w=1200" 
            alt="Médica no consultório" 
            className="w-full h-full object-cover object-[center_40%]"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent"></div>
          <div className="absolute bottom-0 left-0 p-6">
            <h1 className="text-3xl font-bold text-white mb-2">Pesquisa de Qualificação da Rede</h1>
            <p className="text-white/90">Ajude-nos a melhorar nossos serviços.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-8">
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-gray-900 border-b pb-2">1. Como você avalia o atendimento da Unimed Criciúma?</h3>
            <div className="space-y-2">
              {['Excelente', 'Bom', 'Regular', 'Ruim', 'Péssimo'].map((option) => (
                <label key={option} className="flex items-center space-x-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors">
                  <input type="radio" name="atendimento" value={option} required className="h-4 w-4 text-[#00995D] focus:ring-[#00995D]" />
                  <span className="text-gray-700">{option}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-bold text-gray-900 border-b pb-2">2. Qual a sua satisfação com os canais de comunicação?</h3>
            <div className="space-y-2">
              {['Muito Satisfeito', 'Satisfeito', 'Neutro', 'Insatisfeito', 'Muito Insatisfeito'].map((option) => (
                <label key={option} className="flex items-center space-x-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors">
                  <input type="radio" name="comunicacao" value={option} required className="h-4 w-4 text-[#00995D] focus:ring-[#00995D]" />
                  <span className="text-gray-700">{option}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-bold text-gray-900 border-b pb-2">3. Deixe suas sugestões ou comentários (Opcional)</h3>
            <textarea 
              name="sugestoes"
              rows={4} 
              className="w-full p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#00995D] focus:border-transparent outline-none resize-none"
              placeholder="Escreva aqui suas sugestões de melhoria..."
            ></textarea>
          </div>

          {error && (
            <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="pt-4 flex justify-end">
            <button 
              type="submit"
              disabled={loading}
              className="px-8 py-3 bg-[#00995D] text-white font-bold rounded-lg hover:bg-[#007A4A] transition-colors shadow-sm disabled:opacity-50"
            >
              {loading ? 'Enviando...' : 'Enviar Respostas'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
