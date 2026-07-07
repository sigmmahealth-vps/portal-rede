# 2FA por e-mail + reforços de segurança — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar 2FA por código de e-mail (OTP) com padrão "dispositivo confiável" (estilo GitHub) e corrigir os reforços de segurança adjacentes do login.

**Architecture:** Abordagem incremental sobre o JWT existente. Os helpers de auth são **funções puras** (sem acesso a banco) num diretório `auth/`, testáveis em unidade sem tocar o Postgres; todo o SQL permanece no `server.ts`. O JWT passa a ser entregue em cookie `httpOnly`; um cookie `trusted_device` opaco dispensa o 2º fator em dispositivos já confiados. E-mails via abstração `Mailer` (Resend em produção, `ConsoleMailer` em dev).

**Tech Stack:** Node 20 + Express 4, TypeScript via `tsx`, Postgres (`pg`), `bcryptjs`, `jsonwebtoken`, `cookie-parser` (novo), `resend` (novo), React 19 + react-router-dom 7. Testes: `node:test` + `node:assert/strict` rodados com `tsx`.

**Spec:** [2026-06-22-2fa-email-seguranca-portal-design.md](../specs/2026-06-22-2fa-email-seguranca-portal-design.md)

---

## Decisões de implementação (refinamentos sobre o spec)

- **Testes automatizados não tocam o banco.** O `.env` local aponta para o Postgres de produção (ver memória do projeto). Por isso os helpers são funções puras e o fluxo com DB é validado por **smoke test manual**.
- **`user` permanece no `localStorage`** (não é segredo); apenas o `token` é removido. Evita reescrever 14 telas. O segredo real é o cookie `httpOnly`.
- **Sem route guard novo no frontend** (comportamento pré-existente; a proteção dos dados é no backend).
- **Smoke tests manuais usam uma conta de teste conhecida** (`admin@unimed.com`). Eles escrevem em `otp_codes`/`trusted_devices`/`access_logs` no banco compartilhado — tabelas auth-efêmeras, risco baixo. Se houver um Postgres local disponível, aponte `DATABASE_URL` para ele antes dos smoke tests.

## Estrutura de arquivos

**Criar:**
- `auth/otp.ts` — geração/hash/validação/expiração de OTP (puro)
- `auth/otp.test.ts`
- `auth/trustedDevice.ts` — segredo/hash/label/validade do dispositivo (puro)
- `auth/trustedDevice.test.ts`
- `auth/rateLimit.ts` — contagem de falhas por janela (puro)
- `auth/rateLimit.test.ts`
- `auth/mailer.ts` — interface `Mailer`, `ConsoleMailer`, `ResendMailer`, `createMailer`
- `auth/mailer.test.ts`
- `db/migrations/0009_2fa_email_otp.sql` — tabelas `otp_codes` e `trusted_devices`
- `src/pages/Dispositivos.tsx` — tela de dispositivos confiáveis
- `.env.example` — documentar variáveis novas

**Modificar:**
- `server.ts` — guard do `JWT_SECRET`, `cookie-parser`, `cors` com credenciais, login em 2 etapas, novos endpoints
- `src/lib/api.ts` — `credentials: 'include'`, remover leitura/escrita de `token`
- `src/pages/Login.tsx` — etapa OTP + remover credenciais de teste
- `src/App.tsx` — rota `/dispositivos`
- `package.json` — deps novas + script `test` com os novos arquivos

---

## Task 1: Dependências + correção do JWT_SECRET + cookie-parser

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `server.ts:11` (JWT_SECRET) e `server.ts:217-225` (middlewares)

- [ ] **Step 1: Instalar dependências**

Run:
```bash
npm install resend cookie-parser
npm install -D @types/cookie-parser
```
Expected: `package.json` passa a listar `resend`, `cookie-parser` e `@types/cookie-parser`.

- [ ] **Step 2: Corrigir o JWT_SECRET (remover fallback)**

Em `server.ts`, substituir a linha 11:
```ts
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-unimed-mvp';
```
por:
```ts
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: variável de ambiente JWT_SECRET não definida. Abortando boot.');
  process.exit(1);
}
```

- [ ] **Step 3: Definir JWT_SECRET no ambiente local**

Garanta um valor forte no `.env`:
```bash
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"
```
Cole a linha gerada no `.env`. (No Railway, defina a mesma variável em produção.)

- [ ] **Step 4: Adicionar cookie-parser e cors com credenciais**

Em `server.ts`, adicionar o import no topo:
```ts
import cookieParser from 'cookie-parser';
```
E em `startServer()` (linhas ~223-224), trocar:
```ts
  app.use(cors());
  app.use(express.json());
```
por:
```ts
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());
```

- [ ] **Step 5: Verificar boot com e sem a env var**

Run (deve subir): `npm run dev`. Encerre (Ctrl+C). Removendo temporariamente `JWT_SECRET` do `.env`, confirme que o boot aborta com a mensagem FATAL. Restaure o `.env`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json server.ts
git commit -m "feat(auth): exigir JWT_SECRET e habilitar cookie-parser/cors com credenciais"
```

---

## Task 2: Migration 0009 (otp_codes + trusted_devices)

**Files:**
- Create: `db/migrations/0009_2fa_email_otp.sql`

- [ ] **Step 1: Criar a migration**

Conteúdo de `db/migrations/0009_2fa_email_otp.sql`:
```sql
-- =============================================================================
-- 0009_2fa_email_otp.sql
-- 2FA por e-mail (OTP) + dispositivos confiáveis. Tudo aditivo.
-- =============================================================================

