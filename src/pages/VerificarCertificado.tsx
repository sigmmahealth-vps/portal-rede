// src/pages/VerificarCertificado.tsx
// Alvo do QR code (spec 5.4.5). Pública — sem login, como /politica-privacidade.
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BadgeCheck, BadgeX, Clock } from 'lucide-react';
import { fetchApi } from '../lib/api';

interface VerifyResult {
  valido: boolean;
  expirado?: boolean;
  seal?: string;
  percentual?: number;
  provider_name?: string;
  location_label?: string | null;
  cycle_label?: string | null;
  issued_at?: string;
  valid_until?: string;
}

const fmtDateOnly = (d: string) => {
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
};

export default function VerificarCertificado() {
  const { codigo } = useParams();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    setResult(null);
    fetchApi(`/certificados/verificar/${encodeURIComponent(String(codigo ?? ''))}`)
      .then(setResult)
      .catch((e: any) => setError(e.message || 'Erro ao verificar.'));
  }, [codigo]);

  return (
    <div className="grid min-h-screen place-items-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <img src="/logo.svg" alt="Unimed Criciúma" className="mx-auto mb-4 h-12" />
        <h1 className="text-center text-lg font-bold text-secondary-900">
          Verificação de Certificado
        </h1>
        <p className="mt-1 text-center text-xs text-gray-500">
          Qualificação da Rede Credenciada — Unimed Criciúma
        </p>

        <div className="mt-6">
          {error ? (
            <p className="text-center text-sm text-red-600">{error}</p>
          ) : !result ? (
            <div className="flex justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-emerald-600" />
            </div>
          ) : !result.valido ? (
            <div className="text-center">
              <BadgeX className="mx-auto h-12 w-12 text-red-500" />
              <p className="mt-2 font-bold text-red-600">Certificado não encontrado</p>
              <p className="mt-1 text-sm text-gray-500">
                O código informado não corresponde a nenhum certificado emitido.
              </p>
            </div>
          ) : (
            <div>
              <div className="text-center">
                {result.expirado ? (
                  <>
                    <Clock className="mx-auto h-12 w-12 text-amber-500" />
                    <p className="mt-2 font-bold text-amber-600">
                      Certificado expirado em {fmtDateOnly(result.valid_until!)}
                    </p>
                  </>
                ) : (
                  <>
                    <BadgeCheck className="mx-auto h-12 w-12 text-emerald-500" />
                    <p className="mt-2 font-bold text-emerald-600">Certificado válido</p>
                  </>
                )}
              </div>
              <dl className="mt-6 space-y-2 border-t pt-4 text-sm">
                {([
                  ['Prestador', result.provider_name],
                  ['Unidade', result.location_label],
                  ['Selo', result.seal],
                  ['Pontuação', result.percentual != null ? `${result.percentual.toFixed(1)}%` : null],
                  ['Ciclo', result.cycle_label],
                  ['Emitido em', result.issued_at ? new Date(result.issued_at).toLocaleDateString('pt-BR') : null],
                  ['Válido até', result.valid_until ? fmtDateOnly(result.valid_until) : null],
                ] as [string, string | null | undefined][]).map(([label, value]) => value ? (
                  <div key={label} className="flex justify-between gap-4">
                    <dt className="text-gray-500">{label}</dt>
                    <dd className="font-semibold text-secondary-900">{value}</dd>
                  </div>
                ) : null)}
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
