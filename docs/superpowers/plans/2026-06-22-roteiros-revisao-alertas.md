# Roteiros: revisão, data da revisão e alertas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exibir, na tela de roteiros (Admin → "Roteiros de Avaliação"), a revisão da planilha + data da revisão, e um indicador de alertas (sem evidência / sem peso) que expande um accordion inline com os critérios sinalizados — recalculados do banco.

**Architecture:** O parser passa a extrair a data da revisão (`revisaoDate`). Uma migration aditiva acrescenta `revisao`/`revisao_date` em `eval_scripts`, preenchidas no import web e no CLI. O `GET /api/eval/scripts` recalcula alertas item-level por roteiro (reusando `isEvidenceExempt`) e os devolve inline. No frontend, `Admin.tsx` ganha um chip de revisão e um componente `RoteiroAlerts` (accordion) nas visões cards e lista.

**Tech Stack:** Node 20 + Express + tsx, `xlsx` (SheetJS), Postgres (`pg`), React 19 + Tailwind, `node:test` (runner nativo).

---

## Contexto de execução (ler antes de começar)

- **Diretório do projeto:** todos os comandos rodam de dentro de `portal-rede-v1-main/`.
- **Git:** este diretório **é** repositório git (branch `main`). Commits por task são OK. **NÃO** dar `git push` — push na `main` dispara deploy de produção (Railway); o deploy é decisão explícita do usuário, fora deste plano.
- **Banco = produção:** o `.env` local aponta para o Postgres de produção. Migration é aditiva/segura. Testes que gravam usam roteiro descartável `OPS-RED-FOR-999`.
- **Gate por task:** `npm run lint` (`tsc --noEmit`) e, no parser, `npm test`.
- **pg numeric → string:** colunas `numeric` (ex.: `max_score`) chegam como **string**; coagir com `Number()` antes de comparar (`!Number(x)`), nunca `!x` direto.

## File Structure

| Arquivo | Responsabilidade | Ação |
|---------|------------------|------|
| `db/roteiro-parser.ts` | Extrair também a data da revisão (`revisaoDate`); novo campo em `ParsedScript`. | **Modificar** |
| `db/roteiro-parser.test.ts` | Cobrir extração da data (com data → ISO; sem data → null). | **Modificar** |
| `db/migrations/0007_eval_script_revisao.sql` | Acrescentar `revisao text` e `revisao_date date`. | **Criar** |
| `server.ts` | Import web grava `revisao`/`revisao_date`; `GET /eval/scripts` devolve `alerts`. | **Modificar** |
| `db/import-roteiros.ts` | `commitScript` grava `revisao`/`revisao_date` (backfill via re-import CLI). | **Modificar** |
| `src/pages/qualificacao/RoteiroAlerts.tsx` | Accordion inline dos alertas (sem evidência / sem peso). | **Criar** |
| `src/pages/Admin.tsx` | Chip de revisão/data + `RoteiroAlerts` nas visões cards e lista. | **Modificar** |

---

## Task 1: Parser extrai a data da revisão (TDD)

**Files:**
- Modify: `db/roteiro-parser.ts`
- Modify: `db/roteiro-parser.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

Em `db/roteiro-parser.test.ts`, acrescente ao final (mantendo os testes existentes):

```typescript
test('parseWorkbook extrai a data da revisão quando presente', () => {
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
});

test('parseWorkbook deixa revisaoDate null quando a planilha não traz data', () => {
  const parsed = parseWorkbook(buildBuffer(), 'OPS-RED-FOR-017 - Teste.xlsx');
  assert.equal(parsed.version, '03');
  assert.equal(parsed.revisaoDate, null);
});
```

(`buildBuffer()` é o helper já existente no arquivo, cuja célula meta é `'OPS-REDS Revisão: 03'` — sem data.)

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test`
Expected: FALHA — `revisaoDate` é `undefined` (ainda não existe), os dois novos testes quebram; os demais passam.

- [ ] **Step 3: Adicionar o campo ao tipo `ParsedScript`**

Em `db/roteiro-parser.ts`, na interface `ParsedScript`, logo após a linha `version: string;`, acrescente:

```typescript
  revisaoDate: string | null;
```

- [ ] **Step 4: Extrair número + data da revisão**

Em `db/roteiro-parser.ts`, localize as duas linhas atuais:

```typescript
  const metaCell = rows[0]?.find((c) => /OPS-?REDS?/i.test(c)) ?? '';
  const revisao = metaCell.match(/Revis[ãa]o:\s*(\d+)/i)?.[1] ?? '00';
```

