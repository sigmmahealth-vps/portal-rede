import { useEffect, useMemo, useState } from 'react';
import { Search, Download, Eye } from 'lucide-react';
import { fetchApi } from '../../lib/api';
import { statusDocumento, StatusDoc } from '../../lib/documentoStatus.js';
import { providerAudience } from '../../lib/providerAudience.js';

interface Doc {
  id: number; provider_id: number; provider_name?: string; type?: string;
  status: string; upload_date?: string; expiry_date?: string | null;
  person_type?: string | null; provider_group?: string | null; rejection_reason?: string | null; file_url?: string | null;
}
const STATUS_LABEL: Record<StatusDoc, string> = {
  pendente: 'Pendente', aprovado: 'Aprovado', vencido: 'Vencido', reprovado: 'Reprovado', historico: 'Histórico',
};
const STATUS_COR: Record<StatusDoc, string> = {
  pendente: 'bg-blue-100 text-blue-700', aprovado: 'bg-emerald-100 text-emerald-700',
  vencido: 'bg-amber-100 text-amber-800', reprovado: 'bg-red-100 text-red-700', historico: '',
};

export default function InvestigacaoLista({ audiencia, onAnalisar, onNotificar, reloadKey }:
  { audiencia: 'medicos' | 'rede'; onAnalisar: (d: Doc) => void; onNotificar: (d: Doc) => void; reloadKey?: number }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [fStatus, setFStatus] = useState<'' | StatusDoc>('');
  const [fGrupo, setFGrupo] = useState('');

  useEffect(() => {
    fetchApi('/documents').then(setDocs).catch(e => setErro(e.message));
  }, [reloadKey]);

  const hoje = new Date();
  const linhas = useMemo(() => docs
    .filter(d => (d as any).type_id != null)                 // só gestão documental
    .map(d => ({ d, st: statusDocumento(d, hoje) }))
    .filter(x => x.st !== 'historico')
    .filter(x => providerAudience(x.d.person_type ?? null, x.d.provider_group ?? null) === audiencia)
    .filter(x => !fStatus || x.st === fStatus)
    .filter(x => !fGrupo || (x.d.provider_group ?? '') === fGrupo)
    .filter(x => {
      const q = busca.trim().toLowerCase();
      return !q || (x.d.provider_name ?? '').toLowerCase().includes(q) || (x.d.type ?? '').toLowerCase().includes(q);
    }), [docs, audiencia, fStatus, fGrupo, busca]);

  const grupos = useMemo(() => Array.from(new Set(docs
    .filter(d => providerAudience(d.person_type ?? null, d.provider_group ?? null) === audiencia)
    .map(d => d.provider_group).filter(Boolean))) as string[], [docs, audiencia]);

  const fmt = (s?: string | null) => s ? new Date(s).toLocaleDateString('pt-BR') : '—';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 bg-white p-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar prestador ou documento…"
            className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm" />
        </div>
        <select value={fStatus} onChange={e => setFStatus(e.target.value as any)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Todos os status</option>
          {(['pendente', 'aprovado', 'vencido', 'reprovado'] as StatusDoc[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select value={fGrupo} onChange={e => setFGrupo(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Todos os grupos</option>
          {grupos.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <a href="/api/documents/export" className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700">
          <Download className="h-4 w-4" /> Exportar .xlsx
        </a>
      </div>

      {erro && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-medium uppercase text-gray-500">
                <th className="px-4 py-3">Prestador</th><th className="px-4 py-3">Documento</th>
                <th className="px-4 py-3">Data Envio</th><th className="px-4 py-3">Validade</th>
                <th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {linhas.map(({ d, st }) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 text-sm">{d.provider_name ?? '—'}</td>
                  <td className="px-4 py-3 text-sm">{d.type ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{fmt(d.upload_date)}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{fmt(d.expiry_date)}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COR[st]}`}>{STATUS_LABEL[st]}</span></td>
                  <td className="px-4 py-3 text-right text-sm">
                    {st === 'pendente' && <button onClick={() => onAnalisar(d)} className="font-medium text-emerald-700 hover:underline">Analisar</button>}
                    {(st === 'vencido' || st === 'reprovado') && <button onClick={() => onNotificar(d)} className="font-medium text-amber-700 hover:underline">Notificar</button>}
                    {st === 'aprovado' && <button onClick={() => onAnalisar(d)} className="inline-flex items-center gap-1 text-gray-500 hover:text-emerald-700"><Eye className="h-4 w-4" />Ver</button>}
                  </td>
                </tr>
              ))}
              {linhas.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Nenhum documento.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
