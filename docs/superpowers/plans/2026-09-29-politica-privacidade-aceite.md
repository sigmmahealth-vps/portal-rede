# Política de Privacidade com aceite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Política de Privacidade dentro do sistema, aceite obrigatório por versão no primeiro acesso de todo usuário, registro definitivo e coluna na tela Usuários.

**Architecture:** Constante de versão + regra pura em `src/lib/privacyPolicy.ts` (servidor e front importam). Tabela append-only `privacy_acceptances` (migration 0055). `/api/auth/me` expõe a versão aceita; `POST /api/privacy/accept` grava. `Layout` busca `/auth/me` e mostra modal bloqueante via `createPortal`.

**Tech Stack:** Express + pg (server.ts), React + react-router + Tailwind, testes `node --import tsx --test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-29-politica-privacidade-aceite-design.md`.
- Versão inicial: `'2026-09-29'`.
- Texto = o atual de `PoliticaPrivacidade.tsx` **sem a seção do DPO**.
- `privacy_acceptances` é só INSERT; sem FK para `users`.
- Node fora do PATH: prefixar `export PATH="/c/Program Files/nodejs:$PATH"`.

---

### Task 1: Regra de versão

**Files:**
- Create: `src/lib/privacyPolicy.ts`, `src/lib/privacyPolicy.test.ts`
- Modify: `package.json` (script `test`: incluir `src/lib/privacyPolicy.test.ts`)

**Interfaces — Produces:** `PRIVACY_POLICY_VERSION: string`; `needsPrivacyAcceptance(accepted: string | null | undefined, current?: string): boolean`.

- [ ] **Step 1: Teste**

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsPrivacyAcceptance, PRIVACY_POLICY_VERSION } from './privacyPolicy.ts';

test('sem aceite precisa aceitar', () => {
  assert.equal(needsPrivacyAcceptance(null), true);
  assert.equal(needsPrivacyAcceptance(undefined), true);
});
test('versão antiga precisa aceitar de novo', () => {
  assert.equal(needsPrivacyAcceptance('2000-01-01'), true);
});
test('versão atual não precisa', () => {
  assert.equal(needsPrivacyAcceptance(PRIVACY_POLICY_VERSION), false);
});
```

- [ ] **Step 2:** `node --import tsx --test src/lib/privacyPolicy.test.ts` → FAIL (módulo não existe).

- [ ] **Step 3: Implementação**

```ts
// Versão vigente da Política de Privacidade (spec 2026-09-29). Trocar esta string =
// todos os usuários aceitam de novo no próximo acesso; aceites antigos ficam em privacy_acceptances.
export const PRIVACY_POLICY_VERSION = '2026-09-29';

export function needsPrivacyAcceptance(accepted: string | null | undefined, current: string = PRIVACY_POLICY_VERSION): boolean {
  return accepted !== current;
}
```

- [ ] **Step 4:** teste → PASS. Adicionar o arquivo ao script `test` do `package.json`.
- [ ] **Step 5:** commit `feat(privacidade): versão da política e regra de aceite`.

### Task 2: Migration + API

**Files:**
- Create: `db/migrations/0055_privacy_acceptances.sql`
- Modify: `server.ts` (`/api/auth/me`, nova `POST /api/privacy/accept`, `GET /api/users`)

**Interfaces — Consumes:** Task 1. **Produces:** `/api/auth/me` → `user.privacy_accepted_version: string | null`; `POST /api/privacy/accept {version}` → `{ok, accepted_at}` | 409; `/api/users` → `privacy_accepted_at`, `privacy_accepted_version`.

- [ ] **Step 1: Migration**

```sql
-- Aceite da Política de Privacidade (spec 2026-09-29). Registro definitivo: só INSERT,
-- sem FK para users (sobrevive à exclusão do usuário); nome/e-mail são o retrato do momento.
CREATE TABLE IF NOT EXISTS privacy_acceptances (
  id             bigserial PRIMARY KEY,
  user_id        bigint      NOT NULL,
  user_name      text,
  user_email     text,
  policy_version text        NOT NULL,
  accepted_at    timestamptz NOT NULL DEFAULT now(),
  ip_hash        text
);
CREATE INDEX IF NOT EXISTS privacy_acceptances_user_idx ON privacy_acceptances (user_id, accepted_at DESC);
```

- [ ] **Step 2: `/api/auth/me`** — SELECT passa a incluir
`(SELECT pa.policy_version FROM privacy_acceptances pa WHERE pa.user_id = users.id ORDER BY pa.accepted_at DESC, pa.id DESC LIMIT 1) AS privacy_accepted_version`.

- [ ] **Step 3: `POST /api/privacy/accept`** (logo após `/api/auth/me`):

```ts
  // Aceite da Política de Privacidade (spec 2026-09-29) — só INSERT, registro definitivo.
  app.post('/api/privacy/accept', authenticate, async (req: any, res) => {
    try {
      if (req.body?.version !== PRIVACY_POLICY_VERSION) {
        return res.status(409).json({ error: 'A política foi atualizada. Recarregue a página.' });
      }
      const { rows: prev } = await query(
        'SELECT accepted_at FROM privacy_acceptances WHERE user_id = $1 AND policy_version = $2 LIMIT 1',
        [req.user.id, PRIVACY_POLICY_VERSION]);
      if (prev[0]) return res.json({ ok: true, accepted_at: prev[0].accepted_at });
      const { rows } = await query(
        `INSERT INTO privacy_acceptances (user_id, user_name, user_email, policy_version, ip_hash)
         SELECT id, name, email, $2, $3 FROM users WHERE id = $1
         RETURNING accepted_at`,
        [req.user.id, PRIVACY_POLICY_VERSION, hashClientIp(req)]);
      await auditLog({ query, userId: req.user.id, action: 'privacy_policy_accepted', meta: { version: PRIVACY_POLICY_VERSION }, ip: hashClientIp(req) });
      res.json({ ok: true, accepted_at: rows[0]?.accepted_at ?? null });
    } catch (err) {
      console.error('POST /api/privacy/accept:', err);
      res.status(500).json({ error: 'Falha ao registrar o aceite.' });
    }
  });
