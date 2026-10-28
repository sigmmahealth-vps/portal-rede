import React, { useState } from 'react';
import { fetchApi } from '../../lib/api';
import { fmtData } from '../../lib/formatDate';

export default function NovoCicloModal({ initial, onClose, onSaved }: { initial?: any; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState(initial?.label || '');
  const [start, setStart] = useState(initial?.start_date?.slice(0, 10) || '');
  const [end, setEnd] = useState(initial?.end_date?.slice(0, 10) || '');
  const [certValidUntil, setCertValidUntil] = useState(initial?.cert_valid_until?.slice(0, 10) || '');
  const [noticeDate, setNoticeDate] = useState(initial?.reanalysis_notice_date?.slice(0, 10) || '');
  const [active, setActive] = useState(!!initial?.active);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const opened = (initial?.instances_count ?? 0) > 0;
  // A validade congela no 1º certificado emitido; com o ciclo aberto e sem certificado, só o admin ajusta.
  const emitted = (initial?.certificates_count ?? 0) > 0;
  const isAdmin = (() => { try { return JSON.parse(localStorage.getItem('user') || 'null')?.role === 'admin'; } catch { return false; } })();
  const validityLocked = emitted || (opened && !isAdmin);
  const validityPast = !!certValidUntil && certValidUntil < new Date().toLocaleDateString('sv-SE');
  // Ciclo encerrado com instâncias não reativa pelo modal (o PATCH devolve 409) —
  // a reabertura é pelos botões Reabrir/Prorrogar, que restauram as avaliações.
  const lockedClosed = opened && initial && !initial.active;

  const save = async () => {
    setErr(null); setSaving(true);
    try {
      // Só reenvia cert_valid_until quando pode mudar e, em ciclo aberto, só se mudou (o back rejeita os outros casos).
      const unchanged = certValidUntil === (initial?.cert_valid_until?.slice(0, 10) || '');
      const cvu = validityLocked || (opened && unchanged) ? undefined : certValidUntil;
      if (initial?.id) {
        await fetchApi(`/eval/cycles/${initial.id}`, { method: 'PATCH', body: JSON.stringify({ label, start_date: start, end_date: end, active: lockedClosed ? undefined : active, cert_valid_until: cvu, reanalysis_notice_date: noticeDate }) });
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
            {validityLocked ? (
              <div className="mt-1 w-full rounded border bg-gray-100 px-3 py-2 text-gray-700">
                {certValidUntil ? fmtData(certValidUntil) : '—'}
              </div>
            ) : (
              <input
                type="date"
                value={certValidUntil}
                onChange={e => setCertValidUntil(e.target.value)}
                className="mt-1 w-full border rounded px-3 py-2"
              />
            )}
            <span className="mt-1 block text-xs text-gray-500">
              {emitted
                ? 'Já há certificado emitido neste ciclo — a validade não pode mais ser alterada.'
                : validityLocked
                  ? 'Ciclo já aberto — só o administrador altera a validade (até o 1º certificado emitido).'
                  : 'Todos os certificados emitidos neste ciclo valerão até esta data. Trava no 1º certificado emitido.'}
            </span>
            {opened && !emitted && validityPast && (
              <span className="mt-1 block text-xs font-semibold text-red-700">
                Esta data já passou: os pareceres finais deste ciclo ficam bloqueados até a validade ser ajustada.
              </span>
            )}
          </label>
          {initial?.id && (
            <label className="block">
              <span className="text-sm text-gray-600">Prazo informado nos avisos de reanálise (opcional)</span>
              <input type="date" value={noticeDate} max={end || undefined} onChange={e => setNoticeDate(e.target.value)}
                className="mt-1 w-full border rounded px-3 py-2" />
              <span className="mt-1 block text-xs text-gray-500">
                Só muda a data escrita nos e-mails e avisos de reanálise — não bloqueia o reenvio. Vazio ou já passado: os avisos usam a data fim do ciclo.
              </span>
            </label>
          )}
          {lockedClosed ? (
            <p className="text-xs text-gray-500">Ciclo encerrado — para reativar use Reabrir ou Prorrogar na lista de ciclos.</p>
          ) : (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
              <span>Ativar este ciclo (desativa o atual)</span>
            </label>
          )}
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>
        <div className="p-4 bg-gray-50 rounded-b-xl flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-outline">Cancelar</button>
          <button onClick={save} disabled={saving || !label || !start || !end || (!validityLocked && !certValidUntil)} className="btn btn-primary">
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}