CREATE TABLE IF NOT EXISTS otp_codes (
  id            bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash     text NOT NULL,            -- hash bcrypt do código, nunca em texto puro
  purpose       text NOT NULL DEFAULT 'login_2fa',
  attempts      integer NOT NULL DEFAULT 0,
  consumed_at   timestamptz,              -- marca uso único
  expires_at    timestamptz NOT NULL,
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS otp_codes_user_idx ON otp_codes (user_id);
CREATE INDEX IF NOT EXISTS otp_codes_expires_idx ON otp_codes (expires_at);

CREATE TABLE IF NOT EXISTS trusted_devices (
  id            bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL,            -- sha256 do segredo do cookie, nunca o segredo cru
  label         text,
  last_ip       text,
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trusted_devices_user_idx ON trusted_devices (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS trusted_devices_token_uniq ON trusted_devices (token_hash);
```

- [ ] **Step 2: Aplicar a migration**

Run: `npm run db:migrate`
Expected: `+ aplicada:   0009_2fa_email_otp.sql` e `1 migration(s) aplicada(s).`

- [ ] **Step 3: Commit**

```bash
git add db/migrations/0009_2fa_email_otp.sql
git commit -m "feat(db): migration 0009 — otp_codes e trusted_devices"
```

---

## Task 3: Helper `auth/otp.ts` (puro) + testes

**Files:**
- Create: `auth/otp.ts`
- Test: `auth/otp.test.ts`
- Modify: `package.json` (script `test`)

- [ ] **Step 1: Escrever o teste que falha**

Conteúdo de `auth/otp.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateOtpCode, hashOtp, verifyOtp, isOtpExpired,
  OTP_TTL_MS, OTP_MAX_ATTEMPTS,
} from './otp.js';

test('generateOtpCode retorna 6 dígitos numéricos', () => {
  for (let i = 0; i < 50; i++) {
    assert.match(generateOtpCode(), /^[0-9]{6}$/);
  }
});

test('hashOtp + verifyOtp casam e rejeitam o errado', () => {
  const hash = hashOtp('123456');
  assert.notEqual(hash, '123456');
  assert.equal(verifyOtp('123456', hash), true);
  assert.equal(verifyOtp('000000', hash), false);
});

test('isOtpExpired compara com expires_at', () => {
  const now = new Date('2026-06-22T12:00:00Z');
  assert.equal(isOtpExpired(new Date(now.getTime() + 60_000), now), false);
  assert.equal(isOtpExpired(new Date(now.getTime() - 1), now), true);
});

test('constantes expostas', () => {
  assert.equal(OTP_TTL_MS, 10 * 60 * 1000);
  assert.equal(OTP_MAX_ATTEMPTS, 5);
});
```

- [ ] **Step 2: Atualizar o script de testes e rodar (deve falhar)**

Em `package.json`, trocar a linha do script `test` por:
```json
    "test": "node --import tsx --test db/roteiro-parser.test.ts auth/otp.test.ts",
```
Run: `npm test`
Expected: FALHA — `Cannot find module './otp.js'`.

- [ ] **Step 3: Implementar `auth/otp.ts`**

Conteúdo de `auth/otp.ts`:
```ts
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export const OTP_TTL_MS = 10 * 60 * 1000;   // 10 minutos
export const OTP_MAX_ATTEMPTS = 5;          // tentativas erradas por desafio

/** Código numérico de 6 dígitos, uniformemente distribuído. */
export function generateOtpCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashOtp(code: string): string {
  return bcrypt.hashSync(code, 10);
}

export function verifyOtp(code: string, hash: string): boolean {
  return bcrypt.compareSync(code, hash);
}

export function isOtpExpired(expiresAt: Date | string, now: Date): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}
```

- [ ] **Step 4: Rodar os testes (devem passar)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth/otp.ts auth/otp.test.ts package.json
git commit -m "feat(auth): helper de OTP (geração, hash, expiração) com testes"
```

---

## Task 4: Helper `auth/trustedDevice.ts` (puro) + testes

**Files:**
- Create: `auth/trustedDevice.ts`
- Test: `auth/trustedDevice.test.ts`
- Modify: `package.json` (script `test`)

- [ ] **Step 1: Escrever o teste que falha**

Conteúdo de `auth/trustedDevice.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateDeviceSecret, hashDeviceSecret, verifyDeviceSecret,
  deviceLabelFromUserAgent, isTrustedDeviceValid, TRUSTED_DEVICE_TTL_MS,
} from './trustedDevice.js';

test('generateDeviceSecret é opaco e de alta entropia (64 hex)', () => {
  const a = generateDeviceSecret();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, generateDeviceSecret());
});

test('hashDeviceSecret + verifyDeviceSecret casam e rejeitam o errado', () => {
  const secret = generateDeviceSecret();
  const hash = hashDeviceSecret(secret);
  assert.notEqual(hash, secret);
  assert.equal(verifyDeviceSecret(secret, hash), true);
  assert.equal(verifyDeviceSecret(generateDeviceSecret(), hash), false);
});

test('deviceLabelFromUserAgent extrai navegador/SO', () => {
  const chromeWin = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
  assert.equal(deviceLabelFromUserAgent(chromeWin), 'Chrome em Windows');
  assert.equal(deviceLabelFromUserAgent(undefined), 'Dispositivo desconhecido');
});

test('isTrustedDeviceValid exige não expirado e não revogado', () => {
  const now = new Date('2026-06-22T12:00:00Z');
  const futuro = new Date(now.getTime() + 1000);
  assert.equal(isTrustedDeviceValid({ expiresAt: futuro, revokedAt: null }, now), true);
  assert.equal(isTrustedDeviceValid({ expiresAt: new Date(now.getTime() - 1), revokedAt: null }, now), false);
  assert.equal(isTrustedDeviceValid({ expiresAt: futuro, revokedAt: now }, now), false);
});

test('TTL é 30 dias', () => {
  assert.equal(TRUSTED_DEVICE_TTL_MS, 30 * 24 * 60 * 60 * 1000);
});
```

- [ ] **Step 2: Atualizar o script de testes e rodar (deve falhar)**

Em `package.json`, trocar a linha do script `test` por:
```json
    "test": "node --import tsx --test db/roteiro-parser.test.ts auth/otp.test.ts auth/trustedDevice.test.ts",
```
Run: `npm test`
Expected: FALHA — `Cannot find module './trustedDevice.js'`.

- [ ] **Step 3: Implementar `auth/trustedDevice.ts`**

Conteúdo de `auth/trustedDevice.ts`:
```ts
import crypto from 'crypto';

export const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

/** Segredo opaco guardado no cookie do navegador (nunca persistido em texto puro). */
export function generateDeviceSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** sha256 — o segredo já tem alta entropia, não precisa de bcrypt. */
export function hashDeviceSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

/** Comparação em tempo constante para evitar timing attacks. */
export function verifyDeviceSecret(secret: string, hash: string): boolean {
  const a = Buffer.from(hashDeviceSecret(secret), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Rótulo amigável para a tela de dispositivos (ex.: "Chrome em Windows"). */
export function deviceLabelFromUserAgent(ua: string | undefined): string {
  if (!ua) return 'Dispositivo desconhecido';
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const os =
    /Windows/.test(ua) ? 'Windows' :
    /Macintosh|Mac OS/.test(ua) ? 'macOS' :
    /Android/.test(ua) ? 'Android' :
    /iPhone|iPad|iOS/.test(ua) ? 'iOS' :
    /Linux/.test(ua) ? 'Linux' : 'SO desconhecido';
  return `${browser} em ${os}`;
}

export function isTrustedDeviceValid(
  d: { expiresAt: Date | string; revokedAt: Date | string | null },
  now: Date,
): boolean {
  if (d.revokedAt) return false;
  return new Date(d.expiresAt).getTime() > now.getTime();
}
```

- [ ] **Step 4: Rodar os testes (devem passar)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth/trustedDevice.ts auth/trustedDevice.test.ts package.json
git commit -m "feat(auth): helper de dispositivo confiável com testes"
```

---

## Task 5: Helper `auth/rateLimit.ts` (puro) + testes

**Files:**
- Create: `auth/rateLimit.ts`
- Test: `auth/rateLimit.test.ts`
- Modify: `package.json` (script `test`)

- [ ] **Step 1: Escrever o teste que falha**

Conteúdo de `auth/rateLimit.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countWithinWindow, isRateLimited,
  PASSWORD_MAX_FAILURES, PASSWORD_WINDOW_MS,
} from './rateLimit.js';

