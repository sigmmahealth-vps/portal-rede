import { useState } from 'react';
import { fetchApi } from '../../lib/api';
import { FileText, Check, X } from 'lucide-react';

type Cert = {
  id: number; title: string; kind: string | null; issuer: string | null;
  issued_date: string | null; expiry_date: string | null; status: string; rejection_reason: string | null; file_url: string | null;
};
const STATUS: Record<string, { label: string; cls: string }> = {
  pendente: { label: 'Pendente', cls: 'bg-blue-50 text-blue-700' },
  valido: { label: 'Válido', cls: 'bg-emerald-50 text-emerald-700' },
  reprovado: { label: 'Reprovado', cls: 'bg-red-50 text-red-700' },
};
const fmt = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');

export default function CertificacoesAdmin({ certifications, onChange }: { certifications: Cert[]; onChange: () => void }) {
  const [erro, setErro] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  async function mudar(id: number, status: 'valido' | 'reprovado') {
    setErro('');
    let rejection_reason: string | undefined;
    if (status === 'reprovado') {
      const m = window.prompt('Motivo da reprovação:');
      if (m === null) return;
      rejection_reason = m;
    }
    setBusyId(id);
    try {
      await fetchApi(`/certifications/${id}/status`, { method: 'PUT', body: JSON.stringify({ status, rejection_reason }) });
      onChange();
    } catch (e: any) { setErro(e.message); }
    finally { setBusyId(null); }
  }

  if (!certifications.length)
    return <div className="rounded-xl border border-gray-100 bg-white p-6 text-center text-sm text-gray-400">Nenhuma certificação enviada por este prestador.</div>;

  return (
    <div className="space-y-2">
      {erro && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}
      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100 text-left text-gray-500">
            <th className="px-4 py-3 font-medium">Título</th>
            <th className="px-4 py-3 font-medium">Emissor</th>
            <th className="px-4 py-3 font-medium">Validade</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Ações</th>
          </tr></thead>
          <tbody>
            {certifications.map(c => (
              <tr key={c.id} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-3 text-gray-900">
                  {c.file_url ? <a href={c.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline"><FileText className="h-4 w-4" />{c.title}</a> : c.title}
                  {c.status === 'reprovado' && c.rejection_reason && <div className="text-xs text-red-600">{c.rejection_reason}</div>}
                </td>
                <td className="px-4 py-3 text-gray-600">{c.issuer ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600">{fmt(c.expiry_date)}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[c.status]?.cls ?? ''}`}>{STATUS[c.status]?.label ?? c.status}</span></td>
                <td className="px-4 py-3">
                  {c.status === 'pendente' && (
                    <div className="flex gap-2">
                      <button disabled={busyId === c.id} onClick={() => mudar(c.id, 'valido')} title="Aprovar" className="text-emerald-600 hover:text-emerald-800 disabled:opacity-40"><Check className="h-4 w-4" /></button>
                      <button disabled={busyId === c.id} onClick={() => mudar(c.id, 'reprovado')} title="Reprovar" className="text-red-600 hover:text-red-800 disabled:opacity-40"><X className="h-4 w-4" /></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
