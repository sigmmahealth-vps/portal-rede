# Certificações (autosserviço + validação) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O prestador cadastra certificações (campos + PDF) que entram como pendentes; o admin aprova/reprova na página de detalhe do prestador. Espelha o fluxo dos documentos.

**Architecture:** Migration adiciona arquivo/status à `provider_certifications`; quatro endpoints espelham `/api/documents` (listar, criar com upload, mudar status, excluir); uma página `Certificacoes` no portal do prestador; uma seção de validação na aba "Documentos e Qualificação" do `ProviderDetail` (admin).

**Tech Stack:** TypeScript (ESM `.js` imports), Postgres (`pg`), Express + multer (`docUpload`), React + React Router + `fetchApi`. Sem libs novas.

## Global Constraints

- Imports relativos entre módulos TS usam sufixo `.js` (ESM/tsx).
- Estados do ciclo: `pendente` / `valido` / `reprovado` (iguais aos documentos). `validated` boolean fica em sincronia (`= status = 'valido'`).
- Upload reusa o middleware `docUpload` (server.ts:91) — mesmos formato/tamanho dos documentos. Arquivo é **obrigatório** no POST.
- Frontend chama o backend via `fetchApi` (`src/lib/api.ts`); POST com `FormData` (o helper não seta Content-Type para FormData).
- Endpoints de admin exigem `role` admin/auditoria; os do prestador agem sobre o próprio `req.user.provider_id`.
- Migration nova: `0064` (a última é `0063_document_type_requirements.sql`).
- Sem módulo/teste de lib novo (CRUD sem lógica pura nova). Verificação: `tsc` + build + smoke.
- Data de emissão não pode ser futura (igual aos documentos); validade vencida é permitida.

---

### Task 1: Migration — arquivo e status em `provider_certifications`

**Files:**
- Create: `db/migrations/0064_provider_certifications_upload.sql`

**Interfaces:**
- Produces: colunas `file_url, status, rejection_reason, uploaded_by, upload_date` em `provider_certifications`, usadas pelas Tasks 2–4.

- [ ] **Step 1: Escrever a migration**

Create `db/migrations/0064_provider_certifications_upload.sql`:

```sql
-- 0064_provider_certifications_upload.sql
-- Certificações autoinformadas: arquivo anexo + ciclo de validação (pendente/valido/reprovado).
ALTER TABLE provider_certifications ADD COLUMN IF NOT EXISTS file_url text;
ALTER TABLE provider_certifications ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pendente';
ALTER TABLE provider_certifications ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE provider_certifications ADD COLUMN IF NOT EXISTS uploaded_by bigint REFERENCES users(id);
ALTER TABLE provider_certifications ADD COLUMN IF NOT EXISTS upload_date timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_certifications_status_check') THEN
    ALTER TABLE provider_certifications
      ADD CONSTRAINT provider_certifications_status_check CHECK (status IN ('pendente','valido','reprovado'));
  END IF;
END $$;
```

- [ ] **Step 2: Aplicar no DEV e verificar**

Run: `APP_ENV=dev npm run db:migrate`
Expected: aplica `0064` sem erro. Conferir:

```bash
APP_ENV=dev node --import tsx -e "import('./db/db.js').then(async ({query,pool})=>{const {rows}=await query(\"SELECT column_name FROM information_schema.columns WHERE table_name='provider_certifications' AND column_name IN ('file_url','status','rejection_reason','uploaded_by','upload_date')\");console.log(rows.map(r=>r.column_name).sort().join(', '));await pool.end();})"
```

