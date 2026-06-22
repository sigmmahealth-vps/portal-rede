import React, { useState } from 'react';
import { fetchApi } from '../../lib/api';
import { X, UploadCloud, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';

interface PreviewResult {
  title: string;
  version: string;
  sourceFile: string;
  sectionCount: number;
  questionCount: number;
  totalMaxScore: number;
  dimensions: Record<string, number>;
  warnings: {
    orphans: string[];
    noWeight: number;
    noEvidence: number;
    noHeader: boolean;
  };
  existing: { currentVersion: number; nextVersion: number } | null;
  blocked: boolean;
}

interface Props {
  onClose: () => void;
  onImported: () => void;
}

type Stage = 'select' | 'review';

export default function ImportRoteiroModal({ onClose, onImported }: Props) {
  const [stage, setStage] = useState<Stage>('select');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const f = e.target.files?.[0] ?? null;
    setFile(f);
  };

  const handlePreview = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await fetchApi('/eval/scripts/preview', { method: 'POST', body: form });
      setPreview(data);
      setStage('review');
    } catch (err: any) {
      setError(err.message || 'Não foi possível ler a planilha.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!file || !preview || preview.blocked) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      await fetchApi('/eval/scripts/import', { method: 'POST', body: form });
      onImported();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Falha ao importar o roteiro.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h3 className="text-lg font-bold text-gray-900">Subir roteiro (.xlsx)</h3>
          <button onClick={onClose} aria-label="Fechar" className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {stage === 'select' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Selecione um arquivo <strong>.xlsx</strong> de roteiro. Você verá uma
                prévia antes de confirmar a importação. Nada é gravado até você confirmar.
              </p>
              <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-gray-300 rounded-xl p-8 cursor-pointer hover:border-[#00995D] transition-colors">
                <UploadCloud className="w-10 h-10 text-gray-400" />
                <span className="text-sm text-gray-600">
                  {file ? file.name : 'Clique para escolher o arquivo .xlsx'}
                </span>
                <input type="file" accept=".xlsx" className="hidden" onChange={handleSelect} />
              </label>
            </div>
          )}

          {stage === 'review' && preview && (
            <div className="space-y-5">
              <div>
                <h4 className="text-base font-bold text-gray-900">{preview.title}</h4>
                <p className="text-xs text-gray-500">
                  Arquivo: {preview.sourceFile} · revisão da planilha: {preview.version}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Stat label="Seções" value={preview.sectionCount} />
                <Stat label="Critérios" value={preview.questionCount} />
                <Stat label="Pontuação máx." value={preview.totalMaxScore} />
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">Dimensões</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(preview.dimensions).map(([k, v]) => (
                    <span key={k} className="px-2.5 py-1 rounded-full text-xs bg-gray-100 text-gray-700">
                      {k}: {v}
                    </span>
                  ))}
                </div>
              </div>

              {preview.existing && (
                <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg p-3 text-sm">
                  Já existe a versão {preview.existing.currentVersion} deste arquivo.
                  Confirmar criará a <strong>versão {preview.existing.nextVersion}</strong>{' '}
                  (a anterior é mantida).
                </div>
              )}

              {(preview.warnings.noHeader
                || preview.warnings.noWeight > 0
                || preview.warnings.noEvidence > 0
                || preview.warnings.orphans.length > 0) && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm space-y-1">
                  <p className="font-medium flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" /> Avisos
                  </p>
                  {preview.warnings.noHeader && <p>• Cabeçalho de colunas não reconhecido.</p>}
                  {preview.warnings.noWeight > 0 && <p>• {preview.warnings.noWeight} critério(s) sem peso máximo.</p>}
                  {preview.warnings.noEvidence > 0 && <p>• {preview.warnings.noEvidence} critério(s) sem evidência.</p>}
                  {preview.warnings.orphans.length > 0 && (
                    <p>• {preview.warnings.orphans.length} linha(s) não classificada(s).</p>
                  )}
                </div>
              )}

              {preview.blocked && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
                  Esta planilha não pode ser importada (0 critérios ou layout inválido).
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          {stage === 'review' && (
            <button
              type="button"
              onClick={() => { setStage('select'); setPreview(null); setError(null); }}
              className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Voltar
            </button>
          )}
          {stage === 'select' && (
            <button
              type="button"
              disabled={!file || loading}
              onClick={handlePreview}
              className="px-4 py-2 bg-[#00995D] text-white rounded-lg hover:bg-[#007A4A] transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Ver prévia
            </button>
          )}
          {stage === 'review' && preview && (
            <button
              type="button"
              disabled={preview.blocked || loading}
              onClick={handleConfirm}
              className="px-4 py-2 bg-[#00995D] text-white rounded-lg hover:bg-[#007A4A] transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Confirmar importação
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-center">
      <p className="text-2xl font-bold text-gray-800">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}
