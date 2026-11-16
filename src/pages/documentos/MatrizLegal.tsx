import { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';

type Tipo = { id: number; nome: string; ordem: number };
type Req = { type_id: number; role: string };

const ROLES: [string, string][] = [
  ['cooperado', 'Médico Cooperado'],
  ['credenciado', 'Médico Credenciado'],
  ['pf_nao_medico', 'PF não médico'],
  ['prestador', 'Prestador PJ'],
];
const chave = (typeId: number, role: string) => `${typeId}:${role}`;

export default function MatrizLegal() {
  const [tipos, setTipos] = useState<Tipo[]>([]);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    fetchApi('/admin/document-requirements')
      .then((d: { types: Tipo[]; requirements: Req[] }) => {
        setTipos(d.types);
        setMarcados(new Set(d.requirements.map(r => chave(r.type_id, r.role))));
      })
      .catch(e => setErro(e.message))
      .finally(() => setCarregando(false));
  }, []);

  async function alternar(typeId: number, role: string, obrigatorio: boolean) {
    const k = chave(typeId, role);
    // Otimista: atualiza já; reverte se o PUT falhar.
    setMarcados(prev => {
      const n = new Set(prev);
      if (obrigatorio) n.add(k); else n.delete(k);
      return n;
    });
    setErro('');
    try {
      await fetchApi('/admin/document-requirements', {
        method: 'PUT',
        body: JSON.stringify({ type_id: typeId, role, obrigatorio }),
      });
    } catch (e: any) {
      setErro(e.message);
      setMarcados(prev => {
        const n = new Set(prev);
        if (obrigatorio) n.delete(k); else n.add(k);
        return n;
      });
    }
  }

  if (carregando) return <div className="p-8 text-center text-gray-400">Carregando…</div>;
  if (erro && !tipos.length)
    return <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>;
  if (!tipos.length)
    return <div className="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-400">
      Nenhum tipo de documento cadastrado. Cadastre tipos no catálogo primeiro.
    </div>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Marque quais documentos são obrigatórios para cada função de prestador.
      </p>
      {erro && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}
      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="px-4 py-3 font-medium">Documento</th>
              {ROLES.map(([role, label]) => (
                <th key={role} className="px-4 py-3 text-center font-medium">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tipos.map(t => (
              <tr key={t.id} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-3 text-gray-900">{t.nome}</td>
                {ROLES.map(([role, label]) => (
                  <td key={role} className="px-4 py-3 text-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-emerald-600"
                      aria-label={`${t.nome} obrigatório para ${label}`}
                      checked={marcados.has(chave(t.id, role))}
                      onChange={e => alternar(t.id, role, e.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
