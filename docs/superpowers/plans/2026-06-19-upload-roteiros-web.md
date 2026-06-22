# Upload de roteiros de qualificação pela web — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que admin/auditoria suba um `.xlsx` de roteiro de qualificação pela aba "Roteiros de Avaliação" (com prévia → confirmar), versionando sem nunca apagar, e controlar status de ciclo de vida — reusando o parser do CLI.

**Architecture:** Extrai o parser puro de `db/import-roteiros.ts` para `db/roteiro-parser.ts` (`parseWorkbook(buffer, sourceFile)`), reusado tanto pelo CLI (lê do disco) quanto por dois endpoints novos no `server.ts` (upload em memória via multer). Uma migration aditiva acrescenta `status` em `eval_scripts`; vigência ("vigente/substituído") é derivada da maior `version` por `source_file`. No frontend, `Admin.tsx` ganha um seletor (subir `.xlsx` / montar manualmente), um `ImportRoteiroModal` de 3 estados, badges de versão/status e um alternador cards/lista.

**Tech Stack:** Node 20 + Express + tsx, `xlsx` (SheetJS), `multer` (já presente), Postgres (`pg`), React 19 + Tailwind, `node:test` (runner nativo).

---

## Contexto de execução (ler antes de começar)

- **Diretório do projeto:** todos os comandos rodam de dentro de
  `portal-rede-v1-main/` (onde estão `package.json`, `server.ts`, `db/`, `src/`).
- **Sem git:** o diretório **não** é repositório git. As etapas de "Commit"
  tradicionais são substituídas por um **gate de verificação** (`npm run lint` e,
  no parser, `npm test`). Não há `git add/commit` a fazer.
- **Banco = produção:** o `.env` local aponta para o **mesmo Postgres de
  produção**. Qualquer teste manual que grava (preview NÃO grava; import GRAVA)
  deve usar um roteiro de teste claramente identificável e descartável.
- **Lint é o gate automático de cada task:** `npm run lint` roda `tsc --noEmit`.
  Deve passar sem erros novos antes de considerar a task concluída.
- **Por que pouca cobertura automatizada fora do parser:** não existe harness de
  teste de servidor/UI no repo e a base é de produção. Conforme o design
  aprovado (`docs/superpowers/specs/2026-06-19-upload-roteiros-web-design.md`,
  seção "Testes"), os endpoints e a UI são validados por **plano de teste
  manual**; só o parser tem teste unitário automatizado. Esta é uma decisão do
  spec do usuário e tem precedência sobre o default de TDD.

## File Structure

| Arquivo | Responsabilidade | Ação |
|---------|------------------|------|
| `db/roteiro-parser.ts` | Parser puro de `.xlsx` → `ParsedScript` (sem I/O de disco, sem DB). Tipos `ParsedScript`/`SectionNode`/`QuestionNode`. | **Criar** (movido de `import-roteiros.ts`) |
| `db/import-roteiros.ts` | CLI: lê arquivos do disco, delega ao parser, `commitScript` (com DELETE, idempotente por arquivo) e `report`. | **Modificar** (passa a importar do parser) |
| `db/roteiro-parser.test.ts` | Teste unitário do parser com `node:test` (fixture `.xlsx` montada em memória). | **Criar** |
| `db/migrations/0006_eval_script_status.sql` | Acrescenta `status text NOT NULL DEFAULT 'ativo'` em `eval_scripts`. | **Criar** |
| `package.json` | Mover `xlsx` para `dependencies`; adicionar script `test`. | **Modificar** |
| `server.ts` | Multer em memória + 3 endpoints (`preview`, `import`, `:id/status`) + `is_current` no `GET /eval/scripts`. | **Modificar** |
| `src/pages/qualificacao/ImportRoteiroModal.tsx` | Modal de 3 estados: selecionar → revisar → confirmar. | **Criar** |
| `src/pages/Admin.tsx` | Seletor no "Novo Roteiro", monta `ImportRoteiroModal`, alternador cards/lista, badges de versão/status, controle de status. | **Modificar** |

---

## Task 1: Mover `xlsx` para `dependencies` + script de teste

O servidor passará a importar `xlsx` em runtime (via o parser). Em produção
(Railway) `devDependencies` pode não ser instalada — se ficar lá, o servidor
quebra ao subir. Também adicionamos o script `test`.

**Files:**
- Modify: `package.json:19-55`

- [ ] **Step 1: Remover `xlsx` de `devDependencies`**

Em `package.json`, dentro de `"devDependencies"`, remova a linha:

```json
    "xlsx": "^0.18.5"
```

(A entrada removida era a última do bloco `devDependencies`; a linha de `vite`
imediatamente acima continua com sua vírgula normalmente.)

- [ ] **Step 2: Adicionar `xlsx` a `dependencies`**

Em `package.json`, no bloco `"dependencies"`, a última entrada hoje é
`"vite": "^6.2.0"`. Acrescente `xlsx` ao final, ajustando a vírgula:

```json
    "vite": "^6.2.0",
    "xlsx": "^0.18.5"
```

- [ ] **Step 3: Adicionar o script `test`**

Em `package.json`, no bloco `"scripts"`, acrescente após `"db:import-roteiros"`:

```json
    "db:import-roteiros": "tsx db/import-roteiros.ts",
    "test": "node --import tsx --test db/roteiro-parser.test.ts"
```

- [ ] **Step 4: Reinstalar dependências**

Run: `npm install`
Expected: instala sem erros; `xlsx` agora é dependência de produção no
`package.json`.

- [ ] **Step 5: Gate de verificação**

Run: `npm run lint`
Expected: `tsc --noEmit` termina sem erros (nada de código mudou ainda).

---

## Task 2: Extrair o parser para `db/roteiro-parser.ts` (TDD)

Mover a lógica pura de parse para um módulo reutilizável. `parseWorkbook` recebe
um `Buffer` (serve para disco e para upload). O CLI passa a delegar. **Sem mudar
o comportamento do parse.**