Substitua-as por:

```typescript
  const metaCell = rows[0]?.find((c) => /OPS-?REDS?/i.test(c)) ?? '';
  const revMatch = metaCell.match(/Revis[ãa]o:\s*(\d+)(?:\s+em\s+(\d{2})\/(\d{2})\/(\d{4}))?/i);
  const revisao = revMatch?.[1] ?? '00';
  // data "DD/MM/YYYY" → ISO "YYYY-MM-DD" (apenas quando presente)
  const revisaoDate = revMatch && revMatch[2] ? `${revMatch[4]}-${revMatch[3]}-${revMatch[2]}` : null;
```

- [ ] **Step 5: Incluir `revisaoDate` nos dois objetos de retorno**

Em `db/roteiro-parser.ts` há **dois** `return` que montam o `ParsedScript`: o early-return de cabeçalho ausente (`if (!hdr) { ... return {...}; }`) e o `return` final. Em **ambos**, acrescente o campo `revisaoDate,` junto de `version: revisao` (ou `version: revisao, revisaoDate,`). Ex. no objeto:

```typescript
    version: revisao,
    revisaoDate,
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `npm test`
Expected: PASS — todos os testes verdes (os 6 anteriores + os 2 novos).

- [ ] **Step 7: Gate de tipos**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add db/roteiro-parser.ts db/roteiro-parser.test.ts
git commit -m "feat: parser extrai data da revisão (revisaoDate)"
```

---

## Task 2: Migration `0007_eval_script_revisao.sql`

**Files:**
- Create: `db/migrations/0007_eval_script_revisao.sql`

- [ ] **Step 1: Criar o arquivo da migration**

Create `db/migrations/0007_eval_script_revisao.sql`:

```sql
-- =============================================================================
-- 0007_eval_script_revisao.sql
-- Revisão da planilha + data da revisão (exibidas na tela de roteiros).
-- Aditiva e idempotente. A coluna "version" (contador sequencial / vigência)
-- NÃO muda; estas colunas guardam a revisão informada na própria planilha.
--   revisao:      número da revisão da planilha (ex.: "02")
--   revisao_date: data da revisão (ex.: 2026-01-28)
-- =============================================================================

ALTER TABLE eval_scripts
  ADD COLUMN IF NOT EXISTS revisao      text,
  ADD COLUMN IF NOT EXISTS revisao_date date;
```

- [ ] **Step 2: Gate de tipos** (a migration não é aplicada aqui — apenas criada; `npm run db:migrate` em produção é decisão do usuário, fora do plano)

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add db/migrations/0007_eval_script_revisao.sql
git commit -m "feat: migration 0007 — revisao e revisao_date em eval_scripts"
```

---

## Task 3: Backend — gravar revisão/data e devolver alertas no GET

**Files:**
- Modify: `db/import-roteiros.ts:44-48` (INSERT do `commitScript`)
- Modify: `server.ts` (INSERT do `/import`; handler `GET /api/eval/scripts`)

- [ ] **Step 1: CLI `commitScript` grava revisão/data**

Em `db/import-roteiros.ts`, no `commitScript`, substitua o INSERT atual:

```typescript
    const { rows } = await client.query(
      `INSERT INTO eval_scripts (title, description, version, source_file, created_at)
       VALUES ($1, $2, $3, $4, now()) RETURNING id`,
      [parsed.title, parsed.description, parsed.version, parsed.sourceFile],
    );
```

por:

```typescript
    const { rows } = await client.query(
      `INSERT INTO eval_scripts (title, description, version, source_file, revisao, revisao_date, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING id`,
      [parsed.title, parsed.description, parsed.version, parsed.sourceFile, parsed.version, parsed.revisaoDate],
    );
```

(No CLI, `version` já é a revisão da planilha; gravamos a mesma em `revisao` para uniformidade, e `revisao_date` é a nova data.)

- [ ] **Step 2: Import web grava revisão/data**

Em `server.ts`, no endpoint `POST /api/eval/scripts/import`, localize o INSERT de `eval_scripts`:

```typescript
        const { rows: sr } = await client.query(
          `INSERT INTO eval_scripts (title, description, version, source_file, created_at)
           VALUES ($1, $2, $3, $4, now()) RETURNING id`,
          [parsed.title, parsed.description, nextVersion, parsed.sourceFile],
        );
```

Substitua por:

```typescript
        const { rows: sr } = await client.query(
          `INSERT INTO eval_scripts (title, description, version, source_file, revisao, revisao_date, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING id`,
          [parsed.title, parsed.description, nextVersion, parsed.sourceFile, parsed.version, parsed.revisaoDate],
        );
