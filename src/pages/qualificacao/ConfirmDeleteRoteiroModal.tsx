import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

const CONFIRM_PHRASE = 'excluir roteiro';

interface Props {
  script: any;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export default function ConfirmDeleteRoteiroModal({ script, onCancel, onConfirm }: Props) {
  const [typed, setTyped] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const count = Number(script?.usage_count ?? 0);
  const avaliacoes = count === 1 ? '1 avaliação preenchida' : `${count} avaliações preenchidas`;
  const canConfirm = typed.trim().toLowerCase() === CONFIRM_PHRASE && !submitting;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-9 h-9 rounded-full bg-red-100 text-red-600">
              <AlertTriangle className="w-5 h-5" />
            </span>
            <h3 className="text-lg font-bold text-gray-900">Excluir roteiro</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600 p-1"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3 text-sm text-gray-700">
          <p className="font-medium text-gray-900">{script?.title}</p>
          {count > 0 ? (
            <p>
              Há <span className="font-semibold text-red-600">{avaliacoes}</span> por
              prestadores usando este roteiro. A exclusão também removerá esse histórico
              <span className="font-semibold"> permanentemente</span>.
            </p>
          ) : (
            <p>
              Este roteiro ainda <span className="font-semibold">não tem avaliações</span> vinculadas,
              mas a exclusão é <span className="font-semibold">permanente</span> e remove todas as
              seções, critérios e revisões.
            </p>
          )}
          <p>
            Para confirmar, digite{' '}
            <span className="font-mono font-semibold text-gray-900">{CONFIRM_PHRASE}</span> abaixo:
          </p>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={CONFIRM_PHRASE}
            autoFocus
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400"
          />
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Excluindo…' : 'Excluir definitivamente'}
          </button>
        </div>
      </div>
    </div>
  );
}