test('countWithinWindow conta só dentro da janela', () => {
  const now = new Date('2026-06-22T12:00:00Z');
  const dentro1 = new Date(now.getTime() - 1000);
  const dentro2 = new Date(now.getTime() - 60_000);
  const fora = new Date(now.getTime() - 16 * 60 * 1000);
  assert.equal(countWithinWindow([dentro1, dentro2, fora], now, 15 * 60 * 1000), 2);
});

test('isRateLimited dispara ao atingir o máximo', () => {
  const now = new Date('2026-06-22T12:00:00Z');
  const ts = (m: number) => new Date(now.getTime() - m * 60_000);
  const quatro = [ts(1), ts(2), ts(3), ts(4)];
  assert.equal(isRateLimited(quatro, now, PASSWORD_WINDOW_MS, PASSWORD_MAX_FAILURES), false);
  assert.equal(isRateLimited([...quatro, ts(5)], now, PASSWORD_WINDOW_MS, PASSWORD_MAX_FAILURES), true);
});

test('constantes de senha', () => {
  assert.equal(PASSWORD_MAX_FAILURES, 5);
  assert.equal(PASSWORD_WINDOW_MS, 15 * 60 * 1000);
});
```

- [ ] **Step 2: Atualizar o script de testes e rodar (deve falhar)**

Em `package.json`, trocar a linha do script `test` por:
```json
    "test": "node --import tsx --test db/roteiro-parser.test.ts auth/otp.test.ts auth/trustedDevice.test.ts auth/rateLimit.test.ts",
```
Run: `npm test`
Expected: FALHA — `Cannot find module './rateLimit.js'`.

- [ ] **Step 3: Implementar `auth/rateLimit.ts`**

Conteúdo de `auth/rateLimit.ts`:
```ts
export const PASSWORD_MAX_FAILURES = 5;
export const PASSWORD_WINDOW_MS = 15 * 60 * 1000;  // 15 minutos