```

(`version` segue sendo o contador sequencial `nextVersion`; `revisao` recebe a revisão da planilha `parsed.version`.)

- [ ] **Step 3: GET busca colunas extras e computa alertas**

Em `server.ts`, no handler `GET /api/eval/scripts`, a consulta de itens hoje é:

```typescript
        const { rows: questions } = await query(`
          SELECT eq.id, eq.text as title FROM eval_questions eq
          JOIN eval_sections es ON eq.section_id = es.id
          WHERE es.script_id = $1
          ORDER BY eq.order_index ASC
        `, [script.id]);
        const isCurrent = !script.source_file
          || scriptVersionNum(script.version) === maxBySource.get(script.source_file);
        scriptsWithItems.push({ ...script, items: questions, is_current: isCurrent });
```

Substitua esse trecho por:

```typescript
        const { rows: questions } = await query(`
          SELECT eq.id, eq.text as title, eq.code, eq.evidence_required, eq.max_score
          FROM eval_questions eq
          JOIN eval_sections es ON eq.section_id = es.id
          WHERE es.script_id = $1
          ORDER BY eq.order_index ASC
        `, [script.id]);
        const semEvidencia = (questions as any[])
          .filter((q) => !q.evidence_required && !isEvidenceExempt(q.title))
          .map((q) => ({ code: q.code, text: q.title }));
        const semPeso = (questions as any[])
          .filter((q) => !Number(q.max_score)) // numeric chega como string; "0"/null/NaN → sem peso
          .map((q) => ({ code: q.code, text: q.title }));
        const isCurrent = !script.source_file
          || scriptVersionNum(script.version) === maxBySource.get(script.source_file);
        scriptsWithItems.push({ ...script, items: questions, is_current: isCurrent, alerts: { semEvidencia, semPeso } });
```

- [ ] **Step 4: Gate de tipos**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add server.ts db/import-roteiros.ts
git commit -m "feat: grava revisao/revisao_date e devolve alertas no GET de roteiros"
```

---

## Task 4: Frontend — chip de revisão + accordion de alertas

**Files:**
- Create: `src/pages/qualificacao/RoteiroAlerts.tsx`
- Modify: `src/pages/Admin.tsx`

- [ ] **Step 1: Criar o componente `RoteiroAlerts`**

Create `src/pages/qualificacao/RoteiroAlerts.tsx`:

```tsx
import React, { useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';

interface AlertItem {
  code: string | null;
  text: string;
}
interface Alerts {
  semEvidencia: AlertItem[];
  semPeso: AlertItem[];
}

export default function RoteiroAlerts({ alerts }: { alerts?: Alerts }) {
  const [open, setOpen] = useState(false);
  const semEvidencia = alerts?.semEvidencia ?? [];
  const semPeso = alerts?.semPeso ?? [];
  const total = semEvidencia.length + semPeso.length;
  if (total === 0) return null;

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 hover:bg-amber-100 transition-colors"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <AlertTriangle className="w-3.5 h-3.5" />
        {total} alerta{total > 1 ? 's' : ''}
      </button>

      {open && (
        <div className="mt-2 space-y-3 bg-amber-50/60 border border-amber-100 rounded-lg p-3">
          {semEvidencia.length > 0 && (
            <AlertGroup title={`Sem evidência (${semEvidencia.length})`} items={semEvidencia} />
          )}
          {semPeso.length > 0 && (
            <AlertGroup title={`Sem peso (${semPeso.length})`} items={semPeso} />
          )}
        </div>
      )}
    </div>
  );
}

function AlertGroup({ title, items }: { title: string; items: AlertItem[] }) {
  return (
    <div>
      <p className="text-xs font-semibold text-amber-800 mb-1">{title}</p>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={`${it.code ?? '-'}-${i}`} className="text-xs text-gray-700 flex gap-1.5">
            {it.code && <span className="font-mono text-gray-500 flex-shrink-0">{it.code}</span>}
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Gate de tipos (componente isolado)**

Run: `npm run lint`
Expected: sem erros (o componente ainda não é usado, mas deve type-checar).

- [ ] **Step 3: Importar `RoteiroAlerts` no `Admin.tsx`**

Em `src/pages/Admin.tsx`, após a linha `import ImportRoteiroModal from './qualificacao/ImportRoteiroModal';`, acrescente:

```tsx
import RoteiroAlerts from './qualificacao/RoteiroAlerts';
```

- [ ] **Step 4: Adicionar `RevisaoChip` + helper de data no fim do `Admin.tsx`**

Em `src/pages/Admin.tsx`, no fim do arquivo (junto de `VersionBadge`/`StatusControl`), acrescente:

```tsx
function formatRevisaoDate(iso?: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : null;
}

