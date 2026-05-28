import React, { useEffect, useState } from 'react';
import { fetchApi } from '../lib/api';
import { DollarSign, FileText, AlertTriangle, Download, Upload, X } from 'lucide-react';

export default function Financeiro() {
  const [financials, setFinancials] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [user, setUser] = useState<any>(null);

  // Upload NF Modal
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [competence, setCompetence] = useState('');
  const [nfValue, setNfValue] = useState('');
  const [nfFile, setNfFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }

    const loadFinancials = async () => {
      try {
        const data = await fetchApi('/financials');
        setFinancials(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    loadFinancials();
  }, []);

  const handleUploadNF = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nfFile) return alert('Selecione o arquivo da Nota Fiscal');

    setUploading(true);
    // In a real app, this would send a FormData request to the backend
    try {
      // Simulating API call
      await new Promise(resolve => setTimeout(resolve, 1500));
      alert('Nota Fiscal enviada com sucesso! Ela passará por análise.');
      setShowUploadModal(false);
      setCompetence('');
      setNfValue('');
      setNfFile(null);
    } catch (err: any) {
      alert(err.message || 'Erro ao enviar Nota Fiscal');
    } finally {
      setUploading(false);
    }
  };

  const isAdmin = user?.role === 'admin' || user?.role === 'auditoria';

  if (loading) return <div className="p-8 text-center text-gray-500">Carregando financeiro...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Financeiro e Faturamento</h1>
        {!isAdmin && (
          <button 
            onClick={() => setShowUploadModal(true)}
            className="flex items-center px-4 py-2 bg-[#00995D] text-white rounded-lg hover:bg-[#007A4A] transition-colors"
          >
            <Upload className="h-5 w-5 mr-2" />
            Enviar Nota Fiscal
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Competência</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Prestador</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Valor Bruto</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Glosas</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Valor Líquido</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {financials.map((fin) => (
                <tr key={fin.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <DollarSign className="h-5 w-5 text-gray-400 mr-3" />
                      <div className="text-sm font-medium text-gray-900">{fin.competence}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {fin.provider_name || 'Meu Faturamento'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                    R$ {fin.gross_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600 text-right font-medium">
                    - R$ {fin.glosa_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-emerald-600 text-right font-bold">
                    R$ {fin.net_value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      fin.status === 'Pago' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {fin.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button className="text-gray-600 hover:text-emerald-600 mr-3" title="Baixar Extrato">
                      <Download className="h-5 w-5 inline" />
                    </button>
                    {fin.glosa_value > 0 && (
                      <button className="text-amber-600 hover:text-amber-800" title="Recurso de Glosa">
                        <AlertTriangle className="h-5 w-5 inline" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {financials.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                    Nenhum registro financeiro encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upload NF Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-900">Enviar Nota Fiscal</h3>
              <button onClick={() => setShowUploadModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleUploadNF} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Competência (Mês/Ano)</label>
                <input 
                  type="text" 
                  placeholder="Ex: 10/2025"
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D]"
                  value={competence}
                  onChange={(e) => setCompetence(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Valor da Nota (R$)</label>
                <input 
                  type="number" 
                  step="0.01"
                  placeholder="Ex: 1500.00"
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D]"
                  value={nfValue}
                  onChange={(e) => setNfValue(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Arquivo da NF (PDF ou XML)</label>
                <input 
                  type="file" 
                  accept=".pdf,.xml"
                  onChange={(e) => setNfFile(e.target.files?.[0] || null)}
                  className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-[#00995D] hover:file:bg-emerald-100"
                  required
                />
              </div>
              <div className="pt-4 flex justify-end space-x-3">
                <button 
                  type="button" 
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={uploading}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#00995D] hover:bg-[#007A4A] rounded-lg transition-colors disabled:opacity-50"
                >
                  {uploading ? 'Enviando...' : 'Enviar NF'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