/** Quantos timestamps caem dentro de [now - windowMs, now]. */
export function countWithinWindow(
  timestamps: (Date | string)[],
  now: Date,
  windowMs: number,
): number {
  const cutoff = now.getTime() - windowMs;
  return timestamps.filter((t) => new Date(t).getTime() >= cutoff).length;
}

export function isRateLimited(
  failureTimestamps: (Date | string)[],
  now: Date,
  windowMs: number,
  maxFailures: number,
): boolean {
  return countWithinWindow(failureTimestamps, now, windowMs) >= maxFailures;
}
```

- [ ] **Step 4: Rodar os testes (devem passar)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth/rateLimit.ts auth/rateLimit.test.ts package.json
git commit -m "feat(auth): helper de rate-limit por janela com testes"
```

---

## Task 6: Helper `auth/mailer.ts` + testes

**Files:**
- Create: `auth/mailer.ts`
- Test: `auth/mailer.test.ts`
- Modify: `package.json` (script `test`)

- [ ] **Step 1: Escrever o teste que falha**

Conteúdo de `auth/mailer.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConsoleMailer } from './mailer.js';

test('ConsoleMailer entrega o código pelo logger injetado', async () => {
  const linhas: string[] = [];
  const mailer = new ConsoleMailer((msg) => linhas.push(msg));
  await mailer.sendOtp('teste@exemplo.com', '123456');
  const texto = linhas.join('\n');
  assert.ok(texto.includes('teste@exemplo.com'));
  assert.ok(texto.includes('123456'));
});
```

- [ ] **Step 2: Atualizar o script de testes e rodar (deve falhar)**

Em `package.json`, trocar a linha do script `test` por:
```json
    "test": "node --import tsx --test db/roteiro-parser.test.ts auth/otp.test.ts auth/trustedDevice.test.ts auth/rateLimit.test.ts auth/mailer.test.ts",
```
Run: `npm test`
Expected: FALHA — `Cannot find module './mailer.js'`.

- [ ] **Step 3: Implementar `auth/mailer.ts`**

Conteúdo de `auth/mailer.ts`:
```ts
import { Resend } from 'resend';

export interface Mailer {
  sendOtp(to: string, code: string): Promise<void>;
}

const SUBJECT = (code: string) => `Seu código de acesso ao Portal Unimed: ${code}`;
const BODY = (code: string) =>
  `Seu código de acesso é ${code}.\n\n` +
  `Ele vale por 10 minutos e só pode ser usado uma vez.\n` +
  `Se você não tentou entrar no Portal Unimed, ignore este e-mail.`;

/** Em dev: imprime o código (não envia e-mail real). Logger injetável para testes. */
export class ConsoleMailer implements Mailer {
  constructor(private readonly log: (msg: string) => void = console.log) {}
  async sendOtp(to: string, code: string): Promise<void> {
    this.log(`[ConsoleMailer] Para: ${to} | ${SUBJECT(code)}`);
  }
}

/** Em produção: envia via Resend (sem links clicáveis, só o código). */
export class ResendMailer implements Mailer {
  private readonly client: Resend;
  constructor(apiKey: string, private readonly from: string) {
    this.client = new Resend(apiKey);
  }
  async sendOtp(to: string, code: string): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to,
      subject: SUBJECT(code),
      text: BODY(code),
    });
    if (error) {
      throw new Error(`Falha ao enviar e-mail de OTP: ${error.message ?? error}`);
    }
  }
}

/**
 * Escolhe o mailer pelo ambiente:
 *  - RESEND_API_KEY + MAIL_FROM presentes → ResendMailer
 *  - produção sem a chave → erro de boot (falha barulhenta)
 *  - dev sem a chave → ConsoleMailer
 */
export function createMailer(): Mailer {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (apiKey && from) {
    return new ResendMailer(apiKey, from);
  }
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: RESEND_API_KEY/MAIL_FROM ausentes em produção. Abortando boot.');
    process.exit(1);
  }
  console.warn('[mailer] RESEND_API_KEY ausente — usando ConsoleMailer (apenas dev).');
  return new ConsoleMailer();
}
```

- [ ] **Step 4: Rodar os testes (devem passar)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add auth/mailer.ts auth/mailer.test.ts package.json
git commit -m "feat(auth): abstração Mailer com ConsoleMailer e ResendMailer"
```

---

## Task 7: Backend — login em 2 etapas (`/login`, `/verify-otp`, `/resend-otp`)

**Files:**
- Modify: `server.ts` (imports; instanciar mailer em `startServer`; helpers; handlers ~267-297)

- [ ] **Step 1: Adicionar imports e instanciar o mailer**

No topo de `server.ts`, junto aos imports, adicionar:
```ts
import { generateOtpCode, hashOtp, verifyOtp, isOtpExpired, OTP_TTL_MS, OTP_MAX_ATTEMPTS } from './auth/otp.js';
import { generateDeviceSecret, hashDeviceSecret, deviceLabelFromUserAgent, isTrustedDeviceValid, TRUSTED_DEVICE_TTL_MS } from './auth/trustedDevice.js';
import { isRateLimited, PASSWORD_MAX_FAILURES, PASSWORD_WINDOW_MS } from './auth/rateLimit.js';
import { createMailer } from './auth/mailer.js';
```
Dentro de `startServer()`, logo após `const app = express();` (linha ~217), adicionar:
```ts
  const mailer = createMailer();
