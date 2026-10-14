# Comparação SGU × Portal (fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comando `npm run db:sgu-diff` que compara a `sgu_providers_raw` com o cadastro de prestadores do Portal e grava o relatório em `sgu_sync_runs`, sem alterar o cadastro.

**Architecture:** Um módulo puro `db/sgu-raw.ts` traduz as linhas da raw para o formato que o `parseTabela` já entende (regras de roteiro, PF/PJ e documento ficam num lugar só), classifica afastamento/exclusão e compara com um retrato do Portal (`diffProviders`). O CLI `db/sgu-diff.ts` só faz SELECT no cadastro, chama o módulo puro, imprime o resumo e grava uma linha em `sgu_sync_runs` (migration 0059 adiciona `report jsonb` e `raw_loaded_at`).

**Tech Stack:** TypeScript (tsx), `pg`, `node:test` + `node:assert/strict`, migrations SQL versionadas (`db/migrations/NNNN_*.sql`, runner `npm run db:migrate`).

**Spec:** `docs/superpowers/specs/2026-10-14-sgu-raw-diff-design.md`

## Global Constraints

- **Nenhuma escrita em `providers`, `provider_locations`, `users` ou qualquer tabela de cadastro.** A única escrita é o INSERT em `sgu_sync_runs`.
- Lado Portal = `providers` com `source='sgu'` e suas `provider_locations` com `active = true`. `source='manual'` fica fora (só contagem).
- Raw vazia ou com mais de uma `dh_carga` → aborta com erro (e registra `status='error'`).
- Casamento de unidade pela chave de endereço `cep(só dígitos)|logradouro(maiúsculo, trim)|numero(trim)`.
- Datas de afastamento são `timestamp without time zone` → tratar como data civil `YYYY-MM-DD`.
- Node não está no PATH desta máquina: prefixar todo comando com `export PATH="/c/Program Files/nodejs:$PATH";` (Bash). Testes: `node --import tsx --test <arquivo>`.
- Git no OneDrive: commits no branch `dev`, rodando dentro de `portal-rede-v1-main`.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `db/tabela-parser.ts` | Modificar | `in_medical_guide` passa a ler a coluna opcional `Imprimir no guia médico` (`N` → false; ausente → true, planilha antiga inalterada) |
| `db/tabela-parser.test.ts` | Modificar | teste do `in_medical_guide` |
| `db/sgu-raw.ts` | Criar | puro: `rawToTabelaRows`, `addrKey`, `tipoEnderecoPorChave`, `dataCivil`, `afastamentoPorPrestador`, `diffProviders` e tipos |
| `db/sgu-raw.test.ts` | Criar | testes do módulo puro |
| `db/migrations/0059_sgu_sync_runs_report.sql` | Criar | `report jsonb`, `raw_loaded_at timestamp` em `sgu_sync_runs` |
| `db/sgu-diff.ts` | Criar | CLI: lê raw + Portal, roda o diff, imprime, grava `sgu_sync_runs` |
| `package.json` | Modificar | script `db:sgu-diff`; `db/sgu-raw.test.ts` na suíte `test` |

Desvio consciente do spec: `diffProviders` fica em `db/sgu-raw.ts` (puro) e não em `db/sgu-diff.ts`, para o teste não importar o pool do banco. O teste "cadastro manual ignorado" vira filtro SQL do CLI (`source='sgu'`), conferido na validação real.

---

### Task 1: `in_medical_guide` vindo da coluna "Imprimir no guia médico"

**Files:**
- Modify: `db/tabela-parser.ts` (bloco `acc.addrs.set(key, {...})`, linha `in_medical_guide: true,`)
- Test: `db/tabela-parser.test.ts`

**Interfaces:**
- Produces: `parseTabela` aceita a chave opcional `'Imprimir no guia médico'` na `TabelaRow`; `'N'` → `in_medical_guide: false`; qualquer outro valor ou ausente → `true`.

- [ ] **Step 1: Write the failing test** — acrescentar ao fim de `db/tabela-parser.test.ts`:

```ts
test('Imprimir no guia médico = N desmarca a unidade do guia; ausente mantém no guia', () => {
  const fora = parseTabela([row({ 'Imprimir no guia médico': 'N' })]).providers[0];
  assert.equal(fora.locations[0].in_medical_guide, false);
  const semColuna = parseTabela([row()]).providers[0];
  assert.equal(semColuna.locations[0].in_medical_guide, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test db/tabela-parser.test.ts`
Expected: FAIL — `false !== true` no primeiro assert.

- [ ] **Step 3: Write minimal implementation** — em `db/tabela-parser.ts`, trocar `in_medical_guide: true,` por:

```ts
        in_medical_guide: clean(r['Imprimir no guia médico']).toUpperCase() !== 'N',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test db/tabela-parser.test.ts db/import-tabela.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add db/tabela-parser.ts db/tabela-parser.test.ts
git commit -m "feat(prestadores): parser lê 'Imprimir no guia médico' (N tira a unidade do guia)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Tradução da raw e classificação de afastamento (`db/sgu-raw.ts`, parte 1)

**Files:**
- Create: `db/sgu-raw.ts`
- Create: `db/sgu-raw.test.ts`

**Interfaces:**
- Consumes: `clean`, `onlyDigits` de `db/providers-parser.ts`; `parseTabela`, `TabelaRow` de `db/tabela-parser.ts`.
- Produces:
  - `type SguRawRow = Record<string, unknown>`
  - `rawToTabelaRows(rows: SguRawRow[]): TabelaRow[]`
  - `addrKey(cep: unknown, logradouro: unknown, numero: unknown): string`
  - `tipoEnderecoPorChave(rows: SguRawRow[]): Map<string, string>` — chave `` `${codigo_prestador}#${addrKey}` `` → `codigo_tipo_endereco`
  - `dataCivil(v: unknown): string | null` — `Date` (horário local) ou string → `'YYYY-MM-DD'`
  - `type SituacaoAfastamento = 'nenhum' | 'vigente' | 'exclusao_agendada' | 'afastamento_encerrado' | 'inconsistente'`
  - `interface Afastamento { operacao: string | null; inicio: string | null; fim: string | null; codigo_motivo: string | null; motivo: string | null; situacao: SituacaoAfastamento }`
  - `afastamentoPorPrestador(rows: SguRawRow[], hoje: string): Map<string, Afastamento>`

- [ ] **Step 1: Write the failing test** — criar `db/sgu-raw.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTabela } from './tabela-parser.js';
import {
  rawToTabelaRows, addrKey, tipoEnderecoPorChave, dataCivil, afastamentoPorPrestador,
  type SguRawRow,
} from './sgu-raw.js';

const HOJE = '2026-10-14';

export function raw(over: Record<string, unknown> = {}): SguRawRow {
  return {
    codigo_prestador: '1000546', nome_prestador: 'SERGIO LUIZ BORTOLUZZI', nome_fantasia: null,
    status_prestador: 'ATIVO', grupo_prestador: '1 - MEDICOS COOPERADOS', tipo_prestador: '1 - MÉDICO',
    numero_documento: '352470968', numero_conselho_regional: 546,
    especialidade_grupo_servico: 'ANESTESIOLOGIA', nome_responsavel_tecnico: null,
    codigo_tipo_endereco: '2', tipo_endereco: 'COMERCIAL', cep: '88801250',
    logradouro: 'RUA CORONEL PEDRO BENEDET', numero_endereco: '505', complemento_endereco: 'SALA 609',
    bairro: 'CENTRO', cidade: 'CRICIUMA', uf_endereco: 'SC', telefone: '(48)30452678', celular: null,
    email_principal: null, imprimir_no_guia_medico: 'S',
    tipo_operacao_afastamento_exclusao: null, data_inicio_afastamento_exclusao: null,
    data_fim_afastamento_exclusao: null, codigo_motivo_afastamento_exclusao: null,
    motivo_afastamento_exclusao: null, dh_carga: new Date(2026, 9, 13, 21, 0),
    ...over,
  };
}

test('raw traduzida passa pelo parseTabela: PF, CPF, CRM, especialidades agregadas, guia', () => {
  const rows = [raw(), raw({ especialidade_grupo_servico: 'CLINICA MEDICA', imprimir_no_guia_medico: 'N' })];
  const [p] = parseTabela(rawToTabelaRows(rows)).providers;
  assert.equal(p.sgu_code, '1000546');
  assert.equal(p.person_type, 'PF');
  assert.equal(p.cpf, '00352470968');
  assert.equal(p.council_registry, '546');
  assert.equal(p.status, 'ativo');
  assert.equal(p.provider_group, 'MEDICOS COOPERADOS');
  assert.deepEqual(p.specialties, ['ANESTESIOLOGIA', 'CLINICA MEDICA']);
  assert.equal(p.locations.length, 1);
  assert.equal(p.locations[0].in_medical_guide, true); // 1ª linha do endereço decide
  assert.equal(p.locations[0].complemento, 'SALA 609');
});

test('addrKey normaliza CEP, caixa e espaços', () => {
  assert.equal(addrKey('88801-250', ' rua  x ', ' 5 '), '88801250|RUA X|5');
});

test('tipoEnderecoPorChave liga prestador+endereço ao codigo_tipo_endereco', () => {
  const m = tipoEnderecoPorChave([raw(), raw({ codigo_tipo_endereco: '3', logradouro: 'RUA B', numero_endereco: '10' })]);
  assert.equal(m.get(`1000546#${addrKey('88801250', 'RUA CORONEL PEDRO BENEDET', '505')}`), '2');
  assert.equal(m.get(`1000546#${addrKey('88801250', 'RUA B', '10')}`), '3');
});

test('dataCivil usa a data local de Date e o prefixo de string', () => {
  assert.equal(dataCivil(new Date(2026, 10, 1)), '2026-11-01');
  assert.equal(dataCivil('2022-10-05 00:00:00'), '2022-10-05');
  assert.equal(dataCivil(null), null);
});

