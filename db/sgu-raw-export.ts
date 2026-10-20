/**
 * Exporta a sgu_providers_raw crua (SELECT *, sem transformação) para .xlsx.
 *   APP_ENV=dev npx tsx db/sgu-raw-export.ts [saida.xlsx]
 * Saída padrão: sgu_providers_raw.<APP_ENV>.xlsx no diretório atual.
 */
import 'dotenv/config';
import { utils, writeFile } from 'xlsx';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import { query, pool } from './db.js';

async function main() {
  const url = pickDatabaseUrl();
  const env = process.env.APP_ENV ?? 'env';
  console.log(`APP_ENV=${env} | banco: ${url ? new URL(url).host : '(vazio)'}`);

  // timestamps viram texto p/ o Excel receber string estável, não Date deslocado por fuso.
  const { rows } = await query(`SELECT *, dh_carga::text AS dh_carga_txt FROM sgu_providers_raw
    ORDER BY codigo_prestador, codigo_tipo_endereco, especialidade_grupo_servico`);
  if (!rows.length) throw new Error('sgu_providers_raw está vazia — nada a exportar.');
  for (const r of rows) { r.dh_carga = r.dh_carga_txt; delete r.dh_carga_txt; }

  const out = process.argv[2] ?? `sgu_providers_raw.${env}.xlsx`;
  const wb = utils.book_new();
  utils.book_append_sheet(wb, utils.json_to_sheet(rows), 'sgu_providers_raw');
  writeFile(wb, out);
  console.log(`✔ ${rows.length} linhas → ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => pool.end());
