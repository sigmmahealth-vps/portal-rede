import React, { useEffect, useState } from 'react';
import { fetchApi } from '../lib/api';
import { FileText, Upload, CheckCircle, XCircle, Clock, Eye, Check, X, Search, Filter, Download, ZoomIn, ZoomOut } from 'lucide-react';

export default function Documentos() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [user, setUser] = useState<any>(null);
  
  // Search and Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sortOrder, setSortOrder] = useState('newest');
  
  // Upload Modal State
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadType, setUploadType] = useState('Alvará de Localização');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [providers, setProviders] = useState<any[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editingDocId, setEditingDocId] = useState<number | null>(null);

  // Admin Modal State
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<any>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [adminIssueDate, setAdminIssueDate] = useState('');
  const [adminExpiryDate, setAdminExpiryDate] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  // Viewer Modal State
  const [showViewerModal, setShowViewerModal] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);

  const loadDocs = async () => {
    try {
      const data = await fetchApi('/documents');
      setDocuments(data);
      if (isAdmin) {
        const providersData = await fetchApi('/providers');
        setProviders(providersData);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    loadDocs();
  }, []);

  const getComputedStatus = (doc: any) => {
    if (doc.status === 'historico') return 'historico';
    if (doc.status === 'valido' && doc.expiry_date) {
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Reset time for accurate date comparison
      const expiryDate = new Date(doc.expiry_date);
      if (expiryDate < today) {
        return 'vencido';
      }
    }
    return doc.status;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'valido': return <CheckCircle className="h-5 w-5 text-emerald-500" />;
      case 'reprovado': return <XCircle className="h-5 w-5 text-red-500" />;
      case 'vencido': return <XCircle className="h-5 w-5 text-amber-500" />;
      case 'pendente': return <Clock className="h-5 w-5 text-blue-500" />;
      case 'historico': return <Clock className="h-5 w-5 text-gray-500" />;
      default: return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'valido': return <span className="px-2 py-1 text-xs font-medium rounded-full bg-emerald-100 text-emerald-800">Válido</span>;
      case 'reprovado': return <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-100 text-red-800">Reprovado</span>;
      case 'vencido': return <span className="px-2 py-1 text-xs font-medium rounded-full bg-amber-100 text-amber-800">Vencido</span>;
      case 'pendente': return <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">Pendente</span>;
      case 'historico': return <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">Histórico</span>;
      default: return null;
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file && !editingDocId) return alert('Selecione um arquivo');

    setUploading(true);
    const formData = new FormData();
    if (file) formData.append('file', file);
    formData.append('type', uploadType);
    if (issueDate) formData.append('issue_date', issueDate);
    if (expiryDate) formData.append('expiry_date', expiryDate);
    if (isAdmin && selectedProviderId) {
      formData.append('provider_id', selectedProviderId);
    }

    try {
      if (editingDocId) {
        await fetchApi(`/documents/${editingDocId}`, {
          method: 'PUT',
          body: formData,
        });
      } else {
        await fetchApi('/documents', {
          method: 'POST',
          body: formData,
        });
      }
      setShowUploadModal(false);
      setFile(null);
      setIssueDate('');
      setExpiryDate('');
      setSelectedProviderId('');
      setEditingDocId(null);
      loadDocs(); // Reload list
    } catch (err: any) {
      alert(err.message || 'Erro ao enviar documento');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Tem certeza que deseja excluir este documento?')) return;
    try {
      await fetchApi(`/documents/${id}`, {
        method: 'DELETE',
      });
      loadDocs();
    } catch (err: any) {
      alert(err.message || 'Erro ao excluir documento');
    }
  };

  const openEditModal = (doc: any) => {
    setEditingDocId(doc.id);
    setUploadType(doc.type);
    setIssueDate(doc.issue_date ? new Date(doc.issue_date).toISOString().split('T')[0] : '');
    setExpiryDate(doc.expiry_date ? new Date(doc.expiry_date).toISOString().split('T')[0] : '');
    setSelectedProviderId(doc.provider_id ? String(doc.provider_id) : '');
    setFile(null);
    setShowUploadModal(true);
  };

  const openAdminModal = (doc: any) => {
    setSelectedDoc(doc);
    setAdminIssueDate(doc.issue_date ? new Date(doc.issue_date).toISOString().split('T')[0] : '');
    setAdminExpiryDate(doc.expiry_date ? new Date(doc.expiry_date).toISOString().split('T')[0] : '');
    setZoomLevel(1);
    setShowAdminModal(true);
  };

  const handleStatusUpdate = async (status: string) => {
    if (!selectedDoc) return;
    setUpdatingStatus(true);
    try {
      await fetchApi(`/documents/${selectedDoc.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ 
          status,
          issue_date: adminIssueDate || undefined,
          expiry_date: adminExpiryDate || undefined,
          rejection_reason: status === 'reprovado' ? rejectionReason : undefined
        }),
      });
      setShowAdminModal(false);
      setSelectedDoc(null);
      setAdminIssueDate('');
      setAdminExpiryDate('');
      setRejectionReason('');
      loadDocs(); // Reload list
    } catch (err: any) {
      alert(err.message || 'Erro ao atualizar status');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleExportReport = () => {
    // Basic CSV export
    const headers = ['Tipo de Documento', 'Prestador', 'Data de Emissão', 'Data de Validade', 'Status'];
    const csvContent = [
      headers.join(','),
      ...filteredDocuments.map(doc => [
        `"${doc.type}"`,
        `"${doc.provider_name || '-'}"`,
        doc.issue_date ? new Date(doc.issue_date).toLocaleDateString('pt-BR') : '-',
        doc.expiry_date ? new Date(doc.expiry_date).toLocaleDateString('pt-BR') : '-',
        getComputedStatus(doc)
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'relatorio_documentos.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isAdmin = user?.role === 'admin' || user?.role === 'auditoria';

  const filteredDocuments = documents.filter(doc => {
    const computedStatus = getComputedStatus(doc);
    const matchesSearch = (doc.type.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (doc.provider_name && doc.provider_name.toLowerCase().includes(searchTerm.toLowerCase())));
    const matchesStatus = statusFilter ? computedStatus === statusFilter : true;
    const matchesType = typeFilter ? doc.type === typeFilter : true;
    
    if (statusFilter === 'historico') {
      return matchesSearch && matchesStatus && matchesType;
    }
    
    return matchesSearch && matchesStatus && matchesType && computedStatus !== 'historico';
  }).sort((a, b) => {
    switch (sortOrder) {
      case 'newest':
        return new Date(b.upload_date || 0).getTime() - new Date(a.upload_date || 0).getTime();
      case 'oldest':
        return new Date(a.upload_date || 0).getTime() - new Date(b.upload_date || 0).getTime();
      case 'type_asc':
        return a.type.localeCompare(b.type);
      case 'type_desc':
        return b.type.localeCompare(a.type);
      case 'provider_asc':
        return (a.provider_name || '').localeCompare(b.provider_name || '');
      case 'provider_desc':
        return (b.provider_name || '').localeCompare(a.provider_name || '');
      default:
        return 0;
    }
  });

  const uniqueTypes = Array.from(new Set(documents.filter(d => getComputedStatus(d) !== 'historico').map(d => d.type)));

  if (loading) return <div className="p-8 text-center text-gray-500">Carregando documentos...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;

  // Calculate compliance status
  const today = new Date();
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(today.getDate() + 30);

  const activeDocs = documents.filter(d => getComputedStatus(d) !== 'historico');
  const expiredDocs = activeDocs.filter(d => getComputedStatus(d) === 'vencido');
  const expiringSoonDocs = activeDocs.filter(d => getComputedStatus(d) === 'valido' && d.expiry_date && new Date(d.expiry_date) >= today && new Date(d.expiry_date) <= thirtyDaysFromNow);
  const pendingDocs = activeDocs.filter(d => getComputedStatus(d) === 'pendente');
  const rejectedDocs = activeDocs.filter(d => getComputedStatus(d) === 'reprovado');

  let complianceStatus = 'Conforme';
  let complianceColor = 'bg-emerald-100 text-emerald-800 border-emerald-200';
  
  if (expiredDocs.length > 0 || rejectedDocs.length > 0) {
    complianceStatus = 'Não Conforme';
    complianceColor = 'bg-red-100 text-red-800 border-red-200';
  } else if (pendingDocs.length > 0 || expiringSoonDocs.length > 0) {
    complianceStatus = 'Parcialmente Conforme';
    complianceColor = 'bg-amber-100 text-amber-800 border-amber-200';
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Gestão de Documentos</h1>
        <div className="flex gap-2">
          {isAdmin && (
            <button 
              onClick={handleExportReport}
              className="flex items-center px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Download className="h-5 w-5 mr-2" />
              Exportar Relatório
            </button>
          )}
          <button 
            onClick={() => {
              setEditingDocId(null);
              setUploadType('Alvará de Localização');
              setIssueDate('');
              setExpiryDate('');
              setSelectedProviderId('');
              setFile(null);
              setShowUploadModal(true);
            }}
            className="flex items-center px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
          >
            <Upload className="h-5 w-5 mr-2" />
            {isAdmin ? 'Importar Documento' : 'Enviar Documento'}
          </button>
        </div>
      </div>

      {/* Compliance Summary */}
      <div className={`p-4 rounded-xl border ${complianceColor} flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4`}>
        <div>
          <h3 className="font-bold text-lg">Status Documental: {complianceStatus}</h3>
          <p className="text-sm opacity-90 mt-1">
            {expiredDocs.length} vencidos | {expiringSoonDocs.length} próximos do vencimento | {pendingDocs.length} pendentes de análise
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          {expiredDocs.length > 0 && (
            <span className="flex items-center bg-white/50 px-3 py-1.5 rounded-lg font-medium">
              <XCircle className="h-4 w-4 mr-1.5" />
              Ação Necessária
            </span>
          )}
          {expiringSoonDocs.length > 0 && expiredDocs.length === 0 && (
            <span className="flex items-center bg-white/50 px-3 py-1.5 rounded-lg font-medium">
              <Clock className="h-4 w-4 mr-1.5" />
              Atenção
            </span>
          )}
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col lg:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          <input
            type="text"
            placeholder={isAdmin ? "Pesquisar por prestador ou tipo..." : "Pesquisar por tipo de documento..."}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-gray-400" />
            <select
              className="border border-gray-300 rounded-lg py-2 pl-3 pr-8 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">Todos os Status</option>
              <option value="valido">Válido</option>
              <option value="pendente">Pendente</option>
              <option value="vencido">Vencido</option>
              <option value="reprovado">Reprovado</option>
              {isAdmin && <option value="historico">Histórico</option>}
            </select>
          </div>
          <select
            className="border border-gray-300 rounded-lg py-2 pl-3 pr-8 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">Todos os Tipos</option>
            {uniqueTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <select
            className="border border-gray-300 rounded-lg py-2 pl-3 pr-8 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          >
            <option value="newest">Mais recentes</option>
            <option value="oldest">Mais antigos</option>
            <option value="type_asc">Tipo (A-Z)</option>
            <option value="type_desc">Tipo (Z-A)</option>
            {isAdmin && <option value="provider_asc">Prestador (A-Z)</option>}
            {isAdmin && <option value="provider_desc">Prestador (Z-A)</option>}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tipo de Documento</th>
                {isAdmin && <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Prestador</th>}
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Emissão</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Validade</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Envio</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredDocuments.map((doc) => (
                <tr key={doc.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <FileText className="h-5 w-5 text-gray-400 mr-3" />
                      <div className="text-sm font-medium text-gray-900">{doc.type}</div>
                    </div>
                  </td>
                  {isAdmin && (
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {doc.provider_name}
                    </td>
                  )}
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {doc.issue_date ? new Date(doc.issue_date).toLocaleDateString('pt-BR') : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {doc.expiry_date ? new Date(doc.expiry_date).toLocaleDateString('pt-BR') : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div className="flex flex-col">
                      <span>{doc.upload_date ? new Date(doc.upload_date).toLocaleDateString('pt-BR') : '-'}</span>
                      <span className="text-xs text-gray-400">{doc.uploaded_by_name || 'Sistema'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <div className="flex items-center whitespace-nowrap">
                        {getStatusIcon(getComputedStatus(doc))}
                        <span className="ml-2">{getStatusBadge(getComputedStatus(doc))}</span>
                      </div>
                      {getComputedStatus(doc) === 'reprovado' && doc.rejection_reason && (
                        <span className="text-xs text-red-600 mt-1 max-w-[200px] truncate block" title={doc.rejection_reason}>
                          Motivo: {doc.rejection_reason}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-medium">
                    <div className="flex items-center justify-end gap-3 flex-wrap">
                      <button 
                        onClick={() => {
                          setSelectedDoc(doc);
                          setZoomLevel(1);
                          setShowViewerModal(true);
                        }}
                        className="text-emerald-600 hover:text-emerald-900 inline-flex items-center"
                      >
                        <Eye className="h-4 w-4 mr-1" /> Visualizar
                      </button>
                      
                      {isAdmin && getComputedStatus(doc) === 'pendente' && (
                        <button 
                          onClick={() => openAdminModal(doc)}
                          className="text-blue-600 hover:text-blue-900 inline-flex items-center"
                        >
                          Avaliar
                        </button>
                      )}

                      {getComputedStatus(doc) === 'pendente' && (
                        <>
                          <button 
                            onClick={() => openEditModal(doc)}
                            className="text-amber-600 hover:text-amber-900 inline-flex items-center"
                          >
                            Editar
                          </button>
                          <button 
                            onClick={() => handleDelete(doc.id)}
                            className="text-red-600 hover:text-red-900 inline-flex items-center"
                          >
                            Excluir
                          </button>
                        </>
                      )}

                      {!isAdmin && (getComputedStatus(doc) === 'vencido' || getComputedStatus(doc) === 'reprovado') && (
                        <button 
                          onClick={() => {
                            setEditingDocId(null);
                            setUploadType(doc.type);
                            setIssueDate('');
                            setExpiryDate('');
                            setSelectedProviderId('');
                            setFile(null);
                            setShowUploadModal(true);
                          }}
                          className="text-blue-600 hover:text-blue-900 inline-flex items-center"
                        >
                          Atualizar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredDocuments.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 7 : 6} className="px-6 py-8 text-center text-gray-500">
                    Nenhum documento encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-900">{isAdmin ? 'Importar Documento' : 'Enviar Documento'}</h3>
              <button onClick={() => setShowUploadModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleUpload} className="p-6 space-y-4">
              {isAdmin && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prestador</label>
                  <select 
                    className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-emerald-500 focus:border-emerald-500"
                    value={selectedProviderId}
                    onChange={(e) => setSelectedProviderId(e.target.value)}
                    required
                  >
                    <option value="">Selecione um prestador</option>
                    {providers.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de Documento</label>
                <select 
                  className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-emerald-500 focus:border-emerald-500"
                  value={uploadType}
                  onChange={(e) => setUploadType(e.target.value)}
                  required
                >
                  <option value="Alvará de Localização">Alvará de Localização</option>
                  <option value="Alvará Sanitário">Alvará Sanitário</option>
                  <option value="Alvará dos Bombeiros">Alvará dos Bombeiros</option>
                  <option value="ART - Anotação de Responsabilidade Técnica">ART - Anotação de Responsabilidade Técnica</option>
                  <option value="Certificados/diplomas">Certificados/diplomas</option>
                  <option value="CNES">CNES</option>
                  <option value="Contrato Social">Contrato Social</option>
                  <option value="CRM do Responsável Técnico">CRM do Responsável Técnico</option>
                  <option value="Optante pelo Simples Nacional">Optante pelo Simples Nacional</option>
                  <option value="RQE">RQE</option>
                  <option value="Outros">Outros</option>
                </select>
              </div>
              {isAdmin && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Data de Emissão</label>
                    <input 
                      type="date" 
                      className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-emerald-500 focus:border-emerald-500"
                      value={issueDate}
                      onChange={(e) => setIssueDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Data de Validade</label>
                    <input 
                      type="date" 
                      className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-emerald-500 focus:border-emerald-500"
                      value={expiryDate}
                      onChange={(e) => setExpiryDate(e.target.value)}
                    />
                  </div>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Arquivo (PDF, Imagem)</label>
                <input 
                  type="file" 
                  accept=".pdf,image/*"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
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
                  className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50"
                >
                  {uploading ? 'Enviando...' : 'Enviar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Admin Evaluation Modal */}
      {showAdminModal && selectedDoc && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-white z-10">
              <h3 className="text-lg font-bold text-gray-900">Avaliar Documento: {selectedDoc.type}</h3>
              <div className="flex items-center gap-4">
                <div className="flex items-center bg-gray-100 rounded-lg p-1">
                  <button onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.25))} className="p-1 hover:bg-white rounded text-gray-600"><ZoomOut className="h-5 w-5" /></button>
                  <span className="px-3 text-sm font-medium text-gray-600">{Math.round(zoomLevel * 100)}%</span>
                  <button onClick={() => setZoomLevel(z => Math.min(3, z + 0.25))} className="p-1 hover:bg-white rounded text-gray-600"><ZoomIn className="h-5 w-5" /></button>
                </div>
                <button onClick={() => setShowAdminModal(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="h-6 w-6" />
                </button>
              </div>
            </div>
            
            <div className="flex-1 flex overflow-hidden">
              {/* Left side: Document Viewer */}
              <div className="flex-1 bg-gray-100 overflow-auto flex items-center justify-center relative border-r border-gray-200">
                {selectedDoc.file_url?.match(/\.(jpeg|jpg|gif|png)$/i) ? (
                  <img 
                    src={selectedDoc.file_url} 
                    alt="Documento" 
                    style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center', transition: 'transform 0.2s' }} 
                    className="max-w-none shadow-md"
                  />
                ) : (
                  <iframe 
                    src={selectedDoc.file_url} 
                    className="w-full h-full border-0" 
                    style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left', width: `${100/zoomLevel}%`, height: `${100/zoomLevel}%` }}
                    title="Documento"
                  />
                )}
              </div>

              {/* Right side: Evaluation Form */}
              <div className="w-96 bg-white p-6 flex flex-col overflow-y-auto">
                <div className="space-y-6 flex-1">
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Prestador</p>
                    <p className="font-medium text-gray-900">{selectedDoc.provider_name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Tipo de Documento</p>
                    <p className="font-medium text-gray-900">{selectedDoc.type}</p>
                  </div>
                  
                  <div className="space-y-4 pt-4 border-t border-gray-100">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Data de Emissão</label>
                      <input 
                        type="date" 
                        className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-emerald-500 focus:border-emerald-500"
                        value={adminIssueDate}
                        onChange={(e) => setAdminIssueDate(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Data de Validade</label>
                      <input 
                        type="date" 
                        className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-emerald-500 focus:border-emerald-500"
                        value={adminExpiryDate}
                        onChange={(e) => setAdminExpiryDate(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Motivo da Negativa (Opcional)</label>
                      <textarea 
                        className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-red-500 focus:border-red-500 text-sm"
                        rows={3}
                        placeholder="Preencha caso vá reprovar o documento..."
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-6 mt-6 border-t border-gray-100 space-y-3">
                  <button 
                    onClick={() => handleStatusUpdate('valido')}
                    disabled={updatingStatus}
                    className="w-full flex justify-center items-center px-4 py-3 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <CheckCircle className="h-5 w-5 mr-2" /> Aprovar Documento
                  </button>
                  <button 
                    onClick={() => handleStatusUpdate('reprovado')}
                    disabled={updatingStatus}
                    className="w-full flex justify-center items-center px-4 py-3 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    <XCircle className="h-5 w-5 mr-2" /> Reprovar Documento
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Document Viewer Modal */}
      {showViewerModal && selectedDoc && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-white z-10">
              <h3 className="text-lg font-bold text-gray-900">{selectedDoc.type}</h3>
              <div className="flex items-center gap-4">
                <div className="flex items-center bg-gray-100 rounded-lg p-1">
                  <button onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.25))} className="p-1 hover:bg-white rounded text-gray-600"><ZoomOut className="h-5 w-5" /></button>
                  <span className="px-3 text-sm font-medium text-gray-600">{Math.round(zoomLevel * 100)}%</span>
                  <button onClick={() => setZoomLevel(z => Math.min(3, z + 0.25))} className="p-1 hover:bg-white rounded text-gray-600"><ZoomIn className="h-5 w-5" /></button>
                </div>
                <a 
                  href={selectedDoc.file_url} 
                  target="_blank" 
                  rel="noreferrer"
                  className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-2"
                >
                  <Download className="h-5 w-5" />
                  <span className="text-sm font-medium">Baixar</span>
                </a>
                <button onClick={() => setShowViewerModal(false)} className="text-gray-400 hover:text-gray-600 ml-2">
                  <X className="h-6 w-6" />
                </button>
              </div>
            </div>
            
            <div className="flex-1 bg-gray-100 overflow-auto flex items-center justify-center relative">
              {selectedDoc.file_url?.match(/\.(jpeg|jpg|gif|png)$/i) ? (
                <img 
                  src={selectedDoc.file_url} 
                  alt="Documento" 
                  style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center', transition: 'transform 0.2s' }} 
                  className="max-w-none shadow-md"
                />
              ) : (
                <iframe 
                  src={selectedDoc.file_url} 
                  className="w-full h-full border-0" 
                  style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left', width: `${100/zoomLevel}%`, height: `${100/zoomLevel}%` }}
                  title="Documento"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
