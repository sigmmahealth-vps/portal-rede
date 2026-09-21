// Item 18 (homologação 09/2026) + spec 2026-09-21: plano de OUTRO ciclo ainda aberto
// sinaliza o ciclo seguinte; item ELIMINATÓRIO pendente trava o selo em Bronze. A
// marcação é a ATUAL do critério (via answer_id); sem answer_id, cai em dimension = DL.
// Sem harness de servidor, exercita a MESMA query de pendingPrevPlan (server.ts).
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from './db.js';
import { PLAN_ITEM_QUESTION_JOIN_SQL, PLAN_ITEM_ELIMINATORY_SQL } from '../src/lib/eliminatory.js';

async function pendingPrevPlan(providerId: number, locationId: number | null, cycleId: number | null) {
  const { rows: [r] } = await query(`
    SELECT BOOL_OR(${PLAN_ITEM_ELIMINATORY_SQL}) AS has_elim
      FROM eval_action_plans ap
      JOIN eval_action_items it ON it.plan_id = ap.id AND it.status <> 'concluida'
      ${PLAN_ITEM_QUESTION_JOIN_SQL}
     WHERE ap.provider_id = $1
       AND (ap.location_id IS NULL OR ap.location_id = $2)
       AND ap.closed_without_completion = false
       AND ap.cycle_id IS DISTINCT FROM $3
  `, [providerId, locationId, cycleId]);
  return { pending: r?.has_elim != null, hasEliminatory: !!r?.has_elim };
}

test('pendingPrevPlan: eliminatório pendente (marcação atual) trava Bronze; fallback por dimensão sem answer_id', async () => {
  const ids: { cycles: number[]; prov?: number; plan?: number; script?: number } = { cycles: [] };
  try {
    const { rows: [p] } = await query(
      `INSERT INTO providers (sgu_code, name, status) VALUES ('_TEST_PPP_', '_TEST_PPP_', 'Ativo') RETURNING id`);
    ids.prov = Number(p.id);
    for (const label of ['_TEST_PPP_C1_', '_TEST_PPP_C2_']) {
      const { rows: [c] } = await query(
        `INSERT INTO eval_cycles (label, start_date, end_date, active, cert_valid_until)
         VALUES ($1, '2026-01-01', '2026-06-30', false, '2027-06-30') RETURNING id`, [label]);
      ids.cycles.push(Number(c.id));
    }
    const [c1, c2] = ids.cycles;

    // Roteiro mínimo: um critério de SEGURANÇA marcado eliminatório, respondido no ciclo 1.
    const { rows: [s] } = await query(
      `INSERT INTO eval_scripts (title, version, source_file, revisao_date, implantacao_date)
       VALUES ('_TEST_PPP_', '00', '_TEST_PPP_.xlsx', '2026-01-01', '2026-01-01') RETURNING id`);
    ids.script = Number(s.id);
    const { rows: [sec] } = await query(
      `INSERT INTO eval_sections (script_id, name, order_index) VALUES ($1, '_TEST_PPP_', 1) RETURNING id`, [ids.script]);
    const { rows: [q] } = await query(
      `INSERT INTO eval_questions (section_id, code, text, type, max_score, dimension, is_eliminatory, order_index)
       VALUES ($1, '1.1.1', 'Alvará', 'sim_nao', 10, 'Segurança', true, 1) RETURNING id`, [sec.id]);
    const { rows: [inst] } = await query(
      `INSERT INTO eval_instances (script_id, provider_id, cycle_id, status) VALUES ($1, $2, $3, 'aprovado') RETURNING id`,
      [ids.script, ids.prov, c1]);
    const { rows: [ans] } = await query(
      `INSERT INTO eval_answers (instance_id, question_id, answer_value, score_obtained) VALUES ($1, $2, 'nao', 0) RETURNING id`,
      [inst.id, q.id]);

    const { rows: [plan] } = await query(
      `INSERT INTO eval_action_plans (cycle_id, provider_id, origin) VALUES ($1, $2, 'manual') RETURNING id`,
      [c1, ids.prov]);
    ids.plan = Number(plan.id);
    const item = async (dimension: string | null, status: string, answerId: number | null) => {
      const { rows: [it] } = await query(
        `INSERT INTO eval_action_items (plan_id, answer_id, dimension, what, status) VALUES ($1, $2, $3, 'x', $4) RETURNING id`,
        [ids.plan, answerId, dimension, status]);
      return Number(it.id);
    };
    const seg = await item('Segurança', 'em_andamento', Number(ans.id)); // ligado ao critério marcado
    const conforto = await item('Conforto', 'nao_iniciada', null);

    // Visto do ciclo 2: pendente e com eliminatório (Segurança marcada) → trava Bronze.
    assert.deepEqual(await pendingPrevPlan(ids.prov, null, c2), { pending: true, hasEliminatory: true });
    // Visto do PRÓPRIO ciclo 1: plano é do ciclo corrente, não sinaliza.
    assert.deepEqual(await pendingPrevPlan(ids.prov, null, c1), { pending: false, hasEliminatory: false });

    // Desmarcar o critério "perdoa" o plano antigo (marcação ATUAL, decisão Q9-B).
    await query('UPDATE eval_questions SET is_eliminatory = false WHERE id = $1', [q.id]);
    assert.deepEqual(await pendingPrevPlan(ids.prov, null, c2), { pending: true, hasEliminatory: false });

    // Fallback: item SEM answer_id e dimensão Documento Legal segue travando.
    const dlSolto = await item('Documento Legal', 'em_andamento', null);
    assert.deepEqual(await pendingPrevPlan(ids.prov, null, c2), { pending: true, hasEliminatory: true });

    // Concluídos os dois, resta Conforto aberto: pendente sem trava de selo.
    await query(`UPDATE eval_action_items SET status = 'concluida' WHERE id = ANY($1::bigint[])`, [[seg, dlSolto]]);
    assert.deepEqual(await pendingPrevPlan(ids.prov, null, c2), { pending: true, hasEliminatory: false });

    // Fecha o Conforto também e insere item manual (sem answer_id e sem dimension).
    await query(`UPDATE eval_action_items SET status = 'concluida' WHERE id = $1`, [conforto]);
    await item(null, 'nao_iniciada', null);
    // Item manual (sem answer_id e sem dimension) ainda sinaliza plano pendente — sem o "false" final do COALESCE o BOOL_OR daria NULL e pending viraria false.
    assert.deepEqual(await pendingPrevPlan(ids.prov, null, c2), { pending: true, hasEliminatory: false });

    // Encerrado sem conclusão: deixa de sinalizar.
    await query(`UPDATE eval_action_plans SET closed_without_completion = true WHERE id = $1`, [ids.plan]);
    assert.deepEqual(await pendingPrevPlan(ids.prov, null, c2), { pending: false, hasEliminatory: false });
  } finally {
    if (ids.plan) await query('DELETE FROM eval_action_plans WHERE id = $1', [ids.plan]);
    if (ids.script) await query('DELETE FROM eval_scripts WHERE id = $1', [ids.script]); // cascade: seções, critérios, instância, resposta
    if (ids.cycles.length) await query('DELETE FROM eval_cycles WHERE id = ANY($1::bigint[])', [ids.cycles]);
    if (ids.prov) await query('DELETE FROM providers WHERE id = $1', [ids.prov]);
    await pool.end();
  }
});