**Files:**
- Create: `db/roteiro-parser.ts`
- Create: `db/roteiro-parser.test.ts`
- Modify: `db/import-roteiros.ts:19-264` (remove o que foi movido; importa do parser)

- [ ] **Step 1: Escrever o teste que falha**

Create `db/roteiro-parser.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { parseWorkbook } from './roteiro-parser.js';

/** Monta uma planilha mínima em memória no layout esperado pelo parser. */
function buildBuffer(): Buffer {
  const aoa = [
    ['ROTEIRO PARA AVALIAÇÃO DE QUALIFICAÇÃO', 'OPS-REDS Revisão: 03'],
    ['GRUPO DE TESTE'],
    ['ITEM', 'EVIDÊNCIA', 'PESO MÁXIMO', 'PESO À CONSIDERAR'],
    ['SEÇÃO 1. Estrutura'],
    ['1.1.1 Possui alvará sanitário?', '', '10', '8'],
    ['1.1.2 Possui plano PGRSS?', 'Documento do PGRSS', '5', '5'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Roteiro');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

test('parseWorkbook conta seções, critérios e pontuação total', () => {
  const parsed = parseWorkbook(buildBuffer(), 'OPS-RED-FOR-017 - Teste.xlsx');
  assert.equal(parsed.sections.length, 2); // grupo + seção
  assert.equal(parsed.questions.length, 2);
  assert.equal(parsed.questions.reduce((s, q) => s + q.maxScore, 0), 15);
  assert.equal(parsed.version, '03');
  assert.equal(parsed.sourceFile, 'OPS-RED-FOR-017 - Teste.xlsx');
  assert.ok(parsed.opsCode.includes('OPS-RED-FOR-017'));
});

test('parseWorkbook marca evidência obrigatória só quando há coluna de evidência', () => {
  const parsed = parseWorkbook(buildBuffer(), 'OPS-RED-FOR-017 - Teste.xlsx');
  const comEvid = parsed.questions.find((q) => q.code === '1.1.2');
  const semEvid = parsed.questions.find((q) => q.code === '1.1.1');
  assert.ok(comEvid && semEvid);
  assert.equal(comEvid!.evidenceRequired, true);
  assert.equal(semEvid!.evidenceRequired, false);
});

test('parseWorkbook sinaliza cabeçalho ausente e devolve 0 critérios', () => {
  const ws = XLSX.utils.aoa_to_sheet([['planilha qualquer'], ['sem cabeçalho']]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'X');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const parsed = parseWorkbook(buf, 'sem-cabecalho.xlsx');
  assert.equal(parsed.questions.length, 0);
  assert.ok(parsed.orphans.some((o) => o.startsWith('!!')));
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test`
Expected: FALHA — `Cannot find module './roteiro-parser.js'` (o módulo ainda não
existe).

- [ ] **Step 3: Criar `db/roteiro-parser.ts` com o código movido**

Create `db/roteiro-parser.ts`:

