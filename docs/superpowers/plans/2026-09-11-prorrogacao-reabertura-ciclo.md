# Prorrogação e reabertura de ciclo encerrado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botões Reabrir/Prorrogar em Qualificação → Ciclos que reativam um ciclo encerrado restaurando as avaliações `ciclo_encerrado` ao status anterior, com notificação `ciclo_reaberto` (spec `docs/superpowers/specs/2026-09-11-prorrogacao-reabertura-ciclo-design.md`).

**Architecture:** Coluna `eval_instances.status_before_close` preenchida no encerramento; `reopenCycleCore` + `POST /api/eval/cycles/:id/reabrir` restauram e notificam; PATCH `active=true` bloqueado para ciclo encerrado com instâncias; UI na lista de ciclos + ajuste no modal.

**Tech Stack:** Express + pg (server.ts), React (CiclosAdmin.tsx, NovoCicloModal.tsx), catálogo puro de notificações (src/lib/notifyCatalog.ts + teste node).

## Global Constraints

- Node fora do PATH: prefixar `export PATH="/c/Program Files/nodejs:$PATH"`.
- Branch `dev`; commits com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Verificação de endpoint: dry-run transacional no banco dev (sem harness HTTP).
- ⚠️ Migration 0048 obrigatória ao promover homolog/prod.

---

### Task 1: Migration 0048 + gravar status anterior no encerramento

**Files:**
- Create: `db/migrations/0048_eval_instances_status_before_close.sql`
- Modify: `server.ts` — UPDATE do `closeCycleCore` e UPDATE do PATCH `active=false`

**Interfaces:**
- Produces: coluna `eval_instances.status_before_close TEXT NULL`, preenchida com o status pré-encerramento.

- [ ] **Step 1: Migration**

```sql
-- 0048_eval_instances_status_before_close.sql
-- Guarda o status vigente quando o ciclo encerra, para a reabertura/prorrogação
-- (spec 2026-09-11) restaurar com fidelidade. NULL = instância nunca encerrada
-- por ciclo, ou encerrada antes desta migration (reabertura usa fallback).
ALTER TABLE eval_instances ADD COLUMN IF NOT EXISTS status_before_close TEXT;
```

Run: `export PATH="/c/Program Files/nodejs:$PATH" && npm run db:migrate`
Expected: `+ aplicada: 0048_eval_instances_status_before_close.sql`

- [ ] **Step 2: closeCycleCore grava o status anterior** — no UPDATE dentro de `withTransaction` (~linha 5004), trocar:

```sql
        `UPDATE eval_instances
            SET status = 'ciclo_encerrado', completed_at = COALESCE(completed_at, now())
          WHERE cycle_id = $1
            AND status NOT IN ('aprovado', 'reprovado', 'finalizado')`,
```
por:
```sql
        `UPDATE eval_instances
            SET status_before_close = status,
                status = 'ciclo_encerrado', completed_at = COALESCE(completed_at, now())
          WHERE cycle_id = $1
            AND status NOT IN ('aprovado', 'reprovado', 'finalizado')`,
```

- [ ] **Step 3: PATCH active=false idem** — no UPDATE do PATCH `/api/eval/cycles/:id` (~linha 4352), trocar:

```sql
          `UPDATE eval_instances
              SET status = 'ciclo_encerrado', completed_at = COALESCE(completed_at, now())
            WHERE cycle_id = $1
              AND status NOT IN ('aprovado', 'reprovado', 'finalizado', 'ciclo_encerrado')`,
```
por:
```sql
          `UPDATE eval_instances
              SET status_before_close = status,
                  status = 'ciclo_encerrado', completed_at = COALESCE(completed_at, now())
            WHERE cycle_id = $1
              AND status NOT IN ('aprovado', 'reprovado', 'finalizado', 'ciclo_encerrado')`,
```

- [ ] **Step 4: Lint + commit**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && npm run lint`
```bash
git add db/migrations/0048_eval_instances_status_before_close.sql server.ts
git commit -m "Ciclos: migration 0048 + encerramento grava status_before_close"
```

---

### Task 2: Notificação ciclo_reaberto no catálogo (TDD)

**Files:**
- Modify: `src/lib/notifyCatalog.ts`
- Test: `src/lib/notifyCatalog.test.ts`

**Interfaces:**
- Produces: tipo `'ciclo_reaberto'` em `NOTIFY_TYPES`; `renderNotification('ciclo_reaberto', {cycle_label, end_date})` → título "Ciclo {label} reaberto — prazo prorrogado", corpo com a data em dd/mm/aaaa.

- [ ] **Step 1: Teste falhando** — acrescentar em `src/lib/notifyCatalog.test.ts` (seguir o padrão dos casos existentes):

```ts
test('ciclo_reaberto: título com label e corpo com o novo prazo', () => {
  const n = renderNotification('ciclo_reaberto', { cycle_label: 'Ciclo 2026', end_date: '2026-10-15' });
  assert.equal(n.title, 'Ciclo Ciclo 2026 reaberto — prazo prorrogado');
  assert.ok(n.body.includes('15/10/2026'));
  assert.equal(n.link, '/qualificacao');
});
```

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx --test src/lib/notifyCatalog.test.ts`
Expected: FAIL (tipo não existe / cai no default).

