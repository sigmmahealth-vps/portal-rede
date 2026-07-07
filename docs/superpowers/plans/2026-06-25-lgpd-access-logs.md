# LGPD — Trilha de Acessos: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar os 6 gaps de LGPD identificados na trilha `access_logs` — privacidade dos dados gravados, retenção/expurgo, transparência ao titular e endurecimento da gravação — sem quebrar fluxos existentes (login, rate-limit, listagem admin).

**Architecture:**
- Mudanças concentradas em `auth/auditLog.ts` (novo helper único de gravação), `auth/ipHash.ts` (novo, pseudonimização), `db/migrations/0012*`–`0014*` (schema), `server.ts` (substituir 8 INSERTs em access_logs pelo helper + 2 endpoints novos), e uma página pública `src/pages/PoliticaPrivacidade.tsx`.
- A pseudonimização do IP usa HMAC-SHA256 com sal em env (`IP_HASH_SECRET`), com truncamento prévio para `/24` (IPv4) ou `/48` (IPv6). Plain-text IP deixa de ser persistido.
- Retenção: tabela `data_retention_policies` define dias por `action` (NULL = login records). Job `purgeExpiredLogs()` roda no boot se a última execução foi há > 24h, e via endpoint admin `POST /api/admin/data-retention/run`.
- Transparência: página estática `/politica-privacidade` com nome/contato do DPO via `DPO_NAME`/`DPO_EMAIL`; endpoint `GET /api/me/access-logs` para o titular ver seus próprios eventos.

**Tech Stack:** Node 20, Express 4, Postgres (pg), tsx, `node --test`, React 19 + Vite, `crypto` nativo, dotenv.

---

## File Structure

**Criar:**
- `auth/auditLog.ts` — helper único `auditLog({ userId, email, action, meta, ip, success, query })` com retry + alerta em falha
- `auth/auditLog.test.ts` — testes do helper (sucesso, retry, alerta)
- `auth/ipHash.ts` — `hashIp(ip: string | null | undefined, secret: string): string | null` (HMAC-SHA256 sobre IP truncado)
- `auth/ipHash.test.ts` — testes (IPv4 trunca /24, IPv6 trunca /48, null safe, secret vazio lança)
- `db/migrations/0012_access_logs_ip_hash.sql` — adiciona `ip_hash text`, índice
- `db/migrations/0013_data_retention.sql` — tabela `data_retention_policies` com defaults
- `db/migrations/0014_access_logs_drop_ip.sql` — depois do backfill, dropa coluna `ip` em claro
- `db/backfill-ip-hash.ts` — script idempotente para hashear IPs legados
- `db/purgeExpiredLogs.ts` — helper que aplica políticas e retorna `{ deletedByAction, totalDeleted }`
- `db/purgeExpiredLogs.test.ts` — testes (cada política respeita seu TTL, default para action=NULL)
- `src/pages/PoliticaPrivacidade.tsx` — página estática (responsivo, tipografia Tailwind)
- `src/pages/MeusDados.tsx` — tela do titular com lista paginada dos próprios eventos

**Modificar:**
- `server.ts` — trocar 8 INSERTs diretos em `access_logs` por `auditLog(...)`; gravar `ip_hash` em vez de `ip`; remover `email` do `meta` do reset; expor `GET /api/me/access-logs`, `POST /api/admin/data-retention/run` e `GET /api/privacy/dpo`; rodar `purgeExpiredLogs` no boot quando devido
- `src/App.tsx` (ou roteador equivalente) — rotas `/politica-privacidade` (pública) e `/meus-dados` (autenticada)
- `src/components/Footer.tsx` (ou layout que tenha o rodapé) — link "Política de Privacidade"
- `.env.example` — adicionar `IP_HASH_SECRET`, `DPO_NAME`, `DPO_EMAIL`, `RETENTION_AUTO_PURGE`
- `package.json` — adicionar script `db:backfill-ip-hash` e incluir novos testes

---

## Implementation order

A ordem inverte parcialmente a severidade declarada para reduzir risco e produzir incrementos deployáveis:

1. **Fase A — quick wins sem schema** (Tasks 1–2): remover e-mail vazado + criar helper de gravação
2. **Fase B — pseudonimização** (Tasks 3–6): hash de IP novo + backfill
3. **Fase C — retenção** (Tasks 7–8): políticas + job
4. **Fase D — transparência ao titular** (Tasks 9–10): página de privacidade/DPO + tela "Meus dados"

Cada fase é independente em deploy: dá para parar em qualquer fronteira e ainda ficar melhor do que está hoje.

---

## Task 1: Remover e-mail vazado do meta de password_reset_requested

**Files:**
- Modify: `portal-rede-v1-main/server.ts:537-540`

- [ ] **Step 1: Localizar o INSERT e abrir o trecho**