```typescript
/**
 * Parser puro dos roteiros de qualificação (WS4).
 *
 * Extraído de db/import-roteiros.ts para ser reutilizável tanto pelo CLI
 * (lê o arquivo do disco) quanto pelo servidor (upload em memória).
 *
 * Não faz I/O de disco nem acesso a banco: recebe o conteúdo do .xlsx como
 * Buffer e devolve um ParsedScript. O layout de colunas não é fixo — as colunas
 * são detectadas a partir do cabeçalho ("PESO MÁXIMO"/"PESO À CONSIDERAR") e a
 * coluna de evidência é sempre (PESO MÁXIMO - 1).
 */
import XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
export const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Converte célula numérica ("10", "10,5", "") em número ou null. */
export function num(v: unknown): number | null {
  const s = clean(v);
  if (!s) return null;
  const n = Number(s.replace(',', '.').replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

const CLASS_LABELS: Record<string, string> = {
  S: 'Segurança',
  C: 'Conforto',
  E: 'Experiência do Cliente',
  DL: 'Documento Legal',
};
const mapClass = (c: string): string => CLASS_LABELS[c.toUpperCase()] ?? c;

/** Extrai referências normativas grosseiras do texto do critério. */
function extractLegislation(text: string): string | null {
  const m = text.match(/\b(ANS|ANVISA|RDC|RN|CFM|CRM|COREN|Lei|Portaria|Minist[ée]rio)\b[^."]{0,60}/gi);
  if (!m) return null;
  const uniq = Array.from(new Set(m.map((s) => s.trim())));
  return uniq.join('; ').slice(0, 300) || null;
}

// padrões de linha (col A)
const RE_QUESTION = /^(\d+(?:\.\d+){2,})\s*[.)]?\s+(.+)/s; // 1.1.1 ...
const RE_SUBSECTION = /^(\d+\.\d+)(?!\.\d)\.?\s+(.+)/s; //     1.1 ... (2 níveis)
const RE_SECTION = /^SE[ÇC][ÃA]O\s+([\d.]+)\.?\s*(.*)/i; //    SEÇÃO 1. ...
const RE_FOOTER = /^(TOTAL|PONTUA[ÇC][ÃA]O|RESULTADO|CLASSIFICA[ÇC]|ASSINATURA|RESPONS[ÁA]VEL|LEGENDA|DATA\b)/i;
const RE_DATAENTRY = /^(N[úu]mero\b|Quantidade\b|Outros\b|Nome\b|Especialidade|Endere[çc]o|Telefone|E-?mail|Munic[íi]pio|WhatsApp|C[óo]digo\b|Registro\b)/i;

// ---------------------------------------------------------------------------
// tipos do resultado de parse
// ---------------------------------------------------------------------------
export interface SectionNode {
  tmp: number;
  parentTmp: number | null;
  name: string;
  depth: number;
  order: number;
}
export interface QuestionNode {
  sectionTmp: number | null;
  code: string | null;
  text: string;
  guidance: string | null;
  dimension: string | null;
  legislation: string | null;
  weight: number;
  maxScore: number;
  evidenceRequired: boolean;
  isEliminatory: boolean;
  order: number;
}
export interface ParsedScript {
  sourceFile: string;
  opsCode: string;
  title: string;
  description: string;
  version: string;
  sheetName: string;
  sections: SectionNode[];
  questions: QuestionNode[];
  orphans: string[];
}

// ---------------------------------------------------------------------------
// parser
// ---------------------------------------------------------------------------
function findHeader(rows: string[][]) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const colMax = r.findIndex((c) => /PESO\s*M[ÁA]XIMO/i.test(c));
    const colCons = r.findIndex((c) => /CONSIDERAR/i.test(c));
    if (colMax >= 0 && colCons >= 0) {
      const colClass = r.findIndex((c) => /Quesitos/i.test(c));
      return { headerRow: i, colMax, colCons, colEvid: colMax - 1, colClass };
    }
  }
  return null;
}

function looksLikeGroup(text: string): boolean {
  if (!text || /^\d/.test(text)) return false;
  if (/^SE[ÇC][ÃA]O/i.test(text)) return false;
  if (RE_FOOTER.test(text)) return false;
  const letters = text.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length < 4) return false;
  return letters === letters.toUpperCase();
}

/**
 * Faz o parse de um workbook .xlsx (em Buffer) para ParsedScript.
 * @param buffer    conteúdo binário do .xlsx
 * @param sourceFile nome do arquivo de origem (ex.: "OPS-RED-FOR-017 - Clínicas.xlsx")
 */
export function parseWorkbook(buffer: Buffer, sourceFile: string): ParsedScript {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    blankrows: false,
    defval: '',
  }) as unknown[][];
  const rows: string[][] = raw.map((r) => r.map(clean));

  const base = sourceFile.replace(/\.[^.]+$/, '');
  const opsCode = (base.match(/OPS-RED-FOR-\d+/i)?.[0] ?? base).toUpperCase();
  const tipo = base.split(' - ').pop()?.trim() || base;

  const titleCell = rows[0]?.find((c) => /ROTEIRO PARA AVALIA/i.test(c)) ?? '';
  const metaCell = rows[0]?.find((c) => /OPS-?REDS?/i.test(c)) ?? '';
  const revisao = metaCell.match(/Revis[ãa]o:\s*(\d+)/i)?.[1] ?? '00';

  const hdr = findHeader(rows);

  const sections: SectionNode[] = [];
  const questions: QuestionNode[] = [];
  const orphans: string[] = [];

  let tmpSeq = 0;
  const stack: { tmp: number; depth: number }[] = [];
  const orderByParent = new Map<number | null, number>();
  const orderBySection = new Map<number | null, number>();

  function nextOrder(map: Map<number | null, number>, key: number | null): number {
    const n = (map.get(key) ?? 0) + 1;
    map.set(key, n);
    return n;
  }

  function pushSection(depth: number, name: string): number {
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
    const parentTmp = stack.length ? stack[stack.length - 1].tmp : null;
    const tmp = tmpSeq++;
    sections.push({ tmp, parentTmp, name, depth, order: nextOrder(orderByParent, parentTmp) });
    stack.push({ tmp, depth });
    return tmp;
  }

  if (!hdr) {
    orphans.push('!! cabeçalho de colunas (PESO MÁXIMO/CONSIDERAR) não encontrado');
    return { sourceFile, opsCode, title: `${opsCode} — ${tipo}`, description: titleCell, version: revisao, sheetName, sections, questions, orphans };
  }

  for (let i = hdr.headerRow - 1; i >= 0; i--) {
    const a = rows[i]?.[0] ?? '';
    if (looksLikeGroup(a)) {
      pushSection(0, a);
      break;
    }
    if (/^IDENTIFICA|^Operadora/i.test(a)) break;
  }

  for (let i = hdr.headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    const a = row[0] ?? '';
    if (!a) continue;

    const mSection = a.match(RE_SECTION);
    const mQuestion = a.match(RE_QUESTION);
    const mSub = a.match(RE_SUBSECTION);

    if (mSection) {
      pushSection(1, a);
      continue;
    }
    function addQuestion(code: string | null, text: string): void {
      const sectionTmp = stack.length ? stack[stack.length - 1].tmp : null;
      const guidance = clean(row[hdr!.colEvid]) || null;
      const maxScore = num(row[hdr!.colMax]) ?? 0;
      const weight = num(row[hdr!.colCons]) ?? maxScore;
      const classCell = hdr!.colClass >= 0 ? clean(row[hdr!.colClass]) : '';
      const markMatch = text.match(/"\s*(DL|S|C|E)\s*"/i);
      const dimension = classCell ? mapClass(classCell) : markMatch ? mapClass(markMatch[1]) : null;
      questions.push({
        sectionTmp,
        code: code || null,
        text,
        guidance,
        dimension,
        legislation: extractLegislation(text),
        weight,
        maxScore,
        evidenceRequired: !!guidance,
        isEliminatory: /mandat[óo]ri|eliminat[óo]ri/i.test(a),
        order: nextOrder(orderBySection, sectionTmp),
      });
    }

    if (mQuestion) {
      addQuestion(mQuestion[1], mQuestion[2].trim());
      continue;
    }
    if (mSub) {
      pushSection(2, a);
      continue;
    }
    if (RE_FOOTER.test(a)) continue;
    if (looksLikeGroup(a)) {
      pushSection(0, a);
      continue;
    }
    if (
      (num(row[hdr.colMax]) != null || num(row[hdr.colCons]) != null) &&
      a.length > 8 &&
      !RE_DATAENTRY.test(a)
    ) {
      addQuestion(null, a);
      continue;
    }
    if (a.length > 2) orphans.push(`r${i}: ${a.slice(0, 70)}`);
  }

  return {
    sourceFile,
    opsCode,
    title: `${opsCode} — ${tipo}`,
    description: titleCell,
    version: revisao,
    sheetName,
    sections,
    questions,
    orphans,
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test`
Expected: PASS — 3 testes verdes.

