# Detalhamento do Prestador (item 5.2, Tela 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin/auditoria-only page at `/admin/prestadores/:id` that shows a single provider's cadastro, unidades, equipe/contatos, and a documentos/qualificação summary, reached by clicking a row in the existing "Rede de Prestadores" table.

**Architecture:** One new backend endpoint (`GET /api/providers/:id`, aggregating `providers` + `provider_locations` + `provider_certifications` + counts from `documents`/`qualification_submissions`) feeds one new React page (`src/pages/admin/ProviderDetail.tsx`) with an internal 4-item sidebar (local `useState`, no sub-routes). The Equipe/Contatos tab reuses a component extracted from the existing `Equipe.tsx` (`ProviderContactsPanel`) so contact CRUD logic is not duplicated.

**Tech Stack:** Express + `pg` (`server.ts`), React + react-router-dom + Tailwind (`src/pages/**`), `fetchApi` helper (`src/lib/api.ts`).

## Global Constraints

- Access restricted to `role === 'admin' || role === 'auditoria'` — same rule as `GET /api/providers` (`server.ts:1206`).
- Dados Cadastrais and Unidades tabs are **read-only** — no edit/save UI (spec "Não-objetivos").
- No CRUD for `provider_locations` in this delivery.
- No document upload or qualification review UI in this delivery — only a summary + links out to `Documentos.tsx`/`Auditorias.tsx`.
- No automated HTTP route tests exist anywhere in `server.ts` today (`npm test` only covers pure modules) — this plan follows that existing convention and verifies manually, per spec's "Testes" section.
- Follow existing color/style conventions: active tab/button color `bg-[#00995D]` / hover `bg-[#007A4A]`, card style `bg-white rounded-xl shadow-sm border border-gray-100`.

---

## File Structure

- **Modify:** `server.ts` — add `GET /api/providers/:id` near the existing `providers` handlers (~line 1216).
- **Modify:** `src/App.tsx` — add route `admin/prestadores/:id`.
- **Modify:** `src/pages/Admin.tsx` — make the `prestadores` table rows clickable, navigating to the new route.
- **Create:** `src/pages/admin/ProviderContactsPanel.tsx` — contact list + add/remove UI, parameterized by `providerId`, extracted from `Equipe.tsx`.
- **Modify:** `src/pages/Equipe.tsx` — use `ProviderContactsPanel` instead of its inline contact list/form, keeping its own provider-selector wrapper for non-admin/admin-picks-a-provider behavior.
- **Create:** `src/pages/admin/ProviderDetail.tsx` — the new page: header, sidebar, 4 tabs (Dados Cadastrais, Unidades, Equipe/Contatos, Documentos e Qualificação).

---

### Task 1: Backend — `GET /api/providers/:id`

**Files:**
- Modify: `server.ts:1216` (insert new handler right after the existing `POST /api/providers` handler ends, i.e. after line 1241, before the `// Qualification Scripts` comment at line 1243)

**Interfaces:**
- Consumes: `query()` from `./db/db.js` (already imported at `server.ts:9`), `authenticate` middleware (defined `server.ts:269`).
- Produces: `GET /api/providers/:id` — JSON response shape consumed by Task 4 (`ProviderDetail.tsx`):
  ```ts
  {
    id: number; sgu_code: string | null; name: string; trade_name: string | null;
    person_type: 'PF' | 'PJ' | null; cnpj: string | null; cpf: string | null;
    council_registry: string | null; specialties: any[]; provider_group: string | null;
    provider_type: string | null; area_atuacao: string | null;
    qualification_level: string | null; status: string | null;
    source: string; sgu_synced_at: string | null; created_at: string;
    locations: Array<{ id: number; label: string | null; cep: string | null;
      logradouro: string | null; numero: string | null; complemento: string | null;
      bairro: string | null; cidade: string | null; uf: string | null;
      phone: string | null; email: string | null; is_primary: boolean;
      in_medical_guide: boolean; active: boolean }>;
    certifications: Array<{ id: number; kind: string; title: string | null;
      issuer: string | null; level: string | null; issued_date: string | null;
      expiry_date: string | null; validated: boolean | null }>;
    summary: {
      documents_pending: number; documents_expired: number; documents_total: number;
      certifications_total: number;
      last_qualification_submission: { id: number; cycle_title: string;
        status: string; created_at: string } | null;
    };
  }
  ```
  Errors: `403 { error: 'Unauthorized' }` for non-admin/auditoria roles; `404 { error: 'Prestador não encontrado' }` when the id doesn't exist.

