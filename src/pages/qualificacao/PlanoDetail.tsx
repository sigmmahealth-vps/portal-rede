import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { PLAN_STATUS_LABEL, PLAN_COLOR_CLASS, ITEM_STATUS_LABEL } from './planoStatus';
import ItemHistorico from './ItemHistorico';
import { ArrowLeft, Loader2, Plus } from 'lucide-react';

const ORIGIN_LABEL: Record<string, string> = {
  automatica: 'Automática',
  semiautomatica: 'Semiautomática',
  manual: 'Manual/Avulso',
};

const KANBAN_COLUMNS = [
  { key: 'aberto', label: 'Em aberto', statuses: ['nao_iniciada', 'em_andamento', 'aguardando_revisao'] },
  { key: 'solicitada_revisao', label: 'Solicitada Revisão', statuses: ['solicitada_revisao'] },
  { key: 'reprovada', label: 'Reprovado', statuses: ['reprovada'] },
  { key: 'concluida', label: 'Concluído', statuses: ['concluida'] },
];

const FIELD_KEYS = ['what', 'why', 'who_name', 'who_role', 'start_date', 'due_date', 'how', 'how_much'] as const;

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return d; }
}

function emptyForm() {
  return { what: '', why: '', who_name: '', who_role: '', start_date: '', due_date: '', how: '', how_much: '' };
}

function itemToForm(item: any) {
  return {
    what: item.what || '', why: item.why || '',
    who_name: item.who_name || '', who_role: item.who_role || '',
    start_date: (item.start_date || '').slice(0, 10),
    due_date: (item.due_date || '').slice(0, 10),
    how: item.how || '', how_much: item.how_much || '',
  };
}

