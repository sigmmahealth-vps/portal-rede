/**
 * Aplica a planilha de critérios eliminatórios da Unimed na versão vigente de cada roteiro (FOR-XXX).
 *   APP_ENV=dev npx tsx db/aplicar-eliminatorios.ts "../CRITÉRIOS ELIMINATÓRIOS PRP.xlsx"            # dry-run
 *   APP_ENV=dev npx tsx db/aplicar-eliminatorios.ts "<planilha>" --commit
 *   --aceitar=FOR-017:1.1.4,...  marca itens cujo texto não confirma o tipo de documento da planilha
 *   --forcar-trava               aplica mesmo em roteiro com avaliação em ciclo aberto (a tela recusa)
 * Regra de casamento em db/eliminatorios-planilha.ts. Cada roteiro alterado vira um eval_eliminatory_changed.
 */
import 'dotenv/config';
import XLSX from 'xlsx';
import { pathToFileURL } from 'node:url';
import { pool, withTransaction } from './db.js';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import { auditLog } from '../auth/auditLog.js';
import { planejarEliminatorios, type ItemPlanilha } from './eliminatorios-planilha.js';

class Simulacao extends Error {}

export function lerPlanilha(arquivo: string): ItemPlanilha[] {
  const wb = XLSX.readFile(arquivo);
  const linhas = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }).slice(1);
  return linhas
    .map((l) => ({ roteiro: /FOR-\d+/.exec(String(l[0]))?.[0] ?? '', item: String(l[2]).trim(), tipoDoc: String(l[3]).trim() }))
    .filter((i) => i.roteiro && i.item);
}

async function main() {
  const arquivo = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!arquivo) throw new Error('informe o caminho da planilha');
  const commit = process.argv.includes('--commit');
  const forcarTrava = process.argv.includes('--forcar-trava');
  const aceitar = new Set((process.argv.find((a) => a.startsWith('--aceitar='))?.slice(10) ?? '').split(',').filter(Boolean));
  const url = pickDatabaseUrl();
  console.log(`APP_ENV=${process.env.APP_ENV ?? '(vazio)'} | banco: ${url ? new URL(url).host : '(vazio)'} | ${commit ? 'COMMIT' : 'DRY-RUN'}`
    + (forcarTrava ? ' | forçando trava' : '') + (aceitar.size ? ` | aceitos: ${[...aceitar].join(', ')}` : ''));
  const itens = lerPlanilha(arquivo);
  const porRoteiro = new Map<string, ItemPlanilha[]>();
  for (const i of itens) porRoteiro.set(i.roteiro, [...(porRoteiro.get(i.roteiro) ?? []), i]);
  console.log(`planilha: ${itens.length} itens em ${porRoteiro.size} roteiros`);

  try {
    await withTransaction(async (c) => {
      // Versão vigente = a mais recente de cada FOR-XXX (é a que o import vincula aos prestadores).
      const { rows: roteiros } = await c.query(`
        SELECT DISTINCT ON (rot) id, rot, source_file, version,
               EXISTS (SELECT 1 FROM eval_instances i JOIN eval_cycles cy ON cy.id = i.cycle_id
                        WHERE i.script_id = s.id AND cy.active) AS travado,
               (SELECT count(*)::int FROM providers p WHERE p.eval_script_id = s.id) AS prestadores
          FROM (SELECT *, substring(source_file from 'FOR-[0-9]+') AS rot FROM eval_scripts) s
         WHERE rot IS NOT NULL ORDER BY rot, id DESC`);
      const doBanco = new Map(roteiros.map((r: any) => [r.rot, r]));
      let total = 0;
      for (const rot of [...porRoteiro.keys()].sort()) {
        const r: any = doBanco.get(rot);
        if (!r) { console.log(`\n${rot}: roteiro não existe neste banco — pulado`); continue; }
        const { rows: crit } = await c.query(
          `SELECT q.id, q.code, q.text, q.is_eliminatory FROM eval_questions q JOIN eval_sections sc ON sc.id = q.section_id
            WHERE sc.script_id = $1 ORDER BY q.order_index`, [r.id]);
        const p = planejarEliminatorios(porRoteiro.get(rot)!, crit.map((x: any) => ({ ...x, id: Number(x.id) })), aceitar);
        console.log(`\n${rot} (roteiro ${r.id}, v${r.version}, ${r.prestadores} prestadores): eliminatórios `
          + `${p.final.map((x) => x.code).join(', ') || 'nenhum'} | +${p.marcar.length} −${p.desmarcar.length}`);
        for (const d of p.divergentes) console.log(`   ⚠ ${d.item} planilha "${d.tipoDoc}" ≠ roteiro "${d.texto.slice(0, 90)}" — não marcado`);
        for (const a of p.ausentes) console.log(`   ⚠ ${a.item} "${a.tipoDoc}" não existe no roteiro`);
        if (!p.marcar.length && !p.desmarcar.length) continue;
        if (r.travado && !forcarTrava) { console.log('   ✖ roteiro com avaliação em ciclo aberto — não alterado (use --forcar-trava)'); continue; }
        await c.query('UPDATE eval_questions SET is_eliminatory = true  WHERE id = ANY($1::bigint[])', [p.marcar.map((x) => x.id)]);
        await c.query('UPDATE eval_questions SET is_eliminatory = false WHERE id = ANY($1::bigint[])', [p.desmarcar.map((x) => x.id)]);
        await auditLog({
          query: (sql, params) => c.query(sql, params), userId: null, action: 'eval_eliminatory_changed',
          meta: { script_id: Number(r.id), source_file: r.source_file, version: r.version, via: 'planilha CRITÉRIOS ELIMINATÓRIOS PRP.xlsx',
                  marked: p.marcar.map((x) => x.code), unmarked: p.desmarcar.map((x) => x.code), forced_lock: !!r.travado },
        });
        total += p.marcar.length + p.desmarcar.length;
      }
      console.log(`\n${commit ? '✔ gravado' : 'simulado'}: ${total} critério(s) alterado(s)`);
      if (!commit) throw new Simulacao();
    });
  } catch (e) {
    if (!(e instanceof Simulacao)) throw e;
    console.log('Dry-run: nada gravado. Para aplicar: --commit');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
