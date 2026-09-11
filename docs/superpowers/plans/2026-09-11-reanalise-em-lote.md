# Reanálise em lote — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reanálise deixa de ser item-a-item em tempo real: itens marcados viram rascunho e são devolvidos ao prestador de uma única vez, com uma notificação listando os critérios (spec `docs/superpowers/specs/2026-09-11-reanalise-em-lote-design.md`).

**Architecture:** `auditorAction('solicitou_reanalise')` perde o flip de instância e a notificação; novo `POST /eval/instances/:id/enviar-reanalise` faz o flip + 1 notificação em lote; GET da instância mascara rascunhos para o prestador durante `em_analise`; catálogo ganha variante em lote; AuditorPlayer ganha o botão "Devolver para reanálise (N)".

**Tech Stack:** Express + pg (server.ts), catálogo puro (src/lib/notifyCatalog.ts + teste node), React (AuditorPlayer.tsx).

## Global Constraints

- Node fora do PATH: prefixar `export PATH="/c/Program Files/nodejs:$PATH"`.
- Branch `dev`; commits com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Sem migration nesta feature.

---

### Task 1: Catálogo — variante em lote de reanalise_solicitada (TDD)

**Files:**
- Modify: `src/lib/notifyCatalog.ts`
- Test: `src/lib/notifyCatalog.test.ts`

**Interfaces:**
- Produces: `renderNotification('reanalise_solicitada', { items: [{code, text}], end_date })` → título `Reanálise solicitada — N critério(s)`, corpo com a lista (item truncado a 90 chars, máx. 15 itens + "… e mais X critério(s)") e prazo. Variantes `integral` e `question_code` inalteradas.

- [ ] **Step 1: Teste falhando** — acrescentar após o teste 'reanálise: integral vs por critério':

```ts
test('reanálise em lote: uma notificação com a lista de critérios', () => {
  const n = renderNotification('reanalise_solicitada', {
    items: [
      { code: '1.1.1', text: 'Dispõe de alvará de funcionamento válido e expedido pelo órgão competente?' },
      { code: '2.3.4', text: 'X'.repeat(200) },
    ],
    end_date: '2026-12-31',
  });
  assert.equal(n.title, 'Reanálise solicitada — 2 critérios');
  assert.ok(n.body.includes('1.1.1 — Dispõe de alvará'), n.body);
  assert.ok(!n.body.includes('X'.repeat(120)), 'texto do item deve ser truncado');
  assert.ok(n.body.includes('31/12/2026'), n.body);
});

test('reanálise em lote: lista longa é limitada a 15 itens', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ code: `1.${i}`, text: `Critério ${i}` }));
  const n = renderNotification('reanalise_solicitada', { items });
  assert.ok(n.body.includes('e mais 5 critério(s)'), n.body);
  assert.ok(!n.body.includes('Critério 19'), n.body);
});
```

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx --test src/lib/notifyCatalog.test.ts`
Expected: FAIL (variante não existe — cai no ramo por critério).

- [ ] **Step 2: Implementar** — no case `'reanalise_solicitada'` de `renderNotification`, ANTES do ternário atual, tratar `ctx.items`:

```ts
    case 'reanalise_solicitada': {
      const prazoRe = ctx.end_date ? ` O prazo para reenvio termina em ${fmtDate(ctx.end_date)}.` : '';
      if (Array.isArray(ctx.items) && ctx.items.length) {
        const MAX = 15;
        const trunc = (s: string) => (s.length > 90 ? `${s.slice(0, 90)}…` : s);
        const lines = ctx.items.slice(0, MAX).map((it: any) => `${it.code} — ${trunc(String(it.text ?? ''))}`);
        const resto = ctx.items.length - MAX;
        const plural = ctx.items.length === 1 ? 'critério' : 'critérios';
        return {
          title: `Reanálise solicitada — ${ctx.items.length} ${plural}`,
          body: `O auditor devolveu ${ctx.items.length} ${plural} da sua avaliação para reanálise: ${lines.join('; ')}${resto > 0 ? `; … e mais ${resto} critério(s)` : ''}. Ajuste as evidências e reenvie.${prazoRe}`,
          link,
        };
      }
      return ctx.integral
        ? { title: 'Avaliação devolvida para reanálise',
            body: `O auditor devolveu sua avaliação. Revise os critérios apontados e reenvie.${prazoRe}`, link }
        : { title: `Reanálise solicitada — critério ${ctx.question_code ?? ''}`.trim(),
            body: `O auditor solicitou reanálise de um critério da sua avaliação. Ajuste a evidência e reenvie.${prazoRe}`, link };
    }
