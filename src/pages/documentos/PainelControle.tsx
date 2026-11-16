import { Fragment, useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { fetchApi } from '../../lib/api';
import { providerAudience } from '../../lib/providerAudience.js';
import Verificar from './Verificar';
import { contarSituacoes, conformidade, conformidadePorTipo, baldesAlvara } from '../../lib/painelMetrics.js';

const ALVARAS = ['Alvará Sanitário', 'Alvará de Localização', 'Alvará do Corpo de Bombeiros'];
type Sub = 'overview' | 'alvaras' | 'verificar' | 'cert' | 'escol';

export default function PainelControle({ audiencia }: { audiencia: 'medicos' | 'rede' }) {
  const [docs, setDocs] = useState<any[]>([]);
  const [erro, setErro] = useState('');
  const [sub, setSub] = useState<Sub>('overview');
  const [carregando, setCarregando] = useState(true);

  useEffect(() => { fetchApi('/documents').then(setDocs).catch(e => setErro(e.message)).finally(() => setCarregando(false)); }, []);

  const hoje = useMemo(() => new Date(), []);
  const base = useMemo(() => docs
    .filter(d => d.type_id != null)
    .filter(d => providerAudience(d.person_type ?? null, d.provider_group ?? null) === audiencia), [docs, audiencia]);

  const c = useMemo(() => contarSituacoes(base, hoje), [base, hoje]);

  return (
    <div className="space-y-4">
      {erro && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}

      {carregando ? <div className="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-400">Carregando…</div> : <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Regulares" valor={c.regular} cor="text-emerald-700" bg="bg-emerald-50" />
        <StatCard label="Irregulares" valor={c.irregular} cor="text-red-700" bg="bg-red-50" />
        <StatCard label="Vencendo" valor={c.vencendo} cor="text-amber-700" bg="bg-amber-50" />
        <StatCard label="Pendentes" valor={c.pendente} cor="text-blue-700" bg="bg-blue-50" />
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {([['overview', 'Overview'], ['alvaras', 'Alvarás de Prestadores'], ['verificar', 'Verificar'], ['cert', 'Certificações e Dados Técnicos'], ['escol', 'Escolaridade']] as [Sub, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setSub(id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${sub === id ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {sub === 'overview' && <Overview base={base} c={c} hoje={hoje} />}
      {sub === 'alvaras' && <Alvaras base={base} hoje={hoje} />}
      {sub === 'verificar' && <Verificar audiencia={audiencia} />}
      {sub === 'cert' && <EmBreve titulo="Certificações e Dados Técnicos" />}
      {sub === 'escol' && <EmBreve titulo="Escolaridade" />}
      </>}
    </div>
  );
}

function Overview({ base, c, hoje }: { base: any[]; c: ReturnType<typeof contarSituacoes>; hoje: Date }) {
  const barData = [
    { nome: 'Regulares', valor: c.regular, fill: '#10b981' },
    { nome: 'Irregulares', valor: c.irregular, fill: '#ef4444' },
  ];
  const pct = conformidade(base, hoje);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card titulo="Documentos Regulares × Irregulares">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={barData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="nome" /><YAxis allowDecimals={false} /><Tooltip />
            <Bar dataKey="valor" radius={[4, 4, 0, 0]}>{barData.map((e, i) => <Cell key={i} fill={e.fill} />)}</Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card titulo="Taxa de Conformidade (documentos legais)">
        <Donut pct={pct} />
      </Card>

      <Card titulo="Conformidade por alvará" className="lg:col-span-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {ALVARAS.map(nome => {
            const t = conformidadePorTipo(base, nome, hoje);
            return (
              <div key={nome} className="rounded-lg border border-gray-100 p-4">
                <p className="text-sm text-gray-600">{nome}</p>
                <p className="mt-1 text-2xl font-bold text-emerald-700">{t.pct}%</p>
                <p className="text-xs text-gray-400">{t.conforme}/{t.total} conformes</p>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function Alvaras({ base, hoje }: { base: any[]; hoje: Date }) {
  const somenteAlvaras = base.filter(d => ALVARAS.includes(d.type));
  const pctGeral = conformidade(somenteAlvaras, hoje);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {ALVARAS.map(nome => {
        const b = baldesAlvara(base, nome, hoje);
        const data = [
          { nome: 'No Prazo', valor: b.noPrazo, fill: '#10b981' },
          { nome: 'A Vencer', valor: b.aVencer, fill: '#f59e0b' },
          { nome: 'Vencido', valor: b.vencido, fill: '#ef4444' },
        ];
        return (
          <Fragment key={nome}><Card titulo={nome}>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart layout="vertical" data={data}>
                <XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="nome" width={80} /><Tooltip />
                <Bar dataKey="valor" radius={[0, 4, 4, 0]}>{data.map((e, i) => <Cell key={i} fill={e.fill} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card></Fragment>
        );
      })}
      <Card titulo="Taxa de Conformidade Geral de Alvarás">
        <Donut pct={pctGeral} />
      </Card>
    </div>
  );
}

export function Donut({ pct }: { pct: number }) {
  const data = [{ name: 'Conforme', value: pct }, { name: 'resto', value: 100 - pct }];
  return (
    <div className="relative" style={{ height: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={70} outerRadius={95} startAngle={90} endAngle={-270} stroke="none">
            <Cell fill="#10b981" /><Cell fill="#e5e7eb" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-gray-900">{pct}%</span>
        <span className="text-xs text-gray-400">Conforme</span>
      </div>
    </div>
  );
}

function StatCard({ label, valor, cor, bg }: { label: string; valor: number; cor: string; bg: string }) {
  return (
    <div className={`rounded-xl border border-gray-100 p-4 ${bg}`}>
      <p className={`text-3xl font-bold ${cor}`}>{valor}</p>
      <p className="text-sm text-gray-600">{label}</p>
    </div>
  );
}

function Card({ titulo, children, className = '' }: { titulo: string; children: any; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-100 bg-white p-4 ${className}`}>
      <h3 className="mb-3 text-sm font-semibold text-gray-700">{titulo}</h3>
      {children}
    </div>
  );
}

function EmBreve({ titulo }: { titulo: string }) {
  return <div className="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-400">{titulo} — em breve</div>;
}
