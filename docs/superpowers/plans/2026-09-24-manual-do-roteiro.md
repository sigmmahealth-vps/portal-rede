# Manual do Roteiro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin/auditoria sobem 1 PDF de manual por roteiro; o prestador baixa só logado (Meus Roteiros, preenchimento, Início); o aviso `ciclo_aberto` menciona o manual quando existe.

**Architecture:** Tabela `eval_script_manuals` (bytea, chave `source_file`). 3 rotas em `server.ts` (PUT/DELETE staff, GET com regra de acesso pura em `db/script-manual.ts`). `GET /api/eval/scripts` passa a trazer `manual_filename`/`manual_uploaded_at`. Frontend usa `<a href="/api/eval/scripts/:id/manual">` (cookie de sessão autentica).

**Tech Stack:** Express + pg + multer (memória), React/Tailwind, testes `node --import tsx --test`.

**Spec:** `docs/superpowers/specs/2026-09-24-manual-do-roteiro-design.md`

## Global Constraints

- Só PDF (extensão `.pdf` + bytes iniciais `%PDF`), até 20 MB.
- Download só autenticado; prestador (`prestador`/`cooperado`/`credenciado`) só do próprio roteiro; staff qualquer.
- Nunca anexar o manual nem linkar o arquivo em e-mail/sininho.
- Node fora do PATH: prefixar `export PATH="/c/Program Files/nodejs:$PATH";`. `npm run dev` serve `dist/` → `npm run build` antes de QA no browser.
- Migration 0053 obrigatória ao promover.

---

### Task 1: Migration + regra de acesso pura

**Files:**
- Create: `db/migrations/0053_eval_script_manuals.sql`
- Create: `db/script-manual.ts`
- Test: `db/script-manual.test.ts`

**Produces:** `canDownloadManual(role: string, linkedSourceFiles: string[], sourceFile: string | null): boolean`, `isPdf(name: string, buf: Buffer): boolean`, `MANUAL_MAX_BYTES = 20 * 1024 * 1024`, `PROVIDER_ROLES`.

- [ ] **Step 1: Migration**

```sql
-- Manual (PDF) por roteiro — chave = source_file (sobrevive a novas revisões).
CREATE TABLE IF NOT EXISTS eval_script_manuals (
  source_file  text PRIMARY KEY,
  filename     text        NOT NULL,
  size_bytes   integer     NOT NULL,
  content      bytea       NOT NULL,
  uploaded_by  bigint      REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Teste que falha** (`db/script-manual.test.ts`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canDownloadManual, isPdf } from './script-manual.js';

test('canDownloadManual: staff baixa qualquer; prestador só o próprio roteiro', () => {
  assert.equal(canDownloadManual('admin', [], 'FOR-015.xlsx'), true);
  assert.equal(canDownloadManual('auditoria', [], 'FOR-015.xlsx'), true);
  assert.equal(canDownloadManual('credenciado', ['FOR-015.xlsx'], 'FOR-015.xlsx'), true);
  assert.equal(canDownloadManual('prestador', ['FOR-004.xlsx'], 'FOR-015.xlsx'), false);
  assert.equal(canDownloadManual('cooperado', [], 'FOR-015.xlsx'), false);
  assert.equal(canDownloadManual('prestador', ['FOR-015.xlsx'], null), false);
  assert.equal(canDownloadManual('outro', ['FOR-015.xlsx'], 'FOR-015.xlsx'), false);
});

test('isPdf: exige extensão e assinatura %PDF', () => {
  assert.equal(isPdf('m.pdf', Buffer.from('%PDF-1.7 ...')), true);
  assert.equal(isPdf('M.PDF', Buffer.from('%PDF-1.4')), true);
  assert.equal(isPdf('m.pdf', Buffer.from('PK\x03\x04')), false);
  assert.equal(isPdf('m.docx', Buffer.from('%PDF-1.7')), false);
});
```

- [ ] **Step 3:** `node --import tsx --test db/script-manual.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 4: Implementação** (`db/script-manual.ts`)

```ts
// Manual (PDF) do roteiro — regras puras (sem DB), usadas pelas rotas de server.ts.
export const MANUAL_MAX_BYTES = 20 * 1024 * 1024;
export const PROVIDER_ROLES = ['prestador', 'cooperado', 'credenciado'];

// Staff baixa qualquer manual; acesso de prestador só o do roteiro ligado a ele
// (linkedSourceFiles = source_file do eval_script_id do prestador + das instâncias dele).
export function canDownloadManual(role: string, linkedSourceFiles: string[], sourceFile: string | null): boolean {
  if (role === 'admin' || role === 'auditoria') return true;
  if (!PROVIDER_ROLES.includes(role) || !sourceFile) return false;
  return linkedSourceFiles.includes(sourceFile);
}

