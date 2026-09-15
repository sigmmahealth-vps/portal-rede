// Inclusão avulsa (spec 2026-09-15): sem harness de servidor, o teste exercita a
// MESMA query de candidatos/cascata do GET /cycles/:id/inclusion-candidates:
// par sem instância e não excluído aparece; roteiro resolve override → grupo do
// ciclo → providers.eval_script_id; grupo desconhecido fica NULL (pendente).
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from './db.js';

const SGU_A = '_TEST_INC_A_'; // grupo mapeado no ciclo
const SGU_B = '_TEST_INC_B_'; // grupo fora do mapa, com match da carga
const SGU_C = '_TEST_INC_C_'; // sem grupo nem match → pendente
const GROUP_A = '_TEST_GRUPO_INC_';

// Cópia fiel da query de server.ts /inclusion-candidates (filtrada aos providers do teste).
async function candidates(cycleId: number, providerIds: number[]) {
  const { rows } = await query(`
    SELECT p.id AS provider_id, pl.id AS location_id,
           COALESCE(ov.script_id, ecg.script_id, p.eval_script_id) AS resolved_script_id
      FROM provider_locations pl
      JOIN providers p ON p.id = pl.provider_id
      LEFT JOIN eval_cycle_groups ecg ON ecg.cycle_id = $1 AND ecg.provider_group = p.provider_group
      LEFT JOIN eval_cycle_overrides ov ON ov.cycle_id = $1 AND ov.provider_id = p.id AND ov.location_id = pl.id
     WHERE pl.in_medical_guide = true
       AND p.id = ANY($2::bigint[])
       AND NOT EXISTS (SELECT 1 FROM eval_instances ei
                        WHERE ei.cycle_id = $1 AND ei.provider_id = p.id AND ei.location_id = pl.id)
       AND NOT EXISTS (SELECT 1 FROM eval_cycle_exclusions x
                        WHERE x.cycle_id = $1 AND x.provider_id = p.id AND x.location_id = pl.id)
     ORDER BY p.id
  `, [cycleId, providerIds]);
  return rows.map((r: any) => ({
    provider_id: Number(r.provider_id),
    resolved_script_id: r.resolved_script_id != null ? Number(r.resolved_script_id) : null,
  }));
}

test('inclusion-candidates: fila derivada + cascata de roteiro', async () => {
  const ids: { cycle?: number; script?: number; provs: number[] } = { provs: [] };
  try {
    const { rows: [sc] } = await query(
      `INSERT INTO eval_scripts (title) VALUES ('_TEST_ROTEIRO_INC_') RETURNING id`);
    ids.script = Number(sc.id);
    const { rows: [cy] } = await query(
      `INSERT INTO eval_cycles (label, start_date, end_date, active, cert_valid_until)
       VALUES ('_TEST_CICLO_INC_', '2026-01-01', '2026-12-31', false, '2027-12-31') RETURNING id`);
    ids.cycle = Number(cy.id);
    await query(`INSERT INTO eval_cycle_groups (cycle_id, provider_group, script_id) VALUES ($1, $2, $3)`,
      [ids.cycle, GROUP_A, ids.script]);

    const mkProv = async (sgu: string, group: string | null, scriptId: number | null) => {
      const { rows: [p] } = await query(
        `INSERT INTO providers (sgu_code, name, status, provider_group, eval_script_id)
         VALUES ($1, $1, 'Ativo', $2, $3) RETURNING id`, [sgu, group, scriptId]);
      const { rows: [l] } = await query(
        `INSERT INTO provider_locations (provider_id, sgu_location_code, label, is_primary, in_medical_guide)
         VALUES ($1, $2 || '-COM', 'Comercial', true, true) RETURNING id`, [p.id, sgu]);
      ids.provs.push(Number(p.id));
      return { provider: Number(p.id), location: Number(l.id) };
    };
    const a = await mkProv(SGU_A, GROUP_A, null);          // resolve pelo grupo do ciclo
    const b = await mkProv(SGU_B, '_TEST_OUTRO_', ids.script); // resolve pelo match da carga
    const c = await mkProv(SGU_C, null, null);             // pendente de roteiro

    let rows = await candidates(ids.cycle, ids.provs);
    assert.deepEqual(rows, [
      { provider_id: a.provider, resolved_script_id: ids.script },
      { provider_id: b.provider, resolved_script_id: ids.script },
      { provider_id: c.provider, resolved_script_id: null },
    ]);

    // Par com instância no ciclo sai da fila; par excluído também.
    await query(`INSERT INTO eval_instances (script_id, provider_id, location_id, status, cycle_id)
                 VALUES ($1, $2, $3, 'pendente', $4)`, [ids.script, a.provider, a.location, ids.cycle]);
    await query(`INSERT INTO eval_cycle_exclusions (cycle_id, provider_id, location_id, reason)
                 VALUES ($1, $2, $3, 'teste')`, [ids.cycle, b.provider, b.location]);
    rows = await candidates(ids.cycle, ids.provs);
    assert.deepEqual(rows.map(r => r.provider_id), [c.provider]);
  } finally {
    if (ids.cycle) await query('DELETE FROM eval_cycles WHERE id = $1', [ids.cycle]);
    if (ids.provs.length) await query('DELETE FROM providers WHERE id = ANY($1::bigint[])', [ids.provs]);
    if (ids.script) await query('DELETE FROM eval_scripts WHERE id = $1', [ids.script]);
    await pool.end();
  }
});
