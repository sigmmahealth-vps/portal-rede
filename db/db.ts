// Conexão Postgres (substitui o better-sqlite3 do server.ts).
// A connection string vem SEMPRE de DATABASE_URL (Railway injeta em produção;
// em local, use um arquivo .env — nunca comite credenciais).
import { Pool } from 'pg';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL não definida. Configure-a no ambiente ou no .env local.');
}

// Railway expõe o Postgres atrás de um proxy TLS; habilitamos SSL sem exigir CA local.
const useSsl = process.env.PGSSL !== 'disable';

export const pool = new Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_MAX ?? 10),
});

// Helper de query parametrizada ($1, $2, ...). Sempre use placeholders — nunca
// concatene valores na string SQL (prevenção de SQL injection).
export function query<T = any>(text: string, params?: unknown[]) {
  return pool.query<T>(text, params);
}

export async function withTransaction<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