- [ ] **Step 2: Implementar** — em `NOTIFY_TYPES` acrescentar `'ciclo_reaberto',` após `'ciclo_aberto',`; em `renderNotification`, após o case `'ciclo_aberto'`:

```ts
    case 'ciclo_reaberto':
      return { title: `Ciclo ${ctx.cycle_label ?? ''} reaberto — prazo prorrogado`.replace(/\s+/g, ' ').trim(),
               body: `O ciclo de qualificação foi reaberto e você pode concluir sua avaliação até ${fmtDate(ctx.end_date)}.`, link };
```

- [ ] **Step 3: Teste passa + commit**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx --test src/lib/notifyCatalog.test.ts`
Expected: PASS.
```bash
git add src/lib/notifyCatalog.ts src/lib/notifyCatalog.test.ts
git commit -m "Notificações: evento ciclo_reaberto (prorrogação/reabertura de ciclo)"
```

---

### Task 3: reopenCycleCore + rota /reabrir + guarda no PATCH

**Files:**
- Modify: `server.ts` — função nova junto do `closeCycleCore`, rota nova após `/encerrar`, guarda no PATCH `/api/eval/cycles/:id`

**Interfaces:**
- Consumes: coluna da Task 1; `renderNotification` via `notifyEvent('ciclo_reaberto', ...)` (Task 2); helpers existentes `findConflictingActiveCycle`, `notifyEvent`, `prestadorRecipients`, `auditLog`, `hashClientIp`, `isStaff`, `withTransaction`.
- Produces (para a Task 4): `POST /api/eval/cycles/:id/reabrir` body `{end_date?: 'YYYY-MM-DD'}` → `{success:true, cycle_id, restored:number, end_date}`; 409 com mensagens: ciclo ativo / outro ciclo ativo / "prazo no passado — informe uma nova data fim (prorrogação)"; PATCH `active:true` em ciclo encerrado com instâncias → 409 "ciclo encerrado com avaliações — use Reabrir ou Prorrogar".

- [ ] **Step 1: Core** — inserir logo após a função `closeCycleCore`:

```ts
  // Reabre um ciclo encerrado (spec 2026-09-11): reativa e restaura as instâncias
  // 'ciclo_encerrado' ao status anterior. newEndDate presente = prorrogação.
  async function reopenCycleCore(cycleId: number, newEndDate: string | null): Promise<{ ok: boolean; code?: number; error?: string; restored?: number; endDate?: string; label?: string; providerIds?: number[] }> {
    const { rows: cy } = await query('SELECT id, label, active, start_date, end_date FROM eval_cycles WHERE id = $1', [cycleId]);
    if (!cy.length) return { ok: false, code: 404, error: 'ciclo não encontrado' };
    if (cy[0].active) return { ok: false, code: 409, error: 'ciclo já está ativo — para prorrogar, edite a data fim' };
    const other = await findConflictingActiveCycle(cycleId);
    if (other != null) return { ok: false, code: 409, error: 'Existe outro ciclo ativo — encerre-o antes de reabrir este.' };

    const toISO = (v: any) => v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
    const effectiveEnd = newEndDate ?? toISO(cy[0].end_date);
    const today = new Date().toISOString().slice(0, 10);
    if (effectiveEnd < today) {
      return { ok: false, code: 409, error: 'O prazo do ciclo está no passado — informe uma nova data fim (prorrogação).' };
    }
    if (newEndDate && newEndDate < toISO(cy[0].start_date)) {
      return { ok: false, code: 400, error: 'A nova data fim não pode ser anterior ao início do ciclo.' };
    }

    let providerIds: number[] = [];
    const restored = await withTransaction(async (c) => {
      await c.query('UPDATE eval_cycles SET active = true, end_date = COALESCE($2, end_date) WHERE id = $1', [cycleId, newEndDate]);
      const { rows } = await c.query(`
        UPDATE eval_instances ei
           SET status = COALESCE(ei.status_before_close,
                 CASE WHEN EXISTS (
                        SELECT 1 FROM eval_answers a
                          JOIN eval_answer_iterations it ON it.answer_id = a.id
                         WHERE a.instance_id = ei.id AND it.actor_role = 'prestador')
                      THEN 'em_andamento' ELSE 'pendente' END),
               status_before_close = NULL,
               completed_at = NULL
         WHERE ei.cycle_id = $1 AND ei.status = 'ciclo_encerrado'
         RETURNING ei.provider_id`, [cycleId]);
      providerIds = [...new Set(rows.map((r: any) => Number(r.provider_id)))];
      return rows.length;
    });

    return { ok: true, restored, endDate: effectiveEnd, label: cy[0].label, providerIds };
  }
