// src/pages/qualificacao/ManualRoteiroModal.tsx
// Manual (PDF) do roteiro: enviar, substituir, baixar e remover (spec 2026-09-24).
// O manual vale para todas as revisões do roteiro (chave = source_file).
import React, { useState } from 'react';
import { fetchApi, manualHref } from '../../lib/api';
import { fmtDataHora } from '../../lib/formatDate';
import { X, Loader2, Upload, Download, Trash2, FileText } from 'lucide-react';

const MAX_MB = 20;
const fmtSize = (b: number) => b >= 1024 * 1024
  ? `${(b / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
  : `${Math.max(1, Math.round(b / 1024))} KB`;

interface Props { script: any; onClose: () => void; onChanged: () => void }

export default function ManualRoteiroModal({ script, onClose, onChanged }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const has = !!script.manual_filename;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); onChanged(); onClose(); }
    catch (e: any) { setError(e?.message || 'Erro ao salvar o manual.'); }
    finally { setBusy(false); }
  };

  const enviar = () => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) { setError('Selecione um arquivo PDF.'); return; }
    if (file.size > MAX_MB * 1024 * 1024) { setError(`O arquivo passa de ${MAX_MB} MB.`); return; }
    const fd = new FormData();
    fd.append('file', file);
    run(() => fetchApi(`/eval/scripts/${script.id}/manual`, { method: 'PUT', body: fd }));
  };

  const remover = () => {
    if (!confirm(`Remover o manual "${script.manual_filename}"? Os prestadores deixam de ver o botão de download.`)) return;
    run(() => fetchApi(`/eval/scripts/${script.id}/manual`, { method: 'DELETE' }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-start gap-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-gray-900">Manual do roteiro</h3>
            <p className="text-sm text-gray-600 truncate">{script.title}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Fechar"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-4">
          {has ? (
            <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <FileText className="w-5 h-5 text-emerald-700 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold text-gray-900 break-all">{script.manual_filename}</p>
                <p className="text-emerald-900">
                  {fmtSize(Number(script.manual_size_bytes || 0))} · enviado em {fmtDataHora(script.manual_uploaded_at)}
                </p>
              </div>
              <a href={manualHref(script.id)} className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-800 hover:underline shrink-0">
                <Download className="w-4 h-4" /> Baixar
              </a>
            </div>
          ) : (
            <p className="text-sm text-gray-600">Este roteiro ainda não tem manual. Os prestadores só veem o botão de download depois do envio.</p>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1" htmlFor="manual-file">
              {has ? 'Substituir por outro PDF' : 'Enviar PDF'} <span className="font-normal text-gray-500">(até {MAX_MB} MB)</span>
            </label>
            <input
              id="manual-file"
              type="file"
              accept="application/pdf,.pdf"
              onChange={e => { setFile(e.target.files?.[0] ?? null); setError(null); }}
              className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-semibold hover:file:bg-gray-200"
            />
          </div>

          <p className="text-xs text-gray-500">
            O manual vale para todas as revisões deste roteiro e só pode ser baixado por quem está logado no portal.
          </p>

          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-2">
          {has ? (
            <button onClick={remover} disabled={busy} className="inline-flex items-center gap-1 text-sm font-semibold text-red-600 hover:text-red-700 disabled:opacity-50">
              <Trash2 className="w-4 h-4" /> Remover manual
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-700 rounded-lg border border-gray-300 hover:bg-gray-50">Cancelar</button>
            <button
              onClick={enviar}
              disabled={!file || busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-white rounded-lg bg-[#00995D] hover:bg-[#007a4a] disabled:opacity-40"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {has ? 'Substituir' : 'Enviar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