```
(o `const prazoRe` interno atual do case é substituído por esse único no topo do case.)

- [ ] **Step 3: Testes passam + commit**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx --test src/lib/notifyCatalog.test.ts`
Expected: PASS (13 testes).
```bash
git add src/lib/notifyCatalog.ts src/lib/notifyCatalog.test.ts
git commit -m "Notificações: reanalise_solicitada em lote (lista de critérios)"
```

---

### Task 2: Server — rascunho, envio em lote e máscara

**Files:**
- Modify: `server.ts` — (a) `auditorAction` (remover flip + notificação por item); (b) novo endpoint após as rotas de answers (~linha 5270); (c) máscara no `GET /api/eval/instances/:id` (~linha 3659).

**Interfaces:**
- Consumes: Task 1 (`renderNotification` via `notifyEvent`); helpers `isStaff`, `withTransaction`, `auditLog`, `hashClientIp`, `notifyEvent`, `prestadorRecipients`, `instanceCycleEnd`; `questionOnly` de `./src/lib/questionText.js`.
- Produces (para a Task 3): `POST /api/eval/instances/:id/enviar-reanalise` → `{success:true, sent:number}`; 409 `status X não permite` / `nenhum critério marcado para reanálise`.

- [ ] **Step 1: auditorAction** — remover o bloco do flip:

```ts
        if (action === 'solicitou_reanalise' && ans.instance_status === 'em_analise') {
          await client.query(
            `UPDATE eval_instances SET status = 'aguardando_evidencia' WHERE id = $1`,
            [ans.instance_id]
          );
        }
```
e remover o bloco inteiro `if (action === 'solicitou_reanalise') { void (async () => { ... notifyEvent('reanalise_solicitada', ...) ...} }` após o auditLog. Deixar comentário curto: `// Reanálise agora é rascunho: flip + notificação acontecem no POST /enviar-reanalise (lote).`

- [ ] **Step 2: Endpoint enviar-reanalise** — inserir após a linha das 4 rotas `app.post('/api/eval/answers/:id/...')`:

```ts
  // Devolve ao prestador, DE UMA VEZ, todos os critérios marcados para reanálise
  // (spec 2026-09-11): flipa a instância e envia uma única notificação com a lista.
  app.post('/api/eval/instances/:id/enviar-reanalise', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const id = Number(req.params.id);
      const { rows: [inst] } = await query(
        'SELECT id, status, provider_id, location_id FROM eval_instances WHERE id = $1', [id]);
      if (!inst) return res.status(404).json({ error: 'instance not found' });
      if (inst.status !== 'em_analise') {
        return res.status(409).json({ error: `status ${inst.status} não permite devolver para reanálise` });
      }
      const { rows: marked } = await query(`
        SELECT eq.code, eq.text
          FROM eval_answers ea
          JOIN eval_questions eq ON eq.id = ea.question_id
         WHERE ea.instance_id = $1 AND ea.evidence_status = 'aguardando_reanalise'
         ORDER BY eq.code
      `, [id]);
      if (!marked.length) return res.status(409).json({ error: 'nenhum critério marcado para reanálise' });

      await query(`UPDATE eval_instances SET status = 'aguardando_evidencia' WHERE id = $1`, [id]);

      await auditLog({
        query, userId: req.user.id, action: 'reanalise_enviada',
        meta: { instance_id: id, provider_id: Number(inst.provider_id), location_id: inst.location_id ?? null, count: marked.length },
        ip: hashClientIp(req),
      });

      void (async () => {
        const items = marked.map((m: any) => ({ code: m.code, text: questionOnly(m.text ?? '') }));
        await notifyEvent('reanalise_solicitada',
          { items, end_date: await instanceCycleEnd(id) },
          await prestadorRecipients(Number(inst.provider_id), inst.location_id ?? null),
          { providerId: Number(inst.provider_id), dedupeRef: `reanalise-lote:${id}:${Date.now()}` });
      })().catch((e) => console.error('[notify] site reanalise_solicitada (lote):', e));

      res.json({ success: true, sent: marked.length });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
```
Import: acrescentar `questionOnly` — `import { questionOnly } from './src/lib/questionText.js';` junto dos imports de src/lib no topo (conferir o nome do módulo/função com `grep -n "questionOnly" src/lib/*.ts`).

- [ ] **Step 3: Máscara no GET** — em `GET /api/eval/instances/:id`, após carregar `answers` e `iterations`, antes do `res.json`:

