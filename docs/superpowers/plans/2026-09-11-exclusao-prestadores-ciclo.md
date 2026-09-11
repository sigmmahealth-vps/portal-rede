# Exclusão individual de prestadores na abertura do ciclo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na tela Qualificação → Ciclos → Abrir, permitir excluir prestador × local do ciclo com motivo obrigatório, lista revisável e resumo na confirmação de abertura (spec `docs/superpowers/specs/2026-09-11-exclusao-prestadores-ciclo-design.md`).

**Architecture:** Tabela nova `eval_cycle_exclusions` (motivo + autor + data, UNIQUE por ciclo/prestador/local); POST/DELETE staff-only imutáveis após abertura; `instances-preview` devolve os campos de exclusão por linha; `openCycleCore` e `abertura-preview` filtram com `NOT EXISTS`; UI na `AbrirCicloPage` (modal de motivo, seção "Excluídos deste ciclo", resumo no Confirmar abertura).

**Tech Stack:** Express + pg (server.ts), React + Tailwind (AbrirCicloPage.tsx), migrations SQL próprias (db/migrate.ts).

## Global Constraints

- Node fora do PATH: prefixar `export PATH="/c/Program Files/nodejs:$PATH"` em todo comando Bash.
- Branch `dev`; commits com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Não há harness de teste de endpoint — verificação por `npm run lint` (tsc), suíte existente e checagens manuais via node one-liners contra o banco dev.
- Textos de UI em pt-BR; datas exibidas via `fmtDataHora` de `src/lib/formatDate.ts`.
- ⚠️ Migration 0047 obrigatória ao promover homolog/prod.

---

### Task 1: Migration 0047 — eval_cycle_exclusions

**Files:**
- Create: `db/migrations/0047_eval_cycle_exclusions.sql`

**Interfaces:**
- Produces: tabela `eval_cycle_exclusions (id BIGSERIAL PK, cycle_id, provider_id, location_id, reason TEXT NOT NULL, created_by BIGINT NULL, created_at timestamptz, UNIQUE (cycle_id, provider_id, location_id))` — usada nas Tasks 2 e 3.

- [ ] **Step 1: Escrever a migration**

```sql
-- 0047_eval_cycle_exclusions.sql
-- Exclusão individual (prestador × local) da abertura de um ciclo, com motivo e
-- autor (dupla checagem — spec 2026-09-11). Linha aqui = fica fora do ciclo.
CREATE TABLE IF NOT EXISTS eval_cycle_exclusions (
  id          BIGSERIAL PRIMARY KEY,
  cycle_id    BIGINT NOT NULL REFERENCES eval_cycles(id) ON DELETE CASCADE,
  provider_id BIGINT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES provider_locations(id) ON DELETE CASCADE,
  reason      TEXT   NOT NULL,
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, provider_id, location_id)
);
CREATE INDEX IF NOT EXISTS eval_cycle_exclusions_cycle_idx ON eval_cycle_exclusions (cycle_id);
```

