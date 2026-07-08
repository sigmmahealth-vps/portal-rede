import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchApi } from '../../lib/api';
import ProviderContactsPanel from './ProviderContactsPanel';
import ProviderAccessTab from './ProviderAccessTab';
import ProviderAuditTab from './ProviderAuditTab';
import { ArrowLeft, Building2, Users, FileText, ClipboardCheck, KeyRound, History, MapPin, User, Layers, RefreshCw, Phone } from 'lucide-react';

const TABS = [
  { id: 'cadastrais', label: 'Dados Cadastrais', icon: Building2 },
  { id: 'unidades', label: 'Unidades de Atendimento', icon: Building2 },
  { id: 'equipe', label: 'Equipe/Contatos', icon: Users },
  { id: 'documentos', label: 'Documentos e Qualificação', icon: FileText },
  { id: 'acessos', label: 'Gestão de Acessos', icon: KeyRound },
  { id: 'historico', label: 'Histórico e Auditoria', icon: History },
] as const;

type TabId = typeof TABS[number]['id'];

function Field({ label, value, mono, className = '' }: { label: string; value?: ReactNode; mono?: boolean; className?: string }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className={className}>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className={`mt-0.5 text-sm ${empty ? 'text-gray-400' : 'text-gray-800'} ${mono && !empty ? 'font-mono' : ''}`}>
        {empty ? '—' : value}
      </dd>
    </div>
  );
}

