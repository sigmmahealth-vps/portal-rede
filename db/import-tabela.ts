/**
 * Recarga de prestadores a partir da aba `tabela` de Prestadores Portal.xlsx.
 * Upsert idempotente (ON CONFLICT por sgu_code / sgu_location_code) numa transação —
 * preserva providers.id e provider_locations.id entre execuções, evitando orfanar vínculos.
 * SOMENTE DEV (trava de host).
 *   tsx db/import-tabela.ts            # dry-run: relatório, não grava
 *   tsx db/import-tabela.ts --commit   # grava no Postgres de dev
 * Env: CADASTRO_FILE (default ../Prestadores Portal.xlsx), CADASTRO_SHEET (default "tabela").
 */
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import XLSX from 'xlsx';
import { parseTabela, type TabelaRow } from './tabela-parser.js';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import { query } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FILE = process.env.CADASTRO_FILE || path.resolve(PROJECT_ROOT, '..', 'Prestadores Portal.xlsx');
const SHEET = process.env.CADASTRO_SHEET || 'tabela';
// Hosts onde a recarga destrutiva pode rodar: dev e homolog. NUNCA prod (zephyr).
const ALLOWED_HOSTS = ['reseau.proxy.rlwy.net', 'interchange.proxy.rlwy.net'];

export function assertReloadHost(url: string | undefined = pickDatabaseUrl()): void {
  const host = url ? new URL(url).host : '(vazio)';
  if (!url || !ALLOWED_HOSTS.some((h) => url.includes(h))) {
    throw new Error(`Trava de host: import-tabela só roda em DEV/HOMOLOG (${ALLOWED_HOSTS.join(', ')}). Host atual: ${host}`);
  }
}

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

function readRows(): TabelaRow[] {
  const wb = XLSX.read(fs.readFileSync(FILE), { cellDates: false });
  const sheet = wb.Sheets[SHEET];
  if (!sheet) throw new Error(`Aba "${SHEET}" não encontrada. Abas: ${wb.SheetNames.join(', ')}`);
  return XLSX.utils.sheet_to_json<TabelaRow>(sheet, { defval: null });
}

// Upsert idempotente das unidades de um prestador, por (provider_id, sgu_location_code):
// preserva provider_locations.id entre execuções (essencial p/ vínculos como user_locations).
// Unidades que sumiram do arquivo são desativadas, não apagadas — id sobrevive se voltarem.
export async function upsertProviderLocations(providerSguCode: string, locations: any[], client = { query }) {
  const { rows: pr } = await client.query(
    `SELECT id FROM providers WHERE sgu_code = $1`, [providerSguCode]);
  if (!pr.length) return;
  const providerId = pr[0].id;
  const keptCodes: string[] = [];
  for (const l of locations) {
    keptCodes.push(l.sgu_location_code);
    await client.query(
      `INSERT INTO provider_locations
         (provider_id, sgu_location_code, label, cep, logradouro, numero, complemento,
          bairro, cidade, uf, phone, email, is_primary, in_medical_guide, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true)
       ON CONFLICT (provider_id, sgu_location_code) DO UPDATE SET
         label=EXCLUDED.label, cep=EXCLUDED.cep, logradouro=EXCLUDED.logradouro,
         numero=EXCLUDED.numero, complemento=EXCLUDED.complemento, bairro=EXCLUDED.bairro,
         cidade=EXCLUDED.cidade, uf=EXCLUDED.uf, phone=EXCLUDED.phone, email=EXCLUDED.email,
         is_primary=EXCLUDED.is_primary, in_medical_guide=EXCLUDED.in_medical_guide, active=true`,
      [providerId, l.sgu_location_code, l.label, l.cep, l.logradouro, l.numero, l.complemento,
       l.bairro, l.cidade, l.uf, l.phone, l.email, l.is_primary, l.in_medical_guide]);
  }
  // Unidades que sumiram do arquivo: desativa (não apaga — id sobrevive se voltar).
  await client.query(
    `UPDATE provider_locations SET active=false
      WHERE provider_id=$1 AND NOT (sgu_location_code = ANY($2::text[]))`,
    [providerId, keptCodes]);
}

