# Alertas de vencimento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Avisar o prestador (sininho + e-mail) 30 dias antes de um documento vencer e a cada 3 dias depois de vencido (teto de 10 avisos), reaproveitando o motor de notificação.

**Architecture:** Função pura `marcoVencimento` decide o marco de cada documento; uma etapa nova no `runNotificationJobs()` (job horário) varre o documento mais recente de cada `(prestador, tipo)` e dispara dois tipos de notificação novos via `notifyEvent`, com dedupe por marco. Dois tipos novos no catálogo de e-mail.

**Tech Stack:** TypeScript (ESM, imports com sufixo `.js`), `node:test`, Express, Postgres (`pg`). Sem libs novas.

## Global Constraints

- Imports relativos entre módulos TS usam sufixo `.js` (ESM/tsx). Ex.: `import { marcoVencimento } from './vencimentoAlertas.js'`.
- Testes rodam com `node --import tsx --test <arquivo>`; todo arquivo de teste novo entra no script `"test"` do `package.json`.
- Datas comparadas só por `YYYY-MM-DD` na **data local** (não UTC) — fórmula inline `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`, igual ao `statusDocumento`.
- Teto de avisos pós-vencimento: `TETO_AVISOS_VENCIDO = 10` (marcos 0…9).
- Link de destino dos avisos: `/documentos`.
- `documents` **não tem** coluna `location_id` → `prestadorRecipients(providerId, null)`.
- Status gravados em `documents`: `valido` (aprovado/vigente), `pendente`, `reprovado`, `vencido`, `historico`. Não existe `aprovado` gravado.

---

### Task 1: Função pura `marcoVencimento`

**Files:**
- Create: `src/lib/vencimentoAlertas.ts`
- Test: `src/lib/vencimentoAlertas.test.ts`
- Modify: `package.json` (adicionar o teste ao script `"test"`)

**Interfaces:**
- Produces:
  - `type MarcoVencimento = { tipo: 'vencendo' | 'vencido'; marco: string } | null`
  - `function marcoVencimento(doc: { expiry_date: string | null | undefined }, hoje?: Date): MarcoVencimento`
  - `const TETO_AVISOS_VENCIDO = 10`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/lib/vencimentoAlertas.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marcoVencimento, TETO_AVISOS_VENCIDO } from './vencimentoAlertas.js';

// hoje fixo (local): 2026-11-16
const hoje = new Date(2026, 10, 16);
const doc = (expiry_date: string | null) => ({ expiry_date });

test('sem validade → null', () => {
  assert.equal(marcoVencimento(doc(null), hoje), null);
});

test('vence em mais de 30 dias → null', () => {
  assert.equal(marcoVencimento(doc('2026-12-20'), hoje), null); // +34 dias
});

test('vence hoje → vencendo/aviso30 (borda inferior)', () => {
  assert.deepEqual(marcoVencimento(doc('2026-11-16'), hoje), { tipo: 'vencendo', marco: 'aviso30' });
});

test('vence em 30 dias → vencendo (borda superior)', () => {
  assert.deepEqual(marcoVencimento(doc('2026-12-16'), hoje), { tipo: 'vencendo', marco: 'aviso30' });
});

test('vence em 31 dias → null', () => {
  assert.equal(marcoVencimento(doc('2026-12-17'), hoje), null);
});

test('vencido há 0,1,2 dias → atraso:0', () => {
  assert.deepEqual(marcoVencimento(doc('2026-11-15'), hoje), { tipo: 'vencido', marco: 'atraso:0' }); // 1 dia
  assert.deepEqual(marcoVencimento(doc('2026-11-14'), hoje), { tipo: 'vencido', marco: 'atraso:0' }); // 2 dias
});

test('vencido há 3 dias → atraso:1', () => {
  assert.deepEqual(marcoVencimento(doc('2026-11-13'), hoje), { tipo: 'vencido', marco: 'atraso:1' }); // 3 dias
});

test('vencido há 27 dias → atraso:9 (último dentro do teto)', () => {
  assert.deepEqual(marcoVencimento(doc('2026-10-20'), hoje), { tipo: 'vencido', marco: 'atraso:9' }); // 27 dias
});

test('vencido há 29 dias → atraso:9 (ainda dentro do teto)', () => {
  assert.deepEqual(marcoVencimento(doc('2026-10-18'), hoje), { tipo: 'vencido', marco: 'atraso:9' }); // 29 dias
});

