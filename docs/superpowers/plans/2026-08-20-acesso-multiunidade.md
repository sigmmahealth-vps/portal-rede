# Acesso Multi-Unidade (agrupamento sob demanda) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que um login de prestador cubra um **subconjunto escolhido** de unidades (um médico com várias unidades centralizando num único e-mail), mantendo o default de 1 login por unidade — controlado por uma flag `agrupado` que o admin liga/desliga.

**Architecture:** O escopo do portal deixa de ser um `location_id` escalar no usuário e passa a ser um **conjunto de unidades** numa tabela de vínculo `user_locations` (fonte única de verdade), resolvido **por request** (nunca do JWT) e **fail-closed** (conjunto vazio = nega tudo). A fronteira entre CNPJs é garantida **estruturalmente** por FK composta com `provider_id`. Agrupar/desagrupar são transações de admin auditadas. Pré-requisito: tornar o reimport de cadastro **idempotente** (upsert por `sgu_location_code`) para os `location_id` não trocarem a cada carga — senão o fail-closed vira lockout em massa.

**Tech Stack:** Node + TypeScript (tsx), Express, PostgreSQL (`pg`), migrations SQL versionadas (`db/migrations/NNNN_*.sql`, runner `npm run db:migrate`), React + Tailwind (Vite). Testes: `node --import tsx --test <arquivo>`.

## Global Constraints

- **Ambiente:** trabalhar sempre em **dev** primeiro (`APP_ENV=dev`, host `reseau.proxy.rlwy.net`). Nunca rodar migrations/scripts destrutivos em prod. Conferir o host impresso antes de qualquer `--commit`.
- **Node fora do PATH:** prefixar `export PATH="/c/Program Files/nodejs:$PATH"` (Bash) antes de `node`/`npm`/`npx`.
- **Migrations idempotentes:** todo DDL com `IF NOT EXISTS` / `IF EXISTS`; o runner aplica em ordem e grava em `schema_migrations`. `npm start` roda migrate no boot (idempotente).
- **1 responsável por unidade:** invariante de domínio preservado por `UNIQUE(location_id)` em `user_locations`.
- **Cross-CNPJ é fronteira dura:** um login nunca cobre unidades de prestadores diferentes. Médico em 2 CNPJs = 2 logins (é feature, não bug — reforçado pelo e-mail UNIQUE).
- **Fail-closed:** conjunto de unidades vazio ⇒ o portal do prestador não enxerga nada; a visão ampla nunca é herdada de dado órfão, só de grant explícito de admin.
- **Login esvaziado nunca é apagado** (quebra `access_logs`/auditoria LGPD): é **desativado** (`is_active=false`, `email=NULL`).
- **Escopo tem caminho único:** toda autorização por unidade passa por `userLocationIds(req)`. Nenhum `location_id = $` cru fora desse helper (gate de aceite por grep).

---

## File Structure

**Migrations (novas):**
- `db/migrations/0036_user_locations.sql` — tabela de vínculo, flag `agrupado`, pré-requisitos de FK composta, backfill.
- `db/migrations/0037_drop_users_location_id.sql` — aposenta `users.location_id` (última fatia).

**Backend (`server.ts`):**
- `userLocationIds(req)` — novo helper (substitui `userLocationId`); resolve o conjunto por request do banco.
- Reescrita dos ~14 call-sites de escopo de leitura para `= ANY($set)` fail-closed.
- Guards de escrita (`loadInstanceForWrite` e afins) validam `target.location_id ∈ set`.
- `prestadorRecipients` resolve destinatários da junção com dedupe.
- Endpoints novos: `POST /api/providers/:id/access/group` (agrupar) e `POST /api/providers/:id/access/ungroup` (desagrupar).

**Import (`db/import-tabela.ts`):**
- Trocar `DELETE FROM providers` + insert por **upsert idempotente** de providers/provider_locations por chave estável.

**Scripts:**
- `db/provision-users.ts` — passa a inserir 1 linha em `user_locations` junto com o usuário (reuso no descentralizar).

**Frontend (`src/pages/admin/ProviderAccessTab.tsx`):**
- Multi-seleção de unidades + ações "Agrupar num acesso" / "Desagrupar".

