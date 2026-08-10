import React, { useEffect, useState } from 'react';
import { TrendingUp, LayoutGrid, CalendarRange, Target } from 'lucide-react';
import GestorDashboard from './GestorDashboard';
import PainelDoCiclo from './PainelDoCiclo';
import CiclosAdmin from './CiclosAdmin';
import PlanosBoard from './PlanosBoard';

type TabSlug = 'estrategico' | 'painel-ciclo' | 'ciclos' | 'planos';

const TABS: { slug: TabSlug; label: string; icon: React.ComponentType<{ className?: string }>; Comp: React.ComponentType<{ user: any }> }[] = [
  { slug: 'estrategico',  label: 'Estratégico',     icon: TrendingUp,    Comp: GestorDashboard },
  { slug: 'painel-ciclo', label: 'Painel do Ciclo', icon: LayoutGrid,    Comp: PainelDoCiclo },
  { slug: 'ciclos',       label: 'Ciclos',          icon: CalendarRange, Comp: CiclosAdmin },
  { slug: 'planos',       label: 'Plano de Ação',   icon: Target,        Comp: PlanosBoard },
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
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-sm">
        {TABS.map(t => {
          const active = tab === t.slug;
          return (
            <button
              key={t.slug}
              onClick={() => setTab(t.slug)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${
                active ? 'bg-emerald-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          );
        })}
      </div>
      <Comp user={user} />
    </div>
  );
}
