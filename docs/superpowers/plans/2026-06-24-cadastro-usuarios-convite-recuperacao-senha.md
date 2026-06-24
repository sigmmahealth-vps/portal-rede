# Cadastro de usuários + convite + esqueci senha — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar UI no Admin pra criar usuários administrativos (admin/auditoria), convite por e-mail com link único de definir senha, e "Esqueci minha senha" para todos os usuários.

**Architecture:** Continuação incremental do 2FA já em produção. Helpers puros novos em `auth/` (testáveis sem DB). SQL inline em `server.ts`. Frontend ganha 2 telas públicas (`/esqueci-senha`, `/definir-senha`), 1 aba nova no Admin, 1 modal. Tokens opacos de uso único guardados como bcrypt-hash em `password_setup_tokens` (mesma forma de `otp_codes`).

**Tech Stack:** Node 20 + Express 4, TypeScript via `tsx`, Postgres (`pg`), `bcryptjs`, `jsonwebtoken`, `cookie-parser`, `resend`, React 19 + react-router-dom 7. Testes: `node:test` + `node:assert/strict`.

**Spec:** [2026-06-24-cadastro-usuarios-convite-recuperacao-senha-design.md](../specs/2026-06-24-cadastro-usuarios-convite-recuperacao-senha-design.md)

---

## Decisões de implementação (refinamentos sobre o spec)

- **Testes automatizados não tocam o banco** (`.env` local aponta para Postgres de produção). Helpers são puros; fluxo end-to-end é validado por smoke manual.
- **Token opaco**: `crypto.randomBytes(32).toString('hex')` → 64 chars. Bcrypt-hash no banco com salt rounds 10 (mesmo do OTP).
- **`password` em `users` passa a aceitar NULL**: usuário convidado fica sem senha até consumir o token. Login bloqueia explicitamente `password IS NULL`.
- **Bloqueio de auto-modificação**: admin não pode desativar a si mesmo nem rebaixar a própria role (evita lockout acidental).
- **Reset deleta `trusted_devices`** do usuário (mitigação contra dispositivo comprometido). Convite (`kind='invite'`) **não** deleta (não havia dispositivos confiáveis ainda).
- **`access_logs.action`** já existe; só novos valores são adicionados (`user_invited`, `password_reset_requested`, etc.). Coluna `meta` (JSONB) também já existe.
- **APP_URL**: usado pra montar link absoluto. Já existe em `.env` (AI Studio injeta, Railway tem).

## Estrutura de arquivos

**Criar:**
- `db/migrations/0010_user_management.sql` — colunas em `users` + tabela `password_setup_tokens`
- `auth/setupToken.ts` + `auth/setupToken.test.ts` — gerar/hash/verify/expirar token
- `auth/passwordPolicy.ts` + `auth/passwordPolicy.test.ts` — validar senha (≥8 + letra + número)
- `src/pages/EsqueciSenha.tsx` — tela pública de pedir reset
- `src/pages/DefinirSenha.tsx` — tela pública de consumir token + definir senha
- `src/pages/admin/UsuariosTab.tsx` — aba "Usuários" com lista + ações
- `src/pages/admin/NovoUsuarioModal.tsx` — modal de criação

**Modificar:**
- `auth/mailer.ts` — adicionar `sendInvite(to, name, link)` e `sendPasswordReset(to, link)` em `Mailer`/`ConsoleMailer`/`ResendMailer`
- `auth/mailer.test.ts` — adicionar 2 testes
- `server.ts` — endpoints novos + bloqueios no login + `last_login_at` no verify-otp
- `src/App.tsx` — rotas `/esqueci-senha` e `/definir-senha`
- `src/pages/Login.tsx` — `<Link to="/esqueci-senha">` no lugar do texto estático
- `src/pages/Admin.tsx` — entry no `TABS` + roteamento pra `<UsuariosTab>`
- `package.json` (`scripts.test`) — adicionar os 2 testes novos

---

## Task 1: Migration 0010 — schema do banco

**Files:**
- Create: `db/migrations/0010_user_management.sql`

- [ ] **Step 1: Criar a migration**

Crie `db/migrations/0010_user_management.sql` com o conteúdo:

```sql
-- 0010_user_management.sql
-- Habilita cadastro de usuários administrativos pela UI + convite + recuperação de senha.

-- 1) users: password passa a aceitar NULL (usuário convidado fica sem senha até consumir o token).
ALTER TABLE users ALTER COLUMN password DROP NOT NULL;

-- 2) users: invite_status — 'pending' (convite ativo), 'accepted' (já definiu senha pelo menos uma vez), 'expired'.
ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_status TEXT NOT NULL DEFAULT 'accepted'
  CHECK (invite_status IN ('pending','accepted','expired'));

-- 3) users: last_login_at — atualizada em todo login bem-sucedido (após verify-otp).
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- 4) password_setup_tokens — tokens opacos de uso único pra convite e reset de senha.
CREATE TABLE IF NOT EXISTS password_setup_tokens (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash         TEXT    NOT NULL,
  kind               TEXT    NOT NULL CHECK (kind IN ('invite','reset')),
  expires_at         TIMESTAMPTZ NOT NULL,
  used_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id INTEGER REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_pst_user_kind_used ON password_setup_tokens (user_id, kind, used_at);
CREATE INDEX IF NOT EXISTS idx_pst_expires        ON password_setup_tokens (expires_at);
```

- [ ] **Step 2: Aplicar a migration em prod**

Run: `npx tsx db/migrate.ts`
Expected: `Applied migration: 0010_user_management.sql` no log.

- [ ] **Step 3: Verificar no banco**

Run:
```bash
npx tsx -e "import 'dotenv/config'; import { Pool } from 'pg'; const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); const r = await p.query(\"SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name IN ('invite_status','last_login_at')\"); console.log(r.rows); await p.end();"
```
Expected: 2 linhas — `invite_status` e `last_login_at`.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/0010_user_management.sql
git commit -m "feat(db): migration 0010 — invite_status, last_login_at e password_setup_tokens"
```

---

## Task 2: Helper `auth/setupToken.ts` (puro)

**Files:**
- Create: `auth/setupToken.ts`
- Create: `auth/setupToken.test.ts`
- Modify: `package.json` (scripts.test)

- [ ] **Step 1: Escrever testes**

Crie `auth/setupToken.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateToken, hashToken, verifyToken, expirationFor, isExpired } from './setupToken.js';

