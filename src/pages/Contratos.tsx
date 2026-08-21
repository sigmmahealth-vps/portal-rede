import React, { useEffect, useState } from 'react';
import { fetchApi } from '../lib/api';
import { FileSignature, Download, Eye, Plus, X, CheckCircle, AlertCircle } from 'lucide-react';

export default function Contratos() {
  const [contracts, setContracts] = useState<any[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [user, setUser] = useState<any>(null);

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSignModalOpen, setIsSignModalOpen] = useState(false);
  const [selectedContract, setSelectedContract] = useState<any>(null);

  // Form
  const [newContract, setNewContract] = useState({
    provider_id: '',
    title: '',
    expires_at: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      setUser(parsedUser);
      if (parsedUser.role === 'admin' || parsedUser.role === 'auditoria') {
        loadProviders();
      }
    }
    loadContracts();
  }, []);

  const loadContracts = async () => {
    try {
      const data = await fetchApi('/contracts');
      setContracts(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadProviders = async () => {
    try {
      const data = await fetchApi('/providers');
      setProviders(data);
    } catch (err: any) {
      console.error('Failed to load providers:', err);
    }
  };

  const handleCreateContract = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      alert('Por favor, selecione um arquivo.');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('provider_id', newContract.provider_id);
      formData.append('title', newContract.title);
      if (newContract.expires_at) {
        formData.append('expires_at', newContract.expires_at);
      }
      formData.append('file', file);

      const contract = await fetchApi('/contracts', {
        method: 'POST',
        body: formData,
      });
      
      // Add provider name for admin view
      if (user?.role === 'admin' || user?.role === 'auditoria') {
        const provider = providers.find(p => p.id.toString() === newContract.provider_id);
        if (provider) {
          contract.provider_name = provider.name;
        }
      }

      setContracts([contract, ...contracts]);
      setIsModalOpen(false);
      setNewContract({ provider_id: '', title: '', expires_at: '' });
      setFile(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleSignContract = async () => {
    if (!selectedContract) return;
    
    setSigning(true);
    try {
      const updatedContract = await fetchApi(`/contracts/${selectedContract.id}/sign`, {
        method: 'PUT',
      });
      
      setContracts(contracts.map(c => c.id === updatedContract.id ? updatedContract : c));
      setIsSignModalOpen(false);
      setSelectedContract(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSigning(false);
    }
  };

  const handleDownload = async (id: number, title: string) => {
    try {
      const response = await fetch(`/api/contracts/${id}/download`, {
        credentials: 'include',
      });

      if (!response.ok) throw new Error('Failed to download file');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title}.pdf`; // Assuming PDF for now
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      alert('Erro ao baixar arquivo: ' + err.message);
    }
  };

  const isAdmin = user?.role === 'admin' || user?.role === 'auditoria';

  if (loading) return <div className="p-8 text-center text-gray-500">Carregando contratos...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">
          {isAdmin ? 'Gestão de Contratos' : 'Meus Contratos'}
        </h1>
        {isAdmin && (
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <Plus className="h-5 w-5 mr-2" />
            Novo Contrato
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Documento</th>
                {isAdmin && <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Prestador</th>}
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data Assinatura</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Validade</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {contracts.map((contrato) => (
                <tr key={contrato.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <FileSignature className="h-5 w-5 text-emerald-600 mr-3" />
                      <div className="text-sm font-medium text-gray-900">{contrato.title}</div>
                    </div>
                  </td>
                  {isAdmin && (
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {contrato.provider_name}
                    </td>
                  )}
                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                      contrato.status === 'ativo' ? 'bg-emerald-100 text-emerald-800' : 
                      contrato.status === 'pendente' ? 'bg-amber-100 text-amber-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {contrato.status === 'pendente' ? 'Pendente Assinatura' : 
                       contrato.status === 'ativo' ? 'Ativo' : 'Vencido'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {contrato.signed_at ? new Date(contrato.signed_at).toLocaleDateString('pt-BR') : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {contrato.expires_at ? new Date(contrato.expires_at).toLocaleDateString('pt-BR') : 'Indeterminado'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    {contrato.status === 'pendente' && !isAdmin && (
                      <button 
                        onClick={() => {
                          setSelectedContract(contrato);
                          setIsSignModalOpen(true);
                        }}
                        className="text-emerald-600 hover:text-emerald-900 mr-4 font-bold"
                      >
                        Assinar
                      </button>
                    )}
                    <button 
                      onClick={() => handleDownload(contrato.id, contrato.title)}
                      className="text-gray-600 hover:text-emerald-600" 
                      title="Baixar Arquivo"
                    >
                      <Download className="h-5 w-5 inline" />
                    </button>
                  </td>
                </tr>
              ))}
              {contracts.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} className="px-6 py-8 text-center text-gray-500">
                    Nenhum contrato encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upload Modal (Admin only) */}
      {isModalOpen && isAdmin && (
        <div className="fixed inset-0 z-[100] overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setIsModalOpen(false)}></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <form onSubmit={handleCreateContract}>
                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                      Novo Contrato
                    </h3>
                    <button type="button" onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Prestador</label>
                      <select 
                        required 
                        value={newContract.provider_id} 
                        onChange={(e) => setNewContract({...newContract, provider_id: e.target.value})} 
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm"
                      >
                        <option value="">Selecione um prestador</option>
                        {providers.map(p => (
                          <option key={p.id} value={p.id}>{p.name} ({p.cnpj})</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Título do Contrato</label>
                      <input 
                        type="text" 
                        required 
                        value={newContract.title} 
                        onChange={(e) => setNewContract({...newContract, title: e.target.value})} 
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm" 
                        placeholder="Ex: Aditivo Contratual 2024"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Data de Validade (Opcional)</label>
                      <input 
                        type="date" 
                        value={newContract.expires_at} 
                        onChange={(e) => setNewContract({...newContract, expires_at: e.target.value})} 
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm" 
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Arquivo PDF</label>
                      <input 
                        type="file" 
                        required 
                        accept=".pdf"
                        onChange={(e) => setFile(e.target.files ? e.target.files[0] : null)} 
                        className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100" 
                      />
                    </div>
                  </div>
                </div>
                <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button 
                    type="submit" 
                    disabled={uploading}
                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-emerald-600 text-base font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                  >
                    {uploading ? 'Enviando...' : 'Salvar Contrato'}
                  </button>
                  <button type="button" onClick={() => setIsModalOpen(false)} className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm">
                    Cancelar
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Sign Modal (Provider only) */}
      {isSignModalOpen && selectedContract && (
        <div className="fixed inset-0 z-[100] overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setIsSignModalOpen(false)}></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-emerald-100 sm:mx-0 sm:h-10 sm:w-10">
                    <FileSignature className="h-6 w-6 text-emerald-600" aria-hidden="true" />
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                      Assinar Contrato
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Você está prestes a assinar digitalmente o documento:
                      </p>
                      <p className="text-md font-bold text-gray-900 mt-2">
                        {selectedContract.title}
                      </p>
                      <p className="text-sm text-gray-500 mt-4">
                        Ao clicar em "Assinar Digitalmente", você concorda com os termos descritos no documento. Esta ação tem validade legal e registrará sua assinatura com data e hora atuais.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button 
                  type="button" 
                  onClick={handleSignContract}
                  disabled={signing}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-emerald-600 text-base font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                >
                  {signing ? 'Assinando...' : 'Assinar Digitalmente'}
                </button>
                <button 
                  type="button" 
                  onClick={() => setIsSignModalOpen(false)} 
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
