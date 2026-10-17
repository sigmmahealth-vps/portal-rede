/**
 * Cópia da carga do SGU entre bancos (Katy, 17/10/2026): quando a carga diária da Unimed não chega
 * num ambiente (ex.: produção parada em 13/10 enquanto o homolog recebia), ele recebe a mesma carga
 * que chegou no outro. Copia a sgu_providers_raw inteira, numa transação, só se a fonte for mais nova.
 *   APP_ENV=prod npx tsx db/sgu-raw-copia.ts            # dry-run (fonte: SGU_RAW_FONTE_URL ou DATABASE_URL_HOMOLOG)
 *   APP_ENV=prod npx tsx db/sgu-raw-copia.ts --commit
 * No servidor: o job do SGU chama copiarCargaSeAtrasada antes da rotina quando SGU_RAW_FONTE_URL existe.
 */
import 'dotenv/config';
import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { pool, withTransaction } from './db.js';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import type { Consulta } from './sgu-sync.js';

export interface FotoCarga { carga: string | null; linhas: number }

// Fonte com menos da metade das linhas do destino = carga suspeita (pela metade): não copia.
export const MINIMO_RELATIVO = 0.5;

export function decidirCopia(fonte: FotoCarga, destino: FotoCarga): { copiar: boolean; motivo: string } {
  if (!fonte.carga || fonte.linhas === 0) return { copiar: false, motivo: 'fonte sem carga' };
  if (destino.carga && destino.carga >= fonte.carga) return { copiar: false, motivo: `destino em dia (carga ${destino.carga})` };
  if (destino.linhas > 0 && fonte.linhas < MINIMO_RELATIVO * destino.linhas) {
    return { copiar: false, motivo: `fonte com ${fonte.linhas} linhas contra ${destino.linhas} no destino — carga suspeita` };
  }
  return { copiar: true, motivo: `destino ${destino.carga ?? 'vazio'} → fonte ${fonte.carga} (${fonte.linhas} linhas)` };
}

const foto = async (c: Consulta): Promise<FotoCarga> => {
  const { rows: [r] } = await c.query(`SELECT max(dh_carga)::text AS carga, count(*)::int AS linhas FROM sgu_providers_raw`);
  return { carga: r.carga, linhas: r.linhas };
};

// `destino` é a conexão do ambiente (dentro de transação); `fonteUrl`, o banco que recebeu a carga.
export async function copiarCargaSeAtrasada(destino: Consulta, fonteUrl: string, opts: { commit: boolean }):
  Promise<{ copiou: boolean; motivo: string; linhas?: number }> {
  const fonte = new pg.Client({ connectionString: fonteUrl, ssl: { rejectUnauthorized: false } });
  await fonte.connect();
  try {
    await fonte.query('SET default_transaction_read_only = on');
    const [f, d] = [await foto(fonte), await foto(destino)];
    const decisao = decidirCopia(f, d);
    if (!decisao.copiar || !opts.commit) return { copiou: false, motivo: decisao.motivo };
    const { rows: [{ dados }] } = await fonte.query(
      `SELECT json_agg(t) AS dados FROM sgu_providers_raw t WHERE dh_carga = $1::timestamp`, [f.carga]);
    // Mesmo efeito da carga da Unimed: troca a foto inteira de uma vez.
    await destino.query('DELETE FROM sgu_providers_raw');
    const ins = await destino.query(
      `INSERT INTO sgu_providers_raw SELECT * FROM json_populate_recordset(NULL::sgu_providers_raw, $1::json)`,
      [JSON.stringify(dados)]);
    const depois = await foto(destino);
    if (depois.carga !== f.carga || depois.linhas !== f.linhas) {
      throw new Error(`cópia inconsistente: destino ficou com ${depois.linhas} linhas / ${depois.carga}`);
    }
    await destino.query(
      `INSERT INTO sgu_sync_runs (source, status, raw_loaded_at, message, finished_at)
       VALUES ('sgu-raw-copia', 'success', $1::timestamp, $2, now())`, [f.carga, decisao.motivo]);
    return { copiou: true, motivo: decisao.motivo, linhas: ins.rowCount ?? 0 };
  } finally {
    await fonte.end();
  }
}

async function main() {
  const commit = process.argv.includes('--commit');
  const url = pickDatabaseUrl();
  const fonteUrl = process.env.SGU_RAW_FONTE_URL || process.env.DATABASE_URL_HOMOLOG;
  if (!fonteUrl) throw new Error('defina SGU_RAW_FONTE_URL (ou DATABASE_URL_HOMOLOG)');
  if (url && new URL(url).host === new URL(fonteUrl).host) throw new Error('fonte e destino são o mesmo banco');
  console.log(`APP_ENV=${process.env.APP_ENV ?? '(vazio)'} | destino: ${url ? new URL(url).host : '(vazio)'} `
    + `| fonte: ${new URL(fonteUrl).host} | ${commit ? 'COMMIT' : 'DRY-RUN'}`);
  try {
    const r = await withTransaction((c) => copiarCargaSeAtrasada(c, fonteUrl, { commit }));
    console.log(r.copiou ? `✔ copiada: ${r.linhas} linhas — ${r.motivo}` : `${commit ? 'não copiada' : 'simulação'}: ${r.motivo}`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
