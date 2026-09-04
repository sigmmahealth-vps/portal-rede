// src/pages/qualificacao/CertificadosTab.tsx
import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Award, Download } from 'lucide-react';
import { fetchApi } from '../../lib/api';
import { fmtData, fmtPct } from '../../lib/formatDate';

export interface Certificate {
  id: number;
  verify_code: string;
  issued_at: string;
  valid_until: string;
  seal: 'Ouro' | 'Prata' | 'Bronze';
  percentual: number;
  cycle_id: number | null;
  cycle_label: string | null;
  cycle_active: boolean;
  provider_name: string;
  location_label: string | null;
  location_address: string | null;
  dimensions: { dimension: string; pct: number }[];
}

// Gradiente do cabeçalho por selo (mockup Tela 1).
export const SEAL_STYLES: Record<string, { grad: string; text: string }> = {
  Ouro:   { grad: 'from-amber-100 to-amber-300',  text: 'text-amber-900' },
  Prata:  { grad: 'from-gray-100 to-gray-300',    text: 'text-gray-800' },
  Bronze: { grad: 'from-orange-100 to-orange-300', text: 'text-orange-900' },
};

const fmtDate = (d: string) => fmtData(d);
export const fmtDateOnly = (d: string) => fmtData(d);

export default function CertificadosTab() {
  const [certs, setCerts] = useState<Certificate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cycleId, setCycleId] = useState<number | 'todos'>('todos');
  const [qrs, setQrs] = useState<Record<number, string>>({});

  useEffect(() => {
    fetchApi('/me/certificates')
      .then((data: Certificate[]) => {
        setCerts(data);
        // Default: ciclo ativo se houver certificado nele; senão "todos".
        const active = data.find(c => c.cycle_active);
        if (active?.cycle_id != null) setCycleId(active.cycle_id);
      })
      .catch((e: any) => {
        console.error(e);
        setError(e?.message || 'Erro ao carregar certificados.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    certs.forEach(c => {
      QRCode.toDataURL(`${window.location.origin}/verificar/${c.verify_code}`, { margin: 1, width: 160 })
        .then(url => setQrs(prev => ({ ...prev, [c.id]: url })))
        .catch(console.error);
    });
  }, [certs]);

  const cycles = useMemo(() => {
    const seen = new Map<number, string>();
    certs.forEach(c => { if (c.cycle_id != null) seen.set(c.cycle_id, c.cycle_label ?? `Ciclo ${c.cycle_id}`); });
    return [...seen.entries()];
  }, [certs]);

  const visible = cycleId === 'todos' ? certs : certs.filter(c => c.cycle_id === cycleId);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-emerald-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm font-semibold text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-secondary-900">Meus Certificados</h2>
        {cycles.length > 0 && (
          <label className="flex items-center gap-2 text-sm font-semibold text-secondary-900">
            Ciclo:
            <select
              value={String(cycleId)}
              onChange={e => setCycleId(e.target.value === 'todos' ? 'todos' : Number(e.target.value))}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            >
              <option value="todos">Todos os ciclos</option>
              {cycles.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-20 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <Award className="h-7 w-7" />
          </div>
          <h3 className="text-lg font-bold text-secondary-900">Nenhum certificado neste ciclo ainda</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
            O certificado é emitido automaticamente quando a análise da sua avaliação é concluída.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {visible.map(c => {
            const style = SEAL_STYLES[c.seal] ?? SEAL_STYLES.Prata;
            return (
              <div key={c.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className={`flex items-start justify-between bg-gradient-to-br ${style.grad} p-5`}>
                  <div>
                    <p className={`text-[10px] font-bold uppercase tracking-widest ${style.text} opacity-70`}>
                      Qualificação Rede Credenciada
                    </p>
                    <p className={`text-2xl font-extrabold ${style.text}`}>{c.seal}</p>
                  </div>
                  <Award className={`h-8 w-8 ${style.text} opacity-60`} />
                </div>

                <div className="space-y-4 p-5">
                  <p className="text-sm text-gray-600">
                    Certificamos que <span className="font-bold text-secondary-900">{c.provider_name}</span>
                  </p>
                  {c.location_address && (
                    <p className="text-sm font-semibold text-secondary-900">{c.location_address}</p>
                  )}

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Ciclo</p>
                      <p className="text-sm font-bold text-secondary-900">{c.cycle_label ?? '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Pontuação Final</p>
                      <p className="text-sm font-bold text-secondary-900">{fmtPct(c.percentual)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Data Emissão</p>
                      <p className="text-sm font-bold text-secondary-900">{fmtDate(c.issued_at)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Validade</p>
                      <p className="text-sm font-bold text-secondary-900">{fmtDateOnly(c.valid_until)}</p>
                    </div>
                  </div>

                  {c.dimensions.length > 0 && (
                    <div className="rounded-xl bg-gray-50 p-4">
                      <p className="mb-2 border-b pb-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                        Desempenho por Dimensão
                      </p>
                      {c.dimensions.map(d => (
                        <div key={d.dimension} className="flex items-center justify-between py-1">
                          <span className="text-sm text-gray-600">{d.dimension}</span>
                          <span className="text-sm font-bold text-emerald-600">{d.pct.toFixed(1)}%</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between border-t pt-4">
                    <div className="flex items-center gap-3">
                      {qrs[c.id] && <img src={qrs[c.id]} alt="QR code de verificação" className="h-14 w-14 rounded border border-gray-200" />}
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Autenticidade Verificada</p>
                      </div>
                    </div>
                    <button
                      onClick={() => window.open(`/qualificacao/certificado/${c.id}/imprimir`, '_blank')}
                      className="inline-flex items-center gap-2 rounded-lg bg-secondary-900 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-secondary-800"
                    >
                      <Download className="h-4 w-4" /> PDF
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
