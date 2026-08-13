import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInicioModel } from './inicioAlerts.ts';

const inst = (o: any) => ({
  id: 1, status: 'pendente', script_id: 9, script_title: 'RN 630',
  location_label: 'Rua X', location_uf: 'sc', location_id: 5,
  total_questions: 47, answered_count: 0, ...o,
});

test('aguardando_evidencia vira grupo corrigir', () => {
  const m = buildInicioModel({ instances: [inst({ id: 1, status: 'aguardando_evidencia' })] });
  assert.equal(m.groups[0].type, 'corrigir');
  assert.equal(m.groups[0].count, 1);
  assert.equal(m.groups[0].items[0].ref, 'RN 630 — Rua X/SC');
});

test('pendente sem respostas vira iniciar; em_andamento parcial vira continuar com "faltam X de N"', () => {
  const m = buildInicioModel({ instances: [
    inst({ id: 1, status: 'pendente', answered_count: 0 }),
    inst({ id: 2, status: 'em_andamento', answered_count: 35, total_questions: 47 }),
  ] });
  const iniciar = m.groups.find(g => g.type === 'iniciar')!;
  const continuar = m.groups.find(g => g.type === 'continuar')!;
  assert.equal(iniciar.count, 1);
  assert.equal(continuar.count, 1);
  assert.equal(continuar.items[0].detail, 'faltam 12 de 47');
});

test('em_analise, terminais e ciclo_encerrado não geram alerta', () => {
  const m = buildInicioModel({ instances: [
    inst({ id: 1, status: 'em_analise' }),
    inst({ id: 2, status: 'finalizado' }),
    inst({ id: 3, status: 'aprovado' }),
    inst({ id: 4, status: 'ciclo_encerrado' }),
  ] });
  assert.equal(m.groups.length, 0);
  assert.equal(m.pendingCount, 0);
});

test('survey disponível no prazo vira pesquisa; expirada/respondida não', () => {
  const m = buildInicioModel({ surveys: [
    { instance_id: 1, state: 'disponivel', expired: false, deadline: '2026-09-01', location_label: 'Rua X', location_uf: 'sc' },
    { instance_id: 2, state: 'disponivel', expired: true },
    { instance_id: 3, state: 'respondida' },
  ] });
  const g = m.groups.find(x => x.type === 'pesquisa')!;
  assert.equal(g.count, 1);
  assert.equal(g.items[0].ref, 'Rua X/SC');
});

test('plano pending gera alerta; não-pending é ignorado', () => {
  const m = buildInicioModel({ plans: [
    { id: 10, cycle_label: 'Ciclo 2026', location_label: 'Rua X', location_uf: 'sc', pending: true },
    { id: 11, cycle_label: 'Ciclo 2025', pending: false },
  ] });
  const g = m.groups.find(x => x.type === 'plano')!;
  assert.equal(g.count, 1);
  assert.equal(g.items[0].planId, 10);
});

test('certificado não visto entra em newCertificates e NÃO conta em pendingCount', () => {
  const m = buildInicioModel({
    instances: [inst({ id: 1, status: 'pendente' })],
    certificates: [{ id: 3, seal: 'Ouro', location_label: 'Rua X', seen: false },
                   { id: 4, seal: 'Prata', location_label: 'Rua Y', seen: true }],
  });
  assert.equal(m.newCertificates.length, 1);
  assert.equal(m.newCertificates[0].id, 3);
  assert.equal(m.pendingCount, 1); // só a instância iniciar; cert não conta
});

test('pendingCount = soma de corrigir+plano+continuar+iniciar+pesquisa', () => {
  const m = buildInicioModel({
    instances: [
      inst({ id: 1, status: 'aguardando_evidencia' }),                 // corrigir
      inst({ id: 2, status: 'pendente', answered_count: 0 }),          // iniciar
      inst({ id: 3, status: 'em_andamento', answered_count: 10 }),     // continuar
    ],
    plans: [{ id: 10, cycle_label: 'C', pending: true }],              // plano
    surveys: [{ instance_id: 9, state: 'disponivel', expired: false, deadline: '2026-09-01', location_label: 'Z' }], // pesquisa
  });
  assert.equal(m.pendingCount, 5);
});

test('grupos vêm na ordem corrigir, plano, continuar, iniciar, pesquisa', () => {
  const m = buildInicioModel({
    instances: [
      inst({ id: 1, status: 'pendente', answered_count: 0 }),
      inst({ id: 2, status: 'em_andamento', answered_count: 10 }),
      inst({ id: 3, status: 'aguardando_evidencia' }),
    ],
    plans: [{ id: 10, cycle_label: 'C', pending: true }],
    surveys: [{ instance_id: 9, state: 'disponivel', expired: false, deadline: '2026-09-01', location_label: 'Z' }],
  });
  assert.deepEqual(m.groups.map(g => g.type), ['corrigir', 'plano', 'continuar', 'iniciar', 'pesquisa']);
});

test('vazio: sem pendências e sem certificado', () => {
  const m = buildInicioModel({});
  assert.equal(m.pendingCount, 0);
  assert.deepEqual(m.groups, []);
  assert.deepEqual(m.newCertificates, []);
});
