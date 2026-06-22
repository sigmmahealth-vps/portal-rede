# Versionamento de roteiros por revisão — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar a versão de um roteiro = a revisão da planilha (import exclusivamente por Excel), com revisão + data de revisão + data de implantação obrigatórias e únicas por roteiro, vigência automática (maior revisão), revisões empilhadas, e remoção do status manual e da criação manual.

**Architecture:** O parser passa a extrair também a data de implantação e a devolver `version=null` quando não há revisão. Uma migration aditiva acrescenta `implantacao_date`, dropa `revisao` e `status` (redundantes), torna as datas `NOT NULL` e adiciona unicidade `(source_file, version)` e `(source_file, revisao_date)`. O import valida obrigatórios (422) e conflito (409, rollback) e grava `version=revisão`. O frontend troca os dois selos + dropdown de status por um selo único de revisão/vigência, agrupa revisões por roteiro e mostra implantação; as telas do prestador passam a listar só a vigente.

**Tech Stack:** Node 20 + Express + tsx, `xlsx` (SheetJS), Postgres (`pg`), React 19 + Tailwind, `node:test`.

---

## Contexto de execução (ler antes de começar)

- **Diretório:** todos os comandos rodam de `portal-rede-v1-main/`.
- **Git:** é repositório (branch `main`). Commit por task é OK. **NÃO** dar `git push` — push dispara deploy de produção (Railway); decisão explícita do usuário (Task 8).
- **Banco = produção:** o `.env` aponta para o Postgres de produção. O **reset** e a **migration** (Task 8) gravam em produção e são **passos autorizados pelo usuário**, fora do fluxo de dev.
- **Datas via pg:** já existe `types.setTypeParser(1082, v => v)` em `db/db.ts` → colunas `date` voltam como string `'YYYY-MM-DD'`. Use isso nas comparações.
- **Gate por task:** `npm run lint` (`tsc --noEmit`); no parser, `npm test`; no frontend, `npm run build`.
- **`eval_instances.status` é OUTRO campo** (ciclo da avaliação: pendente/finalizado/…) — **não tocar**. Só removemos `eval_scripts.status`.

## File Structure

| Arquivo | Responsabilidade | Ação |
|---------|------------------|------|
| `db/roteiro-parser.ts` | Extrair `implantacaoDate`; `version=null` sem revisão. | Modificar |
| `db/roteiro-parser.test.ts` | Cobrir implantação e revisão ausente/`"00"`. | Modificar |
| `db/migrations/00NN_versionamento_revisao.sql` | `implantacao_date`; dropar `revisao`/`status`; datas NOT NULL; unicidade. | Criar |
| `server.ts` | Import: validar obrigatórios+conflito, gravar `version=revisão`; preview idem; remover POST manual e PUT status. | Modificar |
| `src/pages/Admin.tsx` | Selo único; coluna Implantação; agrupar revisões; remover manual + StatusControl. | Modificar |
| `src/pages/qualificacao/ImportRoteiroModal.tsx` | Exibir erros 422/409 de forma legível. | Modificar |
| `src/pages/qualificacao/PrestadorView.tsx`, `CooperadoView.tsx` | Listar só a revisão vigente. | Modificar |

> Migration nomeada `00NN` = próximo número sequencial livre (Task 2 Step 1 confirma com `ls db/migrations`).

---

## Task 1: Parser — extrai implantação e exige revisão (TDD)

