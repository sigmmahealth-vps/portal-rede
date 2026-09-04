import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { fmtDataHora } from '../../lib/formatDate';
import { RefreshCw, Send, Search } from 'lucide-react';

// Rótulos amigáveis dos tipos de notificação (espelha NOTIFY_TYPES do back).
const TYPE_LABELS: Record<string, string> = {
  ciclo_aberto: 'Ciclo aberto',
  roteiro_enviado: 'Roteiro enviado',
  reanalise_solicitada: 'Reanálise solicitada',
  parecer_aprovado: 'Avaliação aprovada',
  parecer_reprovado: 'Avaliação não qualificada',
  certificado_emitido: 'Certificado emitido',
  plano_gerado: 'Plano de ação gerado',
  acao_aguardando_validacao: 'Ação aguardando validação',
  acao_vencendo: 'Ação a vencer',
  acao_atrasada: 'Ação atrasada',
  roteiro_pendente: 'Roteiro pendente',
  certificado_vencendo: 'Certificado a vencer',
  ciclo_encerrado_sem_avaliacao: 'Ciclo encerrado sem avaliação',
};

// Status de e-mail → rótulo + cor. 'enviado' = processado pelo provedor (não é
// prova de entrega); 'suprimido' = não saiu (allowlist/dev).
const STATUS: Record<string, { label: string; cls: string }> = {
  enviado: { label: 'Processado', cls: 'bg-emerald-100 text-emerald-700' },
  suprimido: { label: 'Suprimido', cls: 'bg-gray-200 text-gray-600' },
  falhou: { label: 'Falhou', cls: 'bg-red-100 text-red-700' },
  pendente: { label: 'Pendente', cls: 'bg-amber-100 text-amber-800' },
};

interface EmailRow {
  id: number; email_to: string; type: string; title: string;
  email_status: string; email_attempts: number; created_at: string;
  provider_name: string | null; provider_code: string | null;
}

export default function EmailsTab() {
  const [items, setItems] = useState<EmailRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const perPage = 25;
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [days, setDays] = useState('90');
  const [q, setQ] = useState('');
  const [resending, setResending] = useState<number | null>(null);

  const load = async (p = page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), days });
      if (status) params.set('status', status);
      if (type) params.set('type', type);
      if (q.trim()) params.set('q', q.trim());
      const data = await fetchApi(`/admin/emails?${params.toString()}`);
      setItems(data.items); setTotal(data.total); setPage(data.page);
    } finally { setLoading(false); }
  };
  // Recarrega ao mudar filtros de seleção; a busca textual é aplicada no submit.
  useEffect(() => { load(1); /* eslint-disable-next-line */ }, [status, type, days]);
  useEffect(() => { load(1); /* eslint-disable-next-line */ }, []);

  const reenviar = async (row: EmailRow) => {
    if (!confirm(`Reenviar este e-mail para ${row.email_to}?`)) return;
    setResending(row.id);
    try {
      await fetchApi(`/admin/emails/${row.id}/reenviar`, { method: 'POST', body: JSON.stringify({}) });
      await load();
    } catch (e: any) { alert(e?.message || 'Erro ao reenviar'); }
    finally { setResending(null); }
  };

  const lastPage = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-gray-800">E-mails Enviados</h2>
        <p className="text-sm text-gray-500">Notificações do portal enviadas por e-mail e seu status. <strong>Processado</strong> = entregue ao provedor sem erro (não confirma leitura); <strong>Suprimido</strong> = não enviado (fase de testes/allowlist).</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 bg-white p-4 rounded-xl border border-gray-200">
        <form onSubmit={(e) => { e.preventDefault(); load(1); }} className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-gray-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="E-mail, nome ou código do prestador"
              className="pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm w-72" />
          </div>
          <button type="submit" className="px-3 py-2 bg-[#00995D] text-white rounded-lg text-sm hover:bg-[#007A4A]">Buscar</button>
        </form>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-0.5">Status</span>
          <select value={status} onChange={e => setStatus(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-2 text-sm">
            <option value="">Todos</option>
            <option value="enviado">Processado</option>
            <option value="suprimido">Suprimido</option>
            <option value="falhou">Falhou</option>
            <option value="pendente">Pendente</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-0.5">Tipo</span>
          <select value={type} onChange={e => setType(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-2 text-sm">
            <option value="">Todos</option>
            {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-0.5">Período</span>
          <select value={days} onChange={e => setDays(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-2 text-sm">
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="365">Último ano</option>
            <option value="all">Tudo</option>
          </select>
        </label>
        <button onClick={() => load()} title="Atualizar" className="ml-auto p-2 text-gray-500 hover:text-gray-800">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-xs text-gray-600">
              <th className="p-3 font-semibold">Data/hora</th>
              <th className="p-3 font-semibold">Destinatário</th>
              <th className="p-3 font-semibold">Prestador</th>
              <th className="p-3 font-semibold">Tipo</th>
              <th className="p-3 font-semibold">Assunto</th>
              <th className="p-3 font-semibold">Status</th>
              <th className="p-3 font-semibold text-center">Tent.</th>
              <th className="p-3 font-semibold text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="p-6 text-center text-gray-500">Carregando...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="p-6 text-center text-gray-500">Nenhum e-mail no período/filtro.</td></tr>
            ) : items.map(row => {
              const st = STATUS[row.email_status] ?? { label: row.email_status, cls: 'bg-gray-100 text-gray-600' };
              return (
                <tr key={row.id} className="border-b border-gray-50">
                  <td className="p-3 whitespace-nowrap text-gray-600">{fmtDataHora(row.created_at)}</td>
                  <td className="p-3 whitespace-nowrap">{row.email_to}</td>
                  <td className="p-3">{row.provider_name ? <span>{row.provider_name}{row.provider_code ? <span className="text-gray-400"> · {row.provider_code}</span> : null}</span> : <span className="text-gray-300">—</span>}</td>
                  <td className="p-3 whitespace-nowrap">{TYPE_LABELS[row.type] ?? row.type}</td>
                  <td className="p-3 max-w-xs truncate" title={row.title}>{row.title}</td>
                  <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${st.cls}`}>{st.label}</span></td>
                  <td className="p-3 text-center tabular-nums text-gray-600">{row.email_attempts}</td>
                  <td className="p-3 text-right">
                    <button onClick={() => reenviar(row)} disabled={resending === row.id}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#00995D] hover:text-[#007A4A] disabled:opacity-40">
                      <Send className="w-3.5 h-3.5" /> {resending === row.id ? 'Reenviando...' : 'Reenviar'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>{total} e-mail(s)</span>
        <div className="flex items-center gap-2">
          <button disabled={page <= 1} onClick={() => load(page - 1)} className="px-3 py-1 border rounded disabled:opacity-40">Anterior</button>
          <span>Página {page} de {lastPage}</span>
          <button disabled={page >= lastPage} onClick={() => load(page + 1)} className="px-3 py-1 border rounded disabled:opacity-40">Próxima</button>
        </div>
      </div>
    </div>
  );
}