O bloco atual em `server.ts:536-540`:
```ts
await query(
  `INSERT INTO access_logs (user_id, action, meta, ip, success, created_at)
   VALUES (NULL, 'password_reset_requested', $1, $2, true, now())`,
  [JSON.stringify({ email: emailLc, exists: !!user }), req.ip],
);
```

- [ ] **Step 2: Substituir o payload de meta**

Trocar `JSON.stringify({ email: emailLc, exists: !!user })` por `JSON.stringify({ exists: !!user })`. O `req.ip` continua igual por enquanto — será trocado na Task 5.

Bloco final:
```ts
await query(
  `INSERT INTO access_logs (user_id, action, meta, ip, success, created_at)
   VALUES (NULL, 'password_reset_requested', $1, $2, true, now())`,
  [JSON.stringify({ exists: !!user }), req.ip],
);
```

- [ ] **Step 3: Verificar manualmente**

Rodar `npm run dev` (em dev), chamar:
```bash
curl -X POST http://localhost:3000/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"qualquer@teste.com"}'
```

Conferir no Postgres de dev:
```sql
SELECT meta FROM access_logs WHERE action='password_reset_requested' ORDER BY created_at DESC LIMIT 1;
```
Esperado: `{"exists": false}` (ou `true`), **sem campo `email`**.

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "fix(lgpd): remove e-mail do meta de password_reset_requested"
```

---

## Task 2: Helper `auditLog` com gravação garantida

**Por que existe:** hoje `server.ts:293` faz `console.error('Falha ao registrar access_log:', err);` — uma falha de auditoria não acorda ninguém. Vamos centralizar em um helper que tenta retry e, em última instância, dispara um alerta visível (callback injetado; fallback para `console.error` com prefixo `[AUDIT-FAIL]` e processo continua).

**Files:**
- Create: `portal-rede-v1-main/auth/auditLog.ts`
- Create: `portal-rede-v1-main/auth/auditLog.test.ts`
- Modify: `portal-rede-v1-main/package.json` (incluir o novo teste)

- [ ] **Step 1: Escrever o teste — sucesso na primeira tentativa**

Criar `auth/auditLog.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditLog } from './auditLog.js';

test('auditLog insere com sucesso na primeira tentativa', async () => {
  const calls: any[] = [];
  const query = async (sql: string, params: any[]) => {
    calls.push({ sql, params });
    return { rows: [] };
  };
  await auditLog({
    query,
    userId: 42, email: 'x@y.com', action: 'login',
    meta: { foo: 'bar' }, ip: '10.0.0.1', success: true,
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO access_logs/);
  assert.equal(calls[0].params[0], 42);
  assert.equal(calls[0].params[1], 'x@y.com');
  assert.equal(calls[0].params[2], 'login');
  assert.equal(calls[0].params[3], JSON.stringify({ foo: 'bar' }));
  assert.equal(calls[0].params[4], '10.0.0.1');
  assert.equal(calls[0].params[5], true);
});
```

- [ ] **Step 2: Escrever os testes de retry e alerta**

Adicionar no mesmo arquivo:
```ts
test('auditLog tenta 3x antes de chamar o alerta', async () => {
  let attempts = 0;
  const alerts: string[] = [];
  const query = async () => { attempts++; throw new Error('db down'); };
  await auditLog({
    query, alert: (msg) => { alerts.push(msg); },
    userId: 1, action: 'login', success: false,
  });
  assert.equal(attempts, 3);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /\[AUDIT-FAIL\]/);
});

test('auditLog aceita campos opcionais como null/undefined', async () => {
  const calls: any[] = [];
  const query = async (_sql: string, params: any[]) => { calls.push(params); return { rows: [] }; };
  await auditLog({ query, action: 'password_set', success: true });
  assert.equal(calls[0][0], null);  // userId
  assert.equal(calls[0][1], null);  // email
  assert.equal(calls[0][3], null);  // meta JSON
  assert.equal(calls[0][4], null);  // ip
});
```

- [ ] **Step 3: Incluir o teste no script `test` do package.json**

Em `package.json`, no script `test`, adicionar `auth/auditLog.test.ts` ao final da lista (separado por espaço).

- [ ] **Step 4: Rodar testes — devem falhar (módulo não existe)**

```bash
npm test
```
Esperado: FAIL com `Cannot find module './auditLog.js'`.

- [ ] **Step 5: Implementar o helper**

Criar `auth/auditLog.ts`:
```ts
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
```

- [ ] **Step 6: Rodar testes — devem passar**

```bash
npm test
```
Esperado: os 3 testes novos PASS (mais os já existentes).

- [ ] **Step 7: Não trocar os call-sites ainda**

O `auditLog` usa a coluna `ip_hash` que só existirá após a Task 4. Os call-sites em `server.ts` serão trocados na Task 5, junto com `hashIp`. Por ora o helper existe mas não é chamado.

- [ ] **Step 8: Commit**

```bash
git add auth/auditLog.ts auth/auditLog.test.ts package.json
git commit -m "feat(audit): helper auditLog com retry e alerta em falha"
```

---

## Task 3: Helper `hashIp` (pseudonimização)

**Decisão:** truncar IPv4 para `/24` e IPv6 para `/48` antes do HMAC. Mantém utilidade analítica (mesma rede ≈ mesma origem para detecção de fraude) sem permitir identificação direta.

**Files:**
- Create: `portal-rede-v1-main/auth/ipHash.ts`
- Create: `portal-rede-v1-main/auth/ipHash.test.ts`
- Modify: `portal-rede-v1-main/package.json` (incluir o novo teste)

- [ ] **Step 1: Escrever os testes**

Criar `auth/ipHash.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashIp } from './ipHash.js';