```

- [ ] **Step 2: Rota** — inserir após a rota `POST /api/eval/cycles/:id/encerrar`:

```ts
  // Reabre/prorroga um ciclo encerrado (spec 2026-09-11). body.end_date = prorrogação.
  app.post('/api/eval/cycles/:id/reabrir', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const cycleId = Number(req.params.id);
      const rawEnd = req.body?.end_date;
      const newEndDate = rawEnd ? String(rawEnd).slice(0, 10) : null;
      if (newEndDate && !/^\d{4}-\d{2}-\d{2}$/.test(newEndDate)) {
        return res.status(400).json({ error: 'end_date inválida (use YYYY-MM-DD)' });
      }

      const result = await reopenCycleCore(cycleId, newEndDate);
      if (!result.ok) return res.status(result.code || 500).json({ error: result.error });

      await auditLog({
        query, userId: req.user.id, action: 'cycle_reopened',
        meta: { cycle_id: cycleId, restored: result.restored, end_date: result.endDate, prorrogado: !!newEndDate },
        ip: hashClientIp(req),
      });
      // Avisa os prestadores restaurados (fire-and-forget, padrão do openCycleCore).
      void (async () => {
        for (const pid of result.providerIds ?? []) {
          await notifyEvent('ciclo_reaberto', { cycle_label: result.label, end_date: result.endDate },
            await prestadorRecipients(pid), { providerId: pid });
        }
      })();
      res.json({ success: true, cycle_id: cycleId, restored: result.restored, end_date: result.endDate });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
```

- [ ] **Step 3: Guarda no PATCH** — em `PATCH /api/eval/cycles/:id`, dentro do `if (active === true) { ... }` existente, após o check de conflito, acrescentar:

```ts
        // Ciclo encerrado com avaliações não reativa por aqui — Reabrir/Prorrogar
        // restauram as instâncias 'ciclo_encerrado'; o PATCH deixaria tudo encerrado.
        const { rows: closedInst } = await query(
          `SELECT 1 FROM eval_cycles c
            WHERE c.id = $1 AND c.active = false
              AND EXISTS (SELECT 1 FROM eval_instances i WHERE i.cycle_id = c.id AND i.status = 'ciclo_encerrado')
            LIMIT 1`, [id]);
        if (closedInst.length) {
          return res.status(409).json({ error: 'Ciclo encerrado com avaliações — use Reabrir ou Prorrogar na lista de ciclos.' });
        }
```

- [ ] **Step 4: Lint + suíte + commit**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && npm run lint && npm test 2>&1 | tail -6`
Expected: sem erro; todos os testes passam.
```bash
git add server.ts
git commit -m "Ciclos: POST /reabrir (reabertura/prorrogação restaura instâncias) e guarda no PATCH"
```

---

### Task 4: UI — CiclosAdmin (Reabrir/Prorrogar) + NovoCicloModal

**Files:**
- Modify: `src/pages/qualificacao/CiclosAdmin.tsx`
- Modify: `src/pages/qualificacao/NovoCicloModal.tsx`

**Interfaces:**
- Consumes: `POST /eval/cycles/:id/reabrir` da Task 3.

- [ ] **Step 1: CiclosAdmin — imports e ações**

Import: acrescentar `Unlock, CalendarPlus` ao import do lucide-react. Estado novo:
```ts
  const [prorrogando, setProrrogando] = useState<any>(null);
```
Funções (junto de `encerrar`):
```ts
  const reabrir = async (c: any, endDate?: string) => {
    if (!endDate && !confirm(`Reabrir o ciclo "${c.label}"? As avaliações encerradas voltam ao status anterior.`)) return;
    try {
      const res = await fetchApi(`/eval/cycles/${c.id}/reabrir`, {
        method: 'POST',
        body: JSON.stringify(endDate ? { end_date: endDate } : {}),
      });
      alert(`Ciclo reaberto até ${fmtData(res.end_date)} — ${res.restored} avaliação(ões) reaberta(s).`);
      setProrrogando(null);
      load();
    } catch (e: any) { alert(e?.message || 'Erro ao reabrir'); }
  };
```

- [ ] **Step 2: CiclosAdmin — botões** — na célula "Ativo", trocar o bloco do botão "Ativar" (o `: (...)` do ternário `c.active ? ... : (...)`) por:

```tsx
                    : c.instances_count > 0 ? (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => reabrir(c)}
                          disabled={hasOtherActive}
                          title={hasOtherActive ? 'Encerre o ciclo ativo antes' : 'Reabrir — as avaliações encerradas voltam ao status anterior'}
                          className="text-xs text-emerald-700 hover:underline flex items-center gap-1 disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
                        >
                          <Unlock className="w-3 h-3" /> Reabrir
                        </button>
                        <button
                          onClick={() => setProrrogando(c)}
                          disabled={hasOtherActive}
                          title={hasOtherActive ? 'Encerre o ciclo ativo antes' : 'Prorrogar — nova data fim e reabertura das avaliações'}
                          className="text-xs text-sky-700 hover:underline flex items-center gap-1 disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
                        >
                          <CalendarPlus className="w-3 h-3" /> Prorrogar
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => activate(c)}
                        disabled={hasOtherActive}
                        title={hasOtherActive ? 'Encerre o ciclo ativo antes' : 'Ativar este ciclo'}
                        className="text-xs text-emerald-700 hover:underline flex items-center gap-1 disabled:text-gray-400 disabled:no-underline disabled:cursor-not-allowed"
                      >
                        <Check className="w-3 h-3" /> Ativar
                      </button>
                    )}
```

- [ ] **Step 3: CiclosAdmin — mini-modal de prorrogação** — antes do `{creating && ...}` no JSX:

```tsx
      {prorrogando && (
        <ProrrogarModal
          cycle={prorrogando}
          onClose={() => setProrrogando(null)}
          onConfirm={(d) => reabrir(prorrogando, d)}
        />
      )}
```
E no fim do arquivo:
```tsx
function ProrrogarModal({ cycle, onClose, onConfirm }: { cycle: any; onClose: () => void; onConfirm: (endDate: string) => void }) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [endDate, setEndDate] = useState('');
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-gray-100">
          <h3 className="text-lg font-bold">Prorrogar {cycle.label}</h3>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-gray-600">
            Fim atual: <strong>{fmtData(cycle.end_date)}</strong>. Ao prorrogar, o ciclo é
            reaberto e as avaliações encerradas voltam ao status anterior.
          </p>
          <label className="block">
            <span className="text-sm text-gray-600">Nova data fim</span>
            <input type="date" min={hoje} value={endDate} onChange={e => setEndDate(e.target.value)} className="mt-1 w-full border rounded px-3 py-2" />
          </label>
        </div>
        <div className="p-4 bg-gray-50 rounded-b-xl flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-outline">Cancelar</button>
          <button onClick={() => onConfirm(endDate)} disabled={!endDate || endDate < hoje} className="btn btn-primary">Prorrogar e reabrir</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: NovoCicloModal — esconder o checkbox para ciclo encerrado com instâncias**

```ts
  // Ciclo encerrado com instâncias não reativa pelo modal (o PATCH devolve 409) —
  // a reabertura é pelos botões Reabrir/Prorrogar, que restauram as avaliações.
  const lockedClosed = opened && initial && !initial.active;
```
No `save`, trocar `active,` do body do PATCH por `active: lockedClosed ? undefined : active,` (o POST de criação fica como está). No JSX, trocar o `<label>` do checkbox por:
```tsx
          {lockedClosed ? (
            <p className="text-xs text-gray-500">Ciclo encerrado — para reativar use Reabrir ou Prorrogar na lista de ciclos.</p>
          ) : (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
              <span>Ativar este ciclo (desativa o atual)</span>
            </label>
          )}
```

- [ ] **Step 5: Lint + commit**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && npm run lint`
```bash
git add src/pages/qualificacao/CiclosAdmin.tsx src/pages/qualificacao/NovoCicloModal.tsx
git commit -m "Ciclos: botões Reabrir/Prorrogar na lista e trava do checkbox no modal"
```

---

### Task 5: Verificação (dry-run transacional) + push

**Files:** nenhum.

- [ ] **Step 1: Dry-run no banco dev** — numa transação com ROLLBACK: pegar um ciclo com instâncias `ciclo_encerrado`; simular o encerramento novo (status_before_close) numa instância artificialmente marcada; rodar o UPDATE de restauração; conferir: restaurada volta ao status gravado, legada (sem status_before_close) cai no fallback, terminal (`aprovado`) intocada.
- [ ] **Step 2: Suíte completa** — `npm test` verde.
- [ ] **Step 3: Push** — `git push origin dev`.
- [ ] **Step 4:** Atualizar memória (migration 0048 obrigatória; feature entregue).
