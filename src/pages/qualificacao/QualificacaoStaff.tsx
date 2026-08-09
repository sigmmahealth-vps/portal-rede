import React, { useEffect, useState } from 'react';
import GestorDashboard from './GestorDashboard';
import PainelDoCiclo from './PainelDoCiclo';
import CiclosAdmin from './CiclosAdmin';
import PlanosBoard from './PlanosBoard';

type TabSlug = 'estrategico' | 'painel-ciclo' | 'ciclos' | 'planos';

const TABS: { slug: TabSlug; label: string; Comp: React.ComponentType<{ user: any }> }[] = [
  { slug: 'estrategico',  label: 'Estratégico',     Comp: GestorDashboard },
  { slug: 'painel-ciclo', label: 'Painel do Ciclo', Comp: PainelDoCiclo },
  { slug: 'ciclos',       label: 'Ciclos',          Comp: CiclosAdmin },
  { slug: 'planos',       label: 'Plano de Ação',   Comp: PlanosBoard },
];

function defaultTabFor(role: string): TabSlug {
  return role === 'auditoria' ? 'painel-ciclo' : 'estrategico';
}

function readTabFromUrl(): TabSlug | null {
  const p = new URLSearchParams(window.location.search).get('aba');
  return TABS.some(t => t.slug === p) ? (p as TabSlug) : null;
}

export default function QualificacaoStaff({ user }: { user: any }) {
  const [tab, setTab] = useState<TabSlug>(() => readTabFromUrl() || defaultTabFor(user.role));

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('aba', tab);
    window.history.replaceState({}, '', url.toString());
  }, [tab]);

  const Comp = TABS.find(t => t.slug === tab)!.Comp;

  return (
    <div className="max-w-7xl mx-auto">
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          {TABS.map(t => (
            <button
              key={t.slug}
              onClick={() => setTab(t.slug)}
              className={`px-1 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.slug
                  ? 'border-emerald-600 text-emerald-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      <Comp user={user} />
    </div>
  );
}
