# Recarga de Prestadores a partir da aba `tabela` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a base de prestadores (dev) pela aba `tabela` de `Prestadores Portal.xlsx` via wipe + reload, com o roteiro de qualificação atribuído por regra determinística, e importar antes o roteiro FOR-024 (Hospitais).

**Architecture:** Pré-requisito de dados (corrigir parser de roteiros + importar FOR-024), depois uma função pura de seleção de roteiro, um parser novo para o layout da `tabela`, e um recarregador CLI que faz `TRUNCATE providers CASCADE` + reinserção numa transação, com trava de host para rodar só em dev.

**Tech Stack:** TypeScript + tsx, `xlsx`, `pg` (Postgres), `node:test`.

**Spec:** `docs/superpowers/specs/2026-07-16-recarga-prestadores-tabela-design.md`

## Global Constraints

- **Node fora do PATH:** prefixe cada comando node/npm no Bash com `export PATH="/c/Program Files/nodejs:$PATH"` na mesma linha.
- **Ambiente:** somente **dev** (`APP_ENV=dev` no `.env` → host `reseau.proxy.rlwy.net`). Nunca homolog/prod.
- **Test runner:** `node --import tsx --test <arquivo.test.ts>`; a suíte é `npm test`. Novos testes devem ser adicionados ao script `test` do `package.json`.
- **Git (OneDrive):** antes de commitar, rode uma vez `git config windows.appendAtomically false` (git é lento no OneDrive). Branch de trabalho: `dev`.
- **Estilo de teste:** `import { test } from 'node:test'; import assert from 'node:assert/strict';` (ver `db/providers-parser.test.ts`).
- **Imports internos** usam sufixo `.js` (ESM/tsx): `from './roteiro-rule.js'`.

---

### Task 1: Parser de roteiros — não ler data como número de revisão

**Files:**
- Modify: `db/roteiro-parser.ts:132`
- Test: `db/roteiro-parser.test.ts` (adicionar caso)

**Interfaces:**
- Consumes: nada novo.
- Produces: comportamento — `parseWorkbook(buf, file)` passa a devolver `version=null` e `revisaoDate=null` quando o cabeçalho tem `Revisão: DD/MM/YYYY` (data sem número), em vez de ler o dia como número.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar em `db/roteiro-parser.test.ts`:

```ts
test('Revisão em forma de data (sem número) não vira número de revisão', () => {
  const aoa = [
    ['ROTEIRO PARA AVALIAÇÃO DE QUALIFICAÇÃO', 'OPS-RED-FOR-024 Implantação: 30/09/2025 Revisão: 30/09/2025'],
    ['GRUPO'],
    ['ITEM', 'EVIDÊNCIA', 'PESO MÁXIMO', 'PESO À CONSIDERAR'],
    ['SEÇÃO 1. Estrutura'],
    ['1.1.1 Possui alvará?', '', '10', '8'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Roteiro');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const parsed = parseWorkbook(buf, 'OPS-RED-FOR-024 - Hospitais.xlsx');
  assert.equal(parsed.version, null);
  assert.equal(parsed.revisaoDate, null);
  assert.equal(parsed.implantacaoDate, '2025-09-30');
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx --test db/roteiro-parser.test.ts`
Expected: FAIL — hoje `version` vem `"30"` e `revisaoDate` vem `null` mas com o dia lido errado (assert de `version` quebra).

- [ ] **Step 3: Corrigir a regex do número de revisão**

Em `db/roteiro-parser.ts`, linha ~132, trocar:

```ts
  const revMatch = metaCell.match(/Revis[ãa]o:\s*(\d+)(?:\s+em\s+(\d{2})\/(\d{2})\/(\d{4}))?/i);
```

por (lookahead negativo `(?![\d/])` — impede casar "30" quando o que segue é "/"):

```ts
  const revMatch = metaCell.match(/Revis[ãa]o:\s*(\d+)(?![\d/])(?:\s+em\s+(\d{2})\/(\d{2})\/(\d{4}))?/i);
```

- [ ] **Step 4: Rodar e verificar que passa**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx --test db/roteiro-parser.test.ts`
Expected: PASS (todos os testes do arquivo).

- [ ] **Step 5: Confirmar zero regressão nos roteiros reais (dry-run de todos)**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx db/import-roteiros.ts 2>&1 | grep -E "revisão|ERRO|Total"`
Expected: nenhum `ERRO`; FOR-017 continua "revisão: 01"; FOR-024 aparece parseado (359 critérios). Não grava (dry-run).

- [ ] **Step 6: Commit**

