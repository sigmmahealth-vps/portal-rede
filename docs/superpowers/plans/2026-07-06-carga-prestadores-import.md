# Carga de prestadores (import-providers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carregar os ~2.788 prestadores de `cadastro_prestadores_v0.xlsx` em `providers` + `provider_locations` + `provider_certifications`, gravando também o roteiro de avaliação de cada um (FK + rastro), via script idempotente.

**Architecture:** Espelha o par dos roteiros: um **parser puro** (`db/providers-parser.ts`, sem I/O, testável com arrays em memória) que agrega as linhas por `Código Prestador`, e um **CLI** (`db/import-providers.ts`) que lê o `.xlsx`, roda dry-run por padrão e, com `--commit`, faz upsert por `sgu_code` dentro de uma transação, resolvendo `FOR-XXX → eval_scripts.id`.

**Tech Stack:** TypeScript (ESM/NodeNext, imports com `.js`), `tsx`, biblioteca `xlsx` (já dependência), Postgres via `pg` (`db/db.ts`), testes `node:test` + `node:assert/strict`.

## Global Constraints

- **Spec de referência:** `docs/superpowers/specs/2026-07-06-carga-prestadores-import-design.md`.
- **Imports com extensão `.js`** (NodeNext), mesmo apontando para `.ts` (ex.: `from './db.js'`).
- **Idempotência:** providers por `ON CONFLICT (sgu_code)`; locations/certifications por **delete-by-provider_id + reinsert**.
- **Chave de integração:** `Código Prestador → providers.sgu_code`; `source='sgu'`, `sgu_synced_at=now()`.
- **Documentos:** CNPJ 14 dígitos, CPF 11 dígitos, sempre **zero-pad**; nunca gravar máscara.
- **Dry-run não acessa o banco**; só o caminho `--commit` toca Postgres (precisa de `DATABASE_URL` no `.env`).
- **Não** persistir `ROTEIRO_SUGERIDO_REVISAR` (decisão do brainstorming); só `roteiro_cod`/`roteiro_confianca` + FK.
- Git: o repo está em caminho OneDrive — já configurado `git config windows.appendAtomically false`; commits podem demorar mas concluem.

## File Structure

- **Create** `db/providers-parser.ts` — parser puro: `RawRow[] → ParseResult`. Responsável por normalização, agregação por código, locations e certifications. Sem disco/banco.
- **Create** `db/providers-parser.test.ts` — testes unitários do parser (`node:test`).
- **Create** `db/migrations/0015_provider_roteiro.sql` — colunas de vínculo do roteiro em `providers`.
- **Create** `db/import-providers.ts` — CLI: lê o `.xlsx`, relatório dry-run, `--commit` grava nas 3 tabelas + `sgu_sync_runs`, resolve a FK do roteiro.
- **Modify** `package.json` — adiciona script `db:import-providers` e inclui o teste do parser no `test`.

---

### Task 1: Parser — núcleo (helpers, tipos, agregação por código)

**Files:**
- Create: `db/providers-parser.ts`
- Test: `db/providers-parser.test.ts`

**Interfaces:**
- Consumes: nada (arquivo novo).
- Produces:
  - `type RawRow = Record<string, unknown>`
  - `clean(v: unknown): string`, `onlyDigits(v: unknown): string`
  - `normalizeDoc(v: unknown, len: number): { value: string | null; invalid: boolean }`
  - `interface ParsedLocation`, `interface ParsedCertification`, `interface ParsedProvider`, `interface ParseResult`
  - `parseProviders(rows: RawRow[]): ParseResult` (nesta task `locations`/`certifications` saem como `[]`, preenchidas nas Tasks 3 e 4)

- [ ] **Step 1: Write the failing test**

