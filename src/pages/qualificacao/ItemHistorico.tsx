import React from 'react';

const ACTION_LABEL: Record<string, string> = {
  criou: 'criou a ação',
  editou: 'editou a ação',
  iniciou: 'iniciou a ação',
  comentou: 'comentou',
  anexou_evidencia: 'anexou evidência',
  marcou_concluida: 'marcou como concluída',
  concluiu: 'validou como concluída',
  solicitou_revisao: 'solicitou revisão',
  reprovou: 'reprovou',
};

function fmt(dt: string): string {
  try { return new Date(dt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return dt; }
}

export default function ItemHistorico({ events }: { events: any[] }) {
  if (!events?.length) {
    return <p className="mt-2 text-xs italic text-gray-400">Sem eventos registrados.</p>;
  }

  return (
    <ol className="mt-2 space-y-2 border-l border-gray-200 pl-4">
      {events.map(ev => (
        <li key={ev.id} className="text-xs">
          <p className="text-secondary-900">
            <span className="font-semibold">{ev.actor_name}</span>
            {' — '}{ev.actor_role === 'auditor' ? 'Auditor' : 'Prestador'}
            {' — '}{ACTION_LABEL[ev.action] || ev.action}
            {' em '}{fmt(ev.created_at)}
          </p>
          {ev.comment && <p className="mt-0.5 italic text-gray-700">"{ev.comment}"</p>}
          {ev.document_id && ev.document_url && (
            <a
              href={ev.document_url}
              target="_blank"
              rel="noreferrer"
              className="mt-0.5 inline-block font-semibold text-emerald-700 hover:underline"
            >
              Ver anexo
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}