- [ ] **Step 2: Rodar no dev e conferir**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && npm run db:migrate`
Expected: log aplica `0047_eval_cycle_exclusions.sql` sem erro.

Run:
```bash
export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx -e "import('./db/db.js').then(async ({query,pool})=>{const{rows}=await query(\"SELECT column_name FROM information_schema.columns WHERE table_name='eval_cycle_exclusions' ORDER BY ordinal_position\");console.log(rows.map(r=>r.column_name).join(','));await pool.end();})"
```
Expected: `id,cycle_id,provider_id,location_id,reason,created_by,created_at`

- [ ] **Step 3: Commit**

```bash
git add db/migrations/0047_eval_cycle_exclusions.sql
git commit -m "Ciclos: migration 0047 eval_cycle_exclusions (exclusão individual com motivo)"
```

---

### Task 2: API — POST/DELETE exclusões, preview e abertura filtrados

**Files:**
- Modify: `server.ts` — 4 pontos: (a) novos endpoints após o `PUT /api/eval/cycles/:id/overrides` (~linha 4754); (b) SQL do `instances-preview` (~linha 4654); (c) contagem de instâncias do `buildAperturaPreview` (~linha 4485); (d) INSERT de instâncias do `openCycleCore` (~linha 4790).

**Interfaces:**
- Consumes: tabela da Task 1.
- Produces (para a Task 3):
  - `POST /api/eval/cycles/:id/exclusions` body `{provider_id:number, location_id:number, reason:string}` → `{success:true, id:number}`; 400 sem reason; 409 se aberto.
  - `DELETE /api/eval/cycles/:id/exclusions/:exclusionId` → `{success:true}`; 404 se não existe; 409 se aberto.
  - `GET /api/eval/cycles/:id/instances-preview` rows ganham `excluded_id:number|null, excluded_reason:string|null, excluded_by:string|null, excluded_at:string|null`.

- [ ] **Step 1: Endpoints novos** — inserir após o fechamento do `PUT /overrides` (depois do `});` da rota, ~linha 4754):

```ts
  // Exclui um prestador×local do ciclo com motivo (dupla checagem, spec 2026-09-11).
  // Só antes de abrir — depois o conjunto de instâncias é imutável.
  app.post('/api/eval/cycles/:id/exclusions', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const cycleId = Number(req.params.id);
      const providerId = Number(req.body?.provider_id);
      const locationId = Number(req.body?.location_id);
      const reason = String(req.body?.reason ?? '').trim();
      if (!Number.isFinite(providerId) || !Number.isFinite(locationId) || !reason) {
        return res.status(400).json({ error: 'provider_id, location_id e reason são obrigatórios' });
      }
      const { rows: cy } = await query('SELECT 1 FROM eval_cycles WHERE id = $1', [cycleId]);
      if (!cy.length) return res.status(404).json({ error: 'ciclo não encontrado' });
      const { rows: hasInst } = await query('SELECT 1 FROM eval_instances WHERE cycle_id = $1 LIMIT 1', [cycleId]);
      if (hasInst.length) return res.status(409).json({ error: 'ciclo já foi aberto — exclusões são imutáveis' });

      const { rows } = await query(
        `INSERT INTO eval_cycle_exclusions (cycle_id, provider_id, location_id, reason, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (cycle_id, provider_id, location_id)
         DO UPDATE SET reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, created_at = now()
         RETURNING id`,
        [cycleId, providerId, locationId, reason, req.user.id]
      );
      await auditLog({
        query, userId: req.user.id, action: 'cycle_exclusion_added',
        meta: { cycle_id: cycleId, provider_id: providerId, location_id: locationId, reason },
        ip: hashClientIp(req),
      });
      res.json({ success: true, id: Number(rows[0].id) });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Reinclui (desfaz a exclusão). Só antes de abrir.
  app.delete('/api/eval/cycles/:id/exclusions/:exclusionId', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const cycleId = Number(req.params.id);
      const exclusionId = Number(req.params.exclusionId);
      const { rows: hasInst } = await query('SELECT 1 FROM eval_instances WHERE cycle_id = $1 LIMIT 1', [cycleId]);
      if (hasInst.length) return res.status(409).json({ error: 'ciclo já foi aberto — exclusões são imutáveis' });

      const { rows } = await query(
        'DELETE FROM eval_cycle_exclusions WHERE id = $1 AND cycle_id = $2 RETURNING provider_id, location_id',
        [exclusionId, cycleId]
      );
      if (!rows.length) return res.status(404).json({ error: 'exclusão não encontrada' });
      await auditLog({
        query, userId: req.user.id, action: 'cycle_exclusion_removed',
        meta: { cycle_id: cycleId, provider_id: Number(rows[0].provider_id), location_id: Number(rows[0].location_id) },
        ip: hashClientIp(req),
      });
      res.json({ success: true });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
```

- [ ] **Step 2: instances-preview devolve os campos de exclusão** — no SQL da rota (~linha 4654), trocar:

```sql
               ov.script_id AS override_script_id,
               s_override.title AS override_script_title
```
por:
```sql
               ov.script_id AS override_script_id,
               s_override.title AS override_script_title,
               x.id AS excluded_id,
               x.reason AS excluded_reason,
               ux.name AS excluded_by,
               x.created_at AS excluded_at
```
e, depois de `LEFT JOIN eval_scripts s_override ON s_override.id = ov.script_id`, acrescentar:
```sql
          LEFT JOIN eval_cycle_exclusions x ON x.cycle_id = $1 AND x.provider_id = p.id AND x.location_id = pl.id
          LEFT JOIN users ux ON ux.id = x.created_by
```

- [ ] **Step 3: buildAperturaPreview — KPI Instâncias desconta excluídos** — na query `instRows` (~linha 4485), acrescentar ao WHERE:

```sql
         AND NOT EXISTS (SELECT 1 FROM eval_cycle_exclusions x
                          WHERE x.cycle_id = $2 AND x.provider_id = p.id AND x.location_id = pl.id)
```
(O `$2` já é `cycleId` nessa query. A contagem `dl_bypass` do preview é estimativa por grupo e NÃO desconta excluídos — o valor real na abertura deriva das instâncias criadas, que já filtram.)

- [ ] **Step 4: openCycleCore — não cria instância para excluído** — no INSERT de instâncias (~linha 4790), acrescentar ao WHERE:

```sql
             AND NOT EXISTS (SELECT 1 FROM eval_cycle_exclusions x
                              WHERE x.cycle_id = $1 AND x.provider_id = p.id AND x.location_id = pl.id)
```

- [ ] **Step 5: Typecheck + suíte**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && npm run lint && npm test 2>&1 | tail -6`
Expected: tsc sem erro; testes todos passando (190+).

- [ ] **Step 6: Commit**

```bash
git add server.ts
git commit -m "Ciclos: API de exclusão individual (POST/DELETE) e filtros no preview/abertura"
```

---

### Task 3: UI — AbrirCicloPage (modal de motivo, seção Excluídos, resumo na abertura)

**Files:**
- Modify: `src/pages/qualificacao/AbrirCicloPage.tsx`

**Interfaces:**
- Consumes: endpoints e campos da Task 2; `fmtDataHora` de `../../lib/formatDate`.

- [ ] **Step 1: Tipos, imports e estado**

No import do lucide-react acrescentar `UserMinus`; importar `fmtDataHora`:
```ts
import { fmtDataHora } from '../../lib/formatDate';
```
Em `InstanceRow` acrescentar:
```ts
  excluded_id: number | null;
  excluded_reason: string | null;
  excluded_by: string | null;
  excluded_at: string | null;
```
No componente, novo estado:
```ts
  const [excluding, setExcluding] = useState<InstanceRow | null>(null);
```

- [ ] **Step 2: Ações excluir/reincluir** (junto das outras funções):

```ts
  const confirmarExclusao = async (row: InstanceRow, reason: string) => {
    setSaving(true); setErr(null);
    try {
      await fetchApi(`/eval/cycles/${cycle.id}/exclusions`, {
        method: 'POST',
        body: JSON.stringify({ provider_id: row.provider_id, location_id: row.location_id, reason }),
      });
      setExcluding(null);
      await loadPreview();
    } catch (e: any) {
      setErr(e?.message || 'Erro ao excluir do ciclo');
    } finally {
      setSaving(false);
    }
  };

  const reincluir = async (row: InstanceRow) => {
    if (!confirm(`Reincluir ${row.provider_name} (${row.location_label || 'local'}) no ciclo?`)) return;
    setSaving(true); setErr(null);
    try {
      await fetchApi(`/eval/cycles/${cycle.id}/exclusions/${row.excluded_id}`, { method: 'DELETE' });
      await loadPreview();
    } catch (e: any) {
      setErr(e?.message || 'Erro ao reincluir');
    } finally {
      setSaving(false);
    }
  };
```

- [ ] **Step 3: Separar excluídos da tabela principal** — trocar o cálculo de `visibleInstances`:

```ts
  const activeGroupNames = new Set(groups.map(g => g.provider_group));
  const inCycle = instances.filter(i => activeGroupNames.has(i.provider_group));
  const visibleInstances = inCycle.filter(i => i.excluded_id == null);
  const excludedRows = inCycle.filter(i => i.excluded_id != null);
```

- [ ] **Step 4: Botão por linha** — na tabela Prestadores × local, adicionar `<th className="p-3 w-10"></th>` no `<thead>` (após "Roteiro"), ajustar os dois `colSpan={4}` da tabela para `colSpan={5}`, e na linha, após o `<td>` do roteiro:

```tsx
                              <td className="p-3 text-right">
                                {!readOnly && (
                                  <button
                                    type="button"
                                    onClick={() => setExcluding(r)}
                                    title="Remover este prestador/local do ciclo"
                                    className="rounded-md p-1 text-red-600 hover:bg-red-50"
                                  >
                                    <UserMinus className="h-4 w-4" />
                                  </button>
                                )}
                              </td>
```

- [ ] **Step 5: Seção "Excluídos deste ciclo"** — logo após o fechamento da `<section>` Prestadores × local:

```tsx
              {excludedRows.length > 0 && (
                <section className="rounded-2xl border border-red-200 bg-white">
                  <div className="border-b border-red-100 p-4">
                    <h2 className="text-base font-bold text-secondary-900">Excluídos deste ciclo ({excludedRows.length})</h2>
                    <p className="text-xs text-gray-500">
                      {readOnly
                        ? 'Prestadores que ficaram de fora quando o ciclo foi aberto.'
                        : 'Não receberão instância na abertura. Reveja antes de confirmar — dá para reincluir até abrir.'}
                    </p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-red-50/50 text-xs uppercase text-gray-600">
                        <tr>
                          <th className="p-3 font-semibold">Prestador</th>
                          <th className="p-3 font-semibold">Local</th>
                          <th className="p-3 font-semibold">Motivo</th>
                          <th className="p-3 font-semibold">Excluído por</th>
                          <th className="p-3 w-24"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {excludedRows.map(r => (
                          <tr key={`${r.provider_id}-${r.location_id}`} className="border-t border-gray-100">
                            <td className="p-3">
                              <p className="font-medium text-secondary-900">{r.provider_name}</p>
                              {r.provider_code && <p className="text-[11px] text-gray-500">{r.provider_code}</p>}
                            </td>
                            <td className="p-3">
                              <p className="text-secondary-900">{r.location_label || '—'}</p>
                              {r.city && <p className="text-[11px] text-gray-500">{r.city}</p>}
                            </td>
                            <td className="p-3 text-xs text-secondary-900">{r.excluded_reason}</td>
                            <td className="p-3 text-xs text-gray-600">
                              {r.excluded_by || '—'}
                              {r.excluded_at && <p className="text-[11px] text-gray-500">{fmtDataHora(r.excluded_at)}</p>}
                            </td>
                            <td className="p-3 text-right">
                              {!readOnly && (
                                <button
                                  type="button"
                                  onClick={() => reincluir(r)}
                                  disabled={saving}
                                  className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                                >
                                  <RotateCcw className="h-3 w-3" /> Reincluir
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
```

- [ ] **Step 6: Modal de motivo** — no fim do JSX do componente (antes do `</div>` externo final) e o componente auxiliar no fim do arquivo:

```tsx
      {excluding && (
        <ExcluirModal
          row={excluding}
          saving={saving}
          onCancel={() => setExcluding(null)}
          onConfirm={(reason) => confirmarExclusao(excluding, reason)}
        />
      )}
```

```tsx
const MOTIVOS_RAPIDOS = ['Aposentadoria', 'Atendimento exclusivo CC/hospitalar'];

function ExcluirModal({ row, saving, onCancel, onConfirm }: {
  row: InstanceRow; saving: boolean; onCancel: () => void; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-secondary-900">Remover do ciclo</h3>
        <p className="mt-1 text-sm text-gray-600">
          <strong>{row.provider_name}</strong>{row.location_label ? ` — ${row.location_label}` : ''} não receberá
          instância neste ciclo. Informe o motivo (obrigatório):
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {MOTIVOS_RAPIDOS.map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setReason(m)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${reason === m ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              {m}
            </button>
          ))}
        </div>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={2}
          placeholder="Motivo da exclusão…"
          className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus-visible:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            type="button"
            disabled={!reason.trim() || saving}
            onClick={() => onConfirm(reason.trim())}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />} Excluir do ciclo
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Resumo no Confirmar abertura** — trocar o início de `abrir`:

```ts
  const abrir = async () => {
    const partes = ['Abrir o ciclo agora?'];
    if (excludedRows.length > 0) partes.push(`${excludedRows.length} prestador(es) excluído(s) manualmente — confira a seção "Excluídos deste ciclo".`);
    if (dirty || overridesDirty) partes.push('Você tem alterações não salvas. Abrir usará a última versão salva.');
    if (!confirm(partes.join('\n\n'))) return;
```
(o restante da função permanece igual).

- [ ] **Step 8: Typecheck**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && npm run lint`
Expected: sem erro.

- [ ] **Step 9: Commit**

```bash
git add src/pages/qualificacao/AbrirCicloPage.tsx
git commit -m "Ciclos: UI de exclusão individual com motivo, lista de excluídos e resumo na abertura"
```

---

### Task 4: Verificação manual em dev

**Files:** nenhum (verificação).

- [ ] **Step 1: Subir o app em dev** (preview_start / launch.json, nunca Bash) e logar como staff.
- [ ] **Step 2:** Em Ciclos → Abrir de um ciclo NÃO aberto: excluir uma linha com motivo "Aposentadoria" → linha sai da tabela, seção "Excluídos deste ciclo (1)" aparece, KPI Instâncias cai 1.
- [ ] **Step 3:** Reincluir → linha volta, KPI volta.
- [ ] **Step 4:** Excluir de novo e Confirmar abertura → confirm menciona "1 prestador(es) excluído(s)"; após abrir, conferir no banco que o excluído não tem instância:

```bash
export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx -e "import('./db/db.js').then(async ({query,pool})=>{const{rows}=await query('SELECT x.provider_id, x.location_id, (SELECT COUNT(*)::int FROM eval_instances ei WHERE ei.cycle_id=x.cycle_id AND ei.provider_id=x.provider_id AND ei.location_id=x.location_id) AS instancias FROM eval_cycle_exclusions x');console.log(rows);await pool.end();})"
```
Expected: `instancias: 0` para cada exclusão.

- [ ] **Step 5:** Com o ciclo aberto: tentar excluir/reincluir → 409 ("exclusões são imutáveis"); seção Excluídos visível em modo leitura.
- [ ] **Step 6:** Audit log tem `cycle_exclusion_added`/`cycle_exclusion_removed`:

```bash
export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx -e "import('./db/db.js').then(async ({query,pool})=>{const{rows}=await query(\"SELECT action, meta FROM access_logs WHERE action LIKE 'cycle_exclusion%' ORDER BY id DESC LIMIT 5\");console.log(rows);await pool.end();})"
```

- [ ] **Step 7: Push**

```bash
git push origin dev
```
