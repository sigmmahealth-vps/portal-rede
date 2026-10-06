// Carrega as senhas provisórias dos prestadores a partir da planilha da Unimed
// (colunas "Código do prestador", "CPF/CNPJ" e "senha"). A senha vale para todos os
// acessos do prestador e nasce com troca obrigatória no primeiro acesso (0057).
// Nunca imprime senha. Prestador que já trocou a senha é pulado, salvo --overwrite.
// Pré-requisito: acessos criados (npm run db:provision-users).
//
// Uso: [APP_ENV=dev] npm run db:import-senhas -- "<planilha.xlsx>" [--commit] [--overwrite]
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import XLSX from 'xlsx';
import { query, pool } from './db.js';
import { PROVIDER_ACCESS_ROLES } from './provider-role.js';

const COMMIT = process.argv.includes('--commit');
const OVERWRITE = process.argv.includes('--overwrite');
const FILE = process.argv.slice(2).find((a) => !a.startsWith('--'));

async function main() {
  if (!FILE) throw new Error('Informe o caminho da planilha.');
  const url = new URL(process.env[`DATABASE_URL_${(process.env.APP_ENV || 'dev').toUpperCase()}`] || process.env.DATABASE_URL || '');
  console.log(`[import-senhas] APP_ENV=${process.env.APP_ENV || '(vazio)'} host=${url.hostname}:${url.port} ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);

  const wb = XLSX.readFile(FILE);
  const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
  const head = rows[0].map((h) => String(h).trim().toLowerCase());
  const col = (name: string) => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`Coluna "${name}" não encontrada. Cabeçalho: ${rows[0].join(' | ')}`);
    return i;
  };
  const [iCode, iDoc, iPw] = [col('código do prestador'), col('cpf/cnpj'), col('senha')];
  const items = rows.slice(1).filter((r) => r.some((c) => String(c).trim())).map((r) => {
    const digits = String(r[iDoc]).replace(/\D/g, '');
    return {
      code: String(r[iCode]).trim(),
      // o Excel come os zeros à esquerda do documento
      doc: digits.padStart(digits.length <= 11 ? 11 : 14, '0'),
      password: String(r[iPw]),
    };
  });

  const { rows: provs } = await query(
    `SELECT p.id, p.sgu_code, COALESCE(p.cnpj, p.cpf) AS doc,
            count(u.id)::int AS accesses,
            COALESCE(bool_or(u.password IS NOT NULL AND NOT u.must_change_password), false) AS own_password
       FROM providers p
       LEFT JOIN users u ON u.provider_id = p.id AND u.is_active = true AND u.role = ANY($1)
      GROUP BY p.id`, [PROVIDER_ACCESS_ROLES]);
  const byDoc = new Map(provs.map((p: any) => [p.doc, p]));

  const toSet: { id: number; password: string }[] = [];
  const skipped: Record<string, string[]> = { 'fora do banco': [], 'código não bate com o documento': [], 'sem acesso criado': [], 'senha curta (< 8)': [], 'já trocou a senha': [] };
  for (const it of items) {
    const p: any = byDoc.get(it.doc);
    if (!p) skipped['fora do banco'].push(it.code);
    else if (p.sgu_code !== it.code) skipped['código não bate com o documento'].push(it.code);
    else if (!p.accesses) skipped['sem acesso criado'].push(it.code);
    else if (it.password.length < 8) skipped['senha curta (< 8)'].push(it.code);
    else if (p.own_password && !OVERWRITE) skipped['já trocou a senha'].push(it.code);
    else toSet.push({ id: Number(p.id), password: it.password });
  }

  console.log(`[import-senhas] linhas na planilha: ${items.length}`);
  console.log(`  → definir senha provisória: ${toSet.length} prestadores`);
  for (const [why, codes] of Object.entries(skipped)) {
    if (codes.length) console.log(`  → pulados (${why}): ${codes.length} — ${codes.slice(0, 15).join(', ')}${codes.length > 15 ? ', ...' : ''}`);
  }

  if (!COMMIT) {
    console.log('[import-senhas] dry-run: nada gravado. Use --commit para aplicar.');
    return;
  }
  let users = 0;
  for (const s of toSet) {
    const r = await query(
      `UPDATE users SET password = $1, must_change_password = true, session_version = session_version + 1
        WHERE provider_id = $2 AND role = ANY($3)`,
      [await bcrypt.hash(s.password, 10), s.id, PROVIDER_ACCESS_ROLES]);
    users += r.rowCount ?? 0;
  }
  console.log(`[import-senhas] concluído: ${toSet.length} prestadores, ${users} acessos com senha provisória.`);
}

main().then(() => pool.end()).catch((err) => { console.error(err.message ?? err); process.exit(1); });