- [ ] **Step 5: Refatorar `db/import-roteiros.ts` para delegar ao parser**

Em `db/import-roteiros.ts`, substitua o cabeçalho de imports + todo o bloco de
helpers/tipos/parser (linhas 19 a 264, de `import XLSX from 'xlsx';` até o fim da
função `parseFile` — ou seja, tudo **antes** do comentário `// gravação (commit)`)
por:

```typescript
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkbook, type ParsedScript } from './roteiro-parser.js';

// ---------------------------------------------------------------------------
// localização dos arquivos
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ROTEIROS_DIR = process.env.ROTEIROS_DIR || path.resolve(PROJECT_ROOT, '..', 'rota-qualificacao');

/** Lê o .xlsx do disco e delega ao parser compartilhado. */
function parseFile(file: string): ParsedScript {
  return parseWorkbook(fs.readFileSync(file), path.basename(file));
}
```

Mantenha **intactos** o resto do arquivo: `commitScript`, `report` e `main` (de
`// gravação (commit)` em diante). Eles já usam `ParsedScript`, agora importado.

> Nota: o cabeçalho original do arquivo (comentário JSDoc das linhas 1-18) pode
> ficar como está. A substituição começa na linha 19 (`import XLSX from 'xlsx';`).

- [ ] **Step 6: Confirmar que CLI e testes seguem válidos**

Run: `npm run lint`
Expected: sem erros.

Run: `npm test`
Expected: PASS (o parser não mudou de comportamento).

- [ ] **Step 7 (opcional, dry-run sem gravar): smoke do CLI**

> Só execute se a pasta `../rota-qualificacao` existir nesta máquina. É dry-run
> (não grava no banco).

Run: `npm run db:import-roteiros`
Expected: imprime o relatório dos roteiros como antes (mesma contagem de
seções/critérios de antes da refatoração).

---

## Task 3: Migration `0006_eval_script_status.sql`

Acrescenta a coluna de ciclo de vida. Aditiva e idempotente, no padrão das
migrations existentes.

**Files:**
- Create: `db/migrations/0006_eval_script_status.sql`

- [ ] **Step 1: Criar o arquivo da migration**

Create `db/migrations/0006_eval_script_status.sql`:

```sql
-- =============================================================================
-- 0006_eval_script_status.sql
-- Ciclo de vida do roteiro de qualificação.
-- Aditiva e idempotente (ADD COLUMN IF NOT EXISTS).
--
-- status: 'rascunho' | 'ativo' | 'arquivado'  (default 'ativo')
-- Versão/vigência NÃO precisa de coluna nova: source_file + version já existem
-- (0001_baseline.sql) e "vigente/substituído" é derivado em consulta.
-- =============================================================================

ALTER TABLE eval_scripts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ativo';
```

- [ ] **Step 2: Aplicar a migration**

> Lembre: o banco é o de **produção**. Esta migration é aditiva e segura
> (default `'ativo'` para linhas existentes), mas confirme a intenção antes.

Run: `npm run db:migrate`
Expected: `+ aplicada:   0006_eval_script_status.sql` e
`1 migration(s) aplicada(s).`

- [ ] **Step 3: Gate de verificação**

Run: `npm run lint`
Expected: sem erros.

---

## Task 4: Endpoint `POST /api/eval/scripts/preview`

Upload em memória, parse, e devolve relatório **sem gravar**.

**Files:**
- Modify: `server.ts:8` (import do parser)
- Modify: `server.ts:28` (multer em memória + helpers, após `const upload = multer({ storage: storage });`)
- Modify: `server.ts` (inserir o endpoint logo antes de `app.delete('/api/eval/scripts/:id', ...)`, ~linha 1662)

- [ ] **Step 1: Importar o parser no topo do `server.ts`**

Em `server.ts`, logo após a linha 8 (`import { query, pool, withTransaction } from './db/db.js';`), acrescente:

```typescript
import { parseWorkbook } from './db/roteiro-parser.js';
```

- [ ] **Step 2: Adicionar o multer em memória e helpers compartilhados**

Em `server.ts`, logo após a linha 28 (`const upload = multer({ storage: storage });`), acrescente:

```typescript
// Upload em memória, só para .xlsx (parse de roteiro). Limite de 5 MB.
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // rejeita silenciosamente (req.file fica undefined → handler responde 400)
    cb(null, /\.xlsx$/i.test(file.originalname));
  },
});

// Adapta erros do multer (ex.: tamanho) para 400 com mensagem clara.
const xlsxUpload = (req: any, res: any, next: any) => {
  uploadMemory.single('file')(req, res, (err: any) => {
    if (err) {
      const isSize = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({ error: isSize ? 'Arquivo maior que 5 MB' : (err.message || 'Falha no upload') });
    }
    next();
  });
};

// Extrai o número da versão a partir do texto livre gravado ("03", "v2", "" → 0).
const scriptVersionNum = (v: unknown): number => {
  const digits = String(v ?? '').replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
};
```

- [ ] **Step 3: Inserir o endpoint de preview**

Em `server.ts`, **imediatamente antes** de `app.delete('/api/eval/scripts/:id', authenticate, ...)` (~linha 1662), insira:

```typescript
  app.post('/api/eval/scripts/preview', authenticate, xlsxUpload, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'Envie um arquivo .xlsx no campo "file".' });
      }

      const parsed = parseWorkbook(req.file.buffer, req.file.originalname);

      const totalMaxScore = parsed.questions.reduce((s, q) => s + q.maxScore, 0);
      const dimensions: Record<string, number> = {};
      for (const q of parsed.questions) {
        const k = q.dimension ?? '(sem dimensão)';
        dimensions[k] = (dimensions[k] ?? 0) + 1;
      }
      const noHeader = parsed.orphans.some((o) => o.startsWith('!!'));
      const blocked = parsed.questions.length === 0 || noHeader;

      const { rows: existingRows } = await query('SELECT version FROM eval_scripts WHERE source_file = $1', [parsed.sourceFile]);
      let existing: { currentVersion: number; nextVersion: number } | null = null;
      if (existingRows.length) {
        let maxv = 0;
        for (const r of existingRows as any[]) maxv = Math.max(maxv, scriptVersionNum(r.version));
        existing = { currentVersion: maxv, nextVersion: maxv + 1 };
      }

      res.json({
        title: parsed.title,
        version: parsed.version,
        sourceFile: parsed.sourceFile,
        sectionCount: parsed.sections.length,
        questionCount: parsed.questions.length,
        totalMaxScore,
        dimensions,
        warnings: {
          orphans: parsed.orphans,
          noWeight: parsed.questions.filter((q) => !q.maxScore).length,
          noEvidence: parsed.questions.filter((q) => !q.guidance).length,
          noHeader,
        },
        existing,
        blocked,
      });
    } catch (err: any) {
      console.error(err);
      res.status(400).json({ error: err.message || 'Não foi possível ler a planilha.' });
    }
  });
```

- [ ] **Step 4: Gate de verificação**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 5: Smoke manual do preview (não grava)**

Inicie o servidor (`npm run dev`) em outro terminal. Faça login como admin pela
UI e copie o token de `localStorage`. Então, de dentro de `portal-rede-v1-main/`:

Run (bash):
```bash
curl -s -X POST http://localhost:3000/api/eval/scripts/preview \
  -H "Authorization: Bearer <TOKEN>" \
  -F "file=@../rota-qualificacao/<algum-roteiro>.xlsx" | head -c 800
```
Expected: JSON com `title`, `sectionCount`, `questionCount`, `totalMaxScore`,
`dimensions`, `warnings`, `blocked: false`. **Nenhuma linha gravada** (preview não
escreve no banco). Confirme a porta real no log do `npm run dev` se não for 3000.

---

## Task 5: Endpoint `POST /api/eval/scripts/import`

Reparseia (stateless), recusa se `blocked`, e grava como **nova versão** (nunca
apaga) dentro de `withTransaction`.

**Files:**
- Modify: `server.ts` (inserir logo após o endpoint `preview` criado na Task 4)

- [ ] **Step 1: Inserir o endpoint de import**

Em `server.ts`, **logo após** o endpoint `POST /api/eval/scripts/preview`, insira:

```typescript
  app.post('/api/eval/scripts/import', authenticate, xlsxUpload, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'Envie um arquivo .xlsx no campo "file".' });
      }

      const parsed = parseWorkbook(req.file.buffer, req.file.originalname);
      const noHeader = parsed.orphans.some((o) => o.startsWith('!!'));
      if (parsed.questions.length === 0 || noHeader) {
        return res.status(422).json({ error: 'Planilha sem critérios reconhecíveis ou cabeçalho inválido.' });
      }

      const result = await withTransaction(async (client) => {
        // nova versão = (maior versão existente p/ aquele arquivo) + 1; novo => 1.
        const { rows: existing } = await client.query('SELECT version FROM eval_scripts WHERE source_file = $1', [parsed.sourceFile]);
        let maxv = 0;
        for (const r of existing as any[]) maxv = Math.max(maxv, scriptVersionNum(r.version));
        const nextVersion = String(maxv + 1);

        const { rows: sr } = await client.query(
          `INSERT INTO eval_scripts (title, description, version, source_file, created_at)
           VALUES ($1, $2, $3, $4, now()) RETURNING id`,
          [parsed.title, parsed.description, nextVersion, parsed.sourceFile],
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
            [
              sectionId, q.code, q.text, q.legislation, q.weight, q.maxScore,
              q.dimension, q.guidance, q.evidenceRequired, q.isEliminatory, q.order,
            ],
          );
        }

        return { id: scriptId, version: nextVersion };
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
      console.error(err);
      res.status(500).json({ error: err.message || 'Falha ao importar o roteiro.' });
    }
  });
```

- [ ] **Step 2: Gate de verificação**

Run: `npm run lint`
Expected: sem erros.

> A validação funcional do import é feita no plano de teste manual no fim do
> plano (grava no banco de produção — use um roteiro de teste descartável).

---

## Task 6: `PUT /api/eval/scripts/:id/status` + `is_current` no `GET`

**Files:**
- Modify: `server.ts` (inserir endpoint de status após o `import`)
- Modify: `server.ts:1688-1706` (`GET /api/eval/scripts` — adicionar `is_current`)

- [ ] **Step 1: Inserir o endpoint de status**

Em `server.ts`, **logo após** o endpoint `POST /api/eval/scripts/import`, insira:

```typescript
  app.put('/api/eval/scripts/:id/status', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      const { status } = req.body;
      const allowed = ['rascunho', 'ativo', 'arquivado'];
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: 'Status inválido. Use: rascunho, ativo ou arquivado.' });
      }
      await query('UPDATE eval_scripts SET status = $1 WHERE id = $2', [status, req.params.id]);
      res.json({ success: true });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
```

- [ ] **Step 2: Adicionar `is_current` ao `GET /api/eval/scripts`**

Em `server.ts`, substitua o corpo atual do handler `GET /api/eval/scripts`
(linhas ~1688-1706) por:

```typescript
  app.get('/api/eval/scripts', authenticate, async (req: any, res) => {
    try {
      const { rows: scripts } = await query('SELECT * FROM eval_scripts ORDER BY created_at DESC');

      // Maior versão por source_file → define a vigência ("is_current").
      const maxBySource = new Map<string, number>();
      for (const s of scripts as any[]) {
        if (!s.source_file) continue;
        const n = scriptVersionNum(s.version);
        if (n > (maxBySource.get(s.source_file) ?? -1)) maxBySource.set(s.source_file, n);
      }

      const scriptsWithItems = [];
      for (const script of scripts as any[]) {
        const { rows: questions } = await query(`
          SELECT eq.id, eq.text as title FROM eval_questions eq
          JOIN eval_sections es ON eq.section_id = es.id
          WHERE es.script_id = $1
          ORDER BY eq.order_index ASC
        `, [script.id]);
        const isCurrent = !script.source_file
          || scriptVersionNum(script.version) === maxBySource.get(script.source_file);
        scriptsWithItems.push({ ...script, items: questions, is_current: isCurrent });
      }
      res.json(scriptsWithItems);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
```

