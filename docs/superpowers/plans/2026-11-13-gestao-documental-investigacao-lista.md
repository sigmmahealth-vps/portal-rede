# Gestão Documental — Investigação e Lista — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tela admin de Investigação e Lista — revisar os documentos enviados pelos prestadores, aprovar/reprovar e notificar, dentro de uma casca "Gestão Documental" com abas.

**Architecture:** Visão admin do `/documentos` extraída para componentes próprios (casca com abas + toggle Médicos×Rede). Backend novo mínimo: 1 tipo de notificação + 2 rotas. Status e classificação Médico×Rede são funções puras testadas, compartilhadas entre cliente e servidor.

**Tech Stack:** TypeScript, Express, Postgres (`pg`), React + `fetchApi`, `xlsx`, `node:test`.

Spec: [docs/superpowers/specs/2026-11-13-gestao-documental-investigacao-lista-design.md](../specs/2026-11-13-gestao-documental-investigacao-lista-design.md)

## Global Constraints

- Imports TypeScript usam sufixo `.js` (ESM/tsx).
- A lista opera só sobre documentos de gestão documental: `type_id IS NOT NULL` (exclui evidências `qualificacao_evidencia`) e exclui `status='historico'`.
- Status exibidos: **Pendente / Aprovado / Vencido / Reprovado** (Isento/Vencendo/Verificar ficam fora).
- Rotas admin: `authenticate, requireAdmin`.
- Formatos/tamanho de upload e o endpoint `/status` já existem — não mudam aqui.
- Comandos db apontam para DEV: `APP_ENV=dev`.

---

### Task 1: Funções puras `statusDocumento` e `providerAudience` + testes

**Files:**
- Create: `src/lib/documentoStatus.ts`, `src/lib/documentoStatus.test.ts`
- Create: `src/lib/providerAudience.ts`, `src/lib/providerAudience.test.ts`
- Modify: `package.json` (incluir os 2 testes no script `test`)

**Interfaces:**
- Produces: `statusDocumento(doc, hoje?): 'pendente'|'aprovado'|'vencido'|'reprovado'|'historico'`; `providerAudience(personType, providerGroup): 'medicos'|'rede'`.

- [ ] **Step 1: Teste de `documentoStatus` (falha)**

Create `src/lib/documentoStatus.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusDocumento } from './documentoStatus.js';

const hoje = new Date('2026-11-13');
test('pendente', () => assert.equal(statusDocumento({ status: 'pendente', expiry_date: null }, hoje), 'pendente'));
test('reprovado', () => assert.equal(statusDocumento({ status: 'reprovado', expiry_date: null }, hoje), 'reprovado'));
test('historico some', () => assert.equal(statusDocumento({ status: 'historico', expiry_date: null }, hoje), 'historico'));
test('valido sem validade = aprovado', () => assert.equal(statusDocumento({ status: 'valido', expiry_date: null }, hoje), 'aprovado'));
test('valido validade futura = aprovado', () => assert.equal(statusDocumento({ status: 'valido', expiry_date: '2027-01-01' }, hoje), 'aprovado'));
test('valido validade passada = vencido', () => assert.equal(statusDocumento({ status: 'valido', expiry_date: '2026-01-01' }, hoje), 'vencido'));
test('vencido explícito', () => assert.equal(statusDocumento({ status: 'vencido', expiry_date: '2026-01-01' }, hoje), 'vencido'));
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --import tsx --test src/lib/documentoStatus.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `documentoStatus.ts`**

```ts
// Status efetivo de um documento de gestão documental, derivado de status + validade.
// Puro: usado no cliente (lista) e no servidor (export). 'historico' é marcado para a
// lista escondê-lo. Compara só a data (YYYY-MM-DD), sem fuso.
export type StatusDoc = 'pendente' | 'aprovado' | 'vencido' | 'reprovado' | 'historico';