Create `db/providers-parser.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseProviders, normalizeDoc, type RawRow } from './providers-parser.js';

function row(over: Record<string, unknown> = {}): RawRow {
  return {
    'Código Prestador': '4000059', 'CRM': '0', 'Razão Social': 'HOSPITAL X',
    'Razão Social Abrev': 'HOSP X', 'Tipo Prestador': 'HOSPITAL', 'GRUPO_PREST': 'HOSPITAIS',
    'Desc. Área de Atuação': '', 'Especialidade': 'CARDIOLOGIA', 'Espec. Principal': '',
    'CNPJ': 82996712000163, 'CPF': '', 'PREST_MOT_EXCL': '',
    'ROTEIRO_COD': 'FOR-024', 'CONFIANCA': 'Alta',
    ...over,
  };
}

test('normalizeDoc faz zero-pad e sinaliza tamanho inválido', () => {
  assert.deepEqual(normalizeDoc(34390006991, 11), { value: '34390006991', invalid: false });
  assert.deepEqual(normalizeDoc(1234567890, 11), { value: '01234567890', invalid: false }); // recupera zero à esquerda
  assert.deepEqual(normalizeDoc('', 11), { value: null, invalid: false });
  assert.equal(normalizeDoc('123456789012345', 14).invalid, true); // 15 dígitos > 14
});

test('parseProviders agrega linhas do mesmo código em 1 prestador', () => {
  const { providers } = parseProviders([
    row({ 'Especialidade': 'CARDIOLOGIA' }),
    row({ 'Especialidade': 'PEDIATRIA' }),
    row({ 'Especialidade': 'CARDIOLOGIA' }), // duplicada
  ]);
  assert.equal(providers.length, 1);
  assert.equal(providers[0].sgu_code, '4000059');
  assert.deepEqual(providers[0].specialties, ['CARDIOLOGIA', 'PEDIATRIA']);
  assert.equal(providers[0].person_type, 'PJ');
  assert.equal(providers[0].cnpj, '82996712000163');
  assert.equal(providers[0].council_registry, null); // CRM '0' vira null
  assert.equal(providers[0].roteiro_cod, 'FOR-024');
  assert.equal(providers[0].roteiro_confianca, 'Alta');
});

test('Espec. Principal vem na frente das especialidades', () => {
  const { providers } = parseProviders([
    row({ 'Especialidade': 'CARDIOLOGIA', 'Espec. Principal': 'PEDIATRIA' }),
  ]);
  assert.deepEqual(providers[0].specialties, ['PEDIATRIA', 'CARDIOLOGIA']);
});

test('PF por CPF; status inativo quando há motivo de exclusão', () => {
  const { providers } = parseProviders([
    row({ 'Código Prestador': '5001', 'CNPJ': '', 'CPF': '34390006991',
          'CRM': '12345', 'PREST_MOT_EXCL': 'FALECEU' }),
  ]);
  assert.equal(providers[0].person_type, 'PF');
  assert.equal(providers[0].cpf, '34390006991');
  assert.equal(providers[0].council_registry, '12345');
  assert.equal(providers[0].status, 'inativo');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test db/providers-parser.test.ts`
Expected: FAIL — `Cannot find module './providers-parser.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `db/providers-parser.ts`:

```ts
/**
 * Parser puro da carga de prestadores (WS2).
 * Recebe as linhas do .xlsx (objetos por cabeçalho) e devolve prestadores
 * agregados por Código Prestador. Sem I/O de disco/banco (testável em memória).
 */

export type RawRow = Record<string, unknown>;

export const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
export const onlyDigits = (v: unknown): string => clean(v).replace(/\D/g, '');

/** Só dígitos + zero-pad ao tamanho esperado (CNPJ 14 / CPF 11). */
export function normalizeDoc(v: unknown, len: number): { value: string | null; invalid: boolean } {
  const digits = onlyDigits(v);
  if (!digits) return { value: null, invalid: false };
  if (digits.length > len) return { value: digits, invalid: true };
  return { value: digits.padStart(len, '0'), invalid: false };
}

export interface ParsedLocation {
  sgu_location_code: string;
  label: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
  in_medical_guide: boolean;
}

export interface ParsedCertification {
  kind: 'iso_9001' | 'acreditacao' | 'mestrado' | 'pos_graduacao' | 'doutorado';
  title: string | null;
  issuer: string | null;
  level: string | null;
  issued_date: string | null; // 'YYYY-MM-DD'
  expiry_date: string | null;
}

export interface ParsedProvider {
  sgu_code: string;
  name: string;
  trade_name: string | null;
  person_type: 'PF' | 'PJ' | null;
  cnpj: string | null;
  cpf: string | null;
  council_registry: string | null;
  specialties: string[];
  provider_type: string | null;
  provider_group: string | null;
  area_atuacao: string | null;
  status: string;
  roteiro_cod: string | null;
  roteiro_confianca: string | null;
  locations: ParsedLocation[];
  certifications: ParsedCertification[];
}

export interface ParseResult {
  providers: ParsedProvider[];
  warnings: string[];
}

// Nomes de cabeçalho da aba "Match" do cadastro.
const H = {
  code: 'Código Prestador', crm: 'CRM', razao: 'Razão Social', abrev: 'Razão Social Abrev',
  tipo: 'Tipo Prestador', grupoPrest: 'GRUPO_PREST', area: 'Desc. Área de Atuação',
  esp: 'Especialidade', espPrinc: 'Espec. Principal', cnpj: 'CNPJ', cpf: 'CPF',
  motExcl: 'PREST_MOT_EXCL',
  cepCom: 'CEP Comercial', cepRes: 'CEP Residencial', endCom: 'Endereço Comercial', endRes: 'Endereço Residencial',
  tel: 'Telefone', cel: 'Celular', email: 'Email',
  iso: 'ISO', nivelAcred: 'Nivel Acreditação', dataAcred: 'Data Acreditação',
  validAcred: 'Validade Acreditação', instAcred: 'Instituição Acreditadora',
  mestrado: 'Preferencias Mestrado', pos: 'Preferencias Pós', doutorado: 'Preferencias Doutorado',
  roteiroCod: 'ROTEIRO_COD', roteiroConf: 'CONFIANCA',
} as const;

const val = (row: RawRow, key: string): string => clean(row[key]);

