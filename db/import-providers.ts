/**
 * Importador de prestadores (WS2) — carga a partir de cadastro_prestadores_v0.xlsx.
 * Dry-run por padrão; --commit grava (idempotente por sgu_code).
 *   tsx db/import-providers.ts            # dry-run: só relatório, não grava
 *   tsx db/import-providers.ts --commit   # grava no Postgres
 * Env: CADASTRO_FILE (default ../cadastro_prestadores_v0.xlsx), CADASTRO_SHEET (default "Match").
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { parseProviders, type ParsedProvider, type RawRow } from './providers-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CADASTRO_FILE = process.env.CADASTRO_FILE || path.resolve(PROJECT_ROOT, '..', 'cadastro_prestadores_v0.xlsx');
const CADASTRO_SHEET = process.env.CADASTRO_SHEET || 'Match';

function readRows(file: string, sheetName: string): RawRow[] {
  const wb = XLSX.read(fs.readFileSync(file), { cellDates: true });
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`Aba "${sheetName}" não encontrada. Abas: ${wb.SheetNames.join(', ')}`);
  return XLSX.utils.sheet_to_json<RawRow>(sheet, { raw: true, defval: '' });
}

/** Mapa FOR-XXX -> eval_scripts.id (extraído de source_file). */
async function resolveScriptIds(): Promise<Map<string, number>> {
  const { query } = await import('./db.js');
  const { rows } = await query<{ id: number; source_file: string }>('SELECT id, source_file FROM eval_scripts');
  const map = new Map<string, number>();
  for (const r of rows) {
    const m = /FOR-(\d+)/i.exec(r.source_file ?? '');
    if (m) map.set(`FOR-${m[1]}`, r.id);
  }
  return map;
}

interface CommitCounts { providers: number; locations: number; certs: number; resolved: number; }

