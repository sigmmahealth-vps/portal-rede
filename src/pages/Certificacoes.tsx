import { useEffect, useState } from 'react';
import { fetchApi } from '../lib/api';
import { Plus, Trash2, FileText } from 'lucide-react';

type Cert = {
  id: number; kind: string | null; title: string; issuer: string | null; level: string | null;
  issued_date: string | null; expiry_date: string | null; status: string; rejection_reason: string | null; file_url: string | null;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  pendente: { label: 'Pendente', cls: 'bg-blue-50 text-blue-700' },
  valido: { label: 'Válido', cls: 'bg-emerald-50 text-emerald-700' },
  reprovado: { label: 'Reprovado', cls: 'bg-red-50 text-red-700' },
};
const fmt = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');

export default function Certificacoes() {
  const [certs, setCerts] = useState<Cert[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [modal, setModal] = useState(false);

  const load = () => {
    setCarregando(true);
    fetchApi('/certifications').then(setCerts).catch(e => setErro(e.message)).finally(() => setCarregando(false));
  };
  useEffect(load, []);

  async function excluir(id: number) {
    setErro('');
    try { await fetchApi(`/certifications/${id}`, { method: 'DELETE' }); load(); }
    catch (e: any) { setErro(e.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Certificações</h1>
        <button onClick={() => setModal(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">
          <Plus className="h-4 w-4" /> Adicionar certificação
        </button>
      </div>
      {erro && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}

      {carregando ? <div className="p-8 text-center text-gray-400">Carregando…</div>
        : !certs.length ? <div className="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-400">Nenhuma certificação cadastrada.</div>
        : (
        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="px-4 py-3 font-medium">Título</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
              <th className="px-4 py-3 font-medium">Emissor</th>
              <th className="px-4 py-3 font-medium">Validade</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-left">Ações</th>
            </tr></thead>
            <tbody>
              {certs.map(c => (
                <tr key={c.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3 text-gray-900">
                    {c.file_url ? <a href={c.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline"><FileText className="h-4 w-4" />{c.title}</a> : c.title}
                    {c.status === 'reprovado' && c.rejection_reason && <div className="text-xs text-red-600">{c.rejection_reason}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{c.kind ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{c.issuer ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{fmt(c.expiry_date)}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[c.status]?.cls ?? ''}`}>{STATUS[c.status]?.label ?? c.status}</span></td>
                  <td className="px-4 py-3">
                    {c.status === 'pendente' && (
                      <button onClick={() => excluir(c.id)} title="Excluir" className="text-gray-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && <AddModal onClose={() => setModal(false)} onDone={() => { setModal(false); load(); }} />}
    </div>
  );
}

function AddModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const hojeISO = new Date().toLocaleDateString('en-CA');
  const [form, setForm] = useState({ kind: '', title: '', issuer: '', level: '', issued_date: '', expiry_date: '' });
  const [file, setFile] = useState<File | null>(null);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function salvar() {
    setErro('');
    if (!form.title.trim()) return setErro('Título é obrigatório.');
    if (!file) return setErro('Anexe o arquivo da certificação.');
    if (form.issued_date && form.issued_date > hojeISO) return setErro('A data de emissão não pode ser futura.');
    setEnviando(true);
    const fd = new FormData();
    fd.append('file', file);
    for (const [k, v] of Object.entries(form) as [string, string][]) if (v) fd.append(k, v);
    try { await fetchApi('/certifications', { method: 'POST', body: fd }); onDone(); }
    catch (e: any) { setErro(e.message); setEnviando(false); }
  }

  const vencida = !!form.expiry_date && form.expiry_date < hojeISO;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-bold text-gray-900">Adicionar certificação</h2>
        {erro && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2 text-sm">Título*<input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" value={form.title} onChange={e => set('title', e.target.value)} /></label>
          <label className="text-sm">Tipo<input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" value={form.kind} onChange={e => set('kind', e.target.value)} /></label>
          <label className="text-sm">Emissor<input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" value={form.issuer} onChange={e => set('issuer', e.target.value)} /></label>
          <label className="text-sm">Nível<input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" value={form.level} onChange={e => set('level', e.target.value)} /></label>
          <label className="text-sm">Emissão<input type="date" max={hojeISO} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" value={form.issued_date} onChange={e => set('issued_date', e.target.value)} /></label>
          <label className="text-sm">Validade<input type="date" className={`mt-1 w-full rounded-lg border px-3 py-2 ${vencida ? 'border-red-400 text-red-700' : 'border-gray-300'}`} value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} /></label>
          <label className="sm:col-span-2 text-sm">Arquivo*<input type="file" className="mt-1 w-full text-sm" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">Cancelar</button>
          <button onClick={salvar} disabled={enviando} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{enviando ? 'Enviando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  );
}