const SECRET = 'test-secret-32-bytes-min-aaaaaaaaaa';

test('IPv4: hash igual para mesmo /24', () => {
  const a = hashIp('189.45.12.1', SECRET);
  const b = hashIp('189.45.12.99', SECRET);
  assert.equal(a, b);
});

test('IPv4: hash diferente para /24 diferente', () => {
  const a = hashIp('189.45.12.1', SECRET);
  const b = hashIp('189.45.13.1', SECRET);
  assert.notEqual(a, b);
});

test('IPv6: hash igual para mesmo /48', () => {
  const a = hashIp('2804:14d:5cb0:abcd::1', SECRET);
  const b = hashIp('2804:14d:5cb0:ffff::ff', SECRET);
  assert.equal(a, b);
});

test('null/undefined/vazio retornam null', () => {
  assert.equal(hashIp(null, SECRET), null);
  assert.equal(hashIp(undefined, SECRET), null);
  assert.equal(hashIp('', SECRET), null);
});

test('secret vazio lança erro', () => {
  assert.throws(() => hashIp('1.2.3.4', ''), /IP_HASH_SECRET/);
});

test('formato inválido retorna null (não lança)', () => {
  assert.equal(hashIp('not-an-ip', SECRET), null);
});
```

- [ ] **Step 2: Incluir no script `test` e rodar — devem falhar**

Em `package.json`, adicionar `auth/ipHash.test.ts` ao final do script `test`. Rodar:
```bash
npm test
```
Esperado: FAIL (módulo não existe).

- [ ] **Step 3: Implementar o helper**

Criar `auth/ipHash.ts`:
```ts
import { createHmac } from 'node:crypto';

