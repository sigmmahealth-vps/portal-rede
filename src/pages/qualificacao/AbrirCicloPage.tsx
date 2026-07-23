import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import {
  ArrowLeft, ChevronRight, AlertTriangle, Save, RotateCcw, Loader2, Play,
  Users, ClipboardList, Layers,
} from 'lucide-react';

interface GroupRow {
  provider_group: string;
  script_id: number | null;
  script_title: string | null;
  providers: number;
  ambiguous?: boolean;
}

interface InstanceRow {
  provider_id: number;
  provider_name: string;
  provider_code: string | null;
  provider_group: string;
  location_id: number;
  location_label: string | null;
  city: string | null;
  default_script_id: number | null;
  default_script_title: string | null;
  override_script_id: number | null;
  override_script_title: string | null;
}

export default function AbrirCicloPage({ cycle, onClose, onDone }: { cycle: any; onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<any>(null);
  const [scripts, setScripts] = useState<any[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [instances, setInstances] = useState<InstanceRow[]>([]);
  const [groupFilter, setGroupFilter] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [overridesDirty, setOverridesDirty] = useState(false);

  const loadPreview = async () => {
    setErr(null);
    try {
      const [pv, sc, inst] = await Promise.all([
        fetchApi(`/eval/cycles/${cycle.id}/abertura-preview`),
        fetchApi('/eval/scripts'),
        fetchApi(`/eval/cycles/${cycle.id}/instances-preview`),
      ]);
      setPreview(pv);
      setScripts(sc);
      setGroups(pv.groups || []);
      setInstances(inst.rows || []);
      setDirty(false);
      setOverridesDirty(false);
    } catch (e: any) {
      setErr(e?.message || 'Erro ao carregar preview');
    }
  };

  useEffect(() => { loadPreview(); }, [cycle.id]);

  const setGroupScript = (grp: string, newSid: number) => {
    setGroups(prev => prev.map(g => {
      if (g.provider_group !== grp) return g;
      if (!newSid) return { ...g, script_id: null, script_title: null };
      const s = scripts.find(x => Number(x.id) === newSid);
      return { ...g, script_id: newSid, script_title: s?.title || g.script_title };
    }));
    setDirty(true);
  };

  const removeGroup = (grp: string) => {
    const row = groups.find(g => g.provider_group === grp);
    const count = row?.providers ?? 0;
    if (!confirm(`Excluir o grupo "${grp}" do ciclo?\n\n${count} prestador(es) desse grupo ficariam de fora — a menos que sejam vinculados individualmente na tabela de prestadores.`)) return;
    setGroups(prev => prev.filter(g => g.provider_group !== grp));
    setDirty(true);
  };

  const setInstanceScript = (providerId: number, locationId: number, newSid: number) => {
    setInstances(prev => prev.map(r => {
      if (r.provider_id !== providerId || r.location_id !== locationId) return r;
      const isDefault = newSid === r.default_script_id;
      const s = scripts.find(x => Number(x.id) === newSid);
      return {
        ...r,
        override_script_id: isDefault ? null : newSid,
        override_script_title: isDefault ? null : (s?.title || r.override_script_title),
      };
    }));
    setOverridesDirty(true);
  };

  const saveOverrides = async () => {
    setSaving(true); setErr(null);
    try {
      const payload = instances
        .filter(r => r.override_script_id != null)
        .map(r => ({ provider_id: r.provider_id, location_id: r.location_id, script_id: r.override_script_id }));
      await fetchApi(`/eval/cycles/${cycle.id}/overrides`, {
        method: 'PUT',
        body: JSON.stringify({ overrides: payload }),
      });
      await loadPreview();
    } catch (e: any) {
      setErr(e?.message || 'Erro ao salvar overrides');
    } finally {
      setSaving(false);
    }
  };

  const saveGroups = async () => {
    setSaving(true); setErr(null);
    try {
      await fetchApi(`/eval/cycles/${cycle.id}/groups`, {
        method: 'PUT',
        body: JSON.stringify({
          groups: groups
            .filter(g => g.script_id != null)
            .map(g => ({ provider_group: g.provider_group, script_id: g.script_id })),
        }),
      });
      await loadPreview();
    } catch (e: any) {
      setErr(e?.message || 'Erro ao salvar grupos');
    } finally {
      setSaving(false);
    }
  };

  const resetToAuto = async () => {
    if (!confirm('Descartar mapeamento salvo e voltar à sugestão automática?')) return;
    setSaving(true); setErr(null);
    try {
      await fetchApi(`/eval/cycles/${cycle.id}/groups`, {
        method: 'PUT',
        body: JSON.stringify({ groups: [] }),
      });
      await loadPreview();
    } catch (e: any) {
      setErr(e?.message || 'Erro ao restaurar');
    } finally {
      setSaving(false);
    }
  };

  const toggleAuto = async (field: 'auto_open' | 'auto_close', value: boolean) => {
    setSaving(true); setErr(null);
    try {
      await fetchApi(`/eval/cycles/${cycle.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: value }),
      });
      await loadPreview();
    } catch (e: any) {
      setErr(e?.message || `Erro ao atualizar ${field}`);
    } finally {
      setSaving(false);
    }
  };

  const abrir = async () => {
    if ((dirty || overridesDirty) && !confirm('Você tem alterações não salvas. Abrir usará a última versão salva. Continuar?')) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetchApi(`/eval/cycles/${cycle.id}/abrir`, { method: 'POST' });
      alert(`Ciclo aberto: ${res.created.instances} instâncias, ${res.created.dl_bypass} DL bypass.`);
      onDone(); onClose();
    } catch (e: any) {
      setErr(e?.message || 'Erro ao abrir');
    } finally {
      setBusy(false);
    }
  };

  const totalProviders = groups.reduce((n, g) => n + g.providers, 0);
  const readOnly = !!preview?.already_opened;

  return (
    <div className="fixed inset-x-0 bottom-0 top-16 z-20 flex flex-col bg-[#f4f4f4] lg:left-20">
      <header className="shrink-0 border-b border-gray-200 bg-[#f4f4f4]">
        <div className="mx-auto w-full max-w-7xl px-4 pb-4 pt-3 sm:px-6">
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-emerald-700"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar aos ciclos
          </button>

          <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <nav className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                <span>Qualificação</span>
                <ChevronRight className="h-3 w-3" />
                <span>Ciclos</span>
                <ChevronRight className="h-3 w-3" />
                <span className="max-w-[18rem] truncate text-emerald-700">{readOnly ? 'Grupos' : 'Abrir'}</span>
              </nav>
              <h1 className="mt-1 text-pretty text-2xl font-bold text-secondary-900">
                {readOnly ? `Grupos do ${cycle.label}` : `Abrir ${cycle.label}`}
              </h1>
              <p className="mt-1 text-xs text-gray-500">
                {readOnly
                  ? 'Ciclo já aberto — mapeamento imutável (existem instâncias vinculadas).'
                  : preview?.source === 'saved'
                    ? 'Mapeamento salvo pelo admin.'
                    : 'Sugestão automática — salve para congelar antes de abrir.'}
              </p>
            </div>
            {!readOnly && (
              <button
                onClick={abrir}
                disabled={busy || saving || !preview || groups.length === 0}
                className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Confirmar abertura
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 space-y-6">
          {err && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}
          {!preview && !err && (
            <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-gray-500">
              Carregando preview...
            </div>
          )}
          {preview && (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <KpiCard icon={<Layers className="h-5 w-5" />} tone="emerald" label="Grupos" value={preview.would_create.groups} />
                <KpiCard icon={<Users className="h-5 w-5" />} tone="sky" label="Instâncias" value={preview.would_create.instances} sub={`${totalProviders} prestadores`} />
                <KpiCard icon={<ClipboardList className="h-5 w-5" />} tone="amber" label="DL bypass" value={preview.would_create.dl_bypass} sub="via cadastro" />
              </div>

              <section className="rounded-2xl border border-gray-200 bg-white p-4">
                <h2 className="mb-3 text-base font-bold text-secondary-900">Automação por data</h2>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className={`flex items-start gap-3 rounded-lg border p-3 ${preview.cycle.auto_open ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-gray-50'}`}>
                    <input
                      type="checkbox"
                      checked={!!preview.cycle.auto_open}
                      disabled={readOnly || saving}
                      onChange={e => toggleAuto('auto_open', e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-emerald-600"
                    />
                    <div>
                      <p className="text-sm font-semibold text-secondary-900">Iniciar automaticamente</p>
                      <p className="text-xs text-secondary-700">Abre o ciclo em <strong>{preview.cycle.start_date}</strong> (respeita grupos já configurados).</p>
                    </div>
                  </label>
                  <label className={`flex items-start gap-3 rounded-lg border p-3 ${preview.cycle.auto_close ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-gray-50'}`}>
                    <input
                      type="checkbox"
                      checked={!!preview.cycle.auto_close}
                      disabled={saving}
                      onChange={e => toggleAuto('auto_close', e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-emerald-600"
                    />
                    <div>
                      <p className="text-sm font-semibold text-secondary-900">Encerrar automaticamente</p>
                      <p className="text-xs text-gray-600">Encerra em <strong>{preview.cycle.end_date}</strong> (instâncias inconclusivas ficam registradas).</p>
                    </div>
                  </label>
                </div>
              </section>

              <section className="rounded-2xl border border-gray-200 bg-white">
                <div className="flex items-center justify-between border-b border-gray-100 p-4">
                  <div>
                    <h2 className="text-base font-bold text-secondary-900">Grupos participantes</h2>
                    <p className="text-xs text-gray-500">
                      {readOnly ? 'Roteiro associado a cada grupo (imutável após abertura).' : 'Cada grupo recebe um roteiro. Ajuste antes de abrir.'}
                    </p>
                  </div>
                  {!readOnly && (
                    <div className="flex gap-2">
                      {preview.source === 'saved' && (
                        <button
                          type="button"
                          onClick={resetToAuto}
                          disabled={saving}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                        >
                          <RotateCcw className="h-3 w-3" /> Restaurar sugestão
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={saveGroups}
                        disabled={!dirty || saving}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-600 disabled:opacity-40"
                      >
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Salvar
                      </button>
                    </div>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                      <tr>
                        <th className="p-3 font-semibold">Grupo</th>
                        <th className="p-3 font-semibold">Roteiro</th>
                        <th className="p-3 font-semibold text-right">Prestadores</th>
                        <th className="p-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {groups.length === 0 ? (
                        <tr><td colSpan={4} className="p-8 text-center text-gray-500">Nenhum grupo mapeado.</td></tr>
                      ) : groups.map(g => (
                        <tr key={g.provider_group} className="border-t border-gray-100">
                          <td className="p-3 font-medium text-secondary-900">
                            <div className="flex items-center gap-2">
                              <span>{g.provider_group}</span>
                              {g.ambiguous && (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800" title="Prestadores desse grupo apontam roteiros distintos — vincule por prestador/local abaixo, ou escolha um roteiro pra todo o grupo aqui.">
                                  Ambíguo
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="p-3">
                            {readOnly ? (
                              <span className="text-xs text-secondary-900">{g.script_title || '—'}</span>
                            ) : (() => {
                              const options = scripts.filter((s: any) =>
                                s.is_current || Number(s.id) === g.script_id
                              );
                              const unbound = g.script_id == null;
                              return (
                                <select
                                  value={g.script_id ?? 0}
                                  onChange={e => setGroupScript(g.provider_group, Number(e.target.value))}
                                  className={`w-full rounded-lg border px-3 py-1.5 text-xs focus-visible:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 ${
                                    unbound ? 'border-dashed border-gray-400 bg-gray-50 text-gray-700' : 'border-gray-300 bg-white'
                                  }`}
                                >
                                  <option value={0}>— Não vinculado —</option>
                                  {options.map((s: any) => (
                                    <option key={s.id} value={s.id}>{s.title}</option>
                                  ))}
                                </select>
                              );
                            })()}
                          </td>
                          <td className="p-3 text-right tabular-nums text-secondary-900">{g.providers}</td>
                          <td className="p-3 text-right">
                            {!readOnly && (
                              <button
                                type="button"
                                onClick={() => removeGroup(g.provider_group)}
                                title="Remover grupo do ciclo"
                                className="rounded-md p-1 text-red-600 hover:bg-red-50"
                              >
                                ×
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-2xl border border-gray-200 bg-white">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 p-4">
                  <div>
                    <h2 className="text-base font-bold text-secondary-900">Prestadores × local</h2>
                    <p className="text-xs text-gray-500">
                      {readOnly
                        ? 'Cada local que virou uma instância. Roteiro imutável após abertura.'
                        : 'Troque o roteiro por prestador/local quando o do grupo não se aplicar.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs font-semibold text-gray-600">Filtrar grupo:</label>
                    <select
                      value={groupFilter}
                      onChange={e => setGroupFilter(e.target.value)}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs focus-visible:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                    >
                      <option value="">Todos ({instances.length})</option>
                      {Array.from(new Set(instances.map(i => i.provider_group))).sort().map(g => (
                        <option key={g} value={g}>{g} ({instances.filter(i => i.provider_group === g).length})</option>
                      ))}
                    </select>
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={saveOverrides}
                        disabled={!overridesDirty || saving}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-600 disabled:opacity-40"
                      >
                        {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Salvar roteiros
                      </button>
                    )}
                  </div>
                </div>
                <div className="max-h-[540px] overflow-y-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-gray-50 text-xs uppercase text-gray-600">
                      <tr>
                        <th className="p-3 font-semibold">Prestador</th>
                        <th className="p-3 font-semibold">Grupo</th>
                        <th className="p-3 font-semibold">Local</th>
                        <th className="p-3 font-semibold">Roteiro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const filtered = groupFilter ? instances.filter(i => i.provider_group === groupFilter) : instances;
                        if (filtered.length === 0) {
                          return <tr><td colSpan={4} className="p-8 text-center text-gray-500">Nenhum prestador nesse filtro.</td></tr>;
                        }
                        return filtered.map(r => {
                          const effectiveSid = r.override_script_id ?? r.default_script_id ?? 0;
                          const isOverridden = r.override_script_id != null && r.override_script_id !== r.default_script_id;
                          return (
                            <tr key={`${r.provider_id}-${r.location_id}`} className="border-t border-gray-100">
                              <td className="p-3">
                                <p className="font-medium text-secondary-900">{r.provider_name}</p>
                                {r.provider_code && <p className="text-[11px] text-gray-500">{r.provider_code}</p>}
                              </td>
                              <td className="p-3 text-xs text-gray-600">{r.provider_group}</td>
                              <td className="p-3">
                                <p className="text-secondary-900">{r.location_label || '—'}</p>
                                {r.city && <p className="text-[11px] text-gray-500">{r.city}</p>}
                              </td>
                              <td className="p-3">
                                {readOnly ? (
                                  <span className="text-xs text-secondary-900">{r.override_script_title || r.default_script_title || '—'}</span>
                                ) : (() => {
                                  const hasDefault = r.default_script_id != null;
                                  // Só vigentes, mais o default/override atual mesmo se vieram de versão antiga.
                                  const options = scripts.filter((s: any) =>
                                    s.is_current || Number(s.id) === r.default_script_id || Number(s.id) === r.override_script_id
                                  );
                                  const unbound = !hasDefault && !r.override_script_id;
                                  return (
                                    <select
                                      value={effectiveSid}
                                      onChange={e => setInstanceScript(r.provider_id, r.location_id, Number(e.target.value))}
                                      className={`w-full rounded-lg border px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 ${
                                        isOverridden ? 'border-amber-400 bg-amber-50' : unbound ? 'border-dashed border-gray-400 bg-gray-50 text-gray-700' : 'border-gray-300 bg-white'
                                      }`}
                                      title={isOverridden ? `Override (padrão: ${r.default_script_title || '—'})` : undefined}
                                    >
                                      {!hasDefault && <option value={0}>— Não vinculado —</option>}
                                      {options.map((s: any) => (
                                        <option key={s.id} value={s.id}>{s.title}</option>
                                      ))}
                                    </select>
                                  );
                                })()}
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </section>

              {preview.excluded.providers_without_group.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-secondary-900">
                  <strong>{preview.excluded.providers_without_group.length}</strong> prestador(es) sem grupo — ficam de fora deste ciclo.
                </div>
              )}
              {preview.excluded.groups_without_script_mapping.length > 0 && (
                <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <strong>Grupos ambíguos</strong> — prestadores desse grupo apontam para roteiros distintos. Não entram na sugestão automática. Você pode incluí-los manualmente depois de salvar:
                    <ul className="mt-1 list-disc list-inside text-xs">
                      {preview.excluded.groups_without_script_mapping.map((g: string) => <li key={g}>{g}</li>)}
                    </ul>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; tone: 'emerald'|'sky'|'amber' }) {
  const bg = { emerald: 'bg-emerald-50 text-emerald-700', sky: 'bg-sky-50 text-sky-700', amber: 'bg-amber-50 text-amber-800' }[tone];
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <div className={`grid h-10 w-10 place-items-center rounded-full ${bg}`}>{icon}</div>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-bold text-secondary-900 tabular-nums">{value}</p>
          {sub && <p className="text-[11px] text-gray-500">{sub}</p>}
        </div>
      </div>
    </div>
  );
}
