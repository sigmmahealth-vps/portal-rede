import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { fetchApi } from '../../lib/api';

interface Tipo {
  id: number; nome: string; categoria: string | null;
  obrigatorio: boolean; escopo: 'prestador' | 'profissional'; ativo: boolean; ordem: number;
}
const CATEGORIAS = ['obrigatoria', 'tecnica', 'regulatoria', 'contratual'];
const vazio = (): Partial<Tipo> => ({ nome: '', categoria: null, obrigatorio: false, escopo: 'prestador', ativo: true, ordem: 0 });

export default function TiposDocumentoTab() {
  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [erro, setErro] = useState('');
  const [editando, setEditando] = useState<Partial<Tipo> | null>(null);

  const carregar = () => fetchApi('/admin/document-types').then(setTipos).catch(e => setErro(e.message));
  useEffect(() => { carregar(); }, []);

  const salvar = async () => {
    if (!editando) return;
    try {
      const body = JSON.stringify(editando);
      if (editando.id) await fetchApi(`/admin/document-types/${editando.id}`, { method: 'PUT', body });
      else await fetchApi('/admin/document-types', { method: 'POST', body });
      setEditando(null); carregar();
    } catch (e: any) { setErro(e.message); }
  };

  const excluir = async (t: Tipo) => {
    if (!confirm(`Excluir/desativar o tipo "${t.nome}"?`)) return;
    try { await fetchApi(`/admin/document-types/${t.id}`, { method: 'DELETE' }); carregar(); }
    catch (e: any) { setErro(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Tipos de Documento</h2>
        <button onClick={() => setEditando(vazio())}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700">
          <Plus size={16} /> Novo Tipo
        </button>
      </div>
      {erro && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}

      <table className="min-w-full divide-y divide-gray-200">
        <thead>
          <tr className="text-left text-xs font-medium uppercase text-gray-500">
            <th className="px-4 py-2">Nome</th><th className="px-4 py-2">Categoria</th>
            <th className="px-4 py-2">Escopo</th><th className="px-4 py-2">Ativo</th><th className="px-4 py-2">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {tipos.map(t => (
            <tr key={t.id} className={t.ativo ? '' : 'opacity-50'}>
              <td className="px-4 py-2">{t.nome}</td>
              <td className="px-4 py-2">{t.categoria ?? '—'}</td>
              <td className="px-4 py-2">{t.escopo}</td>
              <td className="px-4 py-2">{t.ativo ? 'Sim' : 'Não'}</td>
              <td className="px-4 py-2">
                <button onClick={() => setEditando(t)} className="mr-3 text-gray-500 hover:text-emerald-600"><Pencil size={16} /></button>
                <button onClick={() => excluir(t)} className="text-gray-500 hover:text-red-600"><Trash2 size={16} /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {editando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-6">
            <h3 className="text-lg font-bold">{editando.id ? 'Editar' : 'Novo'} tipo</h3>
            <input className="w-full rounded border px-3 py-2" placeholder="Nome"
              value={editando.nome ?? ''} onChange={e => setEditando({ ...editando, nome: e.target.value })} />
            <select className="w-full rounded border px-3 py-2"
              value={editando.categoria ?? ''} onChange={e => setEditando({ ...editando, categoria: e.target.value || null })}>
              <option value="">(sem categoria)</option>
              {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="w-full rounded border px-3 py-2"
              value={editando.escopo ?? 'prestador'} onChange={e => setEditando({ ...editando, escopo: e.target.value as Tipo['escopo'] })}>
              <option value="prestador">prestador</option>
              <option value="profissional">profissional</option>
            </select>
            <input type="number" className="w-full rounded border px-3 py-2" placeholder="Ordem"
              value={editando.ordem ?? 0} onChange={e => setEditando({ ...editando, ordem: Number(e.target.value) })} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!editando.obrigatorio}
                onChange={e => setEditando({ ...editando, obrigatorio: e.target.checked })} /> Obrigatório
            </label>
            {editando.id && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editando.ativo !== false}
                  onChange={e => setEditando({ ...editando, ativo: e.target.checked })} /> Ativo
              </label>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditando(null)} className="rounded px-4 py-2 text-gray-600">Cancelar</button>
              <button onClick={salvar} className="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