export function parseProviders(rows: RawRow[]): ParseResult {
  const warnings: string[] = [];
  const groups = new Map<string, RawRow[]>();
  let semCodigo = 0;
  for (const r of rows) {
    const code = val(r, H.code);
    if (!code) { semCodigo++; continue; }
    let arr = groups.get(code);
    if (!arr) { arr = []; groups.set(code, arr); }
    arr.push(r);
  }
  if (semCodigo) warnings.push(`${semCodigo} linha(s) sem Código Prestador ignorada(s).`);

  const providers: ParsedProvider[] = [];
  for (const [code, groupRows] of groups) {
    const first = groupRows[0];
    const cnpjN = normalizeDoc(first[H.cnpj], 14);
    const cpfN = normalizeDoc(first[H.cpf], 11);
    if (cnpjN.invalid) warnings.push(`Código ${code}: CNPJ com ${onlyDigits(first[H.cnpj]).length} dígitos (esperado 14).`);
    if (cpfN.invalid) warnings.push(`Código ${code}: CPF com ${onlyDigits(first[H.cpf]).length} dígitos (esperado 11).`);

    const person_type: 'PF' | 'PJ' | null = cnpjN.value ? 'PJ' : cpfN.value ? 'PF' : null;

    const specialties: string[] = [];
    const seen = new Set<string>();
    const pushSpec = (s: string) => { const k = s.toLowerCase(); if (s && !seen.has(k)) { seen.add(k); specialties.push(s); } };
    pushSpec(val(first, H.espPrinc));
    for (const r of groupRows) pushSpec(val(r, H.esp));

    const crm = val(first, H.crm);
    const name = val(first, H.razao);
    if (!name) warnings.push(`Código ${code}: sem Razão Social.`);

    providers.push({
      sgu_code: code,
      name,
      trade_name: val(first, H.abrev) || null,
      person_type,
      cnpj: cnpjN.value,
      cpf: cpfN.value,
      council_registry: crm && crm !== '0' ? crm : null,
      specialties,
      provider_type: val(first, H.tipo) || null,
      provider_group: val(first, H.grupoPrest) || null,
      area_atuacao: val(first, H.area) || null,
      status: val(first, H.motExcl) ? 'inativo' : 'ativo',
      roteiro_cod: val(first, H.roteiroCod) || null,
      roteiro_confianca: val(first, H.roteiroConf) || null,
      locations: [],
      certifications: [],
    });
  }

  return { providers, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test db/providers-parser.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add db/providers-parser.ts db/providers-parser.test.ts
git commit -m "feat(import): parser de prestadores — agregação por código (WS2)"
```

---

### Task 2: Parser — dedup de documento entre códigos distintos

**Files:**
- Modify: `db/providers-parser.ts`
- Test: `db/providers-parser.test.ts`

**Interfaces:**
- Consumes: `ParsedProvider`, `parseProviders` (Task 1).
- Produces: `parseProviders` passa a zerar CNPJ/CPF repetidos entre prestadores diferentes (mantém o 1º), acrescentando avisos. Sem mudança de assinatura.

- [ ] **Step 1: Write the failing test**

Append to `db/providers-parser.test.ts`:

```ts
test('CNPJ repetido entre códigos diferentes é zerado no segundo', () => {
  const { providers, warnings } = parseProviders([
    row({ 'Código Prestador': 'A1', 'CNPJ': 82996712000163 }),
    row({ 'Código Prestador': 'A2', 'CNPJ': 82996712000163 }),
  ]);
  const a1 = providers.find((p) => p.sgu_code === 'A1')!;
  const a2 = providers.find((p) => p.sgu_code === 'A2')!;
  assert.equal(a1.cnpj, '82996712000163');
  assert.equal(a2.cnpj, null); // duplicado zerado
  assert.equal(a2.person_type, 'PJ'); // continua PJ
  assert.ok(warnings.some((w) => w.includes('CNPJ') && w.includes('A2')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test db/providers-parser.test.ts`
Expected: FAIL — `a2.cnpj` é `'82996712000163'`, esperado `null`.

- [ ] **Step 3: Write minimal implementation**

In `db/providers-parser.ts`, add the helper before `parseProviders`:

```ts
/** Zera CNPJ/CPF repetidos entre prestadores distintos (índice único parcial). */
function dedupeDocs(providers: ParsedProvider[], warnings: string[]): void {
  const seenCnpj = new Map<string, string>();
  const seenCpf = new Map<string, string>();
  for (const p of providers) {
    if (p.cnpj) {
      const owner = seenCnpj.get(p.cnpj);
      if (owner) { warnings.push(`CNPJ ${p.cnpj} duplicado (código ${p.sgu_code} já em ${owner}); documento zerado em ${p.sgu_code}.`); p.cnpj = null; }
      else seenCnpj.set(p.cnpj, p.sgu_code);
    }
    if (p.cpf) {
      const owner = seenCpf.get(p.cpf);
      if (owner) { warnings.push(`CPF ${p.cpf} duplicado (código ${p.sgu_code} já em ${owner}); documento zerado em ${p.sgu_code}.`); p.cpf = null; }
      else seenCpf.set(p.cpf, p.sgu_code);
    }
  }
}
```

Then, in `parseProviders`, replace the final `return { providers, warnings };` with:

```ts
  dedupeDocs(providers, warnings);
  return { providers, warnings };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test db/providers-parser.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add db/providers-parser.ts db/providers-parser.test.ts
git commit -m "feat(import): dedup de CNPJ/CPF entre códigos distintos"
```

---

### Task 3: Parser — endereços e locais (parseAddress + buildLocations)

**Files:**
- Modify: `db/providers-parser.ts`
- Test: `db/providers-parser.test.ts`

**Interfaces:**
- Consumes: `RawRow`, `ParsedLocation`, `val` (Task 1).
- Produces:
  - `interface ParsedAddr { logradouro; numero; complemento; bairro; cidade; uf }` (todos `string | null`)
  - `parseAddress(raw: string): ParsedAddr`
  - `buildLocations(row: RawRow, code: string): ParsedLocation[]`
  - `parseProviders` passa a preencher `provider.locations`.

- [ ] **Step 1: Write the failing test**

Append to `db/providers-parser.test.ts`:

```ts
import { parseAddress, buildLocations } from './providers-parser.js';

test('parseAddress separa logradouro, número, cidade e UF', () => {
  const a = parseAddress('RUA VITAL BRASIL, 455 - HOSPITAL SAO JOAO - CRUZEIRO DO SUL - CRICIUMA - SC');
  assert.equal(a.logradouro, 'RUA VITAL BRASIL');
  assert.equal(a.numero, '455');
  assert.equal(a.cidade, 'CRICIUMA');
  assert.equal(a.uf, 'SC');
});

test('parseAddress cai para logradouro cru quando não dá para separar', () => {
  const a = parseAddress('ENDERECO SEM PADRAO');
  assert.equal(a.logradouro, 'ENDERECO SEM PADRAO');
  assert.equal(a.uf, null);
});

test('buildLocations cria comercial primário (guia médico) e residencial secundário', () => {
  const locs = buildLocations(row({
    'Endereço Comercial': 'RUA A, 10 - CENTRO - CRICIUMA - SC', 'CEP Comercial': '88801-000',
    'Endereço Residencial': 'RUA B, 20 - PROSPERA - CRICIUMA - SC', 'CEP Residencial': '88815-000',
    'Telefone': '48 3433-0000', 'Email': 'x@y.com',
  }), '4000059');
  assert.equal(locs.length, 2);
  const com = locs.find((l) => l.label === 'Comercial')!;
  assert.equal(com.is_primary, true);
  assert.equal(com.in_medical_guide, true);
  assert.equal(com.phone, '48 3433-0000');
  assert.equal(com.email, 'x@y.com');
  assert.equal(com.sgu_location_code, '4000059-COM');
  const res = locs.find((l) => l.label === 'Residencial')!;
  assert.equal(res.is_primary, false);
  assert.equal(res.in_medical_guide, false);
});

test('parseProviders preenche locations do prestador', () => {
  const { providers } = parseProviders([
    row({ 'Endereço Comercial': 'RUA A, 10 - CENTRO - CRICIUMA - SC', 'CEP Comercial': '88801-000' }),
  ]);
  assert.equal(providers[0].locations.length, 1);
  assert.equal(providers[0].locations[0].label, 'Comercial');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test db/providers-parser.test.ts`
Expected: FAIL — `Cannot find module`/export `parseAddress` inexistente.

- [ ] **Step 3: Write minimal implementation**

In `db/providers-parser.ts`, add after the `val` helper:

```ts
export interface ParsedAddr {
  logradouro: string | null; numero: string | null; complemento: string | null;
  bairro: string | null; cidade: string | null; uf: string | null;
}

/** Parse best-effort do endereço-texto "LOGRADOURO, N - ... - CIDADE - UF". */
export function parseAddress(raw: string): ParsedAddr {
  const s = clean(raw);
  const empty: ParsedAddr = { logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null };
  if (!s) return empty;
  const parts = s.split(' - ').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return { ...empty, logradouro: s };
  let uf: string | null = null;
  const last = parts[parts.length - 1];
  if (/^[A-Za-z]{2}$/.test(last)) { uf = last.toUpperCase(); parts.pop(); }
  const cidade = parts.length ? parts.pop()! : null;
  const first = parts.shift() ?? '';
  let logradouro = first;
  let numero: string | null = null;
  const m = /^(.*?),\s*(\d+[A-Za-z]?)$/.exec(first);
  if (m) { logradouro = m[1].trim(); numero = m[2]; }
  const bairro = parts.length ? parts.join(' - ') : null;
  return { logradouro: logradouro || null, numero, complemento: null, bairro, cidade, uf };
}

/** Constrói os locais (comercial primário + residencial) a partir de uma linha. */
export function buildLocations(row: RawRow, code: string): ParsedLocation[] {
  const out: ParsedLocation[] = [];
  const phone = val(row, H.tel) || val(row, H.cel) || null;
  const email = val(row, H.email) || null;
  const endCom = val(row, H.endCom);
  const cepCom = val(row, H.cepCom);
  if (endCom || cepCom || phone || email) {
    const a = parseAddress(endCom);
    out.push({
      sgu_location_code: `${code}-COM`, label: 'Comercial', cep: cepCom || null,
      logradouro: a.logradouro, numero: a.numero, complemento: a.complemento, bairro: a.bairro,
      cidade: a.cidade, uf: a.uf, phone, email, is_primary: true, in_medical_guide: true,
    });
  }
  const endRes = val(row, H.endRes);
  const cepRes = val(row, H.cepRes);
  if (endRes || cepRes) {
    const a = parseAddress(endRes);
    out.push({
      sgu_location_code: `${code}-RES`, label: 'Residencial', cep: cepRes || null,
      logradouro: a.logradouro, numero: a.numero, complemento: a.complemento, bairro: a.bairro,
      cidade: a.cidade, uf: a.uf, phone: null, email: null,
      is_primary: out.length === 0, in_medical_guide: false,
    });
  }
  return out;
}
```

Then in `parseProviders`, change the provider object field `locations: [],` to:

```ts
      locations: buildLocations(first, code),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test db/providers-parser.test.ts`
Expected: PASS (9 testes).

- [ ] **Step 5: Commit**

```bash
git add db/providers-parser.ts db/providers-parser.test.ts
git commit -m "feat(import): parse de endereço e locais (comercial/residencial)"
```

---

### Task 4: Parser — certificações (ISO, acreditação, pós-graduação)

**Files:**
- Modify: `db/providers-parser.ts`
- Test: `db/providers-parser.test.ts`

**Interfaces:**
- Consumes: `RawRow`, `ParsedCertification`, `val`, `clean` (Task 1).
- Produces:
  - `buildCertifications(row: RawRow): ParsedCertification[]`
  - `parseProviders` passa a preencher `provider.certifications`.

- [ ] **Step 1: Write the failing test**

Append to `db/providers-parser.test.ts`:

```ts
import { buildCertifications } from './providers-parser.js';

test('buildCertifications só gera linha quando o campo tem conteúdo', () => {
  assert.equal(buildCertifications(row()).length, 0); // ISO/acreditação/pós vazios
  const certs = buildCertifications(row({
    'ISO': 'ISO 9001:2015',
    'Nivel Acreditação': 'Nível 2', 'Instituição Acreditadora': 'ONA',
    'Data Acreditação': '10/03/2024', 'Validade Acreditação': '10/03/2026',
    'Preferencias Mestrado': 'Mestrado em Cardiologia',
  }));
  const iso = certs.find((c) => c.kind === 'iso_9001')!;
  assert.equal(iso.title, 'ISO 9001:2015');
  const acr = certs.find((c) => c.kind === 'acreditacao')!;
  assert.equal(acr.issuer, 'ONA');
  assert.equal(acr.level, 'Nível 2');
  assert.equal(acr.issued_date, '2024-03-10');
  assert.equal(acr.expiry_date, '2026-03-10');
  assert.ok(certs.some((c) => c.kind === 'mestrado' && c.title === 'Mestrado em Cardiologia'));
});

test('parseProviders preenche certifications do prestador', () => {
  const { providers } = parseProviders([row({ 'Preferencias Doutorado': 'Doutorado em Saúde' })]);
  assert.ok(providers[0].certifications.some((c) => c.kind === 'doutorado'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test db/providers-parser.test.ts`
Expected: FAIL — export `buildCertifications` inexistente.

- [ ] **Step 3: Write minimal implementation**

In `db/providers-parser.ts`, add after `buildLocations`:

```ts
/** Converte Date (cellDates) ou 'DD/MM/YYYY' em 'YYYY-MM-DD'; senão null. */
function toISODate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(clean(v));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Um campo "presente" (ignora vazio, N/NÃO/0). */
function isPresent(s: string): boolean {
  const u = s.toUpperCase();
  return !!s && u !== 'N' && u !== 'NAO' && u !== 'NÃO' && u !== '0';
}

/** Extrai certificações acadêmicas, ISO 9001 e acreditação de uma linha. */
export function buildCertifications(row: RawRow): ParsedCertification[] {
  const out: ParsedCertification[] = [];
  const iso = val(row, H.iso);
  if (isPresent(iso)) out.push({ kind: 'iso_9001', title: iso, issuer: null, level: null, issued_date: null, expiry_date: null });

  const nivel = val(row, H.nivelAcred);
  const inst = val(row, H.instAcred);
  const dataAcred = toISODate(row[H.dataAcred]);
  if (isPresent(nivel) || isPresent(inst) || dataAcred) {
    out.push({
      kind: 'acreditacao', title: null, issuer: inst || null, level: nivel || null,
      issued_date: dataAcred, expiry_date: toISODate(row[H.validAcred]),
    });
  }

  const academic: Array<[string, ParsedCertification['kind']]> = [
    [H.mestrado, 'mestrado'], [H.pos, 'pos_graduacao'], [H.doutorado, 'doutorado'],
  ];
  for (const [key, kind] of academic) {
    const v = val(row, key);
    if (isPresent(v)) out.push({ kind, title: v, issuer: null, level: null, issued_date: null, expiry_date: null });
  }
  return out;
}
```

Then in `parseProviders`, change the provider object field `certifications: [],` to:

```ts
      certifications: buildCertifications(first),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test db/providers-parser.test.ts`
Expected: PASS (11 testes).

- [ ] **Step 5: Commit**

```bash
git add db/providers-parser.ts db/providers-parser.test.ts
git commit -m "feat(import): parse de certificações (ISO/acreditação/pós)"
```

---

### Task 5: Migration 0015 — vínculo do roteiro em providers

**Files:**
- Create: `db/migrations/0015_provider_roteiro.sql`

**Interfaces:**
- Consumes: tabelas `providers`, `eval_scripts` (existentes).
- Produces: colunas `providers.eval_script_id` (FK), `providers.roteiro_cod`, `providers.roteiro_confianca` — usadas pelo INSERT do CLI na Task 6.

- [ ] **Step 1: Write the migration**

Create `db/migrations/0015_provider_roteiro.sql`:

```sql
-- =============================================================================
-- 0015_provider_roteiro.sql
-- Vínculo do roteiro de avaliação em cada prestador (resultado do match).
-- Aditiva e idempotente (ADD COLUMN IF NOT EXISTS).
--   eval_script_id  -> FK para eval_scripts (resolvida de FOR-XXX no importador)
--   roteiro_cod     -> 'FOR-017' etc. (rastro do match; null p/ 'A DEFINIR')
--   roteiro_confianca -> Alta|Média|Baixa|A DEFINIR
-- =============================================================================

ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS eval_script_id    bigint REFERENCES eval_scripts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS roteiro_cod       text,
  ADD COLUMN IF NOT EXISTS roteiro_confianca text;

CREATE INDEX IF NOT EXISTS providers_eval_script_idx ON providers (eval_script_id);
```

- [ ] **Step 2: Apply the migration**

Run: `npm run db:migrate`
Expected: `+ aplicada:   0015_provider_roteiro.sql` (ou `= já aplicada` em reexecução). Requer `DATABASE_URL` no `.env`.

- [ ] **Step 3: Verify the columns exist**

Run:
```bash
npx tsx -e "import('./db/db.js').then(async ({pool})=>{const {rows}=await pool.query(\"select column_name from information_schema.columns where table_name='providers' and column_name in ('eval_script_id','roteiro_cod','roteiro_confianca') order by 1\");console.log(rows.map(r=>r.column_name));await pool.end();})"
```
Expected: `[ 'eval_script_id', 'roteiro_cod', 'roteiro_confianca' ]`

- [ ] **Step 4: Commit**

```bash
git add db/migrations/0015_provider_roteiro.sql
git commit -m "feat(db): migration 0015 — vínculo eval_script_id/roteiro em providers"
```

---

### Task 6: CLI import-providers + script npm

**Files:**
- Create: `db/import-providers.ts`
- Modify: `package.json` (script `db:import-providers`; incluir teste do parser no `test`)

**Interfaces:**
- Consumes: `parseProviders`, `ParsedProvider`, `RawRow` (Tasks 1-4); `pool`, `query`, `withTransaction` de `./db.js`; colunas da Task 5; `sgu_sync_runs`.
- Produces: comando `tsx db/import-providers.ts [--commit]`. Sem exports para outras tasks.

- [ ] **Step 1: Write the CLI**

Create `db/import-providers.ts`:

```ts
/**
 * Importador de prestadores (WS2) — carga a partir de cadastro_prestadores_v0.xlsx.
 * Dry-run por padrão; --commit grava (idempotente por sgu_code).
 *   tsx db/import-providers.ts            # dry-run: só relatório, não grava
 *   tsx db/import-providers.ts --commit   # grava no Postgres
 * Env: CADASTRO_FILE (default ../cadastro_prestadores_v0.xlsx), CADASTRO_SHEET (default "Match").
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import { parseProviders, type ParsedProvider, type RawRow } from './providers-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CADASTRO_FILE = process.env.CADASTRO_FILE || path.resolve(PROJECT_ROOT, '..', 'cadastro_prestadores_v0.xlsx');
const CADASTRO_SHEET = process.env.CADASTRO_SHEET || 'Match';

function readRows(file: string, sheetName: string): RawRow[] {
  const wb = XLSX.read(fs.readFileSync(file), { cellDates: true });
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`Aba "${sheetName}" não encontrada. Abas: ${wb.SheetNames.join(', ')}`);
  return XLSX.utils.sheet_to_json<RawRow>(sheet, { raw: true, defval: '' });
}

/** Mapa FOR-XXX -> eval_scripts.id (extraído de source_file). */
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

interface CommitCounts { providers: number; locations: number; certs: number; resolved: number; }

async function commit(providers: ParsedProvider[], scriptByCod: Map<string, number>): Promise<CommitCounts> {
  const { query, withTransaction } = await import('./db.js');
  const { rows: runRows } = await query<{ id: number }>(
    `INSERT INTO sgu_sync_runs (source, status) VALUES ('xlsx', 'running') RETURNING id`,
  );
  const runId = runRows[0].id;
  let nLoc = 0, nCert = 0, nResolved = 0;
  try {
    await withTransaction(async (client) => {
      for (const p of providers) {
        const evalScriptId = p.roteiro_cod ? scriptByCod.get(p.roteiro_cod) ?? null : null;
        if (evalScriptId != null) nResolved++;
        const { rows } = await client.query<{ id: number }>(
          `INSERT INTO providers
             (sgu_code, name, trade_name, person_type, cnpj, cpf, council_registry,
              specialties, provider_type, provider_group, area_atuacao, status,
              eval_script_id, roteiro_cod, roteiro_confianca, source, sgu_synced_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,'sgu',now())
           ON CONFLICT (sgu_code) DO UPDATE SET
             name=EXCLUDED.name, trade_name=EXCLUDED.trade_name, person_type=EXCLUDED.person_type,
             cnpj=EXCLUDED.cnpj, cpf=EXCLUDED.cpf, council_registry=EXCLUDED.council_registry,
             specialties=EXCLUDED.specialties, provider_type=EXCLUDED.provider_type,
             provider_group=EXCLUDED.provider_group, area_atuacao=EXCLUDED.area_atuacao,
             status=EXCLUDED.status, eval_script_id=EXCLUDED.eval_script_id,
             roteiro_cod=EXCLUDED.roteiro_cod, roteiro_confianca=EXCLUDED.roteiro_confianca,
             sgu_synced_at=now()
           RETURNING id`,
          [p.sgu_code, p.name, p.trade_name, p.person_type, p.cnpj, p.cpf, p.council_registry,
           JSON.stringify(p.specialties), p.provider_type, p.provider_group, p.area_atuacao, p.status,
           evalScriptId, p.roteiro_cod, p.roteiro_confianca],
        );
        const providerId = rows[0].id;

        await client.query('DELETE FROM provider_locations WHERE provider_id = $1', [providerId]);
        for (const l of p.locations) {
          await client.query(
            `INSERT INTO provider_locations
               (provider_id, sgu_location_code, label, cep, logradouro, numero, complemento,
                bairro, cidade, uf, phone, email, is_primary, in_medical_guide, active)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true)`,
            [providerId, l.sgu_location_code, l.label, l.cep, l.logradouro, l.numero, l.complemento,
             l.bairro, l.cidade, l.uf, l.phone, l.email, l.is_primary, l.in_medical_guide],
          );
          nLoc++;
        }

        await client.query('DELETE FROM provider_certifications WHERE provider_id = $1', [providerId]);
        for (const c of p.certifications) {
          await client.query(
            `INSERT INTO provider_certifications
               (provider_id, kind, title, issuer, level, issued_date, expiry_date, source, sgu_synced_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'sgu',now())`,
            [providerId, c.kind, c.title, c.issuer, c.level, c.issued_date, c.expiry_date],
          );
          nCert++;
        }
      }
    });
    await query(
      `UPDATE sgu_sync_runs SET status='success', providers_upserted=$2, locations_upserted=$3,
         message=$4, finished_at=now() WHERE id=$1`,
      [runId, providers.length, nLoc, `certs=${nCert}; roteiros_resolvidos=${nResolved}`],
    );
    return { providers: providers.length, locations: nLoc, certs: nCert, resolved: nResolved };
  } catch (err: any) {
    await query(`UPDATE sgu_sync_runs SET status='error', message=$2, finished_at=now() WHERE id=$1`,
      [runId, String(err?.message ?? err)]);
    throw err;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const doCommit = args.includes('--commit');
  if (!fs.existsSync(CADASTRO_FILE)) { console.error(`Arquivo não encontrado: ${CADASTRO_FILE}`); process.exit(1); }

  const rows = readRows(CADASTRO_FILE, CADASTRO_SHEET);
  const { providers, warnings } = parseProviders(rows);

  const pj = providers.filter((p) => p.person_type === 'PJ').length;
  const pf = providers.filter((p) => p.person_type === 'PF').length;
  const semDoc = providers.filter((p) => !p.person_type).length;
  const locs = providers.reduce((s, p) => s + p.locations.length, 0);
  const certs = providers.reduce((s, p) => s + p.certifications.length, 0);
  const comRoteiro = providers.filter((p) => p.roteiro_cod).length;
  const byType = new Map<string, number>();
  for (const p of providers) { const k = p.provider_type ?? '(sem)'; byType.set(k, (byType.get(k) ?? 0) + 1); }

  console.log(`Arquivo: ${CADASTRO_FILE}`);
  console.log(`Aba: ${CADASTRO_SHEET} | linhas: ${rows.length} | modo: ${doCommit ? 'COMMIT' : 'DRY-RUN'}`);
  console.log(`Prestadores: ${providers.length}  (PJ=${pj}, PF=${pf}, sem doc=${semDoc})`);
  console.log(`Locais: ${locs} | Certificações: ${certs} | com roteiro (cod): ${comRoteiro}`);
  console.log(`Por tipo: ${Array.from(byType).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  if (warnings.length) {
    console.log(`\n⚠ ${warnings.length} avisos:`);
    for (const w of warnings.slice(0, 15)) console.log(`   - ${w}`);
    if (warnings.length > 15) console.log(`   ... (+${warnings.length - 15})`);
  }

  if (!doCommit) {
    console.log(`\nDry-run. Para gravar: tsx db/import-providers.ts --commit`);
    return;
  }

  const scriptByCod = await resolveScriptIds();
  const res = await commit(providers, scriptByCod);
  console.log(`\n✔ Gravado: ${res.providers} prestadores, ${res.locations} locais, ${res.certs} certificações.`);
  console.log(`  Roteiros resolvidos (FK eval_script_id): ${res.resolved} de ${comRoteiro} com código.`);
  const { pool } = await import('./db.js');
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add the npm script and register the parser test**

In `package.json`, in `"scripts"`, add after the `"db:import-roteiros"` line:

```json
    "db:import-providers": "tsx db/import-providers.ts",
```

And append `db/providers-parser.test.ts` to the end of the `"test"` command's file list (inside the same string, space-separated), so it becomes:

```
... db/purgeExpiredLogs.test.ts db/providers-parser.test.ts
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS, incluindo os 11 testes de `db/providers-parser.test.ts`.

- [ ] **Step 4: Dry-run against the real file (no DB)**

Run: `npx tsx db/import-providers.ts`
Expected (ordem de grandeza): `Prestadores: 2788 (PJ≈2460, PF≈...)`, `Por tipo: HOSPITAL=..., CLINICA=..., MEDICO=..., LABORATORIO=..., CENTRO DE DIAGNOSTICO=...`, e uma lista de avisos (documentos com tamanho fora do padrão, duplicados, sem razão social). Nenhuma gravação.

- [ ] **Step 5: Commit**

```bash
git add db/import-providers.ts package.json
git commit -m "feat(import): CLI import-providers (dry-run + commit) + npm script"
```

---

### Task 7: Carga real (commit) e verificação end-to-end

**Files:** nenhum (execução/verificação). Requer `DATABASE_URL` e roteiros já importados.

- [ ] **Step 1: Garantir roteiros importados (para resolver a FK)**

Run: `npx tsx db/import-roteiros.ts --commit`
Expected: `✔ gravado` para os 15 roteiros. (Se já importados, reexecuta idempotente.)

- [ ] **Step 2: Executar a carga**

Run: `npx tsx db/import-providers.ts --commit`
Expected: `✔ Gravado: 2788 prestadores, N locais, M certificações.` e `Roteiros resolvidos (FK): R de C com código.`

- [ ] **Step 3: Verificar idempotência (reexecutar não duplica)**

Run:
```bash
npx tsx -e "import('./db/db.js').then(async ({pool})=>{const a=await pool.query('select count(*) from providers');console.log('antes',a.rows[0].count);await pool.end();})"
npx tsx db/import-providers.ts --commit
npx tsx -e "import('./db/db.js').then(async ({pool})=>{const b=await pool.query('select count(*) from providers');console.log('depois',b.rows[0].count);await pool.end();})"
```
Expected: `antes` == `depois` (mesma contagem; reexecução atualiza, não insere duplicado).

- [ ] **Step 4: Verificar vínculo do roteiro e sync run**

Run:
```bash
npx tsx -e "import('./db/db.js').then(async ({pool})=>{const r=await pool.query(\"select p.provider_type, s.source_file, count(*) from providers p join eval_scripts s on s.id=p.eval_script_id group by 1,2 order by 3 desc limit 8\");console.table(r.rows);const run=await pool.query('select source,status,providers_upserted,locations_upserted,message from sgu_sync_runs order by id desc limit 1');console.table(run.rows);await pool.end();})"
```
Expected: prestadores agrupados por tipo apontando para o `source_file` do roteiro correto (ex.: HOSPITAL → `...FOR-024...`), e uma linha `sgu_sync_runs` com `status=success`.

- [ ] **Step 5: Commit (nenhuma mudança de código; passo de validação)**

Não há arquivos a commitar. Registrar no relatório de execução os números obtidos (prestadores, locais, certificações, roteiros resolvidos).

---

## Notas de execução

- **Ambiente:** `DATABASE_URL` deve estar no `.env` (aponta para o Postgres da Railway). Tasks 1-4 (parser) e o dry-run da Task 6 **não** precisam de banco.
- **Ordem:** o vínculo do roteiro (FK) só resolve se os `eval_scripts` já existirem — por isso a Task 7 roda `import-roteiros --commit` antes.
- **Reversão:** a carga é idempotente; para limpar prestadores da carga real use `DELETE FROM providers WHERE source='sgu' AND sgu_code NOT LIKE 'SYN-%'` (cuidado: remove locations/certs por cascade).
