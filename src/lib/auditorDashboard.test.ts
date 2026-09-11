import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuditorDashboard, type DashboardInstance, type DimPct } from './auditorDashboard.js';

const cycle = { id: 1, label: 'Ciclo 2026', start_date: '2026-01-01', end_date: '2026-12-31' };

function inst(over: Partial<DashboardInstance> = {}): DashboardInstance {
  return {
    ...over,
    id: over.id ?? 1,
    provider_id: over.provider_id ?? 10,
    location_id: over.location_id ?? null,
    provider_name: over.provider_name ?? 'X',
    provider_code: over.provider_code ?? 'SGU-1',
    city: over.city ?? 'Criciúma',
    provider_group: over.provider_group ?? 'MEDICOS COOPERADOS',
    status: over.status ?? 'em_analise',
    percentual: over.percentual ?? 70,
    seal: over.seal ?? null,
    has_certificate: over.has_certificate ?? false,
  };
}

test('total_locations conta pares distintos (provider_id, location_id)', () => {
  const r = buildAuditorDashboard(cycle, [
    inst({ id: 1, provider_id: 10, location_id: null }),   // 1 par
    inst({ id: 2, provider_id: 10, location_id: 100 }),    // 2 par
    inst({ id: 3, provider_id: 10, location_id: 100 }),    // duplicado
    inst({ id: 4, provider_id: 11, location_id: null }),   // 3 par
  ], []);
  assert.equal(r.kpis.total_locations, 3);
});

test('sent inclui em_analise/aguardando_evidencia/aprovado/reprovado/finalizado; pending = em_andamento+pendente', () => {
  const r = buildAuditorDashboard(cycle, [
    inst({ id: 1, status: 'em_andamento' }),
    inst({ id: 2, status: 'pendente' }),
    inst({ id: 3, status: 'em_analise' }),
    inst({ id: 4, status: 'aguardando_evidencia' }),
    inst({ id: 5, status: 'aprovado' }),
    inst({ id: 6, status: 'reprovado' }),
    inst({ id: 7, status: 'finalizado' }),
  ], []);
  assert.equal(r.kpis.pending, 2);
  assert.equal(r.kpis.sent, 5);
  assert.equal(r.kpis.in_review, 1);
  assert.equal(r.kpis.awaiting_provider, 1);
});

test('avg_score ignora em_andamento', () => {
  const r = buildAuditorDashboard(cycle, [
    inst({ id: 1, status: 'em_andamento', percentual: 0 }),
    inst({ id: 2, status: 'finalizado',   percentual: 80 }),
    inst({ id: 3, status: 'aprovado',     percentual: 60 }),
  ], []);
  assert.equal(r.kpis.avg_score, 70);
});

test('low_security_count conta instâncias com % Segurança < 60 e anexa seguranca_pct', () => {
  const r = buildAuditorDashboard(cycle, [inst({ id: 1 }), inst({ id: 2 }), inst({ id: 3 }), inst({ id: 4 })], [
    { instance_id: 1, dimension: 'Segurança', pct: 50 },  // conta
    { instance_id: 2, dimension: 'Segurança', pct: 60 },  // NÃO conta (limite estrito)
    { instance_id: 3, dimension: 'Segurança', pct: 59.9 },// conta
    { instance_id: 1, dimension: 'Conforto',  pct: 20 },  // outra dimensão, ignorada
  ]);
  assert.equal(r.kpis.low_security_count, 2);
  // seguranca_pct por instância alimenta o filtro do painel; sem dado = null.
  const byId = Object.fromEntries(r.instances.map(i => [i.id, i.seguranca_pct]));
  assert.equal(byId[1], 50);
  assert.equal(byId[2], 60);
  assert.equal(byId[4], null);
});

test('seal_distribution agrupa Ouro/Prata/Bronze; reprovados sem selo viram Não Qualificado', () => {
  const r = buildAuditorDashboard(cycle, [
    inst({ id: 1, seal: 'Ouro',   status: 'finalizado' }),
    inst({ id: 2, seal: 'Prata',  status: 'finalizado' }),
    inst({ id: 3, seal: 'Bronze', status: 'finalizado' }),
    inst({ id: 4, seal: null,     status: 'reprovado'  }),
    inst({ id: 5, seal: null,     status: 'em_analise' }), // fora
  ], []);
  assert.deepEqual(r.kpis.seal_distribution, { 'Ouro': 1, 'Prata': 1, 'Bronze': 1, 'Não Qualificado': 1 });
});

test('group_distribution conta pares distintos (provider_id, location_id) por grupo', () => {
  const r = buildAuditorDashboard(cycle, [
    inst({ id: 1, provider_id: 1, location_id: null, provider_group: 'G1' }),
    inst({ id: 2, provider_id: 1, location_id: 10,   provider_group: 'G1' }),
    inst({ id: 3, provider_id: 2, location_id: null, provider_group: 'G2' }),
    inst({ id: 4, provider_id: 2, location_id: null, provider_group: 'G2' }),  // dup
  ], []);
  const g = Object.fromEntries(r.kpis.group_distribution.map(x => [x.group, x.count]));
  assert.equal(g['G1'], 2);
  assert.equal(g['G2'], 1);
});

test('instances é mapeada 1:1 preservando order e has_certificate default false', () => {
  const r = buildAuditorDashboard(cycle, [
    inst({ id: 42, provider_id: 23, provider_name: 'Clínica X', percentual: 71.5 }),
  ], []);
  assert.equal(r.instances.length, 1);
  assert.equal(r.instances[0].id, 42);
  assert.equal(r.instances[0].provider_name, 'Clínica X');
  assert.equal(r.instances[0].has_certificate, false);
});

test('survey_state: aguardando dentro do prazo, finalizada com resposta, null nos demais', () => {
  const now = new Date('2026-09-11T12:00:00Z');
  const r = buildAuditorDashboard(cycle, [
    // em análise, sem resposta, enviada há 2 dias → aguardando
    inst({ id: 1, status: 'em_analise', submitted_at: '2026-09-09T12:00:00Z', has_survey_response: false }),
    // reanálise, com resposta → finalizada
    inst({ id: 2, status: 'aguardando_evidencia', submitted_at: '2026-09-09T12:00:00Z', has_survey_response: true }),
    // prazo vencido (10 dias) sem resposta → null (parecer já liberado)
    inst({ id: 3, status: 'em_analise', submitted_at: '2026-09-01T12:00:00Z', has_survey_response: false }),
    // terminal → null mesmo com resposta
    inst({ id: 4, status: 'aprovado', submitted_at: '2026-09-09T12:00:00Z', has_survey_response: true }),
    // ainda não enviada → null
    inst({ id: 5, status: 'em_andamento', submitted_at: null, has_survey_response: false }),
  ], [], now);
  const st = Object.fromEntries(r.instances.map(i => [i.id, i.survey_state]));
  assert.equal(st[1], 'aguardando');
  assert.equal(st[2], 'finalizada');
  assert.equal(st[3], null);
  assert.equal(st[4], null);
  assert.equal(st[5], null);
});
