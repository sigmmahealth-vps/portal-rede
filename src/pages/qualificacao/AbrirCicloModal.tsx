import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { X, AlertTriangle } from 'lucide-react';

export default function AbrirCicloModal({ cycle, onClose, onDone }: { cycle: any; onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try { setPreview(await fetchApi(`/eval/cycles/${cycle.id}/abertura-preview`)); }
      catch (e: any) { setErr(e.message || 'erro'); }
    })();
  }, [cycle.id]);

  const abrir = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetchApi(`/eval/cycles/${cycle.id}/abrir`, { method: 'POST' });
      alert(`Ciclo aberto: ${res.created.instances} instâncias, ${res.created.dl_bypass} DL bypass.`);
      onDone(); onClose();
    } catch (e: any) { setErr(e.message || 'erro'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
        <div className="p-5 border-b flex justify-between items-center">
          <h3 className="text-lg font-bold">Abrir {cycle.label}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          {!preview && !err && <p className="text-gray-500">Carregando preview...</p>}
          {err && <p className="text-red-600 text-sm">{err}</p>}
          {preview && (
            <>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 bg-emerald-50 rounded"><p className="text-2xl font-bold text-emerald-700">{preview.would_create.groups}</p><p className="text-xs text-gray-600">Grupos</p></div>
                <div className="p-3 bg-blue-50 rounded"><p className="text-2xl font-bold text-blue-700">{preview.would_create.instances}</p><p className="text-xs text-gray-600">Instâncias</p></div>
                <div className="p-3 bg-purple-50 rounded"><p className="text-2xl font-bold text-purple-700">{preview.would_create.dl_bypass}</p><p className="text-xs text-gray-600">DL bypass</p></div>
              </div>
              {preview.excluded.providers_without_group.length > 0 && (
                <div className="text-xs text-gray-600">
                  <strong>{preview.excluded.providers_without_group.length} prestadores sem grupo</strong> ficam de fora.
                </div>
              )}
              {preview.excluded.groups_without_script_mapping.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded flex gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong>Grupos ambíguos (roteiros distintos, não mapeados):</strong>
                    <ul className="mt-1 list-disc list-inside">
                      {preview.excluded.groups_without_script_mapping.map((g: string) => <li key={g}>{g}</li>)}
                    </ul>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="p-4 bg-gray-50 rounded-b-xl flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-outline">Cancelar</button>
          <button onClick={abrir} disabled={busy || !preview} className="btn btn-primary">
            {busy ? 'Abrindo...' : 'Confirmar abertura'}
          </button>
        </div>
      </div>
    </div>
  );
}