```bash
git config windows.appendAtomically false
git add db/roteiro-parser.ts db/roteiro-parser.test.ts
git commit -m "fix(roteiros): não ler data de revisão como número de revisão"
```

---

### Task 2: Importar FOR-024 — fallback de revisao_date para implantação

**Files:**
- Modify: `db/import-roteiros.ts:44-48`

**Interfaces:**
- Consumes: `parseWorkbook` (Task 1), `ParsedScript.{revisaoDate, implantacaoDate}`.
- Produces: `eval_scripts` passa a conter FOR-024 (necessário para o `resolveScriptIds()` da Task 5).

- [ ] **Step 1: Aplicar o fallback no `commitScript`**

Em `db/import-roteiros.ts`, dentro de `commitScript`, logo após o `DELETE FROM eval_scripts ...` (antes do `INSERT`), inserir:

```ts
    const revisaoDate = parsed.revisaoDate ?? parsed.implantacaoDate;
    if (!revisaoDate) {
      throw new Error(`${parsed.sourceFile}: sem data de revisão nem de implantação — não é possível gravar revisao_date`);
    }
```

E no `INSERT`, trocar o parâmetro `parsed.revisaoDate` por `revisaoDate`:

```ts
      [parsed.title, parsed.description, parsed.version, parsed.sourceFile, revisaoDate, parsed.implantacaoDate],
```

- [ ] **Step 2: Dry-run do FOR-024 (não grava)**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx db/import-roteiros.ts --file FOR-024`
Expected: parseia (34 seções, 359 critérios), sem ERRO.

- [ ] **Step 3: Confirmar que o alvo é DEV**

Run:
```bash
export PATH="/c/Program Files/nodejs:$PATH"
grep '^APP_ENV' .env
node --import tsx -e "import('./db/resolveDbUrl.js').then(m=>console.log('host:', new URL(m.pickDatabaseUrl()).host))"
```
Expected: `APP_ENV=dev` e `host: reseau.proxy.rlwy.net:35128`. (Se não for o host de dev, PARE.)

- [ ] **Step 4: Gravar o FOR-024 em dev**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx db/import-roteiros.ts --commit --file FOR-024`
Expected: `✔ gravado: eval_scripts.id = <n>`.

- [ ] **Step 5: Verificar no banco**

Run:
```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --import tsx -e "import('./db/db.js').then(async ({query,pool})=>{const{rows}=await query(\"select id,source_file,revisao_date,implantacao_date from eval_scripts where source_file ilike '%FOR-024%'\");console.log(rows);await pool.end();})"
```
Expected: 1 linha, `revisao_date=2025-09-30`, `implantacao_date=2025-09-30`.

- [ ] **Step 6: Commit**

```bash
git add db/import-roteiros.ts
git commit -m "feat(roteiros): revisao_date herda implantação quando não há revisão; importa FOR-024"
```

---

### Task 3: Regra de seleção de roteiro (função pura)

**Files:**
- Create: `db/roteiro-rule.ts`
- Test: `db/roteiro-rule.test.ts`
- Modify: `package.json:20` (adicionar o test à suíte)

**Interfaces:**
- Consumes: nada.
- Produces: `selecionaRoteiro(grupo, tipo, especialidades: string[]): { cod: string | null; confianca: 'Alta'|'Média'|null }` e `normGrupo(s): string`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `db/roteiro-rule.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selecionaRoteiro } from './roteiro-rule.js';

test('grupo mapeia direto para roteiro (confiança Alta)', () => {
  assert.deepEqual(selecionaRoteiro('1 - MEDICOS COOPERADOS', '01 - MÉDICO', []), { cod: 'FOR-017', confianca: 'Alta' });
  assert.deepEqual(selecionaRoteiro('2 - LABORATORIOS', '', []), { cod: 'FOR-004', confianca: 'Alta' });
  assert.deepEqual(selecionaRoteiro('4 - HOSPITAIS', '', []), { cod: 'FOR-024', confianca: 'Alta' });
  assert.deepEqual(selecionaRoteiro('13 - CLINICA PSICOLOGO,FONO E/OU NUTRICIONIST', '', []), { cod: 'FOR-005', confianca: 'Alta' });
  assert.deepEqual(selecionaRoteiro('9 - PSICOLOGOS', '', []), { cod: 'FOR-015', confianca: 'Alta' });
});

test('RECURSO PRÓPRIO roteia por tipo + especialidade (confiança Média)', () => {
  assert.deepEqual(selecionaRoteiro('26 - RECURSO PRÓPRIO', '02 - LABORATÓRIO', ['ANATOMIA PATOLÓGICA']), { cod: 'FOR-004', confianca: 'Média' });
  assert.deepEqual(selecionaRoteiro('26 - RECURSO PRÓPRIO', 'HOSPITAL', []), { cod: 'FOR-024', confianca: 'Média' });
  assert.deepEqual(selecionaRoteiro('26 - RECURSO PRÓPRIO', '05 - CLÍNICAS', ['FISIOTERAPIA', 'FONOAUDIOLOGIA', 'PSICOLOGIA', 'TERAPIA OCUPACIONAL']), { cod: 'FOR-005', confianca: 'Média' });
  assert.deepEqual(selecionaRoteiro('26 - RECURSO PRÓPRIO', '05 - CLÍNICAS', ['ANÁLISES CLÍNICAS DIVERSAS']), { cod: 'FOR-004', confianca: 'Média' });
  assert.deepEqual(selecionaRoteiro('26 - RECURSO PRÓPRIO', '05 - CLÍNICAS', ['GERIATRIA', 'PSICOLOGIA', 'CONSULTA COM NUTRICIONISTA']), { cod: 'FOR-006', confianca: 'Média' });
});

test('HEMOSC e grupo desconhecido = A DEFINIR', () => {
  assert.deepEqual(selecionaRoteiro('8 - HEMOSC', '', []), { cod: null, confianca: null });
  assert.deepEqual(selecionaRoteiro('99 - XPTO', '', []), { cod: null, confianca: null });
});
```