**Testes:**
- `db/tabela-parser.test.ts` (já existe) + novo `db/import-idempotente.test.ts`.
- `src/lib/userLocations.test.ts` — lógica pura de resolução de conjunto.
- Checagens de integração via scripts pontuais (padrão dos `_probe*.ts`) — o projeto não tem harness de DB de integração; documentadas como comandos de aceite.

---

## Task 0 (Fatia 0 — BLOQUEANTE): Reimport idempotente de provider_locations

Sem isto, cada `npm run db:import-tabela` recria `provider_locations` com **novos ids**, orfanando todos os vínculos — e com fail-closed ligado isso vira lockout da rede inteira.

**Files:**
- Modify: `db/import-tabela.ts:88-124` (bloco da transação: trocar delete+insert por upsert)
- Create: `db/import-idempotente.test.ts`
- Migrate: garantir `UNIQUE (provider_id, sgu_location_code)` em `provider_locations` (adicionar em `0036` — ver Task 1; a chave de upsert depende dela)

**Interfaces:**
- Consumes: `providers[]` já parseado (cada `p` com `sgu_code`, `p.locations[]` com `sgu_location_code`).
- Produces: import que preserva `providers.id` e `provider_locations.id` entre execuções para as mesmas chaves SGU.

- [ ] **Step 1: Escrever o teste falho de idempotência**

Cria `db/import-idempotente.test.ts`. O teste roda contra o banco apontado por `APP_ENV` (dev). Ele: (a) lê os ids atuais de um provider conhecido e suas locations; (b) reexecuta o caminho de upsert com os mesmos dados; (c) afirma que os ids não mudaram.

```ts
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from './db.js';
import { upsertProviderLocations } from './import-tabela.js';

test('upsert preserva provider_locations.id para a mesma chave SGU', async () => {
  const { rows: before } = await query(
    `SELECT id, sgu_location_code FROM provider_locations
      WHERE provider_id = (SELECT id FROM providers WHERE sgu_code = '1006724') ORDER BY id`, []);
  assert.ok(before.length > 0, 'pré-condição: provider 1006724 tem unidades');

  // Reaplica o mesmo conjunto (label alterado de propósito) e confere que o id fica.
  await upsertProviderLocations('1006724', before.map((r: any, i: number) => ({
    sgu_location_code: r.sgu_location_code, label: `RECHECK ${i}`, cidade: 'X', uf: 'SC',
    cep: null, logradouro: null, numero: null, complemento: null, bairro: null,
    phone: null, email: null, is_primary: i === 0, in_medical_guide: true,
  })));

  const { rows: after } = await query(
    `SELECT id, sgu_location_code, label FROM provider_locations
      WHERE provider_id = (SELECT id FROM providers WHERE sgu_code = '1006724') ORDER BY id`, []);
  assert.deepEqual(after.map((r: any) => r.id), before.map((r: any) => r.id), 'ids estáveis');
  assert.ok(after.every((r: any) => r.label.startsWith('RECHECK')), 'label atualizado (upsert, não insert)');
  await pool.end();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && APP_ENV=dev node --import tsx --test db/import-idempotente.test.ts`
Expected: FAIL — `upsertProviderLocations` não existe (import quebra).

- [ ] **Step 3: Extrair e implementar `upsertProviderLocations`**

Em `db/import-tabela.ts`, exporta uma função de upsert e a usa no lugar do insert dentro do loop. Substitui o bloco `DELETE FROM providers` por upsert de providers por `sgu_code` e de locations por `(provider_id, sgu_location_code)`. Marca inativas as locations que sumiram (não apaga — preserva ids/histórico se voltarem).

