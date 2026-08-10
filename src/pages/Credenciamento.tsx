import React, { useState, useEffect } from 'react';
import { FileText, CheckCircle, XCircle, Clock, Eye, Download } from 'lucide-react';
import { fetchApi } from '../lib/api';

interface CredentialingRequest {
  id: number;
  name: string;
  email: string;
  phone: string;
  specialty: string;
  file_url: string | null;
  status: string;
  created_at: string;
}

export default function Credenciamento() {
  const [requests, setRequests] = useState<CredentialingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRequest, setSelectedRequest] = useState<CredentialingRequest | null>(null);

  const fetchRequests = async () => {
    try {
      const data = await fetchApi(`/credentialing-requests?_t=${Date.now()}`);
      setRequests(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  const handleUpdateStatus = async (id: number, status: string) => {
    try {
      await fetchApi(`/credentialing-requests/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status })
      });
      
      fetchRequests();
      setSelectedRequest(null);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'aprovado':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-800 flex items-center"><CheckCircle className="w-3 h-3 mr-1" /> Aprovado</span>;
      case 'reprovado':
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800 flex items-center"><XCircle className="w-3 h-3 mr-1" /> Reprovado</span>;
      default:
        return <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800 flex items-center"><Clock className="w-3 h-3 mr-1" /> Pendente</span>;
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Carregando solicitações...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Solicitações de Credenciamento</h1>
        <p className="text-gray-600 mt-1">Gerencie as solicitações de novos prestadores interessados.</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="p-4 text-sm font-semibold text-gray-600">Data</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Nome do prestador</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Especialidade</th>
                <th className="p-4 text-sm font-semibold text-gray-600">Status</th>
                <th className="p-4 text-sm font-semibold text-gray-600 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {requests.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-gray-500">
                    Nenhuma solicitação encontrada.
                  </td>
                </tr>
              ) : (
                requests.map((req) => (
                  <tr key={req.id} className="hover:bg-gray-50 transition-colors">
                    <td className="p-4 text-sm text-gray-600">
                      {new Date(req.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="p-4">
                      <div className="font-medium text-gray-900">{req.name}</div>
                      <div className="text-xs text-gray-500">{req.email}</div>
                    </td>
                    <td className="p-4 text-sm text-gray-600">
                      {req.specialty}
                    </td>
                    <td className="p-4">
                      {getStatusBadge(req.status)}
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => setSelectedRequest(req)}
                        className="p-2 text-gray-400 hover:text-[#00995D] transition-colors"
                        title="Ver Detalhes"
                      >
                        <Eye className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detalhes Modal */}
      {selectedRequest && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">Detalhes da Solicitação</h3>
              <button onClick={() => setSelectedRequest(null)} className="text-gray-400 hover:text-gray-600">
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Nome do prestador</h4>
                  <p className="text-gray-900 font-medium">{selectedRequest.name}</p>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Especialidade / Serviço</h4>
                  <p className="text-gray-900 font-medium">{selectedRequest.specialty}</p>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">E-mail</h4>
                  <p className="text-gray-900 font-medium">{selectedRequest.email}</p>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Telefone</h4>
                  <p className="text-gray-900 font-medium">{selectedRequest.phone}</p>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Data da Solicitação</h4>
                  <p className="text-gray-900 font-medium">{new Date(selectedRequest.created_at).toLocaleString('pt-BR')}</p>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Status Atual</h4>
                  <div className="mt-1">{getStatusBadge(selectedRequest.status)}</div>
                </div>
              </div>

              {selectedRequest.file_url && (
                <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-100">
                  <h4 className="text-sm font-semibold text-blue-900 mb-2 flex items-center">
                    <FileText className="w-4 h-4 mr-2" />
                    Documento Anexado
                  </h4>
                  <a 
                    href={selectedRequest.file_url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-flex items-center px-3 py-1.5 bg-white border border-blue-200 rounded-md text-sm font-medium text-blue-700 hover:bg-blue-50 transition-colors"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Baixar Arquivo
                  </a>
                </div>
              )}

              <div className="border-t border-gray-100 pt-6">
                <h4 className="text-sm font-semibold text-gray-900 mb-4">Ações de Avaliação</h4>
                <div className="flex gap-3">
                  <button
                    onClick={() => handleUpdateStatus(selectedRequest.id, 'aprovado')}
                    disabled={selectedRequest.status === 'aprovado'}
                    className="flex-1 py-2 px-4 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                  >
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Aprovar Solicitação
                  </button>
                  <button
                    onClick={() => handleUpdateStatus(selectedRequest.id, 'reprovado')}
                    disabled={selectedRequest.status === 'reprovado'}
                    className="flex-1 py-2 px-4 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Reprovar Solicitação
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-3 text-center">
                  O interessado será notificado por e-mail sobre a decisão.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
