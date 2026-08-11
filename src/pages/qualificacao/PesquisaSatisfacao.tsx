import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { Star, Send, Loader2, Smile, CheckCircle } from 'lucide-react';

const Q3_OPTS = [
  { v: 'sim_totalmente', label: 'Sim, totalmente' },
  { v: 'sim_parcialmente', label: 'Sim, parcialmente' },
  { v: 'neutro', label: 'Indiferente — não ajudaram nem atrapalharam' },
  { v: 'nao_precisei_ajuda', label: 'Não, precisei de ajuda' },
  { v: 'nao_insuficientes', label: 'Não, foram insuficientes' },
];

function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n} estrelas`}
          className="transition-transform hover:scale-110">
          <Star className={`h-7 w-7 ${n <= value ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
        </button>
      ))}
    </div>
  );
}

function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso; }
}

export default function PesquisaSatisfacao() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    q1_clareza: 0, q2_portal: 0, q3_documentos: '', q4_dificuldade: null as boolean | null,
    q4_texto: '', q5_geral: 0, q6_nps: null as number | null, comentarios: '',
  });
  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }));

  const load = async () => {
    setLoading(true);
    try { setData(await fetchApi('/me/survey')); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    setSaving(true);
    try {
      await fetchApi('/me/survey', { method: 'POST', body: JSON.stringify(form) });
      await load();
    } catch (e: any) { alert(e?.message || 'Erro ao enviar a pesquisa'); }
    finally { setSaving(false); }
  };

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;
  }

  if (data?.state === 'sem_roteiro') {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white py-20 text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600"><Smile className="h-7 w-7" /></div>
        <h3 className="text-lg font-bold text-secondary-900">Pesquisa de Satisfação</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">A pesquisa fica disponível após você enviar o roteiro de qualificação.</p>
      </div>
    );
  }

  if (data?.state === 'respondida') {
    const r = data.response;
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <CheckCircle className="mx-auto h-12 w-12 text-emerald-500" />
        <h3 className="mt-2 text-lg font-bold text-secondary-900">Pesquisa respondida</h3>
        <p className="mt-1 text-sm text-emerald-700">Enviada em {fmtDate(r.submitted_at)}.</p>
        <p className="mt-1 text-sm font-semibold text-emerald-700">
          {r.bonus_points > 0 ? `+${r.bonus_points} pontos bônus aplicados à sua qualificação.` : 'Enviada após o prazo — sem pontos bônus.'}
        </p>
      </div>
    );
  }

  // state === 'disponivel'
  const expired = !!data?.expired;
  const canSubmit = form.q1_clareza > 0 && form.q2_portal > 0 && form.q3_documentos
    && form.q4_dificuldade !== null && form.q5_geral > 0 && form.q6_nps != null && !saving;

  return (
    <div className="space-y-6">
      <div className={`flex items-start gap-4 rounded-2xl border p-5 ${expired ? 'border-gray-200 bg-gray-50' : 'border-emerald-200 bg-emerald-50'}`}>
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-amber-500"><Star className="h-6 w-6 fill-amber-400 text-amber-400" /></div>
        <div>
          <p className="font-bold text-secondary-900">
            {expired ? 'Prazo encerrado — você ainda pode responder, sem pontos bônus.' : 'Responda a pesquisa e ganhe 10 pontos bônus!'}
          </p>
          <p className="mt-1 text-sm text-emerald-700">Sua opinião é muito importante para melhorarmos o processo de qualificação. Leva menos de 2 minutos.</p>
          {!expired && <p className="mt-1 text-sm font-semibold text-emerald-700">Disponível até {fmtDate(data.deadline)} (7 dias após o envio do roteiro).</p>}
        </div>
      </div>

      <div className="space-y-6 rounded-2xl border border-gray-200 bg-white p-6">
        <div>
          <p className="font-semibold text-secondary-900">1. Como você avalia a clareza das instruções e orientações do roteiro de qualificação?</p>
          <div className="mt-2"><Stars value={form.q1_clareza} onChange={n => set({ q1_clareza: n })} /></div>
          <p className="mt-1 text-xs text-gray-400">1 = Muito ruim | 5 = Excelente</p>
        </div>
        <div>
          <p className="font-semibold text-secondary-900">2. Como você avalia a facilidade de uso do portal para envio das evidências?</p>
          <div className="mt-2"><Stars value={form.q2_portal} onChange={n => set({ q2_portal: n })} /></div>
          <p className="mt-1 text-xs text-gray-400">1 = Muito ruim | 5 = Excelente</p>
        </div>
        <div>
          <p className="font-semibold text-secondary-900">3. As orientações sobre quais documentos enviar foram suficientes e claras?</p>
          <div className="mt-2 space-y-1.5">
            {Q3_OPTS.map(o => (
              <label key={o.v} className="flex items-center gap-2 text-sm text-secondary-900">
                <input type="radio" name="q3" checked={form.q3_documentos === o.v} onChange={() => set({ q3_documentos: o.v })} /> {o.label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <p className="font-semibold text-secondary-900">4. Você encontrou dificuldades técnicas ao usar o portal?</p>
          <div className="mt-2 flex gap-2">
            {[{ v: true, l: 'Sim' }, { v: false, l: 'Não' }].map(o => (
              <button key={o.l} type="button" onClick={() => set({ q4_dificuldade: o.v })}
                className={`rounded-lg border px-4 py-1.5 text-sm font-semibold ${form.q4_dificuldade === o.v ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-300 text-secondary-900 hover:bg-gray-50'}`}>
                {o.l}
              </button>
            ))}
          </div>
          {form.q4_dificuldade === true && (
            <textarea value={form.q4_texto} onChange={e => set({ q4_texto: e.target.value })} rows={2}
              placeholder="Descreva a dificuldade (opcional)"
              className="mt-2 w-full rounded-lg border border-gray-300 p-2 text-sm text-secondary-900" />
          )}
        </div>
        <div>
          <p className="font-semibold text-secondary-900">5. Como você avalia o processo de qualificação da Unimed Criciúma de forma geral?</p>
          <div className="mt-2"><Stars value={form.q5_geral} onChange={n => set({ q5_geral: n })} /></div>
          <p className="mt-1 text-xs text-gray-400">1 = Muito ruim | 5 = Excelente</p>
        </div>
        <div>
          <p className="font-semibold text-secondary-900">6. De 0 a 10, o quanto você recomendaria o Portal da Rede Credenciada da Unimed Criciúma a outro prestador?</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {Array.from({ length: 11 }, (_, n) => (
              <button key={n} type="button" onClick={() => set({ q6_nps: n })}
                className={`h-9 w-9 rounded-lg border text-sm font-bold ${form.q6_nps === n ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300 text-secondary-900 hover:bg-gray-50'}`}>
                {n}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-400">0 = Não recomendaria | 10 = Recomendaria com certeza</p>
        </div>
        <div>
          <p className="font-semibold text-secondary-900">Comentários e sugestões (opcional):</p>
          <textarea value={form.comentarios} onChange={e => set({ comentarios: e.target.value })} rows={3}
            className="mt-2 w-full rounded-lg border border-gray-300 p-2 text-sm text-secondary-900" />
        </div>
      </div>

      <button onClick={submit} disabled={!canSubmit}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-600 disabled:opacity-50">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        {expired ? 'Enviar pesquisa' : 'Enviar pesquisa e receber 10 pontos bônus'}
      </button>
    </div>
  );
}