- [ ] **Step 2: Rodar e verificar que falha**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx --test db/roteiro-rule.test.ts`
Expected: FAIL — `Cannot find module './roteiro-rule.js'`.

- [ ] **Step 3: Implementar a função pura**

Criar `db/roteiro-rule.ts`:

```ts
// Regra determinística de seleção de roteiro de qualificação a partir dos
// campos da aba `tabela` (Grupo do Prestador, Tipo de prestador, especialidades).

export type Confianca = 'Alta' | 'Média' | null;
export interface RoteiroSel {
  cod: string | null;
  confianca: Confianca;
}

/** Remove prefixo "NN - " ou "NN-", colapsa espaços, UPPER. */
export function normGrupo(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/^\s*\d+\s*-\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

const GRUPO2ROTEIRO: Record<string, string> = {
  'MEDICOS COOPERADOS': 'FOR-017',
  'MEDICOS COOPERADOS ARARANGUA': 'FOR-017',
  'MEDICOS CREDENCIADOS': 'FOR-017',
  LABORATORIOS: 'FOR-004',
  'LABORATORIOS ARARANGUA': 'FOR-004',
  'CLINICAS DE IMAGEM': 'FOR-002',
  'CLINICAS DE IMAGEM ARARANGUA': 'FOR-002',
  'CLINICAS DE FISIOTERAPIAS': 'FOR-003',
  'CLINICAS DE FISIOTERAPIA ARARANGUA': 'FOR-003',
  ANATOMOPATOLOGIA: 'FOR-001',
  PSICOLOGOS: 'FOR-015',
  'PSICOLOGOS ARARANGUA': 'FOR-015',
  FONOAUDIOLOGOS: 'FOR-015',
  'FONOAUDIOLOGOS ARARANGUA': 'FOR-015',
  NUTRICIONISTAS: 'FOR-015',
  'NUTRICIONISTAS ARARANGUA': 'FOR-015',
  'TERAPIA OCUPACIONAL': 'FOR-015',
  'CLINICA PSICOLOGO,FONO E/OU NUTRICIONIST': 'FOR-005',
  'CLINICAS MEDICAS': 'FOR-006',
  'CLINICAS MEDICAS ARARANGUA': 'FOR-006',
  HOSPITAIS: 'FOR-024',
  'HOSPITAIS ARARANGUA': 'FOR-024',
};

const MULTIPROF = ['FISIOTERAPIA', 'FONOAUDIOLOGIA', 'PSICOLOGIA', 'TERAPIA OCUPACIONAL'];

export function selecionaRoteiro(
  grupo: string | null | undefined,
  tipo: string | null | undefined,
  especialidades: string[],
): RoteiroSel {
  const g = normGrupo(grupo);
  const t = normGrupo(tipo);
  const esp = new Set(especialidades.map((e) => normGrupo(e)));

  if (g === 'HEMOSC') return { cod: null, confianca: null };

  if (g === 'RECURSO PRÓPRIO') {
    if (t === 'HOSPITAL') return { cod: 'FOR-024', confianca: 'Média' };
    if (t === 'LABORATÓRIO') return { cod: 'FOR-004', confianca: 'Média' };
    const multi = MULTIPROF.filter((m) => esp.has(m)).length;
    if (multi >= 2) return { cod: 'FOR-005', confianca: 'Média' };
    for (const e of esp) if (e.includes('ANÁLISES CLÍNICAS')) return { cod: 'FOR-004', confianca: 'Média' };
    return { cod: 'FOR-006', confianca: 'Média' };
  }

  const cod = GRUPO2ROTEIRO[g] ?? null;
  return { cod, confianca: cod ? 'Alta' : null };
}
```

- [ ] **Step 4: Rodar e verificar que passa**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx --test db/roteiro-rule.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Adicionar o teste à suíte `npm test`**

Em `package.json`, no script `"test"` (linha ~20), acrescentar ` db/roteiro-rule.test.ts` ao final da lista de arquivos (antes das aspas de fechamento).

- [ ] **Step 6: Commit**

```bash
git add db/roteiro-rule.ts db/roteiro-rule.test.ts package.json
git commit -m "feat(qualificacao): regra determinística de seleção de roteiro"
```

---

### Task 4: Parser da aba `tabela`

**Files:**
- Create: `db/tabela-parser.ts`
- Test: `db/tabela-parser.test.ts`
- Modify: `db/providers-parser.ts` (garantir `export` em `ParsedLocation`)
- Modify: `package.json:20` (adicionar o test à suíte)

**Interfaces:**
- Consumes: `selecionaRoteiro` (Task 3); `clean`, `onlyDigits`, `type ParsedLocation` de `./providers-parser.js`.
- Produces: `parseTabela(rows: TabelaRow[]): { providers: TabelaProvider[]; warnings: string[] }`, `type TabelaRow = Record<string, unknown>`, e `interface TabelaProvider` (ver Step 3) usada pela Task 5.

- [ ] **Step 1: Garantir que `ParsedLocation` é exportado**

Em `db/providers-parser.ts`, confirmar que a linha da interface começa com `export interface ParsedLocation`. Se estiver `interface ParsedLocation` sem `export`, adicionar `export`.

- [ ] **Step 2: Escrever o teste que falha**

Criar `db/tabela-parser.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTabela, type TabelaRow } from './tabela-parser.js';