export function statusDocumento(
  doc: { status: string; expiry_date: string | null | undefined },
  hoje: Date = new Date(),
): StatusDoc {
  if (doc.status === 'historico') return 'historico';
  if (doc.status === 'pendente') return 'pendente';
  if (doc.status === 'reprovado') return 'reprovado';
  // valido ou vencido: decide pela data de validade.
  const hojeStr = hoje.toISOString().slice(0, 10);
  if (doc.expiry_date && doc.expiry_date < hojeStr) return 'vencido';
  if (doc.status === 'vencido') return 'vencido';
  return 'aprovado';
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --import tsx --test src/lib/documentoStatus.test.ts`
Expected: PASS.

- [ ] **Step 5: Teste de `providerAudience` (falha)**

Create `src/lib/providerAudience.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerAudience } from './providerAudience.js';

test('PF cooperado = medicos', () => assert.equal(providerAudience('PF', 'MEDICOS COOPERADOS'), 'medicos'));
test('PF credenciado = medicos', () => assert.equal(providerAudience('PF', 'MEDICOS CREDENCIADOS'), 'medicos'));
test('PF outro = rede', () => assert.equal(providerAudience('PF', 'PSICOLOGOS'), 'rede'));
test('PJ = rede', () => assert.equal(providerAudience('PJ', 'CLINICAS'), 'rede'));
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `node --import tsx --test src/lib/providerAudience.test.ts`
Expected: FAIL.

- [ ] **Step 7: Implementar `providerAudience.ts`**

```ts
import { deriveProviderRole } from '../../db/provider-role.js';

// Separa Médicos (cooperado/credenciado) da Rede Prestadora (o resto), reusando a
// regra única de deriveProviderRole.
export function providerAudience(personType: string | null, providerGroup: string | null): 'medicos' | 'rede' {
  const role = deriveProviderRole(personType, providerGroup);
  return role === 'cooperado' || role === 'credenciado' ? 'medicos' : 'rede';
}
```

- [ ] **Step 8: Rodar e ver passar; incluir no `test`**

Run: `node --import tsx --test src/lib/providerAudience.test.ts`
Expected: PASS.
Modify `package.json`: acrescentar ` src/lib/documentoStatus.test.ts src/lib/providerAudience.test.ts` ao fim do script `test`.

- [ ] **Step 9: Commit**
```bash
git add src/lib/documentoStatus.ts src/lib/documentoStatus.test.ts src/lib/providerAudience.ts src/lib/providerAudience.test.ts package.json
git commit -m "feat(documentos): statusDocumento e providerAudience (funções puras + testes)"
```

> Nota: `deriveProviderRole` está em `db/provider-role.ts`. O import relativo de `src/lib/` é `../../db/provider-role.js`. Confirme o caminho com um `tsc` ao usá-lo.

---

### Task 2: Tipo de notificação `documento_atualizacao`

**Files:**
- Modify: `src/lib/notifyCatalog.ts` (NOTIFY_TYPES, NOTIFY_TYPE_LABELS, renderNotification)
- Modify: `src/lib/notifyEmail.ts` (case no switch de renderNotificationEmail)
- Modify: `src/lib/notifyCatalog.test.ts` (um caso)

**Interfaces:**
- Produces: tipo `'documento_atualizacao'` renderizável por `renderNotification` e `renderNotificationEmail`.

- [ ] **Step 1: Adicionar o tipo ao catálogo**

Modify `src/lib/notifyCatalog.ts`:
- Em `NOTIFY_TYPES`, acrescentar `'documento_atualizacao'` ao array.
- Em `NOTIFY_TYPE_LABELS`, acrescentar `documento_atualizacao: 'Atualização de documento solicitada',`.
- Em `renderNotification`, adicionar o case (antes do `default`/fim do switch):
```ts
    case 'documento_atualizacao':
      return {
        title: 'Atualização de documento solicitada',
        body: String(ctx.message ?? 'Por favor, envie uma nova versão do documento solicitado.'),
        link: String(ctx.link ?? '/documentos'),
      };
```

- [ ] **Step 2: Caso no e-mail**

