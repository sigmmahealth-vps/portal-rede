import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import {
  ArrowLeft, ChevronRight, AlertTriangle, Save, RotateCcw, Loader2, Play,
  Users, ClipboardList, Layers,
} from 'lucide-react';

interface GroupRow {
  provider_group: string;
  script_id: number;
  script_title: string;
  providers: number;
}

export default function AbrirCicloPage({ cycle, onClose, onDone }: { cycle: any; onClose: () => void; onDone: () => void }) {
  const [preview, setPreview] = useState<any>(null);
  const [scripts, setScripts] = useState<any[]>([]);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const loadPreview = async () => {
    setErr(null);
    try {
      const [pv, sc] = await Promise.all([
        fetchApi(`/eval/cycles/${cycle.id}/abertura-preview`),
        fetchApi('/eval/scripts'),
      ]);
      setPreview(pv);
      setScripts(sc);
      setGroups(pv.groups || []);
      setDirty(false);
    } catch (e: any) {
      setErr(e?.message || 'Erro ao carregar preview');
    }
  };

  useEffect(() => { loadPreview(); }, [cycle.id]);

  const setGroupScript = (grp: string, newSid: number) => {
    setGroups(prev => prev.map(g => {
      if (g.provider_group !== grp) return g;
      const s = scripts.find(x => Number(x.id) === newSid);
      return { ...g, script_id: newSid, script_title: s?.title || g.script_title };
    }));
    setDirty(true);
  };

  const removeGroup = (grp: string) => {
    setGroups(prev => prev.filter(g => g.provider_group !== grp));
    setDirty(true);
  };

  const saveGroups = async () => {
    setSaving(true); setErr(null);
    try {
      await fetchApi(`/eval/cycles/${cycle.id}/groups`, {
        method: 'PUT',
        body: JSON.stringify({ groups: groups.map(g => ({ provider_group: g.provider_group, script_id: g.script_id })) }),
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

  const abrir = async () => {
    if (dirty && !confirm('Você tem alterações não salvas. Abrir usará a última versão salva. Continuar?')) return;
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
                <span className="max-w-[18rem] truncate text-emerald-700">Abrir</span>
              </nav>
              <h1 className="mt-1 text-pretty text-2xl font-bold text-secondary-900">
                Abrir {cycle.label}
              </h1>
              <p className="mt-1 text-xs text-gray-500">
                {preview?.source === 'saved'
                  ? 'Mapeamento salvo pelo admin.'
                  : 'Sugestão automática — salve para congelar antes de abrir.'}
              </p>
            </div>
            <button
              onClick={abrir}
              disabled={busy || saving || !preview || groups.length === 0}
              className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Confirmar abertura
            </button>
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

              <section className="rounded-2xl border border-gray-200 bg-white">
                <div className="flex items-center justify-between border-b border-gray-100 p-4">
                  <div>
                    <h2 className="text-base font-bold text-secondary-900">Grupos participantes</h2>
                    <p className="text-xs text-gray-500">Cada grupo recebe um roteiro. Ajuste antes de abrir.</p>
                  </div>
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
                          <td className="p-3 font-medium text-secondary-900">{g.provider_group}</td>
                          <td className="p-3">
                            <select
                              value={g.script_id}
                              onChange={e => setGroupScript(g.provider_group, Number(e.target.value))}
                              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs focus-visible:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                            >
                              {scripts.map(s => (
                                <option key={s.id} value={s.id}>{s.title}</option>
                              ))}
                            </select>
                          </td>
                          <td className="p-3 text-right tabular-nums text-secondary-900">{g.providers}</td>
                          <td className="p-3 text-right">
                            <button
                              type="button"
                              onClick={() => removeGroup(g.provider_group)}
                              title="Remover grupo do ciclo"
                              className="rounded-md p-1 text-red-600 hover:bg-red-50"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
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