function row(over: Record<string, unknown> = {}): TabelaRow {
  return {
    'Código do prestador': '1000546', 'Nome do prestador': 'SERGIO LUIZ BORTOLUZZI',
    'Nome Fantasia': null, CRM: '546', 'Situação do prestador': 'ATIVO',
    'Número do CPF e/ou CNJP': '352470968', 'Tipo de prestador': '01 - MÉDICO',
    'Grupo do Prestador': '1 - MEDICOS COOPERADOS', 'Especialidades/Gr Serv': '3-ANESTESIOLOGIA',
    'Nome Responsavel Técnico': null, Logradouro: 'RUA CORONEL PEDRO BENEDET',
    'Número': '505', Complemento: 'SALA 609', Bairro: 'CENTRO', CEP: '88801250',
    Cidade: 'CRICIUMA', UF: 'SC', Telefone: '(48)30452678', Celular: null, 'E-mail': null,
    'Tipo de Endereço': 'COMERCIAL',
    ...over,
  };
}

test('agrega linhas do mesmo código, junta especialidades e resolve roteiro', () => {
  const { providers } = parseTabela([
    row({ 'Especialidades/Gr Serv': '3-ANESTESIOLOGIA' }),
    row({ 'Especialidades/Gr Serv': '5-CARDIOLOGIA' }),
  ]);
  assert.equal(providers.length, 1);
  const p = providers[0];
  assert.equal(p.sgu_code, '1000546');
  assert.equal(p.person_type, 'PF');
  assert.equal(p.cpf, '00352470968');
  assert.equal(p.cnpj, null);
  assert.equal(p.provider_group, 'MEDICOS COOPERADOS');
  assert.equal(p.status, 'ativo');
  assert.equal(p.roteiro_cod, 'FOR-017');
  assert.equal(p.roteiro_confianca, 'Alta');
  assert.deepEqual([...p.specialties].sort(), ['ANESTESIOLOGIA', 'CARDIOLOGIA']);
  assert.equal(p.locations.length, 1);
  assert.equal(p.locations[0].is_primary, true);
  assert.equal(p.locations[0].in_medical_guide, true);
  assert.equal(p.locations[0].sgu_location_code, '1000546-1');
});