```
Import no topo: `import { PRIVACY_POLICY_VERSION } from './src/lib/privacyPolicy.js';`

- [ ] **Step 4: `/api/users`** — adicionar `pa.accepted_at AS privacy_accepted_at, pa.policy_version AS privacy_accepted_version` e
`LEFT JOIN LATERAL (SELECT accepted_at, policy_version FROM privacy_acceptances WHERE user_id = u.id ORDER BY accepted_at DESC, id DESC LIMIT 1) pa ON true`.

- [ ] **Step 5:** `npx tsc --noEmit` limpo; `npm run db:migrate` (dev); smoke com servidor local + cookie assinado: versão errada → 409; certa → 200 e 1 linha; repetir → 200 e continua 1 linha; `/api/auth/me` devolve a versão.
- [ ] **Step 6:** commit `feat(privacidade): registro de aceite (0055) e API`.

### Task 3: Front — página interna, login, menu e modal

**Files:**
- Create: `src/components/PoliticaTexto.tsx`, `src/components/PrivacyConsentModal.tsx`
- Modify: `src/pages/PoliticaPrivacidade.tsx`, `src/App.tsx`, `src/pages/Login.tsx`, `src/components/Layout.tsx`

- [ ] **Step 1:** `PoliticaTexto.tsx` = seções atuais (Dados, Finalidades, Retenção, Direitos) sem DPO; `PoliticaPrivacidade.tsx` = título + `<PoliticaTexto />`, sem fetch do DPO e sem "Voltar para o login".
- [ ] **Step 2:** `App.tsx` — mover `politica-privacidade` para dentro de `<Route path="/" element={<Layout />}>`.
- [ ] **Step 3:** `Login.tsx` — remover o `<p>` com o link da política (e o import de `Link` se ficar sem uso).
- [ ] **Step 4:** `Layout.tsx` — link "Política de Privacidade" no menu do perfil, após "Meus dados".
- [ ] **Step 5:** `PrivacyConsentModal.tsx` — `createPortal(document.body)`, `z-[60]`, sem fechar por fora/ESC; texto rolável; checkbox "Li e aceito a Política de Privacidade"; **Continuar** desabilitado sem check → `POST /privacy/accept {version}` → `onAccepted()`; erro exibido; botão **Sair** → `onLogout()`.
- [ ] **Step 6:** `Layout.tsx` — estado `privacyAccepted: string | null | undefined` (undefined = carregando); após `user`, `fetchApi('/auth/me')` → `setPrivacyAccepted(r.user.privacy_accepted_version ?? null)`; render do modal quando `privacyAccepted !== undefined && needsPrivacyAcceptance(privacyAccepted)`.
- [ ] **Step 7:** `npx tsc --noEmit`; commit `feat(privacidade): política dentro do sistema e aceite no primeiro acesso`.

### Task 4: Coluna na tela Usuários + QA

**Files:** Modify `src/pages/admin/UsuariosTab.tsx`

- [ ] **Step 1:** interface `User` + `privacy_accepted_at: string | null; privacy_accepted_version: string | null;`; `<th>Política</th>` antes de "Último acesso"; célula: versão atual → `Aceita em {fmtDataHora(at)} (v{versão})`; senão badge âmbar `Pendente` (+ ` (aceitou v{x})` se houver versão antiga).
- [ ] **Step 2:** `npx tsc --noEmit`, `npm test`, `npm run build`; QA no browser (dev): modal no 1º acesso, Continuar desabilitado sem check, aceitar libera e não volta após reload, link no menu do perfil, login sem link, coluna na tela Usuários.
- [ ] **Step 3:** commit `feat(privacidade): aceite da política na tela Usuários`.
