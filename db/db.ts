// Conexão Postgres (substitui o better-sqlite3 do server.ts).
// A connection string vem SEMPRE de DATABASE_URL (Railway injeta em produção;
// em local, use um arquivo .env — nunca comite credenciais).
import { Pool, types } from 'pg';
import 'dotenv/config';
import { pickDatabaseUrl } from './resolveDbUrl.js';

// Colunas `date` (OID 1082) chegam por padrão como Date em meia-noite LOCAL, e
// ao serializar em JSON viram UTC — o que desloca a data em 1 dia conforme o
// fuso do servidor. Devolvemos a string crua 'YYYY-MM-DD' para a data ficar
// estável independente de fuso (ex.: eval_scripts.revisao_date no chip de revisão).
// timestamptz (created_at, OID 1184) NÃO é afetado.
types.setTypeParser(1082, (value) => value);

// Resolve por APP_ENV (DATABASE_URL_DEV/HOMOLOG/PROD), com fallback p/ DATABASE_URL.
const connectionString = pickDatabaseUrl();
if (!connectionString) {
  const appEnv = process.env.APP_ENV?.trim();
  const hint = appEnv
    ? `APP_ENV=${appEnv} — defina DATABASE_URL_${appEnv.toUpperCase()} (ou DATABASE_URL) no .env.`
    : 'Defina APP_ENV + DATABASE_URL_<AMBIENTE>, ou DATABASE_URL, no .env.';
  throw new Error(`Sem connection string do Postgres. ${hint}`);
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