- [ ] **Step 3: Gate de verificação**

Run: `npm run lint`
Expected: sem erros.

- [ ] **Step 4: Smoke manual do GET**

Com o servidor rodando e logado como admin:

Run (bash):
```bash
curl -s http://localhost:3000/api/eval/scripts -H "Authorization: Bearer <TOKEN>" \
  | python -c "import sys,json; d=json.load(sys.stdin); print([(x['title'], x.get('version'), x.get('status'), x.get('is_current')) for x in d][:5])"
```
Expected: cada roteiro traz `status` (ex.: `'ativo'`) e `is_current` (boolean).

---

## Task 7: `ImportRoteiroModal.tsx` (frontend)

Modal de 3 estados: **selecionar → revisar → confirmar**.

**Files:**
- Create: `src/pages/qualificacao/ImportRoteiroModal.tsx`

- [ ] **Step 1: Criar o componente**

Create `src/pages/qualificacao/ImportRoteiroModal.tsx`:

```tsx
import React, { useState } from 'react';
import { fetchApi } from '../../lib/api';
import { X, UploadCloud, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';

interface PreviewResult {
  title: string;
  version: string;
  sourceFile: string;
  sectionCount: number;
  questionCount: number;
  totalMaxScore: number;
  dimensions: Record<string, number>;
  warnings: {
    orphans: string[];
    noWeight: number;
    noEvidence: number;
    noHeader: boolean;
  };
  existing: { currentVersion: number; nextVersion: number } | null;
  blocked: boolean;
}

interface Props {
  onClose: () => void;
  onImported: () => void;
}

type Stage = 'select' | 'review';

export default function ImportRoteiroModal({ onClose, onImported }: Props) {
  const [stage, setStage] = useState<Stage>('select');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const f = e.target.files?.[0] ?? null;
    setFile(f);
  };

  const handlePreview = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await fetchApi('/eval/scripts/preview', { method: 'POST', body: form });
      setPreview(data);
      setStage('review');
    } catch (err: any) {
      setError(err.message || 'Não foi possível ler a planilha.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!file || !preview || preview.blocked) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      await fetchApi('/eval/scripts/import', { method: 'POST', body: form });
      onImported();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Falha ao importar o roteiro.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h3 className="text-lg font-bold text-gray-900">Subir roteiro (.xlsx)</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {stage === 'select' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                Selecione um arquivo <strong>.xlsx</strong> de roteiro. Você verá uma
                prévia antes de confirmar a importação. Nada é gravado até você confirmar.
              </p>
              <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-gray-300 rounded-xl p-8 cursor-pointer hover:border-[#00995D] transition-colors">
                <UploadCloud className="w-10 h-10 text-gray-400" />
                <span className="text-sm text-gray-600">
                  {file ? file.name : 'Clique para escolher o arquivo .xlsx'}
                </span>
                <input type="file" accept=".xlsx" className="hidden" onChange={handleSelect} />
              </label>
            </div>
          )}

          {stage === 'review' && preview && (
            <div className="space-y-5">
              <div>
                <h4 className="text-base font-bold text-gray-900">{preview.title}</h4>
                <p className="text-xs text-gray-500">
                  Arquivo: {preview.sourceFile} · revisão da planilha: {preview.version}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <Stat label="Seções" value={preview.sectionCount} />
                <Stat label="Critérios" value={preview.questionCount} />
                <Stat label="Pontuação máx." value={preview.totalMaxScore} />
              </div>

              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">Dimensões</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(preview.dimensions).map(([k, v]) => (
                    <span key={k} className="px-2.5 py-1 rounded-full text-xs bg-gray-100 text-gray-700">
                      {k}: {v}
                    </span>
                  ))}
                </div>
              </div>

              {preview.existing && (
                <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg p-3 text-sm">
                  Já existe a versão {preview.existing.currentVersion} deste arquivo.
                  Confirmar criará a <strong>versão {preview.existing.nextVersion}</strong>{' '}
                  (a anterior é mantida).
                </div>
              )}

              {(preview.warnings.noHeader
                || preview.warnings.noWeight > 0
                || preview.warnings.noEvidence > 0
                || preview.warnings.orphans.length > 0) && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm space-y-1">
                  <p className="font-medium flex items-center gap-1">
                    <AlertTriangle className="w-4 h-4" /> Avisos
                  </p>
                  {preview.warnings.noHeader && <p>• Cabeçalho de colunas não reconhecido.</p>}
                  {preview.warnings.noWeight > 0 && <p>• {preview.warnings.noWeight} critério(s) sem peso máximo.</p>}
                  {preview.warnings.noEvidence > 0 && <p>• {preview.warnings.noEvidence} critério(s) sem evidência.</p>}
                  {preview.warnings.orphans.length > 0 && (
                    <p>• {preview.warnings.orphans.length} linha(s) não classificada(s).</p>
                  )}
                </div>
              )}

              {preview.blocked && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
                  Esta planilha não pode ser importada (0 critérios ou layout inválido).
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancelar
          </button>
          {stage === 'select' && (
            <button
              type="button"
              disabled={!file || loading}
              onClick={handlePreview}
              className="px-4 py-2 bg-[#00995D] text-white rounded-lg hover:bg-[#007A4A] transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Ver prévia
            </button>
          )}
          {stage === 'review' && preview && (
            <button
              type="button"
              disabled={preview.blocked || loading}
              onClick={handleConfirm}
              className="px-4 py-2 bg-[#00995D] text-white rounded-lg hover:bg-[#007A4A] transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Confirmar importação
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-center">
      <p className="text-2xl font-bold text-gray-800">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}
```