test('PJ pelo tipo, CNPJ pad p/ 14; AFASTADO vira inativo', () => {
  const { providers } = parseTabela([
    row({ 'Tipo de prestador': '05 - CLÍNICAS', 'Número do CPF e/ou CNJP': '15246302000111', 'Situação do prestador': 'AFASTADO', 'Grupo do Prestador': '6 - CLINICAS MEDICAS' }),
  ]);
  const p = providers[0];
  assert.equal(p.person_type, 'PJ');
  assert.equal(p.cnpj, '15246302000111');
  assert.equal(p.cpf, null);
  assert.equal(p.status, 'inativo');
  assert.equal(p.roteiro_cod, 'FOR-006');
});

test('endereços distintos viram múltiplas locations', () => {
  const { providers } = parseTabela([
    row({ CEP: '88801250', Logradouro: 'RUA A', 'Número': '1' }),
    row({ CEP: '88820000', Logradouro: 'RUA B', 'Número': '2' }),
    row({ CEP: '88801250', Logradouro: 'RUA A', 'Número': '1' }),
  ]);
  assert.equal(providers[0].locations.length, 2);
  assert.equal(providers[0].locations[1].sgu_location_code, '1000546-2');
});
```

- [ ] **Step 3: Rodar e verificar que falha**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx --test db/tabela-parser.test.ts`
Expected: FAIL — `Cannot find module './tabela-parser.js'`.

- [ ] **Step 4: Implementar o parser**

Criar `db/tabela-parser.ts`:

```ts
// Parser da aba `tabela` de Prestadores Portal.xlsx (layout novo).
// Agrega linhas por Código do prestador → 1 TabelaProvider (com N locations).
import { clean, onlyDigits, type ParsedLocation } from './providers-parser.js';
import { selecionaRoteiro, type Confianca } from './roteiro-rule.js';

export type TabelaRow = Record<string, unknown>;

export interface TabelaProvider {
  sgu_code: string;
  name: string;
  trade_name: string | null;
  person_type: 'PF' | 'PJ';
  cnpj: string | null;
  cpf: string | null;
  council_registry: string | null;
  specialties: string[];
  provider_type: string | null;
  provider_group: string | null;
  responsavel_tecnico: string | null;
  status: string;
  roteiro_cod: string | null;
  roteiro_confianca: Confianca;
  locations: ParsedLocation[];
}

const stripPrefix = (v: unknown): string => clean(v).replace(/^\s*\d+\s*-\s*/, '');

/** PF/PJ pelo Tipo de prestador (MÉDICO = pessoa física; resto = jurídica). */
function personTypeFromTipo(tipoLimpo: string): 'PF' | 'PJ' {
  return /M[ÉE]DICO/i.test(tipoLimpo) ? 'PF' : 'PJ';
}

interface Acc {
  row: TabelaRow;
  grupo: string;
  tipo: string;
  specialties: Set<string>;
  addrs: Map<string, ParsedLocation>;
}

export function parseTabela(rows: TabelaRow[]): { providers: TabelaProvider[]; warnings: string[] } {
  const warnings: string[] = [];
  const byCode = new Map<string, Acc>();

  for (const r of rows) {
    const code = clean(r['Código do prestador']);
    if (!code) continue;
    let acc = byCode.get(code);
    if (!acc) {
      acc = {
        row: r,
        grupo: clean(r['Grupo do Prestador']),
        tipo: clean(r['Tipo de prestador']),
        specialties: new Set(),
        addrs: new Map(),
      };
      byCode.set(code, acc);
    }
    const esp = stripPrefix(r['Especialidades/Gr Serv']);
    if (esp) acc.specialties.add(esp);

    const cep = onlyDigits(r['CEP']);
    const logradouro = clean(r['Logradouro']);
    const numero = clean(r['Número']);
    const key = `${cep}|${logradouro}|${numero}`;
    if ((cep || logradouro) && !acc.addrs.has(key)) {
      const phone = clean(r['Telefone']) || clean(r['Celular']) || null;
      acc.addrs.set(key, {
        sgu_location_code: '',
        label: clean(r['Tipo de Endereço']) || 'Comercial',
        cep: cep || null,
        logradouro: logradouro || null,
        numero: numero || null,
        complemento: clean(r['Complemento']) || null,
        bairro: clean(r['Bairro']) || null,
        cidade: clean(r['Cidade']) || null,
        uf: clean(r['UF']).toUpperCase() || null,
        phone,
        email: clean(r['E-mail']) || null,
        is_primary: false,
        in_medical_guide: true,
      });
    }
  }

  const providers: TabelaProvider[] = [];
  for (const [code, acc] of byCode) {
    const especialidades = [...acc.specialties];
    const { cod, confianca } = selecionaRoteiro(acc.grupo, acc.tipo, especialidades);
    if (!cod) warnings.push(`${code}: roteiro A DEFINIR (grupo "${acc.grupo}")`);

    const tipoLimpo = stripPrefix(acc.tipo);
    const person_type = personTypeFromTipo(tipoLimpo);
    const docDigits = onlyDigits(acc.row['Número do CPF e/ou CNJP']);
    let cnpj: string | null = null;
    let cpf: string | null = null;
    if (docDigits) {
      if (person_type === 'PF') cpf = docDigits.padStart(11, '0').slice(-11);
      else cnpj = docDigits.padStart(14, '0').slice(-14);
    }

    const status = clean(acc.row['Situação do prestador']).toUpperCase() === 'ATIVO' ? 'ativo' : 'inativo';
    const crm = onlyDigits(acc.row['CRM']);
    const council_registry = crm && crm !== '0' ? crm : null;

    const locations = [...acc.addrs.values()].map((l, i) => ({
      ...l,
      sgu_location_code: `${code}-${i + 1}`,
      is_primary: i === 0,
    }));
    if (locations.length === 0) warnings.push(`${code}: sem endereço`);

    providers.push({
      sgu_code: code,
      name: clean(acc.row['Nome do prestador']),
      trade_name: clean(acc.row['Nome Fantasia']) || null,
      person_type,
      cnpj,
      cpf,
      council_registry,
      specialties: especialidades,
      provider_type: tipoLimpo || null,
      provider_group: stripPrefix(acc.grupo) || null,
      responsavel_tecnico: clean(acc.row['Nome Responsavel Técnico']) || null,
      status,
      roteiro_cod: cod,
      roteiro_confianca: confianca,
      locations,
    });
  }
  return { providers, warnings };
}
```