async function commit(providers: ParsedProvider[], scriptByCod: Map<string, number>): Promise<CommitCounts> {
  const { query, withTransaction } = await import('./db.js');
  const { rows: runRows } = await query<{ id: number }>(
    `INSERT INTO sgu_sync_runs (source, status) VALUES ('xlsx', 'running') RETURNING id`,
  );
  const runId = runRows[0].id;
  let nLoc = 0, nCert = 0, nResolved = 0;
  try {
    await withTransaction(async (client) => {
      for (const p of providers) {
        const evalScriptId = p.roteiro_cod ? scriptByCod.get(p.roteiro_cod) ?? null : null;
        if (evalScriptId != null) nResolved++;
        const { rows } = await client.query<{ id: number }>(
          `INSERT INTO providers
             (sgu_code, name, trade_name, person_type, cnpj, cpf, council_registry,
              specialties, provider_type, provider_group, area_atuacao, status,
              eval_script_id, roteiro_cod, roteiro_confianca, source, sgu_synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,'sgu',now())
           ON CONFLICT (sgu_code) DO UPDATE SET
             name=EXCLUDED.name, trade_name=EXCLUDED.trade_name, person_type=EXCLUDED.person_type,
             cnpj=EXCLUDED.cnpj, cpf=EXCLUDED.cpf, council_registry=EXCLUDED.council_registry,
             specialties=EXCLUDED.specialties, provider_type=EXCLUDED.provider_type,
             provider_group=EXCLUDED.provider_group, area_atuacao=EXCLUDED.area_atuacao,
             status=EXCLUDED.status, eval_script_id=EXCLUDED.eval_script_id,
             roteiro_cod=EXCLUDED.roteiro_cod, roteiro_confianca=EXCLUDED.roteiro_confianca,
             sgu_synced_at=now()
           RETURNING id`,
          [p.sgu_code, p.name, p.trade_name, p.person_type, p.cnpj, p.cpf, p.council_registry,
           JSON.stringify(p.specialties), p.provider_type, p.provider_group, p.area_atuacao, p.status,
           evalScriptId, p.roteiro_cod, p.roteiro_confianca],
        );
        const providerId = rows[0].id;

        await client.query('DELETE FROM provider_locations WHERE provider_id = $1', [providerId]);
        for (const l of p.locations) {
          await client.query(
            `INSERT INTO provider_locations
               (provider_id, sgu_location_code, label, cep, logradouro, numero, complemento,
                bairro, cidade, uf, phone, email, is_primary, in_medical_guide, active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true)`,
            [providerId, l.sgu_location_code, l.label, l.cep, l.logradouro, l.numero, l.complemento,
             l.bairro, l.cidade, l.uf, l.phone, l.email, l.is_primary, l.in_medical_guide],
          );
          nLoc++;
        }

        await client.query('DELETE FROM provider_certifications WHERE provider_id = $1', [providerId]);
        for (const c of p.certifications) {
          await client.query(
            `INSERT INTO provider_certifications
               (provider_id, kind, title, issuer, level, issued_date, expiry_date, source, sgu_synced_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'sgu',now())`,
            [providerId, c.kind, c.title, c.issuer, c.level, c.issued_date, c.expiry_date],
          );
          nCert++;
        }
      }
    });
    await query(
      `UPDATE sgu_sync_runs SET status='success', providers_upserted=$2, locations_upserted=$3,
         message=$4, finished_at=now() WHERE id=$1`,
      [runId, providers.length, nLoc, `certs=${nCert}; roteiros_resolvidos=${nResolved}`],
    );
    return { providers: providers.length, locations: nLoc, certs: nCert, resolved: nResolved };
  } catch (err: any) {
    await query(`UPDATE sgu_sync_runs SET status='error', message=$2, finished_at=now() WHERE id=$1`,
      [runId, String(err?.message ?? err)]);
    throw err;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const doCommit = args.includes('--commit');
  if (!fs.existsSync(CADASTRO_FILE)) { console.error(`Arquivo não encontrado: ${CADASTRO_FILE}`); process.exit(1); }

  const rows = readRows(CADASTRO_FILE, CADASTRO_SHEET);
  const { providers, warnings } = parseProviders(rows);

  const pj = providers.filter((p) => p.person_type === 'PJ').length;
  const pf = providers.filter((p) => p.person_type === 'PF').length;
  const semDoc = providers.filter((p) => !p.person_type).length;
  const locs = providers.reduce((s, p) => s + p.locations.length, 0);
  const certs = providers.reduce((s, p) => s + p.certifications.length, 0);
  const comRoteiro = providers.filter((p) => p.roteiro_cod).length;
  const byType = new Map<string, number>();
  for (const p of providers) { const k = p.provider_type ?? '(sem)'; byType.set(k, (byType.get(k) ?? 0) + 1); }

  console.log(`Arquivo: ${CADASTRO_FILE}`);
  console.log(`Aba: ${CADASTRO_SHEET} | linhas: ${rows.length} | modo: ${doCommit ? 'COMMIT' : 'DRY-RUN'}`);
  console.log(`Prestadores: ${providers.length}  (PJ=${pj}, PF=${pf}, sem doc=${semDoc})`);
  console.log(`Locais: ${locs} | Certificações: ${certs} | com roteiro (cod): ${comRoteiro}`);
  console.log(`Por tipo: ${Array.from(byType).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  if (warnings.length) {
    console.log(`\n⚠ ${warnings.length} avisos:`);
    for (const w of warnings.slice(0, 15)) console.log(`   - ${w}`);
    if (warnings.length > 15) console.log(`   ... (+${warnings.length - 15})`);
  }

  if (!doCommit) {
    console.log(`\nDry-run. Para gravar: tsx db/import-providers.ts --commit`);
    return;
  }

  const scriptByCod = await resolveScriptIds();
  const res = await commit(providers, scriptByCod);
  console.log(`\n✔ Gravado: ${res.providers} prestadores, ${res.locations} locais, ${res.certs} certificações.`);
  console.log(`  Roteiros resolvidos (FK eval_script_id): ${res.resolved} de ${comRoteiro} com código.`);
  const { pool } = await import('./db.js');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