test('vencido há 30 dias → null (passou do teto)', () => {
  assert.equal(marcoVencimento(doc('2026-10-17'), hoje), null); // 30 dias → n=10 > 9
});

test('teto exportado é 10', () => {
  assert.equal(TETO_AVISOS_VENCIDO, 10);
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `node --import tsx --test src/lib/vencimentoAlertas.test.ts`
Expected: FAIL (módulo `./vencimentoAlertas.js` não existe).

- [ ] **Step 3: Implementar o mínimo**

Create `src/lib/vencimentoAlertas.ts`:

```ts
// Decide o marco de aviso de vencimento de um documento, a partir da data de validade
// e da data local de hoje. Puro e testável; o job (server.ts) injeta `hoje`.
// - vence em até 30 dias (inclusive hoje) → { 'vencendo', 'aviso30' } (aviso único).
// - já vencido, até o teto → { 'vencido', 'atraso:' + floor(diasVencido/3) } (marcos 0…9).
// - caso contrário → null. Datas comparadas só por YYYY-MM-DD local (sem drift de UTC).

export type MarcoVencimento = { tipo: 'vencendo' | 'vencido'; marco: string } | null;

export const TETO_AVISOS_VENCIDO = 10; // marcos 0…9 → avisos a cada 3 dias por ~30 dias

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function marcoVencimento(
  doc: { expiry_date: string | null | undefined },
  hoje: Date = new Date(),
): MarcoVencimento {
  if (!doc.expiry_date) return null;
  const hojeStr = ymdLocal(hoje);
  const exp = doc.expiry_date.slice(0, 10);

  if (exp >= hojeStr) {
    // vence hoje ou no futuro: só avisa dentro da janela de 30 dias.
    const limite = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 30);
    if (exp <= ymdLocal(limite)) return { tipo: 'vencendo', marco: 'aviso30' };
    return null;
  }

  // já vencido: dias inteiros de atraso pela diferença de datas locais (meia-noite).
  const [ey, em, ed] = exp.split('-').map(Number);
  const expMid = new Date(ey, em - 1, ed);
  const hojeMid = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const diasVencido = Math.round((hojeMid.getTime() - expMid.getTime()) / 86400000);
  const n = Math.floor(diasVencido / 3);
  if (n < TETO_AVISOS_VENCIDO) return { tipo: 'vencido', marco: `atraso:${n}` };
  return null;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `node --import tsx --test src/lib/vencimentoAlertas.test.ts`
Expected: PASS (todos os testes).

- [ ] **Step 5: Registrar o teste no script `test`**

Em `package.json`, no fim do valor do script `"test"`, antes da aspa final, acrescentar:
` src/lib/vencimentoAlertas.test.ts`
(um espaço separando do último arquivo, `src/lib/painelMetrics.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/vencimentoAlertas.ts src/lib/vencimentoAlertas.test.ts package.json
git commit -m "feat(documentos): marcoVencimento — marco de aviso 30d antes + a cada 3d (teto 10)"
```

---

### Task 2: Tipos de notificação `documento_vencendo` e `documento_vencido`

**Files:**
- Modify: `src/lib/notifyCatalog.ts` (array `NOTIFY_TYPES`, mapa `NOTIFY_TYPE_LABELS`, switch de `renderNotification`)
- Modify: `src/lib/notifyEmail.ts` (switch de `notificationBlocks`)
- Modify: `src/lib/notifyEmail.test.ts` (exceção de CTA)

**Interfaces:**
- Consumes: nada da Task 1 (independente).
- Produces: dois `NotifyType` novos — `'documento_vencendo'`, `'documento_vencido'` — usados pelo job na Task 3. Contexto: `{ tipo: string; expiry_date: string; dias?: number }`.

- [ ] **Step 1: Atualizar o teste de e-mail (exceção de CTA) — falha primeiro**

Em `src/lib/notifyEmail.test.ts`, trocar a linha 22:

```ts
    const ctaEsperado = t === 'documento_atualizacao' ? `${APP}/documentos` : `${APP}/qualificacao`;
```

por:

```ts
    const ctaEsperado = (['documento_atualizacao', 'documento_vencendo', 'documento_vencido'] as string[]).includes(t)
      ? `${APP}/documentos` : `${APP}/qualificacao`;
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `node --import tsx --test src/lib/notifyEmail.test.ts`
Expected: FAIL — ao iterar `NOTIFY_TYPES` os novos tipos ainda não existem / o CTA não bate (TypeError ou assert falhando). (Se `NOTIFY_TYPES` ainda não tiver os tipos, o teste falha no `tsc`/execução; isso é esperado — seguimos para os steps de implementação.)

- [ ] **Step 3: Registrar os tipos em `notifyCatalog.ts`**

No array `NOTIFY_TYPES` (termina em `'documento_atualizacao',`), acrescentar na última linha:

```ts
  'ciclo_encerrado_sem_avaliacao', 'senha_solicitada', 'documento_atualizacao',
  'documento_vencendo', 'documento_vencido',
```

No mapa `NOTIFY_TYPE_LABELS`, antes do `}` de fechamento, acrescentar:

```ts
  documento_vencendo: 'Documento a vencer',
  documento_vencido: 'Documento vencido',
```

- [ ] **Step 4: Adicionar os cases no `renderNotification` (`notifyCatalog.ts`)**

No `switch (type)` de `renderNotification`, logo após o `case 'documento_atualizacao':` (que termina com `};`), inserir:

```ts
    case 'documento_vencendo':
      return { title: 'Documento próximo do vencimento',
               body: `Seu documento "${ctx.tipo ?? ''}" vence em ${fmtDate(ctx.expiry_date)}. Envie a versão atualizada pelo portal.`,
               link: '/documentos' };
    case 'documento_vencido':
      return { title: 'Documento vencido',
               body: `Seu documento "${ctx.tipo ?? ''}" venceu em ${fmtDate(ctx.expiry_date)}${ctx.dias ? ` (há ${ctx.dias} dias)` : ''}. Reenvie o quanto antes pelo portal.`,
               link: '/documentos' };
```

- [ ] **Step 5: Adicionar os blocos de e-mail no `notificationBlocks` (`notifyEmail.ts`)**

No `switch (type)` de `notificationBlocks`, logo após o `case 'documento_atualizacao':` (que termina com `break;`), inserir:

```ts
    case 'documento_vencendo':
      b = {
        banner: 'Documento próximo do vencimento',
        paragraphs: [`Seu documento **${ctx.tipo ?? ''}** vence em **${fmtDate(ctx.expiry_date) || '—'}**. Para manter seu cadastro regular, envie a versão atualizada pelo portal.`],
        highlight: { label: 'Vence em', value: fmtDate(ctx.expiry_date) || '—', iconImg: `${appUrl}/calendario.png` },
        steps: 'acesse a área de documentos no portal e envie a nova versão do documento antes do vencimento.',
        cta: { label: 'Enviar documento', url: `${appUrl}/documentos` },
      };
      break;
    case 'documento_vencido':
      b = {
        banner: 'Documento vencido',
        paragraphs: [`Seu documento **${ctx.tipo ?? ''}** venceu em **${fmtDate(ctx.expiry_date) || '—'}**${ctx.dias ? ` (há ${ctx.dias} dias)` : ''}. Reenvie o quanto antes para regularizar seu cadastro.`],
        highlight: { label: 'Venceu em', value: fmtDate(ctx.expiry_date) || '—', iconImg: `${appUrl}/calendario.png` },
        steps: 'acesse a área de documentos no portal e envie a nova versão do documento vencido.',
        cta: { label: 'Enviar documento', url: `${appUrl}/documentos` },
      };
      break;
```

- [ ] **Step 6: Rodar os testes e ver passar**

Run: `node --import tsx --test src/lib/notifyEmail.test.ts src/lib/notifyCatalog.test.ts`
Expected: PASS. (O teste genérico cobre subject/HTML/CTA dos dois tipos novos; o CTA deve apontar para `${APP}/documentos`.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/notifyCatalog.ts src/lib/notifyEmail.ts src/lib/notifyEmail.test.ts
git commit -m "feat(documentos): tipos de notificacao documento_vencendo e documento_vencido"
```

---

### Task 3: Etapa de varredura no job de notificações

**Files:**
- Modify: `server.ts` (função `runNotificationJobs`, inserir etapa nova antes do retry do outbox)

**Interfaces:**
- Consumes: `marcoVencimento`, `TETO_AVISOS_VENCIDO` da Task 1 (import no topo do `server.ts`); `notifyEvent`, `prestadorRecipients` (já existem); tipos `documento_vencendo`/`documento_vencido` da Task 2.
- Produces: nenhum símbolo novo exportado (efeito colateral: disparo de avisos).

- [ ] **Step 1: Importar a função pura no topo do `server.ts`**

Junto aos outros imports de `./src/lib/*` no topo do arquivo, adicionar:

Junto do `import { statusDocumento } from './src/lib/documentoStatus.js';` (linha ~36), adicionar:

```ts
import { marcoVencimento } from './src/lib/vencimentoAlertas.js';
```

- [ ] **Step 2: Inserir a etapa de varredura de documentos**

Em `runNotificationJobs()`, logo **após** o bloco `// 4) Certificado a vencer…` (o `for (const ct of certs) { … }`) e **antes** do `// 5) Retry do outbox…`, inserir:

```ts
      // 5) Documento de gestão documental a vencer / vencido — prestador.
      //    Só o documento mais recente de cada (prestador, tipo) com validade e status
      //    vigente; marcoVencimento decide o aviso (30 dias antes, 1x; a cada 3 dias
      //    após vencer, teto de 10). dedupeRef garante disparo único por marco.
      const { rows: docsVenc } = await query(`
        SELECT DISTINCT ON (d.provider_id, d.type_id)
               d.id, d.provider_id, d.type, d.expiry_date
          FROM documents d
         WHERE d.type_id IS NOT NULL
           AND d.expiry_date IS NOT NULL
           AND d.status IN ('valido','vencido')
         ORDER BY d.provider_id, d.type_id, d.upload_date DESC, d.id DESC`);
      for (const d of docsVenc) {
        const m = marcoVencimento({ expiry_date: d.expiry_date });
        if (!m) continue;
        const recipients = await prestadorRecipients(Number(d.provider_id), null);
        if (m.tipo === 'vencendo') {
          await notifyEvent('documento_vencendo', { tipo: d.type, expiry_date: d.expiry_date },
            recipients, { providerId: Number(d.provider_id), dedupeRef: `doc:${d.id}:${m.marco}` });
        } else {
          const dias = Math.round((Date.now() - new Date(d.expiry_date).getTime()) / 86400000);
          await notifyEvent('documento_vencido', { tipo: d.type, expiry_date: d.expiry_date, dias },
            recipients, { providerId: Number(d.provider_id), dedupeRef: `doc:${d.id}:${m.marco}` });
        }
      }
```

Renumerar o comentário do retry de `// 5)` para `// 6)` para manter a sequência.

- [ ] **Step 3: Verificar compilação (tsc)**

Run: `npm run lint`
Expected: sem erros (0 saída de erro). Corrigir caminho de import ou tipos se acusar.

- [ ] **Step 4: Verificar a query contra o DEV (sanidade, sem enviar e-mail)**

Rodar um SELECT da mesma query no banco DEV e conferir que retorna só o documento mais recente por (prestador, tipo) com validade e status `valido/vencido`:

```bash
APP_ENV=dev node --import tsx -e "import('./db/db.js').then(async ({query,pool})=>{const {rows}=await query(\"SELECT DISTINCT ON (d.provider_id,d.type_id) d.id,d.provider_id,d.type,d.expiry_date,d.status FROM documents d WHERE d.type_id IS NOT NULL AND d.expiry_date IS NOT NULL AND d.status IN ('valido','vencido') ORDER BY d.provider_id,d.type_id,d.upload_date DESC,d.id DESC\");console.table(rows);await pool.end();})"
```

Expected: linhas com datas de validade; nenhuma com status fora de `valido/vencido`. (Não dispara nada — é só leitura.)

- [ ] **Step 5: Commit**

```bash
git add server.ts
git commit -m "feat(documentos): job varre documentos e dispara avisos de vencimento"
```

---

## Capstone (após as 3 tasks)

- [ ] `npm test` — toda a suíte verde (inclui `vencimentoAlertas.test.ts` e os de e-mail).
- [ ] `npm run lint` — `tsc` limpo.
- [ ] `npm run build` — build do cliente ok.
- [ ] Revisão final da branch (requesting-code-review) + correções.
- [ ] Push da `dev` só após o OK da Katy.

## Notas de verificação

- O risco real (lógica de marco/bordas/teto) está coberto por teste puro na Task 1.
- O disparo (SQL + `notifyEvent` + dedupe) espelha exatamente as etapas 1–4 já existentes e é verificado por `tsc` + build + o SELECT de sanidade do Step 4 da Task 3. Smoke de e-mail real é opcional (depende de um documento vencido recente no DEV; os dados semeados cobrem `vencendo`).
