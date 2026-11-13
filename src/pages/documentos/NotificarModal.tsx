import { useState } from 'react';
import { X } from 'lucide-react';
import { fetchApi } from '../../lib/api';

export default function NotificarModal({ doc, motivo, onClose, onDone }:
  { doc: any; motivo: 'vencido' | 'reprovado'; onClose: () => void; onDone: () => void }) {
  const padrao = `O documento "${doc.type}" está ${motivo === 'vencido' ? 'vencido' : 'reprovado'}. `
    + `Por favor, envie uma nova versão atualizada pelo portal, na Gestão Documental.`
    + (motivo === 'reprovado' && doc.rejection_reason ? `\nMotivo da reprovação: ${doc.rejection_reason}` : '');
  const [msg, setMsg] = useState(padrao);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    if (!msg.trim()) { setErro('A mensagem não pode ficar vazia.'); return; }
    setEnviando(true);
    try { await fetchApi(`/documents/${doc.id}/notificar`, { method: 'POST', body: JSON.stringify({ message: msg.trim() }) }); onDone(); }
    catch (e: any) { setErro(e.message); } finally { setEnviando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg space-y-3 rounded-xl bg-white p-6">
        <div className="flex items-center justify-between"><h3 className="font-bold">Notificar prestador</h3><button onClick={onClose}><X className="h-5 w-5 text-gray-500" /></button></div>
        <p className="text-sm text-gray-500">{doc.provider_name} — {doc.type}</p>
        <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={6} className="w-full rounded border px-3 py-2 text-sm" />
        {erro && <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{erro}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded px-4 py-2 text-gray-600">Cancelar</button>
          <button disabled={enviando} onClick={enviar} className="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700">Enviar</button>
        </div>
      </div>
    </div>
  );
}
