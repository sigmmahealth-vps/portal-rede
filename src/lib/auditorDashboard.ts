import { isWithinDeadline } from './surveyBonus.js';

export interface DashboardInstance {
  id: number;
  provider_id: number;
  location_id: number | null;
  script_id?: number;
  provider_name: string;
  provider_code: string | null;
  city: string | null;
  unidade?: string | null;
  provider_group: string | null;
  dims?: Record<string, number> | null;
  status: string;
  percentual: number;
  seal: string | null;
  has_certificate: boolean;
  certificate_id?: number | null;
  seguranca_pct?: number | null;
  submitted_at?: string | null;
  completed_at?: string | null;
  has_survey_response?: boolean;
  survey_state?: 'aguardando' | 'finalizada' | null;
  // Item 18 (homologação 09/2026): plano de outro ciclo ainda aberto p/ o par;
  // com item de critério eliminatório pendente (prev_plan_dl) o selo trava em Bronze.
  prev_plan_pending?: boolean;
  prev_plan_dl?: boolean;
  // Critérios sem decisão terminal (mesmo predicado do parecer) e status mostrado (spec 2026-09-25).
  pending_count?: number | null;
  display_status?: string;
}

// Estado derivado da Pesquisa de Satisfação (spec 2026-09-11) — sem status novo no
// banco. 'aguardando' = parecer travado pela pesquisa (spec 5.4.6); 'finalizada' =
// respondida; null = não enviada, terminal ou prazo vencido sem resposta.
export function surveyState(
  status: string,
  submittedAt: string | null | undefined,
  hasResponse: boolean | undefined,
  now: Date,
): 'aguardando' | 'finalizada' | null {
  if (!['em_analise', 'aguardando_evidencia'].includes(status)) return null;
  if (hasResponse) return 'finalizada';
  if (submittedAt && isWithinDeadline(new Date(submittedAt), now)) return 'aguardando';
  return null;
}

// Status mostrado ao usuário (spec 2026-09-25) — calculado, nunca gravado.
// Só muda em_analise/aguardando_evidencia com TODOS os critérios decididos:
// pesquisa ainda travando o parecer → 'aguardando_pesquisa'; senão → 'emitir_parecer'
// (mesmas travas do POST /parecer). O prestador não vê 'emitir_parecer' (etapa interna).
// pendingCount ausente (null/undefined) = não sabemos → mantém o status gravado,
// nunca supõe "tudo decidido" (bug 25/09: linha sem pending_count virava Aguardando Pesquisa).
export function displayStatus(
  status: string,
  pendingCount: number | null | undefined,
  submittedAt: string | null | undefined,
  hasSurveyResponse: boolean | undefined,
  now: Date,
  audience: 'auditor' | 'prestador' = 'auditor',
): string {
  if (!['em_analise', 'aguardando_evidencia'].includes(status) || pendingCount == null || pendingCount > 0) return status;
  if (!hasSurveyResponse && submittedAt && isWithinDeadline(new Date(submittedAt), now)) return 'aguardando_pesquisa';
  return audience === 'prestador' ? 'em_analise' : 'emitir_parecer';
}

export interface DimPct { instance_id: number; dimension: string; pct: number; }

export interface AuditorDashboardPayload {
  cycle: { id: number; label: string; start_date: string; end_date: string };
  kpis: {
    total_locations: number;
    sent: number; pending: number;
    in_review: number; awaiting_provider: number;
    avg_score: number;
    // Tempo médio envio→parecer em dias (1 decimal), só instâncias com parecer;
    // null sem nenhuma (spec 2026-09-15: números por ator).
    avg_analysis_days: number | null;
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
  now: Date = new Date(),
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

  const analysisDays = instances
    .filter(i => ['aprovado', 'reprovado', 'finalizado'].includes(i.status) && i.submitted_at && i.completed_at)
    .map(i => (new Date(i.completed_at!).getTime() - new Date(i.submitted_at!).getTime()) / 86_400_000)
    .filter(d => d >= 0);
  const avg_analysis_days = analysisDays.length
    ? Math.round((analysisDays.reduce((s, x) => s + x, 0) / analysisDays.length) * 10) / 10
    : null;

  // Agrupa todos os percentuais por dimensão de cada instância (Segurança já vem
  // consolidada com Documento Legal na query). Serve pro filtro < 60% e pras
  // mini-barras por dimensão ao lado do total.
  const dimsByInstance = new Map<number, Record<string, number>>();
  for (const d of dimPct) {
    const m = dimsByInstance.get(d.instance_id) ?? {};
    m[d.dimension] = d.pct;
    dimsByInstance.set(d.instance_id, m);
  }
  let low_security_count = 0;
  for (const dims of dimsByInstance.values()) {
    if (dims['Segurança'] != null && dims['Segurança'] < 60) low_security_count++;
  }

  const enriched = instances.map(i => {
    const dims = dimsByInstance.get(i.id) ?? null;
    return {
      ...i,
      dims,
      seguranca_pct: dims && dims['Segurança'] != null ? dims['Segurança'] : null,
      survey_state: surveyState(i.status, i.submitted_at, i.has_survey_response, now),
      display_status: displayStatus(i.status, i.pending_count, i.submitted_at, i.has_survey_response, now),
    };
  });

  const group_distribution = Array.from(groupPairs.entries())
    .map(([group, pairs]) => ({ group, count: pairs.size }))
    .sort((a, b) => b.count - a.count);

  return { cycle, kpis: { total_locations, sent, pending, in_review, awaiting_provider, avg_score, avg_analysis_days, low_security_count, seal_distribution, group_distribution }, instances: enriched };
}