async function main() {
  const doCommit = process.argv.slice(2).includes('--commit');
  if (!fs.existsSync(FILE)) {
    console.error(`Arquivo não encontrado: ${FILE}`);
    process.exit(1);
  }

  const { providers, warnings } = parseTabela(readRows());
  const nLocParsed = providers.reduce((s, p) => s + p.locations.length, 0);
  const dist = new Map<string, number>();
  for (const p of providers) {
    const k = p.roteiro_cod ?? 'A DEFINIR';
    dist.set(k, (dist.get(k) ?? 0) + 1);
  }

  console.log(`Arquivo: ${FILE} | aba: ${SHEET} | modo: ${doCommit ? 'COMMIT' : 'DRY-RUN'}`);
  console.log(`Prestadores: ${providers.length} | Locais: ${nLocParsed}`);
  console.log(`Roteiros: ${[...dist].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  if (warnings.length) {
    console.log(`⚠ ${warnings.length} avisos:`);
    for (const w of warnings.slice(0, 15)) console.log(`   - ${w}`);
    if (warnings.length > 15) console.log(`   ... (+${warnings.length - 15})`);
  }

  if (!doCommit) {
    console.log(`\nDry-run. Para gravar: tsx db/import-tabela.ts --commit`);
    return;
  }

  assertReloadHost();
  const { withTransaction, pool } = await import('./db.js');
  const scriptByCod = await resolveScriptIds();
  const naoResolvidos = new Set<string>();
  const { rows: runRows } = await query<{ id: number }>(
    `INSERT INTO sgu_sync_runs (source, status) VALUES ('xlsx-tabela', 'running') RETURNING id`,
  );
  const runId = runRows[0].id;
  let nLoc = 0;
  try {
    await withTransaction(async (client) => {
      // Upsert por sgu_code/sgu_location_code (não DELETE+INSERT): preserva
      // providers.id e provider_locations.id entre execuções, para não orfanar
      // vínculos (users, eval_*, qualifications...) a cada recarga.
      for (const p of providers) {
        const evalScriptId = p.roteiro_cod ? scriptByCod.get(p.roteiro_cod) ?? null : null;
        if (p.roteiro_cod && evalScriptId == null) naoResolvidos.add(p.roteiro_cod);
        await client.query(
          `INSERT INTO providers
             (sgu_code, name, trade_name, person_type, cnpj, cpf, council_registry,
              specialties, provider_type, provider_group, area_atuacao, status,
              responsavel_tecnico, eval_script_id, roteiro_cod, roteiro_confianca, source, sgu_synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,'sgu',now())
           ON CONFLICT (sgu_code) DO UPDATE SET
             name=EXCLUDED.name, trade_name=EXCLUDED.trade_name, person_type=EXCLUDED.person_type,
             cnpj=EXCLUDED.cnpj, cpf=EXCLUDED.cpf, council_registry=EXCLUDED.council_registry,
             specialties=EXCLUDED.specialties, provider_type=EXCLUDED.provider_type,
             provider_group=EXCLUDED.provider_group, status=EXCLUDED.status,
             responsavel_tecnico=EXCLUDED.responsavel_tecnico, eval_script_id=EXCLUDED.eval_script_id,
             roteiro_cod=EXCLUDED.roteiro_cod, roteiro_confianca=EXCLUDED.roteiro_confianca,
             source='sgu', sgu_synced_at=now()`,
          [
            p.sgu_code, p.name, p.trade_name, p.person_type, p.cnpj, p.cpf, p.council_registry,
            JSON.stringify(p.specialties), p.provider_type, p.provider_group, null, p.status,
            p.responsavel_tecnico, evalScriptId, p.roteiro_cod, p.roteiro_confianca,
          ],
        );
        await upsertProviderLocations(p.sgu_code, p.locations, client);
        nLoc += p.locations.length;
      }
    });
    await query(
      `UPDATE sgu_sync_runs SET status='success', providers_upserted=$2, locations_upserted=$3,
         message=$4, finished_at=now() WHERE id=$1`,
      [runId, providers.length, nLoc, `roteiros sem eval_script_id: ${[...naoResolvidos].join(',') || 'nenhum'}`],
    );
    console.log(`\n✔ Recarga: ${providers.length} prestadores, ${nLoc} locais.`);
    if (naoResolvidos.size) console.log(`⚠ roteiros sem eval_script_id: ${[...naoResolvidos].join(', ')}`);
  } catch (err: any) {
    await query(`UPDATE sgu_sync_runs SET status='error', message=$2, finished_at=now() WHERE id=$1`, [runId, String(err?.message ?? err)]);
    throw err;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