```

- [ ] **Step 2: Adicionar helpers de sessão (dentro de startServer, após `recordAccess` ~264)**

```ts
  const isProd = process.env.NODE_ENV === 'production';

  // Emite a sessão (JWT em cookie httpOnly) e devolve o payload do usuário.
  const issueSession = (res: any, user: any, previousLoginAt: any) => {
    const token = jwt.sign(
      { id: user.id, name: user.name, role: user.role, provider_id: user.provider_id },
      JWT_SECRET as string,
      { expiresIn: '24h' },
    );
    res.cookie('session', token, {
      httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000,
    });
    return {
      user: {
        id: user.id, name: user.name, email: user.email, role: user.role,
        provider_id: user.provider_id, last_login_at: previousLoginAt,
      },
    };
  };

  // Marca login bem-sucedido: atualiza último acesso + trilha.
  const finalizeLogin = async (user: any, req: any) => {
    const previousLoginAt = user.last_login_at ?? null;
    const { ip } = clientMeta(req);
    await query('UPDATE users SET last_login_at = now(), last_login_ip = $1 WHERE id = $2', [ip, user.id]);
    await recordAccess(user.id, user.email, true, req);
    return previousLoginAt;
  };

  // Confere o cookie de dispositivo confiável; devolve a linha válida ou null.
  const findValidTrustedDevice = async (userId: number, secret: string | undefined) => {
    if (!secret) return null;
    const hash = hashDeviceSecret(secret);
    const { rows } = await query(
      'SELECT * FROM trusted_devices WHERE user_id = $1 AND token_hash = $2',
      [userId, hash],
    );
    const device = rows[0] as any;
    if (!device) return null;
    return isTrustedDeviceValid({ expiresAt: device.expires_at, revokedAt: device.revoked_at }, new Date())
      ? device : null;
  };

  // Cria um desafio OTP, envia o e-mail e devolve o id do desafio.
  const createOtpChallenge = async (user: any, req: any): Promise<number> => {
    const code = generateOtpCode();
    const { ip } = clientMeta(req);
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    const { rows } = await query(
      'INSERT INTO otp_codes (user_id, code_hash, expires_at, ip) VALUES ($1, $2, $3, $4) RETURNING id',
      [user.id, hashOtp(code), expiresAt, ip],
    );
    await mailer.sendOtp(user.email, code);
    return rows[0].id;
  };

  // Bloqueio por excesso de falhas recentes (conta na trilha access_logs).
  const isLoginBlocked = async (email: string): Promise<boolean> => {
    const { rows } = await query(
      `SELECT created_at FROM access_logs
        WHERE email = $1 AND success = false
          AND created_at > now() - interval '15 minutes'`,
      [email],
    );
    return isRateLimited(rows.map((r: any) => r.created_at), new Date(), PASSWORD_WINDOW_MS, PASSWORD_MAX_FAILURES);
  };