Modify `src/lib/notifyEmail.ts`: no `switch (type)` de `renderNotificationEmail`, antes do `default:`, adicionar:
```ts
    case 'documento_atualizacao':
      return {
        subject: 'Atualização de documento solicitada',
        html: baseEmail(name, 'Atualização de documento solicitada', String(ctx.message ?? ''), `${appUrl}${ctx.link ?? '/documentos'}`),
      };
```
> Antes de escrever, leia como os outros cases montam o retorno (ex.: `parecer_reprovado`) e use o MESMO helper/estrutura que eles usam (o nome `baseEmail` acima é ilustrativo — use o helper real do arquivo). Se não houver helper reutilizável, o `default:` já cobre o envio; nesse caso NÃO adicione o case e registre isso no relatório.

- [ ] **Step 3: Teste do render**

Modify `src/lib/notifyCatalog.test.ts`: acrescentar
```ts
test('documento_atualizacao usa a mensagem do ctx', () => {
  const c = renderNotification('documento_atualizacao', { message: 'Envie o Alvará Sanitário atualizado.' });
  assert.equal(c.title, 'Atualização de documento solicitada');
  assert.equal(c.body, 'Envie o Alvará Sanitário atualizado.');
  assert.equal(c.link, '/documentos');
});
```
(Confirme que `renderNotification` já está importado no arquivo de teste; se não, importe-o.)

- [ ] **Step 4: Rodar o teste do catálogo**

Run: `node --import tsx --test src/lib/notifyCatalog.test.ts`
Expected: PASS (todos, incluindo o novo).

- [ ] **Step 5: Commit**
```bash
git add src/lib/notifyCatalog.ts src/lib/notifyEmail.ts src/lib/notifyCatalog.test.ts
git commit -m "feat(documentos): tipo de notificação documento_atualizacao"
```

---

### Task 3: Rotas backend — Notificar e Export

**Files:**
- Modify: `server.ts` (import das funções puras; rota notificar; rota export)

**Interfaces:**
- Consumes: `statusDocumento` (`./src/lib/documentoStatus.js`), `notifyEvent`, `prestadorRecipients`, `requireAdmin` (já no arquivo), `XLSX`.
- Produces: `POST /api/documents/:id/notificar`; `GET /api/documents/export`.

- [ ] **Step 1: Imports**

Modify `server.ts`: junto aos imports de `./src/lib/*`, adicionar:
```ts
import { statusDocumento } from './src/lib/documentoStatus.js';
import XLSX from 'xlsx';
```
(Se `XLSX` já estiver importado no arquivo, não duplique.)

- [ ] **Step 2: Rota Notificar**

Modify `server.ts`: logo após a rota `app.put('/api/documents/:id/status', ...)`, adicionar:
```ts
  app.post('/api/documents/:id/notificar', authenticate, requireAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const message = String(req.body?.message ?? '').trim();
      if (!message) return res.status(400).json({ error: 'Mensagem é obrigatória' });

      const { rows: docRows } = await query('SELECT id, provider_id, type FROM documents WHERE id = $1', [id]);
      const doc = docRows[0];
      if (!doc) return res.status(404).json({ error: 'Documento não encontrado' });

      const recipients = await prestadorRecipients(Number(doc.provider_id));
      // Sem dedupeRef: dedupe_key fica null e cada clique envia (admin pode re-notificar).
      await notifyEvent('documento_atualizacao',
        { message, document_id: Number(doc.id), type: doc.type, link: '/documentos' },
        recipients,
        { providerId: Number(doc.provider_id) });

      await auditLog({
        query, userId: req.user.id, action: 'document_notify_requested',
        meta: { provider_id: Number(doc.provider_id), document_id: Number(doc.id) },
        ip: hashClientIp(req),
      });
      res.json({ ok: true, recipients: recipients.length });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
```

- [ ] **Step 3: Rota Export**

