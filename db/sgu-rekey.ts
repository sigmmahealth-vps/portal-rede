/**
 * Uma vez por ambiente (spec fase 2, A2): troca o código posicional das unidades pelo estável
 * <código>-<codigo_tipo_endereco>, casando com a sgu_providers_raw pelo endereço e mantendo o id.
 *   APP_ENV=dev npx tsx db/sgu-rekey.ts            # dry-run
 *   APP_ENV=dev npx tsx db/sgu-rekey.ts --commit
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { pool, withTransaction } from './db.js';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import { planejarRekey, type UnidadeRekey } from './sgu-sync-plan.js';

async function main() {
  const commit = process.argv.includes('--commit');
  const url = pickDatabaseUrl();
  console.log(`APP_ENV=${process.env.APP_ENV ?? '(vazio)'} | banco: ${url ? new URL(url).host : '(vazio)'} | ${commit ? 'COMMIT' : 'DRY-RUN'}`);
  try {
    await withTransaction(async (c) => {
      const { rows: raw } = await c.query(
        `SELECT * FROM sgu_providers_raw ORDER BY codigo_prestador, codigo_tipo_endereco, especialidade_grupo_servico`);
      if (!raw.length) throw new Error('sgu_providers_raw vazia — rekey abortado (inativaria todas as unidades).');
      const { rows } = await c.query(
        `SELECT pl.id, pl.provider_id, p.sgu_code, pl.sgu_location_code, pl.sgu_tipo_endereco, pl.cep, pl.logradouro, pl.numero
           FROM provider_locations pl JOIN providers p ON p.id = pl.provider_id
          WHERE p.source = 'sgu'`);
      const unidades: UnidadeRekey[] = rows.map((r) => ({ ...r, id: Number(r.id), provider_id: Number(r.provider_id) }));
      const plano = planejarRekey(unidades, raw);
      console.log(`Unidades sgu: ${unidades.length} | recodificadas: ${plano.rekey.length} | inativadas: ${plano.inativar.length}`);
      for (const i of plano.inativar.slice(0, 30)) console.log(`   - inativa ${i.id} → ${i.codigo}`);
      if (plano.inativar.length > 30) console.log(`   ... (+${plano.inativar.length - 30})`);
      if (!commit) { console.log('Dry-run: nada gravado. Para aplicar: --commit'); return; }

      // Passo intermediário: libera os códigos atuais antes de gravar os novos (índice único por prestador).
      const ids = [...plano.rekey.map((r) => r.id), ...plano.inativar.map((r) => r.id)];
      await c.query(`UPDATE provider_locations SET sgu_location_code = '~rekey~' || id WHERE id = ANY($1::bigint[])`, [ids]);
      for (const r of plano.rekey) {
        await c.query(`UPDATE provider_locations SET sgu_location_code = $2, sgu_tipo_endereco = $3 WHERE id = $1`,
          [r.id, r.codigo, r.tipo]);
      }
      for (const r of plano.inativar) {
        await c.query(`UPDATE provider_locations SET sgu_location_code = $2, active = false WHERE id = $1`, [r.id, r.codigo]);
      }
      console.log('✔ Rekey aplicado.');
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