- [ ] **Step 5: Rodar e verificar que passa**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx --test db/tabela-parser.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 6: Sanidade com o arquivo real (dry, sem banco)**

Run:
```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --import tsx -e "import('./db/tabela-parser.js').then(async m=>{const XLSX=(await import('xlsx')).default;const fs=await import('node:fs');const wb=XLSX.read(fs.readFileSync('../Prestadores Portal.xlsx'));const rows=XLSX.utils.sheet_to_json(wb.Sheets['tabela'],{defval:null});const{providers,warnings}=m.parseTabela(rows);const loc=providers.reduce((s,p)=>s+p.locations.length,0);const d=new Map();for(const p of providers){const k=p.roteiro_cod??'A DEFINIR';d.set(k,(d.get(k)||0)+1);}console.log('providers',providers.length,'locations',loc,'warnings',warnings.length);console.log([...d].sort((a,b)=>b[1]-a[1]));})"
```
Expected: `providers 676 locations 740`; distribuição `FOR-017=496, FOR-004=39, FOR-006=39, FOR-003=28, FOR-005=25, FOR-015=23, FOR-024=13, FOR-002=10, FOR-001=2, A DEFINIR=1`.

- [ ] **Step 7: Adicionar o teste à suíte e commitar**

Em `package.json`, script `"test"`, acrescentar ` db/tabela-parser.test.ts`.

```bash
git add db/tabela-parser.ts db/tabela-parser.test.ts db/providers-parser.ts package.json
git commit -m "feat(prestadores): parser da aba tabela (layout novo) com roteiro embutido"
```

---

### Task 5: Recarregador `import-tabela.ts` (wipe + reload, só dev)

**Files:**
- Create: `db/import-tabela.ts`
- Modify: `package.json` (script `db:import-tabela`)

**Interfaces:**
- Consumes: `parseTabela`, `type TabelaRow`, `type TabelaProvider` (Task 4); `pickDatabaseUrl` de `./resolveDbUrl.js`; `query`, `withTransaction`, `pool` de `./db.js`.
- Produces: CLI `tsx db/import-tabela.ts [--commit]`.

- [ ] **Step 1: Implementar o recarregador**

Criar `db/import-tabela.ts`:

```ts
/**
 * Recarga de prestadores a partir da aba `tabela` de Prestadores Portal.xlsx.
 * Wipe total (TRUNCATE providers CASCADE) + reinserção, numa transação.
 * SOMENTE DEV (trava de host).
 *   tsx db/import-tabela.ts            # dry-run: relatório, não grava
 *   tsx db/import-tabela.ts --commit   # grava no Postgres de dev
 * Env: CADASTRO_FILE (default ../Prestadores Portal.xlsx), CADASTRO_SHEET (default "tabela").
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { parseTabela, type TabelaRow } from './tabela-parser.js';
import { pickDatabaseUrl } from './resolveDbUrl.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FILE = process.env.CADASTRO_FILE || path.resolve(PROJECT_ROOT, '..', 'Prestadores Portal.xlsx');
const SHEET = process.env.CADASTRO_SHEET || 'tabela';
const DEV_HOST = 'reseau.proxy.rlwy.net';

function assertDevHost(): void {
  const url = pickDatabaseUrl();
  const host = url ? new URL(url).host : '(vazio)';
  if (!url || !url.includes(DEV_HOST)) {
    throw new Error(`Trava de host: import-tabela só roda em DEV (${DEV_HOST}). Host atual: ${host}`);
  }
}

async function resolveScriptIds(): Promise<Map<string, number>> {
  const { query } = await import('./db.js');
  const { rows } = await query<{ id: number; source_file: string }>('SELECT id, source_file FROM eval_scripts');
  const map = new Map<string, number>();
  for (const r of rows) {
    const m = /FOR-(\d+)/i.exec(r.source_file ?? '');
    if (m) map.set(`FOR-${m[1]}`, r.id);
  }
  return map;
}

function readRows(): TabelaRow[] {
  const wb = XLSX.read(fs.readFileSync(FILE), { cellDates: false });
  const sheet = wb.Sheets[SHEET];
  if (!sheet) throw new Error(`Aba "${SHEET}" não encontrada. Abas: ${wb.SheetNames.join(', ')}`);
  return XLSX.utils.sheet_to_json<TabelaRow>(sheet, { defval: null });
}

async function main() {
  const doCommit = process.argv.slice(2).includes('--commit');
  if (!fs.existsSync(FILE)) {
    console.error(`Arquivo não encontrado: ${FILE}`);
    process.exit(1);
  }

  const { providers, warnings } = parseTabela(readRows());
  const nLocParsed = providers.reduce((s, p) => s + p.locations.length, 0);
  const dist = new Map<string, number>();
  for (const p of providers) {
    const k = p.roteiro_cod ?? 'A DEFINIR';
    dist.set(k, (dist.get(k) ?? 0) + 1);
  }

  console.log(`Arquivo: ${FILE} | aba: ${SHEET} | modo: ${doCommit ? 'COMMIT' : 'DRY-RUN'}`);
  console.log(`Prestadores: ${providers.length} | Locais: ${nLocParsed}`);
  console.log(`Roteiros: ${[...dist].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  if (warnings.length) {
    console.log(`⚠ ${warnings.length} avisos:`);
    for (const w of warnings.slice(0, 15)) console.log(`   - ${w}`);
    if (warnings.length > 15) console.log(`   ... (+${warnings.length - 15})`);
  }

  if (!doCommit) {
    console.log(`\nDry-run. Para gravar: tsx db/import-tabela.ts --commit`);
    return;
  }

  assertDevHost();
  const { query, withTransaction, pool } = await import('./db.js');
  const scriptByCod = await resolveScriptIds();
  const naoResolvidos = new Set<string>();
  const { rows: runRows } = await query<{ id: number }>(
    `INSERT INTO sgu_sync_runs (source, status) VALUES ('xlsx-tabela', 'running') RETURNING id`,
  );
  const runId = runRows[0].id;
  let nLoc = 0;
  try {
    await withTransaction(async (client) => {
      await client.query('TRUNCATE providers RESTART IDENTITY CASCADE');
      for (const p of providers) {
        const evalScriptId = p.roteiro_cod ? scriptByCod.get(p.roteiro_cod) ?? null : null;
        if (p.roteiro_cod && evalScriptId == null) naoResolvidos.add(p.roteiro_cod);
        const { rows } = await client.query<{ id: number }>(
          `INSERT INTO providers
             (sgu_code, name, trade_name, person_type, cnpj, cpf, council_registry,
              specialties, provider_type, provider_group, area_atuacao, status,
              responsavel_tecnico, eval_script_id, roteiro_cod, roteiro_confianca, source, sgu_synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,'sgu',now())
           RETURNING id`,
          [
            p.sgu_code, p.name, p.trade_name, p.person_type, p.cnpj, p.cpf, p.council_registry,
            JSON.stringify(p.specialties), p.provider_type, p.provider_group, null, p.status,
            p.responsavel_tecnico, evalScriptId, p.roteiro_cod, p.roteiro_confianca,
          ],
        );
        const providerId = rows[0].id;
        for (const l of p.locations) {
          await client.query(
            `INSERT INTO provider_locations
               (provider_id, sgu_location_code, label, cep, logradouro, numero, complemento,
                bairro, cidade, uf, phone, email, is_primary, in_medical_guide, active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true)`,
            [
              providerId, l.sgu_location_code, l.label, l.cep, l.logradouro, l.numero, l.complemento,
              l.bairro, l.cidade, l.uf, l.phone, l.email, l.is_primary, l.in_medical_guide,
            ],
          );
          nLoc++;
        }
      }
    });
    await query(
      `UPDATE sgu_sync_runs SET status='success', providers_upserted=$2, locations_upserted=$3,
         message=$4, finished_at=now() WHERE id=$1`,
      [runId, providers.length, nLoc, `roteiros sem eval_script_id: ${[...naoResolvidos].join(',') || 'nenhum'}`],
    );
    console.log(`\n✔ Recarga: ${providers.length} prestadores, ${nLoc} locais.`);
    if (naoResolvidos.size) console.log(`⚠ roteiros sem eval_script_id: ${[...naoResolvidos].join(', ')}`);
  } catch (err: any) {
    await query(`UPDATE sgu_sync_runs SET status='error', message=$2, finished_at=now() WHERE id=$1`, [runId, String(err?.message ?? err)]);
    throw err;
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Dry-run (não grava)**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx db/import-tabela.ts`
Expected: `Prestadores: 676 | Locais: 740`; distribuição igual à da Task 4 Step 6; `A DEFINIR=1`.

- [ ] **Step 3: Verificar a trava de host (deve abortar fora do dev)**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && APP_ENV=prod node --import tsx db/import-tabela.ts --commit`
Expected: erro `Trava de host: import-tabela só roda em DEV (...)`. Nada gravado.

- [ ] **Step 4: Executar a recarga em dev**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && node --import tsx db/import-tabela.ts --commit`
Expected: `✔ Recarga: 676 prestadores, 740 locais.` e nenhum roteiro sem `eval_script_id` (FOR-024 já foi importado na Task 2).

- [ ] **Step 5: Adicionar script ao package.json e commitar**

Em `package.json`, na seção `scripts`, adicionar: `"db:import-tabela": "tsx db/import-tabela.ts",`

```bash
git add db/import-tabela.ts package.json
git commit -m "feat(prestadores): recarregador import-tabela (wipe+reload, trava de host dev)"
```

---

### Task 6: Validação pós-recarga (verificação, sem commit)

**Files:**
- (nenhum — só consultas de conferência)

**Interfaces:**
- Consumes: `query`, `pool` de `./db.js`.

- [ ] **Step 1: Conferir contagens e distribuição no banco**

Run:
```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --import tsx -e "import('./db/db.js').then(async ({query,pool})=>{
  const c=async(s)=>Number((await query(s)).rows[0].n);
  console.log('providers', await c('select count(*) n from providers'));
  console.log('locations', await c('select count(*) n from provider_locations'));
  console.log('sem eval_script_id', await c('select count(*) n from providers where eval_script_id is null'));
  console.log('sem roteiro_cod (A DEFINIR)', await c('select count(*) n from providers where roteiro_cod is null'));
  const {rows}=await query('select roteiro_cod, count(*)::int n from providers group by 1 order by n desc');
  console.log(rows.map(r=>`${r.roteiro_cod||'A DEFINIR'}=${r.n}`).join(', '));
  await pool.end();
})"
```
Expected: `providers 676`, `locations 740`, `sem eval_script_id 1` (só o HEMOSC A DEFINIR), `sem roteiro_cod 1`, e a distribuição de roteiros conforme Task 4 Step 6.

- [ ] **Step 2: Conferir que nenhum roteiro_cod aponta para roteiro inexistente**

Run:
```bash
export PATH="/c/Program Files/nodejs:$PATH"
node --import tsx -e "import('./db/db.js').then(async ({query,pool})=>{
  const {rows}=await query(\"select p.roteiro_cod, count(*)::int n from providers p where p.roteiro_cod is not null and p.eval_script_id is null group by 1\");
  console.log(rows.length? rows : 'ok: todo roteiro_cod resolveu eval_script_id');
  await pool.end();
})"
```
Expected: `ok: todo roteiro_cod resolveu eval_script_id`.

- [ ] **Step 3: Rodar a suíte de testes completa**

Run: `export PATH="/c/Program Files/nodejs:$PATH" && npm test`
Expected: todos os testes passam, incluindo `roteiro-rule.test.ts` e `tabela-parser.test.ts`.

---

## Notas de execução (riscos aceitos, ver spec)

- **Sem backup:** a Task 5 Step 4 é irreversível em dev. Se quiser rede de segurança, adicionar antes um dump JSON dos `providers`/`provider_locations` atuais.
- **Usuários de teste:** após a recarga, `users.provider_id` dos 5 usuários fica null (cascade SET NULL). Religar manualmente por `sgu_code` se for testar o fluxo de qualificação (ex.: `prestador-homolog`).
