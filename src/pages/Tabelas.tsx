import React, { useEffect, useState } from 'react';
import { FileText, Download, Search, Filter, Clock, CheckCircle, AlertCircle, Calendar } from 'lucide-react';
import { fetchApi } from '../lib/api';

export default function Tabelas() {
  const [tables, setTables] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await fetchApi('/price-tables');
        setTables(data);
      } catch (error) {
        console.error('Error loading price tables:', error);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  const handleDownload = async (id: number, e: React.MouseEvent) => {
    e.preventDefault();
    try {
      const response = await fetchApi(`/price-tables/${id}/download`);
      alert(`Download iniciado para: ${response.url}`);
    } catch (error) {
      console.error('Error downloading table:', error);
      alert('Erro ao iniciar download.');
    }
  };

  const filteredTables = tables.filter(table => {
    const matchesSearch = table.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          table.code.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || table.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'vigente': return <CheckCircle className="h-4 w-4 text-emerald-500 mr-1.5" />;
      case 'futura': return <Clock className="h-4 w-4 text-blue-500 mr-1.5" />;
      case 'historico': return <AlertCircle className="h-4 w-4 text-gray-500 mr-1.5" />;
      default: return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'vigente': return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">Vigente</span>;
      case 'futura': return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Programada</span>;
      case 'historico': return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">Histórico</span>;
      default: return null;
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Carregando tabelas de preço...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tabelas de Preço e Regras</h1>
          <p className="text-sm text-gray-500 mt-1">Consulte as tabelas de remuneração, honorários e regras de faturamento vigentes.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por nome ou código da tabela..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00995D] focus:border-transparent text-sm"
            />
          </div>
          <div className="flex items-center space-x-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00995D] focus:border-transparent"
            >
              <option value="all">Todos os Status</option>
              <option value="vigente">Vigentes</option>
              <option value="futura">Programadas</option>
              <option value="historico">Histórico</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Tabela / Código</th>
                <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Versão</th>
                <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Vigência</th>
                <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredTables.length > 0 ? (
                filteredTables.map((table) => (
                  <tr key={table.id} className="hover:bg-gray-50 transition-colors">
                    <td className="p-4">
                      <div className="flex items-center">
                        <div className="h-10 w-10 rounded-lg bg-[#00995D]/10 flex items-center justify-center mr-3 flex-shrink-0">
                          <FileText className="h-5 w-5 text-[#00995D]" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-900">{table.title}</p>
                          <p className="text-xs text-gray-500">Cód: {table.code}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="text-sm text-gray-600">{table.version}</span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center text-sm text-gray-600">
                        <Calendar className="h-4 w-4 mr-1.5 text-gray-400" />
                        {new Date(table.effective_date).toLocaleDateString('pt-BR')}
                      </div>
                    </td>
                    <td className="p-4">
                      {getStatusBadge(table.status)}
                    </td>
                    <td className="p-4 text-right">
                      <button 
                        onClick={(e) => handleDownload(table.id, e)}
                        className="inline-flex items-center justify-center p-2 text-gray-400 hover:text-[#00995D] hover:bg-[#00995D]/10 rounded-lg transition-colors"
                        title="Baixar Tabela"
                      >
                        <Download className="h-5 w-5" />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-gray-500">
                    Nenhuma tabela encontrada com os filtros atuais.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