```ts
      // Reanálise em lote (spec 2026-09-11): enquanto a análise não é devolvida, o
      // prestador não vê os rascunhos de reanálise — item aparece como 'pendente',
      // sem observação do auditor e sem a iteração de solicitação no histórico.
      let visibleAnswers = answers;
      let visibleIterations = iterations;
      const isProviderViewer = viewerRole !== 'admin' && viewerRole !== 'auditoria';
      if (isProviderViewer && instance.status === 'em_analise') {
        const maskedIds = new Set(
          (answers as any[]).filter(a => a.evidence_status === 'aguardando_reanalise').map(a => Number(a.id)));
        visibleAnswers = (answers as any[]).map(a => maskedIds.has(Number(a.id))
          ? { ...a, evidence_status: 'pendente', auditor_observation: null }
          : a);
        visibleIterations = (iterations as any[]).filter(
          it => !(maskedIds.has(Number(it.answer_id)) && it.action === 'solicitou_reanalise'));
      }

      res.json({ ...instance, answers: visibleAnswers, evidences, iterations: visibleIterations });
```
(substitui o `res.json({ ...instance, answers, evidences, iterations })` atual.)

- [ ] **Step 4: Lint + suíte + commit**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && npm run lint && npm test 2>&1 | grep -E "pass |fail "`
Expected: sem erro de tipo; todos passam.
```bash
git add server.ts
git commit -m "Reanálise em lote: rascunho no auditorAction, POST /enviar-reanalise e máscara pro prestador"
```

---

### Task 3: AuditorPlayer — botão "Devolver para reanálise (N)" + badge

**Files:**
- Modify: `src/pages/qualificacao/AuditorPlayer.tsx`

**Interfaces:**
- Consumes: endpoint da Task 2.

- [ ] **Step 1: Contagem e ação** — junto das outras ações (`act`, `emitirParecer`):

```ts
  const reanaliseDrafts = useMemo(
    () => Object.values(answersByQ).filter((a: any) => a?.evidence_status === 'aguardando_reanalise'),
    [answersByQ]);

  const enviarReanalise = async () => {
    const codes = reanaliseDrafts
      .map((a: any) => questions.find((q: any) => q.id === a.question_id)?.code)
      .filter(Boolean).sort();
    if (!confirm(`Devolver ${reanaliseDrafts.length} critério(s) para reanálise?\n\n${codes.join(', ')}\n\nO prestador receberá uma única notificação com a lista e poderá reeditar esses critérios.`)) return;
    setBusy(true);
    try {
      const r = await fetchApi(`/eval/instances/${instanceId}/enviar-reanalise`, { method: 'POST' });
      alert(`${r.sent} critério(s) devolvido(s) para reanálise.`);
      await load(true);
    } catch (e: any) {
      alert(e?.message || 'Erro ao devolver para reanálise');
    } finally {
      setBusy(false);
    }
  };
```
(conferir os nomes reais de `answersByQ`/`questions` no arquivo; usar as coleções existentes.)

- [ ] **Step 2: Botão no header** — dentro do `<div className="flex shrink-0 items-center gap-2">`, antes do bloco `readOnly ? ... : (Emitir Parecer)`:

```tsx
            {!readOnly && instance?.status === 'em_analise' && reanaliseDrafts.length > 0 && (
              <button
                onClick={enviarReanalise}
                disabled={busy || loading}
                title="Devolver ao prestador todos os critérios marcados para reanálise — envia uma única notificação"
                className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-amber-600 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                Devolver para reanálise ({reanaliseDrafts.length})
              </button>
            )}
```
Import `RotateCcw` do lucide-react se ainda não houver.

- [ ] **Step 3: Badge "a enviar"** — na função de pill de status (~linha 160), o rótulo de `aguardando_reanalise` passa a depender do status da instância: quando `em_analise` → `'Reanálise — a enviar'`; senão `'Aguardando Reanálise'`. Implementar passando o status da instância à função (ou computando o label no ponto de uso).

- [ ] **Step 4: Lint + commit**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && npm run lint`
```bash
git add src/pages/qualificacao/AuditorPlayer.tsx
git commit -m "AuditorPlayer: botão Devolver para reanálise (lote) e badge de rascunho"
```

---

### Task 4: Verificação (dry-run) + push

- [ ] **Step 1: Dry-run transacional no dev**: instância com status `em_analise` (criar cenário na transação: pegar instância qualquer, setar `em_analise`, marcar 2 answers como `aguardando_reanalise`); simular a máscara (query do GET) como prestador → itens aparecem `pendente`; rodar o UPDATE do enviar-reanalise → flip; conferir que `renderNotification` com os items gera 1 notificação com os 2 códigos; ROLLBACK.
- [ ] **Step 2: Suíte completa** verde.
- [ ] **Step 3:** `git push origin dev`.
- [ ] **Step 4:** Atualizar memória (fluxo de reanálise mudou; sem migration).