- [ ] **Step 1: Add the endpoint**

Insert immediately after the closing `});` of `app.post('/api/providers', ...)` (currently ending at `server.ts:1241`), before the `// Qualification Scripts` comment:

```ts
  app.get('/api/providers/:id', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      const providerId = req.params.id;
      const { rows: providerRows } = await query('SELECT * FROM providers WHERE id = $1', [providerId]);
      const provider = providerRows[0] as any;
      if (!provider) {
        return res.status(404).json({ error: 'Prestador não encontrado' });
      }

      const { rows: locations } = await query(
        'SELECT * FROM provider_locations WHERE provider_id = $1 ORDER BY is_primary DESC, id ASC',
        [providerId]
      );
      const { rows: certifications } = await query(
        'SELECT * FROM provider_certifications WHERE provider_id = $1 ORDER BY issued_date DESC NULLS LAST, id DESC',
        [providerId]
      );
      const { rows: docStatusRows } = await query(
        'SELECT status, COUNT(*)::int AS count FROM documents WHERE provider_id = $1 GROUP BY status',
        [providerId]
      );
      const { rows: lastSubmissionRows } = await query(
        `SELECT qs.id, qs.status, qs.created_at, qc.title AS cycle_title
           FROM qualification_submissions qs
           JOIN qualification_cycles qc ON qc.id = qs.cycle_id
          WHERE qs.provider_id = $1
          ORDER BY qs.created_at DESC
          LIMIT 1`,
        [providerId]
      );

      const documentsTotal = docStatusRows.reduce((sum: number, r: any) => sum + r.count, 0);
      const documentsPending = docStatusRows.find((r: any) => r.status === 'pendente')?.count ?? 0;
      const documentsExpired = docStatusRows.find((r: any) => r.status === 'vencido')?.count ?? 0;

      res.json({
        ...provider,
        locations,
        certifications,
        summary: {
          documents_pending: documentsPending,
          documents_expired: documentsExpired,
          documents_total: documentsTotal,
          certifications_total: certifications.length,
          last_qualification_submission: lastSubmissionRows[0]
            ? {
                id: lastSubmissionRows[0].id,
                cycle_title: lastSubmissionRows[0].cycle_title,
                status: lastSubmissionRows[0].status,
                created_at: lastSubmissionRows[0].created_at,
              }
            : null,
        },
      });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

```

- [ ] **Step 2: Start the dev server**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && npm run dev` (or the project's existing dev script — check `package.json` `scripts.dev` if the name differs) and leave it running in the background.

- [ ] **Step 3: Manually verify via browser devtools**

Log in to the app as an `admin` user in the browser. Open devtools console and run:

```js
fetch('/api/providers/1', { credentials: 'include' }).then(r => r.json()).then(console.log)
```

Expected: a JSON object with `id`, `name`, `locations` (array), `certifications` (array), and a `summary` object with the five fields listed above. Pick a real provider id that exists in the dev database (check the `prestadores` tab in `/admin` for a valid id, or run `SELECT id FROM providers LIMIT 5;` against the dev DB).

- [ ] **Step 4: Verify 404**

In the same console: `fetch('/api/providers/999999999', { credentials: 'include' }).then(r => r.json()).then(console.log)` — expected `{ error: 'Prestador não encontrado' }`.

- [ ] **Step 5: Verify 403**

Log in as a `prestador` or `cooperado` user (or temporarily edit the JWT role for a manual check) and repeat Step 3 — expected `{ error: 'Unauthorized' }`.

- [ ] **Step 6: Commit**

```bash
git add server.ts
git commit -m "feat: add GET /api/providers/:id detail endpoint"
```

---

### Task 2: Route and navigation

**Files:**
- Modify: `src/App.tsx:25-58` (add import + route)
- Modify: `src/pages/Admin.tsx:1-2, 402-424` (add `useNavigate`, row `onClick`)
- Create: `src/pages/admin/ProviderDetail.tsx` (placeholder shell only in this task; full content in Task 4)

**Interfaces:**
- Consumes: nothing new yet.
- Produces: `<ProviderDetail />` default export at `src/pages/admin/ProviderDetail.tsx`, rendered at route `admin/prestadores/:id`. Later tasks fill in its body; this task only creates a minimal placeholder so routing can be verified end-to-end.

- [ ] **Step 1: Create the placeholder page**

`src/pages/admin/ProviderDetail.tsx`:

```tsx
import { useParams } from 'react-router-dom';

