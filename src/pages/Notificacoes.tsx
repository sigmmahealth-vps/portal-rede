import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, ChevronLeft, Search, CheckCircle2, FileText, CalendarDays } from 'lucide-react';
import { fetchApi } from '../lib/api';
import { notificationBlocks } from '../lib/notifyEmail';
import { NOTIFY_TYPES, type NotifyType } from '../lib/notifyCatalog';

// Caixa de entrada de notificações: lista à esquerda, leitura à direita.
// O painel de leitura renderiza os mesmos blocos do e-mail (destaque, próximos
// passos, ação) a partir do ctx gravado na notificação; sem ctx cai no simples.

interface Notif {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  ctx: Record<string, any> | null;
  read_at: string | null;
  created_at: string;
}

const TYPE_LABELS: Record<string, string> = {
  ciclo_aberto: 'Ciclo aberto',
  roteiro_enviado: 'Roteiro enviado',
  reanalise_solicitada: 'Reanálise',
  parecer_aprovado: 'Avaliação aprovada',
  parecer_reprovado: 'Avaliação concluída',
  certificado_emitido: 'Certificado emitido',
  plano_gerado: 'Plano de ação',
  acao_aguardando_validacao: 'Ação p/ validação',
  acao_vencendo: 'Prazo de ação',
  acao_atrasada: 'Ação em atraso',
  roteiro_pendente: 'Roteiro pendente',
  certificado_vencendo: 'Certificado a vencer',
};

const KNOWN_TYPES = new Set<string>(NOTIFY_TYPES);

function TypeIcon({ n }: { n: Notif }) {
  const img = (src: string) => <img src={src} alt="" className="h-8 w-8 shrink-0 object-contain" />;
  switch (n.type) {
    case 'parecer_aprovado': {
      const s = String(n.ctx?.seal ?? '').toLowerCase();
      if (s.includes('ouro')) return img('/selos/ouro.png');
      if (s.includes('prata')) return img('/selos/prata.png');
      if (s.includes('bronze')) return img('/selos/bronze.png');
      return <span className="text-2xl leading-8">🏅</span>;
    }
    case 'certificado_emitido':
    case 'certificado_vencendo':
    case 'acao_vencendo':
    case 'acao_atrasada':
    case 'roteiro_pendente':
      return img('/calendario.png');
    case 'plano_gerado': return <span className="text-2xl leading-8">📋</span>;
    case 'reanalise_solicitada': return <span className="text-2xl leading-8">🔄</span>;
    case 'roteiro_enviado': return <span className="text-2xl leading-8">📨</span>;
    case 'acao_aguardando_validacao': return <span className="text-2xl leading-8">✅</span>;
    default: return <span className="text-2xl leading-8">🔔</span>;
  }
}

// "há 5min", "há 3h", "há 2d"; acima de 7 dias vira data.
function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d <= 7) return `há ${d}d`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

// Converte a marcação **negrito** dos blocos em <strong> (sem HTML cru).
function Rich({ text }: { text: string }) {
  const parts = text.split('**');
  return <>{parts.map((p, i) => (i % 2 ? <strong key={i}>{p}</strong> : <span key={i}>{p}</span>))}</>;
}

