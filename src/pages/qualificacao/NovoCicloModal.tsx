import React, { useState } from 'react';
import { fetchApi } from '../../lib/api';

export default function NovoCicloModal({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(initial?.label || '');
  const [start, setStart] = useState(initial?.start_date?.slice(0, 10) || '');
  const [end, setEnd] = useState(initial?.end_date?.slice(0, 10) || '');
  const [certValidUntil, setCertValidUntil] = useState(initial?.cert_valid_until?.slice(0, 10) || '');
  const [active, setActive] = useState(!!initial?.active);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // A validade dos certificados trava assim que o ciclo é aberto (tem instâncias).
  const opened = (initial?.instances_count ?? 0) > 0;

  const save = async () => {
    setErr(null); setSaving(true);
    try {
      // Não reenvia cert_valid_until em ciclo já aberto (o back rejeita).
      const cvu = opened ? undefined : certValidUntil;
      if (initial?.id) {
        await fetchApi(`/eval/cycles/${initial.id}`, { method: 'PATCH', body: JSON.stringify({ label, start_date: start, end_date: end, active, cert_valid_until: cvu }) });
      } else {
        await fetchApi('/eval/cycles', { method: 'POST', body: JSON.stringify({ label, start_date: start, end_date: end, active, cert_valid_until: cvu }) });
      }
      onSaved(); onClose();
    } catch (e: any) { setErr(e.message || 'erro'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="p-5 border-b border-gray-100">
          <h3 className="text-lg font-bold">{initial?.id ? 'Editar ciclo' : 'Novo ciclo'}</h3>
        </div>
        <div className="p-5 space-y-4">
          <label className="block">
            <span className="text-sm text-gray-600">Nome</span>
            <input value={label} onChange={e => setLabel(e.target.value)} className="mt-1 w-full border rounded px-3 py-2" placeholder="Ciclo 2027" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm text-gray-600">Início</span>
              <input type="date" value={start} onChange={e => setStart(e.target.value)} className="mt-1 w-full border rounded px-3 py-2" />
            </label>
            <label className="block">
              <span className="text-sm text-gray-600">Fim</span>
              <input type="date" value={end} onChange={e => setEnd(e.target.value)} className="mt-1 w-full border rounded px-3 py-2" />
            </label>
          </div>
          <label className="block">
            <span className="text-sm text-gray-600">Validade dos certificados</span>
            <input
              type="date"
              value={certValidUntil}
              min={end || undefined}
              disabled={opened}
              onChange={e => setCertValidUntil(e.target.value)}
              className="mt-1 w-full border rounded px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500"
            />
            <span className="mt-1 block text-xs text-gray-500">
              {opened
                ? 'Ciclo já aberto — a validade não pode mais ser alterada.'
                : 'Todos os certificados emitidos neste ciclo valerão até esta data. Trava ao abrir o ciclo.'}
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            <span>Ativar este ciclo (desativa o atual)</span>
          </label>
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>
        <div className="p-4 bg-gray-50 rounded-b-xl flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-outline">Cancelar</button>
          <button onClick={save} disabled={saving || !label || !start || !end || (!opened && !certValidUntil)} className="btn btn-primary">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
