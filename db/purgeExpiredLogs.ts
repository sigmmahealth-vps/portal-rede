type QueryFn = (sql: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number }>;

export interface PurgeResult {
  totalDeleted: number;
  deletedByAction: Record<string, number>;
}

export async function purgeExpiredLogs(query: QueryFn): Promise<PurgeResult> {
  const { rows: policies } = await query('SELECT action, ttl_days FROM data_retention_policies');
  const out: PurgeResult = { totalDeleted: 0, deletedByAction: {} };

  for (const p of policies) {
    const isLogin = p.action === '__login__';
    const sql = isLogin
      ? `DELETE FROM access_logs WHERE action IS NULL AND created_at < now() - make_interval(days => $1::int)`
      : `DELETE FROM access_logs WHERE action = $1 AND created_at < now() - make_interval(days => $2::int)`;
    const result = await query(sql, isLogin ? [p.ttl_days] : [p.action, p.ttl_days]);
    const count = result.rowCount ?? 0;
    out.deletedByAction[p.action] = count;
    out.totalDeleted += count;
  }

  await query(
    `UPDATE settings SET value = $1 WHERE key = 'data_retention_last_run_at'`,
    [new Date().toISOString()],
  );
  return out;
}