```

- [ ] **Step 3: Substituir o handler de `/api/auth/login` (linhas ~267-297) por login + verify-otp + resend-otp**

```ts
  // Login — etapa 1: senha. Emite sessão se o dispositivo for confiável; senão, dispara OTP.
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (email && await isLoginBlocked(email)) {
        return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em alguns minutos.' });
      }
      const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
      const user = rows[0] as any;
      if (!user || !bcrypt.compareSync(password, user.password)) {
        await recordAccess(user?.id ?? null, email ?? null, false, req);
        return res.status(401).json({ error: 'Credenciais inválidas' });
      }
      if (user.is_active === false) {
        await recordAccess(user.id, user.email, false, req);
        return res.status(403).json({ error: 'Usuário inativo' });
      }
      const device = await findValidTrustedDevice(user.id, req.cookies?.trusted_device);
      if (device) {
        await query('UPDATE trusted_devices SET last_used_at = now(), last_ip = $1 WHERE id = $2',
          [clientMeta(req).ip, device.id]);
        const previousLoginAt = await finalizeLogin(user, req);
        return res.json(issueSession(res, user, previousLoginAt));
      }
      try {
        const challengeId = await createOtpChallenge(user, req);
        return res.json({ needs_otp: true, challenge_id: challengeId });
      } catch (mailErr: any) {
        console.error('Falha ao enviar OTP:', mailErr);
        return res.status(502).json({ error: 'Não foi possível enviar o código por e-mail. Tente novamente.' });
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Login — etapa 2: verificação do código OTP.
  app.post('/api/auth/verify-otp', async (req, res) => {
    try {
      const { challenge_id, code, trust_device } = req.body;
      const { rows } = await query('SELECT * FROM otp_codes WHERE id = $1', [challenge_id]);
      const challenge = rows[0] as any;
      if (!challenge || challenge.consumed_at) {
        return res.status(400).json({ error: 'Código inválido ou já utilizado. Solicite um novo.' });
      }
      if (isOtpExpired(challenge.expires_at, new Date())) {
        return res.status(400).json({ error: 'Código expirado. Solicite um novo.' });
      }
      if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
        await query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [challenge.id]);
        return res.status(429).json({ error: 'Muitas tentativas. Solicite um novo código.' });
      }
      const { rows: userRows } = await query('SELECT * FROM users WHERE id = $1', [challenge.user_id]);
      const user = userRows[0] as any;
      if (!verifyOtp(String(code ?? ''), challenge.code_hash)) {
        await query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [challenge.id]);
        await recordAccess(user?.id ?? null, user?.email ?? null, false, req);
        return res.status(401).json({ error: 'Código incorreto.' });
      }
      await query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [challenge.id]);
      if (trust_device) {
        const secret = generateDeviceSecret();
        const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_TTL_MS);
        const { ip, userAgent } = clientMeta(req);
        await query(
          `INSERT INTO trusted_devices (user_id, token_hash, label, last_ip, expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [user.id, hashDeviceSecret(secret), deviceLabelFromUserAgent(userAgent ?? undefined), ip, expiresAt],
        );
        res.cookie('trusted_device', secret, {
          httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: TRUSTED_DEVICE_TTL_MS,
        });
      }
      const previousLoginAt = await finalizeLogin(user, req);
      return res.json(issueSession(res, user, previousLoginAt));
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Reenvio de OTP — cooldown de 60s e teto de 6 códigos/hora por usuário.
  app.post('/api/auth/resend-otp', async (req, res) => {
    try {
      const { challenge_id } = req.body;
      const { rows } = await query('SELECT * FROM otp_codes WHERE id = $1', [challenge_id]);
      const challenge = rows[0] as any;
      if (!challenge || challenge.consumed_at) {
        return res.status(400).json({ error: 'Desafio inválido. Faça login novamente.' });
      }
      if (Date.now() - new Date(challenge.created_at).getTime() < 60_000) {
        return res.status(429).json({ error: 'Aguarde alguns segundos antes de pedir um novo código.' });
      }
      const { rows: countRows } = await query(
        `SELECT count(*)::int AS n FROM otp_codes
          WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
        [challenge.user_id],
      );
      if (countRows[0].n >= 6) {
        return res.status(429).json({ error: 'Limite de códigos por hora atingido. Tente mais tarde.' });
      }
      const { rows: userRows } = await query('SELECT * FROM users WHERE id = $1', [challenge.user_id]);
      const user = userRows[0] as any;
      const code = generateOtpCode();
      await query(
        'UPDATE otp_codes SET code_hash = $1, attempts = 0, expires_at = $2, created_at = now() WHERE id = $3',
        [hashOtp(code), new Date(Date.now() + OTP_TTL_MS), challenge.id],
      );
      try {
        await mailer.sendOtp(user.email, code);
      } catch (mailErr: any) {
        console.error('Falha ao reenviar OTP:', mailErr);
        return res.status(502).json({ error: 'Não foi possível reenviar o código. Tente novamente.' });
      }
      return res.json({ ok: true });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
