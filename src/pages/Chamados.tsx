import React, { useEffect, useState, useRef } from 'react';
import { fetchApi } from '../lib/api';
import { MessageSquare, Plus, Clock, CheckCircle, AlertCircle, X, Send, HelpCircle, ChevronDown, ChevronUp, Filter, Download, RefreshCw } from 'lucide-react';

export default function Chamados() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [user, setUser] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'tickets' | 'faq'>('tickets');
  
  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [ticketMessages, setTicketMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [ticketMessages]);
  
  // Forms
  const [newTicket, setNewTicket] = useState({ title: '', description: '', category: 'Financeiro', priority: 'Baixa' });
  const [ticketStatus, setTicketStatus] = useState('');
  const [updating, setUpdating] = useState(false);

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterPriority, setFilterPriority] = useState('');

  // FAQ State
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  const faqs = [
    {
      id: 1,
      question: 'Como faço para contestar uma glosa?',
      answer: 'Acesse o menu "Financeiro", localize o extrato correspondent e clique no botão "Contestar Glosa". Você poderá anexar documentos comprobatórios e enviar uma justificativa.'
    },
    {
      id: 2,
      question: 'Qual o prazo para pagamento das faturas?',
      answer: 'O pagamento é realizado conforme o cronograma estabelecido em contrato, geralmente até o 5º dia útil do mês subsequente ao faturamento.'
    },
    {
      id: 3,
      question: 'Como atualizo meus dados bancários?',
      answer: 'Acesse "Meu Perfil" e clique em "Solicitar Alteração". Selecione a opção "Dados Bancários" e anexe um comprovante da nova conta.'
    },
    {
      id: 4,
      question: 'Onde encontro os manuais de faturamento?',
      answer: 'Todos os manuais, políticas e regulamentos estão disponíveis no menu "Biblioteca". Você pode buscar por palavra-chave ou categoria.'
    }
  ];

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    loadTickets();
  }, []);

  const loadTickets = async () => {
    try {
      const data = await fetchApi('/tickets');
      setTickets(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const ticket = await fetchApi('/tickets', {
        method: 'POST',
        body: JSON.stringify(newTicket),
      });
      setTickets([ticket, ...tickets]);
      setIsModalOpen(false);
      setNewTicket({ title: '', description: '', category: 'Financeiro', priority: 'Baixa' });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleUpdateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket) return;
    
    setUpdating(true);
    try {
      const updatedTicket = await fetchApi(`/tickets/${selectedTicket.id}`, {
        method: 'PUT',
        body: JSON.stringify({ 
          status: ticketStatus
        }),
      });
      
      setTickets(tickets.map(t => t.id === updatedTicket.id ? updatedTicket : t));
      setSelectedTicket(updatedTicket);
      
      const msgs = await fetchApi(`/tickets/${selectedTicket.id}/messages`);
      setTicketMessages(msgs);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setUpdating(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !newMessage.trim()) return;
    
    setUpdating(true);
    try {
      await fetchApi(`/tickets/${selectedTicket.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message: newMessage }),
      });
      
      const msgs = await fetchApi(`/tickets/${selectedTicket.id}/messages`);
      setTicketMessages(msgs);
      setNewMessage('');
      
      // Refresh ticket to get updated status if it was auto-reopened
      if (!isAdmin && selectedTicket.status !== 'aberto') {
        const updatedTicket = { ...selectedTicket, status: 'aberto' };
        setSelectedTicket(updatedTicket);
        setTicketStatus('aberto');
        setTickets(tickets.map(t => t.id === updatedTicket.id ? updatedTicket : t));
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setUpdating(false);
    }
  };

  const handleReopenTicket = async () => {
    if (!selectedTicket) return;
    if (!window.confirm('Deseja realmente reabrir este chamado?')) return;
    
    setUpdating(true);
    try {
      const updatedTicket = await fetchApi(`/tickets/${selectedTicket.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'aberto' }),
      });
      
      setTickets(tickets.map(t => t.id === updatedTicket.id ? updatedTicket : t));
      setSelectedTicket(updatedTicket);
      setTicketStatus('aberto');
      
      const msgs = await fetchApi(`/tickets/${selectedTicket.id}/messages`);
      setTicketMessages(msgs);
      
      alert('Chamado reaberto com sucesso!');
    } catch (err: any) {
      alert(err.message || 'Erro ao reabrir chamado');
    } finally {
      setUpdating(false);
    }
  };

  const openDetails = async (ticket: any) => {
    setSelectedTicket(ticket);
    setTicketStatus(ticket.status);
    setTicketMessages([]);
    setIsDetailsModalOpen(true);
    
    try {
      const msgs = await fetchApi(`/tickets/${ticket.id}/messages`);
      setTicketMessages(msgs);
    } catch (err) {
      console.error('Failed to load messages', err);
    }
  };

  const isAdmin = user?.role === 'admin' || user?.role === 'auditoria';

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'aberto': return <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">Aberto</span>;
      case 'em_analise': return <span className="px-2 py-1 text-xs font-medium rounded-full bg-amber-100 text-amber-800">Em Análise</span>;
      case 'respondido': return <span className="px-2 py-1 text-xs font-medium rounded-full bg-emerald-100 text-emerald-800">Respondido</span>;
      case 'encerrado': return <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-800">Encerrado</span>;
      default: return null;
    }
  };

  const filteredTickets = tickets.filter(ticket => {
    if (filterStatus && ticket.status !== filterStatus) return false;
    if (filterCategory && ticket.category !== filterCategory) return false;
    if (filterPriority && ticket.priority !== filterPriority) return false;
    return true;
  });

  const handleExportCSV = () => {
    const headers = ['ID', 'Assunto', 'Prestador', 'Categoria', 'Prioridade', 'Data', 'Status'];
    const csvContent = [
      headers.join(','),
      ...filteredTickets.map(t => [
        t.id,
        `"${t.title.replace(/"/g, '""')}"`,
        `"${(t.provider_name || '').replace(/"/g, '""')}"`,
        t.category,
        t.priority,
        new Date(t.created_at).toLocaleDateString(),
        t.status
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `chamados_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Carregando chamados...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Central de Ajuda</h1>
        {!isAdmin && activeTab === 'tickets' && (
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center px-4 py-2 bg-[#00995D] text-white rounded-lg hover:bg-[#007A4A] transition-colors"
          >
            <Plus className="h-5 w-5 mr-2" />
            Novo Chamado
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('tickets')}
            className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'tickets'
                ? 'border-[#00995D] text-[#00995D]'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center">
              <MessageSquare className="h-5 w-5 mr-2" />
              {isAdmin ? 'Todos os Chamados' : 'Meus Chamados'}
            </div>
          </button>
          <button
            onClick={() => setActiveTab('faq')}
            className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'faq'
                ? 'border-[#00995D] text-[#00995D]'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center">
              <HelpCircle className="h-5 w-5 mr-2" />
              Dúvidas Frequentes (FAQ)
            </div>
          </button>
        </nav>
      </div>

      {activeTab === 'tickets' ? (
        <div className="space-y-4">
          {/* Filters and Actions */}
          <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row gap-4 justify-between items-center">
            <div className="flex flex-wrap gap-4 w-full md:w-auto">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-700">Filtros:</span>
              </div>
              <select 
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="text-sm border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D]"
              >
                <option value="">Todos os Status</option>
                <option value="aberto">Aberto</option>
                <option value="em_analise">Em Análise</option>
                <option value="respondido">Respondido</option>
                <option value="encerrado">Encerrado</option>
              </select>
              <select 
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="text-sm border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D]"
              >
                <option value="">Todas as Categorias</option>
                <option value="Financeiro">Financeiro</option>
                <option value="Cadastro">Cadastro</option>
                <option value="Sistema">Sistema</option>
                <option value="Auditoria">Auditoria</option>
                <option value="Outros">Outros</option>
              </select>
              <select 
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="text-sm border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D]"
              >
                <option value="">Todas as Prioridades</option>
                <option value="Baixa">Baixa</option>
                <option value="Média">Média</option>
                <option value="Alta">Alta</option>
              </select>
            </div>
            <button 
              onClick={handleExportCSV}
              className="flex items-center px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium whitespace-nowrap"
            >
              <Download className="w-4 h-4 mr-2" />
              Exportar Relatório
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assunto</th>
                    {isAdmin && <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Prestador</th>}
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Categoria</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Prioridade</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredTickets.map((ticket) => (
                    <tr key={ticket.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <MessageSquare className="h-5 w-5 text-gray-400 mr-3" />
                          <div>
                            <div className="text-sm font-medium text-gray-900">{ticket.title}</div>
                            <div className="text-xs text-gray-500 truncate max-w-xs">{ticket.description}</div>
                          </div>
                        </div>
                      </td>
                      {isAdmin && (
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {ticket.provider_name}
                        </td>
                      )}
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {ticket.category}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          ticket.priority === 'Alta' ? 'bg-red-100 text-red-800' : 
                          ticket.priority === 'Média' ? 'bg-amber-100 text-amber-800' : 
                          'bg-emerald-100 text-emerald-800'
                        }`}>
                          {ticket.priority}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(ticket.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(ticket.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button 
                          onClick={() => openDetails(ticket)}
                          className="text-[#00995D] hover:text-[#007A4A]"
                        >
                          {isAdmin && ticket.status === 'aberto' ? 'Responder' : 'Ver Detalhes'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredTickets.length === 0 && (
                    <tr>
                      <td colSpan={isAdmin ? 7 : 6} className="px-6 py-8 text-center text-gray-500">
                        Nenhum chamado encontrado com os filtros atuais.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-6">Perguntas Frequentes</h2>
            <div className="space-y-4">
              {faqs.map((faq) => (
                <div key={faq.id} className="border border-gray-200 rounded-lg overflow-hidden">
                  <button
                    onClick={() => setExpandedFaq(expandedFaq === faq.id ? null : faq.id)}
                    className="w-full flex justify-between items-center p-4 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                  >
                    <span className="font-medium text-gray-900">{faq.question}</span>
                    {expandedFaq === faq.id ? (
                      <ChevronUp className="h-5 w-5 text-gray-500" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-gray-500" />
                    )}
                  </button>
                  {expandedFaq === faq.id && (
                    <div className="p-4 bg-white text-gray-600 border-t border-gray-200">
                      {faq.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
            
            <div className="mt-8 bg-blue-50 p-6 rounded-xl border border-blue-100 text-center">
              <HelpCircle className="h-8 w-8 text-blue-500 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-gray-900 mb-2">Ainda tem dúvidas?</h3>
              <p className="text-gray-600 mb-4">Nossa equipe de suporte está pronta para ajudar você.</p>
              <button 
                onClick={() => {
                  setActiveTab('tickets');
                  setIsModalOpen(true);
                }}
                className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-5 w-5 mr-2" />
                Abrir um Chamado
              </button>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-[100] overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setIsModalOpen(false)}></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <form onSubmit={handleCreateTicket}>
                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                      Abrir Novo Chamado
                    </h3>
                    <button type="button" onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="title" className="block text-sm font-medium text-gray-700">Assunto</label>
                      <input type="text" id="title" required value={newTicket.title} onChange={(e) => setNewTicket({...newTicket, title: e.target.value})} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm" />
                    </div>
                    <div>
                      <label htmlFor="category" className="block text-sm font-medium text-gray-700">Categoria</label>
                      <select id="category" value={newTicket.category} onChange={(e) => setNewTicket({...newTicket, category: e.target.value})} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm">
                        <option>Financeiro</option>
                        <option>Cadastro</option>
                        <option>Sistema</option>
                        <option>Auditoria</option>
                        <option>Outros</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="priority" className="block text-sm font-medium text-gray-700">Prioridade</label>
                      <select id="priority" value={newTicket.priority} onChange={(e) => setNewTicket({...newTicket, priority: e.target.value})} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm">
                        <option>Baixa</option>
                        <option>Média</option>
                        <option>Alta</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="description" className="block text-sm font-medium text-gray-700">Descrição</label>
                      <textarea id="description" required rows={4} value={newTicket.description} onChange={(e) => setNewTicket({...newTicket, description: e.target.value})} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm"></textarea>
                    </div>
                  </div>
                </div>
                <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button type="submit" className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-emerald-600 text-base font-medium text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 sm:ml-3 sm:w-auto sm:text-sm">
                    Enviar Chamado
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

      {/* Details / Response Modal */}
      {isDetailsModalOpen && selectedTicket && (
        <div className="fixed inset-0 z-[100] overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={() => setIsDetailsModalOpen(false)}></div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative inline-block align-bottom bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] text-left transform transition-all sm:my-8 sm:align-middle">
              <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <div className="flex items-center space-x-3">
                  <h3 className="text-lg font-bold text-gray-900">Chamado #{selectedTicket.id}</h3>
                  {getStatusBadge(selectedTicket.status)}
                </div>
                <button onClick={() => setIsDetailsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                  <X className="h-5 w-5" />
                </button>
              </div>
            
            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* Ticket Info */}
              <div>
                <h4 className="text-xl font-bold text-gray-900 mb-2">{selectedTicket.title}</h4>
                <div className="flex flex-wrap gap-4 text-sm text-gray-500 mb-4">
                  {isAdmin && <span><strong>Prestador:</strong> {selectedTicket.provider_name}</span>}
                  <span><strong>Categoria:</strong> {selectedTicket.category}</span>
                  <span><strong>Prioridade:</strong> {selectedTicket.priority}</span>
                  <span><strong>Data:</strong> {new Date(selectedTicket.created_at).toLocaleString()}</span>
                </div>
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 text-gray-700 whitespace-pre-wrap">
                  {selectedTicket.description}
                </div>
              </div>

              {/* Chat History */}
              <div className="space-y-4 mt-6">
                <h4 className="text-sm font-bold text-gray-900 border-b pb-2">Histórico do Chamado</h4>
                
                {ticketMessages.length === 0 ? (
                  <div className="text-center text-gray-500 py-4">Nenhuma mensagem registrada.</div>
                ) : (
                  <div className="space-y-4 max-h-96 overflow-y-auto p-4 bg-gray-50 rounded-lg border border-gray-100">
                    {ticketMessages.map((msg, index) => (
                      <div key={index} className={`flex flex-col ${msg.user_id === user?.id ? 'items-end' : 'items-start'}`}>
                        {msg.is_status_change ? (
                          <div className="w-full text-center my-2">
                            <span className="inline-block bg-gray-200 text-gray-600 text-xs px-2 py-1 rounded-full">
                              {msg.message} - {new Date(msg.created_at).toLocaleString()}
                            </span>
                          </div>
                        ) : (
                          <div className={`max-w-[80%] rounded-lg p-3 ${msg.user_id === user?.id ? 'bg-emerald-600 text-white' : 'bg-white border border-gray-200 text-gray-800'}`}>
                            <div className="flex justify-between items-baseline mb-1">
                              <span className="text-xs font-semibold opacity-75">{msg.user_name} ({msg.role === 'admin' || msg.role === 'auditoria' ? 'Unimed' : 'Prestador'})</span>
                              <span className="text-[10px] opacity-70 ml-2">{new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                            </div>
                            <div className="text-sm whitespace-pre-wrap">{msg.message}</div>
                          </div>
                        )}
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Send Message Form */}
              <form onSubmit={handleSendMessage} className="mt-4 flex gap-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Digite uma mensagem..."
                  className="flex-1 border-gray-300 rounded-lg shadow-sm focus:ring-emerald-500 focus:border-emerald-500"
                  disabled={updating || selectedTicket.status === 'encerrado'}
                />
                <button
                  type="submit"
                  disabled={updating || !newMessage.trim() || selectedTicket.status === 'encerrado'}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  Enviar
                </button>
              </form>

              {isAdmin && (
                <form id="response-form" onSubmit={handleUpdateTicket} className="space-y-4 border-t border-gray-100 pt-6 mt-6">
                  <h4 className="text-sm font-bold text-gray-900">Atualizar Status</h4>
                  
                  <div className="flex gap-4 items-end">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Status do Chamado</label>
                      <select 
                        value={ticketStatus} 
                        onChange={(e) => setTicketStatus(e.target.value)}
                        className="w-full border-gray-300 rounded-lg shadow-sm focus:ring-emerald-500 focus:border-emerald-500"
                      >
                        <option value="aberto">Aberto</option>
                        <option value="em_analise">Em Análise</option>
                        <option value="respondido">Respondido</option>
                        <option value="encerrado">Encerrado</option>
                      </select>
                    </div>
                    <button 
                      type="submit" 
                      disabled={updating || ticketStatus === selectedTicket.status}
                      className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50 h-[42px]"
                    >
                      Atualizar
                    </button>
                  </div>
                </form>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end space-x-3">
              {!isAdmin && (selectedTicket.status === 'encerrado' || selectedTicket.status === 'respondido') && (
                <button 
                  type="button" 
                  onClick={handleReopenTicket}
                  disabled={updating}
                  className="px-4 py-2 text-sm font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors disabled:opacity-50 flex items-center mr-auto"
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reabrir Chamado
                </button>
              )}
              <button 
                type="button" 
                onClick={() => setIsDetailsModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
