// Semeia documentos genéricos de gestão documental para os 3 prestadores de teste,
// cobrindo os 4 status (Pendente, Aprovado, Vencido, Reprovado) para a tela
// Investigação e Lista. Idempotente: apaga os documentos de catálogo (type_id não
// nulo) antes de inserir. Arquivo (file_url) fica nulo — é dado de demonstração.
//
// DESTRUTIVO (só nos documentos de gestão documental). NUNCA rode contra produção.
// Uso: APP_ENV=dev npm run db:seed-documentos [-- --commit]   (dry-run por padrão)
import 'dotenv/config';
import { query, withTransaction, pool } from './db.js';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import { assertNaoProducao } from './anonimiza-lib.js';

// 6 documentos por prestador. [nome do tipo, status gravado, emissão, validade, motivo]
// Datas fixas: em nov/2026 cobrem regular, vencendo (<=30d), vencido, pendente, reprovado.
const MATRIZ: Array<[string, string, string | null, string | null, string | null]> = [
  ['Alvará Sanitário',              'valido',    '2026-02-15', '2027-06-30', null],                  // Regular
  ['Alvará de Localização',         'valido',    '2026-01-10', '2026-12-05', null],                  // Vencendo (≤30 dias)
  ['Alvará do Corpo de Bombeiros',  'valido',    '2024-05-01', '2025-05-01', null],                  // Vencido (irregular)
  ['CNES',                          'pendente',  '2026-11-01', null,          null],                 // Pendente
  ['Contrato Social',               'reprovado', '2026-10-01', null,          'Documento ilegível.'], // Irregular (reprovado)
  ['CRM do Responsável Técnico',    'valido',    '2015-09-30', null,          null],                 // Regular (sem validade)
];

async function main() {
  const commit = process.argv.includes('--commit');
  const url = pickDatabaseUrl();
  assertNaoProducao(url, process.env.DATABASE_URL_PROD?.trim());
  console.log(`APP_ENV=${process.env.APP_ENV ?? '(vazio)'} | banco: ${url ? new URL(url).host : '(vazio)'} | ${commit ? 'COMMIT' : 'DRY-RUN'}`);

  const { rows: provs } = await query(`SELECT id, name FROM providers ORDER BY id`);
  const { rows: tipos } = await query(`SELECT id, nome FROM document_types`);
  const tipoId = (nome: string) => {
    const t = tipos.find((x: any) => x.nome === nome);
    if (!t) throw new Error(`Tipo não encontrado no catálogo: ${nome}`);
    return t.id as number;
  };
  console.log(`Prestadores: ${provs.length} | tipos no catálogo: ${tipos.length} | a criar: ${provs.length * MATRIZ.length} documentos.`);

  if (!commit) { console.log('Dry-run: nada gravado. Para aplicar: --commit'); return; }

  const upload = new Date().toISOString();
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM documents WHERE type_id IS NOT NULL`); // só os de gestão documental
    let n = 0;
    for (const p of provs) {
      for (const [nome, status, issue, expiry, motivo] of MATRIZ) {
        await client.query(
          `INSERT INTO documents (provider_id, type_id, type, issue_date, expiry_date, status, file_url, upload_date, rejection_reason)
           VALUES ($1,$2,$3,$4,$5,$6,NULL,$7,$8)`,
          [p.id, tipoId(nome), nome, issue, expiry, status, upload, motivo]);
        n++;
      }
    }
    const { rows: porStatus } = await client.query(
      `SELECT status, count(*)::int AS n FROM documents WHERE type_id IS NOT NULL GROUP BY status ORDER BY status`);
    console.log(`  inseridos: ${n} documentos. Por status: ${porStatus.map((r: any) => `${r.status}=${r.n}`).join(', ')}`);
  });
  console.log('✔ Documentos de teste criados.');
}

main().then(() => pool.end()).catch(async (err) => { console.error(err.message ?? err); await pool.end(); process.exit(1); });