**Files:**
- Modify: `db/roteiro-parser.ts`
- Modify: `db/roteiro-parser.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Em `db/roteiro-parser.test.ts`, acrescente ao final:

```typescript
test('parseWorkbook extrai a data de implantação quando presente', () => {
  const aoa = [
    ['ROTEIRO PARA AVALIAÇÃO DE QUALIFICAÇÃO', 'OPS-REDS Implantação: 01/04/2023 Revisão: 02 em 28/01/2026 Classificação: Interna'],
    ['GRUPO DE TESTE'],
    ['ITEM', 'EVIDÊNCIA', 'PESO MÁXIMO', 'PESO À CONSIDERAR'],
    ['SEÇÃO 1. Estrutura'],
    ['1.1.1 Possui alvará?', 'Alvará', '10', '10'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Roteiro');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const parsed = parseWorkbook(buf, 'OPS-RED-FOR-001 - Teste.xlsx');
  assert.equal(parsed.version, '02');
  assert.equal(parsed.revisaoDate, '2026-01-28');
  assert.equal(parsed.implantacaoDate, '2023-04-01');
});

test('parseWorkbook devolve version null quando não há revisão na planilha', () => {
  const aoa = [
    ['ROTEIRO PARA AVALIAÇÃO DE QUALIFICAÇÃO', 'OPS-REDS Classificação: Interna'],
    ['GRUPO DE TESTE'],
    ['ITEM', 'EVIDÊNCIA', 'PESO MÁXIMO', 'PESO À CONSIDERAR'],
    ['SEÇÃO 1. Estrutura'],
    ['1.1.1 Possui alvará?', 'Alvará', '10', '10'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Roteiro');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const parsed = parseWorkbook(buf, 'OPS-RED-FOR-999 - Teste.xlsx');
  assert.equal(parsed.version, null);
  assert.equal(parsed.implantacaoDate, null);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test`
Expected: FALHA — `implantacaoDate` é `undefined` e `version` é `'00'` (fallback antigo) em vez de `null`.

- [ ] **Step 3: Atualizar o tipo `ParsedScript`**

Em `db/roteiro-parser.ts`, na interface `ParsedScript`, altere `version: string;` para o conjunto abaixo (se `revisaoDate` já existir, só acrescente `implantacaoDate` e mude `version`):

```typescript
  version: string | null;
  revisaoDate: string | null;
  implantacaoDate: string | null;
```

- [ ] **Step 4: Extrair revisão (sem fallback) + implantação**

Em `db/roteiro-parser.ts`, localize:

```typescript
  const revMatch = metaCell.match(/Revis[ãa]o:\s*(\d+)(?:\s+em\s+(\d{2})\/(\d{2})\/(\d{4}))?/i);
  const revisao = revMatch?.[1] ?? '00';
  // data "DD/MM/YYYY" → ISO "YYYY-MM-DD" (apenas quando presente)
  const revisaoDate = revMatch && revMatch[2] ? `${revMatch[4]}-${revMatch[3]}-${revMatch[2]}` : null;
```

Substitua por:

```typescript
  const revMatch = metaCell.match(/Revis[ãa]o:\s*(\d+)(?:\s+em\s+(\d{2})\/(\d{2})\/(\d{4}))?/i);
  const revisao = revMatch?.[1] ?? null; // revisão é obrigatória; ausência = null (validado no import)
  // data "DD/MM/YYYY" → ISO "YYYY-MM-DD" (apenas quando presente)
  const revisaoDate = revMatch && revMatch[2] ? `${revMatch[4]}-${revMatch[3]}-${revMatch[2]}` : null;
  const implMatch = metaCell.match(/Implanta[çc][ãa]o:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  const implantacaoDate = implMatch ? `${implMatch[3]}-${implMatch[2]}-${implMatch[1]}` : null;
```

- [ ] **Step 5: Incluir `implantacaoDate` nos dois `return`**

Em `db/roteiro-parser.ts` há dois `return` que montam `ParsedScript` (o early-return de cabeçalho ausente e o final). Em ambos, ao lado de `version: revisao,` e `revisaoDate,`, acrescente `implantacaoDate,`. Garanta que `revisao`/`revisaoDate`/`implantacaoDate` estejam declarados antes do early-return.

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `npm test`
Expected: PASS — todos verdes (o `buildBuffer()` existente tem `Revisão: 03` e nenhuma implantação, então `version='03'`, `implantacaoDate=null`; os testes antigos continuam válidos).

- [ ] **Step 7: Gate de tipos**

Run: `npm run lint`
Expected: sem erros. (Se `tsc` apontar uso de `parsed.version` esperando `string`, é em `server.ts`/`db/import-roteiros.ts` — tratado nas Tasks 3/4; o CLI `import-roteiros.ts` é legado e aceita `null` no INSERT.)

- [ ] **Step 8: Commit**

```bash
git add db/roteiro-parser.ts db/roteiro-parser.test.ts
git commit -m "feat: parser extrai data de implantação e exige revisão (version null sem revisão)"
```

---

## Task 2: Migration — implantação, drop redundâncias, NOT NULL, unicidade

**Files:**
- Create: `db/migrations/00NN_versionamento_revisao.sql`

- [ ] **Step 1: Descobrir o próximo número**

Run: `ls db/migrations`
Use o próximo número sequencial livre. Substitua `00NN` abaixo por ele.

- [ ] **Step 2: Criar o arquivo**

Create `db/migrations/00NN_versionamento_revisao.sql`:

```sql
-- =============================================================================
-- 00NN_versionamento_revisao.sql
-- A versão do roteiro passa a ser a revisão da planilha.
-- Pré-requisito operacional: a tabela já foi ESVAZIADA (DELETE FROM eval_scripts)
-- antes desta migration — as constraints abaixo assumem base limpa.
--   + implantacao_date (data de implantação, vem da planilha)
--   - revisao  (redundante: a coluna version passa a guardar a revisão)
--   - status   (redundante com a vigência automática vigente/substituída)
--   revisao_date e implantacao_date passam a ser obrigatórias (NOT NULL)
--   unicidade por roteiro: (source_file, version) e (source_file, revisao_date)
-- =============================================================================

ALTER TABLE eval_scripts ADD COLUMN IF NOT EXISTS implantacao_date date;
ALTER TABLE eval_scripts DROP COLUMN IF EXISTS revisao;
ALTER TABLE eval_scripts DROP COLUMN IF EXISTS status;
ALTER TABLE eval_scripts ALTER COLUMN revisao_date SET NOT NULL;
ALTER TABLE eval_scripts ALTER COLUMN implantacao_date SET NOT NULL;

ALTER TABLE eval_scripts DROP CONSTRAINT IF EXISTS eval_scripts_source_version_uq;
ALTER TABLE eval_scripts ADD CONSTRAINT eval_scripts_source_version_uq UNIQUE (source_file, version);
ALTER TABLE eval_scripts DROP CONSTRAINT IF EXISTS eval_scripts_source_revdate_uq;
ALTER TABLE eval_scripts ADD CONSTRAINT eval_scripts_source_revdate_uq UNIQUE (source_file, revisao_date);
```

- [ ] **Step 3: Gate** (não aplicar aqui — só criar; aplicação é Task 8)

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/00NN_versionamento_revisao.sql
git commit -m "feat: migration versionamento por revisão (implantacao_date, drops, unicidade)"
```

---

## Task 3: Backend — import e preview com validação e conflito

**Files:**
- Modify: `server.ts` (`POST /api/eval/scripts/import` e `POST /api/eval/scripts/preview`)

- [ ] **Step 1: Helper de data BR (perto de `scriptVersionNum`, ≈ linha 63)**

```typescript
// ISO "YYYY-MM-DD" → "DD/MM/AAAA" para mensagens ao usuário.
const isoToBR = (iso: unknown): string => {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(iso ?? '');
};
```

- [ ] **Step 2: Reescrever o corpo do `POST /api/eval/scripts/import`**

Substitua do `const parsed = parseWorkbook(...)` até o fim do `withTransaction`/`res.json(...)` por:

```typescript
      const parsed = parseWorkbook(req.file.buffer, req.file.originalname);
      const noHeader = parsed.orphans.some((o) => o.startsWith('!!'));
      if (parsed.questions.length === 0 || noHeader) {
        return res.status(422).json({ error: 'Planilha sem critérios reconhecíveis ou cabeçalho inválido.' });
      }
      if (!parsed.version) return res.status(422).json({ error: 'A planilha não informa o número da revisão.' });
      if (!parsed.revisaoDate) return res.status(422).json({ error: 'A planilha não informa a data da revisão.' });
      if (!parsed.implantacaoDate) return res.status(422).json({ error: 'A planilha não informa a data de implantação.' });

      const { rows: dupRows } = await query(
        'SELECT version, revisao_date FROM eval_scripts WHERE source_file = $1',
        [parsed.sourceFile],
      );
      if ((dupRows as any[]).some((r) => String(r.version) === parsed.version)) {
        return res.status(409).json({ error: `Já existe uma versão com a revisão ${parsed.version} para este roteiro.` });
      }
      if ((dupRows as any[]).some((r) => String(r.revisao_date).slice(0, 10) === parsed.revisaoDate)) {
        return res.status(409).json({ error: `Já existe uma versão com a data de revisão ${isoToBR(parsed.revisaoDate)} para este roteiro.` });
      }

      try {
        const result = await withTransaction(async (client) => {
          const { rows: sr } = await client.query(
            `INSERT INTO eval_scripts (title, description, version, source_file, revisao_date, implantacao_date, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING id`,
            [parsed.title, parsed.description, parsed.version, parsed.sourceFile, parsed.revisaoDate, parsed.implantacaoDate],
          );
          const scriptId = sr[0].id as number;

          const idByTmp = new Map<number, number>();
          for (const s of parsed.sections) {
            const parentId = s.parentTmp != null ? idByTmp.get(s.parentTmp) ?? null : null;
            const { rows: secRows } = await client.query(
              `INSERT INTO eval_sections (script_id, parent_section_id, name, order_index)
               VALUES ($1, $2, $3, $4) RETURNING id`,
              [scriptId, parentId, s.name, s.order],
            );
            idByTmp.set(s.tmp, secRows[0].id);
          }
          for (const q of parsed.questions) {
            const sectionId = q.sectionTmp != null ? idByTmp.get(q.sectionTmp) ?? null : null;
            if (sectionId == null) continue;
            await client.query(
              `INSERT INTO eval_questions
                 (section_id, code, text, legislation, type, weight, max_score, dimension,
                  guidance, evidence_required, is_eliminatory, order_index)
               VALUES ($1,$2,$3,$4,'sim_nao',$5,$6,$7,$8,$9,$10,$11)`,
              [sectionId, q.code, q.text, q.legislation, q.weight, q.maxScore,
               q.dimension, q.guidance, q.evidenceRequired, q.isEliminatory, q.order],
            );
          }
          return { id: scriptId, version: parsed.version };
        });

        res.json({
          success: true,
          id: result.id,
          version: result.version,
          title: parsed.title,
          sourceFile: parsed.sourceFile,
          questionCount: parsed.questions.length,
        });
      } catch (err: any) {
        if (err?.code === '23505') {
          return res.status(409).json({ error: 'Já existe uma versão com esta revisão ou data de revisão para este roteiro.' });
        }
        console.error(err);
        res.status(500).json({ error: err.message || 'Falha ao importar o roteiro.' });
      }
```

(Remove `existing`/`maxv`/`nextVersion` e o INSERT antigo. `scriptVersionNum` segue só no GET, para vigência.)

- [ ] **Step 3: Atualizar o `POST /api/eval/scripts/preview`**

Substitua o bloco que monta `existing` (linhas `existingRows`/`maxv`/`nextVersion`) e o `res.json({...})` por:

```typescript
      const noHeader = parsed.orphans.some((o) => o.startsWith('!!'));
      const blocked = parsed.questions.length === 0 || noHeader;

      const errors: string[] = [];
      if (!parsed.version) errors.push('A planilha não informa o número da revisão.');
      if (!parsed.revisaoDate) errors.push('A planilha não informa a data da revisão.');
      if (!parsed.implantacaoDate) errors.push('A planilha não informa a data de implantação.');
      if (parsed.version || parsed.revisaoDate) {
        const { rows: dupRows } = await query(
          'SELECT version, revisao_date FROM eval_scripts WHERE source_file = $1',
          [parsed.sourceFile],
        );
        if (parsed.version && (dupRows as any[]).some((r) => String(r.version) === parsed.version)) {
          errors.push(`Já existe uma versão com a revisão ${parsed.version} para este roteiro.`);
        }
        if (parsed.revisaoDate && (dupRows as any[]).some((r) => String(r.revisao_date).slice(0, 10) === parsed.revisaoDate)) {
          errors.push(`Já existe uma versão com a data de revisão ${isoToBR(parsed.revisaoDate)} para este roteiro.`);
        }
      }

      res.json({
        title: parsed.title,
        version: parsed.version,
        revisaoDate: parsed.revisaoDate,
        implantacaoDate: parsed.implantacaoDate,
        sourceFile: parsed.sourceFile,
        sectionCount: parsed.sections.length,
        questionCount: parsed.questions.length,
        totalMaxScore,
        dimensions,
        warnings: {
          orphans: parsed.orphans,
          noWeight: parsed.questions.filter((q) => !q.maxScore).length,
          noEvidence: parsed.questions.filter((q) => !q.guidance && !isEvidenceExempt(q.text)).length,
          noHeader,
        },
        errors,
        blocked: blocked || errors.length > 0,
      });
```

- [ ] **Step 4: Gate de tipos**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add server.ts
git commit -m "feat: import/preview validam revisão+datas obrigatórias e conflito por roteiro"
```

---

## Task 4: Backend — remover criação manual e status manual

**Files:**
- Modify: `server.ts`

- [ ] **Step 1:** Remover por completo o handler `app.post('/api/eval/scripts', authenticate, ...)` (criação manual com `version='1.0'`). Não confundir com `/import` nem `/preview`.

- [ ] **Step 2:** Remover por completo o handler `app.put('/api/eval/scripts/:id/status', ...)`. (`/api/eval/instances/:id/status` é outro endpoint e permanece.)

- [ ] **Step 3:** No `GET /api/eval/scripts`, confirmar que nada referencia `script.status` (usa `SELECT *`; com a coluna dropada o campo só some do payload). Sem mudança além disso.

- [ ] **Step 4: Gate**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add server.ts
git commit -m "feat: remove criação manual e status manual de roteiros"
```

---

## Task 5: Frontend — remover UI de criação manual e de status

**Files:**
- Modify: `src/pages/Admin.tsx`

- [ ] **Step 1:** Remover o estado `scriptForm`/`setScriptForm` (≈ linha 101), o handler `handleCreateScript` (≈ 199-210) e o handler `handleUpdateScriptStatus` (≈ 243-...).

- [ ] **Step 2:** Remover a função `StatusControl` (≈ linha 1442) e `STATUS_STYLES` se só ela usa; remover os usos `<StatusControl .../>` (≈ linhas 569 e 621); remover a coluna `Status` (cabeçalho + `<td>`) da lista.

- [ ] **Step 3:** No chooser do botão "Novo Roteiro" (≈ 360-385), remover "Montar manualmente"; deixar só a ação que abre `ImportRoteiroModal` (se sobrar uma opção só, ligar o botão direto a `setShowImportModal(true)`). Remover o modal/form de criação manual (`<form onSubmit={handleCreateScript}>`, ≈ 1216-1300). Ajustar o texto de estado vazio (≈ linha 548) para: `Clique em "Novo Roteiro" para subir uma planilha (.xlsx).`

- [ ] **Step 4: Gate de tipos + build**

Run: `npm run lint && npm run build`
Expected: sem erros (só o aviso de chunk).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Admin.tsx
git commit -m "feat: remove UI de criação manual e de status manual de roteiros"
```

---

## Task 6: Frontend — selo único, implantação e histórico agrupado

**Files:**
- Modify: `src/pages/Admin.tsx`

- [ ] **Step 1: Helpers + selo (fim do arquivo; remover `VersionBadge`/`RevisaoChip` antigos)**

```tsx
function formatBRDate(iso?: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : null;
}

function RevisaoBadge({ script }: { script: any }) {
  const vigente = script.is_current !== false;
  return (
    <span
      className={`px-2.5 py-1 rounded-full text-xs font-medium ${
        vigente ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
      }`}
    >
      Revisão {script.version ?? '?'} · {vigente ? 'vigente' : 'substituída'}
    </span>
  );
}

function RoteiroDatas({ script }: { script: any }) {
  const rev = formatBRDate(script.revisao_date);
  const impl = formatBRDate(script.implantacao_date);
  return (
    <div className="text-xs text-gray-500 leading-tight">
      {rev && <div>rev. {rev}</div>}
      {impl && <div>implantação: {impl}</div>}
    </div>
  );
}

// Agrupa revisões por roteiro (source_file): vigente + anteriores (desc por revisão).
function agruparPorRoteiro(scripts: any[]): { key: string; vigente: any; anteriores: any[] }[] {
  const grupos = new Map<string, any[]>();
  for (const s of scripts) {
    const key = s.source_file ?? `__${s.id}`;
    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key)!.push(s);
  }
  const num = (v: any) => parseInt(String(v ?? '').replace(/[^0-9]/g, ''), 10) || 0;
  return Array.from(grupos.entries()).map(([key, lista]) => {
    const ordenada = [...lista].sort((a, b) => num(b.version) - num(a.version));
    return { key, vigente: ordenada[0], anteriores: ordenada.slice(1) };
  });
}
```

- [ ] **Step 2: Estado de expansão**

Junto dos outros `useState`:

```tsx
  const [revisoesAbertas, setRevisoesAbertas] = useState<Record<string, boolean>>({});
```

- [ ] **Step 3: Visão LISTA — agrupar + colunas**

Trocar a `<table>` inteira da visão `lista` por:

```tsx
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-100 text-sm text-gray-500">
                      <th className="pb-3 pr-4 font-medium text-center">Roteiro</th>
                      <th className="pb-3 pr-4 font-medium w-48 text-center whitespace-nowrap">Revisão</th>
                      <th className="pb-3 pr-4 font-medium w-28 text-center whitespace-nowrap">Implantação</th>
                      <th className="pb-3 pr-4 font-medium w-20 text-center whitespace-nowrap">Critérios</th>
                      <th className="pb-3 pr-4 font-medium w-40 text-center whitespace-nowrap">Alertas</th>
                      <th className="pb-3 font-medium text-center w-16 whitespace-nowrap">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {agruparPorRoteiro(scripts).map(({ key, vigente, anteriores }) => (
                      <React.Fragment key={key}>
                        <tr className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                          <td className="py-4 pr-4 align-top font-medium text-gray-800">
                            {vigente.title}
                            {anteriores.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setRevisoesAbertas((m) => ({ ...m, [key]: !m[key] }))}
                                className="block mt-1 text-xs text-blue-600 hover:underline"
                              >
                                {revisoesAbertas[key] ? '▾ ocultar' : '▸ ver'} revisões anteriores ({anteriores.length})
                              </button>
                            )}
                          </td>
                          <td className="py-4 pr-4 align-top">
                            <div className="flex flex-col gap-1 items-start">
                              <RevisaoBadge script={vigente} />
                              <RoteiroDatas script={vigente} />
                            </div>
                          </td>
                          <td className="py-4 pr-4 align-top text-center text-gray-600">{formatBRDate(vigente.implantacao_date) ?? '—'}</td>
                          <td className="py-4 pr-4 align-top text-center text-gray-600">{vigente.items.length}</td>
                          <td className="py-4 pr-4 align-top"><RoteiroAlerts alerts={vigente.alerts} /></td>
                          <td className="py-4 align-top text-center">
                            <button onClick={() => handleDeleteScript(vigente)} className="text-red-500 hover:text-red-700 p-1" title="Excluir roteiro">
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </td>
                        </tr>
                        {revisoesAbertas[key] && anteriores.map((ant: any) => (
                          <tr key={ant.id} className="border-b border-gray-50 bg-gray-50/40 text-gray-500">
                            <td className="py-3 pr-4 pl-6 align-top text-sm">{ant.title}</td>
                            <td className="py-3 pr-4 align-top">
                              <div className="flex flex-col gap-1 items-start">
                                <RevisaoBadge script={ant} />
                                <RoteiroDatas script={ant} />
                              </div>
                            </td>
                            <td className="py-3 pr-4 align-top text-center">{formatBRDate(ant.implantacao_date) ?? '—'}</td>
                            <td className="py-3 pr-4 align-top text-center">{ant.items.length}</td>
                            <td className="py-3 pr-4 align-top"><RoteiroAlerts alerts={ant.alerts} /></td>
                            <td className="py-3 align-top text-center">
                              <button onClick={() => handleDeleteScript(ant)} className="text-red-500 hover:text-red-700 p-1" title="Excluir revisão">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
```

- [ ] **Step 4: Visão CARDS — um card por roteiro (vigente) + anteriores**

Na visão `cards`, iterar sobre `agruparPorRoteiro(scripts)` usando `vigente` no lugar de `script`: no topo do card usar `<RevisaoBadge script={vigente} />` + `<RoteiroDatas script={vigente} />` (substituindo `VersionBadge`/`RevisaoChip`/`StatusControl`), manter `<RoteiroAlerts alerts={vigente.alerts} />` e o botão de excluir chamando `handleDeleteScript(vigente)`. Quando `anteriores.length > 0`, mostrar abaixo dos itens o mesmo toggle `revisoesAbertas[key]` listando, em texto compacto, cada anterior como `Revisão {ant.version} — rev. {formatBRDate(ant.revisao_date)}` com um botão de excluir `handleDeleteScript(ant)`.

- [ ] **Step 5: Gate de tipos + build**

Run: `npm run lint && npm run build`
Expected: sem erros (só o aviso de chunk).

- [ ] **Step 6: Commit**

```bash
git add src/pages/Admin.tsx
git commit -m "feat: selo único de revisão, coluna implantação e histórico de revisões agrupado"
```

---

## Task 7: Frontend — erros de import legíveis + prestador só vê a vigente

**Files:**
- Modify: `src/pages/qualificacao/ImportRoteiroModal.tsx`
- Modify: `src/pages/qualificacao/PrestadorView.tsx`
- Modify: `src/pages/qualificacao/CooperadoView.tsx`

- [ ] **Step 1:** Em `ImportRoteiroModal.tsx`, exibir `err.message` (vindo do `{ error }` do servidor via `fetchApi`) num bloco de erro visível (vermelho). Ao receber o preview, se vier `errors: string[]` não vazio ou `blocked === true`, listar os erros e **desabilitar** o botão de confirmar import. Usar os campos novos do preview (`errors`, `blocked`, `revisaoDate`, `implantacaoDate`) — ex.: mostrar "Revisão {version} · rev. {revisaoDate} · implantação {implantacaoDate}" na prévia.

- [ ] **Step 2:** Em `PrestadorView.tsx`, antes de renderizar a lista de roteiros, filtrar:

```tsx
const scriptsVigentes = scripts.filter((s: any) => s.is_current !== false);
```

Usar `scriptsVigentes` no lugar de `scripts` na listagem de roteiros disponíveis. Não alterar a lógica de `eval_instances`/`inst.status`.

- [ ] **Step 3:** Em `CooperadoView.tsx`, aplicar o mesmo filtro `is_current !== false` na listagem de roteiros, preservando a lógica de instâncias.

- [ ] **Step 4: Gate de tipos + build**

Run: `npm run lint && npm run build`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/pages/qualificacao/ImportRoteiroModal.tsx src/pages/qualificacao/PrestadorView.tsx src/pages/qualificacao/CooperadoView.tsx
git commit -m "feat: erros de import legíveis e prestador/cooperado veem só a revisão vigente"
```

---

## Task 8: Operacional (PRODUÇÃO — exige autorização explícita do usuário)

> Gravam em produção e fazem deploy. **NÃO** executar sem o "sim" explícito do usuário. Ordem: **reset → migration → deploy → re-upload**.

- [ ] **Step 1: Reset da base** (autorizado)

```bash
node -e "const{Pool}=require('pg');require('dotenv').config();const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});p.query('DELETE FROM eval_scripts').then(r=>{console.log('apagados:',r.rowCount);return p.end();}).catch(e=>{console.error(e.message);process.exit(1);});"
```

- [ ] **Step 2: Aplicar a migration**

Run: `npm run db:migrate`
Expected: `+ aplicada: 00NN_versionamento_revisao.sql`.

- [ ] **Step 3: Push (deploy Railway)** (autorizado)

```bash
git push
```

- [ ] **Step 4: Re-upload + verificação manual** (usuário, na UI, após deploy + hard refresh)

1. Subir a revisão de cada roteiro → selo "Revisão NN · vigente" + datas (rev. e implantação).
2. Subir uma revisão maior do mesmo roteiro → vira vigente; a anterior vai para "ver revisões anteriores".
3. Subir a mesma revisão de novo → erro "Já existe uma versão com a revisão NN…", nada gravado.
4. Subir revisão nova com data de revisão já usada → erro de data repetida.
5. Subir planilha sem data de implantação → rejeitada.
6. Conferir que o prestador vê só a vigente.

---

## Self-Review (cobertura do spec)

- **version = revisão** → Task 3 (INSERT `version=parsed.version`); selo Task 6.
- **Sem criação manual** → Task 4 (endpoint) + Task 5 (UI).
- **Reset total** → Task 8 Step 1.
- **Dropar `revisao` + nova `implantacao_date` + datas NOT NULL** → Task 2.
- **Vigência = maior revisão** → `scriptVersionNum`/`is_current` no GET (inalterado); agrupamento usa o mesmo critério (Task 6).
- **Empilhar (não sobrepor)** → import sempre INSERT, nunca DELETE (Task 3).
- **Unicidade por roteiro (revisão e data)** → constraints (Task 2) + checagem amigável (Task 3).
- **Obrigatórios; faltando → rejeita** → Task 3 (422); parser null (Task 1).
- **Conflito → rollback total** → Task 3 (checagem antes do INSERT; 23505 backstop).
- **Status manual removido; `eval_instances.status` intacto** → Tasks 2/4/5.
- **Selo único + implantação + histórico agrupado** → Task 6.
- **Prestador só vê vigente** → Task 7.
- **Erros legíveis no modal** → Task 7.
- **Testes** → Task 1 (parser) + plano manual (Task 8 Step 4).