export default function PlanoDetail({ planId, onClose }: { planId: number; onClose: () => void }) {
  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editItem, setEditItem] = useState<any>(null);
  const [validateItem, setValidateItem] = useState<any>(null);
  const [historyItemId, setHistoryItemId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setPlan(await fetchApi(`/eval/action-plans/${planId}`)); }
    catch (e: any) { alert(e?.message || 'Erro ao carregar plano'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [planId]);

  if (loading || !plan) {
    return (
      <div className="fixed inset-x-0 bottom-0 top-16 z-20 flex items-center justify-center bg-[#f4f4f4] lg:left-20">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const items = plan.items || [];

  return (
    <div className="fixed inset-x-0 bottom-0 top-16 z-20 flex flex-col bg-[#f4f4f4] lg:left-20">
      <header className="shrink-0 border-b border-gray-200 bg-[#f4f4f4]">
        <div className="mx-auto w-full max-w-7xl px-4 pb-4 pt-3 sm:px-6">
          <button
            onClick={onClose}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 transition-colors hover:text-emerald-700"
          >
            <ArrowLeft className="h-4 w-4" /> Voltar aos planos
          </button>

          <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <h1 className="text-pretty text-2xl font-bold text-secondary-900">
                {plan.provider_name}
                {plan.provider_code && <span className="ml-2 text-base font-normal text-gray-400">({plan.provider_code})</span>}
              </h1>
              <p className="mt-1 text-xs text-gray-500">Origem: {ORIGIN_LABEL[plan.origin] || plan.origin}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className={`inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${PLAN_COLOR_CLASS[plan.color] || 'bg-gray-100 text-gray-600'}`}>
                {PLAN_STATUS_LABEL[plan.status] || plan.status}
              </span>
              <button
                onClick={() => setShowAdd(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-600"
              >
                <Plus className="h-4 w-4" /> Adicionar ação
              </button>
            </div>
          </div>

          <WindowsTimeline windows={plan.windows || []} />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {KANBAN_COLUMNS.map(col => {
              const colItems = items.filter((it: any) => col.statuses.includes(it.status));
              return (
                <div key={col.key} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-gray-600">
                    {col.label} <span className="text-gray-400">{colItems.length}</span>
                  </p>
                  <div className="space-y-3">
                    {colItems.length === 0 ? (
                      <p className="py-4 text-center text-xs text-gray-400">Nenhuma ação</p>
                    ) : colItems.map((it: any) => (
                      <ActionCard
                        key={it.id}
                        item={it}
                        showHistory={historyItemId === it.id}
                        onEdit={() => setEditItem(it)}
                        onValidate={() => setValidateItem(it)}
                        onToggleHistory={() => setHistoryItemId(prev => (prev === it.id ? null : it.id))}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {editItem && (
        <EditItemModal item={editItem} onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); load(); }} />
      )}
      {validateItem && (
        <ValidateModal item={validateItem} onClose={() => setValidateItem(null)} onDone={() => { setValidateItem(null); load(); }} />
      )}
      {showAdd && (
        <AddItemModal planId={planId} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load(); }} />
      )}
    </div>
  );
}

// --- Timeline das 3 janelas trimestrais --------------------------------------

function WindowsTimeline({ windows }: { windows: string[] }) {
  if (!windows.length) return null;
  const now = Date.now();
  const firstFutureIdx = windows.findIndex(w => new Date(w).getTime() >= now);
  const ORDINAL = ['1ª', '2ª', '3ª'];

  return (
    <div className="mt-4 flex flex-wrap gap-3">
      {windows.map((w, i) => {
        const ts = new Date(w).getTime();
        const isPast = ts < now;
        const isCurrent = i === firstFutureIdx;
        const days = Math.ceil((ts - now) / 86_400_000);
        const state = isPast
          ? { label: 'Encerrada', cls: 'border-gray-200 bg-gray-100 text-gray-500' }
          : isCurrent
            ? { label: `Em aberto — prazo em ${days} dia${days === 1 ? '' : 's'}`, cls: 'border-emerald-300 bg-emerald-50 text-emerald-800' }
            : { label: 'Aguardando', cls: 'border-gray-200 bg-white text-gray-500' };
        return (
          <div key={i} className={`min-w-[180px] flex-1 rounded-xl border px-3 py-2 ${state.cls}`}>
            <p className="text-xs font-bold uppercase tracking-wide">{ORDINAL[i] || `${i + 1}ª`} janela</p>
            <p className="text-xs">{fmtDate(w)}</p>
            <p className="mt-0.5 text-[11px] font-semibold">{state.label}</p>
          </div>
        );
      })}
    </div>
  );
}

// --- Card de ação -------------------------------------------------------------

function ActionCard({ item, showHistory, onEdit, onValidate, onToggleHistory }: any) {
  const locked = item.status === 'concluida';
  return (
    <div className="space-y-2 rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        {item.question_code && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-gray-700">{item.question_code}</span>
        )}
        {item.dimension && (
          <span className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">{item.dimension}</span>
        )}
        {item.is_mandatory && (
          <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-red-700">Obrigatório</span>
        )}
      </div>

      <p className="text-sm font-medium leading-snug text-secondary-900">{item.what}</p>

      {(item.who_name || item.who_role) && (
        <p className="text-xs text-gray-500">
          {item.who_name}{item.who_name && item.who_role ? ' · ' : ''}{item.who_role}
        </p>
      )}
      <p className="text-xs text-gray-500">Prazo: {fmtDate(item.due_date)}</p>

      <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-600">
        {ITEM_STATUS_LABEL[item.status] || item.status}
      </span>

      <div className="flex flex-wrap gap-3 pt-1">
        <button
          type="button"
          disabled={locked}
          onClick={onEdit}
          className="text-xs font-semibold text-emerald-700 hover:underline disabled:cursor-not-allowed disabled:text-gray-300 disabled:no-underline"
        >
          Editar
        </button>
        {item.status === 'aguardando_revisao' && (
          <button type="button" onClick={onValidate} className="text-xs font-semibold text-blue-700 hover:underline">
            Validar
          </button>
        )}
        <button type="button" onClick={onToggleHistory} className="text-xs font-semibold text-gray-500 hover:underline">
          Histórico
        </button>
      </div>

      {showHistory && <ItemHistorico events={item.events || []} />}
    </div>
  );
}

// --- Formulário 5W2H compartilhado (edição / criação) ------------------------

function FiveW2HFields({ form, setForm }: any) {
  const setField = (k: string, v: string) => setForm((f: any) => {
    const next = { ...f, [k]: v };
    if (k === 'start_date' && v && !f.due_date) {
      const d = new Date(`${v}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 90);
      next.due_date = d.toISOString().slice(0, 10);
    }
    return next;
  });

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-semibold text-secondary-900">O quê? <span className="text-red-600">*</span></label>
        <textarea
          value={form.what} onChange={e => setField('what', e.target.value)} rows={2} required
          className="w-full rounded-lg border border-gray-300 p-2 text-sm text-secondary-900"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-secondary-900">Por quê?</label>
        <textarea
          value={form.why} onChange={e => setField('why', e.target.value)} rows={2}
          className="w-full rounded-lg border border-gray-300 p-2 text-sm text-secondary-900"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-secondary-900">Quem (nome)</label>
          <input
            value={form.who_name} onChange={e => setField('who_name', e.target.value)}
            className="w-full rounded-lg border border-gray-300 p-2 text-sm text-secondary-900"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-secondary-900">Quem (papel)</label>
          <input
            value={form.who_role} onChange={e => setField('who_role', e.target.value)}
            className="w-full rounded-lg border border-gray-300 p-2 text-sm text-secondary-900"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-secondary-900">Início</label>
          <input
            type="date" value={form.start_date} onChange={e => setField('start_date', e.target.value)}
            className="w-full rounded-lg border border-gray-300 p-2 text-sm text-secondary-900"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-secondary-900">Prazo</label>
          <input
            type="date" value={form.due_date} onChange={e => setField('due_date', e.target.value)}
            className="w-full rounded-lg border border-gray-300 p-2 text-sm text-secondary-900"
          />
          <p className="mt-0.5 text-[11px] text-gray-400">Se em branco, sugerido automaticamente para +90 dias do início.</p>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-secondary-900">Como?</label>
        <textarea
          value={form.how} onChange={e => setField('how', e.target.value)} rows={2}
          className="w-full rounded-lg border border-gray-300 p-2 text-sm text-secondary-900"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-semibold text-secondary-900">Quanto custa?</label>
        <input
          value={form.how_much} onChange={e => setField('how_much', e.target.value)}
          className="w-full rounded-lg border border-gray-300 p-2 text-sm text-secondary-900"
        />
      </div>
    </div>
  );
}

function ModalShell({ title, onClose, children }: any) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-bold text-secondary-900">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function EditItemModal({ item, onClose, onSaved }: any) {
  const [form, setForm] = useState(() => itemToForm(item));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.what.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, string> = {};
      for (const k of FIELD_KEYS) body[k] = form[k];
      await fetchApi(`/eval/action-items/${item.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      onSaved();
    } catch (e: any) { alert(e?.message || 'Erro ao salvar ação'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell title="Editar ação" onClose={onClose}>
      <FiveW2HFields form={form} setForm={setForm} />
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
          Cancelar
        </button>
        <button
          onClick={save} disabled={saving || !form.what.trim()}
          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-600 disabled:opacity-40"
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </ModalShell>
  );
}

function AddItemModal({ planId, onClose, onSaved }: any) {
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.what.trim()) return;
    setSaving(true);
    try {
      await fetchApi(`/eval/action-plans/${planId}/items`, { method: 'POST', body: JSON.stringify(form) });
      onSaved();
    } catch (e: any) { alert(e?.message || 'Erro ao adicionar ação'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell title="Adicionar ação" onClose={onClose}>
      <FiveW2HFields form={form} setForm={setForm} />
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
          Cancelar
        </button>
        <button
          onClick={save} disabled={saving || !form.what.trim()}
          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-600 disabled:opacity-40"
        >
          {saving ? 'Adicionando...' : 'Adicionar'}
        </button>
      </div>
    </ModalShell>
  );
}

const DECISOES = [
  { key: 'concluir', label: 'Concluir' },
  { key: 'solicitar_revisao', label: 'Solicitar revisão' },
  { key: 'reprovar', label: 'Reprovar' },
] as const;

function ValidateModal({ item, onClose, onDone }: any) {
  const [decisao, setDecisao] = useState<'concluir' | 'solicitar_revisao' | 'reprovar'>('concluir');
  const [observacao, setObservacao] = useState('');
  const [saving, setSaving] = useState(false);
  const needsObservacao = decisao !== 'concluir';
  const canSubmit = !needsObservacao || observacao.trim().length > 0;

  const submit = async () => {
    setSaving(true);
    try {
      await fetchApi(`/eval/action-items/${item.id}/validar`, {
        method: 'POST',
        body: JSON.stringify({ decisao, observacao: observacao.trim() || undefined }),
      });
      onDone();
    } catch (e: any) { alert(e?.message || 'Erro ao validar ação'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell title="Validar ação" onClose={onClose}>
      <p className="mb-3 text-sm text-secondary-900">{item.what}</p>
      <div className="space-y-2">
        {DECISOES.map(d => (
          <label key={d.key} className="flex items-center gap-2 text-sm text-secondary-900">
            <input type="radio" name="decisao" checked={decisao === d.key} onChange={() => setDecisao(d.key)} />
            {d.label}
          </label>
        ))}
      </div>
      <div className="mt-3">
        <label className="mb-1 block text-xs font-semibold text-secondary-900">
          Observação {needsObservacao && <span className="text-red-600">*</span>}
        </label>
        <textarea
          value={observacao} onChange={e => setObservacao(e.target.value)} rows={3}
          className="w-full rounded-lg border border-gray-300 p-2 text-sm text-secondary-900"
        />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
          Cancelar
        </button>
        <button
          onClick={submit} disabled={!canSubmit || saving}
          className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-600 disabled:opacity-40"
        >
          {saving ? 'Enviando...' : 'Confirmar'}
        </button>
      </div>
    </ModalShell>
  );
}
