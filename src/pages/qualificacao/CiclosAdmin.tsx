import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { fmtData } from '../../lib/formatDate';
import { Plus, Edit3, Trash2, Check, Settings, Lock, Unlock, CalendarPlus } from 'lucide-react';
import NovoCicloModal from './NovoCicloModal';
import AbrirCicloPage from './AbrirCicloPage';

export default function CiclosAdmin({ user }: { user: any }) {
  const [cycles, setCycles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [abrindo, setAbrindo] = useState<any>(null);
  const [prorrogando, setProrrogando] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    try { setCycles(await fetchApi('/eval/cycles')); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const activate = async (c: any) => {
    await fetchApi(`/eval/cycles/${c.id}`, { method: 'PATCH', body: JSON.stringify({ active: true }) });
    load();
  };

  const remove = async (c: any) => {
    if (!confirm(`Excluir o ciclo "${c.label}"?`)) return;
    try {
      await fetchApi(`/eval/cycles/${c.id}`, { method: 'DELETE' });
      load();
    } catch (e: any) { alert(e.message); }
  };

  const reabrir = async (c: any, endDate?: string) => {
    if (!endDate && !confirm(`Reabrir o ciclo "${c.label}"? As avaliações encerradas voltam ao status anterior.`)) return;
    try {
      const res = await fetchApi(`/eval/cycles/${c.id}/reabrir`, {
        method: 'POST',
        body: JSON.stringify(endDate ? { end_date: endDate } : {}),
      });
      alert(`Ciclo reaberto até ${fmtData(res.end_date)} — ${res.restored} avaliação(ões) reaberta(s).`);
      setProrrogando(null);
      load();
    } catch (e: any) { alert(e?.message || 'Erro ao reabrir'); }
  };

  const encerrar = async (c: any) => {
    if (!confirm(`Encerrar o ciclo "${c.label}"? Nenhuma nova ação será aceita.`)) return;
    try {
      await fetchApi(`/eval/cycles/${c.id}/encerrar`, { method: 'POST', body: JSON.stringify({}) });
      load();
    } catch (e: any) {
      // Se houver instâncias inconclusivas, o back retorna 409. Pergunta se força.
      const msg = e?.message || '';
      const m = msg.match(/(\d+)\s+inst[aâ]nc/i);
      if (m && confirm(`${msg}\n\nDeseja encerrar mesmo com ${m[1]} instância(s) em andamento?`)) {
        try {
          await fetchApi(`/eval/cycles/${c.id}/encerrar`, { method: 'POST', body: JSON.stringify({ force: true }) });
          load();
        } catch (e2: any) { alert(e2?.message || 'Erro ao encerrar'); }
      } else if (!m) {
        alert(msg || 'Erro ao encerrar');
      }
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Ciclos de Qualificação</h2>
          <p className="text-sm text-gray-500">Só um ciclo pode estar ativo por vez.</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 bg-[#00995D] text-white px-4 py-2 rounded-lg hover:bg-[#007A4A] transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span>Novo Ciclo</span>
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="p-3 text-sm font-semibold text-gray-600">Ciclo</th>
              <th className="p-3 text-sm font-semibold text-gray-600">Início</th>
              <th className="p-3 text-sm font-semibold text-gray-600">Fim</th>
              <th className="p-3 text-sm font-semibold text-gray-600">Ativo</th>
              <th className="p-3 text-sm font-semibold text-gray-600">Instâncias</th>
              <th className="p-3 text-sm font-semibold text-gray-600">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="p-6 text-center text-gray-500">Carregando...</td></tr>
            ) : cycles.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-gray-500">Nenhum ciclo cadastrado.</td></tr>
            ) : (() => {
              const hasActive = cycles.some(x => x.active);
              return cycles.map(c => ({ c, hasOtherActive: hasActive && !c.active }));
            })().map(({ c, hasOtherActive }) => (
              <tr key={c.id} className="border-b border-gray-50">
                <td className="p-3 font-medium">{c.label}</td>
                <td className="p-3 text-sm text-gray-600">{fmtData(c.start_date)}</td>
                <td className="p-3 text-sm text-gray-600">{fmtData(c.end_date)}</td>
                <td className="p-3">
                  {c.active
                    ? <span className="px-2 py-0.5 text-xs rounded bg-emerald-100 text-emerald-700 font-semibold">Ativo</span>
                    : c.instances_count > 0 ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => reabrir(c)}
                          disabled={hasOtherActive}
                          title={hasOtherActive ? 'Encerre o ciclo ativo antes' : 'Reabrir — as avaliações encerradas voltam ao status anterior'}
                          className="text-xs text-emerald-700 hover:underline flex items-center gap-1 disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
                        >
                          <Unlock className="w-3 h-3" /> Reabrir
                        </button>
                        <button
                          onClick={() => setProrrogando(c)}
                          disabled={hasOtherActive}
                          title={hasOtherActive ? 'Encerre o ciclo ativo antes' : 'Prorrogar — nova data fim e reabertura das avaliações'}
                          className="text-xs text-sky-700 hover:underline flex items-center gap-1 disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
                        >
                          <CalendarPlus className="w-3 h-3" /> Prorrogar
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => activate(c)}
                        disabled={hasOtherActive}
                        title={hasOtherActive ? 'Encerre o ciclo ativo antes' : 'Ativar este ciclo'}
                        className="text-xs text-emerald-700 hover:underline flex items-center gap-1 disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
                      >
                        <Check className="w-3 h-3" /> Ativar
                      </button>
                    )}
                </td>
                <td className="p-3 text-sm text-gray-600">{c.instances_count}</td>
                <td className="p-3">
                  <div className="flex gap-2">
                    <button onClick={() => setEditing(c)} className="text-blue-600 hover:text-blue-800" title="Editar"><Edit3 className="w-4 h-4" /></button>
                    <button
                      onClick={() => setAbrindo(c)}
                      className="text-emerald-700 hover:text-emerald-900"
                      title={c.instances_count > 0 ? 'Ver configurações do ciclo (aberto)' : 'Configurações do ciclo — grupos, roteiros e abertura'}
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                    {c.active && (
                      <button onClick={() => encerrar(c)} className="text-orange-700 hover:text-orange-900" title="Encerrar ciclo">
                        <Lock className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => remove(c)}
                      disabled={c.instances_count > 0}
                      title={c.instances_count > 0 ? `Não pode excluir — ${c.instances_count} instâncias vinculadas` : 'Excluir'}
                      className="text-red-600 hover:text-red-800 disabled:opacity-30 disabled:cursor-not-allowed"
                    ><Trash2 className="w-4 h-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {prorrogando && (
        <ProrrogarModal
          cycle={prorrogando}
          onClose={() => setProrrogando(null)}
          onConfirm={(d) => reabrir(prorrogando, d)}
        />
      )}
      {creating && <NovoCicloModal onClose={() => setCreating(false)} onSaved={load} />}
      {editing && <NovoCicloModal initial={editing} onClose={() => setEditing(null)} onSaved={load} />}
      {abrindo && <AbrirCicloPage cycle={abrindo} onClose={() => setAbrindo(null)} onDone={load} />}
    </div>
  );
}

function ProrrogarModal({ cycle, onClose, onConfirm }: { cycle: any; onClose: () => void; onConfirm: (endDate: string) => void }) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [endDate, setEndDate] = useState('');
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100">
          <h3 className="text-lg font-bold">Prorrogar {cycle.label}</h3>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-gray-600">
            Fim atual: <strong>{fmtData(cycle.end_date)}</strong>. Ao prorrogar, o ciclo é
            reaberto e as avaliações encerradas voltam ao status anterior.
          </p>
          <label className="block">
            <span className="text-sm text-gray-600">Nova data fim</span>
            <input type="date" min={hoje} value={endDate} onChange={e => setEndDate(e.target.value)} className="mt-1 w-full border rounded px-3 py-2" />
          </label>
        </div>
        <div className="p-4 bg-gray-50 rounded-b-xl flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-outline">Cancelar</button>
          <button onClick={() => onConfirm(endDate)} disabled={!endDate || endDate < hoje} className="btn btn-primary">Prorrogar e reabrir</button>
        </div>
      </div>
    </div>
  );
}