export default function ProviderDetail() {
  const { id } = useParams();
  return <div className="max-w-7xl mx-auto">Detalhe do prestador {id} (em construção)</div>;
}
```

- [ ] **Step 2: Register the route**

In `src/App.tsx`, add the import alongside the other page imports (after line 32, `import MeusDados from './pages/MeusDados';`):

```tsx
import ProviderDetail from './pages/admin/ProviderDetail';
```

Add the route inside the `<Route path="/" element={<Layout />}>` block, right after `<Route path="admin" element={<Admin />} />` (line 56):

```tsx
          <Route path="admin/prestadores/:id" element={<ProviderDetail />} />
```

- [ ] **Step 3: Make provider rows clickable in Admin.tsx**

Add `useNavigate` to the react-router import. `src/pages/Admin.tsx` currently has no react-router import — add one at the top of the imports (after line 2, `import { fetchApi } from '../lib/api';`):

```tsx
import { useNavigate } from 'react-router-dom';
```

Inside `export default function Admin() {` (line 69), add right after the `activeTab` state (line 70):

```tsx
  const navigate = useNavigate();
```

In the table body (`src/pages/Admin.tsx:403`), change the row to navigate on click:

```tsx
                    <tr
                      key={prestador.id}
                      onClick={() => navigate(`/admin/prestadores/${prestador.id}`)}
                      className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors cursor-pointer"
                    >
```

(This replaces the existing `<tr key={prestador.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">` at line 403.)

The trailing "Ações" `<MoreVertical>` button (`src/pages/Admin.tsx:419-421`) has no handler today and would now sit inside a clickable row; stop its click from bubbling into the row navigation by adding `onClick={(e) => e.stopPropagation()}` to that `<button>`:

```tsx
                        <button onClick={(e) => e.stopPropagation()} className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600">
```

- [ ] **Step 4: Manual verification**

With the dev server running (frontend + backend), log in as admin, go to `/admin`, stay on the "Rede de Prestadores" tab, click any table row. Expected: browser navigates to `/admin/prestadores/<id>` and shows "Detalhe do prestador <id> (em construção)". Click the `MoreVertical` button on a row — expected: no navigation happens (button click doesn't bubble).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/pages/Admin.tsx src/pages/admin/ProviderDetail.tsx
git commit -m "feat: route provider table rows to a new detail page"
```

---

### Task 3: Shared `ProviderContactsPanel` (extracted from `Equipe.tsx`)

**Files:**
- Create: `src/pages/admin/ProviderContactsPanel.tsx`
- Modify: `src/pages/Equipe.tsx` (replace inline contact list/table/modal with `<ProviderContactsPanel />`)

**Interfaces:**
- Consumes: `fetchApi` from `../lib/api` (same helper `Equipe.tsx` already uses).
- Produces: `ProviderContactsPanel` component:
  ```ts
  type ProviderContactsPanelProps = {
    providerId: number | string | null;
    /** When true, hides the "Prestador" column (caller already scopes to one provider). */
    hideProviderColumn?: boolean;
    /** When true, shows the "Novo Contato" button and delete buttons; false = read-only listing. */
    canEdit?: boolean;
  };
  export default function ProviderContactsPanel(props: ProviderContactsPanelProps): JSX.Element;
  ```
  This is the single component both `Equipe.tsx` and `ProviderDetail.tsx` (Task 5) render for the "Equipe/Contatos" concern — no other file should re-implement the contact list/add/remove UI.

- [ ] **Step 1: Create `ProviderContactsPanel.tsx`**

This is `Equipe.tsx`'s contact list + "Novo Contato" modal, parameterized by `providerId` (no self-resolution from the logged-in user — the caller always passes an explicit id) and `canEdit` (defaults to `true`):

```tsx
import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
import { Users, Plus, Trash2, X, Mail, Phone, IdCard, Stethoscope } from 'lucide-react';

type ProviderContactsPanelProps = {
  providerId: number | string | null;
  hideProviderColumn?: boolean;
  canEdit?: boolean;
};

export default function ProviderContactsPanel({ providerId, hideProviderColumn = true, canEdit = true }: ProviderContactsPanelProps) {
  const [contacts, setContacts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', position: '', council_registry: '', email: '', phone: '', cpf: '' });

  useEffect(() => {
    loadContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId]);

  const loadContacts = async () => {
    if (!providerId) {
      setContacts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchApi(`/provider-contacts?provider_id=${providerId}`);
      setContacts(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => setForm({ name: '', position: '', council_registry: '', email: '', phone: '', cpf: '' });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!providerId) return;
    setSaving(true);
    try {
      await fetchApi('/provider-contacts', {
        method: 'POST',
        body: JSON.stringify({ ...form, provider_id: providerId }),
      });
      setShowModal(false);
      resetForm();
      loadContacts();
    } catch (err: any) {
      alert(err.message || 'Erro ao cadastrar contato');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm('Remover este contato da equipe?')) return;
    try {
      await fetchApi(`/provider-contacts/${id}`, { method: 'DELETE' });
      loadContacts();
    } catch (err: any) {
      alert(err.message || 'Erro ao remover contato');
    }
  };

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowModal(true)}
            disabled={!providerId}
            className="flex items-center gap-2 bg-[#00995D] text-white px-4 py-2 rounded-lg hover:bg-[#007A4A] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-5 h-5" />
            <span>Novo Contato/Profissional</span>
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00995D]"></div>
          </div>
        ) : contacts.length === 0 ? (
          <div className="text-center py-12">
            <div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-bold text-gray-800 mb-1">Nenhum contato cadastrado</h3>
            <p className="text-gray-500">Adicione os profissionais e contatos da equipe usando o botão acima.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-100 text-sm text-gray-500">
                  <th className="pb-3 font-medium">Nome</th>
                  <th className="pb-3 font-medium">Cargo/Função</th>
                  <th className="pb-3 font-medium">Registro Conselho</th>
                  <th className="pb-3 font-medium">Contato</th>
                  <th className="pb-3 font-medium">CPF</th>
                  {!hideProviderColumn && <th className="pb-3 font-medium">Prestador</th>}
                  {canEdit && <th className="pb-3 font-medium text-right">Ações</th>}
                </tr>
              </thead>
              <tbody className="text-sm">
                {contacts.map((c) => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 font-medium text-gray-800">{c.name}</td>
                    <td className="py-3 text-gray-600">{c.position || '-'}</td>
                    <td className="py-3 text-gray-600">{c.council_registry || '-'}</td>
                    <td className="py-3 text-gray-600">
                      <div className="flex flex-col gap-0.5">
                        {c.email && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5 text-gray-400" />{c.email}</span>}
                        {c.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5 text-gray-400" />{c.phone}</span>}
                        {!c.email && !c.phone && '-'}
                      </div>
                    </td>
                    <td className="py-3 text-gray-600 font-mono text-xs">{c.cpf || '-'}</td>
                    {!hideProviderColumn && <td className="py-3 text-gray-600">{c.provider_name || '-'}</td>}
                    {canEdit && (
                      <td className="py-3 text-right">
                        <button
                          onClick={() => handleDelete(c.id)}
                          className="text-red-500 hover:text-red-700 p-1"
                          title="Remover contato"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-900">Novo Contato/Profissional</h3>
              <button onClick={() => { setShowModal(false); resetForm(); }} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nome <span className="text-red-500">*</span></label>
                <input
                  type="text" required value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cargo/Função</label>
                  <div className="relative">
                    <Stethoscope className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text" value={form.position}
                      onChange={(e) => setForm({ ...form, position: e.target.value })}
                      placeholder="Ex: Médico, Recepção"
                      className="w-full border border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2 pl-8"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Registro do Conselho</label>
                  <div className="relative">
                    <IdCard className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text" value={form.council_registry}
                      onChange={(e) => setForm({ ...form, council_registry: e.target.value })}
                      placeholder="Ex: CRM/SC 12345"
                      className="w-full border border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2 pl-8"
                    />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
                  <input
                    type="email" value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
                  <input
                    type="text" value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">CPF</label>
                <input
                  type="text" value={form.cpf}
                  onChange={(e) => setForm({ ...form, cpf: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2"
                />
              </div>
              <div className="pt-4 flex justify-end gap-3">
                <button
                  type="button" onClick={() => { setShowModal(false); resetForm(); }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit" disabled={saving}
                  className="px-4 py-2 bg-[#00995D] text-white rounded-lg hover:bg-[#007A4A] transition-colors disabled:opacity-50"
                >
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `Equipe.tsx` to use the panel, keeping the cross-provider view**

`Equipe.tsx` has two distinct views for admin/auditoria today, and both must survive:
- a provider selected → single-provider contact list with add/remove (this is what moves to `ProviderContactsPanel`)
- no provider selected ("Todos os prestadores") → a **read-only-except-delete** table of every contact across every provider, with a "Prestador" column, fetched via `GET /api/provider-contacts` with no `provider_id` (`server.ts:1018-1021`). The original code allowed deleting a contact directly from this cross view (the "Ações" column with the trash icon was always rendered, regardless of `selectedProviderId`) — keep that.

`ProviderContactsPanel` only models a single `providerId`, so the cross-provider table stays as its own small block inside `Equipe.tsx` rather than being folded into the shared component. Replace the full contents of `src/pages/Equipe.tsx` with:

```tsx
import React, { useEffect, useState } from 'react';
import { fetchApi } from '../lib/api';
import ProviderContactsPanel from './admin/ProviderContactsPanel';
import { Users, Mail, Phone, Trash2 } from 'lucide-react';

// WS5 — Cadastro de equipe do prestador (§5.2.3 Tela 3).
// Contatos informativos (sem login). Prestador/cooperado gerenciam a própria equipe;
// admin/auditoria escolhem um prestador para visualizar/cadastrar, ou veem a equipe
// de toda a rede junta quando nenhum prestador está selecionado.
export default function Equipe() {
  const [user, setUser] = useState<any>(null);
  const [providers, setProviders] = useState<any[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [ownProviderId, setOwnProviderId] = useState<number | null>(null);
  const [allContacts, setAllContacts] = useState<any[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);

  const isAdmin = user?.role === 'admin' || user?.role === 'auditoria';
  const showCrossView = isAdmin && !selectedProviderId;

  useEffect(() => {
    const stored = localStorage.getItem('user');
    if (stored) setUser(JSON.parse(stored));
  }, []);

  useEffect(() => {
    if (!user) return;
    if (isAdmin) {
      if (providers.length === 0) fetchApi('/providers').then(setProviders).catch(console.error);
    } else {
      setOwnProviderId(user.provider_id ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadAllContacts = () => {
    setLoadingAll(true);
    fetchApi('/provider-contacts')
      .then(setAllContacts)
      .catch(console.error)
      .finally(() => setLoadingAll(false));
  };

  useEffect(() => {
    if (showCrossView) loadAllContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCrossView]);

  const handleDeleteFromCrossView = async (id: number) => {
    if (!window.confirm('Remover este contato da equipe?')) return;
    try {
      await fetchApi(`/provider-contacts/${id}`, { method: 'DELETE' });
      loadAllContacts();
    } catch (err: any) {
      alert(err.message || 'Erro ao remover contato');
    }
  };

  const activeProviderId = isAdmin ? (selectedProviderId || null) : ownProviderId;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Equipe / Profissionais</h1>
        <p className="text-gray-500">Cadastro informativo da equipe do prestador (sem acesso ao portal).</p>
      </div>

      {isAdmin && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Prestador</label>
          <select
            value={selectedProviderId}
            onChange={(e) => setSelectedProviderId(e.target.value)}
            className="w-full md:w-96 border border-gray-300 rounded-lg shadow-sm focus:ring-[#00995D] focus:border-[#00995D] p-2"
          >
            <option value="">Todos os prestadores (somente visualização)</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name} {p.cnpj ? `(${p.cnpj})` : ''}</option>
            ))}
          </select>
          {!selectedProviderId && (
            <p className="text-xs text-gray-500 mt-2">Selecione um prestador para cadastrar novos contatos.</p>
          )}
        </div>
      )}

      {showCrossView ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          {loadingAll ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00995D]"></div>
            </div>
          ) : allContacts.length === 0 ? (
            <div className="text-center py-12">
              <div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-bold text-gray-800 mb-1">Nenhum contato cadastrado</h3>
              <p className="text-gray-500">Selecione um prestador acima para cadastrar contatos.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-gray-100 text-sm text-gray-500">
                    <th className="pb-3 font-medium">Nome</th>
                    <th className="pb-3 font-medium">Cargo/Função</th>
                    <th className="pb-3 font-medium">Registro Conselho</th>
                    <th className="pb-3 font-medium">Contato</th>
                    <th className="pb-3 font-medium">CPF</th>
                    <th className="pb-3 font-medium">Prestador</th>
                    <th className="pb-3 font-medium text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {allContacts.map((c) => (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="py-3 font-medium text-gray-800">{c.name}</td>
                      <td className="py-3 text-gray-600">{c.position || '-'}</td>
                      <td className="py-3 text-gray-600">{c.council_registry || '-'}</td>
                      <td className="py-3 text-gray-600">
                        <div className="flex flex-col gap-0.5">
                          {c.email && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5 text-gray-400" />{c.email}</span>}
                          {c.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5 text-gray-400" />{c.phone}</span>}
                          {!c.email && !c.phone && '-'}
                        </div>
                      </td>
                      <td className="py-3 text-gray-600 font-mono text-xs">{c.cpf || '-'}</td>
                      <td className="py-3 text-gray-600">{c.provider_name || '-'}</td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => handleDeleteFromCrossView(c.id)}
                          className="text-red-500 hover:text-red-700 p-1"
                          title="Remover contato"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <ProviderContactsPanel providerId={activeProviderId} hideProviderColumn canEdit />
      )}
    </div>
  );
}
```

This is a straight port of the original cross-view table markup/behavior (including the always-visible delete button), just split out from the single-provider case, which now goes through `ProviderContactsPanel`.

- [ ] **Step 3: Manual verification**

Log in as a `prestador`/`cooperado` user, go to `/equipe` — expected: same behavior as before (own contacts list, can add/remove). Log in as `admin`, go to `/equipe` with no provider selected ("Todos os prestadores...") — expected: a single table listing contacts from every provider, with a "Prestador" column, and each row deletable. Delete one — expected: it disappears and the list still shows the rest. Now pick a specific provider from the dropdown — expected: view switches to that provider's contacts only (no "Prestador" column), "Novo Contato" button enabled, add/remove works.

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/ProviderContactsPanel.tsx src/pages/Equipe.tsx
git commit -m "refactor: extract ProviderContactsPanel from Equipe.tsx for reuse"
```

---

### Task 4: `ProviderDetail` — Dados Cadastrais + Unidades tabs (data fetch, sidebar, first two tabs)

**Files:**
- Modify: `src/pages/admin/ProviderDetail.tsx` (replace the Task 2 placeholder with the full page shell + first two tabs)

**Interfaces:**
- Consumes: `GET /api/providers/:id` (Task 1 response shape), `fetchApi` from `../../lib/api`, `useParams`/`useNavigate` from `react-router-dom`.
- Produces: internal `TABS` array and `activeTab` state that Task 5 extends with two more tab bodies (`equipe`, `documentos`). The `provider` state object (raw API response) is what Task 5's tabs read from — do not rename its fields.

- [ ] **Step 1: Replace `ProviderDetail.tsx` with the full shell**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchApi } from '../../lib/api';
import { ArrowLeft, Building2, Users, FileText, ClipboardCheck } from 'lucide-react';

const TABS = [
  { id: 'cadastrais', label: 'Dados Cadastrais', icon: Building2 },
  { id: 'unidades', label: 'Unidades de Atendimento', icon: Building2 },
  { id: 'equipe', label: 'Equipe/Contatos', icon: Users },
  { id: 'documentos', label: 'Documentos e Qualificação', icon: FileText },
] as const;

type TabId = typeof TABS[number]['id'];

function fieldGrid(pairs: Array<[string, string | null | undefined]>) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
      {pairs.map(([label, value]) => (
        <div key={label}>
          <p className="text-xs font-medium text-gray-500 uppercase">{label}</p>
          <p className="text-sm text-gray-800 mt-0.5">{value || '-'}</p>
        </div>
      ))}
    </div>
  );
}

export default function ProviderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('cadastrais');
  const [provider, setProvider] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchApi(`/providers/${id}`)
      .then(setProvider)
      .catch((err) => setError(err.message || 'Erro ao carregar prestador'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto flex justify-center py-24">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#00995D]"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto text-center py-24 space-y-4">
        <p className="text-gray-700">{error}</p>
        {error === 'Prestador não encontrado' ? (
          <button onClick={() => navigate('/admin')} className="text-[#00995D] hover:underline">
            Voltar para a listagem
          </button>
        ) : (
          <button
            onClick={load}
            className="px-4 py-2 bg-[#00995D] text-white rounded-lg hover:bg-[#007A4A] transition-colors"
          >
            Tentar novamente
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/admin')} className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-500">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{provider.name}</h1>
          <span className={`inline-block mt-1 px-2.5 py-1 rounded-full text-xs font-medium ${
            provider.status === 'Ativo' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {provider.status || '-'}
          </span>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <aside className="md:w-64 shrink-0">
          <nav className="bg-white rounded-xl shadow-sm border border-gray-100 p-2 flex md:flex-col gap-1 overflow-x-auto">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left whitespace-nowrap transition-colors ${
                    active ? 'bg-[#00995D] text-white' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          {activeTab === 'cadastrais' && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-gray-800">Dados Cadastrais</h2>
              {fieldGrid([
                ['Nome / Razão Social', provider.name],
                ['Nome Fantasia', provider.trade_name],
                ['Tipo de Pessoa', provider.person_type],
                [provider.person_type === 'PF' ? 'CPF' : 'CNPJ', provider.person_type === 'PF' ? provider.cpf : provider.cnpj],
                ['Registro no Conselho', provider.council_registry],
                ['Tipo de Prestador (SGU)', provider.provider_type],
                ['Área de Atuação', provider.area_atuacao],
                ['Grupo', provider.provider_group],
                ['Nível de Qualificação', provider.qualification_level],
                ['Código SGU', provider.sgu_code],
                ['Última Sincronização SGU', provider.sgu_synced_at ? new Date(provider.sgu_synced_at).toLocaleString('pt-BR') : null],
                ['Especialidades', Array.isArray(provider.specialties) && provider.specialties.length > 0 ? provider.specialties.join(', ') : null],
              ])}
            </div>
          )}

          {activeTab === 'unidades' && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-gray-800">Unidades de Atendimento</h2>
              {provider.locations.length === 0 ? (
                <p className="text-gray-500 text-center py-12">Nenhuma unidade cadastrada.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-gray-100 text-sm text-gray-500">
                        <th className="pb-3 font-medium">Local</th>
                        <th className="pb-3 font-medium">Endereço</th>
                        <th className="pb-3 font-medium">Contato</th>
                        <th className="pb-3 font-medium">Selos</th>
                        <th className="pb-3 font-medium">Ativo</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm">
                      {provider.locations.map((loc: any) => (
                        <tr key={loc.id} className="border-b border-gray-50">
                          <td className="py-3 font-medium text-gray-800">{loc.label || '-'}</td>
                          <td className="py-3 text-gray-600">
                            {[loc.logradouro, loc.numero, loc.complemento, loc.bairro, loc.cidade, loc.uf].filter(Boolean).join(', ') || '-'}
                          </td>
                          <td className="py-3 text-gray-600">
                            <div className="flex flex-col gap-0.5">
                              {loc.phone && <span>{loc.phone}</span>}
                              {loc.email && <span>{loc.email}</span>}
                              {!loc.phone && !loc.email && '-'}
                            </div>
                          </td>
                          <td className="py-3">
                            <div className="flex flex-wrap gap-1">
                              {loc.is_primary && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Principal</span>}
                              {loc.in_medical_guide && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">Guia Médico</span>}
                            </div>
                          </td>
                          <td className="py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${loc.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                              {loc.active ? 'Ativo' : 'Inativo'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

(The `equipe` and `documentos` tab bodies are added in Task 5 — leaving them out here still compiles fine since `activeTab` can hold those string values without a matching render branch, which simply shows a blank content panel until Task 5 lands.)

- [ ] **Step 2: Manual verification**

Restart/reload the dev server if needed. Log in as admin, navigate to `/admin/prestadores/<a-real-id>`. Expected: header shows the provider's name and status badge; "Dados Cadastrais" tab (default) shows the field grid with real values (dashes for anything null); clicking "Unidades de Atendimento" shows either the empty state or a table of locations with correct badges. Clicking "Voltar" (back arrow) returns to `/admin`. Navigate to `/admin/prestadores/999999999` — expected: "Prestador não encontrado" message with a working "Voltar para a listagem" link.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/ProviderDetail.tsx
git commit -m "feat: provider detail page with Dados Cadastrais and Unidades tabs"
```

---

### Task 5: `ProviderDetail` — Equipe/Contatos + Documentos e Qualificação tabs

**Files:**
- Modify: `src/pages/admin/ProviderDetail.tsx` (add two more tab bodies + one more import)

**Interfaces:**
- Consumes: `ProviderContactsPanel` from `./ProviderContactsPanel` (Task 3), `provider.summary` (Task 1 response shape).
- Produces: nothing further downstream — this is the last tab of this page.

- [ ] **Step 1: Add the import**

At the top of `src/pages/admin/ProviderDetail.tsx`, add after the `fetchApi` import:

```tsx
import ProviderContactsPanel from './ProviderContactsPanel';
```

Also add `ClipboardCheck` to the existing `lucide-react` import line (it's already imported unused from Task 4 — if not, add it): the import line should read:

```tsx
import { ArrowLeft, Building2, Users, FileText, ClipboardCheck } from 'lucide-react';
```

- [ ] **Step 2: Add the two tab bodies**

Insert these two blocks right after the `unidades` tab body's closing `)}` (immediately before the final `</div>` that closes `<div className="flex-1 bg-white ...">` in the Task 4 code):

```tsx
          {activeTab === 'equipe' && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-gray-800">Equipe/Contatos</h2>
              <ProviderContactsPanel providerId={provider.id} hideProviderColumn canEdit />
            </div>
          )}

          {activeTab === 'documentos' && (
            <div className="space-y-6">
              <h2 className="text-lg font-bold text-gray-800">Documentos e Qualificação</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <p className="text-sm text-gray-500 font-medium">Documentos Pendentes</p>
                  <p className="text-2xl font-bold text-gray-800">{provider.summary.documents_pending}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <p className="text-sm text-gray-500 font-medium">Documentos Vencidos</p>
                  <p className="text-2xl font-bold text-gray-800">{provider.summary.documents_expired}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <p className="text-sm text-gray-500 font-medium">Total de Documentos</p>
                  <p className="text-2xl font-bold text-gray-800">{provider.summary.documents_total}</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                  <p className="text-sm text-gray-500 font-medium">Certificações</p>
                  <p className="text-2xl font-bold text-gray-800">{provider.summary.certifications_total}</p>
                </div>
              </div>

              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <p className="text-sm font-medium text-gray-700 mb-1">Última Submissão de Qualificação</p>
                {provider.summary.last_qualification_submission ? (
                  <div className="flex items-center gap-2 text-sm text-gray-800">
                    <ClipboardCheck className="w-4 h-4 text-gray-400" />
                    <span>{provider.summary.last_qualification_submission.cycle_title}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                      {provider.summary.last_qualification_submission.status}
                    </span>
                    <span className="text-gray-500">
                      {new Date(provider.summary.last_qualification_submission.created_at).toLocaleDateString('pt-BR')}
                    </span>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">Nenhuma submissão de qualificação registrada.</p>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                <a
                  href={`/documentos?provider_id=${provider.id}`}
                  className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
                >
                  Ver documentos completos
                </a>
                <a
                  href={`/auditorias?provider_id=${provider.id}`}
                  className="px-4 py-2 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
                >
                  Ver qualificação completa
                </a>
              </div>
            </div>
          )}
```

- [ ] **Step 3: Manual verification**

Reload `/admin/prestadores/<id>`, click "Equipe/Contatos" — expected: same contact list/add/remove behavior as `/equipe` when a provider is selected there (uses the shared `ProviderContactsPanel`), scoped to this provider, with no "Prestador" column. Add a test contact, confirm it appears; delete it, confirm it disappears. Click "Documentos e Qualificação" — expected: four summary cards with real counts matching what you'd get by cross-checking `/documentos` and `/auditorias` for that provider manually, plus a "Última Submissão" line (or the empty-state sentence) and two links. Click "Ver documentos completos" — expected: navigates to `/documentos` (pre-filtering by `provider_id` is out of scope per the spec; the page will simply load without pre-filtering).

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/ProviderDetail.tsx
git commit -m "feat: add Equipe/Contatos and Documentos e Qualificação tabs to provider detail"
```

---

## Self-Review Notes

- **Spec coverage:** Rota própria ✅ (Task 2), 4 abas ✅ (Tasks 4-5), somente-leitura em Dados Cadastrais/Unidades ✅ (Task 4, no form/save controls), Equipe/Contatos editável reaproveitando `Equipe.tsx` ✅ (Task 3-5), resumo+links para Documentos/Qualificação ✅ (Task 5), backend endpoint com o shape documentado ✅ (Task 1), 403/404/empty/network-error handling ✅ (Task 4).
- **Placeholder scan:** none — every step has literal code, exact file paths/line anchors, and concrete manual-verification instructions (no automated test infra exists for HTTP routes in this repo, consistent with the spec's "Testes" section).
- **Type consistency:** `provider.id`/`provider.locations`/`provider.certifications`/`provider.summary.*` field names are identical between Task 1's response shape and Tasks 4-5's usage. `ProviderContactsPanel`'s prop names (`providerId`, `hideProviderColumn`, `canEdit`) are identical across Task 3 (Equipe.tsx usage) and Task 5 (ProviderDetail.tsx usage).
- **Cross-provider view preserved:** confirmed with the user that `Equipe.tsx`'s "Todos os prestadores" read-only, cross-provider contact table (with delete) must survive the refactor. Task 3 keeps that view as its own block inside `Equipe.tsx` (not folded into `ProviderContactsPanel`, which only models a single `providerId`), so no behavior is lost.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-07-detalhamento-prestador.md`. Two execution options:

1. **Subagent-Driven (recommended)** - dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