export default function Notificacoes() {
  const [items, setItems] = useState<Notif[]>([]);
  const [page, setPage] = useState(1);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [q, setQ] = useState('');
  const [qInput, setQInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Notif | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (onlyUnread) params.set('unread', '1');
    if (typeFilter) params.set('type', typeFilter);
    if (q) params.set('q', q);
    fetchApi(`/notifications?${params}`)
      .then((d) => { setItems(d.items); setSelected((cur) => cur && d.items.some((i: Notif) => i.id === cur.id) ? cur : null); })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, [page, onlyUnread, typeFilter, q]);

  const onSearch = (v: string) => {
    setQInput(v);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { setPage(1); setQ(v); }, 400);
  };

  // Avisa o sininho para atualizar o badge na hora.
  const pingBell = () => window.dispatchEvent(new Event('notifications:changed'));

  const open = (n: Notif) => {
    setSelected(n);
    if (!n.read_at) {
      fetchApi(`/notifications/${n.id}/read`, { method: 'POST' }).then(pingBell).catch(() => {});
      const now = new Date().toISOString();
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read_at: now } : i)));
      setSelected({ ...n, read_at: now });
    }
  };

  const markAll = async () => {
    await fetchApi('/notifications/read-all', { method: 'POST' }).then(pingBell).catch(() => {});
    load();
  };

  const blocks = selected && selected.ctx && KNOWN_TYPES.has(selected.type)
    ? notificationBlocks(selected.type as NotifyType, selected.ctx, '')
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-800">
          <Bell className="h-6 w-6 text-[#00995D]" /> Notificações
        </h1>
        <button onClick={markAll}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
          <CheckCheck className="h-4 w-4" /> Marcar todas como lidas
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={qInput} onChange={(e) => onSearch(e.target.value)} placeholder="Buscar..."
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-[#00995D] focus:outline-none focus:ring-2 focus:ring-[#00995D]/20" />
        </div>
        <select value={onlyUnread ? '1' : ''} onChange={(e) => { setPage(1); setOnlyUnread(e.target.value === '1'); }}
          className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-gray-700">
          <option value="">Todas</option>
          <option value="1">Só não lidas</option>
        </select>
        <select value={typeFilter} onChange={(e) => { setPage(1); setTypeFilter(e.target.value); }}
          className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-gray-700">
          <option value="">Todos os tipos</option>
          {NOTIFY_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t] ?? t}</option>)}
        </select>
      </div>

      <div className="grid overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm md:grid-cols-[minmax(300px,380px)_1fr]">
        {/* Lista */}
        <div className={`${selected ? 'hidden md:flex' : 'flex'} max-h-[70vh] min-h-[420px] flex-col border-gray-100 md:border-r`}>
          <div className="flex-1 divide-y divide-gray-50 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-16">
                <div className="h-7 w-7 animate-spin rounded-full border-b-2 border-[#00995D]" />
              </div>
            ) : items.length === 0 ? (
              <p className="py-16 text-center text-sm text-gray-400">Nenhuma notificação encontrada.</p>
            ) : items.map((n) => (
              <button key={n.id} onClick={() => open(n)}
                className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${selected?.id === n.id ? 'bg-[#00995D]/5' : ''}`}>
                <TypeIcon n={n} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-sm ${n.read_at ? 'text-gray-600' : 'font-bold text-gray-900'}`}>{n.title}</span>
                    <span className="shrink-0 text-[11px] text-gray-400">{relTime(n.created_at)}</span>
                  </span>
                  {n.body && <span className="mt-0.5 block truncate text-xs text-gray-500">{n.body}</span>}
                </span>
                {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#00995D]" />}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
              className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40">Anterior</button>
            <span className="text-xs text-gray-400">Página {page}</span>
            <button disabled={items.length < 20} onClick={() => setPage((p) => p + 1)}
              className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-40">Próxima</button>
          </div>
        </div>

        {/* Leitura */}
        <div className={`${selected ? 'block' : 'hidden md:block'} max-h-[70vh] overflow-y-auto`}>
          {!selected ? (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-2 text-gray-300">
              <Bell className="h-10 w-10" />
              <p className="text-sm">Selecione uma notificação para ler.</p>
            </div>
          ) : (
            <div>
              <button onClick={() => setSelected(null)}
                className="flex items-center gap-1 px-4 pt-3 text-sm font-medium text-gray-500 hover:text-gray-700 md:hidden">
                <ChevronLeft className="h-4 w-4" /> Voltar
              </button>
              <div className="bg-[#00995D] px-6 py-3 text-sm font-bold uppercase tracking-wide text-white">
                ✓&nbsp;&nbsp;{blocks ? blocks.banner : selected.title}
              </div>
              <div className="space-y-4 p-6">
                <p className="text-xs text-gray-400">
                  {new Date(selected.created_at).toLocaleString('pt-BR')} · {TYPE_LABELS[selected.type] ?? selected.type}
                </p>
                {(blocks ? blocks.paragraphs : [selected.body ?? '']).filter(Boolean).map((p, i) => (
                  <p key={i} className="text-[15px] leading-relaxed text-gray-700"><Rich text={p} /></p>
                ))}
                {blocks?.result && (
                  <div className="flex flex-col gap-4 rounded-xl bg-[#EAF6F0] p-5 sm:flex-row sm:items-center">
                    <div className="flex flex-1 items-center gap-4">
                      {blocks.result.sealImg && <img src={blocks.result.sealImg} alt={`Selo ${blocks.result.seal}`} className="h-14 w-14 object-contain" />}
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[#00995D]">Resultado da qualificação</p>
                        <p className="text-4xl font-bold leading-tight text-gray-900 tabular-nums">{blocks.result.pct}</p>
                        <p className="text-sm text-gray-600">de atingimento</p>
                        <p className="mt-2 border-t border-[#CFE7DA] pt-2 text-[11px] font-bold uppercase tracking-wide text-[#00995D]">Classificação</p>
                        <p className="text-base font-bold text-gray-900">Selo {blocks.result.seal}</p>
                      </div>
                    </div>
                    <ul className="space-y-2 border-[#CFE7DA] sm:border-l sm:pl-5">
                      {[
                        { Icon: CheckCircle2, label: 'Status', value: blocks.result.status },
                        { Icon: FileText, label: 'Certificado', value: blocks.result.certificate },
                        { Icon: CalendarDays, label: 'Validade', value: blocks.result.validUntil },
                      ].filter(x => x.value).map(({ Icon, label, value }) => (
                        <li key={label} className="flex items-center gap-2.5">
                          <Icon className="h-5 w-5 shrink-0 text-[#00995D]" />
                          <span>
                            <span className="block text-[10px] font-bold uppercase tracking-wide text-[#00995D]">{label}</span>
                            <span className="block text-sm font-bold text-gray-900">{value}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {blocks?.highlight && (
                  <div className="flex items-center gap-4 rounded-xl bg-[#EAF6F0] p-4">
                    {blocks.highlight.iconImg
                      ? <img src={blocks.highlight.iconImg} alt="" className="h-12 w-12 object-contain" />
                      : <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#00995D] text-xl">{blocks.highlight.icon ?? '✉️'}</span>}
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-[#00995D]">{blocks.highlight.label}</p>
                      <p className="text-lg font-bold text-gray-900">{blocks.highlight.value}</p>
                    </div>
                  </div>
                )}
                {blocks?.steps && (
                  <div className="border-l-4 border-[#00995D] bg-[#EAF6F0] p-4 text-sm leading-relaxed text-gray-700">
                    <strong>Próximos passos:</strong> <Rich text={blocks.steps} />
                  </div>
                )}
                {/* Feedback homologação 09/2026: a notificação leva ao destino com um clique. */}
                <button
                  onClick={() => navigate(blocks?.cta?.url || selected.link || '/qualificacao')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#00995D] px-4 py-2 text-sm font-semibold text-white hover:bg-[#007a4a]"
                >
                  {blocks?.cta?.label ?? 'Acessar o portal'} →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
