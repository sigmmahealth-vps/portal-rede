import React, { useState } from 'react';
import { Check, XCircle, RotateCcw, MessageSquare, ChevronDown, ChevronUp, Clock } from 'lucide-react';

export interface Iteration {
  id: number;
  answer_id: number;
  iteration_number: number;
  actor_id: number | null;
  actor_role: 'prestador' | 'auditor' | string;
  action: 'respondeu' | 'aprovou' | 'reprovou' | 'solicitou_reanalise' | string;
  answer_value: string | null;
  score_obtained: number | null;
  evidence_url: string | null;
  observation: string | null;
  created_at: string;
  actor_name?: string | null;
}

const ACTION_META: Record<string, { label: string; Icon: any; cls: string }> = {
  respondeu:            { label: 'Prestador respondeu',           Icon: MessageSquare, cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  aprovou:              { label: 'Auditor aprovou',               Icon: Check,         cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  reprovou:             { label: 'Auditor reprovou',              Icon: XCircle,       cls: 'bg-red-50 text-red-700 border-red-200' },
  solicitou_reanalise:  { label: 'Auditor solicitou reanálise',   Icon: RotateCcw,     cls: 'bg-amber-50 text-amber-800 border-amber-200' },
};

function fmt(dt: string): string {
  try { return new Date(dt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return dt; }
}

export default function IterationTimeline({ items }: { items: Iteration[] }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100"
      >
        <Clock className="h-3.5 w-3.5" />
        Histórico ({items.length})
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {open && (
        <ol className="mt-2 space-y-2 border-l border-gray-200 pl-4">
          {items.map(it => {
            const meta = ACTION_META[it.action] ?? { label: it.action, Icon: MessageSquare, cls: 'bg-gray-50 text-gray-700 border-gray-200' };
            const Icon = meta.Icon;
            return (
              <li key={it.id} className="relative">
                <span className={`absolute -left-[19px] top-1 grid h-3.5 w-3.5 place-items-center rounded-full border ${meta.cls}`}>
                  <Icon className="h-2 w-2" strokeWidth={3} />
                </span>
                <div className="text-xs">
                  <p className="text-secondary-900">
                    <span className="font-semibold">#{it.iteration_number} · {meta.label}</span>
                    {it.actor_name && <span className="text-gray-500"> · {it.actor_name}</span>}
                    <span className="text-gray-400"> · {fmt(it.created_at)}</span>
                  </p>
                  {it.observation && (
                    <p className="mt-0.5 italic text-gray-700">"{it.observation}"</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
