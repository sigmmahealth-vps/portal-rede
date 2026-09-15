// Item 18 (homologação 09/2026): plano de ação de OUTRO ciclo ainda aberto
// sinaliza o ciclo seguinte; item de Documento Legal pendente trava selo em Bronze.
// Sem harness de servidor, exercita a MESMA query de pendingPrevPlan (server.ts).
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from './db.js';

async function pendingPrevPlan(providerId: number, locationId: number | null, cycleId: number | null) {
  const { rows: [r] } = await query(`
    SELECT BOOL_OR(it.dimension = 'Documento Legal') AS has_dl
      FROM eval_action_plans ap
      JOIN eval_action_items it ON it.plan_id = ap.id AND it.status <> 'concluida'
     WHERE ap.provider_id = $1
       AND (ap.location_id IS NULL OR ap.location_id = $2)
       AND ap.closed_without_completion = false
       AND ap.cycle_id IS DISTINCT FROM $3
  `, [providerId, locationId, cycleId]);
  return { pending: r?.has_dl != null, hasDL: !!r?.has_dl };
}

test('pendingPrevPlan: plano de ciclo anterior aberto sinaliza; DL pendente trava Bronze', async () => {
  const ids: { cycles: number[]; prov?: number; plan?: number } = { cycles: [] };
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

    const { rows: [plan] } = await query(
      `INSERT INTO eval_action_plans (cycle_id, provider_id, origin) VALUES ($1, $2, 'manual') RETURNING id`,
      [c1, ids.prov]);
    ids.plan = Number(plan.id);
    const item = async (dimension: string, status: string) => {
      const { rows: [it] } = await query(
        `INSERT INTO eval_action_items (plan_id, dimension, what, status) VALUES ($1, $2, 'x', $3) RETURNING id`,
        [ids.plan, dimension, status]);
      return Number(it.id);
    };
    const dl = await item('Documento Legal', 'em_andamento');
    await item('Conforto', 'nao_iniciada');

    // Visto do ciclo 2: pendente e com DL → trava Bronze.
    assert.deepEqual(await pendingPrevPlan(ids.prov, null, c2), { pending: true, hasDL: true });
    // Visto do PRÓPRIO ciclo 1: plano é do ciclo corrente, não sinaliza.
    assert.deepEqual(await pendingPrevPlan(ids.prov, null, c1), { pending: false, hasDL: false });

    // DL concluído, resta Conforto aberto: pendente sem trava de selo.
    await query(`UPDATE eval_action_items SET status = 'concluida' WHERE id = $1`, [dl]);
    assert.deepEqual(await pendingPrevPlan(ids.prov, null, c2), { pending: true, hasDL: false });

    // Encerrado sem conclusão: deixa de sinalizar.
    await query(`UPDATE eval_action_plans SET closed_without_completion = true WHERE id = $1`, [ids.plan]);
    assert.deepEqual(await pendingPrevPlan(ids.prov, null, c2), { pending: false, hasDL: false });
  } finally {
    if (ids.plan) await query('DELETE FROM eval_action_plans WHERE id = $1', [ids.plan]);
    if (ids.cycles.length) await query('DELETE FROM eval_cycles WHERE id = ANY($1::bigint[])', [ids.cycles]);
    if (ids.prov) await query('DELETE FROM providers WHERE id = $1', [ids.prov]);
    await pool.end();
  }
});
