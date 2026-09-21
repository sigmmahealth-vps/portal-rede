import React, { useId, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';

interface AlertItem {
  code: string | null;
  text: string;
}
interface Alerts {
  semEvidencia: AlertItem[];
  semPeso: AlertItem[];
  semEliminatorio?: boolean;
}

export default function RoteiroAlerts({ alerts }: { alerts?: Alerts }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const semEvidencia = alerts?.semEvidencia ?? [];
  const semPeso = alerts?.semPeso ?? [];
  const semEliminatorio = !!alerts?.semEliminatorio;
  const total = semEvidencia.length + semPeso.length + (semEliminatorio ? 1 : 0);
  if (total === 0) return null;

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 hover:bg-amber-100 transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <AlertTriangle className="w-3.5 h-3.5" />
        {total} alerta{total > 1 ? 's' : ''}
      </button>

      {open && (
        <div id={panelId} className="mt-2 space-y-3 bg-amber-50/60 border border-amber-100 rounded-lg p-3">
          {semEliminatorio && (
            <p className="text-xs font-semibold text-amber-800">
              Sem critérios eliminatórios — o selo deste roteiro depende só da nota.
            </p>
          )}
          {semEvidencia.length > 0 && (
            <AlertGroup title={`Sem evidência (${semEvidencia.length})`} items={semEvidencia} />
          )}
          {semPeso.length > 0 && (
            <AlertGroup title={`Sem peso (${semPeso.length})`} items={semPeso} />
          )}
        </div>
      )}
    </div>
  );
}

function AlertGroup({ title, items }: { title: string; items: AlertItem[] }) {
  return (
    <div>
      <p className="text-xs font-semibold text-amber-800 mb-1">{title}</p>
      <ul className="space-y-1">
        {/* Lista estática vinda do servidor (não reordenada no cliente); índice no key é seguro. */}
        {items.map((it, i) => (
          <li key={`${it.code ?? '-'}-${i}`} className="text-xs text-gray-700 flex gap-1.5">
            {it.code && <span className="font-mono text-gray-500 flex-shrink-0">{it.code}</span>}
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
