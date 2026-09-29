import { useState } from 'react';
import { createPortal } from 'react-dom';
import PoliticaTexto from './PoliticaTexto';
import { fetchApi } from '../lib/api';
import { PRIVACY_POLICY_VERSION } from '../lib/privacyPolicy';

// Aceite da Política de Privacidade no primeiro acesso (spec 2026-09-29). Bloqueante:
// sem fechar por fora/ESC — só aceitar ou sair. Portal acima do header (ver camadas z-index do Layout).
export default function PrivacyConsentModal({ onAccepted, onLogout }: { onAccepted: () => void; onLogout: () => void }) {
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setSaving(true);
    setError(null);
    try {
      await fetchApi('/privacy/accept', { method: 'POST', body: JSON.stringify({ version: PRIVACY_POLICY_VERSION }) });
      onAccepted();
    } catch (e: any) {
      setError(e.message || 'Falha ao registrar o aceite.');
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/70 p-4" role="dialog" aria-modal="true" aria-labelledby="privacy-title">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 id="privacy-title" className="text-xl font-bold text-gray-900">Política de Privacidade</h2>
          <p className="text-sm text-gray-500">Leia a política abaixo para continuar usando o portal.</p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <PoliticaTexto />
        </div>
        <div className="space-y-3 border-t border-gray-100 px-6 py-4">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-[#00995D] focus:ring-[#00995D]" />
            Li e aceito a Política de Privacidade
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-3">
            <button onClick={onLogout} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">Sair</button>
            <button onClick={accept} disabled={!checked || saving}
              className="rounded-md bg-[#00995D] px-4 py-2 text-sm font-medium text-white hover:bg-[#007a4a] disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? 'Registrando…' : 'Continuar'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