function truncate(ip: string): string | null {
  // IPv6
  if (ip.includes(':')) {
    const parts = ip.split(':');
    if (parts.length < 3) return null;
    return parts.slice(0, 3).join(':') + '::/48';
  }
  // IPv4
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  if (parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

export function hashIp(ip: string | null | undefined, secret: string): string | null {
  if (!secret) throw new Error('IP_HASH_SECRET é obrigatório');
  if (ip == null || ip === '') return null;
  const subnet = truncate(ip);
  if (!subnet) return null;
  return createHmac('sha256', secret).update(subnet).digest('hex');
}
```

- [ ] **Step 4: Rodar testes — devem passar**

```bash
npm test
```
Esperado: 6 testes novos PASS.

- [ ] **Step 5: Commit**

```bash
git add auth/ipHash.ts auth/ipHash.test.ts package.json
git commit -m "feat(lgpd): helper hashIp (HMAC-SHA256 sobre IP truncado /24 ou /48)"
```

---

## Task 4: Migration 0012 — coluna `ip_hash` em `access_logs`

**Files:**
- Create: `portal-rede-v1-main/db/migrations/0012_access_logs_ip_hash.sql`

- [ ] **Step 1: Escrever a migration**

Conteúdo:
```sql
-- 0012_access_logs_ip_hash.sql
-- Adiciona ip_hash (HMAC sobre IP truncado) em access_logs.
-- A coluna ip em claro será removida na 0014, após o backfill (Task 6).

ALTER TABLE access_logs ADD COLUMN IF NOT EXISTS ip_hash TEXT;
CREATE INDEX IF NOT EXISTS access_logs_ip_hash_idx ON access_logs (ip_hash) WHERE ip_hash IS NOT NULL;
```

- [ ] **Step 2: Rodar a migration em dev**

```bash
npm run db:migrate
```
Esperado: log do migrate aplicando `0012_access_logs_ip_hash.sql`.

- [ ] **Step 3: Verificar no Postgres**

```sql
\d access_logs
```
Esperado: coluna `ip_hash text` presente, índice `access_logs_ip_hash_idx` listado.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/0012_access_logs_ip_hash.sql
git commit -m "feat(db): migration 0012 — ip_hash em access_logs"
```

---

## Task 5: Trocar todos os INSERTs de access_logs para `auditLog` + `hashIp`

São 8 call-sites em `server.ts`. Confirmar com:
```bash
grep -n "INSERT INTO access_logs" server.ts
```
Linhas aproximadas: 289 (login), 537 (password_reset_requested), 658 (password_set), 797 (user_invited), 875 (user_role_changed), 882 (user_activated/deactivated), 929 (invite_resent).

**Files:**
- Modify: `portal-rede-v1-main/server.ts` (imports + validação de env + `clientMeta` + 8 call-sites + GET /api/access_logs)
- Modify: `portal-rede-v1-main/.env.example`

- [ ] **Step 1: Imports e validação no boot**

No topo de `server.ts`, junto dos outros `import`:
```ts
import { auditLog } from './auth/auditLog.js';
import { hashIp } from './auth/ipHash.js';
```

Após o bloco que valida `JWT_SECRET` (procurar `JWT_SECRET` no arquivo), adicionar logo abaixo:
```ts
const IP_HASH_SECRET = process.env.IP_HASH_SECRET;
if (!IP_HASH_SECRET || IP_HASH_SECRET.length < 32) {
  throw new Error('IP_HASH_SECRET deve ter pelo menos 32 caracteres');
}
```

- [ ] **Step 2: Atualizar a função `clientMeta`**

Localizar a função `clientMeta(req)` em `server.ts` (perto da linha 287). Trocar:
```ts
const clientMeta = (req: any) => ({ ip: req.ip, userAgent: req.get('user-agent') ?? null });
```
Por:
```ts
const clientMeta = (req: any) => ({
  ipHash: hashIp(req.ip, IP_HASH_SECRET),
  userAgent: req.get('user-agent') ?? null,
});
```

- [ ] **Step 3: Substituir o INSERT do login (linha ~289)**

Trocar:
```ts
const { ip, userAgent } = clientMeta(req);
await query(
  'INSERT INTO access_logs (user_id, email, ip, user_agent, success) VALUES ($1, $2, $3, $4, $5)',
  [userId, email, ip, userAgent, success]
);
```
Por:
```ts
const { ipHash, userAgent } = clientMeta(req);
await auditLog({
  query, userId, email, action: null, success,
  ip: ipHash, meta: { user_agent: userAgent },
});
```

- [ ] **Step 4: Substituir os outros 7 INSERTs (`action ≠ null`)**

Para cada call-site (~537, ~658, ~797, ~875, ~882, ~929):
- O `ip` no INSERT vira `ip: hashIp(req.ip, IP_HASH_SECRET)`
- O `meta` passa a ser objeto JS (sem `JSON.stringify` — o helper faz)
- O `try/catch` com `console.error` é removido onde existir (o helper já cuida)
- `created_at` é gerado pelo helper, então sai do código de chamada

Exemplo `password_reset_requested` (substitui o que ficou da Task 1):
```ts
await auditLog({
  query, action: 'password_reset_requested',
  meta: { exists: !!user },
  ip: hashIp(req.ip, IP_HASH_SECRET),
});
```

Exemplo `user_invited`:
```ts
await auditLog({
  query, userId: req.user.id, action: 'user_invited',
  meta: { invited_email: newUser.email, invited_role: newUser.role },
  ip: hashIp(req.ip, IP_HASH_SECRET),
});
```

Exemplo `user_activated/deactivated` (action condicional):
```ts
await auditLog({
  query, userId: req.user.id,
  action: newActive ? 'user_activated' : 'user_deactivated',
  meta: { target_user_id: targetId },
  ip: hashIp(req.ip, IP_HASH_SECRET),
});
```

- [ ] **Step 5: Atualizar o GET /api/access_logs (admin)**

Localizar o SELECT em `server.ts:735-744`. Trocar `al.ip` por `al.ip_hash AS ip_hash` no SELECT (não devolver mais `ip` em claro):
```ts
const { rows } = await query(
  `SELECT al.id, al.user_id, al.email, al.ip_hash, al.user_agent, al.success, al.action, al.meta, al.created_at,
          u.name AS user_name, u.role AS user_role
     FROM access_logs al
     LEFT JOIN users u ON u.id = al.user_id
     ${whereSql}
     ORDER BY al.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
  params
);
```

Atualizar o frontend que consome este endpoint (procurar por `\\.ip\\b` em `src/pages/Admin*.tsx`) para mostrar `ip_hash` (truncado para os primeiros 8 chars) em vez de `ip`.

- [ ] **Step 6: Atualizar `.env.example`**

Adicionar:
```
# Sal para HMAC dos IPs nos logs (mínimo 32 caracteres). Gere com:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
IP_HASH_SECRET=
```

- [ ] **Step 7: Smoke test manual em dev**

```bash
npm run dev
```
Fazer login com credencial válida e inválida; chamar `/api/auth/forgot-password`; criar usuário pelo admin.

Conferir:
```sql
SELECT id, action, ip, ip_hash, meta FROM access_logs ORDER BY id DESC LIMIT 10;
```
Esperado: novos registros com `ip_hash` preenchido (hex de 64 chars) e `ip` NULL. Registros antigos mantêm `ip` antigo (serão tratados na Task 6).

- [ ] **Step 8: Commit**

```bash
git add server.ts .env.example src/pages/Admin*.tsx
git commit -m "feat(lgpd): grava ip_hash em todos os access_logs via helper auditLog"
```

---

## Task 6: Script de backfill de IPs legados

**Files:**
- Create: `portal-rede-v1-main/db/backfill-ip-hash.ts`
- Modify: `portal-rede-v1-main/package.json` (script `db:backfill-ip-hash`)

- [ ] **Step 1: Escrever o script idempotente**

Criar `db/backfill-ip-hash.ts`:
```ts
import 'dotenv/config';
import { query } from './db.js';
import { hashIp } from '../auth/ipHash.js';

async function main() {
  const secret = process.env.IP_HASH_SECRET;
  if (!secret) throw new Error('IP_HASH_SECRET ausente');

  const BATCH = 500;
  let updated = 0;
  for (;;) {
    const { rows } = await query(
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

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Adicionar script no package.json**

Em `scripts`:
```json
"db:backfill-ip-hash": "tsx db/backfill-ip-hash.ts"
```

- [ ] **Step 3: Rodar em dev**

```bash
npm run db:backfill-ip-hash
```
Esperado: logs `[backfill] N registros…` até concluir.

- [ ] **Step 4: Verificar**

```sql
SELECT COUNT(*) FROM access_logs WHERE ip IS NOT NULL AND ip_hash IS NULL;
```
Esperado: `0`.

- [ ] **Step 5: Commit**

```bash
git add db/backfill-ip-hash.ts package.json
git commit -m "feat(lgpd): script idempotente p/ backfill de ip_hash"
```

---

## Task 7: Migration 0013 — políticas de retenção

**Files:**
- Create: `portal-rede-v1-main/db/migrations/0013_data_retention.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- 0013_data_retention.sql
-- Políticas de retenção por action de access_logs.
-- action = '__login__' representa os registros de login (action IS NULL na tabela).

CREATE TABLE IF NOT EXISTS data_retention_policies (
  action      TEXT PRIMARY KEY,
  ttl_days    INTEGER NOT NULL CHECK (ttl_days > 0),
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO data_retention_policies (action, ttl_days, description) VALUES
  ('__login__',                  180, 'Logs de login (sucesso e falha) — janela de segurança'),
  ('password_reset_requested',   365, 'Pedidos de recuperação de senha'),
  ('password_set',              1825, 'Definição/redefinição de senha (evento administrativo)'),
  ('user_invited',              1825, 'Criação/convite de usuário'),
  ('user_role_changed',         1825, 'Alteração de papel'),
  ('user_activated',            1825, 'Ativação de usuário'),
  ('user_deactivated',          1825, 'Desativação de usuário'),
  ('invite_resent',              365, 'Reenvio de convite')
ON CONFLICT (action) DO NOTHING;

-- Marca de última execução do expurgo (reutiliza tabela settings).
INSERT INTO settings (key, value) VALUES ('data_retention_last_run_at', '1970-01-01T00:00:00Z')
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Rodar a migration**

```bash
npm run db:migrate
```

- [ ] **Step 3: Verificar**

```sql
SELECT COUNT(*) FROM data_retention_policies;
```
Esperado: `8`.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/0013_data_retention.sql
git commit -m "feat(db): migration 0013 — políticas de retenção de access_logs"
```

---

## Task 8: Job `purgeExpiredLogs` + endpoint admin + execução no boot

**Files:**
- Create: `portal-rede-v1-main/db/purgeExpiredLogs.ts`
- Create: `portal-rede-v1-main/db/purgeExpiredLogs.test.ts`
- Modify: `portal-rede-v1-main/server.ts` (endpoint + chamada no boot)
- Modify: `portal-rede-v1-main/.env.example`
- Modify: `portal-rede-v1-main/package.json` (incluir o novo teste)

- [ ] **Step 1: Escrever os testes**

Criar `db/purgeExpiredLogs.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { purgeExpiredLogs } from './purgeExpiredLogs.js';

function fakeDb() {
  const policies = [
    { action: '__login__', ttl_days: 180 },
    { action: 'password_reset_requested', ttl_days: 365 },
  ];
  const deleted: any[] = [];
  const query = async (sql: string, params: any[] = []) => {
    if (/FROM data_retention_policies/.test(sql)) return { rows: policies };
    if (/DELETE FROM access_logs/.test(sql)) {
      deleted.push({ sql, params });
      return { rowCount: params[0] === null ? 3 : 1, rows: [] };
    }
    if (/UPDATE settings/.test(sql)) return { rows: [] };
    return { rows: [] };
  };
  return { query, deleted };
}

test('purgeExpiredLogs aplica cada política e retorna totais', async () => {
  const db = fakeDb();
  const result = await purgeExpiredLogs(db.query);
  assert.equal(db.deleted.length, 2);
  assert.equal(result.totalDeleted, 4);
  assert.equal(result.deletedByAction['__login__'], 3);
  assert.equal(result.deletedByAction['password_reset_requested'], 1);
});

test('purgeExpiredLogs traduz __login__ para action IS NULL', async () => {
  const db = fakeDb();
  await purgeExpiredLogs(db.query);
  const loginCall = db.deleted.find(d => d.params[0] === null);
  assert.ok(loginCall, 'esperava um DELETE com action IS NULL');
  assert.match(loginCall.sql, /action IS NULL/);
});
```

- [ ] **Step 2: Incluir o teste no script `test` e rodar — devem falhar**

Em `package.json`, adicionar `db/purgeExpiredLogs.test.ts` ao final do script `test`. Rodar:
```bash
npm test
```
Esperado: FAIL (módulo não existe).

- [ ] **Step 3: Implementar o helper**

Criar `db/purgeExpiredLogs.ts`:
```ts
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
      ? `DELETE FROM access_logs WHERE action IS NULL AND created_at < now() - ($2::int || ' days')::interval`
      : `DELETE FROM access_logs WHERE action = $1 AND created_at < now() - ($2::int || ' days')::interval`;
    const result = await query(sql, [isLogin ? null : p.action, p.ttl_days]);
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
```

- [ ] **Step 4: Rodar testes — devem passar**

```bash
npm test
```
Esperado: 2 testes novos PASS.

- [ ] **Step 5: Adicionar endpoint admin**

Em `server.ts`, próximo aos outros endpoints `/api/users`:
```ts
import { purgeExpiredLogs } from './db/purgeExpiredLogs.js';

app.post('/api/admin/data-retention/run', requireAuth, requireRole('admin'), async (req: any, res) => {
  try {
    const result = await purgeExpiredLogs(query);
    await auditLog({
      query, userId: req.user.id, action: 'data_retention_run',
      meta: result, ip: hashIp(req.ip, IP_HASH_SECRET),
    });
    res.json(result);
  } catch (err: any) {
    console.error('POST /api/admin/data-retention/run:', err);
    res.status(500).json({ error: 'Falha ao executar expurgo.' });
  }
});
```

(Se os nomes dos middlewares de auth no projeto forem outros, ajustar — procurar por `req.user.role === 'admin'` para encontrar o padrão usado.)

- [ ] **Step 6: Execução oportunista no boot**

No bootstrap de `server.ts` (após `await migrate()` ou equivalente), adicionar:
```ts
if (process.env.RETENTION_AUTO_PURGE !== 'false') {
  try {
    const { rows } = await query("SELECT value FROM settings WHERE key = 'data_retention_last_run_at'");
    const last = rows[0]?.value ? new Date(rows[0].value) : new Date(0);
    const hours = (Date.now() - last.getTime()) / 3_600_000;
    if (hours > 24) {
      purgeExpiredLogs(query)
        .then(r => console.log('[retention] expurgo concluído', r))
        .catch(e => console.error('[retention] falhou', e));
    }
  } catch (e) {
    console.error('[retention] não pôde decidir se deve rodar:', e);
  }
}
```

- [ ] **Step 7: Atualizar `.env.example`**

```
# RETENTION_AUTO_PURGE=false para desabilitar o expurgo oportunista no boot.
RETENTION_AUTO_PURGE=true
```

- [ ] **Step 8: Smoke test manual**

```bash
npm run dev
```
Esperado nos logs: `[retention] expurgo concluído { totalDeleted: 0, ... }` (em base limpa).

Chamar manualmente como admin (após login):
```bash
curl -X POST http://localhost:3000/api/admin/data-retention/run -b cookie.txt
```
Esperado: `200 OK` com JSON `{ totalDeleted, deletedByAction }`.

- [ ] **Step 9: Commit**

```bash
git add db/purgeExpiredLogs.ts db/purgeExpiredLogs.test.ts server.ts .env.example package.json
git commit -m "feat(lgpd): expurgo de access_logs por política (endpoint admin + boot opportunistic)"
```

---

## Task 9: Migration 0014 (drop `ip`) + página `/politica-privacidade` + endpoint DPO

**Files:**
- Create: `portal-rede-v1-main/db/migrations/0014_access_logs_drop_ip.sql`
- Create: `portal-rede-v1-main/src/pages/PoliticaPrivacidade.tsx`
- Modify: `portal-rede-v1-main/server.ts` (endpoint `/api/privacy/dpo`)
- Modify: `portal-rede-v1-main/.env.example`
- Modify: roteador e link no rodapé

- [ ] **Step 1: Migration que dropa `ip` em claro**

Criar `db/migrations/0014_access_logs_drop_ip.sql`:
```sql
-- 0014_access_logs_drop_ip.sql
-- Remove a coluna ip em claro após o backfill (Task 6).
-- ATENÇÃO: só rodar depois que db:backfill-ip-hash terminou com 0 pendências.

ALTER TABLE access_logs DROP COLUMN IF EXISTS ip;
```

Rodar:
```bash
npm run db:migrate
```

- [ ] **Step 2: Endpoint `/api/privacy/dpo`**

Em `server.ts` (próximo a endpoints públicos):
```ts
app.get('/api/privacy/dpo', (_req, res) => {
  res.json({
    name: process.env.DPO_NAME ?? 'A definir',
    email: process.env.DPO_EMAIL ?? null,
  });
});
```

- [ ] **Step 3: Página pública `PoliticaPrivacidade.tsx`**

Criar `src/pages/PoliticaPrivacidade.tsx`:
```tsx
import { useEffect, useState } from 'react';

export default function PoliticaPrivacidade() {
  const [dpo, setDpo] = useState<{ name: string; email: string | null } | null>(null);
  useEffect(() => { fetch('/api/privacy/dpo').then(r => r.json()).then(setDpo); }, []);
  return (
    <main className="mx-auto max-w-3xl p-8 prose prose-slate">
      <h1>Política de Privacidade</h1>
      <p>Esta política descreve como o Portal Integrado da Rede de Prestadores trata dados pessoais, em conformidade com a LGPD (Lei 13.709/2018).</p>

      <h2>Dados que coletamos</h2>
      <ul>
        <li>Nome, e-mail e papel do usuário com acesso ao portal.</li>
        <li>Dados de prestador/cooperado vindos do SGU (CPF/CNPJ, registro de conselho, endereços de atendimento).</li>
        <li>Trilha de acessos pseudonimizada (data, ação, hash do IP truncado).</li>
      </ul>

      <h2>Finalidades e base legal</h2>
      <ul>
        <li><strong>Execução de contrato</strong> — operação do portal de qualificação da rede.</li>
        <li><strong>Cumprimento de obrigação legal</strong> — RN ANS 630/2024 e LGPD.</li>
        <li><strong>Legítimo interesse</strong> — segurança e prevenção a fraude (trilha de acessos).</li>
      </ul>

      <h2>Retenção</h2>
      <p>Logs de login são retidos por até 180 dias; eventos administrativos por até 5 anos. Após o prazo, são expurgados automaticamente.</p>

      <h2>Direitos do titular</h2>
      <p>Para exercer seus direitos (acesso, correção, eliminação, portabilidade), acesse <a href="/meus-dados">Meus dados</a> ou contate o encarregado abaixo.</p>

      <h2>Encarregado pelo Tratamento de Dados (DPO)</h2>
      {dpo ? (
        <p><strong>{dpo.name}</strong>{dpo.email && <> — <a href={`mailto:${dpo.email}`}>{dpo.email}</a></>}</p>
      ) : <p>Carregando…</p>}
    </main>
  );
}
```

- [ ] **Step 4: Registrar a rota e o link no rodapé**

Em `src/App.tsx` (ou onde estão as `<Route>`):
```tsx
<Route path="/politica-privacidade" element={<PoliticaPrivacidade />} />
```
e o import:
```tsx
import PoliticaPrivacidade from './pages/PoliticaPrivacidade';
```

Em `src/components/Footer.tsx` (ou equivalente — procurar onde aparece o footer atual):
```tsx
<a href="/politica-privacidade" className="text-sm text-slate-500 hover:underline">Política de Privacidade</a>
```

- [ ] **Step 5: `.env.example`**

```
DPO_NAME=
DPO_EMAIL=
```

- [ ] **Step 6: Smoke test manual em dev**

```bash
DPO_NAME="Fulano de Tal" DPO_EMAIL="dpo@unimedcriciuma.com.br" npm run dev
```
Abrir `http://localhost:5173/politica-privacidade` (porta do Vite). Esperado: página renderiza, nome do DPO aparece no fim. Link "Política de Privacidade" visível no rodapé das demais páginas.

- [ ] **Step 7: Commit**

```bash
git add db/migrations/0014_access_logs_drop_ip.sql server.ts src/pages/PoliticaPrivacidade.tsx src/App.tsx src/components/Footer.tsx .env.example
git commit -m "feat(lgpd): página /politica-privacidade + endpoint DPO + drop de ip plaintext"
```

---

## Task 10: Tela "Meus dados" + endpoint `/api/me/access-logs`

**Files:**
- Modify: `portal-rede-v1-main/server.ts` (endpoint)
- Create: `portal-rede-v1-main/src/pages/MeusDados.tsx`
- Modify: rota e menu do usuário logado

- [ ] **Step 1: Endpoint do titular**

Em `server.ts`:
```ts
app.get('/api/me/access-logs', requireAuth, async (req: any, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const offset = Math.max(Number(req.query.offset ?? 0), 0);
  const { rows: countRows } = await query(
    'SELECT COUNT(*)::int AS total FROM access_logs WHERE user_id = $1', [req.user.id],
  );
  const { rows } = await query(
    `SELECT id, action, meta, success, created_at
       FROM access_logs
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [req.user.id, limit, offset],
  );
  res.json({ logs: rows, total: countRows[0]?.total ?? 0, limit, offset });
});
```

Observação: a tela do titular **não** expõe `ip_hash` nem `user_agent` (não há finalidade para o próprio titular ver isso; é uso interno de segurança).

- [ ] **Step 2: Tela `MeusDados.tsx`**

Criar `src/pages/MeusDados.tsx`:
```tsx
import { useEffect, useState } from 'react';

interface LogRow { id: number; action: string | null; meta: any; success: boolean; created_at: string; }

const LABELS: Record<string, string> = {
  'null': 'Login',
  'password_reset_requested': 'Recuperação de senha solicitada',
  'password_set': 'Senha definida',
  'user_invited': 'Convite enviado',
  'user_role_changed': 'Papel alterado',
  'user_activated': 'Usuário ativado',
  'user_deactivated': 'Usuário desativado',
  'invite_resent': 'Convite reenviado',
  'data_retention_run': 'Expurgo de retenção',
};

export default function MeusDados() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  useEffect(() => {
    fetch('/api/me/access-logs', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setLogs(d.logs ?? []));
  }, []);
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold mb-4">Meus dados de acesso</h1>
      <p className="text-slate-600 mb-6">Últimos eventos de acesso e administração vinculados à sua conta.</p>
      <table className="w-full text-sm">
        <thead><tr><th className="text-left">Data</th><th className="text-left">Evento</th><th>OK?</th></tr></thead>
        <tbody>
          {logs.map(l => (
            <tr key={l.id} className="border-t">
              <td className="py-2">{new Date(l.created_at).toLocaleString('pt-BR')}</td>
              <td>{LABELS[l.action ?? 'null'] ?? l.action}</td>
              <td className="text-center">{l.success ? '✓' : '✗'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

- [ ] **Step 3: Rota + entrada no menu do usuário**

Em `src/App.tsx`:
```tsx
import MeusDados from './pages/MeusDados';
// ...
<Route path="/meus-dados" element={<RequireAuth><MeusDados /></RequireAuth>} />
```
(Adaptar o wrapper `<RequireAuth>` ao componente real do projeto.)

No menu de usuário (dropdown próximo ao botão "Sair"), adicionar item "Meus dados" apontando para `/meus-dados`.

- [ ] **Step 4: Smoke test manual**

Logar com um usuário comum; navegar para `/meus-dados`. Esperado: tabela com últimos eventos da própria conta (login recente aparece).

- [ ] **Step 5: Commit**

```bash
git add server.ts src/pages/MeusDados.tsx src/App.tsx src/components/UserMenu.tsx
git commit -m "feat(lgpd): tela 'Meus dados' + endpoint /api/me/access-logs"
```

---

## Variáveis de ambiente novas (resumo para dev e homologação)

Antes de subir o conjunto em homologação, definir nos dois ambientes:

| Variável | Obrigatória | Exemplo |
|---|---|---|
| `IP_HASH_SECRET` | sim (≥ 32 chars) | gerar com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DPO_NAME` | sim | `"Fulano de Tal"` |
| `DPO_EMAIL` | sim | `dpo@unimedcriciuma.com.br` |
| `RETENTION_AUTO_PURGE` | não (default `true`) | `false` para desligar expurgo no boot |

⚠️ **`IP_HASH_SECRET` não pode mudar depois sem invalidar o rastreamento histórico.** Tratar como segredo permanente; cada ambiente (dev, homolog) usa o seu próprio sal — não compartilhar.

## Smoke checklist (homologação)

Após push e deploy em homolog:
- [ ] Login funcional (admin + prestador)
- [ ] `SELECT ip_hash, ip FROM access_logs ORDER BY id DESC LIMIT 5;` — só `ip_hash` (coluna `ip` removida)
- [ ] `SELECT * FROM data_retention_policies;` — 8 linhas
- [ ] `POST /api/admin/data-retention/run` retorna 200 com JSON
- [ ] `/politica-privacidade` renderiza com nome do DPO
- [ ] `/meus-dados` lista eventos próprios
- [ ] Logs do servidor mostram `[retention] expurgo concluído` no boot

## Self-review

- **Cobertura dos 6 itens:**
  1. Retenção → Tasks 7–8 ✓
  2. Pseudonimizar IP → Tasks 3–6 ✓
  3. Remover e-mail do meta → Task 1 ✓
  4. Gravação garantida → Task 2 (helper) + Task 5 (uso) ✓
  5. Política + DPO → Task 9 ✓
  6. Endpoint "meus dados" → Task 10 ✓
- **Sem placeholders:** todos os snippets contêm código real, paths reais e comandos exatos.
- **Consistência de tipos:** `auditLog` aceita os mesmos campos em todos os call-sites; `hashIp` é chamado sempre como `hashIp(req.ip, IP_HASH_SECRET)`; `purgeExpiredLogs(query)` assina igual em endpoint e boot.
