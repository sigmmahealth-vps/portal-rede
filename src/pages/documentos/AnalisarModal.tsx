import { useState } from 'react';
import { X, ZoomIn, ZoomOut, Download } from 'lucide-react';
import { fetchApi } from '../../lib/api';

export default function AnalisarModal({ doc, onClose, onDone }:
  { doc: any; onClose: () => void; onDone: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [issue, setIssue] = useState(doc.issue_date ?? '');
  const [expiry, setExpiry] = useState(doc.expiry_date ?? '');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [saving, setSaving] = useState(false);
  const somenteLeitura = doc.status !== 'pendente';
  const isPdf = String(doc.file_url ?? '').toLowerCase().endsWith('.pdf');
  const hojeISO = new Date().toLocaleDateString('en-CA');
  const validadeVencida = !!expiry && expiry < hojeISO;

  const decidir = async (status: 'valido' | 'reprovado') => {
    if (status === 'reprovado' && !motivo.trim()) { setErro('Informe o motivo da reprovação.'); return; }
    if (issue && issue > hojeISO) { setErro('A data de emissão não pode ser futura.'); return; }
    setSaving(true);
    try {
      await fetchApi(`/documents/${doc.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status, issue_date: issue || null, expiry_date: expiry || null, rejection_reason: status === 'reprovado' ? motivo : undefined }),
      });
      onDone();
    } catch (e: any) { setErro(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="font-bold">{doc.type} — {doc.provider_name ?? ''}</h3>
          <button onClick={onClose}><X className="h-5 w-5 text-gray-500" /></button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-auto border-r bg-gray-100">
            {!doc.file_url ? <div className="p-8 text-center text-gray-400">Sem arquivo.</div>
              : isPdf ? <iframe src={doc.file_url} className="h-full w-full border-0" title="documento" />
              : <div className="flex items-center justify-center p-4"><img src={doc.file_url} alt="documento" style={{ transform: `scale(${zoom})` }} /></div>}
          </div>
          <div className="w-80 space-y-3 overflow-y-auto p-4">
            {!isPdf && doc.file_url && (
              <div className="flex items-center gap-2">
                <button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} className="rounded border p-1"><ZoomOut className="h-4 w-4" /></button>
                <span className="text-sm">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(z => Math.min(3, z + 0.25))} className="rounded border p-1"><ZoomIn className="h-4 w-4" /></button>
              </div>
            )}
            {doc.file_url && <a href={doc.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-emerald-700"><Download className="h-4 w-4" /> Baixar</a>}
            <label className="block text-sm">Emissão<input type="date" max={hojeISO} value={issue || ''} onChange={e => setIssue(e.target.value)} disabled={somenteLeitura} className="mt-1 w-full rounded border px-2 py-1" /></label>
            <label className="block text-sm">Validade
              <input type="date" value={expiry || ''} onChange={e => setExpiry(e.target.value)} disabled={somenteLeitura}
                className={`mt-1 w-full rounded border px-2 py-1 ${validadeVencida ? 'border-red-400 text-red-700' : ''}`} />
              {validadeVencida && <span className="mt-1 block text-xs text-red-600">Validade já vencida.</span>}
            </label>
            {!somenteLeitura && (
              <label className="block text-sm">Motivo (ao reprovar)
                <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} className="mt-1 w-full rounded border px-2 py-1" />
              </label>
            )}
            {doc.rejection_reason && <div className="rounded bg-red-50 p-2 text-xs text-red-700">Reprovado: {doc.rejection_reason}</div>}
            {erro && <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{erro}</div>}
            {!somenteLeitura && (
              <div className="flex gap-2 pt-2">
                <button disabled={saving} onClick={() => decidir('valido')} className="flex-1 rounded bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700">Aprovar</button>
                <button disabled={saving} onClick={() => decidir('reprovado')} className="flex-1 rounded bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700">Reprovar</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