Modify `server.ts`: logo após a rota notificar, adicionar:
```ts
  app.get('/api/documents/export', authenticate, requireAdmin, async (req: any, res) => {
    try {
      const { rows } = await query(
        `SELECT d.*, p.name AS provider_name
           FROM documents d JOIN providers p ON p.id = d.provider_id
          WHERE d.type_id IS NOT NULL AND d.status <> 'historico'
          ORDER BY d.upload_date DESC NULLS LAST, d.id DESC`);
      const STATUS_LABEL: Record<string, string> = {
        pendente: 'Pendente', aprovado: 'Aprovado', vencido: 'Vencido', reprovado: 'Reprovado', historico: 'Histórico',
      };
      const header = ['Prestador', 'Documento', 'Data Envio', 'Validade', 'Status'];
      const aoa: (string | null)[][] = [header];
      for (const d of rows) {
        const st = statusDocumento(d);
        if (st === 'historico') continue;
        aoa.push([
          d.provider_name ?? '',
          d.type ?? '',
          d.upload_date ? new Date(d.upload_date).toLocaleDateString('pt-BR') : '',
          d.expiry_date ?? '',
          STATUS_LABEL[st] ?? st,
        ]);
      }
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Documentos');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      res.setHeader('Content-Disposition', 'attachment; filename="documentos.xlsx"');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(buf);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
```
> O export devolve todos os documentos de gestão documental; os filtros (view/status/grupo/busca) são aplicados no cliente antes de baixar não — para simplicidade, o cliente abre este endpoint e o Excel traz a lista completa. (Filtrar no servidor fica para quando houver volume; registrar como follow-up.)

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit` → limpo.
Boot check: `APP_ENV=dev npm run dev` em background (com `JWT_SECRET`/`IP_HASH_SECRET` só no env do shell), ~6s, confirmar "Server running" sem stack trace, parar.

- [ ] **Step 5: Commit**
```bash
git add server.ts
git commit -m "feat(documentos): rotas notificar e export .xlsx"
```

---

### Task 4: Casca Gestão Documental (admin) + extração do `Documentos.tsx`

**Files:**
- Create: `src/pages/documentos/GestaoDocumental.tsx`
- Modify: `src/pages/Documentos.tsx` (renderizar a casca quando `isAdmin`)

**Interfaces:**
- Produces: `<GestaoDocumental/>` com abas (Investigação & Lista | BI Painéis | Matriz Legal) e toggle Médicos×Rede; passa `audiencia` e renderiza `<InvestigacaoLista audiencia={...}/>` (criada na Task 5; por ora um placeholder).

- [ ] **Step 1: Criar a casca**

Create `src/pages/documentos/GestaoDocumental.tsx`:
```tsx
import { useState } from 'react';

type Aba = 'lista' | 'bi' | 'matriz';
type Audiencia = 'medicos' | 'rede';