function Group({ title, icon: Icon, children }: { title: string; icon: any; children: ReactNode }) {
  return (
    <div className="border-t border-gray-100 pt-6 first:border-t-0 first:pt-0">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-[#00995D]" />
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      </div>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">{children}</dl>
    </div>
  );
}

function pessoaLabel(pt?: string | null): string | null {
  if (pt === 'PJ') return 'Pessoa jurídica (PJ)';
  if (pt === 'PF') return 'Pessoa física (PF)';
  return pt ?? null;
}

function formatDoc(v?: string | null): string {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return v ?? '';
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

  const specialties: string[] = (provider.specialties ?? []).filter(
    (s: string) => s && !['N', '0', 'NAO', 'NÃO'].includes(String(s).toUpperCase()),
  );

  const contactLoc = (provider.locations ?? []).find((l: any) => l.phone || l.email) ?? provider.locations?.[0];
  const rt = provider.responsavel_tecnico;
  const rtLabel = rt ? [rt.name, rt.council_registry].filter(Boolean).join(' — ') : null;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-start gap-4">
        <button onClick={() => navigate('/admin')} className="mt-1 p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-800">{provider.name}</h1>
            <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-medium ${
              String(provider.status).toLowerCase() === 'ativo' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}>
              {provider.status || '-'}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
            {provider.sgu_code && (
              <span>Código SGU: <span className="font-medium text-gray-700">{provider.sgu_code}</span></span>
            )}
            {provider.provider_type && <span>{provider.provider_type}</span>}
            {provider.locations?.[0]?.cidade && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {provider.locations[0].cidade}
                {provider.locations[0].uf ? `/${provider.locations[0].uf}` : ''}
              </span>
            )}
          </div>
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

              <Group title="Identificação" icon={User}>
                <Field label="Nome / razão social" value={provider.name} />
                <Field label="Nome fantasia" value={provider.trade_name} />
                <Field label="Tipo de pessoa" value={pessoaLabel(provider.person_type)} />
                <Field
                  label={provider.person_type === 'PF' ? 'CPF' : 'CNPJ'}
                  value={formatDoc(provider.person_type === 'PF' ? provider.cpf : provider.cnpj)}
                  mono
                />
                <Field label="Registro no conselho" value={provider.council_registry} />
              </Group>

              <Group title="Contato" icon={Phone}>
                <Field label="Telefone" value={contactLoc?.phone} />
                <Field label="E-mail" value={contactLoc?.email} />
                <Field label="Responsável técnico" value={rtLabel} className="sm:col-span-2" />
              </Group>

              <Group title="Classificação na rede" icon={Layers}>
                <Field label="Tipo de prestador (SGU)" value={provider.provider_type} />
                <Field label="Grupo" value={provider.provider_group} />
                <Field label="Área de atuação" value={provider.area_atuacao} />
                <Field
                  label="Nível de qualificação"
                  value={
                    provider.qualification_level ? (
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                        Nível {provider.qualification_level}
                      </span>
                    ) : null
                  }
                />
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium text-gray-500">Especialidades</dt>
                  {specialties.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {specialties.map((s) => (
                        <span key={s} className="rounded-md bg-[#00995D]/10 px-2 py-1 text-xs font-medium text-[#00713f]">
                          {s}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <dd className="mt-0.5 text-sm text-gray-400">—</dd>
                  )}
                </div>
              </Group>

              <Group title="Integração SGU" icon={RefreshCw}>
                <Field label="Código SGU" value={provider.sgu_code} mono />
                <Field
                  label="Última sincronização"
                  value={provider.sgu_synced_at ? new Date(provider.sgu_synced_at).toLocaleString('pt-BR') : null}
                />
              </Group>
            </div>
          )}

          {activeTab === 'unidades' && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-gray-800">Unidades de Atendimento</h2>
              {!provider.locations?.length ? (
                <p className="text-gray-500 text-center py-12">Nenhuma unidade cadastrada.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-100 text-sm text-gray-500">
                        <th className="pb-3 font-medium">Local</th>
                        <th className="pb-3 font-medium">Endereço</th>
                        <th className="pb-3 font-medium">Contato</th>
                        <th className="pb-3 font-medium">Finalidade</th>
                        <th className="pb-3 font-medium">Ativo</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm">
                      {(provider.locations ?? []).map((loc: any) => (
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

          {activeTab === 'equipe' && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-gray-800">Equipe/Contatos</h2>
              <ProviderContactsPanel providerId={provider.id} hideProviderColumn canEdit />
            </div>
          )}

          {activeTab === 'documentos' && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-gray-800">Documentos e Qualificação</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <p className="text-sm text-gray-500 font-medium">Documentos Pendentes</p>
                  <p className="text-2xl font-bold text-gray-800">{provider.summary?.documents_pending ?? 0}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <p className="text-sm text-gray-500 font-medium">Documentos Vencidos</p>
                  <p className="text-2xl font-bold text-gray-800">{provider.summary?.documents_expired ?? 0}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <p className="text-sm text-gray-500 font-medium">Total de Documentos</p>
                  <p className="text-2xl font-bold text-gray-800">{provider.summary?.documents_total ?? 0}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <p className="text-sm text-gray-500 font-medium">Certificações</p>
                  <p className="text-2xl font-bold text-gray-800">{provider.summary?.certifications_total ?? 0}</p>
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <p className="text-sm font-medium text-gray-700 mb-1">Última Submissão de Qualificação</p>
                {provider.summary?.last_qualification_submission ? (
                  <div className="flex items-center gap-2 text-sm text-gray-800">
                    <ClipboardCheck className="w-4 h-4 text-gray-400" />
                    <span>{provider.summary.last_qualification_submission.cycle_title}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                      {provider.summary.last_qualification_submission.status}
                    </span>
                    <span className="text-gray-500">
                      {new Date(provider.summary.last_qualification_submission.created_at).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">Nenhuma submissão de qualificação registrada.</p>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => navigate(`/documentos?provider_id=${provider.id}`)}
                  className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
                >
                  Ver documentos completos
                </button>
                <button
                  onClick={() => navigate(`/auditorias?provider_id=${provider.id}`)}
                  className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
                >
                  Ver qualificação completa
                </button>
              </div>
            </div>
          )}

          {activeTab === 'acessos' && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-gray-800">Gestão de Acessos</h2>
              <ProviderAccessTab providerId={provider.id} />
            </div>
          )}

          {activeTab === 'historico' && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-gray-800">Histórico e Auditoria</h2>
              <ProviderAuditTab providerId={provider.id} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
