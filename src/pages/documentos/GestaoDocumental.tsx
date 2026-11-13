import { useState } from 'react';

type Aba = 'lista' | 'bi' | 'matriz';
type Audiencia = 'medicos' | 'rede';

export default function GestaoDocumental() {
  const [aba, setAba] = useState<Aba>('lista');
  const [audiencia, setAudiencia] = useState<Audiencia>('medicos');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Gestão Documental</h1>
        <div className="flex rounded-lg border border-gray-200 bg-white p-1 text-sm">
          {(['medicos', 'rede'] as Audiencia[]).map(a => (
            <button key={a} onClick={() => setAudiencia(a)}
              className={`px-3 py-1 rounded-md ${audiencia === a ? 'bg-emerald-600 text-white' : 'text-gray-600'}`}>
              {a === 'medicos' ? 'Médicos' : 'Rede Prestadora'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {([['lista', 'Investigação & Lista'], ['bi', 'BI Painéis'], ['matriz', 'Matriz Legal']] as [Aba, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setAba(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${aba === id ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {aba === 'lista' && <PlaceholderLista audiencia={audiencia} />}
      {aba === 'bi' && <EmBreve titulo="BI Painéis" />}
      {aba === 'matriz' && <EmBreve titulo="Matriz Legal" />}
    </div>
  );
}

function PlaceholderLista({ audiencia }: { audiencia: Audiencia }) {
  return <div className="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-400">Investigação & Lista ({audiencia}) — em construção</div>;
}
function EmBreve({ titulo }: { titulo: string }) {
  return <div className="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-400">{titulo} — em breve</div>;
}
