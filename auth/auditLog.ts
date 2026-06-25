type QueryFn = (sql: string, params: any[]) => Promise<{ rows: any[] }>;

export interface AuditLogInput {
  query: QueryFn;
  userId?: number | null;
  email?: string | null;
  action?: string | null;
  meta?: Record<string, unknown> | null;
  ip?: string | null;        // já hasheado (ip_hash) na Task 5
  success?: boolean;
  alert?: (msg: string) => void;
}

const SQL = `
  INSERT INTO access_logs (user_id, email, action, meta, ip_hash, success, created_at)
  VALUES ($1, $2, $3, $4, $5, $6, now())
`;

export async function auditLog(input: AuditLogInput): Promise<void> {
  const params = [
    input.userId ?? null,
    input.email ?? null,
    input.action ?? null,
    input.meta ? JSON.stringify(input.meta) : null,
    input.ip ?? null,
    input.success ?? true,
  ];
  const alert = input.alert ?? ((msg: string) => console.error(msg));
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await input.query(SQL, params);
      return;
    } catch (err) {
      if (attempt === 3) {
        alert(`[AUDIT-FAIL] action=${input.action ?? 'login'} userId=${params[0]} err=${(err as Error).message}`);
        return;
      }
      await new Promise(r => setTimeout(r, 50 * attempt));
    }
  }
}
