// Script idempotente de backfill de ip_hash para registros legados.
// Processa access_logs com ip NOT NULL e ip_hash IS NULL em lotes.
// Uso: npm run db:backfill-ip-hash
// Idempotente: pode ser executado múltiplas vezes, processa apenas registros pendentes.
import 'dotenv/config';
import { query } from './db.js';
import { hashIp } from '../auth/ipHash.js';

async function main() {
  const secret = process.env.IP_HASH_SECRET;
  if (!secret) throw new Error('IP_HASH_SECRET ausente');

  const BATCH = 500;
  let updated = 0;

  for (;;) {
    const { rows } = await query<{ id: number; ip: string }>(
      'SELECT id, ip FROM access_logs WHERE ip IS NOT NULL AND ip_hash IS NULL LIMIT $1',
      [BATCH],
    );

    if (rows.length === 0) break;

    for (const r of rows) {
      const h = hashIp(r.ip, secret);
      await query('UPDATE access_logs SET ip_hash = $1 WHERE id = $2', [h, r.id]);
      updated++;
    }

    console.log(`[backfill] ${updated} registros…`);
  }

  console.log(`[backfill] concluído: ${updated} registros`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