export default function GestaoDocumental() {
  const [aba, setAba] = useState<Aba>('lista');
  const [audiencia, setAudiencia] = useState<Audiencia>('medicos');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Gestão Documental</h1>
        <div className="flex rounded-lg border border-gray-200 bg-white p-1 text-sm">
          {(['medicos', 'rede'] as Audiencia[]).map(a => (
            <button key={a} onClick={() => setAudiencia(a)}
              className={`px-3 py-1 rounded-md ${audiencia === a ? 'bg-emerald-600 text-white' : 'text-gray-600'}`}>
              {a === 'medicos' ? 'Médicos' : 'Rede Prestadora'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {([['lista', 'Investigação & Lista'], ['bi', 'BI Painéis'], ['matriz', 'Matriz Legal']] as [Aba, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setAba(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${aba === id ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {aba === 'lista' && <PlaceholderLista audiencia={audiencia} />}
      {aba === 'bi' && <EmBreve titulo="BI Painéis" />}
      {aba === 'matriz' && <EmBreve titulo="Matriz Legal" />}
    </div>
  );
}

function PlaceholderLista({ audiencia }: { audiencia: Audiencia }) {
  return <div className="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-400">Investigação & Lista ({audiencia}) — em construção</div>;
}
function EmBreve({ titulo }: { titulo: string }) {
  return <div className="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-400">{titulo} — em breve</div>;
}
```

- [ ] **Step 2: Renderizar a casca no `Documentos.tsx`**

Modify `src/pages/Documentos.tsx`: adicionar o import `import GestaoDocumental from './documentos/GestaoDocumental';` e, no início do `return` do componente (quando `isAdmin`), retornar a casca em vez da UI atual de admin:
```tsx
  if (isAdmin) return <GestaoDocumental />;
```
Colocar essa linha logo após a resolução de `isAdmin` e dos early-returns de loading/erro existentes, preservando a visão do prestador (o resto do componente) intacta para quem não é admin.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit` → limpo. (A UI vira placeholder para admin; a Task 5 preenche.)

- [ ] **Step 4: Commit**
```bash
git add src/pages/documentos/GestaoDocumental.tsx src/pages/Documentos.tsx
git commit -m "feat(documentos): casca Gestão Documental (abas + Médicos/Rede) para admin"
```

---

### Task 5: Tela Investigação & Lista (lista + filtros + export)

**Files:**
- Create: `src/pages/documentos/InvestigacaoLista.tsx`
- Modify: `src/pages/documentos/GestaoDocumental.tsx` (usar `<InvestigacaoLista/>` no lugar do placeholder)

**Interfaces:**
- Consumes: `GET /api/documents`, `GET /api/document-types` (não necessário aqui), `statusDocumento`, `providerAudience`, `GET /api/documents/export`.
- Produces: `<InvestigacaoLista audiencia={'medicos'|'rede'} onAnalisar={fn} onNotificar={fn}/>` — os modais vêm na Task 6; aqui os botões chamam props/handlers locais stub.

- [ ] **Step 1: Criar a lista**

Create `src/pages/documentos/InvestigacaoLista.tsx`:
```tsx
import { useEffect, useMemo, useState } from 'react';
import { Search, Download, Eye } from 'lucide-react';
import { fetchApi } from '../../lib/api';
import { statusDocumento, StatusDoc } from '../../lib/documentoStatus.js';
import { providerAudience } from '../../lib/providerAudience.js';

interface Doc {
  id: number; provider_id: number; provider_name?: string; type?: string;
  status: string; upload_date?: string; expiry_date?: string | null;
  person_type?: string | null; provider_group?: string | null; rejection_reason?: string | null; file_url?: string | null;
}
const STATUS_LABEL: Record<StatusDoc, string> = {
  pendente: 'Pendente', aprovado: 'Aprovado', vencido: 'Vencido', reprovado: 'Reprovado', historico: 'Histórico',
};
const STATUS_COR: Record<StatusDoc, string> = {
  pendente: 'bg-blue-100 text-blue-700', aprovado: 'bg-emerald-100 text-emerald-700',
  vencido: 'bg-amber-100 text-amber-800', reprovado: 'bg-red-100 text-red-700', historico: '',
};

export default function InvestigacaoLista({ audiencia, onAnalisar, onNotificar, reloadKey }:
  { audiencia: 'medicos' | 'rede'; onAnalisar: (d: Doc) => void; onNotificar: (d: Doc) => void; reloadKey?: number }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [fStatus, setFStatus] = useState<'' | StatusDoc>('');
  const [fGrupo, setFGrupo] = useState('');

  useEffect(() => {
    fetchApi('/documents').then(setDocs).catch(e => setErro(e.message));
  }, [reloadKey]);

  const hoje = new Date();
  const linhas = useMemo(() => docs
    .filter(d => (d as any).type_id != null)                 // só gestão documental
    .map(d => ({ d, st: statusDocumento(d, hoje) }))
    .filter(x => x.st !== 'historico')
    .filter(x => providerAudience(x.d.person_type ?? null, x.d.provider_group ?? null) === audiencia)
    .filter(x => !fStatus || x.st === fStatus)
    .filter(x => !fGrupo || (x.d.provider_group ?? '') === fGrupo)
    .filter(x => {
      const q = busca.trim().toLowerCase();
      return !q || (x.d.provider_name ?? '').toLowerCase().includes(q) || (x.d.type ?? '').toLowerCase().includes(q);
    }), [docs, audiencia, fStatus, fGrupo, busca]);

  const grupos = useMemo(() => Array.from(new Set(docs
    .filter(d => providerAudience(d.person_type ?? null, d.provider_group ?? null) === audiencia)
    .map(d => d.provider_group).filter(Boolean))) as string[], [docs, audiencia]);

  const fmt = (s?: string | null) => s ? new Date(s).toLocaleDateString('pt-BR') : '—';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-100 bg-white p-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar prestador ou documento…"
            className="w-full rounded-lg border border-gray-300 pl-9 pr-3 py-2 text-sm" />
        </div>
        <select value={fStatus} onChange={e => setFStatus(e.target.value as any)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Todos os status</option>
          {(['pendente', 'aprovado', 'vencido', 'reprovado'] as StatusDoc[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select value={fGrupo} onChange={e => setFGrupo(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Todos os grupos</option>
          {grupos.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <a href="/api/documents/export" className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700">
          <Download className="h-4 w-4" /> Exportar .xlsx
        </a>
      </div>

      {erro && <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr className="text-left text-xs font-medium uppercase text-gray-500">
                <th className="px-4 py-3">Prestador</th><th className="px-4 py-3">Documento</th>
                <th className="px-4 py-3">Data Envio</th><th className="px-4 py-3">Validade</th>
                <th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {linhas.map(({ d, st }) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 text-sm">{d.provider_name ?? '—'}</td>
                  <td className="px-4 py-3 text-sm">{d.type ?? '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{fmt(d.upload_date)}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{fmt(d.expiry_date)}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COR[st]}`}>{STATUS_LABEL[st]}</span></td>
                  <td className="px-4 py-3 text-right text-sm">
                    {st === 'pendente' && <button onClick={() => onAnalisar(d)} className="font-medium text-emerald-700 hover:underline">Analisar</button>}
                    {(st === 'vencido' || st === 'reprovado') && <button onClick={() => onNotificar(d)} className="font-medium text-amber-700 hover:underline">Notificar</button>}
                    {st === 'aprovado' && <button onClick={() => onAnalisar(d)} className="inline-flex items-center gap-1 text-gray-500 hover:text-emerald-700"><Eye className="h-4 w-4" />Ver</button>}
                  </td>
                </tr>
              ))}
              {linhas.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Nenhum documento.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
```
> `GET /api/documents` precisa trazer `person_type`, `provider_group` e `type_id` por linha para a classificação e o filtro. Verifique a query da rota; se faltarem, adicione-os ao `SELECT` (join com `providers`) — é uma mudança pequena no `server.ts` dentro desta task.

- [ ] **Step 2: Usar na casca**

Modify `GestaoDocumental.tsx`: importar `InvestigacaoLista` e trocar `<PlaceholderLista .../>` por
`<InvestigacaoLista audiencia={audiencia} onAnalisar={() => {}} onNotificar={() => {}} />` (handlers reais na Task 6). Remover o `PlaceholderLista`.

- [ ] **Step 3: Garantir campos na API**

Modify `server.ts`: na rota `GET /api/documents` (ramo admin), garantir que o `SELECT` traga `p.person_type`, `p.provider_group` e `d.type_id`. Se já for `SELECT d.*, ...`, `type_id` já vem; adicionar `p.person_type, p.provider_group` ao select do join com `providers`.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit` → limpo. Boot check como na Task 3. Se o server subir e `/api/documents` responder com os campos, a lista popula.

- [ ] **Step 5: Commit**
```bash
git add src/pages/documentos/InvestigacaoLista.tsx src/pages/documentos/GestaoDocumental.tsx server.ts
git commit -m "feat(documentos): lista Investigação com filtros, status e export"
```

---

### Task 6: Modais Analisar e Notificar

**Files:**
- Create: `src/pages/documentos/AnalisarModal.tsx`, `src/pages/documentos/NotificarModal.tsx`
- Modify: `src/pages/documentos/GestaoDocumental.tsx` (estado dos modais + handlers + reload)

**Interfaces:**
- Consumes: `PUT /api/documents/:id/status`, `POST /api/documents/:id/notificar`.

- [ ] **Step 1: AnalisarModal (viewer + aprovar/reprovar)**

Create `src/pages/documentos/AnalisarModal.tsx`:
```tsx
import { useState } from 'react';
import { X, ZoomIn, ZoomOut, Download } from 'lucide-react';
import { fetchApi } from '../../lib/api';

export default function AnalisarModal({ doc, onClose, onDone }:
  { doc: any; onClose: () => void; onDone: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [issue, setIssue] = useState(doc.issue_date ?? '');
  const [expiry, setExpiry] = useState(doc.expiry_date ?? '');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [saving, setSaving] = useState(false);
  const somenteLeitura = doc.status !== 'pendente';
  const isPdf = String(doc.file_url ?? '').toLowerCase().endsWith('.pdf');

  const decidir = async (status: 'valido' | 'reprovado') => {
    if (status === 'reprovado' && !motivo.trim()) { setErro('Informe o motivo da reprovação.'); return; }
    setSaving(true);
    try {
      await fetchApi(`/documents/${doc.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status, issue_date: issue || null, expiry_date: expiry || null, rejection_reason: status === 'reprovado' ? motivo : undefined }),
      });
      onDone();
    } catch (e: any) { setErro(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="font-bold">{doc.type} — {doc.provider_name ?? ''}</h3>
          <button onClick={onClose}><X className="h-5 w-5 text-gray-500" /></button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-auto border-r bg-gray-100">
            {!doc.file_url ? <div className="p-8 text-center text-gray-400">Sem arquivo.</div>
              : isPdf ? <iframe src={doc.file_url} className="h-full w-full border-0" title="documento" />
              : <div className="flex items-center justify-center p-4"><img src={doc.file_url} alt="documento" style={{ transform: `scale(${zoom})` }} /></div>}
          </div>
          <div className="w-80 space-y-3 overflow-y-auto p-4">
            {!isPdf && doc.file_url && (
              <div className="flex items-center gap-2">
                <button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} className="rounded border p-1"><ZoomOut className="h-4 w-4" /></button>
                <span className="text-sm">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(z => Math.min(3, z + 0.25))} className="rounded border p-1"><ZoomIn className="h-4 w-4" /></button>
              </div>
            )}
            {doc.file_url && <a href={doc.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-emerald-700"><Download className="h-4 w-4" /> Baixar</a>}
            <label className="block text-sm">Emissão<input type="date" value={issue || ''} onChange={e => setIssue(e.target.value)} disabled={somenteLeitura} className="mt-1 w-full rounded border px-2 py-1" /></label>
            <label className="block text-sm">Validade<input type="date" value={expiry || ''} onChange={e => setExpiry(e.target.value)} disabled={somenteLeitura} className="mt-1 w-full rounded border px-2 py-1" /></label>
            {!somenteLeitura && (
              <label className="block text-sm">Motivo (ao reprovar)
                <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} className="mt-1 w-full rounded border px-2 py-1" />
              </label>
            )}
            {doc.rejection_reason && <div className="rounded bg-red-50 p-2 text-xs text-red-700">Reprovado: {doc.rejection_reason}</div>}
            {erro && <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{erro}</div>}
            {!somenteLeitura && (
              <div className="flex gap-2 pt-2">
                <button disabled={saving} onClick={() => decidir('valido')} className="flex-1 rounded bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700">Aprovar</button>
                <button disabled={saving} onClick={() => decidir('reprovado')} className="flex-1 rounded bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-700">Reprovar</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: NotificarModal (mensagem semi-pronta)**

Create `src/pages/documentos/NotificarModal.tsx`:
```tsx
import { useState } from 'react';
import { X } from 'lucide-react';
import { fetchApi } from '../../lib/api';

export default function NotificarModal({ doc, motivo, onClose, onDone }:
  { doc: any; motivo: 'vencido' | 'reprovado'; onClose: () => void; onDone: () => void }) {
  const padrao = `O documento "${doc.type}" está ${motivo === 'vencido' ? 'vencido' : 'reprovado'}. `
    + `Por favor, envie uma nova versão atualizada pelo portal, na Gestão Documental.`
    + (motivo === 'reprovado' && doc.rejection_reason ? `\nMotivo da reprovação: ${doc.rejection_reason}` : '');
  const [msg, setMsg] = useState(padrao);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    if (!msg.trim()) { setErro('A mensagem não pode ficar vazia.'); return; }
    setEnviando(true);
    try { await fetchApi(`/documents/${doc.id}/notificar`, { method: 'POST', body: JSON.stringify({ message: msg.trim() }) }); onDone(); }
    catch (e: any) { setErro(e.message); } finally { setEnviando(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg space-y-3 rounded-xl bg-white p-6">
        <div className="flex items-center justify-between"><h3 className="font-bold">Notificar prestador</h3><button onClick={onClose}><X className="h-5 w-5 text-gray-500" /></button></div>
        <p className="text-sm text-gray-500">{doc.provider_name} — {doc.type}</p>
        <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={6} className="w-full rounded border px-3 py-2 text-sm" />
        {erro && <div className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{erro}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded px-4 py-2 text-gray-600">Cancelar</button>
          <button disabled={enviando} onClick={enviar} className="rounded bg-emerald-600 px-4 py-2 text-white hover:bg-emerald-700">Enviar</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Ligar os modais na casca**

Modify `GestaoDocumental.tsx`: adicionar estado `const [analisar, setAnalisar] = useState<any|null>(null);`, `const [notificar, setNotificar] = useState<any|null>(null);`, `const [reloadKey, setReloadKey] = useState(0);`. Passar à lista: `onAnalisar={setAnalisar}` e `onNotificar={setNotificar}` e `reloadKey={reloadKey}`. Renderizar ao fim:
```tsx
{analisar && <AnalisarModal doc={analisar} onClose={() => setAnalisar(null)} onDone={() => { setAnalisar(null); setReloadKey(k => k + 1); }} />}
{notificar && <NotificarModal doc={notificar} motivo={statusDocumento(notificar) === 'reprovado' ? 'reprovado' : 'vencido'} onClose={() => setNotificar(null)} onDone={() => setNotificar(null)} />}
```
Importar `AnalisarModal`, `NotificarModal` e `statusDocumento`.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit` → limpo. Boot check. Smoke manual: como admin, abrir Gestão Documental → Investigação & Lista; um pendente abre Analisar; aprovar/reprovar atualiza a lista; um vencido/reprovado abre Notificar e envia (o 2FA/aviso não se aplica aqui — a notificação sai no log/caixa).

- [ ] **Step 5: Commit**
```bash
git add src/pages/documentos/AnalisarModal.tsx src/pages/documentos/NotificarModal.tsx src/pages/documentos/GestaoDocumental.tsx
git commit -m "feat(documentos): modais Analisar e Notificar"
```

---

## Self-Review

**Cobertura da spec:**
- Casca com abas + toggle Médicos×Rede → Task 4. ✔
- Lista (colunas, busca, filtros status/grupo, export) → Task 5. ✔
- Status derivado Pendente/Aprovado/Vencido/Reprovado → Task 1 (`statusDocumento`), usado em 5 e 3. ✔
- Classificação Médico×Rede → Task 1 (`providerAudience`). ✔
- Analisar (viewer + aprovar/reprovar + validade + justificativa) → Task 6, via `/status` existente. ✔
- Notificar (mensagem semi-pronta + re-notificar) → Task 2 (tipo) + Task 3 (rota) + Task 6 (modal). ✔
- Export .xlsx → Task 3. ✔
- Convivência (só `type_id` não nulo, sem histórico) → filtros em 3 e 5. ✔
- Fora de escopo (BI, Matriz, atributos, Isento/Vencendo/Verificar) → stubs "em breve". ✔

**Placeholders:** nenhum TODO/TBD; cada passo tem código ou comando. O único ponto a confirmar em tempo de implementação (sinalizado inline) é o helper de e-mail na Task 2 (usar o real do arquivo) e os campos extras no `SELECT` de `/api/documents` na Task 5.

**Consistência de tipos:** `statusDocumento` (retorno StatusDoc) e `providerAudience` ('medicos'|'rede') usados igualmente em cliente e servidor; rotas `/documents/:id/notificar`, `/documents/export`, `/documents/:id/status` idênticas entre tasks.
