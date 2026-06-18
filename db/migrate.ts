// Runner de migrations versionadas.
// Aplica, em ordem, os arquivos db/migrations/*.sql que ainda não foram aplicados,
// cada um dentro de uma transação, e registra o nome em schema_migrations.
// Uso: npm run db:migrate
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'migrations');

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function appliedSet(): Promise<Set<string>> {
  const { rows } = await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

async function run() {
  await ensureMigrationsTable();
  const applied = await appliedSet();

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // 0001_, 0002_, ... ordem lexicográfica = ordem de aplicação

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`= já aplicada: ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`+ aplicada:   ${file}`);
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`x falhou:     ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(count === 0 ? 'Nada a aplicar — banco já atualizado.' : `${count} migration(s) aplicada(s).`);
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