test('generateToken produces 64 hex chars', () => {
  const t = generateToken();
  assert.equal(t.length, 64);
  assert.match(t, /^[0-9a-f]+$/);
});

test('generateToken produces unique tokens', () => {
  const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));
  assert.equal(tokens.size, 100);
});

test('hashToken + verifyToken roundtrip', async () => {
  const plain = generateToken();
  const hash = await hashToken(plain);
  assert.notEqual(hash, plain);
  assert.equal(await verifyToken(plain, hash), true);
  assert.equal(await verifyToken('wrong', hash), false);
});

test('expirationFor(invite) returns 24h ahead', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const exp = expirationFor('invite', now);
  assert.equal(exp.getTime() - now.getTime(), 24 * 60 * 60 * 1000);
});

test('expirationFor(reset) returns 30min ahead', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  const exp = expirationFor('reset', now);
  assert.equal(exp.getTime() - now.getTime(), 30 * 60 * 1000);
});

test('isExpired true when expires_at < now', () => {
  const past = new Date('2025-01-01T00:00:00Z');
  const now  = new Date('2026-01-01T00:00:00Z');
  assert.equal(isExpired(past, now), true);
});

test('isExpired false when expires_at > now', () => {
  const future = new Date('2027-01-01T00:00:00Z');
  const now    = new Date('2026-01-01T00:00:00Z');
  assert.equal(isExpired(future, now), false);
});
```

- [ ] **Step 2: Rodar — deve falhar com módulo inexistente**

Run: `node --import tsx --test auth/setupToken.test.ts`
Expected: erro tipo `Cannot find module './setupToken.js'`.

- [ ] **Step 3: Implementar o helper**

Crie `auth/setupToken.ts`:

```ts
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

export type TokenKind = 'invite' | 'reset';

const EXPIRATION_MS: Record<TokenKind, number> = {
  invite: 24 * 60 * 60 * 1000, // 24h
  reset: 30 * 60 * 1000,       // 30min
};

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function hashToken(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyToken(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function expirationFor(kind: TokenKind, now: Date = new Date()): Date {
  return new Date(now.getTime() + EXPIRATION_MS[kind]);
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() < now.getTime();
}
```

- [ ] **Step 4: Atualizar package.json**

Em `package.json`, no `scripts.test`, adicionar `auth/setupToken.test.ts` à lista:
```json
"test": "node --import tsx --test db/roteiro-parser.test.ts auth/otp.test.ts auth/trustedDevice.test.ts auth/rateLimit.test.ts auth/mailer.test.ts auth/setupToken.test.ts"
```

- [ ] **Step 5: Rodar os testes**

Run: `npm test`
Expected: todos os testes passam, incluindo os 7 novos de `setupToken`.

- [ ] **Step 6: Commit**

```bash
git add auth/setupToken.ts auth/setupToken.test.ts package.json
git commit -m "feat(auth): helper de token opaco (convite/reset) com testes"
```

---

## Task 3: Helper `auth/passwordPolicy.ts` (puro)

**Files:**
- Create: `auth/passwordPolicy.ts`
- Create: `auth/passwordPolicy.test.ts`
- Modify: `package.json` (scripts.test)

- [ ] **Step 1: Escrever testes**

Crie `auth/passwordPolicy.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePassword } from './passwordPolicy.js';

test('valid password (8+ chars, letter, digit)', () => {
  const r = validatePassword('senha1234');
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('too short (< 8)', () => {
  const r = validatePassword('senha12');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('8')));
});

test('only digits', () => {
  const r = validatePassword('12345678');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.toLowerCase().includes('letra')));
});

test('only letters', () => {
  const r = validatePassword('apenasletras');
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.toLowerCase().includes('número') || e.toLowerCase().includes('numero')));
});

test('empty string', () => {
  const r = validatePassword('');
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 2);
});

test('with spaces is allowed (counts as char, not letter/digit)', () => {
  const r = validatePassword('a1      ');
  assert.equal(r.ok, true);
});

