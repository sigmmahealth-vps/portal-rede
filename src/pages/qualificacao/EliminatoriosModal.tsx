// src/pages/qualificacao/EliminatoriosModal.tsx
// Marcação dos critérios eliminatórios de um roteiro (spec 2026-09-21).
import React, { useEffect, useMemo, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { X, AlertTriangle, Loader2, Lock, Save } from 'lucide-react';

interface Question {
  id: number | string; section_id: number | string; code: string | null; text: string;
  dimension: string | null; is_eliminatory: boolean; order_index: number;
}
interface Section { id: number | string; name: string }
interface ScriptDetail {
  id: number; title: string; version: string | null;
  sections: Section[]; questions: Question[]; eliminatory_locked: boolean;
}
interface Props { scriptId: number; onClose: () => void; onSaved: () => void }

export default function EliminatoriosModal({ scriptId, onClose, onSaved }: Props) {
  const [script, setScript] = useState<ScriptDetail | null>(null);
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const [dimension, setDimension] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchApi(`/eval/scripts/${scriptId}`)
      .then((data: ScriptDetail) => {
        setScript(data);
        // pg devolve bigint como string → normaliza para number
        setMarked(new Set(data.questions.filter((q) => q.is_eliminatory).map((q) => Number(q.id))));
      })
      .catch((err: any) => setError(err.message || 'Erro ao carregar o roteiro.'));
  }, [scriptId]);

  const dimensions = useMemo(
    () => [...new Set((script?.questions ?? []).map((q) => q.dimension).filter(Boolean) as string[])].sort(),
    [script],
  );

  // Seções na ordem do documento (ids são sequenciais no import); critérios por order_index.
  const groups = useMemo(() => {
    if (!script) return [];
    return [...script.sections]
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map((s) => ({
        section: s,
        questions: script.questions
          .filter((q) => Number(q.section_id) === Number(s.id) && (!dimension || q.dimension === dimension))
          .sort((a, b) => a.order_index - b.order_index),
      }))
      .filter((g) => g.questions.length > 0);
  }, [script, dimension]);

  const locked = !!script?.eliminatory_locked;

  const toggle = (id: number) => {
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await fetchApi(`/eval/scripts/${scriptId}/eliminatory`, {
        method: 'PATCH',
        body: JSON.stringify({ question_ids: [...marked] }),
      });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erro ao salvar os critérios eliminatórios.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-start gap-4">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Critérios eliminatórios</h3>
            <p className="text-sm text-gray-500">
              {script ? `${script.title} — revisão ${script.version ?? '—'}` : 'Carregando…'}
            </p>
          </div>
          <button onClick={onClose} disabled={saving} aria-label="Fechar" className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          <p className="text-sm text-gray-600">
            A não conformidade em um critério eliminatório rebaixa o selo a <strong>Bronze</strong>,
            independentemente da nota, e torna o item obrigatório no plano de ação.
          </p>

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {locked && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm">
              <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>Este roteiro tem avaliações em ciclo aberto. As marcações só podem ser alteradas com o ciclo encerrado.</span>
            </div>
          )}
          {script && marked.size === 0 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>Nenhum critério eliminatório marcado — o selo deste roteiro dependerá só da nota.</span>
            </div>
          )}

          {script && (
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-gray-700 flex items-center gap-2">
                Dimensão
                <select
                  value={dimension}
                  onChange={(e) => setDimension(e.target.value)}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
                >
                  <option value="">Todas</option>
                  {dimensions.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <span className="text-sm font-medium text-gray-700">
                {marked.size} eliminatório{marked.size === 1 ? '' : 's'} de {script.questions.length} critérios
              </span>
            </div>
          )}

          {!script && !error && (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          )}

          {groups.map(({ section, questions }) => (
            <fieldset key={String(section.id)} className="border border-gray-100 rounded-lg">
              <legend className="px-2 ml-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{section.name}</legend>
              <ul className="divide-y divide-gray-50">
                {questions.map((q) => {
                  const id = Number(q.id);
                  return (
                    <li key={id}>
                      <label className={`flex items-start gap-3 px-3 py-2 text-sm ${locked ? 'opacity-60' : 'cursor-pointer hover:bg-gray-50'}`}>
                        <input
                          type="checkbox"
                          className="mt-1 accent-[#00995D]"
                          checked={marked.has(id)}
                          disabled={locked}
                          onChange={() => toggle(id)}
                          aria-label={q.code ? `Marcar ${q.code} como eliminatório` : `Marcar critério como eliminatório: ${q.text}`}
                        />
                        {q.code && <span className="font-mono text-gray-500 flex-shrink-0">{q.code}</span>}
                        <span className="flex-1 text-gray-800">{q.text}</span>
                        {q.dimension && (
                          <span className="flex-shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">{q.dimension}</span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          ))}
        </div>

        <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {locked ? 'Fechar' : 'Cancelar'}
          </button>
          {!locked && (
            <button
              type="button"
              disabled={!script || saving}
              onClick={handleSave}
              className="px-4 py-2 bg-[#00995D] text-white rounded-lg hover:bg-[#007A4A] transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