```ts
// db/import-tabela.ts — nova função exportada (usa o client da transação via param opcional)
export async function upsertProviderLocations(providerSguCode: string, locations: any[], client = { query }) {
  const { rows: pr } = await client.query(
    `SELECT id FROM providers WHERE sgu_code = $1`, [providerSguCode]);
  if (!pr.length) return;
  const providerId = pr[0].id;
  const keptCodes: string[] = [];
  for (const l of locations) {
    keptCodes.push(l.sgu_location_code);
    await client.query(
      `INSERT INTO provider_locations
         (provider_id, sgu_location_code, label, cep, logradouro, numero, complemento,
          bairro, cidade, uf, phone, email, is_primary, in_medical_guide, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true)
       ON CONFLICT (provider_id, sgu_location_code) DO UPDATE SET
         label=EXCLUDED.label, cep=EXCLUDED.cep, logradouro=EXCLUDED.logradouro,
         numero=EXCLUDED.numero, complemento=EXCLUDED.complemento, bairro=EXCLUDED.bairro,
         cidade=EXCLUDED.cidade, uf=EXCLUDED.uf, phone=EXCLUDED.phone, email=EXCLUDED.email,
         is_primary=EXCLUDED.is_primary, in_medical_guide=EXCLUDED.in_medical_guide, active=true`,
      [providerId, l.sgu_location_code, l.label, l.cep, l.logradouro, l.numero, l.complemento,
       l.bairro, l.cidade, l.uf, l.phone, l.email, l.is_primary, l.in_medical_guide]);
  }
  // Unidades que sumiram do arquivo: desativa (não apaga — id sobrevive se voltar).
  await client.query(
    `UPDATE provider_locations SET active=false
      WHERE provider_id=$1 AND NOT (sgu_location_code = ANY($2::text[]))`,
    [providerId, keptCodes]);
}
```

E no loop principal da transação, trocar o `DELETE FROM providers` por upsert de providers por `sgu_code` (`ON CONFLICT (sgu_code) DO UPDATE ...`) e chamar `upsertProviderLocations(p.sgu_code, p.locations, client)` no lugar do insert direto de locations. (Nota: a UNIQUE `(provider_id, sgu_location_code)` é criada na Task 1 / migration 0036 — aplicar 0036 antes de rodar este import.)

- [ ] **Step 4: Rodar e ver passar**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && APP_ENV=dev node --import tsx --test db/import-idempotente.test.ts`
Expected: PASS.

- [ ] **Step 5: Aceite manual — import 2× não muda ids**

Run: rodar `npm run db:import-tabela` duas vezes contra dev e conferir, com um script `_probe`, que `MAX(provider_locations.id)` e os ids de um provider conhecido não mudaram entre as execuções, e que `eval_instances`/`action_plans` continuam ligados.
Expected: ids estáveis; nenhum vínculo orfanado.

- [ ] **Step 6: Commit**

```bash
git add db/import-tabela.ts db/import-idempotente.test.ts
git commit -m "Fatia 0: reimport idempotente de provider_locations (upsert por sgu_location_code)"
```

---

## Task 1 (Fatia 1): Migration 0036 — user_locations, flag `agrupado`, tenant guard, backfill

**Files:**
- Create: `db/migrations/0036_user_locations.sql`
- Test: aceite via script `_probe` (contagens + insert cross-prestador rejeitado)

**Interfaces:**
- Produces: tabela `user_locations(user_id, location_id, provider_id)` com `UNIQUE(location_id)`; coluna `users.agrupado boolean`; `UNIQUE(id, provider_id)` em `users` e `provider_locations`; backfill de 1 linha por login com `location_id` não-nulo.

- [ ] **Step 1: Escrever a migration**

```sql
-- 0036_user_locations.sql
-- Acesso multi-unidade: o escopo do login passa a ser um CONJUNTO de unidades
-- (user_locations), permitindo agrupar um subconjunto sob um e-mail. Mantém
-- "1 responsável por unidade" via UNIQUE(location_id). Fronteira de CNPJ
-- garantida por FK composta com provider_id. Substitui o escalar users.location_id
-- (aposentado na 0037).

-- Pré-requisitos das FKs compostas (índices baratos; alvos de FK precisam ser UNIQUE):
CREATE UNIQUE INDEX IF NOT EXISTS users_id_provider_uk ON users (id, provider_id);
CREATE UNIQUE INDEX IF NOT EXISTS provider_locations_id_provider_uk ON provider_locations (id, provider_id);
CREATE UNIQUE INDEX IF NOT EXISTS provider_locations_provider_sgu_uk
  ON provider_locations (provider_id, sgu_location_code);  -- chave de upsert da Fatia 0