- [ ] **Step 2: Gate de verificação**

Run: `npm run lint`
Expected: sem erros (o componente ainda não é usado, mas deve type-checar).

---

## Task 8: Wiring no `Admin.tsx` — seletor, alternador e badges

**Files:**
- Modify: `src/pages/Admin.tsx` (imports, estados, handlers, botão "Novo Roteiro",
  tab `roteiros`, render do `ImportRoteiroModal`, componentes auxiliares)

- [ ] **Step 1: Importar o modal e os ícones novos**

Em `src/pages/Admin.tsx`, após a linha 2 (`import { fetchApi } from '../lib/api';`), acrescente:

```tsx
import ImportRoteiroModal from './qualificacao/ImportRoteiroModal';
```

No bloco de ícones `lucide-react` (linhas 3-26), acrescente `LayoutGrid`, `List`
e `UploadCloud`. Substitua a última linha do bloco (`  XCircle`) por:

```tsx
  XCircle,
  LayoutGrid,
  List,
  UploadCloud
```

- [ ] **Step 2: Adicionar estados de UI**

Em `Admin.tsx`, logo após a linha 80 (`const [showScriptModal, setShowScriptModal] = useState(false);`), acrescente:

```tsx
  const [showScriptChooser, setShowScriptChooser] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'lista'>(
    () => (localStorage.getItem('roteirosViewMode') as 'cards' | 'lista') || 'cards',
  );
```

- [ ] **Step 3: Persistir a preferência de visualização**

Em `Admin.tsx`, logo após o `useEffect` que lê o usuário (o que termina na linha
100 com `}, []);`), acrescente:

```tsx
  useEffect(() => {
    localStorage.setItem('roteirosViewMode', viewMode);
  }, [viewMode]);
```

- [ ] **Step 4: Adicionar o handler de status**

Em `Admin.tsx`, logo após `handleDeleteScript` (termina ~linha 193), acrescente:

```tsx
  const handleUpdateScriptStatus = async (id: number, status: string) => {
    try {
      await fetchApi(`/eval/scripts/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      loadData();
    } catch (err: any) {
      alert(err.message || 'Erro ao atualizar status');
    }
  };