Expected: `file_url, rejection_reason, status, upload_date, uploaded_by`.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/0064_provider_certifications_upload.sql
git commit -m "feat(certificacoes): migration de arquivo e status em provider_certifications"
```

---

### Task 2: Endpoints de certificações

**Files:**
- Modify: `server.ts` (inserir 4 rotas após a rota `DELETE /api/documents/:id`, que termina por volta da linha 2570)

**Interfaces:**
- Consumes: `docUpload`, `authenticate`, `query`, `auditLog`, `hashClientIp` (todos em escopo).
- Produces:
  - `GET /api/certifications` → prestador: as suas; admin/auditoria: todas com `provider_name, person_type, provider_group`.
  - `POST /api/certifications` (`docUpload`) → cria (`pendente`), arquivo obrigatório.
  - `PUT /api/certifications/:id/status` → admin aprova/reprova.
  - `DELETE /api/certifications/:id` → prestador dono remove se `pendente`.

- [ ] **Step 1: Inserir as rotas**

Logo após o fechamento de `app.delete('/api/documents/:id', ...)` (termina com `});`), inserir:

```ts
  // ===== Certificações (autoinformadas pelo prestador, validadas pelo admin) =====
  app.get('/api/certifications', authenticate, async (req: any, res) => {
    try {
      const { role, provider_id } = req.user;
      if (role === 'admin' || role === 'auditoria') {
        const { rows } = await query(
          `SELECT c.*, p.name AS provider_name, p.person_type, p.provider_group
             FROM provider_certifications c JOIN providers p ON p.id = c.provider_id
            ORDER BY c.id DESC`);
        return res.json(rows);
      }
      if (!provider_id) return res.status(400).json({ error: 'Usuário sem prestador vinculado' });
      const { rows } = await query(
        'SELECT * FROM provider_certifications WHERE provider_id = $1 ORDER BY id DESC', [provider_id]);
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/certifications', authenticate, docUpload, async (req: any, res) => {
    try {
      const { role, provider_id, id: user_id } = req.user;
      const { kind, title, issuer, level, issued_date, expiry_date } = req.body;
      const targetProviderId = role === 'prestador' ? provider_id : req.body.provider_id;
      if (!targetProviderId) return res.status(400).json({ error: 'Prestador é obrigatório' });
      if (!title || !String(title).trim()) return res.status(400).json({ error: 'Título é obrigatório' });
      if (!req.file) return res.status(400).json({ error: 'Arquivo é obrigatório' });
      const hoje = new Date().toLocaleDateString('en-CA');
      if (issued_date && issued_date > hoje) return res.status(400).json({ error: 'Data de emissão não pode ser futura' });

      const file_url = '/uploads/' + req.file.filename;
      const { rows } = await query(
        `INSERT INTO provider_certifications
           (provider_id, kind, title, issuer, level, issued_date, expiry_date, status, validated, file_url, uploaded_by, upload_date, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pendente',false,$8,$9,now(),'autoinformado') RETURNING id`,
        [targetProviderId, kind || null, String(title).trim(), issuer || null, level || null,
         issued_date || null, expiry_date || null, file_url, user_id]);
      const { rows: created } = await query('SELECT * FROM provider_certifications WHERE id = $1', [rows[0].id]);
      await auditLog({ query, userId: user_id, action: 'certification_created',
        meta: { provider_id: Number(targetProviderId), certification_id: rows[0].id, title: String(title).trim() },
        ip: hashClientIp(req) });
      res.json(created[0]);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/certifications/:id/status', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') return res.status(403).json({ error: 'Unauthorized' });
      const { status, rejection_reason } = req.body;
      if (!['valido', 'reprovado'].includes(status)) return res.status(400).json({ error: 'Status inválido' });
      const { rows } = await query(
        `UPDATE provider_certifications SET status = $1, validated = ($1 = 'valido'), rejection_reason = $2
          WHERE id = $3 RETURNING *`,
        [status, status === 'reprovado' ? (rejection_reason || null) : null, req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'Certificação não encontrada' });
      await auditLog({ query, userId: req.user.id, action: 'certification_status_changed',
        meta: { provider_id: Number(rows[0].provider_id), certification_id: Number(req.params.id), status },
        ip: hashClientIp(req) });
      res.json(rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/certifications/:id', authenticate, async (req: any, res) => {
    try {
      const { role, provider_id } = req.user;
      const { rows } = await query('SELECT * FROM provider_certifications WHERE id = $1', [req.params.id]);
      const cert = rows[0] as any;
      if (!cert) return res.status(404).json({ error: 'Certificação não encontrada' });
      if (role === 'prestador' && cert.provider_id !== provider_id) return res.status(403).json({ error: 'Unauthorized' });
      if (cert.status !== 'pendente') return res.status(400).json({ error: 'Só certificações pendentes podem ser excluídas' });
      await query('DELETE FROM provider_certifications WHERE id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
```

- [ ] **Step 2: Verificar compilação**

Run: `npm run lint`
Expected: `tsc --noEmit` sem erros.

- [ ] **Step 3: Commit**

```bash
git add server.ts
git commit -m "feat(certificacoes): endpoints listar/criar/validar/excluir"
```

---

### Task 3: Página "Certificações" do prestador

**Files:**
- Create: `src/pages/Certificacoes.tsx`
- Modify: `src/App.tsx` (nova rota)
- Modify: `src/components/Layout.tsx` (item de menu)

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/certifications` via `fetchApi`.
- Produces: componente default `Certificacoes`.

- [ ] **Step 1: Criar a página**

Create `src/pages/Certificacoes.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { fetchApi } from '../lib/api';
import { Plus, Trash2, FileText } from 'lucide-react';

type Cert = {
  id: number; kind: string | null; title: string; issuer: string | null; level: string | null;
  issued_date: string | null; expiry_date: string | null; status: string; rejection_reason: string | null; file_url: string | null;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  pendente: { label: 'Pendente', cls: 'bg-blue-50 text-blue-700' },
  valido: { label: 'Válido', cls: 'bg-emerald-50 text-emerald-700' },
  reprovado: { label: 'Reprovado', cls: 'bg-red-50 text-red-700' },
};
const fmt = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');

export default function Certificacoes() {
  const [certs, setCerts] = useState<Cert[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [modal, setModal] = useState(false);

  const load = () => {
    setCarregando(true);
    fetchApi('/certifications').then(setCerts).catch(e => setErro(e.message)).finally(() => setCarregando(false));
  };
  useEffect(load, []);

  async function excluir(id: number) {
    setErro('');
    try { await fetchApi(`/certifications/${id}`, { method: 'DELETE' }); load(); }
    catch (e: any) { setErro(e.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Certificações</h1>
        <button onClick={() => setModal(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700">
          <Plus className="h-4 w-4" /> Adicionar certificação
        </button>
      </div>
      {erro && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}

      {carregando ? <div className="p-8 text-center text-gray-400">Carregando…</div>
        : !certs.length ? <div className="rounded-xl border border-gray-100 bg-white p-8 text-center text-gray-400">Nenhuma certificação cadastrada.</div>
        : (
        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 text-left text-gray-500">
              <th className="px-4 py-3 font-medium">Título</th>
              <th className="px-4 py-3 font-medium">Tipo</th>
              <th className="px-4 py-3 font-medium">Emissor</th>
              <th className="px-4 py-3 font-medium">Validade</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-left">Ações</th>
            </tr></thead>
            <tbody>
              {certs.map(c => (
                <tr key={c.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3 text-gray-900">
                    {c.file_url ? <a href={c.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline"><FileText className="h-4 w-4" />{c.title}</a> : c.title}
                    {c.status === 'reprovado' && c.rejection_reason && <div className="text-xs text-red-600">{c.rejection_reason}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{c.kind ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{c.issuer ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{fmt(c.expiry_date)}</td>
                  <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[c.status]?.cls ?? ''}`}>{STATUS[c.status]?.label ?? c.status}</span></td>
                  <td className="px-4 py-3">
                    {c.status === 'pendente' && (
                      <button onClick={() => excluir(c.id)} title="Excluir" className="text-gray-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && <AddModal onClose={() => setModal(false)} onDone={() => { setModal(false); load(); }} />}
    </div>
  );
}

function AddModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const hojeISO = new Date().toLocaleDateString('en-CA');
  const [form, setForm] = useState({ kind: '', title: '', issuer: '', level: '', issued_date: '', expiry_date: '' });
  const [file, setFile] = useState<File | null>(null);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function salvar() {
    setErro('');
    if (!form.title.trim()) return setErro('Título é obrigatório.');
    if (!file) return setErro('Anexe o arquivo da certificação.');
    if (form.issued_date && form.issued_date > hojeISO) return setErro('A data de emissão não pode ser futura.');
    setEnviando(true);
    const fd = new FormData();
    fd.append('file', file);
    for (const [k, v] of Object.entries(form)) if (v) fd.append(k, v);
    try { await fetchApi('/certifications', { method: 'POST', body: fd }); onDone(); }
    catch (e: any) { setErro(e.message); setEnviando(false); }
  }

  const vencida = !!form.expiry_date && form.expiry_date < hojeISO;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-bold text-gray-900">Adicionar certificação</h2>
        {erro && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2 text-sm">Título*<input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" value={form.title} onChange={e => set('title', e.target.value)} /></label>
          <label className="text-sm">Tipo<input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" value={form.kind} onChange={e => set('kind', e.target.value)} /></label>
          <label className="text-sm">Emissor<input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" value={form.issuer} onChange={e => set('issuer', e.target.value)} /></label>
          <label className="text-sm">Nível<input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" value={form.level} onChange={e => set('level', e.target.value)} /></label>
          <label className="text-sm">Emissão<input type="date" max={hojeISO} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" value={form.issued_date} onChange={e => set('issued_date', e.target.value)} /></label>
          <label className="text-sm">Validade<input type="date" className={`mt-1 w-full rounded-lg border px-3 py-2 ${vencida ? 'border-red-400 text-red-700' : 'border-gray-300'}`} value={form.expiry_date} onChange={e => set('expiry_date', e.target.value)} /></label>
          <label className="sm:col-span-2 text-sm">Arquivo*<input type="file" className="mt-1 w-full text-sm" onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">Cancelar</button>
          <button onClick={salvar} disabled={enviando} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">{enviando ? 'Enviando…' : 'Salvar'}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Registrar a rota em `src/App.tsx`**

Junto das outras rotas filhas (ex.: `<Route path="documentos" element={<Documentos />} />`), adicionar:
```tsx
          <Route path="certificacoes" element={<Certificacoes />} />
```
E o import no topo (junto dos outros imports de página):
```tsx
import Certificacoes from './pages/Certificacoes';
```

- [ ] **Step 3: Adicionar o item de menu em `src/components/Layout.tsx`**

No array de itens de navegação, logo após `{ name: 'Gestão Documental', href: '/documentos', icon: FileText }` (linha ~30), adicionar:
```tsx
  { name: 'Certificações', href: '/certificacoes', icon: Award },
```
E incluir `Award` no import de `lucide-react` no topo do arquivo.

- [ ] **Step 4: Verificar compilação e build**

Run: `npm run lint && npm run build`
Expected: `tsc` sem erros; build ok.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Certificacoes.tsx src/App.tsx src/components/Layout.tsx
git commit -m "feat(certificacoes): pagina do prestador (listar/adicionar/excluir)"
```

---

### Task 4: Validação do admin no detalhe do prestador

**Files:**
- Create: `src/pages/admin/CertificacoesAdmin.tsx`
- Modify: `src/pages/admin/ProviderDetail.tsx` (renderizar a seção na aba `documentos`, substituindo o placeholder "Em breve")

**Interfaces:**
- Consumes: `provider.certifications` (já no payload de `GET /api/providers/:id`); `PUT /api/certifications/:id/status`.
- Produces: componente `CertificacoesAdmin({ certifications, onChange })`.

- [ ] **Step 1: Criar o componente de validação**

Create `src/pages/admin/CertificacoesAdmin.tsx`:

```tsx
import { useState } from 'react';
import { fetchApi } from '../../lib/api';
import { FileText, Check, X } from 'lucide-react';

type Cert = {
  id: number; title: string; kind: string | null; issuer: string | null;
  issued_date: string | null; expiry_date: string | null; status: string; rejection_reason: string | null; file_url: string | null;
};
const STATUS: Record<string, { label: string; cls: string }> = {
  pendente: { label: 'Pendente', cls: 'bg-blue-50 text-blue-700' },
  valido: { label: 'Válido', cls: 'bg-emerald-50 text-emerald-700' },
  reprovado: { label: 'Reprovado', cls: 'bg-red-50 text-red-700' },
};
const fmt = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—');

export default function CertificacoesAdmin({ certifications, onChange }: { certifications: Cert[]; onChange: () => void }) {
  const [erro, setErro] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  async function mudar(id: number, status: 'valido' | 'reprovado') {
    setErro('');
    let rejection_reason: string | undefined;
    if (status === 'reprovado') {
      const m = window.prompt('Motivo da reprovação:');
      if (m === null) return;
      rejection_reason = m;
    }
    setBusyId(id);
    try {
      await fetchApi(`/certifications/${id}/status`, { method: 'PUT', body: JSON.stringify({ status, rejection_reason }) });
      onChange();
    } catch (e: any) { setErro(e.message); }
    finally { setBusyId(null); }
  }

  if (!certifications.length)
    return <div className="rounded-xl border border-gray-100 bg-white p-6 text-center text-sm text-gray-400">Nenhuma certificação enviada por este prestador.</div>;

  return (
    <div className="space-y-2">
      {erro && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>}
      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100 text-left text-gray-500">
            <th className="px-4 py-3 font-medium">Título</th>
            <th className="px-4 py-3 font-medium">Emissor</th>
            <th className="px-4 py-3 font-medium">Validade</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Ações</th>
          </tr></thead>
          <tbody>
            {certifications.map(c => (
              <tr key={c.id} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-3 text-gray-900">
                  {c.file_url ? <a href={c.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline"><FileText className="h-4 w-4" />{c.title}</a> : c.title}
                  {c.status === 'reprovado' && c.rejection_reason && <div className="text-xs text-red-600">{c.rejection_reason}</div>}
                </td>
                <td className="px-4 py-3 text-gray-600">{c.issuer ?? '—'}</td>
                <td className="px-4 py-3 text-gray-600">{fmt(c.expiry_date)}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[c.status]?.cls ?? ''}`}>{STATUS[c.status]?.label ?? c.status}</span></td>
                <td className="px-4 py-3">
                  {c.status === 'pendente' && (
                    <div className="flex gap-2">
                      <button disabled={busyId === c.id} onClick={() => mudar(c.id, 'valido')} title="Aprovar" className="text-emerald-600 hover:text-emerald-800 disabled:opacity-40"><Check className="h-4 w-4" /></button>
                      <button disabled={busyId === c.id} onClick={() => mudar(c.id, 'reprovado')} title="Reprovar" className="text-red-600 hover:text-red-800 disabled:opacity-40"><X className="h-4 w-4" /></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Renderizar na aba `documentos` do `ProviderDetail.tsx`**

Adicionar o import no topo (junto dos outros):
```tsx
import CertificacoesAdmin from './CertificacoesAdmin';
```

Substituir TODO o bloco do placeholder "Em breve" dentro de `{activeTab === 'documentos' && (...)}` (as linhas do `<div className="rounded-2xl border border-dashed ...">` até o `</div>` que o fecha, logo após o `<h2>Documentos e Qualificação</h2>`) por:

```tsx
              <div>
                <h3 className="mb-2 text-sm font-semibold text-gray-700">Certificações</h3>
                <CertificacoesAdmin certifications={provider.certifications ?? []} onChange={load} />
              </div>
```

(Manter o `<h2 className="text-lg font-bold text-gray-800">Documentos e Qualificação</h2>` e o wrapper `<div className="space-y-6">`.)

- [ ] **Step 3: Verificar compilação e build**

Run: `npm run lint && npm run build`
Expected: `tsc` sem erros; build ok. (Se `provider` for tipado sem `certifications`, usar `(provider as any).certifications ?? []`.)

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/CertificacoesAdmin.tsx src/pages/admin/ProviderDetail.tsx
git commit -m "feat(certificacoes): validacao do admin no detalhe do prestador"
```

---

## Capstone (após as 4 tasks)

- [ ] `npm test` — suíte verde (sem teste novo; garante que nada regrediu).
- [ ] `npm run lint` — `tsc` limpo.
- [ ] `npm run build` — build ok.
- [ ] Revisão final da branch (requesting-code-review) + correções.
- [ ] **Reiniciar o servidor dev** (rotas novas; `tsx server.ts` não recarrega sozinho).
- [ ] Smoke no navegador: prestador adiciona certificação (com PDF) → aparece **pendente**; admin abre o detalhe do prestador → aba Documentos e Qualificação → **aprova** → prestador vê **válido**; **reprovar** grava motivo; **excluir** some enquanto pendente.
- [ ] Push da `dev` só após o OK da Katy.

## Notas de verificação
- Fatia é CRUD espelhando os documentos; sem lógica pura nova. Verificação por `tsc` + build + smoke.
- O admin reusa a página de detalhe existente (aba Documentos e Qualificação, antes um stub "Em breve").