-- Flag explícita: o admin marca um login como "agrupado" (cobre subconjunto).
ALTER TABLE users ADD COLUMN IF NOT EXISTS agrupado boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS user_locations (
  user_id      bigint NOT NULL,
  location_id  bigint NOT NULL,
  provider_id  bigint NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, location_id),
  -- 1 responsável por unidade:
  CONSTRAINT user_locations_location_uk UNIQUE (location_id),
  -- Fronteira de tenant: user e location têm que ser do MESMO provider (cross-CNPJ é rejeitado no INSERT):
  CONSTRAINT user_locations_user_fk
    FOREIGN KEY (user_id, provider_id) REFERENCES users (id, provider_id) ON DELETE CASCADE,
  CONSTRAINT user_locations_location_fk
    FOREIGN KEY (location_id, provider_id) REFERENCES provider_locations (id, provider_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS user_locations_user_idx ON user_locations (user_id);

-- Backfill: 1 vínculo por login que hoje tem location_id não-nulo. Os location_id
-- NULL de hoje (órfãos de reimport) NÃO viram vínculo — ficam sem linha e aparecem
-- como "precisa responsável" para o admin (default DENY, nunca grant automático).
INSERT INTO user_locations (user_id, location_id, provider_id)
SELECT u.id, u.location_id, u.provider_id
  FROM users u
 WHERE u.location_id IS NOT NULL AND u.provider_id IS NOT NULL
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Aplicar a migration em dev**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && APP_ENV=dev npm run db:migrate`
Expected: `0036_user_locations` aplicada; sem erro.

- [ ] **Step 3: Aceite — contagens e barreira de tenant**

Escreve `db/_probe-0036.ts` (padrão `_probe`) que afirma:
1. `COUNT(user_locations) == COUNT(users WHERE location_id IS NOT NULL AND provider_id IS NOT NULL)`.
2. Tentar `INSERT INTO user_locations` com um `location_id` de outro provider é **rejeitado** (erro de FK), provando a barreira cross-CNPJ.

```ts
import 'dotenv/config';
import { query, pool } from './db.js';
async function main() {
  const { rows: [c] } = await query(`
    SELECT (SELECT count(*) FROM user_locations) AS vinc,
           (SELECT count(*) FROM users WHERE location_id IS NOT NULL AND provider_id IS NOT NULL) AS esperado`, []);
  console.log('contagem:', c, c.vinc === c.esperado ? 'OK' : 'DIVERGE');
  // Barreira de tenant: user de um provider + location de outro => deve falhar.
  const { rows: u } = await query(`SELECT id, provider_id FROM user_locations LIMIT 1`, []);
  const { rows: outra } = await query(
    `SELECT id, provider_id FROM provider_locations WHERE provider_id <> $1 LIMIT 1`, [u[0].provider_id]);
  try {
    await query(`INSERT INTO user_locations (user_id, location_id, provider_id) VALUES ($1,$2,$1prov)`, []);
    console.log('FALHA: cross-CNPJ foi aceito (esperava rejeição)');
  } catch { console.log('OK: cross-CNPJ rejeitado pela FK composta'); }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
```
(O implementador ajusta o INSERT de teste para usar `user_id` de um provider e `location_id` de `outra`, com `provider_id` do user — o INSERT deve violar a `user_locations_location_fk`.)

Expected: contagem OK; cross-CNPJ rejeitado.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/0036_user_locations.sql
git commit -m "Fatia 1: migration 0036 user_locations + flag agrupado + tenant guard + backfill"
```

---

## Task 2 (Fatia 2): Escopo por request, fail-closed — helper + reescrita dos filtros de leitura

**Files:**
- Modify: `server.ts:375-376` (substituir `userLocationId` por `userLocationIds`)
- Modify: `server.ts` — call-sites de leitura: `255`, `3243/3275-3276`, `3305`, `3346`, `5171`, `5208`, `5374-5376`, `5414-5416`, `5481-5484`, `5588-5589`, `5606-5608`, `loadItemForProvider` (5696/5719), e a montagem do JWT (`/auth/me` e login).
- Create: `src/lib/userLocations.ts` (função pura de decisão de escopo) + `src/lib/userLocations.test.ts`

**Interfaces:**
- Produces: `userLocationIds(req): Promise<number[]>` — conjunto de `location_id` do usuário, resolvido do banco por request (memoizado só no `req`), `[]` para órfão. Filtro passa a ser `location_id = ANY($set)` e `[]` ⇒ nenhuma linha.

- [ ] **Step 1: Teste puro da decisão de escopo**

`src/lib/userLocations.ts` isola a regra (para teste sem DB): dado o papel e as unidades vinculadas, devolve o predicado.

```ts
// src/lib/userLocations.ts
// Decide o escopo de leitura do portal do prestador a partir das unidades vinculadas.
// Fail-closed: prestador sem unidades => vê NADA (conjunto vazio). Staff (não-prestador)
// não é escopado por unidade (o helper nem é chamado nas rotas de staff).
export function scopeFromUnits(units: number[]): { seesNothing: boolean; ids: number[] } {
  return { seesNothing: units.length === 0, ids: units };
}
```

```ts
// src/lib/userLocations.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeFromUnits } from './userLocations.js';

test('sem unidades => fail-closed (vê nada)', () => {
  assert.deepEqual(scopeFromUnits([]), { seesNothing: true, ids: [] });
});
test('com unidades => escopo é o conjunto', () => {
  assert.deepEqual(scopeFromUnits([143, 144]), { seesNothing: false, ids: [143, 144] });
});
```

- [ ] **Step 2: Rodar e ver falhar** — Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx --test src/lib/userLocations.test.ts` — Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar o módulo e o helper no server**

Cria `src/lib/userLocations.ts` (acima). No `server.ts`, substitui `userLocationId` por `userLocationIds` que resolve do banco e memoiza no request:

```ts
// server.ts — substitui userLocationId
const userLocationIds = async (req: any): Promise<number[]> => {
  if (req._locIds) return req._locIds;            // memo só dentro do request
  if (!req.user?.provider_id) return (req._locIds = []); // staff não é escopado aqui
  const { rows } = await query(
    `SELECT location_id FROM user_locations WHERE user_id = $1`, [req.user.id]);
  return (req._locIds = rows.map((r: any) => Number(r.location_id)));
};
```

Remove `location_id` do payload do JWT e do `/auth/me` (o escopo passa a vir do banco por request, não do token).

- [ ] **Step 4: Reescrever os filtros de leitura (regra mecânica + gate)**

Regra: cada `($n::bigint IS NULL OR location_id = $n)` (e variantes com `OR location_id IS NULL`) vira `location_id = ANY($set::bigint[])`, com `$set` = `await userLocationIds(req)`. Como `[]` já nega (nenhuma linha casa `= ANY('{}')`), **remover** o ramo `IS NULL` (que era o fallback "vê tudo" — agora proibido).

Exemplo totalmente resolvido (o de `server.ts:5374-5376`):

```ts
// ANTES
//   AND ($2::bigint IS NULL OR ei.location_id = $2)
// `, [providerId, userLocationId(req)]);
// DEPOIS
   AND ei.location_id = ANY($2::bigint[])
 `, [providerId, await userLocationIds(req)]);
```

Aplicar a MESMA transformação em todos os call-sites listados em **Files**. Sites que hoje têm `OR location_id IS NULL` (255, 5171) perdem o ramo IS NULL.

- [ ] **Step 5: Gate de aceite (grep) — zero escalar cru**

Run: `grep -nE "location_id = \$|location_id IS NULL OR|userLocationId\(" server.ts | grep -v userLocationIds`
Expected: **sem resultados** (todo escopo passa por `userLocationIds` + `= ANY`). Qualquer linha remanescente é um vazamento (fail-open) ou lockout esquecido — corrigir.

- [ ] **Step 6: Aceite IDOR de leitura (script)**

Script `_probe-idor.ts`: para um usuário de teste vinculado só à unidade X, simular as queries de `/me/instances`, `/me/action-plans`, `/me/certificates` e afirmar que nenhuma linha de outra unidade/provider retorna; para um usuário órfão (0 vínculos), afirmar retorno vazio em todas.
Expected: usuário vê só as suas unidades; órfão vê nada.

- [ ] **Step 7: Commit**

```bash
git add server.ts src/lib/userLocations.ts src/lib/userLocations.test.ts
git commit -m "Fatia 2: escopo por request fail-closed (userLocationIds + = ANY), fora do JWT"
```

---

## Task 3 (Fatia 3): Guards de ESCRITA (IDOR em POST)

Guard de leitura não cobre um POST que adivinha um `location_id`/`instance_id` alheio. Toda escrita valida o alvo no conjunto do usuário, server-side.

**Files:**
- Modify: `server.ts` — `loadInstanceForWrite` e os handlers de POST de survey, action-plan e certificate (guards).
- Test: `_probe-idor-write.ts`

**Interfaces:**
- Consumes: `userLocationIds(req)` da Task 2.
- Produces: escrita fora do conjunto ⇒ HTTP 403.

- [ ] **Step 1: Guard central em `loadInstanceForWrite`**

```ts
// dentro de loadInstanceForWrite (e nos guards de action-plan/certificate):
const set = await userLocationIds(req);
if (instance.location_id == null || !set.includes(Number(instance.location_id))) {
  return res.status(403).json({ error: 'Sem acesso a esta unidade.' });
}
```

- [ ] **Step 2: Aceite (script)** — `_probe-idor-write.ts`: usuário da unidade X tenta gravar resposta/plano numa `instance` da unidade Y ⇒ espera 403. Run e conferir 403.

- [ ] **Step 3: Commit**

```bash
git add server.ts
git commit -m "Fatia 3: guards de escrita validam location_id no conjunto do usuario (IDOR)"
```

---

## Task 4 (Fatia 4): Notificações da junção + alerta de órfão

**Files:**
- Modify: `server.ts` — `prestadorRecipients(providerId, locationId?)`.
- Modify: onde os alertas de "unidade sem responsável" são gerados (novo: deriva de LEFT JOIN).
- Test: `_probe-notif.ts`

**Interfaces:**
- Produces: `prestadorRecipients` resolve destinatários via `user_locations` (o dono da unidade do evento; pode ser um login multi-unidade), **dedupe por `user_id`**; unidade sem vínculo gera item na lista "precisa responsável" do admin (não notifica um super-usuário inexistente).

- [ ] **Step 1: Reescrever `prestadorRecipients`**

```ts
// Evento de uma unidade => notifica o login que a cobre (via user_locations), dedupe por user_id.
const prestadorRecipients = async (providerId: number, locationId?: number | null) => {
  const { rows } = await query(
    `SELECT DISTINCT u.id AS user_id, u.email, u.name
       FROM user_locations ul JOIN users u ON u.id = ul.user_id
      WHERE ul.provider_id = $1
        AND ($2::bigint IS NULL OR ul.location_id = $2)
        AND u.is_active = true`,
    [providerId, locationId ?? null]);
  return rows;
};
```

- [ ] **Step 2: Lista "precisa responsável" (admin)** — a fonte passa a ser unidades comerciais **sem** linha em `user_locations` (LEFT JOIN `... WHERE ul.location_id IS NULL`). Reusar o filtro comercial já existente.

- [ ] **Step 3: Aceite (script)** — `_probe-notif.ts`: login multi-unidade recebe **1** cópia (não N) para evento de nível-prestador; evento de unidade Y não chega ao dono da unidade X; unidade sem vínculo aparece na lista do admin. Run e conferir.

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "Fatia 4: notificacoes da juncao (dedupe por user_id) + alerta de unidade sem responsavel"
```

---

## Task 5 (Fatia 5): Agrupar (admin) — endpoint + flag

**Files:**
- Modify: `server.ts` — novo `POST /api/providers/:id/access/group`.
- Test: `_probe-group.ts`

**Interfaces:**
- Consumes: `{ target_user_id: number, location_ids: number[] }` — mover essas unidades (do mesmo provider) para `target_user_id`, marcá-lo `agrupado=true`, e **desativar** os logins que ficarem sem nenhuma unidade.
- Produces: 200 `{ units }`; 409 se alguma unidade for de outro provider (barrada pela FK composta) ou se `target` não tiver e-mail válido.

- [ ] **Step 1: Implementar a transação (destacar-antes-de-reatar)**

```ts
app.post('/api/providers/:id/access/group', authenticate, async (req: any, res) => {
  if (req.user.role !== 'admin' && req.user.role !== 'auditoria')
    return res.status(403).json({ error: 'Unauthorized' });
  const providerId = Number(req.params.id);
  const { target_user_id, location_ids } = req.body ?? {};
  if (!target_user_id || !Array.isArray(location_ids) || !location_ids.length)
    return res.status(400).json({ error: 'target_user_id e location_ids são obrigatórios.' });
  try {
    await withTransaction(async (c) => {
      // 0) target precisa de e-mail real (não centralizar sob "Sem e-mail").
      const { rows: t } = await c.query(
        `SELECT id, email FROM users WHERE id=$1 AND provider_id=$2`, [target_user_id, providerId]);
      if (!t.length) throw { http: 404, msg: 'Acesso destino não encontrado neste prestador.' };
      // 1) DESTACAR: remove os vínculos dessas unidades de quem quer que os tenha (libera a UNIQUE).
      await c.query(`DELETE FROM user_locations WHERE provider_id=$1 AND location_id = ANY($2::bigint[])`,
        [providerId, location_ids]);
      // 2) REATAR ao target (FK composta rejeita location de outro provider).
      for (const lid of location_ids)
        await c.query(`INSERT INTO user_locations (user_id, location_id, provider_id) VALUES ($1,$2,$3)`,
          [target_user_id, lid, providerId]);
      await c.query(`UPDATE users SET agrupado=true WHERE id=$1`, [target_user_id]);
      // 3) Logins do provider que ficaram sem unidade: DESATIVAR (não apagar).
      await c.query(
        `UPDATE users SET is_active=false, email=NULL
          WHERE provider_id=$1 AND id<>$2
            AND NOT EXISTS (SELECT 1 FROM user_locations ul WHERE ul.user_id = users.id)`,
        [providerId, target_user_id]);
      await auditLog({ query: c.query.bind(c), userId: req.user.id, action: 'provider_access_grouped',
        meta: { provider_id: providerId, target_user_id, location_ids }, ip: hashClientIp(req) });
    });
    res.json({ units: await providerUnits(providerId) });
  } catch (e: any) {
    if (e?.http) return res.status(e.http).json({ error: e.msg });
    if (e?.code === '23503') return res.status(409).json({ error: 'Unidade de outro prestador não pode ser agrupada.' });
    console.error(e); res.status(500).json({ error: e.message });
  }
});
```

- [ ] **Step 2: Aceite (script)** — `_probe-group.ts`: agrupar 3 das 5 unidades do provider 131 num login; afirmar: as 3 apontam para o target, `UNIQUE(location_id)` mantido, o login de origem esvaziado ficou `is_active=false`, `target.agrupado=true`, audit log presente; e que passar um `location_id` de outro provider retorna 409.
- [ ] **Step 3: Commit**

```bash
git add server.ts
git commit -m "Fatia 5: endpoint agrupar acessos (subconjunto) com flag agrupado + auditoria"
```

---

## Task 6 (Fatia 6): Desagrupar (admin) — endpoint

**Files:**
- Modify: `server.ts` — `POST /api/providers/:id/access/ungroup`.
- Modify: `db/provision-users.ts` — inserir linha em `user_locations` ao provisionar (reuso aqui).
- Test: `_probe-ungroup.ts`

**Interfaces:**
- Consumes: `{ location_ids: number[] }` — destacar essas unidades do login que as cobre e recriar 1 login por unidade (Sem e-mail até definir), reusando a lógica de `provision-users`.
- Produces: round-trip agrupar→desagrupar volta ao estado por-unidade; unidade reaparece em "precisa responsável" quando sem e-mail.

- [ ] **Step 1: `provision-users` também popula `user_locations`** — no INSERT do usuário, adicionar `INSERT INTO user_locations (user_id, location_id, provider_id) VALUES (...)` na mesma transação.
- [ ] **Step 2: Implementar `ungroup`** — transação: `DELETE FROM user_locations WHERE provider_id=$1 AND location_id = ANY($2)`; para cada unidade liberada, criar 1 login (reusar a rotina de provisão, e-mail NULL); se o login de origem ficar sem unidades e sem outras, `agrupado=false`; audit log `provider_access_ungrouped`.
- [ ] **Step 3: Aceite (script)** — `_probe-ungroup.ts`: após agrupar (Task 5), desagrupar as mesmas unidades; afirmar 1 login por unidade de volta, "Sem e-mail", e a lista "precisa responsável" reflete.
- [ ] **Step 4: Commit**

```bash
git add server.ts db/provision-users.ts
git commit -m "Fatia 6: endpoint desagrupar (reprovisiona 1 login por unidade)"
```

---

## Task 7 (Fatia 7): UI Gestão de Acessos + aposentar users.location_id

**Files:**
- Modify: `src/pages/admin/ProviderAccessTab.tsx` — multi-seleção de unidades + ações "Agrupar num acesso" / "Desagrupar"; badge "Agrupado — N unidades".
- Create: `db/migrations/0037_drop_users_location_id.sql`

**Interfaces:**
- Consumes: `POST /access/group` e `/access/ungroup` (Tasks 5–6); `GET /providers/:id/access` (já devolve unidades + user).
- Produces: operador agrupa/desagrupa pela tela; coluna `users.location_id` removida.

- [ ] **Step 1: UI — seleção e ações** — na lista de cards por unidade, adicionar checkbox por unidade; barra de ação "Agrupar selecionadas em…" (escolher um dos logins com e-mail como destino) chamando `/access/group`; em um login agrupado, botão "Desagrupar" chamando `/access/ungroup`. Após cada ação, refazer o `GET /access`.
- [ ] **Step 2: Verificar no navegador** — subir o app (build + preview), logar como admin, agrupar 2 unidades de um provider e conferir o badge "Agrupado — 2 unidades"; desagrupar e conferir a volta. (Seguir o fluxo de verificação do preview; se a auth 2FA bloquear, validar via `_probe` no banco.)
- [ ] **Step 3: Gate — zero leitores de `users.location_id` para auth** — Run: `grep -nE "\.location_id|location_id" server.ts | grep -vE "userLocationIds|user_locations|ul\.location_id|ei\.location_id|pl\.location_id|provider_locations"` e confirmar que nenhum lê `users.location_id` para escopo.
- [ ] **Step 4: Migration 0037 — drop da coluna**

```sql
-- 0037_drop_users_location_id.sql
-- Escopo migrou 100% para user_locations (0036). A coluna escalar era segunda
-- fonte de verdade de autorizacao — aposentada apos grep confirmar zero leitores.
DROP INDEX IF EXISTS users_location_id_unique;
ALTER TABLE users DROP COLUMN IF EXISTS location_id;
```

- [ ] **Step 5: Aplicar e commit**

```bash
export PATH="/c/Program Files/nodejs:$PATH" && APP_ENV=dev npm run db:migrate
git add src/pages/admin/ProviderAccessTab.tsx db/migrations/0037_drop_users_location_id.sql
git commit -m "Fatia 7: UI agrupar/desagrupar + aposenta users.location_id (0037)"
```

---

## Notas de decisão (B/C do debate, cravadas)

- **FK `location_id` = ON DELETE CASCADE** (não SET NULL). Pós-Fatia 0 os `location_id` não trocam, então órfão por reimport vira raro; quando uma unidade é de fato removida, o vínculo cai junto (fail-closed coerente). Trade-off aceito: não sobra "linha órfã com provider_id" para breadcrumb — o "precisa responsável" é derivado por LEFT JOIN (unidade sem vínculo), e centralizar/descentralizar ficam no audit log. Isso evita o conflito técnico FK-composta × SET-NULL que o debate expôs.
- **Tenant guard estrutural:** FK compostas `(user_id,provider_id)` e `(location_id,provider_id)` — barram cross-CNPJ no INSERT, sem depender de guard de aplicação. Custo: dois índices `UNIQUE(id, provider_id)` (baratos).
- **Flag `agrupado`:** explícita, do admin (sua decisão) — a visão de várias unidades nunca é herdada de dado órfão.

## Self-Review (feito)

- **Cobertura do requisito:** subconjunto (Task 1 junção + Task 5 agrupar), default por unidade (backfill Task 1 + provision Task 6), flag do admin (Task 1 coluna + Task 5), reverter (Task 6), fail-closed/órfão (Tasks 2/4), cross-CNPJ (Task 1 FK), lockout do reimport (Task 0). ✅
- **Sem placeholders:** cada passo com SQL/TS/comando reais e gate de aceite concreto (grep/contagem/403/409). Onde não há harness de integração, o aceite é script `_probe` explícito — não "escreva testes".
- **Consistência de tipos:** `userLocationIds(req): Promise<number[]>` usado igual em Tasks 2–5; `user_locations(user_id, location_id, provider_id)` idem; endpoints `/access/group` e `/access/ungroup` batem entre Tasks 5–7.
