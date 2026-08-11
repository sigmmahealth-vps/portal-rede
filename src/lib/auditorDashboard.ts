export interface DashboardInstance {
  id: number;
  provider_id: number;
  location_id: number | null;
  provider_name: string;
  provider_code: string | null;
  city: string | null;
  provider_group: string | null;
  status: string;
  percentual: number;
  seal: string | null;
  has_certificate: boolean;
  seguranca_pct?: number | null;
}

export interface DimPct { instance_id: number; dimension: string; pct: number; }

export interface AuditorDashboardPayload {
  cycle: { id: number; label: string; start_date: string; end_date: string };
  kpis: {
    total_locations: number;
    sent: number; pending: number;
    in_review: number; awaiting_provider: number;
    avg_score: number;
    low_security_count: number;
    seal_distribution: Record<string, number>;
    group_distribution: { group: string; count: number }[];
  };
  instances: DashboardInstance[];
}

const SENT_STATUSES = new Set(['em_analise', 'aguardando_evidencia', 'aprovado', 'reprovado', 'finalizado']);
const PENDING_STATUSES = new Set(['em_andamento', 'pendente']);

export function buildAuditorDashboard(
  cycle: AuditorDashboardPayload['cycle'],
  instances: DashboardInstance[],
  dimPct: DimPct[],
): AuditorDashboardPayload {
  const pairKey = (i: DashboardInstance) => `${i.provider_id}::${i.location_id ?? 'null'}`;
  const distinctPairs = new Set(instances.map(pairKey));
  const total_locations = distinctPairs.size;

  let sent = 0, pending = 0, in_review = 0, awaiting_provider = 0;
  const scores: number[] = [];
  const seal_distribution: Record<string, number> = { 'Ouro': 0, 'Prata': 0, 'Bronze': 0, 'Não Qualificado': 0 };
  const groupPairs = new Map<string, Set<string>>();

  for (const inst of instances) {
    if (SENT_STATUSES.has(inst.status)) sent++;
    if (PENDING_STATUSES.has(inst.status)) pending++;
    if (inst.status === 'em_analise') in_review++;
    if (inst.status === 'aguardando_evidencia') awaiting_provider++;
    if (inst.status !== 'em_andamento') scores.push(Number(inst.percentual) || 0);

    if (inst.seal && seal_distribution[inst.seal] !== undefined) seal_distribution[inst.seal]++;
    else if (!inst.seal && inst.status === 'reprovado') seal_distribution['Não Qualificado']++;

    if (inst.provider_group) {
      if (!groupPairs.has(inst.provider_group)) groupPairs.set(inst.provider_group, new Set());
      groupPairs.get(inst.provider_group)!.add(pairKey(inst));
    }
  }

  const avg_score = scores.length ? Math.round((scores.reduce((s, x) => s + x, 0) / scores.length) * 10) / 10 : 0;

  const secByInstance = new Map<number, number>();
  for (const d of dimPct) {
    if (d.dimension === 'Segurança') secByInstance.set(d.instance_id, d.pct);
  }
  let low_security_count = 0;
  for (const pct of secByInstance.values()) if (pct < 60) low_security_count++;

  // Anexa o % de Segurança em cada prestador (null = sem resposta ainda), pra
  // permitir o filtro "Segurança < 60%" no painel.
  const enriched = instances.map(i => ({
    ...i,
    seguranca_pct: secByInstance.has(i.id) ? secByInstance.get(i.id)! : null,
  }));

  const group_distribution = Array.from(groupPairs.entries())
    .map(([group, pairs]) => ({ group, count: pairs.size }))
    .sort((a, b) => b.count - a.count);

  return { cycle, kpis: { total_locations, sent, pending, in_review, awaiting_provider, avg_score, low_security_count, seal_distribution, group_distribution }, instances: enriched };
}
