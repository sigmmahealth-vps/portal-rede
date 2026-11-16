import { useState } from 'react';
import { fetchApi } from '../../lib/api';
import { FileText, Check, X } from 'lucide-react';

type Edu = {
  id: number; nivel: string; curso: string | null; instituicao: string | null;
  conclusao_date: string | null; status: string; rejection_reason: string | null; file_url: string | null;
};
const NIVEL_LABEL: Record<string, string> = {
  ensino_medio: 'Ensino Médio', tecnico: 'Técnico', graduacao: 'Graduação',
  especializacao: 'Especialização', residencia: 'Residência', mestrado: 'Mestrado',
  doutorado: 'Doutorado', pos_doutorado: 'Pós-Doutorado',
};
const STATUS: Record<string, { label: string; cls: string }> = {
  pendente: { label: 'Pendente', cls: 'bg-blue-50 text-blue-700' },
  valido: { label: 'Válido', cls: 'bg-emerald-50 text-emerald-700' },
  reprovado: { label: 'Reprovado', cls: 'bg-red-50 text-red-700' },
};
const fmt = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');

export default function EducacaoAdmin({ education, onChange }: { education: Edu[]; onChange: () => void }) {
  const [erro, setErro] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  async function mudar(id: number, status: 'valido' | 'reprovado') {
    setErro('');
    let rejection_reason: string | undefined;
    if (status === 'reprovado') {
      const m = window.prompt('Motivo da reprovação:');
      if (m === null) return;
      if (!m.trim()) { setErro('Informe o motivo da reprovação.'); return; }
      rejection_reason = m.trim();
    }
    setBusyId(id);
    try {
      await fetchApi(`/education/${id}/status`, { method: 'PUT', body: JSON.stringify({ status, rejection_reason }) });
      onChange();
    } catch (e: any) { setErro(e.message); }
    finally { setBusyId(null); }
  }

  if (!education.length)
    return <div className="rounded-xl border border-gray-100 bg-white p-6 text-center text-sm text-gray-400">Nenhuma formação enviada por este prestador.</div>;

  return (
    <div className="space-y-2">
      {erro && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}
      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100 text-left text-gray-500">
            <th className="px-4 py-3 font-medium">Curso</th>
            <th className="px-4 py-3 font-medium">Nível</th>
            <th className="px-4 py-3 font-medium">Instituição</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Ações</th>
          </tr></thead>
          <tbody>
            {education.map(e => (
              <tr key={e.id} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-3 text-gray-900">
                  {e.file_url ? <a href={e.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline"><FileText className="h-4 w-4" />{e.curso ?? '—'}</a> : (e.curso ?? '—')}
                  {e.status === 'reprovado' && e.rejection_reason && <div className="text-xs text-red-600">{e.rejection_reason}</div>}
                </td>
                <td className="px-4 py-3 text-gray-600">{NIVEL_LABEL[e.nivel] ?? e.nivel}</td>
                <td className="px-4 py-3 text-gray-600">{e.instituicao ?? '—'}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[e.status]?.cls ?? ''}`}>{STATUS[e.status]?.label ?? e.status}</span></td>
                <td className="px-4 py-3">
                  {e.status === 'pendente' && (
                    <div className="flex gap-2">
                      <button disabled={busyId === e.id} onClick={() => mudar(e.id, 'valido')} title="Aprovar" className="text-emerald-600 hover:text-emerald-800 disabled:opacity-40"><Check className="h-4 w-4" /></button>
                      <button disabled={busyId === e.id} onClick={() => mudar(e.id, 'reprovado')} title="Reprovar" className="text-red-600 hover:text-red-800 disabled:opacity-40"><X className="h-4 w-4" /></button>
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