export function isPdf(name: string, buf: Buffer): boolean {
  return /\.pdf$/i.test(name) && buf.subarray(0, 4).toString('latin1') === '%PDF';
}
```

- [ ] **Step 5:** teste → PASS. Aplicar migration no dev: `APP_ENV=dev npm run db:migrate` (host `reseau` conferido).
- [ ] **Step 6: Commit** `feat(roteiro): tabela eval_script_manuals (0053) + regra de acesso ao manual`

### Task 2: Rotas do manual + campos no GET de roteiros

**Files:** Modify `server.ts` (multer perto de `xlsxUpload` ~l.84; rotas junto de `/api/eval/scripts` ~l.3276).

**Consumes:** Task 1. **Produces:** `PUT|DELETE|GET /api/eval/scripts/:id/manual`; `GET /api/eval/scripts` com `manual_filename`, `manual_size_bytes`, `manual_uploaded_at`.

- [ ] **Step 1: Multer do PDF** (após `xlsxUpload`)

```ts
const pdfUpload = (req: any, res: any, next: any) => {
  multer({ storage: multer.memoryStorage(), limits: { fileSize: MANUAL_MAX_BYTES } }).single('file')(req, res, (err: any) => {
    if (err) {
      const isSize = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({ error: isSize ? 'Arquivo maior que 20 MB' : (err.message || 'Falha no upload') });
    }
    next();
  });
};
```
Import: `import { canDownloadManual, isPdf, MANUAL_MAX_BYTES } from './db/script-manual.js';`

- [ ] **Step 2: Rotas**

```ts
  // Manual (PDF) do roteiro — spec 2026-09-24. Chave = source_file (vale p/ todas as revisões).
  const scriptSourceFile = async (id: number): Promise<string | null> =>
    (await query('SELECT source_file FROM eval_scripts WHERE id = $1', [id])).rows[0]?.source_file ?? null;

  app.put('/api/eval/scripts/:id/manual', authenticate, pdfUpload, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const sf = await scriptSourceFile(Number(req.params.id));
      if (!sf) return res.status(404).json({ error: 'Roteiro não encontrado' });
      if (!req.file) return res.status(400).json({ error: 'Envie o PDF no campo "file".' });
      const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      if (!isPdf(name, req.file.buffer)) return res.status(400).json({ error: 'Apenas arquivos PDF são aceitos' });
      await query(
        `INSERT INTO eval_script_manuals (source_file, filename, size_bytes, content, uploaded_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_file) DO UPDATE SET filename = EXCLUDED.filename, size_bytes = EXCLUDED.size_bytes,
           content = EXCLUDED.content, uploaded_by = EXCLUDED.uploaded_by, uploaded_at = now()`,
        [sf, name, req.file.size, req.file.buffer, req.user.id]);
      await auditLog({ query, userId: req.user.id, action: 'script_manual_uploaded',
        meta: { script_id: Number(req.params.id), source_file: sf, filename: name, size: req.file.size }, ip: hashClientIp(req) });
      res.json({ success: true, filename: name, size_bytes: req.file.size });
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  app.delete('/api/eval/scripts/:id/manual', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const sf = await scriptSourceFile(Number(req.params.id));
      if (!sf) return res.status(404).json({ error: 'Roteiro não encontrado' });
      await query('DELETE FROM eval_script_manuals WHERE source_file = $1', [sf]);
      await auditLog({ query, userId: req.user.id, action: 'script_manual_removed',
        meta: { script_id: Number(req.params.id), source_file: sf }, ip: hashClientIp(req) });
      res.json({ success: true });
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  app.get('/api/eval/scripts/:id/manual', authenticate, async (req: any, res) => {
    try {
      const sf = await scriptSourceFile(Number(req.params.id));
      let linked: string[] = [];
      if (!isStaff(req.user.role) && req.user.provider_id) {
        const { rows } = await query(
          `SELECT DISTINCT s.source_file FROM eval_scripts s
            WHERE s.source_file IS NOT NULL AND (
              s.id = (SELECT eval_script_id FROM providers WHERE id = $1)
              OR s.id IN (SELECT script_id FROM eval_instances WHERE provider_id = $1 AND location_id = ANY($2::bigint[])))`,
          [req.user.provider_id, await userLocationIds(req)]);
        linked = rows.map((r: any) => r.source_file);
      }
      if (!canDownloadManual(req.user.role, linked, sf)) return res.status(403).json({ error: 'Sem acesso a este manual' });
      const { rows } = await query('SELECT filename, content FROM eval_script_manuals WHERE source_file = $1', [sf]);
      if (!rows[0]) return res.status(404).json({ error: 'Este roteiro ainda não tem manual.' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(rows[0].filename)}`);
      res.send(rows[0].content);
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });
```

- [ ] **Step 3: GET /api/eval/scripts** — nas duas queries, trocar `SELECT s.* FROM eval_scripts s` / `SELECT * FROM eval_scripts` por
  `SELECT s.*, m.filename AS manual_filename, m.size_bytes AS manual_size_bytes, m.uploaded_at AS manual_uploaded_at FROM eval_scripts s LEFT JOIN eval_script_manuals m ON m.source_file = s.source_file` (mantendo JOIN/WHERE/ORDER existentes).
- [ ] **Step 4:** `npx tsc --noEmit -p .` sem erros em server.ts.
- [ ] **Step 5: Commit** `feat(roteiro): rotas de upload/download do manual (só logado)`

### Task 3: Admin — modal do manual

**Files:** Create `src/pages/qualificacao/ManualRoteiroModal.tsx`; Modify `src/pages/Admin.tsx` (botão ao lado de `EliminatoriosButton` nos cards ~l.676 e na lista ~l.782; estado `manualTarget`; render do modal perto de `EliminatoriosModal` ~l.1288).

- [ ] **Step 1: Modal** — props `{ script: any; onClose(): void; onChanged(): void }`. Mostra `manual_filename`, tamanho em MB, `fmtDataHora(manual_uploaded_at)`; `<input type="file" accept="application/pdf,.pdf">` + botão "Enviar PDF"/"Substituir" → `fetch('/api/eval/scripts/'+id+'/manual', { method: 'PUT', body: FormData, credentials: 'include' })`; "Baixar" = `<a href=.../manual>`; "Remover" com `confirm` → `fetchApi(..., { method: 'DELETE' })`. Erro exibido em linha. Após sucesso `onChanged()`.
- [ ] **Step 2: Botão** `ManualButton` (ícone `FileText`, verde quando `script.manual_filename`) em cards e lista, abrindo o modal para `vigente`.
- [ ] **Step 3:** build + QA browser (admin, dev): enviar PDF, selo verde, baixar, substituir, remover, rejeitar .txt.
- [ ] **Step 4: Commit** `feat(admin): envio/troca/remoção do manual por roteiro`

### Task 4: Prestador — botões de download

**Files:** Modify `src/pages/qualificacao/PrestadorView.tsx`, `src/pages/qualificacao/RoteiroPlayer.tsx`.

- [ ] **Step 1: Meus Roteiros** — no card de `scriptsVigentes`, se `s.manual_filename`: `<a href={`/api/eval/scripts/${s.id}/manual`} className="...">Baixar manual do roteiro</a>` abaixo do botão de ação.
- [ ] **Step 2: Início** — `AlertGroupCard` recebe `manualHref?: (scriptId?: number) => string | null`; para itens com `scriptId` cujo roteiro tem manual, link "Manual" antes do botão. `PrestadorView` passa `id => scripts.find(s => s.id === id)?.manual_filename ? `/api/eval/scripts/${id}/manual` : null`.
- [ ] **Step 3: Player** — `script.manual_filename` não vem de `/eval/scripts/:id`; usar o GET detalhe: adicionar o LEFT JOIN também em `GET /api/eval/scripts/:id` (server.ts) e, no rail (acima do progresso) e no resumo mobile, link "Manual do roteiro" quando existir.
- [ ] **Step 4:** `npx tsc --noEmit -p .` + build. **Commit** `feat(prestador): botões de download do manual`

### Task 5: Aviso de abertura menciona o manual

**Files:** Modify `src/lib/notifyCatalog.ts`, `src/lib/notifyEmail.ts`, `server.ts` (loops de `ciclo_aberto` ~l.4863 e ~l.4973), Test `src/lib/notifyCatalog.test.ts`.

- [ ] **Step 1: Teste que falha**

```ts
test('ciclo_aberto: menciona o manual só quando has_manual', () => {
  const com = renderNotification('ciclo_aberto', { cycle_label: '2026', has_manual: true });
  const sem = renderNotification('ciclo_aberto', { cycle_label: '2026' });
  assert.ok(com.body.includes('manual do seu roteiro'), com.body);
  assert.ok(!sem.body.includes('manual'), sem.body);
  const e = renderNotificationEmail('ciclo_aberto', { cycle_label: '2026', has_manual: true }, 'https://x');
  assert.ok(e.html.includes('manual do seu roteiro'));
  assert.ok(!e.html.includes('/manual'), 'e-mail não linka o arquivo');
});
```

- [ ] **Step 2:** FAIL. **Step 3:** texto `const MANUAL_TXT = ' O manual do seu roteiro está disponível no portal, em Meus Roteiros.'` anexado ao body do catálogo e como parágrafo extra no bloco do e-mail quando `ctx.has_manual`.
- [ ] **Step 4: server.ts** — helper `providerHasManual(pid, cycleId)`:
  `SELECT EXISTS (SELECT 1 FROM eval_instances i JOIN eval_scripts s ON s.id = i.script_id JOIN eval_script_manuals m ON m.source_file = s.source_file WHERE i.provider_id = $1 AND i.cycle_id = $2)`; passar `has_manual` nos dois `notifyEvent('ciclo_aberto', …)`.
- [ ] **Step 5:** testes PASS + tsc. **Commit** `feat(notificacao): abertura do ciclo avisa que há manual`

### Task 6: Verificação final

- [ ] Rodar `db/script-manual.test.ts`, `src/lib/notifyCatalog.test.ts`, `src/lib/notifyEmail.test.ts`.
- [ ] Reiniciar o dev server (rotas novas) + `npm run build`; QA admin no browser; 403 simulado não é possível sem login de prestador → coberto pelo teste de `canDownloadManual`.
- [ ] Push `dev`; memória: migration 0053 obrigatória ao promover.