function RevisaoChip({ script }: { script: any }) {
  if (!script.revisao) return null;
  const data = formatRevisaoDate(script.revisao_date);
  return (
    <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
      Revisão {script.revisao}{data ? ` · ${data}` : ''}
    </span>
  );
}
```

- [ ] **Step 5: Inserir chip + alertas na visão CARDS**

Em `src/pages/Admin.tsx`, na visão de cards, localize a linha que renderiza os badges:

```tsx
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                      <VersionBadge script={script} />
                      <StatusControl script={script} onChange={handleUpdateScriptStatus} />
                    </div>
```

Substitua por:

```tsx
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                      <VersionBadge script={script} />
                      <RevisaoChip script={script} />
                      <StatusControl script={script} onChange={handleUpdateScriptStatus} />
                    </div>
                    <div className="mb-4">
                      <RoteiroAlerts alerts={script.alerts} />
                    </div>
```

- [ ] **Step 6: Inserir chip + alertas na visão LISTA**

Em `src/pages/Admin.tsx`, na visão de lista (tabela), localize a célula da coluna "Versão":

```tsx
                        <td className="py-4"><VersionBadge script={script} /></td>
```

Substitua por:

```tsx
                        <td className="py-4">
                          <div className="flex flex-col gap-1 items-start">
                            <VersionBadge script={script} />
                            <RevisaoChip script={script} />
                          </div>
                        </td>
```

E na mesma `<tr>`, localize a célula de status:

```tsx
                        <td className="py-4"><StatusControl script={script} onChange={handleUpdateScriptStatus} /></td>
```

Substitua por:

```tsx
                        <td className="py-4">
                          <div className="flex flex-col gap-1 items-start">
                            <StatusControl script={script} onChange={handleUpdateScriptStatus} />
                            <RoteiroAlerts alerts={script.alerts} />
                          </div>
                        </td>
```

- [ ] **Step 7: Gate de tipos**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 8: Build de produção (sanidade do frontend)**

Run: `npm run build`
Expected: build conclui sem erros (só o aviso pré-existente de tamanho de chunk é aceitável).

- [ ] **Step 9: Commit**

```bash
git add src/pages/qualificacao/RoteiroAlerts.tsx src/pages/Admin.tsx
git commit -m "feat: chip de revisão e accordion de alertas na tela de roteiros"
```

---

## Plano de teste manual (fim a fim)

> Grava no Postgres de **produção**. Pré-requisito: aplicar a migration 0007 (`npm run db:migrate`) — decisão do usuário. Usar roteiro descartável.

1. Aplicar a migration 0007 (`npm run db:migrate`).
2. Subir pela UI um roteiro descartável (`OPS-RED-FOR-999`) → após import, o card/linha mostra o chip **"Revisão NN · DD/MM/YYYY"**.
3. Clicar no indicador de alertas → o accordion abre listando os critérios "sem evidência" (com código + texto). Confirmar que a **pesquisa de satisfação da qualificação da rede NÃO aparece** (está isenta).
4. Alternar cards/lista → chip e alertas aparecem nas duas visões.
5. Roteiro sem alertas → indicador não aparece.
6. (Opcional) Backfill dos roteiros reais: `npm run db:import-roteiros --commit` → os roteiros existentes passam a mostrar revisão/data.
7. Limpeza: excluir o roteiro de teste.

---

## Self-Review (cobertura do spec)

- **Parser extrai data da revisão** (`revisaoDate`, ISO; null sem data) → Task 1.
- **Migration revisao/revisao_date** → Task 2.
- **Persistir no import web e no CLI** → Task 3 Steps 1-2.
- **Alertas recalculados do banco no GET** (semEvidencia com isenção; semPeso com coerção numeric) → Task 3 Step 3.
- **Chip de revisão + data nas duas visões** → Task 4 Steps 4-6.
- **Indicador + accordion inline com critérios sinalizados** → Task 4 Step 1, 5-6.
- **Vigência/versão inalteradas** → preservado (version e is_current não mudam).
- **Degradação:** roteiro sem revisao → chip oculto; sem alertas → indicador oculto → Task 4 (guards `if (!script.revisao)` / `if (total === 0)`).
- **Testes:** unit parser (Task 1) + plano manual.
