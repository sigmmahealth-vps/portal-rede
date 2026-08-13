// src/lib/inicioAlerts.ts
// Modelo puro do "mural de alertas" da aba Início (spec 2026-08-13).
// Sem I/O nem React: recebe os dados dos endpoints e devolve os grupos
// ordenados por urgência + a contagem de pendências. Testável com node --test.

export type AlertType = 'corrigir' | 'plano' | 'continuar' | 'iniciar' | 'pesquisa';

// Ordem de exibição por urgência (spec §3). Todos os 5 tipos contam em N.
export const ALERT_ORDER: AlertType[] = ['corrigir', 'plano', 'continuar', 'iniciar', 'pesquisa'];

// Estados em que o prestador ainda edita a instância (espelha PrestadorView).
const EDITABLE_STATES = ['pendente', 'em_andamento', 'aguardando_evidencia'];

export interface AlertItem {
  key: string;
  ref: string;
  detail?: string;
  instanceId?: number;
  scriptId?: number;
  locationId?: number | null;
  planId?: number;
  deadline?: string;
}
export interface AlertGroup { type: AlertType; count: number; items: AlertItem[]; }
export interface NewCert { id: number; seal: string; locationLabel: string | null; }
export interface InicioModel { pendingCount: number; groups: AlertGroup[]; newCertificates: NewCert[]; }

function locStr(label?: string | null, uf?: string | null): string {
  if (!label) return '';
  return uf ? `${label}/${String(uf).toUpperCase()}` : label;
}
function withLoc(title: string, label?: string | null, uf?: string | null): string {
  const l = locStr(label, uf);
  return l ? `${title} — ${l}` : title;
}
function fillPct(total: number, answered: number): number {
  return total > 0 ? Math.round((answered / total) * 100) : 0;
}

export function buildInicioModel(input: {
  instances?: any[]; surveys?: any[]; plans?: any[]; certificates?: any[];
}): InicioModel {
  const buckets: Record<AlertType, AlertItem[]> = {
    corrigir: [], plano: [], continuar: [], iniciar: [], pesquisa: [],
  };

  for (const i of input.instances ?? []) {
    const base: AlertItem = {
      key: `inst-${i.id}`,
      ref: withLoc(i.script_title, i.location_label, i.location_uf),
      instanceId: Number(i.id),
      scriptId: Number(i.script_id),
      locationId: i.location_id ?? null,
    };
    if (i.status === 'aguardando_evidencia') {
      buckets.corrigir.push(base);
    } else if (EDITABLE_STATES.includes(i.status)) {
      const total = Number(i.total_questions) || 0;
      const answered = Number(i.answered_count) || 0;
      if (fillPct(total, answered) === 0) buckets.iniciar.push(base);
      else buckets.continuar.push({ ...base, detail: `faltam ${total - answered} de ${total}` });
    }
    // em_analise, terminais e ciclo_encerrado não geram alerta (spec §Máquina de estados).
  }

  for (const p of input.plans ?? []) {
    if (!p.pending) continue;
    buckets.plano.push({
      key: `plan-${p.id}`,
      planId: Number(p.id),
      ref: withLoc(p.cycle_label || `Plano #${p.id}`, p.location_label, p.location_uf),
    });
  }

  for (const s of input.surveys ?? []) {
    if (s.state === 'disponivel' && !s.expired) {
      buckets.pesquisa.push({
        key: `survey-${s.instance_id}`,
        instanceId: Number(s.instance_id),
        ref: locStr(s.location_label, s.location_uf) || s.script_title || 'Unidade',
        deadline: s.deadline,
      });
    }
  }

  const groups: AlertGroup[] = ALERT_ORDER
    .map(type => ({ type, count: buckets[type].length, items: buckets[type] }))
    .filter(g => g.count > 0);

  const pendingCount = groups.reduce((n, g) => n + g.count, 0);

  const newCertificates: NewCert[] = (input.certificates ?? [])
    .filter(c => !c.seen)
    .map(c => ({ id: Number(c.id), seal: c.seal, locationLabel: c.location_label ?? null }));

  return { pendingCount, groups, newCertificates };
}