test('afastamentoPorPrestador classifica as cinco situações', () => {
  const rows = [
    raw({ codigo_prestador: '1' }),
    raw({ codigo_prestador: '2', status_prestador: 'AFASTADO', tipo_operacao_afastamento_exclusao: 'AFASTAMENTO',
          data_inicio_afastamento_exclusao: new Date(2026, 0, 28), motivo_afastamento_exclusao: 'AFASTADO',
          codigo_motivo_afastamento_exclusao: 7 }),
    raw({ codigo_prestador: '3', tipo_operacao_afastamento_exclusao: 'EXCLUSAO',
          data_inicio_afastamento_exclusao: new Date(2026, 10, 1) }),
    raw({ codigo_prestador: '4', tipo_operacao_afastamento_exclusao: 'AFASTAMENTO',
          data_inicio_afastamento_exclusao: new Date(2019, 10, 29), data_fim_afastamento_exclusao: new Date(2020, 1, 1) }),
    raw({ codigo_prestador: '5', status_prestador: 'EXCLUÍDO', tipo_operacao_afastamento_exclusao: 'EXCLUSAO',
          data_inicio_afastamento_exclusao: new Date(2024, 5, 1), motivo_afastamento_exclusao: 'FALECEU' }),
    raw({ codigo_prestador: '6', tipo_operacao_afastamento_exclusao: 'EXCLUSAO',
          data_inicio_afastamento_exclusao: new Date(2024, 5, 1) }),
  ];
  const m = afastamentoPorPrestador(rows, HOJE);
  assert.equal(m.get('1')!.situacao, 'nenhum');
  assert.deepEqual(m.get('2'), {
    operacao: 'AFASTAMENTO', inicio: '2026-01-28', fim: null, codigo_motivo: '7', motivo: 'AFASTADO', situacao: 'vigente',
  });
  assert.equal(m.get('3')!.situacao, 'exclusao_agendada');
  assert.equal(m.get('4')!.situacao, 'afastamento_encerrado');
  assert.equal(m.get('5')!.situacao, 'vigente');
  assert.equal(m.get('6')!.situacao, 'inconsistente'); // ATIVO com exclusão já passada
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test db/sgu-raw.test.ts`
Expected: FAIL — `Cannot find module './sgu-raw.js'`.

- [ ] **Step 3: Write minimal implementation** — criar `db/sgu-raw.ts`:

```ts
// Leitura da sgu_providers_raw (extração do SGU carregada pela Unimed no banco do Portal)
// e comparação com o cadastro de prestadores. Puro, sem banco — o CLI é db/sgu-diff.ts.
import { clean, onlyDigits } from './providers-parser.js';
import { type TabelaRow } from './tabela-parser.js';

export type SguRawRow = Record<string, unknown>;

// Coluna da planilha (o que o parseTabela lê) ← coluna da raw.
const COLUNAS: Record<string, string> = {
  'Código do prestador': 'codigo_prestador',
  'Nome do prestador': 'nome_prestador',
  'Nome Fantasia': 'nome_fantasia',
  CRM: 'numero_conselho_regional',
  'Situação do prestador': 'status_prestador',
  'Número do CPF e/ou CNJP': 'numero_documento',
  'Tipo de prestador': 'tipo_prestador',
  'Grupo do Prestador': 'grupo_prestador',
  'Especialidades/Gr Serv': 'especialidade_grupo_servico',
  'Nome Responsavel Técnico': 'nome_responsavel_tecnico',
  Logradouro: 'logradouro',
  'Número': 'numero_endereco',
  Complemento: 'complemento_endereco',
  Bairro: 'bairro',
  CEP: 'cep',
  Cidade: 'cidade',
  UF: 'uf_endereco',
  Telefone: 'telefone',
  Celular: 'celular',
  'E-mail': 'email_principal',
  'Tipo de Endereço': 'tipo_endereco',
  'Imprimir no guia médico': 'imprimir_no_guia_medico',
};

export function rawToTabelaRows(rows: SguRawRow[]): TabelaRow[] {
  return rows.map((r) =>
    Object.fromEntries(Object.entries(COLUNAS).map(([planilha, col]) => [planilha, r[col] ?? null])));
}

export const addrKey = (cep: unknown, logradouro: unknown, numero: unknown): string =>
  `${onlyDigits(cep)}|${clean(logradouro).toUpperCase()}|${clean(numero)}`;

export function tipoEnderecoPorChave(rows: SguRawRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    const k = `${clean(r.codigo_prestador)}#${addrKey(r.cep, r.logradouro, r.numero_endereco)}`;
    if (!m.has(k)) m.set(k, clean(r.codigo_tipo_endereco));
  }
  return m;
}

// Coluna é timestamp without time zone: o pg devolve Date no horário local.
export function dataCivil(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m ? m[1] : null;
}

export type SituacaoAfastamento =
  'nenhum' | 'vigente' | 'exclusao_agendada' | 'afastamento_encerrado' | 'inconsistente';

export interface Afastamento {
  operacao: string | null;
  inicio: string | null;
  fim: string | null;
  codigo_motivo: string | null;
  motivo: string | null;
  situacao: SituacaoAfastamento;
}

export function afastamentoPorPrestador(rows: SguRawRow[], hoje: string): Map<string, Afastamento> {
  const out = new Map<string, Afastamento>();
  for (const r of rows) {
    const code = clean(r.codigo_prestador);
    if (!code || out.has(code)) continue;
    const status = clean(r.status_prestador).toUpperCase();
    const operacao = clean(r.tipo_operacao_afastamento_exclusao).toUpperCase() || null;
    const inicio = dataCivil(r.data_inicio_afastamento_exclusao);
    const fim = dataCivil(r.data_fim_afastamento_exclusao);
    let situacao: SituacaoAfastamento;
    if (!operacao) situacao = 'nenhum';
    else if (status === 'ATIVO' && operacao === 'EXCLUSAO' && inicio && inicio > hoje) situacao = 'exclusao_agendada';
    else if (status === 'ATIVO' && operacao === 'AFASTAMENTO' && fim && fim <= hoje) situacao = 'afastamento_encerrado';
    else if ((status === 'AFASTADO' && operacao === 'AFASTAMENTO')
          || (status.startsWith('EXCLU') && operacao === 'EXCLUSAO')) situacao = 'vigente';
    else situacao = 'inconsistente';
    out.set(code, {
      operacao, inicio, fim,
      codigo_motivo: clean(r.codigo_motivo_afastamento_exclusao) || null,
      motivo: clean(r.motivo_afastamento_exclusao) || null,
      situacao,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test db/sgu-raw.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add db/sgu-raw.ts db/sgu-raw.test.ts
git commit -m "feat(sgu): tradução da sgu_providers_raw e classificação de afastamento/exclusão

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `diffProviders` (`db/sgu-raw.ts`, parte 2)

**Files:**
- Modify: `db/sgu-raw.ts` (acrescentar ao fim; trocar o import de `tabela-parser`)
- Test: `db/sgu-raw.test.ts` (acrescentar)

**Interfaces:**
- Consumes: tudo da Task 2; `parseTabela`, `TabelaProvider` de `db/tabela-parser.ts`; `ParsedLocation` de `db/providers-parser.ts`.
- Produces:
  - `interface PortalLocation { cep, logradouro, numero, complemento, bairro, cidade, uf, phone, email: string | null; in_medical_guide: boolean }`
  - `interface PortalProvider { sgu_code: string; name: string; trade_name, cnpj, cpf, status, provider_type, provider_group, responsavel_tecnico, roteiro_cod: string | null; specialties: string[]; tem_avaliacao: boolean; locations: PortalLocation[] }`
  - `interface CampoDiff { campo: string; portal: unknown; sgu: unknown }`
  - `interface DiffReport { novos; ausentes; alterados; unidades; afastamentos; avisos: string[] }` (forma completa no código)
  - `diffProviders(raw: SguRawRow[], portal: PortalProvider[], hoje: string): DiffReport`

- [ ] **Step 1: Write the failing test** — acrescentar a `db/sgu-raw.test.ts` (e incluir `diffProviders, type PortalProvider` no import de `./sgu-raw.js`):

```ts
// Retrato do Portal idêntico ao que a raw geraria — base "sem diferença".
function portalDe(rows: SguRawRow[], extra: Partial<PortalProvider> = {}): PortalProvider[] {
  return parseTabela(rawToTabelaRows(rows)).providers.map((s) => ({
    sgu_code: s.sgu_code, name: s.name, trade_name: s.trade_name, cnpj: s.cnpj, cpf: s.cpf,
    status: s.status, provider_type: s.provider_type, provider_group: s.provider_group,
    specialties: s.specialties, responsavel_tecnico: s.responsavel_tecnico, roteiro_cod: s.roteiro_cod,
    tem_avaliacao: false,
    locations: s.locations.map(({ cep, logradouro, numero, complemento, bairro, cidade, uf, phone, email, in_medical_guide }) =>
      ({ cep, logradouro, numero, complemento, bairro, cidade, uf, phone, email, in_medical_guide })),
    ...extra,
  }));
}

test('diff: mesma base não gera diferença', () => {
  const r = diffProviders([raw()], portalDe([raw()]), HOJE);
  assert.deepEqual([r.novos, r.ausentes, r.alterados, r.unidades, r.afastamentos], [[], [], [], [], []]);
});

test('diff: novo e ausente (com avaliação)', () => {
  const r = diffProviders(
    [raw(), raw({ codigo_prestador: '2000001', nome_prestador: 'NOVO', status_prestador: 'EXCLUÍDO' })],
    [...portalDe([raw()]), ...portalDe([raw({ codigo_prestador: '3000001', nome_prestador: 'SUMIU' })], { tem_avaliacao: true })],
    HOJE);
  assert.deepEqual(r.novos.map((n) => [n.sgu_code, n.status]), [['2000001', 'excluído']]);
  assert.deepEqual(r.ausentes, [{ sgu_code: '3000001', name: 'SUMIU', status: 'ativo', tem_avaliacao: true }]);
});

test('diff: campo alterado aparece com antes/depois; especialidades reordenadas e caixa não contam', () => {
  const rows = [raw(), raw({ especialidade_grupo_servico: 'CLINICA MEDICA' })];
  const [p] = portalDe(rows, { name: 'Sergio Luiz Bortoluzzi', specialties: ['CLINICA MEDICA', 'ANESTESIOLOGIA'], status: 'afastado' });
  const r = diffProviders(rows, [p], HOJE);
  assert.deepEqual(r.alterados, [{
    sgu_code: '1000546', name: 'SERGIO LUIZ BORTOLUZZI',
    campos: [{ campo: 'status', portal: 'afastado', sgu: 'ativo' }],
  }]);
});

test('diff: unidade nova (com codigo_tipo_endereco), removida e alterada', () => {
  const rows = [raw({ email_principal: 'novo@x.com' }),
    raw({ codigo_tipo_endereco: '3', logradouro: 'RUA B', numero_endereco: '10' })];
  const [p] = portalDe([raw({ email_principal: 'antigo@x.com' })]);
  p.locations.push({ ...p.locations[0], logradouro: 'RUA VELHA', numero: '1' });
  const r = diffProviders(rows, [p], HOJE);
  assert.equal(r.unidades.length, 1);
  const u = r.unidades[0];
  assert.deepEqual(u.novas.map((l) => [l.logradouro, l.codigo_tipo_endereco]), [['RUA B', '3']]);
  assert.deepEqual(u.removidas.map((l) => l.logradouro), ['RUA VELHA']);
  assert.deepEqual(u.alteradas.map((a) => a.campos), [[{ campo: 'email', portal: 'antigo@x.com', sgu: 'novo@x.com' }]]);
  assert.equal(u.alteradas[0].codigo_tipo_endereco, '2');
});

test('diff: afastamentos só de quem está no Portal e com situação diferente de nenhum', () => {
  const afastado = raw({ status_prestador: 'AFASTADO', tipo_operacao_afastamento_exclusao: 'AFASTAMENTO',
    data_inicio_afastamento_exclusao: new Date(2026, 0, 28) });
  const agendado = raw({ codigo_prestador: '7', tipo_operacao_afastamento_exclusao: 'EXCLUSAO',
    data_inicio_afastamento_exclusao: new Date(2026, 10, 1) });
  const r = diffProviders([afastado, agendado, raw({ codigo_prestador: '8' })],
    portalDe([afastado, agendado, raw({ codigo_prestador: '8' })]), HOJE);
  assert.deepEqual(r.afastamentos.map((a) => [a.sgu_code, a.situacao]), [['1000546', 'vigente'], ['7', 'exclusao_agendada']]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test db/sgu-raw.test.ts`
Expected: FAIL — `diffProviders` não exportado (SyntaxError no import).

- [ ] **Step 3: Write minimal implementation** — em `db/sgu-raw.ts`, trocar as duas linhas de import do topo por:

```ts
import { clean, onlyDigits, type ParsedLocation } from './providers-parser.js';
import { parseTabela, type TabelaProvider, type TabelaRow } from './tabela-parser.js';
```

e acrescentar ao fim do arquivo:

```ts
export interface PortalLocation {
  cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null;
  bairro: string | null; cidade: string | null; uf: string | null; phone: string | null; email: string | null;
  in_medical_guide: boolean;
}

export interface PortalProvider {
  sgu_code: string; name: string; trade_name: string | null; cnpj: string | null; cpf: string | null;
  status: string | null; provider_type: string | null; provider_group: string | null;
  specialties: string[]; responsavel_tecnico: string | null; roteiro_cod: string | null;
  tem_avaliacao: boolean; locations: PortalLocation[];
}

export interface CampoDiff { campo: string; portal: unknown; sgu: unknown }

export interface DiffReport {
  novos: { sgu_code: string; name: string; status: string; provider_group: string | null;
           roteiro_cod: string | null; unidades: number; afastamento: Afastamento | null }[];
  ausentes: { sgu_code: string; name: string; status: string | null; tem_avaliacao: boolean }[];
  alterados: { sgu_code: string; name: string; campos: CampoDiff[] }[];
  unidades: { sgu_code: string; name: string;
              novas: (PortalLocation & { codigo_tipo_endereco: string | null })[];
              removidas: PortalLocation[];
              alteradas: { endereco: string; codigo_tipo_endereco: string | null; campos: CampoDiff[] }[] }[];
  afastamentos: ({ sgu_code: string; name: string } & Afastamento)[];
  avisos: string[];
}

const txt = (v: unknown) => clean(v).toUpperCase();
const mesmoTexto = (a: unknown, b: unknown) => txt(a) === txt(b);
const mesmosDigitos = (a: unknown, b: unknown) => onlyDigits(a) === onlyDigits(b);
const mesmoConjunto = (a: unknown, b: unknown) => {
  const n = (x: unknown) => [...new Set((x as string[] ?? []).map(txt).filter(Boolean))].sort().join('|');
  return n(a) === n(b);
};

type Campo = [string, (p: PortalProvider) => unknown, (s: TabelaProvider) => unknown, (a: unknown, b: unknown) => boolean];
const CAMPOS: Campo[] = [
  ['name', (p) => p.name, (s) => s.name, mesmoTexto],
  ['trade_name', (p) => p.trade_name, (s) => s.trade_name, mesmoTexto],
  ['cnpj', (p) => p.cnpj, (s) => s.cnpj, mesmosDigitos],
  ['cpf', (p) => p.cpf, (s) => s.cpf, mesmosDigitos],
  ['status', (p) => p.status, (s) => s.status, mesmoTexto],
  ['provider_type', (p) => p.provider_type, (s) => s.provider_type, mesmoTexto],
  ['provider_group', (p) => p.provider_group, (s) => s.provider_group, mesmoTexto],
  ['specialties', (p) => p.specialties, (s) => s.specialties, mesmoConjunto],
  ['responsavel_tecnico', (p) => p.responsavel_tecnico, (s) => s.responsavel_tecnico, mesmoTexto],
  ['roteiro_cod', (p) => p.roteiro_cod, (s) => s.roteiro_cod, mesmoTexto],
];

const CAMPOS_UNIDADE = ['complemento', 'bairro', 'cidade', 'uf', 'phone', 'email'] as const;

const unidade = (l: ParsedLocation): PortalLocation => ({
  cep: l.cep, logradouro: l.logradouro, numero: l.numero, complemento: l.complemento, bairro: l.bairro,
  cidade: l.cidade, uf: l.uf, phone: l.phone, email: l.email, in_medical_guide: l.in_medical_guide,
});

export function diffProviders(raw: SguRawRow[], portal: PortalProvider[], hoje: string): DiffReport {
  const { providers: sgu, warnings } = parseTabela(rawToTabelaRows(raw));
  const afast = afastamentoPorPrestador(raw, hoje);
  const tipos = tipoEnderecoPorChave(raw);
  const doPortal = new Map(portal.map((p) => [p.sgu_code, p]));
  const doSgu = new Set(sgu.map((s) => s.sgu_code));
  const r: DiffReport = { novos: [], ausentes: [], alterados: [], unidades: [], afastamentos: [], avisos: warnings };

  for (const s of sgu) {
    const a = afast.get(s.sgu_code) ?? null;
    const p = doPortal.get(s.sgu_code);
    if (!p) {
      r.novos.push({ sgu_code: s.sgu_code, name: s.name, status: s.status, provider_group: s.provider_group,
                     roteiro_cod: s.roteiro_cod, unidades: s.locations.length, afastamento: a });
      continue;
    }

    const campos = CAMPOS.filter(([, gp, gs, igual]) => !igual(gp(p), gs(s)))
      .map(([campo, gp, gs]) => ({ campo, portal: gp(p), sgu: gs(s) }));
    if (campos.length) r.alterados.push({ sgu_code: s.sgu_code, name: s.name, campos });

    const lp = new Map(p.locations.map((l) => [addrKey(l.cep, l.logradouro, l.numero), l]));
    const ls = new Map(s.locations.map((l) => [addrKey(l.cep, l.logradouro, l.numero), unidade(l)]));
    const tipo = (k: string) => tipos.get(`${s.sgu_code}#${k}`) ?? null;
    const novas = [...ls].filter(([k]) => !lp.has(k)).map(([k, l]) => ({ ...l, codigo_tipo_endereco: tipo(k) }));
    const removidas = [...lp].filter(([k]) => !ls.has(k)).map(([, l]) => l);
    const alteradas = [...ls].filter(([k]) => lp.has(k)).map(([k, l]) => {
      const antes = lp.get(k)!;
      const c: CampoDiff[] = CAMPOS_UNIDADE.filter((f) => !mesmoTexto(antes[f], l[f]))
        .map((f) => ({ campo: f, portal: antes[f], sgu: l[f] }));
      if (antes.in_medical_guide !== l.in_medical_guide) {
        c.push({ campo: 'in_medical_guide', portal: antes.in_medical_guide, sgu: l.in_medical_guide });
      }
      return { endereco: k, codigo_tipo_endereco: tipo(k), campos: c };
    }).filter((x) => x.campos.length);
    if (novas.length || removidas.length || alteradas.length) {
      r.unidades.push({ sgu_code: s.sgu_code, name: s.name, novas, removidas, alteradas });
    }

    if (a && a.situacao !== 'nenhum') r.afastamentos.push({ sgu_code: s.sgu_code, name: s.name, ...a });
  }

  for (const p of portal) {
    if (!doSgu.has(p.sgu_code)) {
      r.ausentes.push({ sgu_code: p.sgu_code, name: p.name, status: p.status, tem_avaliacao: p.tem_avaliacao });
    }
  }
  return r;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test db/sgu-raw.test.ts db/tabela-parser.test.ts`
Expected: PASS (10 testes em sgu-raw + os do parser).

- [ ] **Step 5: Commit**

```bash
git add db/sgu-raw.ts db/sgu-raw.test.ts
git commit -m "feat(sgu): diffProviders compara a raw com o cadastro do Portal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Migration 0059 + CLI `db:sgu-diff` + validação no dev

**Files:**
- Create: `db/migrations/0059_sgu_sync_runs_report.sql`
- Create: `db/sgu-diff.ts`
- Modify: `package.json` (`scripts`)

**Interfaces:**
- Consumes: `diffProviders`, `dataCivil`, `PortalProvider`, `SguRawRow`, `DiffReport` de `db/sgu-raw.ts`; `query`, `pool` de `db/db.ts`; `pickDatabaseUrl` de `db/resolveDbUrl.ts`.
- Produces: `npm run db:sgu-diff`; linhas `sgu_sync_runs` com `source='sgu-raw-diff'`.

- [ ] **Step 1: Migration** — criar `db/migrations/0059_sgu_sync_runs_report.sql`:

```sql
-- 0059_sgu_sync_runs_report.sql
-- Comparação diária sgu_providers_raw × cadastro (spec 2026-10-14): cada execução
-- guarda o relatório completo e a dh_carga da raw comparada.
ALTER TABLE sgu_sync_runs ADD COLUMN IF NOT EXISTS report jsonb;
ALTER TABLE sgu_sync_runs ADD COLUMN IF NOT EXISTS raw_loaded_at timestamp;
```

- [ ] **Step 2: Aplicar no dev** (conferir que o host é `reseau.proxy.rlwy.net`)

Run: `export PATH="/c/Program Files/nodejs:$PATH"; APP_ENV=dev npm run db:migrate`
Expected: saída lista `0059_sgu_sync_runs_report.sql` aplicada, sem erro.

- [ ] **Step 3: CLI** — criar `db/sgu-diff.ts`:

```ts
/**
 * Compara a sgu_providers_raw (extração do SGU) com o cadastro de prestadores do Portal.
 * Só lê o cadastro; a única escrita é o registro da execução em sgu_sync_runs.
 *   APP_ENV=dev npx tsx db/sgu-diff.ts
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import { query, pool } from './db.js';
import { diffProviders, dataCivil, type DiffReport, type PortalProvider, type SguRawRow } from './sgu-raw.js';

const LISTA = 15;

async function lerPortal(): Promise<PortalProvider[]> {
  const { rows } = await query<PortalProvider>(`
    SELECT p.sgu_code, p.name, p.trade_name, p.cnpj, p.cpf, p.status, p.provider_type, p.provider_group,
           p.specialties, p.responsavel_tecnico, p.roteiro_cod,
           EXISTS (SELECT 1 FROM eval_instances e WHERE e.provider_id = p.id) AS tem_avaliacao,
           COALESCE((
             SELECT json_agg(json_build_object(
                      'cep', l.cep, 'logradouro', l.logradouro, 'numero', l.numero,
                      'complemento', l.complemento, 'bairro', l.bairro, 'cidade', l.cidade, 'uf', l.uf,
                      'phone', l.phone, 'email', l.email, 'in_medical_guide', l.in_medical_guide)
                    ORDER BY l.id)
               FROM provider_locations l
              WHERE l.provider_id = p.id AND l.active), '[]'::json) AS locations
      FROM providers p
     WHERE p.source = 'sgu'`);
  return rows;
}

function imprimir(r: DiffReport, manuais: number) {
  const porStatus = (xs: { status: string | null }[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x.status ?? '(vazio)', (m.get(x.status ?? '(vazio)') ?? 0) + 1);
    return [...m].map(([k, v]) => `${k}=${v}`).join(', ') || '0';
  };
  const lista = <T>(titulo: string, xs: T[], fmt: (x: T) => string, todos = false) => {
    console.log(`\n${titulo}: ${xs.length}`);
    for (const x of todos ? xs : xs.slice(0, LISTA)) console.log(`   - ${fmt(x)}`);
    if (!todos && xs.length > LISTA) console.log(`   ... (+${xs.length - LISTA})`);
  };

  console.log(`\nNovos (na raw, fora do Portal): ${r.novos.length} [${porStatus(r.novos)}]`);
  for (const n of r.novos.filter((x) => !x.status.startsWith('exclu')).slice(0, LISTA)) {
    console.log(`   - ${n.sgu_code} ${n.name} (${n.status}, ${n.provider_group ?? '-'}, roteiro ${n.roteiro_cod ?? 'A DEFINIR'}, ${n.unidades} unid.)`);
  }
  lista('Ausentes (no Portal, fora da raw)', r.ausentes,
    (a) => `${a.sgu_code} ${a.name} (${a.status ?? '-'})${a.tem_avaliacao ? ' — TEM AVALIAÇÃO' : ''}`);
  console.log(`   com avaliação: ${r.ausentes.filter((a) => a.tem_avaliacao).length}`);
  lista('Alterados', r.alterados,
    (a) => `${a.sgu_code} ${a.name}: ${a.campos.map((c) => `${c.campo} ${JSON.stringify(c.portal)} → ${JSON.stringify(c.sgu)}`).join('; ')}`);
  const tot = (k: 'novas' | 'removidas' | 'alteradas') => r.unidades.reduce((s, u) => s + u[k].length, 0);
  lista(`Prestadores com mudança de unidade (novas ${tot('novas')}, removidas ${tot('removidas')}, alteradas ${tot('alteradas')})`,
    r.unidades, (u) => `${u.sgu_code} ${u.name}: +${u.novas.length} −${u.removidas.length} ~${u.alteradas.length}`);
  lista('Exclusões agendadas (ATIVO com exclusão futura)', r.afastamentos.filter((a) => a.situacao === 'exclusao_agendada'),
    (a) => `${a.sgu_code} ${a.name}: exclusão em ${a.inicio} (${a.motivo ?? 'sem motivo'})`, true);
  lista('Afastamento/exclusão (demais)', r.afastamentos.filter((a) => a.situacao !== 'exclusao_agendada'),
    (a) => `${a.sgu_code} ${a.name}: ${a.situacao} — ${a.operacao} ${a.inicio ?? ''}${a.fim ? ` a ${a.fim}` : ''} (${a.motivo ?? 'sem motivo'})`);
  console.log(`\nCadastros manuais fora da comparação: ${manuais} | avisos do parser: ${r.avisos.length}`);
}

async function main() {
  const url = pickDatabaseUrl();
  console.log(`APP_ENV=${process.env.APP_ENV ?? '(vazio)'} | banco: ${url ? new URL(url).host : '(vazio)'}`);
  try {
    const { rows: raw } = await query<SguRawRow>('SELECT * FROM sgu_providers_raw');
    if (!raw.length) throw new Error('sgu_providers_raw está vazia — nada a comparar.');
    const cargas = new Set(raw.map((r) => (r.dh_carga instanceof Date ? r.dh_carga.getTime() : String(r.dh_carga))));
    if (cargas.size > 1) throw new Error(`sgu_providers_raw tem ${cargas.size} cargas (dh_carga) misturadas — comparação abortada.`);
    const dhCarga = raw[0].dh_carga;
    console.log(`Raw: ${raw.length} linhas, carga de ${dhCarga instanceof Date ? dhCarga.toLocaleString('pt-BR') : dhCarga}`);

    const portal = await lerPortal();
    const { rows: [{ n: manuais }] } = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM providers WHERE source IS DISTINCT FROM 'sgu'`);
    const report = diffProviders(raw, portal, dataCivil(new Date())!);
    imprimir(report, manuais);

    const message = `novos ${report.novos.length}, ausentes ${report.ausentes.length}, alterados ${report.alterados.length}, `
      + `unidades ${report.unidades.length}, afastamentos ${report.afastamentos.length}`;
    await query(
      `INSERT INTO sgu_sync_runs (source, status, message, raw_loaded_at, report, finished_at)
       VALUES ('sgu-raw-diff', 'success', $1, $2, $3, now())`,
      [message, dhCarga, JSON.stringify({ ...report, manuais })]);
    console.log(`\n✔ Registrado em sgu_sync_runs: ${message}`);
  } catch (err: any) {
    await query(
      `INSERT INTO sgu_sync_runs (source, status, message, finished_at) VALUES ('sgu-raw-diff', 'error', $1, now())`,
      [String(err?.message ?? err)]).catch(() => {});
    throw err;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Scripts** — em `package.json`, logo após `"db:import-tabela": "tsx db/import-tabela.ts",` acrescentar:

```json
    "db:sgu-diff": "tsx db/sgu-diff.ts",
```

e, no script `"test"`, acrescentar ` db/sgu-raw.test.ts` logo após `db/tabela-parser.test.ts`.

- [ ] **Step 5: Suíte e checagem de tipos**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npm test 2>&1 | tail -5; npx tsc --noEmit -p . 2>&1 | grep -E "sgu-(raw|diff)" ; echo "tsc-ok"`
Expected: `# fail 0`; nenhuma linha de erro citando `sgu-raw`/`sgu-diff` antes de `tsc-ok`.

- [ ] **Step 6: Validação real no dev**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; APP_ENV=dev npm run db:sgu-diff`
Expected (levantamento de 14/10 no dev; pequenas variações só se a raw tiver sido recarregada — conferir `dh_carga` impresso):
- banco `reseau.proxy.rlwy.net:35128`
- Novos: 310 `[ativo=15, excluído=295]`
- Ausentes: 89, com avaliação: 88
- Unidades removidas no total ≈ 14 (das 646 ativas, 632 casam pelo endereço)
- Exclusões agendadas: 2 (exclusão em 2026-11-01)
- Última linha `✔ Registrado em sgu_sync_runs`

Se algum número divergir muito, parar e investigar antes do commit (ex.: diferença de caixa/espaço na chave de endereço).

- [ ] **Step 7: Conferir o registro**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; APP_ENV=dev npx tsx -e "import('./db/db.js').then(async ({query,pool})=>{const {rows}=await query(\"SELECT id,status,raw_loaded_at,message,jsonb_array_length(report->'ausentes') AS ausentes FROM sgu_sync_runs WHERE source='sgu-raw-diff' ORDER BY id DESC LIMIT 1\");console.log(rows);await pool.end();})"`
Expected: 1 linha `status: 'success'`, `ausentes: 89`, `raw_loaded_at` = a `dh_carga` da raw.

- [ ] **Step 8: Commit**

```bash
git add db/migrations/0059_sgu_sync_runs_report.sql db/sgu-diff.ts package.json
git commit -m "feat(sgu): comando db:sgu-diff compara a sgu_providers_raw com o cadastro (0059)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Promoção (fora das tasks)

Homolog: push `origin/dev:refs/heads/homolog` aplica a 0059 no boot; depois `APP_ENV=homolog npm run db:sgu-diff`. Prod: a `sgu_providers_raw` não foi verificada lá — a Katy confere antes de rodar.