test('unicode letters count', () => {
  const r = validatePassword('senhação1');
  assert.equal(r.ok, true);
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `node --import tsx --test auth/passwordPolicy.test.ts`
Expected: erro de módulo inexistente.

- [ ] **Step 3: Implementar**

Crie `auth/passwordPolicy.ts`:

```ts
export interface PasswordValidation {
  ok: boolean;
  errors: string[];
}

const MIN_LENGTH = 8;
const HAS_LETTER = /\p{L}/u;
const HAS_DIGIT = /\d/;

export function validatePassword(pw: string): PasswordValidation {
  const errors: string[] = [];
  if (pw.length < MIN_LENGTH) errors.push(`A senha precisa ter no mínimo ${MIN_LENGTH} caracteres.`);
  if (!HAS_LETTER.test(pw)) errors.push('A senha precisa conter pelo menos uma letra.');
  if (!HAS_DIGIT.test(pw)) errors.push('A senha precisa conter pelo menos um número.');
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Atualizar package.json**

Adicionar `auth/passwordPolicy.test.ts` ao `scripts.test`:
```json
"test": "node --import tsx --test db/roteiro-parser.test.ts auth/otp.test.ts auth/trustedDevice.test.ts auth/rateLimit.test.ts auth/mailer.test.ts auth/setupToken.test.ts auth/passwordPolicy.test.ts"
```

- [ ] **Step 5: Rodar e verificar**

Run: `npm test`
Expected: todos passam, incluindo os 7 novos.

- [ ] **Step 6: Commit**

```bash
git add auth/passwordPolicy.ts auth/passwordPolicy.test.ts package.json
git commit -m "feat(auth): regra de senha (>=8 + letra + número) com testes"
```

---

## Task 4: Mailer — sendInvite + sendPasswordReset

**Files:**
- Modify: `auth/mailer.ts`
- Modify: `auth/mailer.test.ts`

- [ ] **Step 1: Atualizar testes**

Em `auth/mailer.test.ts`, adicionar ao final do arquivo:

```ts
test('ConsoleMailer.sendInvite logs name + link', async () => {
  const logs: string[] = [];
  const m = new ConsoleMailer((msg) => logs.push(msg));
  await m.sendInvite('user@unimed.com', 'Maria', 'https://portal/definir-senha?token=ABC');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Maria/);
  assert.match(logs[0], /https:\/\/portal\/definir-senha\?token=ABC/);
});

test('ConsoleMailer.sendPasswordReset logs link', async () => {
  const logs: string[] = [];
  const m = new ConsoleMailer((msg) => logs.push(msg));
  await m.sendPasswordReset('user@unimed.com', 'https://portal/definir-senha?token=XYZ');
  assert.equal(logs.length, 1);
  assert.match(logs[0], /https:\/\/portal\/definir-senha\?token=XYZ/);
});
```

- [ ] **Step 2: Estender a interface e os mailers**

Substituir o conteúdo de `auth/mailer.ts` por:

```ts
import { Resend } from 'resend';

export interface Mailer {
  sendOtp(to: string, code: string): Promise<void>;
  sendInvite(to: string, name: string, link: string): Promise<void>;
  sendPasswordReset(to: string, link: string): Promise<void>;
}

const OTP_SUBJECT = (code: string) => `Seu código de acesso ao Portal Unimed: ${code}`;
const OTP_BODY = (code: string) =>
  `Seu código de acesso é ${code}.\n\n` +
  `Ele vale por 10 minutos e só pode ser usado uma vez.\n` +
  `Se você não tentou entrar no Portal Unimed, ignore este e-mail.`;

const INVITE_SUBJECT = 'Bem-vindo ao Portal Unimed Criciúma';
const INVITE_BODY = (name: string, link: string) =>
  `Olá, ${name}!\n\n` +
  `Sua conta foi criada no Portal Unimed Criciúma. Para começar, defina sua senha:\n\n` +
  `${link}\n\n` +
  `Este link vale por 24 horas e só pode ser usado uma vez.\n` +
  `Se você não esperava este convite, ignore este e-mail.`;

const RESET_SUBJECT = 'Redefinição de senha — Portal Unimed';
const RESET_BODY = (link: string) =>
  `Recebemos uma solicitação para redefinir sua senha. Clique no link abaixo:\n\n` +
  `${link}\n\n` +
  `Este link vale por 30 minutos e só pode ser usado uma vez.\n` +
  `Se você não solicitou, ignore este e-mail e sua senha continuará a mesma.`;

export class ConsoleMailer implements Mailer {
  constructor(private readonly log: (msg: string) => void = console.log) {}
  async sendOtp(to: string, code: string): Promise<void> {
    this.log(`[ConsoleMailer] Para: ${to} | ${OTP_SUBJECT(code)}`);
  }
  async sendInvite(to: string, name: string, link: string): Promise<void> {
    this.log(`[ConsoleMailer] Para: ${to} | ${INVITE_SUBJECT} | ${name} | ${link}`);
  }
  async sendPasswordReset(to: string, link: string): Promise<void> {
    this.log(`[ConsoleMailer] Para: ${to} | ${RESET_SUBJECT} | ${link}`);
  }
}

export class ResendMailer implements Mailer {
  private readonly client: Resend;
  constructor(apiKey: string, private readonly from: string) {
    this.client = new Resend(apiKey);
  }
  private async send(to: string, subject: string, text: string): Promise<void> {
    const { error } = await this.client.emails.send({ from: this.from, to, subject, text });
    if (error) throw new Error(`Falha ao enviar e-mail: ${error.message ?? error}`);
  }
  async sendOtp(to: string, code: string): Promise<void> {
    await this.send(to, OTP_SUBJECT(code), OTP_BODY(code));
  }
  async sendInvite(to: string, name: string, link: string): Promise<void> {
    await this.send(to, INVITE_SUBJECT, INVITE_BODY(name, link));
  }
  async sendPasswordReset(to: string, link: string): Promise<void> {
    await this.send(to, RESET_SUBJECT, RESET_BODY(link));
  }
}

export function createMailer(): Mailer {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (apiKey && from) return new ResendMailer(apiKey, from);
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: RESEND_API_KEY/MAIL_FROM ausentes em produção. Abortando boot.');
    process.exit(1);
  }
  console.warn('[mailer] RESEND_API_KEY ausente — usando ConsoleMailer (apenas dev).');
  return new ConsoleMailer();
}
```

- [ ] **Step 3: Rodar testes**

Run: `npm test`
Expected: todos passam, incluindo os 2 novos.

- [ ] **Step 4: Commit**

```bash
git add auth/mailer.ts auth/mailer.test.ts
git commit -m "feat(auth): mailer com sendInvite e sendPasswordReset"
```

---

## Task 5: server.ts — bloqueios no login + last_login_at no verify-otp

**Files:**
- Modify: `server.ts` (route `/api/auth/login` e `/api/auth/verify-otp`)

- [ ] **Step 1: Bloqueio em /api/auth/login quando password IS NULL ou is_active = false**

Localize o handler `app.post('/api/auth/login', ...)` (linha ~358). Após o `SELECT * FROM users WHERE email = $1`, antes da comparação `bcrypt.compare`, adicione:

```ts
const user = userRows[0];
if (!user) {
  return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
}
if (user.is_active === false) {
  return res.status(403).json({ error: 'Sua conta está inativa. Procure o administrador.' });
}
if (!user.password) {
  return res.status(403).json({ error: 'Sua conta ainda não foi ativada. Verifique seu e-mail.' });
}
```

Mantenha o restante do handler (bcrypt.compare, criação do OTP, etc.) como está.

- [ ] **Step 2: Atualizar last_login_at em /api/auth/verify-otp**

Localize o handler `app.post('/api/auth/verify-otp', ...)` (linha ~395). Após emissão bem-sucedida do cookie de sessão (logo após `res.cookie('session', ...)`), adicione:

```ts
await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
```

- [ ] **Step 3: Smoke rápido — backend não pode quebrar**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "feat(auth): bloqueia login para inativos/sem-senha + grava last_login_at"
```

---

## Task 6: server.ts — POST e GET /api/users

