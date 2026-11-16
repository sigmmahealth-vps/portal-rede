import { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { providerAudience } from '../../lib/providerAudience.js';

type Motivo = 'ausente' | 'vencido' | 'reprovado' | 'pendente';
type Faltante = { type_id: number; nome: string; motivo: Motivo };
type Linha = { provider_id: number; name: string; person_type: string | null; provider_group: string | null; role: string; faltantes: Faltante[] };

const ROLE_LABEL: Record<string, string> = {
  cooperado: 'Médico Cooperado', credenciado: 'Médico Credenciado',
  pf_nao_medico: 'PF não médico', prestador: 'Prestador PJ',
};
const MOTIVO: Record<Motivo, { label: string; cls: string }> = {
  ausente: { label: 'não enviado', cls: 'bg-gray-100 text-gray-600' },
  vencido: { label: 'vencido', cls: 'bg-red-50 text-red-700' },
  reprovado: { label: 'reprovado', cls: 'bg-red-50 text-red-700' },
  pendente: { label: 'pendente', cls: 'bg-blue-50 text-blue-700' },
};

export default function Verificar({ audiencia }: { audiencia: 'medicos' | 'rede' }) {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    fetchApi('/admin/document-verificar')
      .then(setLinhas).catch(e => setErro(e.message)).finally(() => setCarregando(false));
  }, []);

  const vis = linhas.filter(l => providerAudience(l.person_type, l.provider_group) === audiencia);

  if (carregando) return <div className="p-8 text-center text-gray-400">Carregando…</div>;
  if (erro && !linhas.length)
    return <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>;
  if (!vis.length)
    return <div className="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-400">Nenhuma pendência.</div>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">{vis.length} prestador(es) com documentos obrigatórios pendentes.</p>
      {erro && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}
      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="px-4 py-3 font-medium">Prestador</th>
              <th className="px-4 py-3 font-medium">Função</th>
              <th className="px-4 py-3 font-medium">Documentos faltantes</th>
            </tr>
          </thead>
          <tbody>
            {vis.map(l => (
              <tr key={l.provider_id} className="border-b border-gray-50 align-top last:border-0">
                <td className="px-4 py-3 text-gray-900">{l.name}</td>
                <td className="px-4 py-3 text-gray-600">{ROLE_LABEL[l.role] ?? l.role}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {l.faltantes.map(f => (
                      <span key={f.type_id} className={`rounded-full px-2 py-0.5 text-xs ${MOTIVO[f.motivo]?.cls ?? 'bg-gray-100 text-gray-600'}`}>
                        {f.nome} · {MOTIVO[f.motivo]?.label ?? f.motivo}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
