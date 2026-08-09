import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { PLAN_STATUS_LABEL, PLAN_COLOR_CLASS } from './planoStatus';
import ItemHistorico from './ItemHistorico';
import { Loader2, Paperclip } from 'lucide-react';

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('pt-BR'); } catch { return d; }
}

function fmtDateTime(d?: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch { return d; }
}

function lastEventByAction(events: any[], action: string) {
  const matches = (events || []).filter((e: any) => e.action === action);
  if (!matches.length) return null;
  return matches.reduce((a: any, b: any) => (new Date(b.created_at) > new Date(a.created_at) ? b : a));
}

function Spinner() {
  return (
    <div className="flex justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
    </div>
  );
}

// --- Timeline das 3 janelas trimestrais (copiado de PlanoDetail) ------------

function WindowsTimeline({ windows }: any) {
  if (!windows?.length) return null;
  const now = Date.now();
  const firstFutureIdx = windows.findIndex((w: string) => new Date(w).getTime() >= now);
  const ORDINAL = ['1ª', '2ª', '3ª'];

  return (
    <div className="mt-4 flex flex-wrap gap-3">
      {windows.map((w: string, i: number) => {
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

// --- Cabeçalho comum (badges + O QUÊ) ---------------------------------------

function ItemHeader({ item }: any) {
  return (
    <div className="space-y-1.5">
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
      <p className="text-sm font-bold text-secondary-900">{item.what}</p>
    </div>
  );
}

// --- Card de item, variando por status ---------------------------------------

function ItemCard({ item, locked, showHistory, onToggleHistory, form, setForm, saving, onIniciar, onResponder }: any) {
  const canSendParcial = !locked && !saving && (!!form.file || form.comment.trim().length > 0);

  const cardCls = item.status === 'concluida'
    ? 'border-emerald-200 bg-emerald-50'
    : item.status === 'aguardando_revisao' || item.status === 'nao_iniciada'
      ? 'border-gray-200 bg-gray-50'
      : 'border-gray-200 bg-white';

  return (
    <div className={`space-y-3 rounded-2xl border p-5 shadow-sm ${cardCls}`}>
      <ItemHeader item={item} />

      {item.status === 'solicitada_revisao' && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-xs text-orange-800">
          <p className="font-bold uppercase tracking-wide">Revisão solicitada pelo auditor</p>
          <p className="mt-1">{lastEventByAction(item.events, 'solicitou_revisao')?.comment || 'Sem observação registrada.'}</p>
        </div>
      )}
      {item.status === 'reprovada' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          <p className="font-bold uppercase tracking-wide">Ação reprovada pelo auditor</p>
          <p className="mt-1">{lastEventByAction(item.events, 'reprovou')?.comment || 'Sem observação registrada.'}</p>
        </div>
      )}

      {item.status === 'concluida' ? (
        <>
          {item.why && <p className="text-xs text-gray-600"><span className="font-semibold">POR QUÊ: </span>{item.why}</p>}
          {(item.who_name || item.who_role) && (
            <p className="text-xs text-gray-600">
              <span className="font-semibold">RESPONSÁVEL: </span>{item.who_name}{item.who_name && item.who_role ? ' — ' : ''}{item.who_role}
            </p>
          )}
          <div className="rounded-lg border border-emerald-200 bg-white p-3 text-xs">
            <p className="font-bold uppercase tracking-wide text-emerald-700">Status de entrega</p>
            <p className="mt-1 text-secondary-900">Concluído em {fmtDateTime(item.completed_at)}</p>
            {item.validated_at && <p className="text-secondary-900">Validado em {fmtDateTime(item.validated_at)}</p>}
            {(() => {
              const ev = lastEventByAction(item.events, 'anexou_evidencia');
              return ev?.document_url ? (
                <a href={ev.document_url} target="_blank" rel="noreferrer" className="mt-1 inline-block font-semibold text-emerald-700 hover:underline">
                  Ver evidência enviada
                </a>
              ) : null;
            })()}
          </div>
        </>
      ) : item.status === 'aguardando_revisao' ? (
        <>
          <p className="text-sm italic text-gray-500">Evidências em análise pelo auditor.</p>
          <button type="button" onClick={onToggleHistory} className="text-xs font-semibold text-emerald-700 hover:underline">
            Ver o que foi enviado
          </button>
        </>
      ) : item.status === 'nao_iniciada' ? (
        <>
          <p className="text-xs text-gray-500">Prazo limite: {fmtDate(item.due_date)}</p>
          <button
            type="button" disabled={locked || saving} onClick={onIniciar}
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-600 disabled:opacity-40"
          >
            {saving ? 'Iniciando...' : 'Iniciar ação'}
          </button>
        </>
      ) : (
        <>
          {item.why && <p className="text-xs text-gray-600"><span className="font-semibold">POR QUÊ: </span>{item.why}</p>}
          {item.how && <p className="text-xs text-gray-600"><span className="font-semibold">COMO EVIDENCIAR: </span>{item.how}</p>}
          <p className="text-xs text-gray-600"><span className="font-semibold">PRAZO LIMITE: </span>{fmtDate(item.due_date)}</p>

          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-600">Enviar atualização ou evidência</p>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <Paperclip className="h-3.5 w-3.5" />
                <input
                  type="file" disabled={locked || saving}
                  onChange={e => setForm({ file: e.target.files?.[0] ?? null })}
                  className="text-xs"
                />
              </label>
              <textarea
                value={form.comment} onChange={e => setForm({ comment: e.target.value })}
                disabled={locked || saving} rows={2} placeholder="Comentário (opcional)"
                className="w-full rounded-lg border border-gray-300 p-2 text-xs text-secondary-900"
              />
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button" disabled={!canSendParcial} onClick={() => onResponder(false)}
                  className="rounded-lg border border-emerald-500 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Enviar evidência parcial
                </button>
                <button
                  type="button" disabled={locked || saving} onClick={() => onResponder(true)}
                  className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-emerald-600 disabled:opacity-40"
                >
                  Marcar como concluída
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {item.status !== 'aguardando_revisao' && (
        <button type="button" onClick={onToggleHistory} className="text-xs font-semibold text-gray-500 hover:underline">
          Ver histórico
        </button>
      )}
      {showHistory && <ItemHistorico events={item.events || []} />}
    </div>
  );
}

// --- Componente principal ----------------------------------------------------

export default function MeuPlanoAcao() {
  const [plans, setPlans] = useState<any[]>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [plan, setPlan] = useState<any>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [openHistory, setOpenHistory] = useState<Record<number, boolean>>({});
  const [forms, setForms] = useState<Record<number, { file: File | null; comment: string }>>({});
  const [saving, setSaving] = useState<Record<number, boolean>>({});

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchApi('/me/action-plans');
        setPlans(data || []);
        if (data?.length) setPlanId(data[0].id);
      } catch (e: any) { alert(e?.message || 'Erro ao carregar planos de ação'); }
      finally { setLoadingList(false); }
    })();
  }, []);

  const loadPlan = async (id: number) => {
    setLoadingPlan(true);
    try { setPlan(await fetchApi(`/eval/action-plans/${id}`)); }
    catch (e: any) { alert(e?.message || 'Erro ao carregar plano'); }
    finally { setLoadingPlan(false); }
  };

  useEffect(() => { if (planId != null) loadPlan(planId); }, [planId]);

  const setForm = (itemId: number, patch: any) => {
    setForms(prev => ({ ...prev, [itemId]: { ...(prev[itemId] || { file: null, comment: '' }), ...patch } }));
  };
  const setItemSaving = (itemId: number, v: boolean) => setSaving(prev => ({ ...prev, [itemId]: v }));

  const iniciar = async (itemId: number) => {
    setItemSaving(itemId, true);
    try {
      await fetchApi(`/eval/action-items/${itemId}/iniciar`, { method: 'POST' });
      if (planId != null) await loadPlan(planId);
    } catch (e: any) { alert(e?.message || 'Erro ao iniciar ação'); }
    finally { setItemSaving(itemId, false); }
  };

  const responder = async (itemId: number, conclude: boolean) => {
    if (conclude && !window.confirm('Marcar esta ação como concluída?')) return;
    const f = forms[itemId] || { file: null, comment: '' };
    setItemSaving(itemId, true);
    try {
      const body = new FormData();
      if (f.file) body.append('file', f.file);
      if (f.comment.trim()) body.append('comment', f.comment.trim());
      body.append('conclude', conclude ? 'true' : 'false');
      await fetchApi(`/eval/action-items/${itemId}/responder`, { method: 'POST', body });
      setForm(itemId, { file: null, comment: '' });
      if (planId != null) await loadPlan(planId);
    } catch (e: any) { alert(e?.message || 'Erro ao enviar atualização'); }
    finally { setItemSaving(itemId, false); }
  };

  if (loadingList) return <Spinner />;

  if (!plans.length) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-20 text-center text-sm text-gray-500">
        Nenhum plano de ação para o seu estabelecimento.
      </div>
    );
  }

  const items = plan?.items || [];
  const doneCount = items.filter((it: any) => it.status === 'concluida').length;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-secondary-900">
              Meu Plano de Ação — {plan?.cycle_label || 'Plano avulso'}
            </h2>
            {plan && <p className="mt-1 text-sm font-medium text-gray-500">{doneCount} de {items.length} ações concluídas</p>}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {plans.length > 1 && (
              <select
                value={planId ?? ''} onChange={e => setPlanId(Number(e.target.value))}
                className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-secondary-900"
              >
                {plans.map(p => (
                  <option key={p.id} value={p.id}>{p.cycle_label || `Plano #${p.id}`}</option>
                ))}
              </select>
            )}
            {plan && (
              <span className={`inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${PLAN_COLOR_CLASS[plan.color] || 'bg-gray-100 text-gray-600'}`}>
                {PLAN_STATUS_LABEL[plan.status] || plan.status}
              </span>
            )}
          </div>
        </div>
        {plan && <WindowsTimeline windows={plan.windows || []} />}
      </div>

      {plan?.closed_without_completion && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">
          Encerrado sem conclusão
        </div>
      )}

      {loadingPlan || !plan ? <Spinner /> : (
        <div className="space-y-4">
          {items.map((item: any) => (
            <ItemCard
              key={item.id}
              item={item}
              locked={!!plan.closed_without_completion}
              showHistory={!!openHistory[item.id]}
              onToggleHistory={() => setOpenHistory(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
              form={forms[item.id] || { file: null, comment: '' }}
              setForm={(patch: any) => setForm(item.id, patch)}
              saving={!!saving[item.id]}
              onIniciar={() => iniciar(item.id)}
              onResponder={(conclude: boolean) => responder(item.id, conclude)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