```

- [ ] **Step 4: Smoke test manual — dispositivo novo (OTP)**

Terminal 1: `npm run dev`. Terminal 2:
```bash
curl -i -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@unimed.com","password":"senha123"}'
```
Expected: `{"needs_otp":true,"challenge_id":<n>}` e o código aparece no terminal 1 (ConsoleMailer). Depois:
```bash
curl -i -b cookies.txt -c cookies.txt -X POST http://localhost:3000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"challenge_id":<n>,"code":"<codigo>","trust_device":true}'
```
Expected: `Set-Cookie: session=...; HttpOnly` e `Set-Cookie: trusted_device=...; HttpOnly`; corpo `{ "user": {...} }`.

- [ ] **Step 5: Smoke test manual — dispositivo confiável (pula OTP)**

```bash
curl -i -b cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@unimed.com","password":"senha123"}'
```
Expected: `{ "user": {...} }` direto, sem `needs_otp`.

- [ ] **Step 6: Smoke test manual — código errado**

Gere novo desafio (cookie jar novo, sem `-b`); envie `code` errado → `401 Código incorreto`. Repita 5x → `429`. Encerre o servidor.

- [ ] **Step 7: Commit**

```bash
git add server.ts
git commit -m "feat(auth): login em duas etapas com OTP por e-mail e dispositivo confiável"
```

---

## Task 8: Backend — sessão por cookie, logout, /me e dispositivos

**Files:**
- Modify: `server.ts` (`authenticate` ~233-245; novos endpoints após `/resend-otp`)

- [ ] **Step 1: `authenticate` lê o cookie (fallback ao header)**

Trocar o corpo de `authenticate` (linhas ~233-245) por:
```ts
  const authenticate = (req: any, res: any, next: any) => {
    const fromCookie = req.cookies?.session;
    const authHeader = req.headers.authorization;
    const token = fromCookie || (authHeader ? authHeader.split(' ')[1] : null);
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
      req.user = jwt.verify(token, JWT_SECRET as string);
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };
```

- [ ] **Step 2: Adicionar logout, /me e endpoints de dispositivos (após `/resend-otp`)**

```ts
  app.post('/api/auth/logout', (_req, res) => {
    res.clearCookie('session');
    res.json({ ok: true });
  });

  app.get('/api/auth/me', authenticate, async (req: any, res) => {
    const { rows } = await query(
      'SELECT id, name, email, role, provider_id, last_login_at FROM users WHERE id = $1',
      [req.user.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({ user: rows[0] });
  });

  app.get('/api/auth/trusted-devices', authenticate, async (req: any, res) => {
    const { rows } = await query(
      `SELECT id, label, last_ip, last_used_at, expires_at, created_at
         FROM trusted_devices
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY last_used_at DESC`,
      [req.user.id],
    );
    res.json({ devices: rows });
  });

  app.delete('/api/auth/trusted-devices/:id', authenticate, async (req: any, res) => {
    const result = await query(
      'UPDATE trusted_devices SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
      [req.params.id, req.user.id],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Dispositivo não encontrado' });
    res.json({ ok: true });
  });
```

- [ ] **Step 3: Smoke test manual — /me, listar, revogar**

Com `npm run dev` e o `cookies.txt` válido da Task 7:
```bash
curl -s -b cookies.txt http://localhost:3000/api/auth/me
curl -s -b cookies.txt http://localhost:3000/api/auth/trusted-devices
curl -i -b cookies.txt -X DELETE http://localhost:3000/api/auth/trusted-devices/<id>
```
Expected: `/me` → `{ user }`; lista com ≥1 dispositivo; DELETE → `{ "ok": true }`. Novo login com o mesmo cookie volta a pedir OTP. Encerre.

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "feat(auth): sessão por cookie httpOnly, logout, /me e gestão de dispositivos"
```

---

## Task 9: Frontend — `api.ts` usa cookie em vez de token

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Reescrever `fetchApi`**

Conteúdo completo de `src/lib/api.ts`:
```ts
const API_URL = (import.meta as any).env.VITE_API_URL || '/api';

export const fetchApi = async (endpoint: string, options: RequestInit = {}) => {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include', // envia o cookie httpOnly de sessão
  });
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Erro na requisição');
  }
  return response.json();
};
```

- [ ] **Step 2: Verificar build de tipos**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat(auth): frontend usa cookie de sessão (credentials include)"
```

---

## Task 10: Frontend — `Login.tsx` com etapa OTP e sem credenciais de teste

**Files:**
- Modify: `src/pages/Login.tsx`

- [ ] **Step 1: Adicionar estado da etapa OTP e máscara de e-mail**

Após `const [loading, setLoading] = useState(false);`, adicionar:
```tsx
  const [step, setStep] = useState<'password' | 'otp'>('password');
  const [challengeId, setChallengeId] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(true);
  const [resendCooldown, setResendCooldown] = useState(0);
```
Logo acima do `return (`:
```tsx
  const maskedEmail = (() => {
    const [u, d] = email.split('@');
    if (!d) return email;
    return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`;
  })();

  React.useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);
```

- [ ] **Step 2: Atualizar `handleSubmit` para tratar `needs_otp`**

Trocar o corpo do `try` de `handleSubmit` (o trecho que hoje grava `token` e navega) por:
```tsx
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erro ao fazer login');
      if (data.needs_otp) {
        setChallengeId(data.challenge_id);
        setStep('otp');
        setResendCooldown(60);
      } else {
        localStorage.setItem('user', JSON.stringify(data.user));
        navigate('/dashboard');
      }
```

- [ ] **Step 3: Adicionar os handlers de OTP (após `handleSubmit`)**

```tsx
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ challenge_id: challengeId, code, trust_device: trustDevice }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Código inválido');
      localStorage.setItem('user', JSON.stringify(data.user));
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setError('');
    try {
      const response = await fetch('/api/auth/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ challenge_id: challengeId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Erro ao reenviar');
      setResendCooldown(60);
    } catch (err: any) {
      setError(err.message);
    }
  };
```

- [ ] **Step 4: Renderizar a etapa OTP e remover o bloco de credenciais de teste**

Substituir o `<form className="space-y-5" onSubmit={handleSubmit}>...</form>` existente por:
```tsx
          {step === 'password' ? (
          <form className="space-y-5" onSubmit={handleSubmit}>
            {/* ...conteúdo atual do formulário de senha, inalterado... */}
          </form>
          ) : (
          <form className="space-y-5" onSubmit={handleVerifyOtp}>
            {error && (
              <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-md">
                <div className="flex">
                  <AlertCircle className="h-5 w-5 text-red-400 flex-shrink-0" aria-hidden="true" />
                  <p className="ml-3 text-sm text-red-700">{error}</p>
                </div>
              </div>
            )}
            <p className="text-sm text-gray-600">
              Enviamos um código de 6 dígitos para <strong>{maskedEmail}</strong>.
            </p>
            <div>
              <label htmlFor="otp" className="block text-sm font-medium text-gray-700 mb-1">Código</label>
              <input
                id="otp" name="otp" inputMode="numeric" autoComplete="one-time-code"
                maxLength={6} required value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
                className="block w-full px-4 py-3 bg-[#f0f0f0] border border-transparent rounded-lg focus:bg-white focus:ring-2 focus:ring-[#00995D] tracking-[0.5em] text-center text-lg sm:text-sm"
                placeholder="000000"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={trustDevice} onChange={(e) => setTrustDevice(e.target.checked)} />
              Confiar neste dispositivo por 30 dias
            </label>
            <button type="submit" disabled={loading}
              className="w-full flex justify-center py-3 px-4 rounded-lg text-sm font-bold text-white bg-[#00995D] hover:bg-[#007A4A] disabled:opacity-50">
              {loading ? 'Verificando...' : 'Verificar código'}
            </button>
            <div className="flex justify-between text-xs">
              <button type="button" onClick={() => { setStep('password'); setError(''); setCode(''); }}
                className="text-gray-500 hover:text-[#00995D]">Voltar</button>
              <button type="button" onClick={handleResend} disabled={resendCooldown > 0}
                className="text-gray-500 hover:text-[#00995D] disabled:opacity-50">
                {resendCooldown > 0 ? `Reenviar em ${resendCooldown}s` : 'Reenviar código'}
              </button>
            </div>
          </form>
          )}
```
E **remover** o bloco de credenciais de teste (o `<div className="mt-8 pt-6 border-t ...">` com a lista `senha123`, ~linhas 156-166).

- [ ] **Step 5: Verificar build de tipos**

Run: `npm run lint`
Expected: PASS. (`import React, { useState }` já cobre `React.useEffect`.)

- [ ] **Step 6: Smoke test manual no navegador**

`npm run dev`, login com `admin@unimed.com` / `senha123` → aparece etapa OTP; pegue o código no terminal, marque "confiar" → dashboard. Logout + login no mesmo navegador → não pede OTP.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Login.tsx
git commit -m "feat(auth): tela de login em duas etapas (OTP) e remoção das credenciais de teste"
```

---

## Task 11: Frontend — tela de dispositivos confiáveis

**Files:**
- Create: `src/pages/Dispositivos.tsx`
- Modify: `src/App.tsx` (import + rota)

- [ ] **Step 1: Criar a tela**

Conteúdo de `src/pages/Dispositivos.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Laptop, Trash2 } from 'lucide-react';
import { fetchApi } from '../lib/api';

interface Device {
  id: number;
  label: string | null;
  last_ip: string | null;
  last_used_at: string;
  expires_at: string;
}

export default function Dispositivos() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    fetchApi('/auth/trusted-devices')
      .then((data) => setDevices(data.devices))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const revoke = async (id: number) => {
    if (!confirm('Revogar este dispositivo? Ele exigirá novo código no próximo acesso.')) return;
    try {
      await fetchApi(`/auth/trusted-devices/${id}`, { method: 'DELETE' });
      setDevices((ds) => ds.filter((d) => d.id !== id));
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">Dispositivos confiáveis</h1>
      <p className="text-sm text-gray-500">
        Nestes dispositivos o código de verificação não é pedido a cada acesso. Revogue qualquer um que você não reconheça.
      </p>
      {error && <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm">{error}</div>}
      {loading ? (
        <div className="text-gray-500">Carregando...</div>
      ) : devices.length === 0 ? (
        <div className="text-gray-500">Nenhum dispositivo confiável.</div>
      ) : (
        <ul className="divide-y divide-gray-100 bg-white rounded-xl border border-gray-100">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Laptop className="h-5 w-5 text-[#00995D]" />
                <div>
                  <p className="font-medium text-gray-900">{d.label || 'Dispositivo'}</p>
                  <p className="text-xs text-gray-500">
                    Último acesso: {new Date(d.last_used_at).toLocaleString('pt-BR')} · IP {d.last_ip || '—'}
                  </p>
                </div>
              </div>
              <button onClick={() => revoke(d.id)} className="text-red-500 hover:text-red-700 p-2" title="Revogar">
                <Trash2 className="h-5 w-5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Registrar a rota**

Em `src/App.tsx`, adicionar o import:
```tsx
import Dispositivos from './pages/Dispositivos';
```
E a rota dentro de `<Route path="/" element={<Layout />}>` (perto de `perfil`):
```tsx
          <Route path="dispositivos" element={<Dispositivos />} />
```

- [ ] **Step 3: Verificar build de tipos**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Smoke test manual**

Logado, navegue para `/dispositivos`: lista o dispositivo atual; lixeira revoga e some. Logout/login → volta a pedir OTP.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Dispositivos.tsx src/App.tsx
git commit -m "feat(auth): tela de gestão de dispositivos confiáveis"
```

---

## Task 12: Documentar variáveis de ambiente

**Files:**
- Create: `.env.example`

- [ ] **Step 1: Criar `.env.example`**

Conteúdo de `.env.example`:
```bash
# Banco de dados (Postgres)
DATABASE_URL=postgres://usuario:senha@host:5432/banco

# Segredo de assinatura do JWT/cookie de sessão (OBRIGATÓRIO — boot falha sem ele)
# Gere com: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=

# Envio de e-mail de OTP (OBRIGATÓRIO em produção; em dev usa ConsoleMailer)
RESEND_API_KEY=
MAIL_FROM=Portal Unimed <nao-responda@seu-dominio-verificado.com>

# Ambiente
NODE_ENV=development
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: documentar variáveis de ambiente (JWT_SECRET, Resend)"
```

---

## Pré-requisitos de go-live (fora do código)

- [ ] Definir `JWT_SECRET` forte no Railway (produção).
- [ ] Criar conta no Resend, gerar `RESEND_API_KEY` e definir `MAIL_FROM`.
- [ ] **Verificar o domínio de envio no Resend** (SPF/DKIM) — sem isso os e-mails de OTP podem cair em spam.
- [ ] Definir `NODE_ENV=production` no Railway.

## Verificação final (após todas as tasks)

- [ ] `npm test` — todos os helpers verdes.
- [ ] `npm run lint` — sem erros de tipo.
- [ ] Fluxo manual ponta a ponta: dispositivo novo pede OTP → confiar → próximos logins não pedem; revogar volta a pedir; código errado/expirado tratado; bloqueio após excesso de tentativas.
- [ ] Confirmar que nenhum `localStorage.getItem('token')` permanece: `grep -rn "getItem('token')" src/`.
