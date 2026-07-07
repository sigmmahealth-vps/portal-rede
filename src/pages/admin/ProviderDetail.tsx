import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchApi } from '../../lib/api';
import { ArrowLeft, Building2, Users, FileText, ClipboardCheck } from 'lucide-react';

const TABS = [
  { id: 'cadastrais', label: 'Dados Cadastrais', icon: Building2 },
  { id: 'unidades', label: 'Unidades de Atendimento', icon: Building2 },
  { id: 'equipe', label: 'Equipe/Contatos', icon: Users },
  { id: 'documentos', label: 'Documentos e Qualificação', icon: FileText },
] as const;

type TabId = typeof TABS[number]['id'];

function fieldGrid(pairs: Array<[string, string | null | undefined]>) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
      {pairs.map(([label, value]) => (
        <div key={label}>
          <p className="text-xs font-medium text-gray-500 uppercase">{label}</p>
          <p className="text-sm text-gray-800 mt-0.5">{value || '-'}</p>
        </div>
      ))}
    </div>
  );
}

export default function ProviderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('cadastrais');
  const [provider, setProvider] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchApi(`/providers/${id}`)
      .then(setProvider)
      .catch((err) => setError(err.message || 'Erro ao carregar prestador'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto flex justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00995D]"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto text-center py-24 space-y-4">
        <p className="text-gray-700">{error}</p>
        {error === 'Prestador não encontrado' ? (
          <button onClick={() => navigate('/admin')} className="text-[#00995D] hover:underline">
            Voltar para a listagem
          </button>
        ) : (
          <button
            onClick={load}
            className="px-4 py-2 bg-[#00995D] text-white rounded-lg hover:bg-[#007A4A] transition-colors"
          >
            Tentar novamente
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/admin')} className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{provider.name}</h1>
          <span className={`inline-block mt-1 px-2.5 py-1 rounded-full text-xs font-medium ${
            String(provider.status).toLowerCase() === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {provider.status || '-'}
          </span>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <aside className="md:w-64 shrink-0">
          <nav className="bg-white rounded-xl shadow-sm border border-gray-100 p-2 flex md:flex-col gap-1 overflow-x-auto">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left whitespace-nowrap transition-colors ${
                    active ? 'bg-[#00995D] text-white' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          {activeTab === 'cadastrais' && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-gray-800">Dados Cadastrais</h2>
              {fieldGrid([
                ['Nome / Razão Social', provider.name],
                ['Nome Fantasia', provider.trade_name],
                ['Tipo de Pessoa', provider.person_type],
                [provider.person_type === 'PF' ? 'CPF' : 'CNPJ', provider.person_type === 'PF' ? provider.cpf : provider.cnpj],
                ['Registro no Conselho', provider.council_registry],
                ['Tipo de Prestador (SGU)', provider.provider_type],
                ['Área de Atuação', provider.area_atuacao],
                ['Grupo', provider.provider_group],
                ['Nível de Qualificação', provider.qualification_level],
                ['Código SGU', provider.sgu_code],
                ['Última Sincronização SGU', provider.sgu_synced_at ? new Date(provider.sgu_synced_at).toLocaleString('pt-BR') : null],
                ['Especialidades', Array.isArray(provider.specialties) && provider.specialties.length > 0 ? provider.specialties.join(', ') : null],
              ])}
            </div>
          )}

          {activeTab === 'unidades' && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-gray-800">Unidades de Atendimento</h2>
              {provider.locations.length === 0 ? (
                <p className="text-gray-500 text-center py-12">Nenhuma unidade cadastrada.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-100 text-sm text-gray-500">
                        <th className="pb-3 font-medium">Local</th>
                        <th className="pb-3 font-medium">Endereço</th>
                        <th className="pb-3 font-medium">Contato</th>
                        <th className="pb-3 font-medium">Selos</th>
                        <th className="pb-3 font-medium">Ativo</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm">
                      {provider.locations.map((loc: any) => (
                        <tr key={loc.id} className="border-b border-gray-50">
                          <td className="py-3 font-medium text-gray-800">{loc.label || '-'}</td>
                          <td className="py-3 text-gray-600">
                            {[loc.logradouro, loc.numero, loc.complemento, loc.bairro, loc.cidade, loc.uf].filter(Boolean).join(', ') || '-'}
                          </td>
                          <td className="py-3 text-gray-600">
                            <div className="flex flex-col gap-0.5">
                              {loc.phone && <span>{loc.phone}</span>}
                              {loc.email && <span>{loc.email}</span>}
                              {!loc.phone && !loc.email && '-'}
                            </div>
                          </td>
                          <td className="py-3">
                            <div className="flex flex-wrap gap-1">
                              {loc.is_primary && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Principal</span>}
                              {loc.in_medical_guide && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">Guia Médico</span>}
                            </div>
                          </td>
                          <td className="py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${loc.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                              {loc.active ? 'Ativo' : 'Inativo'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