```

- [ ] **Step 5: Trocar o botão "Novo Roteiro" pelo seletor**

Em `Admin.tsx`, substitua o bloco do botão da aba roteiros (linhas 297-305) por:

```tsx
        {activeTab === 'roteiros' && (
          <div className="relative">
            <button
              onClick={() => setShowScriptChooser((v) => !v)}
              className="flex items-center gap-2 bg-[#00995D] text-white px-4 py-2 rounded-lg hover:bg-[#007A4A] transition-colors"
            >
              <Plus className="w-5 h-5" />
              <span>Novo Roteiro</span>
            </button>
            {showScriptChooser && (
              <div className="absolute right-0 mt-2 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-20 overflow-hidden">
                <button
                  onClick={() => { setShowScriptChooser(false); setShowImportModal(true); }}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 text-left"
                >
                  <UploadCloud className="w-4 h-4 text-[#00995D]" />
                  Subir planilha (.xlsx)
                </button>
                <button
                  onClick={() => { setShowScriptChooser(false); setShowScriptModal(true); }}
                  className="w-full flex items-center gap-2 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 text-left border-t border-gray-100"
                >
                  <Plus className="w-4 h-4 text-gray-400" />
                  Montar manualmente
                </button>
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 6: Substituir o corpo da aba `roteiros` (cards + lista + badges)**

Em `Admin.tsx`, substitua o bloco inteiro `{activeTab === 'roteiros' && ( ... )}`
de conteúdo (linhas 442-488, dentro de `{/* Content */}`) por:

```tsx
        {activeTab === 'roteiros' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
              <h2 className="text-lg font-bold text-gray-800">Roteiros de Especialidade</h2>
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('cards')}
                  className={`p-2 rounded-md transition-colors ${viewMode === 'cards' ? 'bg-white shadow-sm text-[#00995D]' : 'text-gray-500'}`}
                  title="Ver como cards"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('lista')}
                  className={`p-2 rounded-md transition-colors ${viewMode === 'lista' ? 'bg-white shadow-sm text-[#00995D]' : 'text-gray-500'}`}
                  title="Ver como lista"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>

            {scripts.length === 0 && !loading && (
              <div className="text-center py-12 bg-gray-50 rounded-xl border border-gray-100">
                <ClipboardList className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-1">Nenhum roteiro cadastrado</h3>
                <p className="text-gray-500">Clique em "Novo Roteiro" para subir uma planilha ou montar manualmente.</p>
              </div>
            )}

            {viewMode === 'cards' && scripts.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {scripts.map((script) => (
                  <div key={script.id} className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                    <div className="flex justify-between items-start mb-3">
                      <h3 className="text-lg font-bold text-gray-900">{script.title}</h3>
                      <button
                        onClick={() => handleDeleteScript(script.id)}
                        className="text-red-500 hover:text-red-700 p-1"
                        title="Excluir roteiro"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                      <VersionBadge script={script} />
                      <StatusControl script={script} onChange={handleUpdateScriptStatus} />
                    </div>
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-gray-700">Itens do Checklist ({script.items.length}):</p>
                      <ul className="space-y-2">
                        {script.items.slice(0, 3).map((item: any) => (
                          <li key={item.id} className="text-sm text-gray-600 flex items-start gap-2">
                            <CheckCircle className="w-4 h-4 text-[#00995D] mt-0.5 flex-shrink-0" />
                            <span>{item.title}</span>
                          </li>
                        ))}
                        {script.items.length > 3 && (
                          <li className="text-sm text-gray-500 italic">+ {script.items.length - 3} outros itens...</li>
                        )}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {viewMode === 'lista' && scripts.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-gray-100 text-sm text-gray-500">
                      <th className="pb-3 font-medium">Roteiro</th>
                      <th className="pb-3 font-medium">Versão</th>
                      <th className="pb-3 font-medium">Critérios</th>
                      <th className="pb-3 font-medium">Status</th>
                      <th className="pb-3 font-medium text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    {scripts.map((script) => (
                      <tr key={script.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                        <td className="py-4 font-medium text-gray-800">{script.title}</td>
                        <td className="py-4"><VersionBadge script={script} /></td>
                        <td className="py-4 text-gray-600">{script.items.length}</td>
                        <td className="py-4"><StatusControl script={script} onChange={handleUpdateScriptStatus} /></td>
                        <td className="py-4 text-right">
                          <button
                            onClick={() => handleDeleteScript(script.id)}
                            className="text-red-500 hover:text-red-700 p-1"
                            title="Excluir roteiro"
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
        )}
```

- [ ] **Step 7: Renderizar o `ImportRoteiroModal`**

Em `Admin.tsx`, logo **antes** de `{showScriptModal && (` (linha 1046), acrescente:

```tsx
      {showImportModal && (
        <ImportRoteiroModal
          onClose={() => setShowImportModal(false)}
          onImported={loadData}
        />
      )}
```

- [ ] **Step 8: Adicionar os componentes auxiliares `VersionBadge` e `StatusControl`**

Em `src/pages/Admin.tsx`, no fim do arquivo (após o `}` que fecha
`export default function Admin()`), acrescente:

```tsx
function VersionBadge({ script }: { script: any }) {
  if (!script.version && !script.source_file) return null;
  const vigente = script.is_current !== false;
  return (
    <span
      className={`px-2.5 py-1 rounded-full text-xs font-medium ${
        vigente ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
      }`}
    >
      v{script.version ?? '?'} · {vigente ? 'vigente' : 'substituído'}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  rascunho: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  ativo: 'bg-green-100 text-green-700 border-green-200',
  arquivado: 'bg-gray-100 text-gray-600 border-gray-200',
};

function StatusControl({ script, onChange }: { script: any; onChange: (id: number, status: string) => void }) {
  const current = script.status || 'ativo';
  return (
    <select
      value={current}
      onChange={(e) => onChange(script.id, e.target.value)}
      className={`text-xs font-medium rounded-full border px-2.5 py-1 cursor-pointer focus:outline-none ${STATUS_STYLES[current] || STATUS_STYLES.ativo}`}
    >
      <option value="rascunho">rascunho</option>
      <option value="ativo">ativo</option>
      <option value="arquivado">arquivado</option>
    </select>
  );
}
```

- [ ] **Step 9: Gate de verificação**

Run: `npm run lint`
Expected: sem erros de tipo.

- [ ] **Step 10: Smoke visual**

Inicie `npm run dev`, abra a UI, faça login como admin, vá em
**Administração → Roteiros de Avaliação**:
- O botão "Novo Roteiro" abre o seletor com duas opções.
- O alternador cards/lista troca a visualização e persiste ao recarregar a página.
- Cada roteiro mostra badge de versão e o seletor de status.

---

## Plano de teste manual (fim a fim)

> Grava no Postgres de **produção**. Use um arquivo de roteiro de teste
> claramente identificável (ex.: renomeie uma cópia para
> `OPS-RED-FOR-999 - TESTE DESCARTÁVEL.xlsx`) para conseguir excluir depois.

1. **Novo Roteiro → Subir planilha (.xlsx)** → selecionar o arquivo de teste →
   **Ver prévia**. Conferir contagem de seções/critérios, pontuação, dimensões e
   avisos.
2. **Confirmar importação** → fechamento do modal → a lista recarrega e mostra o
   roteiro com badge `v1 · vigente` e status `ativo`.
3. Alternar **status para `arquivado`** no seletor → recarregar → o badge de
   status reflete `arquivado`.
4. **Subir o mesmo arquivo de novo** → a prévia indica "já existe a versão 1;
   isto criará a versão 2" → confirmar → a versão antiga vira `v1 · substituído`
   e a nova aparece como `v2 · vigente` (nada foi apagado).
5. **Montar manualmente** ainda funciona pelo seletor (caminho antigo intacto).
6. **Alternar cards/lista** mostra os mesmos dados nas duas visões; a preferência
   persiste após recarregar.
7. **Limpeza:** excluir os roteiros de teste (`v1` e `v2`) pelo ícone de lixeira.

---

## Self-Review (cobertura do spec)

- **Parser compartilhado** → Task 2 (`db/roteiro-parser.ts`, `parseWorkbook`,
  CLI delega; tipos exportados).
- **`xlsx` para `dependencies`** → Task 1.
- **Endpoint preview** (sem gravar, `existing`, `blocked`, warnings) → Task 4.
- **Endpoint import** (reparse, `422` se blocked, nova versão, sem DELETE,
  `withTransaction`) → Task 5.
- **Endpoint status** (validação enum) → Task 6 Step 1.
- **`is_current` no GET** (vigência derivada; manuais sempre vigentes) → Task 6 Step 2.
- **Migration 0006 status** → Task 3.
- **Seletor "Novo Roteiro"** (subir / manual) → Task 8 Step 5.
- **ImportRoteiroModal 3 estados** → Task 7 (select → review → confirm dentro do review).
- **Alternador cards/lista + localStorage** → Task 8 Steps 2-3, 6.
- **Badges versão + status nas duas visões** → Task 8 Steps 6, 8.
- **Montador manual mantido** → preservado (showScriptModal intacto) → Task 8 Step 5.
- **Tratamento de erros** (400 não-xlsx/corrompido, 422 blocked, 403 papel,
  atômico via withTransaction) → Tasks 4-6.
- **Testes** (unit parser node:test; manual fim a fim) → Task 2 + plano manual.