**Files:**
- Modify: `server.ts` (novos handlers, próximo aos demais endpoints)

- [ ] **Step 1: Adicionar guard `requireAdmin`**

Logo após o middleware `authenticate` (linha ~258), adicione:

```ts
const requireAdmin = (req: any, res: any, next: any) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores.' });
  next();
};
```

- [ ] **Step 2: Importar helpers e o mailer compartilhado**

No topo do arquivo (junto dos outros imports do `auth/`), adicione:

```ts
import { generateToken, hashToken, expirationFor } from './auth/setupToken.js';
```

(O `mailer` já é instanciado via `createMailer()` em uma constante perto do `startServer` — se ainda não há, criar `const mailer = createMailer()` perto do topo do `startServer`.)

- [ ] **Step 3: Implementar POST /api/users**

Adicionar (próximo aos outros endpoints administrativos, ex: depois de `/api/access-logs`):

```ts
app.post('/api/users', authenticate, requireAdmin, async (req: any, res) => {
  try {
    const { name, email, role } = req.body ?? {};

    if (typeof name !== 'string' || name.trim().length < 2 || name.length > 100) {
      return res.status(400).json({ error: 'Nome inválido (2 a 100 caracteres).' });
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'E-mail inválido.' });
    }
    if (role !== 'admin' && role !== 'auditoria') {
      return res.status(403).json({ error: 'Esta UI só cria usuários admin ou auditoria.' });
    }

    const emailLc = email.trim().toLowerCase();
    const dup = await query('SELECT id FROM users WHERE LOWER(email) = $1', [emailLc]);
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe um usuário com este e-mail.' });
    }

    const ins = await query(
      `INSERT INTO users (name, email, password, role, provider_id, is_active, invite_status)
       VALUES ($1, $2, NULL, $3, NULL, true, 'pending')
       RETURNING id, name, email, role, is_active, invite_status`,
      [name.trim(), emailLc, role]
    );
    const newUser = ins.rows[0];

    const token = generateToken();
    const tokenHash = await hashToken(token);
    const expiresAt = expirationFor('invite');
    await query(
      `INSERT INTO password_setup_tokens (user_id, token_hash, kind, expires_at, created_by_user_id)
       VALUES ($1, $2, 'invite', $3, $4)`,
      [newUser.id, tokenHash, expiresAt, req.user.id]
    );

    const appUrl = process.env.APP_URL ?? `${req.protocol}://${req.get('host')}`;
    const link = `${appUrl}/definir-senha?token=${token}`;
    await mailer.sendInvite(newUser.email, newUser.name, link);

    await query(
      `INSERT INTO access_logs (user_id, action, meta, ip, success, created_at)
       VALUES ($1, 'user_invited', $2, $3, true, now())`,
      [req.user.id, JSON.stringify({ invited_email: newUser.email, invited_role: newUser.role }), req.ip]
    );

    res.status(201).json(newUser);
  } catch (err: any) {
    console.error('POST /api/users:', err);
    res.status(500).json({ error: 'Falha ao criar usuário.' });
  }
});
```

- [ ] **Step 4: Implementar GET /api/users**

Adicionar logo após o POST:

```ts
app.get('/api/users', authenticate, requireAdmin, async (_req: any, res) => {
  try {
    const { rows } = await query(
      `SELECT id, name, email, role, is_active, invite_status, last_login_at, created_at
       FROM users
       ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err: any) {
    console.error('GET /api/users:', err);
    res.status(500).json({ error: 'Falha ao listar usuários.' });
  }
});
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add server.ts
git commit -m "feat(users): POST + GET /api/users com convite por e-mail"
```

---

## Task 7: server.ts — PATCH + resend-invite

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: Implementar PATCH /api/users/:id**

Adicionar (próximo aos outros user endpoints):

```ts
app.patch('/api/users/:id', authenticate, requireAdmin, async (req: any, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'ID inválido.' });

    const { rows: targetRows } = await query('SELECT id, role, is_active FROM users WHERE id = $1', [targetId]);
    const target = targetRows[0];
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const { role: newRole, is_active: newActive } = req.body ?? {};

    if (typeof newRole !== 'undefined') {
      if (newRole !== 'admin' && newRole !== 'auditoria' && newRole !== 'prestador' && newRole !== 'cooperado') {
        return res.status(400).json({ error: 'Role inválida.' });
      }
      if (targetId === req.user.id && target.role === 'admin' && newRole !== 'admin') {
        return res.status(400).json({ error: 'Você não pode rebaixar a própria conta.' });
      }
    }

    if (typeof newActive !== 'undefined') {
      if (typeof newActive !== 'boolean') return res.status(400).json({ error: 'is_active deve ser booleano.' });
      if (targetId === req.user.id && newActive === false) {
        return res.status(400).json({ error: 'Você não pode desativar a própria conta.' });
      }
    }

    const updates: string[] = [];
    const params: any[] = [];
    if (typeof newRole !== 'undefined' && newRole !== target.role) {
      params.push(newRole);
      updates.push(`role = $${params.length}`);
    }
    if (typeof newActive !== 'undefined' && newActive !== target.is_active) {
      params.push(newActive);
      updates.push(`is_active = $${params.length}`);
    }

    if (updates.length === 0) {
      const { rows } = await query('SELECT id, name, email, role, is_active, invite_status, last_login_at FROM users WHERE id = $1', [targetId]);
      return res.json(rows[0]);
    }

    params.push(targetId);
    const { rows } = await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length}
       RETURNING id, name, email, role, is_active, invite_status, last_login_at`,
      params
    );

    if (typeof newRole !== 'undefined' && newRole !== target.role) {
      await query(
        `INSERT INTO access_logs (user_id, action, meta, ip, success, created_at)
         VALUES ($1, 'user_role_changed', $2, $3, true, now())`,
        [req.user.id, JSON.stringify({ target_user_id: targetId, from: target.role, to: newRole }), req.ip]
      );
    }
    if (typeof newActive !== 'undefined' && newActive !== target.is_active) {
      await query(
        `INSERT INTO access_logs (user_id, action, meta, ip, success, created_at)
         VALUES ($1, $2, $3, $4, true, now())`,
        [req.user.id, newActive ? 'user_activated' : 'user_deactivated', JSON.stringify({ target_user_id: targetId }), req.ip]
      );
    }

    res.json(rows[0]);
  } catch (err: any) {
    console.error('PATCH /api/users/:id:', err);
    res.status(500).json({ error: 'Falha ao atualizar usuário.' });
  }
});
```

- [ ] **Step 2: Implementar POST /api/users/:id/resend-invite**

Adicionar:

```ts
app.post('/api/users/:id/resend-invite', authenticate, requireAdmin, async (req: any, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'ID inválido.' });

    const { rows: targetRows } = await query('SELECT id, name, email, invite_status FROM users WHERE id = $1', [targetId]);
    const target = targetRows[0];
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (target.invite_status === 'accepted') {
      return res.status(409).json({ error: 'Usuário já definiu senha. Oriente-o a usar "Esqueci minha senha".' });
    }

    await query(
      `UPDATE password_setup_tokens SET used_at = now()
       WHERE user_id = $1 AND kind = 'invite' AND used_at IS NULL`,
      [targetId]
    );

    const token = generateToken();
    const tokenHash = await hashToken(token);
    const expiresAt = expirationFor('invite');
    await query(
      `INSERT INTO password_setup_tokens (user_id, token_hash, kind, expires_at, created_by_user_id)
       VALUES ($1, $2, 'invite', $3, $4)`,
      [targetId, tokenHash, expiresAt, req.user.id]
    );

    await query(`UPDATE users SET invite_status = 'pending' WHERE id = $1`, [targetId]);

    const appUrl = process.env.APP_URL ?? `${req.protocol}://${req.get('host')}`;
    const link = `${appUrl}/definir-senha?token=${token}`;
    await mailer.sendInvite(target.email, target.name, link);

    await query(
      `INSERT INTO access_logs (user_id, action, meta, ip, success, created_at)
       VALUES ($1, 'invite_resent', $2, $3, true, now())`,
      [req.user.id, JSON.stringify({ target_user_id: targetId }), req.ip]
    );

    res.json({ ok: true });
  } catch (err: any) {
    console.error('POST /api/users/:id/resend-invite:', err);
    res.status(500).json({ error: 'Falha ao reenviar convite.' });
  }
});
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "feat(users): PATCH /api/users/:id e POST /resend-invite"
```

---

## Task 8: server.ts — /api/auth/forgot-password

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: Confirmar import de checkRateLimit**

Confirme que `server.ts` já importa `checkRateLimit` de `./auth/rateLimit.js` (usado pelo OTP). Se não, adicionar.

- [ ] **Step 2: Implementar /api/auth/forgot-password**

Adicionar (próximo aos outros `/api/auth/*`):

```ts
app.post('/api/auth/forgot-password', async (req: any, res) => {
  try {
    const { email } = req.body ?? {};
    if (typeof email !== 'string') return res.json({ ok: true });

    const emailLc = email.trim().toLowerCase();

    const ipOk = await checkRateLimit('', req.ip ?? '', 'password_reset_requested', 60, 10);
    const emailOk = await checkRateLimit(emailLc, '', 'password_reset_requested', 60, 5);
    if (!ipOk || !emailOk) return res.json({ ok: true });

    const { rows } = await query('SELECT id, email FROM users WHERE LOWER(email) = $1 AND is_active = true', [emailLc]);
    const user = rows[0];

    await query(
      `INSERT INTO access_logs (user_id, action, meta, ip, success, created_at)
       VALUES (NULL, 'password_reset_requested', $1, $2, true, now())`,
      [JSON.stringify({ email: emailLc, exists: !!user }), req.ip]
    );

    if (!user) return res.json({ ok: true });

    await query(
      `UPDATE password_setup_tokens SET used_at = now()
       WHERE user_id = $1 AND kind = 'reset' AND used_at IS NULL`,
      [user.id]
    );

    const token = generateToken();
    const tokenHash = await hashToken(token);
    const expiresAt = expirationFor('reset');
    await query(
      `INSERT INTO password_setup_tokens (user_id, token_hash, kind, expires_at)
       VALUES ($1, $2, 'reset', $3)`,
      [user.id, tokenHash, expiresAt]
    );

    const appUrl = process.env.APP_URL ?? `${req.protocol}://${req.get('host')}`;
    const link = `${appUrl}/definir-senha?token=${token}`;
    await mailer.sendPasswordReset(user.email, link);

    res.json({ ok: true });
  } catch (err: any) {
    console.error('POST /api/auth/forgot-password:', err);
    res.json({ ok: true });
  }
});
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "feat(auth): /api/auth/forgot-password com rate-limit"
```

---

## Task 9: server.ts — validate-setup-token + redeem-token

**Files:**
- Modify: `server.ts`

- [ ] **Step 1: Estender import de setupToken**

No topo do `server.ts`, garantir:
```ts
import { generateToken, hashToken, verifyToken, expirationFor } from './auth/setupToken.js';
import { validatePassword } from './auth/passwordPolicy.js';
```

- [ ] **Step 2: Implementar GET /api/auth/validate-setup-token**

Adicionar:

```ts
app.get('/api/auth/validate-setup-token', async (req: any, res) => {
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!/^[0-9a-f]{64}$/.test(token)) {
      return res.json({ valid: false, reason: 'unknown' });
    }

    const { rows } = await query(
      `SELECT t.id, t.user_id, t.kind, t.expires_at, t.used_at, t.token_hash, u.name
       FROM password_setup_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.kind IN ('invite','reset') AND t.used_at IS NULL AND t.expires_at > now()`
    );

    for (const row of rows) {
      if (await verifyToken(token, row.token_hash)) {
        return res.json({ valid: true, kind: row.kind, name: row.name });
      }
    }
    return res.json({ valid: false, reason: 'expired' });
  } catch (err: any) {
    console.error('GET /api/auth/validate-setup-token:', err);
    res.json({ valid: false, reason: 'unknown' });
  }
});
```

- [ ] **Step 3: Implementar POST /api/auth/redeem-token**

Adicionar:

```ts
app.post('/api/auth/redeem-token', async (req: any, res) => {
  try {
    const { token, new_password } = req.body ?? {};

    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
      return res.status(400).json({ error: 'Link inválido.' });
    }
    if (typeof new_password !== 'string') {
      return res.status(400).json({ error: 'Senha obrigatória.' });
    }

    const ipOk = await checkRateLimit('', req.ip ?? '', 'redeem_token', 60, 10);
    if (!ipOk) return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em 1 hora.' });

    const policy = validatePassword(new_password);
    if (!policy.ok) return res.status(400).json({ error: policy.errors.join(' ') });

    const { rows } = await query(
      `SELECT t.id, t.user_id, t.kind, t.token_hash
       FROM password_setup_tokens t
       WHERE t.kind IN ('invite','reset') AND t.used_at IS NULL AND t.expires_at > now()`
    );

    let matched: any = null;
    for (const row of rows) {
      if (await verifyToken(token, row.token_hash)) {
        matched = row;
        break;
      }
    }
    if (!matched) return res.status(400).json({ error: 'Link inválido ou expirado.' });

    const pwHash = await bcrypt.hash(new_password, 10);

    await query('BEGIN');
    try {
      await query(`UPDATE password_setup_tokens SET used_at = now() WHERE id = $1`, [matched.id]);
      await query(
        `UPDATE users SET password = $1, invite_status = 'accepted' WHERE id = $2`,
        [pwHash, matched.user_id]
      );
      if (matched.kind === 'reset') {
        await query(`DELETE FROM trusted_devices WHERE user_id = $1`, [matched.user_id]);
      }
      await query('COMMIT');
    } catch (txErr) {
      await query('ROLLBACK');
      throw txErr;
    }

    await query(
      `INSERT INTO access_logs (user_id, action, meta, ip, success, created_at)
       VALUES ($1, 'password_set', $2, $3, true, now())`,
      [matched.user_id, JSON.stringify({ kind: matched.kind }), req.ip]
    );

    res.json({ ok: true });
  } catch (err: any) {
    console.error('POST /api/auth/redeem-token:', err);
    res.status(500).json({ error: 'Falha ao definir senha.' });
  }
});
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add server.ts
git commit -m "feat(auth): validate-setup-token + redeem-token"
```

---

## Task 10: Frontend — telas públicas + rotas

**Files:**
- Create: `src/pages/EsqueciSenha.tsx`
- Create: `src/pages/DefinirSenha.tsx`
- Modify: `src/App.tsx`
- Modify: `src/pages/Login.tsx`

- [ ] **Step 1: Criar EsqueciSenha.tsx**

Crie `src/pages/EsqueciSenha.tsx`:

```tsx
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchApi } from '../lib/api';

export default function EsqueciSenha() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await fetchApi('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
    } catch { /* sempre 200, mas defensivo */ }
    setSent(true);
    setLoading(false);
    setTimeout(() => navigate('/login'), 4000);
  };

  return (
    <div className="min-h-screen bg-emerald-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-emerald-700 mb-2">Esqueceu sua senha?</h1>
        <p className="text-sm text-gray-500 mb-6">Digite seu e-mail e enviaremos um link para redefinir.</p>

        {sent ? (
          <div className="bg-emerald-50 text-emerald-800 p-4 rounded-md text-sm">
            Se o e-mail existir no sistema, você receberá instruções em alguns minutos. Verifique sua caixa de entrada (e o Spam).
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 text-white p-3 rounded-md font-medium hover:bg-emerald-700 disabled:bg-gray-300"
            >
              {loading ? 'Enviando...' : 'Enviar link'}
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <Link to="/login" className="text-sm text-emerald-700 hover:underline">← Voltar para o login</Link>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Criar DefinirSenha.tsx**

Crie `src/pages/DefinirSenha.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchApi } from '../lib/api';

interface TokenInfo {
  valid: boolean;
  kind?: 'invite' | 'reset';
  name?: string;
  reason?: 'expired' | 'consumed' | 'unknown';
}

const checks = (pw: string) => ({
  length: pw.length >= 8,
  letter: /\p{L}/u.test(pw),
  digit: /\d/.test(pw),
});

export default function DefinirSenha() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();

  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchApi(`/auth/validate-setup-token?token=${encodeURIComponent(token)}`)
      .then(setInfo)
      .catch(() => setInfo({ valid: false, reason: 'unknown' }));
  }, [token]);

  const c = checks(pw);
  const allOk = c.length && c.letter && c.digit && pw === pw2;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (pw !== pw2) return setError('As senhas não coincidem.');
    setSubmitting(true);
    try {
      await fetchApi('/auth/redeem-token', { method: 'POST', body: JSON.stringify({ token, new_password: pw }) });
      navigate('/login?message=password_set');
    } catch (err: any) {
      setError(err.message ?? 'Falha ao definir senha.');
      setSubmitting(false);
    }
  };

  if (info === null) {
    return <div className="min-h-screen bg-emerald-50 flex items-center justify-center"><p className="text-gray-500">Validando link...</p></div>;
  }

  if (!info.valid) {
    const reasonMsg = info.reason === 'expired' ? 'Este link expirou.'
      : info.reason === 'consumed' ? 'Este link já foi utilizado.'
      : 'Link inválido.';
    return (
      <div className="min-h-screen bg-emerald-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center">
          <h1 className="text-xl font-bold text-red-600 mb-3">{reasonMsg}</h1>
          <p className="text-sm text-gray-500 mb-6">Solicite um novo link para continuar.</p>
          <Link to="/esqueci-senha" className="inline-block bg-emerald-600 text-white px-6 py-3 rounded-md font-medium hover:bg-emerald-700">Solicitar novo link</Link>
        </div>
      </div>
    );
  }

  const isInvite = info.kind === 'invite';
  return (
    <div className="min-h-screen bg-emerald-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold text-emerald-700 mb-2">
          {isInvite ? `Bem-vindo, ${info.name}!` : 'Redefinir senha'}
        </h1>
        <p className="text-sm text-gray-500 mb-6">
          {isInvite ? 'Defina sua senha para acessar o Portal Unimed.' : 'Escolha sua nova senha.'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nova senha</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar senha</label>
            <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-500" />
          </div>
          <ul className="text-xs space-y-1">
            <li className={c.length ? 'text-emerald-700' : 'text-gray-400'}>{c.length ? '✓' : '○'} Mínimo 8 caracteres</li>
            <li className={c.letter ? 'text-emerald-700' : 'text-gray-400'}>{c.letter ? '✓' : '○'} Pelo menos 1 letra</li>
            <li className={c.digit ? 'text-emerald-700' : 'text-gray-400'}>{c.digit ? '✓' : '○'} Pelo menos 1 número</li>
          </ul>
          {error && <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm">{error}</div>}
          <button type="submit" disabled={!allOk || submitting}
            className="w-full bg-emerald-600 text-white p-3 rounded-md font-medium hover:bg-emerald-700 disabled:bg-gray-300">
            {submitting ? 'Salvando...' : (isInvite ? 'Definir senha' : 'Redefinir senha')}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Atualizar App.tsx**

Em `src/App.tsx`, adicionar imports e rotas:

```tsx
import EsqueciSenha from './pages/EsqueciSenha';
import DefinirSenha from './pages/DefinirSenha';
```

Dentro de `<Routes>` (no nível de `/login`, fora do `<Layout>`):
```tsx
<Route path="/esqueci-senha" element={<EsqueciSenha />} />
<Route path="/definir-senha" element={<DefinirSenha />} />
```

- [ ] **Step 4: Atualizar Login.tsx — link "Esqueceu sua senha?"**

Em `src/pages/Login.tsx`, localize o texto "Esqueceu sua senha?" e substitua por:
```tsx
<Link to="/esqueci-senha" className="text-xs text-emerald-700 hover:underline">Esqueceu sua senha?</Link>
```
Adicionar import `import { Link } from 'react-router-dom';` se ainda não existir.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/pages/EsqueciSenha.tsx src/pages/DefinirSenha.tsx src/App.tsx src/pages/Login.tsx
git commit -m "feat(auth): telas públicas /esqueci-senha e /definir-senha + link no Login"
```

---

## Task 11: Frontend — UsuariosTab + NovoUsuarioModal + integração no Admin

**Files:**
- Create: `src/pages/admin/NovoUsuarioModal.tsx`
- Create: `src/pages/admin/UsuariosTab.tsx`
- Modify: `src/pages/Admin.tsx`

- [ ] **Step 1: Criar NovoUsuarioModal.tsx**

Crie `src/pages/admin/NovoUsuarioModal.tsx`:

```tsx
import { useState } from 'react';
import { X } from 'lucide-react';
import { fetchApi } from '../../lib/api';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export default function NovoUsuarioModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'auditoria'>('auditoria');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await fetchApi('/users', { method: 'POST', body: JSON.stringify({ name: name.trim(), email: email.trim(), role }) });
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'Falha ao criar usuário.');
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-900">Novo usuário</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome completo</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={100}
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              className="w-full p-3 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Função</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input type="radio" checked={role === 'auditoria'} onChange={() => setRole('auditoria')} />
                <span>Auditoria</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={role === 'admin'} onChange={() => setRole('admin')} />
                <span>Admin</span>
              </label>
            </div>
          </div>
          <p className="text-xs text-gray-500">O usuário receberá um e-mail com link para definir a senha (válido por 24 horas).</p>
          {error && <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm">{error}</div>}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={submitting} className="px-4 py-2 bg-emerald-600 text-white rounded-md font-medium hover:bg-emerald-700 disabled:bg-gray-300">
              {submitting ? 'Criando...' : 'Criar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Criar UsuariosTab.tsx**

Crie `src/pages/admin/UsuariosTab.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Plus, Search, MoreVertical } from 'lucide-react';
import { fetchApi } from '../../lib/api';
import NovoUsuarioModal from './NovoUsuarioModal';

interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'auditoria' | 'prestador' | 'cooperado';
  is_active: boolean;
  invite_status: 'pending' | 'accepted' | 'expired';
  last_login_at: string | null;
}

const STATUS_BADGE = (u: User) => {
  if (!u.is_active) return { label: 'Inativo', color: 'bg-red-100 text-red-700' };
  if (u.invite_status === 'pending') return { label: 'Pendente', color: 'bg-amber-100 text-amber-800' };
  if (u.invite_status === 'expired') return { label: 'Expirado', color: 'bg-gray-200 text-gray-600' };
  return { label: 'Ativo', color: 'bg-emerald-100 text-emerald-700' };
};

export default function UsuariosTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openModal, setOpenModal] = useState(false);
  const [menuOpenFor, setMenuOpenFor] = useState<number | null>(null);

  const load = () => {
    setLoading(true);
    fetchApi('/users').then(setUsers).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
  });

  const patch = async (id: number, body: Partial<{ role: User['role']; is_active: boolean }>) => {
    setMenuOpenFor(null);
    try {
      await fetchApi(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      load();
    } catch (e: any) { setError(e.message); }
  };

  const resend = async (id: number) => {
    setMenuOpenFor(null);
    try {
      await fetchApi(`/users/${id}/resend-invite`, { method: 'POST' });
      load();
    } catch (e: any) { setError(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nome ou e-mail..."
            className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-emerald-500" />
        </div>
        <button onClick={() => setOpenModal(true)} className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-md font-medium hover:bg-emerald-700">
          <Plus className="h-4 w-4" /> Novo usuário
        </button>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm">{error}</div>}

      {loading ? (
        <p className="text-gray-500">Carregando...</p>
      ) : (
        <table className="w-full bg-white rounded-xl overflow-hidden border border-gray-100">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="text-left p-3">Nome</th>
              <th className="text-left p-3">E-mail</th>
              <th className="text-left p-3">Função</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Último acesso</th>
              <th className="p-3 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => {
              const s = STATUS_BADGE(u);
              return (
                <tr key={u.id} className="border-t border-gray-100">
                  <td className="p-3 font-medium text-gray-900">{u.name}</td>
                  <td className="p-3 text-gray-700">{u.email}</td>
                  <td className="p-3 capitalize">{u.role}</td>
                  <td className="p-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${s.color}`}>{s.label}</span></td>
                  <td className="p-3 text-gray-500 text-sm">{u.last_login_at ? new Date(u.last_login_at).toLocaleString('pt-BR') : '—'}</td>
                  <td className="p-3 relative">
                    <button onClick={() => setMenuOpenFor(menuOpenFor === u.id ? null : u.id)} className="text-gray-400 hover:text-gray-700"><MoreVertical /></button>
                    {menuOpenFor === u.id && (
                      <div className="absolute right-0 top-10 z-20 bg-white border border-gray-200 rounded-md shadow-lg py-1 w-56">
                        {(u.role === 'admin' || u.role === 'auditoria') && (
                          <button onClick={() => patch(u.id, { role: u.role === 'admin' ? 'auditoria' : 'admin' })}
                            className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                            Mudar role para {u.role === 'admin' ? 'auditoria' : 'admin'}
                          </button>
                        )}
                        <button onClick={() => patch(u.id, { is_active: !u.is_active })}
                          className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                          {u.is_active ? 'Desativar' : 'Reativar'}
                        </button>
                        {(u.invite_status === 'pending' || u.invite_status === 'expired') && (
                          <button onClick={() => resend(u.id)}
                            className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                            Reenviar convite
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-gray-500">Nenhum usuário encontrado.</td></tr>
            )}
          </tbody>
        </table>
      )}

      {openModal && <NovoUsuarioModal onClose={() => setOpenModal(false)} onCreated={load} />}
    </div>
  );
}
```

- [ ] **Step 3: Integrar aba em Admin.tsx**

Em `src/pages/Admin.tsx`:

1. Import no topo:
```tsx
import UsuariosTab from './admin/UsuariosTab';
```

2. No array `TABS` (linha ~33), adicionar entry **antes** de `'acessos'`:
```tsx
{ id: 'usuarios', label: 'Usuários', icon: UserPlus },
```

3. Na seção JSX que renderiza o conteúdo de cada aba, adicionar bloco:
```tsx
{activeTab === 'usuarios' && <UsuariosTab />}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/UsuariosTab.tsx src/pages/admin/NovoUsuarioModal.tsx src/pages/Admin.tsx
git commit -m "feat(admin): aba Usuários com lista, modal e ações"
```

---

## Task 12: Smoke ponta-a-ponta + push + memória

**Files:** (operacional, sem código)

- [ ] **Step 1: Smoke backend (curl)**

Use o admin atual em prod (`sigmmahealth@gmail.com` / `senha123`). Substitua `https://portal...` pela URL Railway.

```bash
# 1) Login admin → cookie
curl -k -c cookies.txt -X POST https://portal.../api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"sigmmahealth@gmail.com","password":"senha123"}'

# 2) Verify OTP (captura código no Resend/email)
curl -k -b cookies.txt -c cookies.txt -X POST https://portal.../api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"challenge_id":N,"code":"123456","trust_device":true}'

# 3) Cria novo usuário
curl -k -b cookies.txt -X POST https://portal.../api/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Auditor Test","email":"auditor-test@unimed.com","role":"auditoria"}'

# 4) Lista (deve conter o novo com invite_status:pending)
curl -k -b cookies.txt https://portal.../api/users | jq

# 5) Captura link do e-mail (Resend dashboard)
TOKEN="<hex64>"

# 6) Valida token
curl -k "https://portal.../api/auth/validate-setup-token?token=$TOKEN"
# Esperado: { valid:true, kind:"invite", name:"Auditor Test" }

# 7) Define senha
curl -k -X POST https://portal.../api/auth/redeem-token \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\",\"new_password\":\"Teste1234\"}"

# 8) Login com o novo (passa pelo 2FA normal)
curl -k -c cookies2.txt -X POST https://portal.../api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"auditor-test@unimed.com","password":"Teste1234"}'

# 9) Forgot password
curl -k -X POST https://portal.../api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"auditor-test@unimed.com"}'

# 10) Desativa via PATCH
curl -k -b cookies.txt -X PATCH https://portal.../api/users/<id> \
  -H "Content-Type: application/json" \
  -d '{"is_active":false}'

# Em seguida, tentar login com o novo → 403 "inativa"
```

**Casos negativos esperados:**
- Senha < 8 chars no redeem-token → 400 com mensagens da policy
- Role `prestador` no POST → 403
- E-mail duplicado no POST → 409
- Token reusado → 400
- Auto-desativação (admin tentando se desativar) → 400
- 11ª chamada de `redeem-token` no mesmo IP em 1h → 429
- Após reset: `GET /api/auth/trusted-devices` com cookie do user → lista vazia

- [ ] **Step 2: Smoke UI (Chrome DevTools MCP ou manual)**

1. `/login` → clica "Esqueceu sua senha?" → navega pra `/esqueci-senha`
2. Submete e-mail → toast "Se o e-mail existir..." → redireciona pra `/login` em 4s
3. Abre link do e-mail → carrega `/definir-senha?token=...` com nome correto
4. Digita senha fraca (`abc`) → checkboxes em vermelho, botão desabilitado
5. Digita `Teste1234` em ambos os campos → redireciona pra `/login`
6. Loga normalmente (passa pelo 2FA)
7. Como admin: `/admin` → aba **Usuários** aparece
8. Lista carrega; busca por nome/email filtra
9. **+ Novo usuário** → modal abre → preenche → Criar → modal fecha → lista atualiza com status **Pendente**
10. Menu ⋮ → **Mudar role para admin** → linha atualiza
11. Menu ⋮ → **Desativar** → badge muda pra Inativo
12. Menu ⋮ em pendente → **Reenviar convite** → toast
13. Menu ⋮ na própria conta → **Desativar** → mostra erro "Você não pode desativar a própria conta"

- [ ] **Step 3: Push**

Após smoke OK:
```bash
git push origin main
```
Railway redeploya automaticamente.

- [ ] **Step 4: Atualizar memória do projeto**

Criar arquivo em `~/.claude/projects/.../memory/cadastro-usuarios-convite-recuperacao.md` com:
- Status: implementado em 2026-MM-DD, X commits, hashes
- Recursos: aba Usuários em /admin, /esqueci-senha, /definir-senha
- Roles cobertas pela UI: admin + auditoria (prestador/cooperado virão por integração SGU)
- "Esqueci minha senha" disponível para todos

E atualizar a linha apropriada em `MEMORY.md` referenciando o novo arquivo.
