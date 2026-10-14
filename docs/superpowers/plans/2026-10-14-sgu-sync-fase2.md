# Rotina diária SGU → cadastro (fase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar a `sgu_providers_raw` no cadastro de prestadores todo dia após a carga, com código de unidade estável, limpeza única dos ausentes, suspensão de avaliações de inativos e sem nunca alterar usuários existentes.

**Architecture:** Planejamento puro (`db/sgu-sync-plan.ts`: `planejarSync`, `checarTravas`, `planejarRekey`) sobre o parser já existente (`ordenaRaw` + `parseTabela`); gravação em `db/sgu-sync.ts` (`executarPlano`, `suspenderERestaurar`, `rodarSguSync` + CLI) numa transação com advisory lock; comandos únicos `db/sgu-rekey.ts` e `db/sgu-purge-ausentes.ts`; job de 30 min no `server.ts` ligado por `SGU_SYNC_ENABLED`; status de avaliação novo `suspensa` tratado no servidor e nas telas.

**Tech Stack:** TypeScript (tsx), `pg`, `node:test` + `node:assert/strict`, React (Vite), migrations SQL versionadas.

**Spec:** `docs/superpowers/specs/2026-10-14-sgu-sync-fase2-design.md`

## Global Constraints

- **A rotina nunca executa UPDATE nem DELETE em `users` ou `user_locations`.** Só INSERT do acesso de unidade nova. (Única exceção: `db:sgu-purge-ausentes`, comando único.)
- Prestador **ativo** = `(p.source IS DISTINCT FROM 'sgu' OR p.status = 'ativo')` (constante `PRESTADOR_ATIVO_SQL`). Cadastros manuais nunca ficam inativos por esta rotina. Unidade ativa = `pl.active`.
- Trava: aborta sem gravar se raw vazia, se houver mais de uma `dh_carga`, ou se mais de **10%** (`LIMITE_SAIDA = 0.10`) dos prestadores `source='sgu'` com `status='ativo'` virariam `excluído`.
- `responsavel_tecnico` só é sobrescrito quando o SGU traz valor (`COALESCE(<sgu>, responsavel_tecnico)`).
- Ignorados: prestador novo já EXCLUÍDO; grupo que começa com `27 -` (novo ou existente — existente não é tocado).
- Quem some da raw vira `status = 'excluído'` (com acento, igual ao parser). Nada é apagado pela rotina diária.
- Código da unidade: `'<código>-<codigo_tipo_endereco>'`; coluna `provider_locations.sgu_tipo_endereco`.
- Status novo de avaliação: `'suspensa'`, com `eval_instances.status_before_suspend`. Rótulo: `'Suspensa (prestador inativo)'`. Somente leitura para prestador, admin e auditor.
- `dh_carga` sempre comparada/gravada como texto (`dh_carga::text`) — o `Date` do JS corta microssegundos.
- Banco: só `APP_ENV=dev` (host `reseau.proxy.rlwy.net`) nesta execução. Nunca homolog/prod.
- Node não está no PATH: prefixar com `export PATH="/c/Program Files/nodejs:$PATH";`. Testes: `node --import tsx --test <arquivo>`.
- Commits no branch `dev`, sem push, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `db/providers-parser.ts` | Modificar | `ParsedLocation.sgu_tipo_endereco?` |
| `db/tabela-parser.ts` | Modificar | código estável quando há `'Código tipo endereço'` |
| `db/sgu-raw.ts` | Modificar | adaptador passa `codigo_tipo_endereco` |
| `db/sgu-test-fixtures.ts` | Criar | `raw()` e `HOJE` compartilhados pelos testes |
| `db/sgu-raw.test.ts` | Modificar | usa a fixture compartilhada |
| `db/sgu-sync-plan.ts` (+ `.test.ts`) | Criar | `planejarSync`, `checarTravas`, `planejarRekey` (puro) |
| `db/migrations/0060_sgu_sync.sql` | Criar | colunas `sgu_tipo_endereco`, `status_before_suspend` |
| `db/sgu-sync.ts` (+ `.test.ts`, `.int.test.ts`) | Criar | gravação, suspensão, `rodarSguSync`, CLI |
| `db/sgu-rekey.ts` | Criar | CLI do rekey |
| `db/sgu-purge-ausentes.ts` | Criar | CLI da limpeza única |
| `db/import-tabela.ts` | Modificar | cabeçalho "legado" |
| `package.json` | Modificar | scripts e suíte |
| `server.ts` | Modificar | guarda de `suspensa`, filtros de ativo no ciclo/inclusão, contagem do encerramento, job |
| `src/lib/statusLabels.ts`, `src/lib/auditorDashboard.ts` (+test), `src/pages/qualificacao/PainelDoCiclo.tsx`, `AuditorPlayer.tsx`, `PrestadorView.tsx` | Modificar | `suspensa` nas telas |

Desvios conscientes do spec (anotar no relatório final): (1) "ativo" exclui cadastros manuais da regra (`PRESTADOR_ATIVO_SQL`) para não suspender avaliações de prestador `source='manual'` com status `'Ativo'`/nulo; (2) no rekey, unidade não casada recebe o código `'<antigo>-x'` (além de `active=false`) para não colidir com o código novo de outra unidade; (3) `diffProviders` continua casando unidades por endereço (o spec previa casar por código quando houvesse `sgu_tipo_endereco`) — o relatório da fase 1 só perde a distinção "unidade mudou de endereço" vs "saiu+entrou"; (4) erro de trava também grava `raw_loaded_at` (diagnóstico); o job tenta de novo a cada 30 min até um sucesso naquela carga (como o spec).

---

### Task 1: Código estável da unidade no parser + fixture compartilhada

**Files:**
- Modify: `db/providers-parser.ts` (interface `ParsedLocation`)
- Modify: `db/tabela-parser.ts` (bloco `acc.addrs.set` e o `map` que monta `locations`)
- Modify: `db/sgu-raw.ts` (`COLUNAS`)
- Create: `db/sgu-test-fixtures.ts`
- Modify: `db/sgu-raw.test.ts`, `db/tabela-parser.test.ts`

**Interfaces:**
- Produces: `ParsedLocation.sgu_tipo_endereco?: string | null`; `parseTabela` gera `sgu_location_code = '<código>-<tipo>'` quando a linha tem `'Código tipo endereço'`, senão posicional; `rawToTabelaRows` passa `'Código tipo endereço'`; `db/sgu-test-fixtures.ts` exporta `HOJE = '2026-10-14'` e `raw(over?: Record<string, unknown>): SguRawRow`.

- [ ] **Step 1: Fixture compartilhada** — criar `db/sgu-test-fixtures.ts` movendo a função `raw` e a constante `HOJE` de `db/sgu-raw.test.ts` (conteúdo idêntico, sem `test`):

```ts
// Linha sintética da sgu_providers_raw para os testes das fases 1 e 2.
import type { SguRawRow } from './sgu-raw.js';

export const HOJE = '2026-10-14';

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
```

Em `db/sgu-raw.test.ts`: apagar a definição local de `HOJE` e de `raw` (a função exportada) e acrescentar no topo `import { HOJE, raw } from './sgu-test-fixtures.js';`. Se a forma da fixture local diferir da acima, manter a local (é a que os testes já usam) e reportar.

- [ ] **Step 2: Rodar os testes da fase 1 (devem continuar verdes)**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test db/sgu-raw.test.ts`
Expected: PASS (mesma contagem de antes, 12).

- [ ] **Step 3: Testes que falham** — acrescentar a `db/tabela-parser.test.ts`:

```ts
test('Código tipo endereço define o código estável da unidade; sem a coluna, código posicional', () => {
  const [p] = parseTabela([row({ 'Código tipo endereço': '3' })]).providers;
  assert.equal(p.locations[0].sgu_location_code, '1000546-3');
  assert.equal(p.locations[0].sgu_tipo_endereco, '3');
  const [q] = parseTabela([row()]).providers;
  assert.equal(q.locations[0].sgu_location_code, '1000546-1');
  assert.equal(q.locations[0].sgu_tipo_endereco ?? null, null);
});
```

e a `db/sgu-raw.test.ts`:

```ts
test('raw traduzida leva o codigo_tipo_endereco ao código da unidade', () => {
  const [p] = parseTabela(rawToTabelaRows([raw({ codigo_tipo_endereco: '4' })])).providers;
  assert.equal(p.locations[0].sgu_location_code, '1000546-4');
});
```

- [ ] **Step 4: Ver falhar**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test db/tabela-parser.test.ts db/sgu-raw.test.ts`
Expected: FAIL nos dois testes novos (`'1000546-1' !== '1000546-3'` e `'1000546-1' !== '1000546-4'`).

- [ ] **Step 5: Implementar**

`db/providers-parser.ts`, na interface `ParsedLocation`, após `in_medical_guide: boolean;`:

```ts
  sgu_tipo_endereco?: string | null;   // codigo_tipo_endereco do SGU (chave estável da unidade)
```

`db/tabela-parser.ts`, dentro do objeto de `acc.addrs.set(key, {...})`, após `in_medical_guide: ...`:

```ts
        sgu_tipo_endereco: clean(r['Código tipo endereço']) || null,
```

e trocar o `map` que monta `locations`:

```ts
    // Código estável quando a fonte traz o tipo de endereço (sgu_providers_raw); a planilha antiga,
    // sem a coluna, segue posicional.
    const locations = [...acc.addrs.values()].map((l, i) => ({
      ...l,
      sgu_location_code: l.sgu_tipo_endereco ? `${code}-${l.sgu_tipo_endereco}` : `${code}-${i + 1}`,
      is_primary: i === 0,
    }));
```

`db/sgu-raw.ts`, em `COLUNAS`, após `'Imprimir no guia médico': 'imprimir_no_guia_medico',`:

```ts
  'Código tipo endereço': 'codigo_tipo_endereco',
```

- [ ] **Step 6: Ver passar + suíte**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test db/tabela-parser.test.ts db/sgu-raw.test.ts db/import-tabela.test.ts && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: PASS; `ℹ fail 0`.

- [ ] **Step 7: Commit**

```bash
git add db/providers-parser.ts db/tabela-parser.ts db/sgu-raw.ts db/sgu-test-fixtures.ts db/sgu-raw.test.ts db/tabela-parser.test.ts
git commit -m "feat(sgu): código estável da unidade pelo tipo de endereço do SGU

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Planejamento puro — `planejarSync`, `checarTravas`, `planejarRekey`

**Files:**
- Create: `db/sgu-sync-plan.ts`
- Create: `db/sgu-sync-plan.test.ts`
- Modify: `package.json` (script `test`: acrescentar ` db/sgu-sync-plan.test.ts` após `db/sgu-raw.test.ts`)

**Interfaces:**
- Consumes: `ordenaRaw`, `rawToTabelaRows`, `addrKey`, `tipoEnderecoPorChave`, `SguRawRow` (`db/sgu-raw.ts`); `parseTabela`, `TabelaProvider` (`db/tabela-parser.ts`); `clean`, `ParsedLocation` (`db/providers-parser.ts`); fixture da Task 1.
- Produces:
  - `LIMITE_SAIDA = 0.10`
  - `interface PortalUnidadeSync { id: number; sgu_location_code: string | null; active: boolean }`
  - `interface PortalPrestadorSync { id: number; sgu_code: string; status: string | null; locations: PortalUnidadeSync[] }`
  - `interface PlanoSync { inserir: TabelaProvider[]; atualizar: { id: number; p: TabelaProvider }[]; excluirPorAusencia: number[]; unidadesNovas: { provider_id: number; prestador: TabelaProvider; loc: ParsedLocation }[]; unidadesAtualizar: { id: number; loc: ParsedLocation }[]; unidadesInativar: number[]; ignorados: { excluido_novo: string[]; grupo_27: string[] }; ativos: number; ativosQueSaem: number }`
  - `planejarSync(raw: SguRawRow[], portal: PortalPrestadorSync[]): PlanoSync`
  - `checarTravas(raw: SguRawRow[], plano: PlanoSync): string | null`
  - `interface UnidadeRekey { id: number; provider_id: number; sgu_code: string; sgu_location_code: string | null; sgu_tipo_endereco: string | null; cep: string | null; logradouro: string | null; numero: string | null }`
  - `interface PlanoRekey { rekey: { id: number; codigo: string; tipo: string }[]; inativar: { id: number; codigo: string }[] }`
  - `planejarRekey(unidades: UnidadeRekey[], raw: SguRawRow[]): PlanoRekey`

- [ ] **Step 1: Testes que falham** — criar `db/sgu-sync-plan.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checarTravas, planejarRekey, planejarSync, type PortalPrestadorSync } from './sgu-sync-plan.js';
import { raw } from './sgu-test-fixtures.js';

const portal = (over: Partial<PortalPrestadorSync> = {}): PortalPrestadorSync => ({
  id: 10, sgu_code: '1000546', status: 'ativo',
  locations: [{ id: 100, sgu_location_code: '1000546-2', active: true }], ...over,
});

test('existente: atualiza prestador e unidade de mesmo código; nada mais', () => {
  const p = planejarSync([raw()], [portal()]);
  assert.deepEqual(p.atualizar.map((a) => a.id), [10]);
  assert.deepEqual(p.unidadesAtualizar.map((u) => [u.id, u.loc.sgu_location_code]), [[100, '1000546-2']]);
  assert.deepEqual([p.inserir, p.unidadesNovas, p.unidadesInativar, p.excluirPorAusencia], [[], [], [], []]);
  assert.equal(p.ativos, 1);
  assert.equal(p.ativosQueSaem, 0);
});

test('novos: ATIVO e AFASTADO entram; EXCLUÍDO é ignorado', () => {
  const p = planejarSync([
    raw({ codigo_prestador: '2000001', numero_documento: '1' }),
    raw({ codigo_prestador: '2000002', numero_documento: '2', status_prestador: 'AFASTADO' }),
    raw({ codigo_prestador: '2000003', numero_documento: '3', status_prestador: 'EXCLUÍDO' }),
  ], []);
  assert.deepEqual(p.inserir.map((s) => [s.sgu_code, s.status]), [['2000001', 'ativo'], ['2000002', 'afastado']]);
  assert.deepEqual(p.ignorados.excluido_novo, ['2000003']);
});

test('grupo 27: ignorado como novo e não tocado como existente', () => {
  const g27 = { grupo_prestador: '27 - PRESTADOR SEM VINCULO -  XML-TISS' };
  const p = planejarSync([raw(g27), raw({ ...g27, codigo_prestador: '2000001', numero_documento: '1' })], [portal()]);
  assert.deepEqual(p.ignorados.grupo_27.sort(), ['1000546', '2000001']);
  assert.deepEqual([p.inserir, p.atualizar, p.excluirPorAusencia, p.unidadesInativar], [[], [], [], []]);
});

test('ausente vira exclusão (conta na saída se ativo); ausente já excluído não', () => {
  const p = planejarSync([raw()], [portal(),
    portal({ id: 11, sgu_code: '5000001', locations: [] }),
    portal({ id: 12, sgu_code: '5000002', status: 'excluído', locations: [] })]);
  assert.deepEqual(p.excluirPorAusencia, [11]);
  assert.equal(p.ativos, 2);
  assert.equal(p.ativosQueSaem, 1);
});

test('existente ativo que vem EXCLUÍDO conta na saída', () => {
  const p = planejarSync([raw({ status_prestador: 'EXCLUÍDO' })], [portal()]);
  assert.equal(p.ativosQueSaem, 1);
  assert.equal(p.atualizar[0].p.status, 'excluído');
});

test('unidades: nova (com o prestador), sumida ativa inativa, sumida já inativa não', () => {
  const p = planejarSync(
    [raw(), raw({ codigo_tipo_endereco: '3', logradouro: 'RUA B', numero_endereco: '10' })],
    [portal({ locations: [
      { id: 100, sgu_location_code: '1000546-2', active: true },
      { id: 101, sgu_location_code: '1000546-9', active: true },
      { id: 102, sgu_location_code: '1000546-8', active: false },
    ] })]);
  assert.deepEqual(p.unidadesNovas.map((u) => [u.provider_id, u.prestador.sgu_code, u.loc.sgu_location_code]),
    [[10, '1000546', '1000546-3']]);
  assert.deepEqual(p.unidadesInativar, [101]);
});

test('unidade inativa que volta na raw é atualizada (reativa), não recriada', () => {
  const p = planejarSync([raw()], [portal({ locations: [{ id: 100, sgu_location_code: '1000546-2', active: false }] })]);
  assert.deepEqual(p.unidadesAtualizar.map((u) => u.id), [100]);
  assert.deepEqual(p.unidadesNovas, []);
});

test('checarTravas: raw vazia, duas cargas, mais de 10% saindo', () => {
  const vazio = planejarSync([], []);
  assert.match(checarTravas([], vazio) ?? '', /vazia/);
  const duas = [raw({ dh_carga_txt: '2026-10-13 23:00:50.80752' }), raw({ dh_carga_txt: '2026-10-14 23:00:00' })];
  assert.match(checarTravas(duas, planejarSync(duas, [])) ?? '', /2 cargas/);
  const dez = Array.from({ length: 10 }, (_, i) => portal({ id: i + 1, sgu_code: `90${i}`, locations: [] }));
  const nove = dez.slice(0, 9).map((p, i) => raw({ codigo_prestador: p.sgu_code, numero_documento: String(i + 1) }));
  assert.equal(checarTravas(nove, planejarSync(nove, dez)), null);            // 1 de 10 sai: no limite
  const oito = nove.slice(0, 8);
  assert.match(checarTravas(oito, planejarSync(oito, dez)) ?? '', /2 de 10/);  // 2 de 10: aborta
});

test('planejarRekey: casa por endereço mantendo id; não casado e endereço repetido vão para inativar com -x', () => {
  const base = { provider_id: 10, sgu_code: '1000546', sgu_tipo_endereco: null };
  const unidades = [
    { ...base, id: 1, sgu_location_code: '1000546-1', cep: '88801250', logradouro: 'RUA CORONEL PEDRO BENEDET', numero: '505' },
    { ...base, id: 2, sgu_location_code: '1000546-2', cep: '88801250', logradouro: 'RUA B', numero: '10' },
    { ...base, id: 3, sgu_location_code: '1000546-3', cep: '88800000', logradouro: 'RUA SUMIU', numero: '1' },
    { ...base, id: 4, sgu_location_code: '1000546-4', cep: '88801250', logradouro: 'rua b', numero: '10' },
    { ...base, id: 5, sgu_location_code: '1000546-7', sgu_tipo_endereco: '7', cep: null, logradouro: null, numero: null },
    { ...base, id: 6, sgu_location_code: '1000546-5-x', cep: null, logradouro: null, numero: null },
  ];
  const r = planejarRekey(unidades, [raw(), raw({ codigo_tipo_endereco: '3', logradouro: 'RUA B', numero_endereco: '10' })]);
  assert.deepEqual(r.rekey, [{ id: 1, codigo: '1000546-2', tipo: '2' }, { id: 2, codigo: '1000546-3', tipo: '3' }]);
  assert.deepEqual(r.inativar, [{ id: 3, codigo: '1000546-3-x' }, { id: 4, codigo: '1000546-4-x' }]);
});
```

- [ ] **Step 2: Ver falhar**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test db/sgu-sync-plan.test.ts`
Expected: FAIL — `Cannot find module './sgu-sync-plan.js'`.

- [ ] **Step 3: Implementar** — criar `db/sgu-sync-plan.ts`:

```ts
// Planejamento da rotina diária SGU → cadastro (spec 2026-10-14, fase 2). Puro, sem banco:
// decide o que criar, atualizar e inativar; quem grava é db/sgu-sync.ts.
import { clean, type ParsedLocation } from './providers-parser.js';
import { parseTabela, type TabelaProvider } from './tabela-parser.js';
import { addrKey, ordenaRaw, rawToTabelaRows, tipoEnderecoPorChave, type SguRawRow } from './sgu-raw.js';

// Mais que isso de ativos virando excluídos numa carga só = provável carga incompleta.
export const LIMITE_SAIDA = 0.10;

export interface PortalUnidadeSync { id: number; sgu_location_code: string | null; active: boolean }
export interface PortalPrestadorSync { id: number; sgu_code: string; status: string | null; locations: PortalUnidadeSync[] }

export interface PlanoSync {
  inserir: TabelaProvider[];
  atualizar: { id: number; p: TabelaProvider }[];
  excluirPorAusencia: number[];
  unidadesNovas: { provider_id: number; prestador: TabelaProvider; loc: ParsedLocation }[];
  unidadesAtualizar: { id: number; loc: ParsedLocation }[];
  unidadesInativar: number[];
  ignorados: { excluido_novo: string[]; grupo_27: string[] };
  ativos: number;
  ativosQueSaem: number;
}

const ehExcluido = (status: unknown) => clean(status).toLowerCase().startsWith('exclu');
const GRUPO_27 = /^\s*27\s*-/;

export function planejarSync(raw: SguRawRow[], portal: PortalPrestadorSync[]): PlanoSync {
  const rows = ordenaRaw(raw);
  const { providers: sgu } = parseTabela(rawToTabelaRows(rows));
  const grupo27 = new Set(rows.filter((r) => GRUPO_27.test(clean(r.grupo_prestador)))
    .map((r) => clean(r.codigo_prestador)));
  const doPortal = new Map(portal.map((p) => [p.sgu_code, p]));
  const naRaw = new Set(sgu.map((s) => s.sgu_code));
  const plano: PlanoSync = {
    inserir: [], atualizar: [], excluirPorAusencia: [], unidadesNovas: [], unidadesAtualizar: [],
    unidadesInativar: [], ignorados: { excluido_novo: [], grupo_27: [] },
    ativos: portal.filter((p) => p.status === 'ativo').length, ativosQueSaem: 0,
  };

  for (const s of sgu) {
    if (grupo27.has(s.sgu_code)) { plano.ignorados.grupo_27.push(s.sgu_code); continue; }
    const p = doPortal.get(s.sgu_code);
    if (!p) {
      if (ehExcluido(s.status)) plano.ignorados.excluido_novo.push(s.sgu_code);
      else plano.inserir.push(s);
      continue;
    }
    plano.atualizar.push({ id: p.id, p: s });
    if (p.status === 'ativo' && ehExcluido(s.status)) plano.ativosQueSaem++;

    const atuais = new Map(p.locations.map((l) => [l.sgu_location_code, l]));
    const codigos = new Set<string>();
    for (const loc of s.locations) {
      codigos.add(loc.sgu_location_code);
      const u = atuais.get(loc.sgu_location_code);
      if (u) plano.unidadesAtualizar.push({ id: u.id, loc });
      else plano.unidadesNovas.push({ provider_id: p.id, prestador: s, loc });
    }
    for (const l of p.locations) {
      if (l.active && !codigos.has(l.sgu_location_code ?? '')) plano.unidadesInativar.push(l.id);
    }
  }

  for (const p of portal) {
    if (naRaw.has(p.sgu_code) || ehExcluido(p.status)) continue;
    plano.excluirPorAusencia.push(p.id);
    if (p.status === 'ativo') plano.ativosQueSaem++;
  }
  return plano;
}

export function checarTravas(raw: SguRawRow[], plano: PlanoSync): string | null {
  if (!raw.length) return 'sgu_providers_raw está vazia.';
  const cargas = new Set(raw.map((r) =>
    String(r.dh_carga_txt ?? (r.dh_carga instanceof Date ? r.dh_carga.getTime() : r.dh_carga))));
  if (cargas.size > 1) return `sgu_providers_raw tem ${cargas.size} cargas (dh_carga) misturadas.`;
  if (plano.ativosQueSaem > LIMITE_SAIDA * plano.ativos) {
    return `${plano.ativosQueSaem} de ${plano.ativos} prestadores ativos virariam excluídos `
      + `(limite ${LIMITE_SAIDA * 100}%) — provável carga incompleta.`;
  }
  return null;
}

export interface UnidadeRekey {
  id: number; provider_id: number; sgu_code: string; sgu_location_code: string | null;
  sgu_tipo_endereco: string | null; cep: string | null; logradouro: string | null; numero: string | null;
}
export interface PlanoRekey { rekey: { id: number; codigo: string; tipo: string }[]; inativar: { id: number; codigo: string }[] }

// Troca o código posicional (<código>-N) pelo estável (<código>-<tipo de endereço>), casando pelo
// endereço e mantendo o id. Quem não casa (ou repete um tipo já tomado) fica inativo com '-x' no
// código, para não colidir com o código novo de outra unidade.
export function planejarRekey(unidades: UnidadeRekey[], raw: SguRawRow[]): PlanoRekey {
  const tipos = tipoEnderecoPorChave(ordenaRaw(raw));
  const ocupados = new Set(unidades.filter((u) => u.sgu_tipo_endereco)
    .map((u) => `${u.provider_id}#${u.sgu_tipo_endereco}`));
  const plano: PlanoRekey = { rekey: [], inativar: [] };
  for (const u of [...unidades].sort((a, b) => a.id - b.id)) {
    if (u.sgu_tipo_endereco || (u.sgu_location_code ?? '').endsWith('-x')) continue;
    const tipo = tipos.get(`${u.sgu_code}#${addrKey(u.cep, u.logradouro, u.numero)}`);
    const chave = `${u.provider_id}#${tipo}`;
    if (tipo && !ocupados.has(chave)) {
      ocupados.add(chave);
      plano.rekey.push({ id: u.id, codigo: `${u.sgu_code}-${tipo}`, tipo });
    } else {
      plano.inativar.push({ id: u.id, codigo: `${u.sgu_location_code ?? u.sgu_code}-x` });
    }
  }
  return plano;
}
```

- [ ] **Step 4: Ver passar**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test db/sgu-sync-plan.test.ts`
Expected: PASS (9 testes).

- [ ] **Step 5: Suíte + commit** — acrescentar ` db/sgu-sync-plan.test.ts` ao script `test` do `package.json` (após `db/sgu-raw.test.ts`).

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

```bash
git add db/sgu-sync-plan.ts db/sgu-sync-plan.test.ts package.json
git commit -m "feat(sgu): planejamento da rotina diária (novos, atualizados, ausentes, travas, rekey)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Migration 0060 + gravação (`executarPlano`, `suspenderERestaurar`)

**Files:**
- Create: `db/migrations/0060_sgu_sync.sql`
- Create: `db/sgu-sync.ts` (só as funções desta task; a Task 4 acrescenta `rodarSguSync` e o CLI)
- Create: `db/sgu-sync.test.ts` (cliente falso, entra no `npm test`)
- Create: `db/sgu-sync.int.test.ts` (banco de dev em transação desfeita; NÃO entra no `npm test`)
- Modify: `package.json` (`test`: acrescentar ` db/sgu-sync.test.ts` após `db/sgu-sync-plan.test.ts`)

**Interfaces:**
- Consumes: `PlanoSync`, `planejarSync` (Task 2); `deriveProviderRole` (`db/provider-role.ts`); `TabelaProvider`; `ParsedLocation`.
- Produces:
  - `interface Consulta { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> }`
  - `PRESTADOR_ATIVO_SQL = "(p.source IS DISTINCT FROM 'sgu' OR p.status = 'ativo')"`
  - `interface Gravado { criados; atualizados; excluidos_por_ausencia; unidades_criadas; unidades_atualizadas; unidades_inativadas; acessos_criados }` (todos `number`)
  - `executarPlano(c: Consulta, plano: PlanoSync, scriptPorRoteiro: Map<string, number>): Promise<Gravado>`
  - `suspenderERestaurar(c: Consulta): Promise<{ suspensas: number; restauradas: number }>`

- [ ] **Step 1: Migration** — criar `db/migrations/0060_sgu_sync.sql`:

```sql
-- 0060_sgu_sync.sql — rotina diária SGU → cadastro (spec 2026-10-14, fase 2).
-- Tipo de endereço do SGU = chave estável da unidade (código <prestador>-<tipo>).
ALTER TABLE provider_locations ADD COLUMN IF NOT EXISTS sgu_tipo_endereco text;
-- Avaliação suspensa por prestador/unidade inativo no SGU guarda o status para restaurar.
ALTER TABLE eval_instances ADD COLUMN IF NOT EXISTS status_before_suspend text;
```

- [ ] **Step 2: Aplicar no dev** (confirmar o host antes)

Run: `export PATH="/c/Program Files/nodejs:$PATH"; APP_ENV=dev npx tsx -e "import 'dotenv/config'; import('./db/resolveDbUrl.ts').then(m=>console.log(new URL(m.pickDatabaseUrl()).host))"`
Expected: `reseau.proxy.rlwy.net:35128` (qualquer outro host: PARAR).

Run: `export PATH="/c/Program Files/nodejs:$PATH"; APP_ENV=dev npm run db:migrate`
Expected: `0060_sgu_sync.sql` aplicada, sem erro.

- [ ] **Step 3: Teste unitário que falha** — criar `db/sgu-sync.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executarPlano } from './sgu-sync.js';
import { planejarSync } from './sgu-sync-plan.js';
import { raw } from './sgu-test-fixtures.js';

function clienteFalso() {
  const sql: string[] = [];
  let id = 1000;
  return {
    sql,
    query: async (text: string) => { sql.push(text.replace(/\s+/g, ' ')); return { rows: [{ id: ++id }], rowCount: 1 }; },
  };
}

test('executarPlano nunca altera nem apaga users/user_locations e cria 1 acesso por unidade nova', async () => {
  const plano = planejarSync([
    raw(),
    raw({ codigo_tipo_endereco: '3', logradouro: 'RUA B', numero_endereco: '10' }),
    raw({ codigo_prestador: '2000001', nome_prestador: 'NOVO', numero_documento: '11111111111' }),
  ], [
    { id: 10, sgu_code: '1000546', status: 'ativo', locations: [
      { id: 100, sgu_location_code: '1000546-2', active: true },
      { id: 101, sgu_location_code: '1000546-9', active: true }] },
    { id: 11, sgu_code: '5000001', status: 'ativo', locations: [] },
  ]);
  const c = clienteFalso();
  const g = await executarPlano(c, plano, new Map());
  assert.equal(c.sql.filter((s) => /\b(UPDATE|DELETE FROM)\s+(users|user_locations)\b/i.test(s)).length, 0);
  assert.equal(c.sql.filter((s) => /INSERT INTO users\b/i.test(s)).length, 2);
  assert.equal(c.sql.filter((s) => /INSERT INTO user_locations\b/i.test(s)).length, 2);
  assert.deepEqual(g, { criados: 1, atualizados: 1, excluidos_por_ausencia: 1, unidades_criadas: 2,
    unidades_atualizadas: 1, unidades_inativadas: 1, acessos_criados: 2 });
});
```

- [ ] **Step 4: Ver falhar**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test db/sgu-sync.test.ts`
Expected: FAIL — `Cannot find module './sgu-sync.js'`.

- [ ] **Step 5: Implementar** — criar `db/sgu-sync.ts`:

```ts
/**
 * Rotina diária SGU → cadastro (spec docs/superpowers/specs/2026-10-14-sgu-sync-fase2-design.md).
 * Nunca altera nem apaga users/user_locations: só cria o acesso de unidade nova.
 */
import 'dotenv/config';
import { deriveProviderRole } from './provider-role.js';
import { type ParsedLocation } from './providers-parser.js';
import { type TabelaProvider } from './tabela-parser.js';
import { type PlanoSync } from './sgu-sync-plan.js';

export interface Consulta {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
}

// Inativo pela rotina = só cadastro vindo do SGU fora de 'ativo'; cadastro manual nunca é suspenso.
export const PRESTADOR_ATIVO_SQL = `(p.source IS DISTINCT FROM 'sgu' OR p.status = 'ativo')`;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface Gravado {
  criados: number; atualizados: number; excluidos_por_ausencia: number;
  unidades_criadas: number; unidades_atualizadas: number; unidades_inativadas: number; acessos_criados: number;
}

// $2..$15 comuns ao INSERT e ao UPDATE de providers.
const colunas = (p: TabelaProvider, scriptId: number | null) => [
  p.name, p.trade_name, p.person_type, p.cnpj, p.cpf, p.council_registry, JSON.stringify(p.specialties),
  p.provider_type, p.provider_group, p.status, p.responsavel_tecnico, scriptId, p.roteiro_cod, p.roteiro_confianca,
];

// Unidade nova + o acesso dela (mesma regra do provision-users: sem senha, sem convite,
// e-mail cadastral válido ou NULL).
async function criarUnidade(c: Consulta, providerId: number, prestador: TabelaProvider, loc: ParsedLocation) {
  const { rows } = await c.query(
    `INSERT INTO provider_locations (provider_id, sgu_location_code, sgu_tipo_endereco, label, cep, logradouro,
       numero, complemento, bairro, cidade, uf, phone, email, is_primary, in_medical_guide, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true) RETURNING id`,
    [providerId, loc.sgu_location_code, loc.sgu_tipo_endereco ?? null, loc.label, loc.cep, loc.logradouro,
     loc.numero, loc.complemento, loc.bairro, loc.cidade, loc.uf, loc.phone, loc.email, loc.is_primary,
     loc.in_medical_guide]);
  const email = loc.email && EMAIL_RE.test(loc.email.trim()) ? loc.email.trim().toLowerCase() : null;
  const { rows: u } = await c.query(
    `INSERT INTO users (name, email, password, role, provider_id, is_active, invite_status)
     VALUES ($1, $2, NULL, $3, $4, true, 'pending') RETURNING id`,
    [prestador.name, email, deriveProviderRole(prestador.person_type, prestador.provider_group), providerId]);
  await c.query(
    `INSERT INTO user_locations (user_id, location_id, provider_id) VALUES ($1, $2, $3)`,
    [u[0].id, rows[0].id, providerId]);
}

export async function executarPlano(c: Consulta, plano: PlanoSync, scriptPorRoteiro: Map<string, number>): Promise<Gravado> {
  const g: Gravado = { criados: 0, atualizados: 0, excluidos_por_ausencia: 0, unidades_criadas: 0,
    unidades_atualizadas: 0, unidades_inativadas: 0, acessos_criados: 0 };
  const script = (p: TabelaProvider) => (p.roteiro_cod ? scriptPorRoteiro.get(p.roteiro_cod) ?? null : null);

  for (const p of plano.inserir) {
    // CPF/CNPJ já usado por outro cadastro (índice único): grava sem o documento em vez de abortar a carga.
    const { rows } = await c.query(
      `INSERT INTO providers (sgu_code, name, trade_name, person_type, cnpj, cpf, council_registry, specialties,
         provider_type, provider_group, status, responsavel_tecnico, eval_script_id, roteiro_cod, roteiro_confianca,
         source, sgu_synced_at)
       VALUES ($1, $2, $3, $4,
         CASE WHEN EXISTS (SELECT 1 FROM providers o WHERE o.cnpj = $5::text) THEN NULL ELSE $5::text END,
         CASE WHEN EXISTS (SELECT 1 FROM providers o WHERE o.cpf = $6::text) THEN NULL ELSE $6::text END,
         $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, 'sgu', now())
       RETURNING id`,
      [p.sgu_code, ...colunas(p, script(p))]);
    g.criados++;
    for (const loc of p.locations) {
      await criarUnidade(c, Number(rows[0].id), p, loc);
      g.unidades_criadas++; g.acessos_criados++;
    }
  }

  for (const { id, p } of plano.atualizar) {
    await c.query(
      `UPDATE providers SET name = $2, trade_name = $3, person_type = $4,
         cnpj = CASE WHEN EXISTS (SELECT 1 FROM providers o WHERE o.cnpj = $5::text AND o.id <> $1) THEN cnpj ELSE $5::text END,
         cpf  = CASE WHEN EXISTS (SELECT 1 FROM providers o WHERE o.cpf = $6::text AND o.id <> $1) THEN cpf ELSE $6::text END,
         council_registry = $7, specialties = $8::jsonb, provider_type = $9, provider_group = $10, status = $11,
         responsavel_tecnico = COALESCE($12, responsavel_tecnico),
         eval_script_id = COALESCE($13, CASE WHEN roteiro_cod IS NOT DISTINCT FROM $14 THEN eval_script_id END),
         roteiro_cod = $14, roteiro_confianca = $15, sgu_synced_at = now()
       WHERE id = $1`,
      [id, ...colunas(p, script(p))]);
    g.atualizados++;
  }

  for (const { id, loc } of plano.unidadesAtualizar) {
    await c.query(
      `UPDATE provider_locations SET sgu_tipo_endereco = $2, label = $3, cep = $4, logradouro = $5, numero = $6,
         complemento = $7, bairro = $8, cidade = $9, uf = $10, phone = $11, email = $12, is_primary = $13,
         in_medical_guide = $14, active = true
       WHERE id = $1`,
      [id, loc.sgu_tipo_endereco ?? null, loc.label, loc.cep, loc.logradouro, loc.numero, loc.complemento,
       loc.bairro, loc.cidade, loc.uf, loc.phone, loc.email, loc.is_primary, loc.in_medical_guide]);
    g.unidades_atualizadas++;
  }

  for (const { provider_id, prestador, loc } of plano.unidadesNovas) {
    await criarUnidade(c, provider_id, prestador, loc);
    g.unidades_criadas++; g.acessos_criados++;
  }

  if (plano.unidadesInativar.length) {
    const r = await c.query(
      `UPDATE provider_locations SET active = false WHERE id = ANY($1::bigint[]) AND active`, [plano.unidadesInativar]);
    g.unidades_inativadas = r.rowCount ?? 0;
  }
  if (plano.excluirPorAusencia.length) {
    const r = await c.query(
      `UPDATE providers SET status = 'excluído', sgu_synced_at = now() WHERE id = ANY($1::bigint[])`,
      [plano.excluirPorAusencia]);
    g.excluidos_por_ausencia = r.rowCount ?? 0;
  }
  return g;
}

const NAO_SUSPENDE = `('aprovado', 'reprovado', 'finalizado', 'ciclo_encerrado', 'suspensa')`;

// Avaliações do ciclo ativo: suspende as de prestador/unidade inativo e restaura as que voltaram.
// Estado → efeito (idempotente): pode rodar a cada carga sem acumular.
export async function suspenderERestaurar(c: Consulta): Promise<{ suspensas: number; restauradas: number }> {
  const s = await c.query(`
    UPDATE eval_instances ei SET status_before_suspend = ei.status, status = 'suspensa'
      FROM eval_cycles cy, providers p, provider_locations pl
     WHERE cy.id = ei.cycle_id AND cy.active AND p.id = ei.provider_id AND pl.id = ei.location_id
       AND NOT (${PRESTADOR_ATIVO_SQL} AND pl.active)
       AND ei.status NOT IN ${NAO_SUSPENDE}`);
  const r = await c.query(`
    UPDATE eval_instances ei SET status = COALESCE(ei.status_before_suspend, 'pendente'), status_before_suspend = NULL
      FROM eval_cycles cy, providers p, provider_locations pl
     WHERE cy.id = ei.cycle_id AND cy.active AND p.id = ei.provider_id AND pl.id = ei.location_id
       AND ei.status = 'suspensa' AND ${PRESTADOR_ATIVO_SQL} AND pl.active`);
  return { suspensas: s.rowCount ?? 0, restauradas: r.rowCount ?? 0 };
}
```

- [ ] **Step 6: Ver passar**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test db/sgu-sync.test.ts`
Expected: PASS.

- [ ] **Step 7: Teste de integração (dev, transação desfeita)** — criar `db/sgu-sync.int.test.ts`:

```ts
// Integração no banco de DEV — fora do npm test. Tudo numa transação desfeita no fim (ROLLBACK).
//   APP_ENV=dev node --import tsx --test db/sgu-sync.int.test.ts
import 'dotenv/config';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from './db.js';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import { executarPlano, suspenderERestaurar } from './sgu-sync.js';
import { planejarSync } from './sgu-sync-plan.js';
import { raw } from './sgu-test-fixtures.js';

after(() => pool.end());

test('sync em fixture: RT e e-mail de usuário preservados, unidade nova com acesso, suspende e restaura', async () => {
  assert.match(pickDatabaseUrl() ?? '', /reseau\.proxy\.rlwy\.net/, 'só roda no banco de dev');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const COD = '_TSYNC_1';
    const { rows: [p] } = await c.query(
      `INSERT INTO providers (sgu_code, name, person_type, status, responsavel_tecnico, source, specialties)
       VALUES ($1, 'FIXTURE SYNC', 'PF', 'ativo', 'DRA EDITADA NA TELA', 'sgu', '[]') RETURNING id`, [COD]);
    const { rows: [l] } = await c.query(
      `INSERT INTO provider_locations (provider_id, sgu_location_code, sgu_tipo_endereco, cep, logradouro, numero, active)
       VALUES ($1, $2, '2', '88801250', 'RUA CORONEL PEDRO BENEDET', '505', true) RETURNING id`, [p.id, `${COD}-2`]);
    const { rows: [u] } = await c.query(
      `INSERT INTO users (name, email, role, provider_id, is_active, invite_status)
       VALUES ('FIXTURE SYNC', 'editado@portal.test', 'cooperado', $1, true, 'accepted') RETURNING id`, [p.id]);
    await c.query(`INSERT INTO user_locations (user_id, location_id, provider_id) VALUES ($1, $2, $3)`, [u.id, l.id, p.id]);
    await c.query(`UPDATE eval_cycles SET active = false WHERE active`);
    const { rows: [cy] } = await c.query(
      `INSERT INTO eval_cycles (label, start_date, end_date, active, cert_valid_until)
       VALUES ('_TSYNC', current_date, current_date + 30, true, current_date + 400) RETURNING id`);
    const { rows: [inst] } = await c.query(
      `INSERT INTO eval_instances (script_id, provider_id, location_id, status, cycle_id)
       VALUES ((SELECT id FROM eval_scripts ORDER BY id LIMIT 1), $1, $2, 'em_andamento', $3) RETURNING id`,
      [p.id, l.id, cy.id]);

    const unidade = { id: Number(l.id), sgu_location_code: `${COD}-2`, active: true };
    const afastado = [
      raw({ codigo_prestador: COD, status_prestador: 'AFASTADO', email_principal: 'cadastro@sgu.test' }),
      raw({ codigo_prestador: COD, status_prestador: 'AFASTADO', codigo_tipo_endereco: '3',
            logradouro: 'RUA NOVA', numero_endereco: '10', email_principal: 'Nova@SGU.test' }),
    ];
    await executarPlano(c, planejarSync(afastado, [{ id: Number(p.id), sgu_code: COD, status: 'ativo', locations: [unidade] }]), new Map());
    const s1 = await suspenderERestaurar(c);

    const { rows: [pp] } = await c.query(`SELECT status, responsavel_tecnico FROM providers WHERE id = $1`, [p.id]);
    assert.deepEqual({ ...pp }, { status: 'afastado', responsavel_tecnico: 'DRA EDITADA NA TELA' });
    const { rows: [uu] } = await c.query(`SELECT email, invite_status FROM users WHERE id = $1`, [u.id]);
    assert.deepEqual({ ...uu }, { email: 'editado@portal.test', invite_status: 'accepted' });
    const { rows: [l1] } = await c.query(`SELECT email FROM provider_locations WHERE id = $1`, [l.id]);
    assert.equal(l1.email, 'cadastro@sgu.test');
    const { rows: novas } = await c.query(
      `SELECT pl.sgu_location_code, u.email, u.password IS NULL AS sem_senha, u.invite_status
         FROM provider_locations pl JOIN user_locations ul ON ul.location_id = pl.id JOIN users u ON u.id = ul.user_id
        WHERE pl.provider_id = $1 AND pl.id <> $2`, [p.id, l.id]);
    assert.deepEqual(novas.map((r) => ({ ...r })),
      [{ sgu_location_code: `${COD}-3`, email: 'nova@sgu.test', sem_senha: true, invite_status: 'pending' }]);
    assert.equal(s1.suspensas, 1);
    const { rows: [i1] } = await c.query(`SELECT status, status_before_suspend FROM eval_instances WHERE id = $1`, [inst.id]);
    assert.deepEqual({ ...i1 }, { status: 'suspensa', status_before_suspend: 'em_andamento' });

    // Volta a ATIVO na carga seguinte: restaura o status anterior.
    await executarPlano(c, planejarSync([raw({ codigo_prestador: COD })],
      [{ id: Number(p.id), sgu_code: COD, status: 'afastado', locations: [unidade] }]), new Map());
    const s2 = await suspenderERestaurar(c);
    assert.equal(s2.restauradas, 1);
    const { rows: [i2] } = await c.query(`SELECT status, status_before_suspend FROM eval_instances WHERE id = $1`, [inst.id]);
    assert.deepEqual({ ...i2 }, { status: 'em_andamento', status_before_suspend: null });
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
});
```

Run: `export PATH="/c/Program Files/nodejs:$PATH"; APP_ENV=dev node --import tsx --test db/sgu-sync.int.test.ts`
Expected: PASS. Se falhar por diferença de schema (coluna NOT NULL não prevista na fixture), ajustar SÓ a fixture do teste e relatar; não mudar `db/sgu-sync.ts` para acomodar o teste sem relatar.

- [ ] **Step 8: Suíte + commit** — acrescentar ` db/sgu-sync.test.ts` ao `test` do `package.json` (após `db/sgu-sync-plan.test.ts`).

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `ℹ fail 0`.

```bash
git add db/migrations/0060_sgu_sync.sql db/sgu-sync.ts db/sgu-sync.test.ts db/sgu-sync.int.test.ts package.json
git commit -m "feat(sgu): gravação da rotina diária e suspensão/restauração de avaliações (0060)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `rodarSguSync` + comando `db:sgu-sync`

**Files:**
- Modify: `db/sgu-sync.ts` (acrescentar ao fim)
- Modify: `db/sgu-diff.ts` (exportar `lerPortal`)
- Modify: `db/import-tabela.ts` (cabeçalho)
- Modify: `package.json` (`"db:sgu-sync": "tsx db/sgu-sync.ts",` após `db:sgu-diff`)

**Interfaces:**
- Consumes: `executarPlano`, `suspenderERestaurar`, `Consulta` (Task 3); `planejarSync`, `checarTravas`, `PlanoSync`, `PortalPrestadorSync` (Task 2); `diffProviders`, `dataCivil` (`db/sgu-raw.ts`); `lerPortal` (`db/sgu-diff.ts`); `query`, `pool`, `withTransaction` (`db/db.ts`).
- Produces: `rodarSguSync(opts: { commit: boolean; forcar: boolean }): Promise<ResultadoSync>`, com `type ResultadoSync = { status: 'aplicado' | 'simulado' | 'sem_carga_nova' | 'ocupado'; message: string; plano?: PlanoSync; gravado?: Gravado & { suspensas: number; restauradas: number } }`. Lança erro em trava/falha (com `commit`, registra `status='error'` antes).

- [ ] **Step 1: Exportar `lerPortal`** — em `db/sgu-diff.ts`, trocar `async function lerPortal(` por `export async function lerPortal(`.

- [ ] **Step 2: Implementar** — em `db/sgu-sync.ts`, acrescentar aos imports do topo:

```ts
import { pathToFileURL } from 'node:url';
import { pool, query, withTransaction } from './db.js';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import { dataCivil, diffProviders } from './sgu-raw.js';
import { lerPortal } from './sgu-diff.js';
import { checarTravas, planejarSync, type PortalPrestadorSync } from './sgu-sync-plan.js';
```

(o import de `type PlanoSync` existente passa a vir junto: `import { checarTravas, planejarSync, type PlanoSync, type PortalPrestadorSync } from './sgu-sync-plan.js';` — um import só) e, no fim do arquivo:

```ts
async function lerPortalSync(c: Consulta): Promise<PortalPrestadorSync[]> {
  const { rows } = await c.query(`
    SELECT p.id, p.sgu_code, p.status,
           COALESCE((SELECT json_agg(json_build_object('id', l.id, 'sgu_location_code', l.sgu_location_code,
                                                       'active', l.active))
                       FROM provider_locations l WHERE l.provider_id = p.id), '[]'::json) AS locations
      FROM providers p
     WHERE p.source = 'sgu'`);
  return rows.map((r) => ({
    id: Number(r.id), sgu_code: r.sgu_code, status: r.status,
    locations: r.locations.map((l: any) => ({ id: Number(l.id), sgu_location_code: l.sgu_location_code, active: l.active })),
  }));
}

// FOR-NNN → id do roteiro (o mais recente vence), como no import-tabela.
async function scriptPorRoteiro(c: Consulta): Promise<Map<string, number>> {
  const { rows } = await c.query('SELECT id, source_file FROM eval_scripts ORDER BY id');
  const m = new Map<string, number>();
  for (const r of rows) {
    const f = /FOR-(\d+)/i.exec(r.source_file ?? '');
    if (f) m.set(`FOR-${f[1]}`, Number(r.id));
  }
  return m;
}

export type ResultadoSync = {
  status: 'aplicado' | 'simulado' | 'sem_carga_nova' | 'ocupado';
  message: string;
  plano?: PlanoSync;
  gravado?: Gravado & { suspensas: number; restauradas: number };
};

// forcar=false (job): só aplica carga ainda não tentada — sucesso ou erro na mesma dh_carga encerra.
// forcar=true (comando manual): aplica sempre.
export async function rodarSguSync(opts: { commit: boolean; forcar: boolean }): Promise<ResultadoSync> {
  let carga: string | null = null;
  try {
    return await withTransaction(async (c): Promise<ResultadoSync> => {
      const { rows: [lock] } = await c.query(`SELECT pg_try_advisory_xact_lock(hashtext('sgu-sync')) AS ok`);
      if (!lock.ok) return { status: 'ocupado', message: 'outra execução em andamento' };
      const { rows: raw } = await c.query(
        `SELECT *, dh_carga::text AS dh_carga_txt FROM sgu_providers_raw
          ORDER BY codigo_prestador, codigo_tipo_endereco, especialidade_grupo_servico`);
      carga = raw[0]?.dh_carga_txt ?? null;
      if (!opts.forcar && carga) {
        const { rows: [ult] } = await c.query(
          `SELECT raw_loaded_at::text AS t, status FROM sgu_sync_runs
            WHERE source = 'sgu-sync' AND raw_loaded_at IS NOT NULL ORDER BY id DESC LIMIT 1`);
        if (ult?.t === carga) return { status: 'sem_carga_nova', message: `carga ${carga} já processada (${ult.status})` };
      }
      const plano = planejarSync(raw, await lerPortalSync(c));
      const trava = checarTravas(raw, plano);
      if (trava) throw new Error(trava);
      const resumo = `novos ${plano.inserir.length}, atualizados ${plano.atualizar.length}, `
        + `excluídos por ausência ${plano.excluirPorAusencia.length}, unidades novas ${plano.unidadesNovas.length}, `
        + `unidades inativadas ${plano.unidadesInativar.length}, ignorados `
        + `${plano.ignorados.excluido_novo.length + plano.ignorados.grupo_27.length}`;
      if (!opts.commit) return { status: 'simulado', message: resumo, plano };

      const diff = diffProviders(raw, await lerPortal(), dataCivil(new Date())!);
      const gravado = { ...(await executarPlano(c, plano, await scriptPorRoteiro(c))), ...(await suspenderERestaurar(c)) };
      const message = `${resumo}; avaliações suspensas ${gravado.suspensas}, restauradas ${gravado.restauradas}`;
      await c.query(
        `INSERT INTO sgu_sync_runs (source, status, raw_loaded_at, providers_upserted, locations_upserted, message, report, finished_at)
         VALUES ('sgu-sync', 'success', $1::timestamp, $2, $3, $4, $5, now())`,
        [carga, gravado.criados + gravado.atualizados, gravado.unidades_criadas + gravado.unidades_atualizadas,
         message, JSON.stringify({ diff, gravado, ignorados: plano.ignorados })]);
      return { status: 'aplicado', message, plano, gravado };
    });
  } catch (err: any) {
    if (opts.commit) {
      await query(
        `INSERT INTO sgu_sync_runs (source, status, raw_loaded_at, message, finished_at)
         VALUES ('sgu-sync', 'error', $1::timestamp, $2, now())`,
        [carga, String(err?.message ?? err)]).catch(() => {});
    }
    throw err;
  }
}

async function main() {
  const commit = process.argv.includes('--commit');
  const url = pickDatabaseUrl();
  console.log(`APP_ENV=${process.env.APP_ENV ?? '(vazio)'} | banco: ${url ? new URL(url).host : '(vazio)'} | ${commit ? 'COMMIT' : 'DRY-RUN'}`);
  try {
    const r = await rodarSguSync({ commit, forcar: true });
    console.log(`${r.status}: ${r.message}`);
    if (r.plano) {
      console.log(`ignorados: EXCLUÍDO novo ${r.plano.ignorados.excluido_novo.length}, grupo 27 ${r.plano.ignorados.grupo_27.length}`);
      console.log(`ativos que viram excluídos: ${r.plano.ativosQueSaem} de ${r.plano.ativos}`);
    }
    if (r.gravado) console.log(JSON.stringify(r.gravado));
    if (!commit) console.log('Dry-run: nada gravado. Para aplicar: --commit');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 3: Script e cabeçalho legado** — `package.json`: acrescentar `"db:sgu-sync": "tsx db/sgu-sync.ts",` após `"db:sgu-diff": ...`. Em `db/import-tabela.ts`, primeira linha do comentário de cabeçalho (logo após `/**`):

```ts
 * LEGADO desde 14/10/2026: a fonte do cadastro é a sgu_providers_raw (db/sgu-sync.ts).
 * Não rodar depois do db:sgu-rekey (recriaria unidades com código posicional).
```

- [ ] **Step 4: Tipos + suíte**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx tsc --noEmit -p . 2>&1 | grep -E "db/sgu-" ; echo tsc-done; npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: nenhuma linha antes de `tsc-done`; `ℹ fail 0`.

- [ ] **Step 5: Dry-run no dev (antes do rekey/purge — a trava DEVE disparar)**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; APP_ENV=dev npm run db:sgu-sync`
Expected: primeira linha com `reseau.proxy.rlwy.net:35128 | DRY-RUN`; termina com erro `... prestadores ativos virariam excluídos (limite 10%) — provável carga incompleta.` (os ~89 ausentes ainda não foram apagados). Nenhuma linha nova em `sgu_sync_runs` (dry-run não registra). Esse é o comportamento correto nesta etapa.

- [ ] **Step 6: Commit**

```bash
git add db/sgu-sync.ts db/sgu-diff.ts db/import-tabela.ts package.json
git commit -m "feat(sgu): comando db:sgu-sync (lock, travas, carga já processada, registro)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Comandos únicos `db:sgu-rekey` e `db:sgu-purge-ausentes`

**Files:**
- Create: `db/sgu-rekey.ts`
- Create: `db/sgu-purge-ausentes.ts`
- Modify: `package.json` (`"db:sgu-rekey": "tsx db/sgu-rekey.ts",` e `"db:sgu-purge-ausentes": "tsx db/sgu-purge-ausentes.ts",` após `db:sgu-sync`)

**Interfaces:**
- Consumes: `planejarRekey`, `UnidadeRekey` (Task 2); `Consulta` (Task 3); `pool`, `withTransaction`; `pickDatabaseUrl`.
- Produces: os dois comandos (dry-run padrão, `--commit` aplica).

- [ ] **Step 1: `db/sgu-rekey.ts`**

```ts
/**
 * Uma vez por ambiente (spec fase 2, A2): troca o código posicional das unidades pelo estável
 * <código>-<codigo_tipo_endereco>, casando com a sgu_providers_raw pelo endereço e mantendo o id.
 *   APP_ENV=dev npx tsx db/sgu-rekey.ts            # dry-run
 *   APP_ENV=dev npx tsx db/sgu-rekey.ts --commit
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { pool, withTransaction } from './db.js';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import { planejarRekey, type UnidadeRekey } from './sgu-sync-plan.js';

async function main() {
  const commit = process.argv.includes('--commit');
  const url = pickDatabaseUrl();
  console.log(`APP_ENV=${process.env.APP_ENV ?? '(vazio)'} | banco: ${url ? new URL(url).host : '(vazio)'} | ${commit ? 'COMMIT' : 'DRY-RUN'}`);
  try {
    await withTransaction(async (c) => {
      const { rows: raw } = await c.query(
        `SELECT * FROM sgu_providers_raw ORDER BY codigo_prestador, codigo_tipo_endereco, especialidade_grupo_servico`);
      if (!raw.length) throw new Error('sgu_providers_raw vazia — rekey abortado (inativaria todas as unidades).');
      const { rows } = await c.query(
        `SELECT pl.id, pl.provider_id, p.sgu_code, pl.sgu_location_code, pl.sgu_tipo_endereco, pl.cep, pl.logradouro, pl.numero
           FROM provider_locations pl JOIN providers p ON p.id = pl.provider_id
          WHERE p.source = 'sgu'`);
      const unidades: UnidadeRekey[] = rows.map((r) => ({ ...r, id: Number(r.id), provider_id: Number(r.provider_id) }));
      const plano = planejarRekey(unidades, raw);
      console.log(`Unidades sgu: ${unidades.length} | recodificadas: ${plano.rekey.length} | inativadas: ${plano.inativar.length}`);
      for (const i of plano.inativar.slice(0, 30)) console.log(`   - inativa ${i.id} → ${i.codigo}`);
      if (plano.inativar.length > 30) console.log(`   ... (+${plano.inativar.length - 30})`);
      if (!commit) { console.log('Dry-run: nada gravado. Para aplicar: --commit'); return; }

      // Passo intermediário: libera os códigos atuais antes de gravar os novos (índice único por prestador).
      const ids = [...plano.rekey.map((r) => r.id), ...plano.inativar.map((r) => r.id)];
      await c.query(`UPDATE provider_locations SET sgu_location_code = '~rekey~' || id WHERE id = ANY($1::bigint[])`, [ids]);
      for (const r of plano.rekey) {
        await c.query(`UPDATE provider_locations SET sgu_location_code = $2, sgu_tipo_endereco = $3 WHERE id = $1`,
          [r.id, r.codigo, r.tipo]);
      }
      for (const r of plano.inativar) {
        await c.query(`UPDATE provider_locations SET sgu_location_code = $2, active = false WHERE id = $1`, [r.id, r.codigo]);
      }
      console.log('✔ Rekey aplicado.');
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 2: `db/sgu-purge-ausentes.ts`**

```ts
/**
 * Limpeza ÚNICA (spec fase 2, A3; decisão da Katy em 14/10/2026): apaga os prestadores source='sgu'
 * que não estão na sgu_providers_raw, com os usuários deles. Backup JSON antes. Rodar depois do rekey.
 *   APP_ENV=dev npx tsx db/sgu-purge-ausentes.ts            # dry-run
 *   APP_ENV=dev npx tsx db/sgu-purge-ausentes.ts --commit
 */
import 'dotenv/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool, withTransaction } from './db.js';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import type { Consulta } from './sgu-sync.js';

const LIMITE = 0.20; // mais que isso do cadastro sgu = raw suspeita, aborta
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tabelas com FK de uma coluna para `tabela` — segue a cascata para o backup.
async function filhos(c: Consulta, tabela: string): Promise<{ tabela: string; coluna: string }[]> {
  const { rows } = await c.query(
    `SELECT k.conrelid::regclass::text AS tabela, a.attname AS coluna
       FROM pg_constraint k
       JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
      WHERE k.contype = 'f' AND k.confrelid = $1::regclass AND array_length(k.conkey, 1) = 1`, [tabela]);
  return rows;
}

async function coletar(c: Consulta, tabela: string, ids: unknown[], backup: Record<string, any[]>, nivel = 0) {
  if (!ids.length || nivel > 4) return;
  for (const f of await filhos(c, tabela)) {
    const { rows } = await c.query(`SELECT * FROM ${f.tabela} WHERE ${f.coluna} = ANY($1)`, [ids]);
    if (!rows.length) continue;
    (backup[f.tabela] ??= []).push(...rows);
    await coletar(c, f.tabela, rows.map((r) => r.id).filter((x) => x != null), backup, nivel + 1);
  }
}

async function main() {
  const commit = process.argv.includes('--commit');
  const url = pickDatabaseUrl();
  console.log(`APP_ENV=${process.env.APP_ENV ?? '(vazio)'} | banco: ${url ? new URL(url).host : '(vazio)'} | ${commit ? 'COMMIT' : 'DRY-RUN'}`);
  try {
    await withTransaction(async (c) => {
      const { rows: [{ n: nRaw }] } = await c.query(`SELECT count(*)::int AS n FROM sgu_providers_raw`);
      if (!nRaw) throw new Error('sgu_providers_raw vazia — nada é apagado.');
      const { rows: alvo } = await c.query(
        `SELECT p.id, p.sgu_code, p.name, p.status FROM providers p
          WHERE p.source = 'sgu'
            AND NOT EXISTS (SELECT 1 FROM sgu_providers_raw r WHERE r.codigo_prestador::text = p.sgu_code)
          ORDER BY p.sgu_code`);
      const { rows: [{ n: total }] } = await c.query(`SELECT count(*)::int AS n FROM providers WHERE source = 'sgu'`);
      if (alvo.length > LIMITE * total) {
        throw new Error(`${alvo.length} de ${total} prestadores seriam apagados (limite ${LIMITE * 100}%) — confira a raw.`);
      }
      const ids = alvo.map((r) => r.id);
      const backup: Record<string, any[]> = { providers: (await c.query(`SELECT * FROM providers WHERE id = ANY($1::bigint[])`, [ids])).rows };
      await coletar(c, 'providers', ids, backup);

      console.log(`Prestadores a apagar: ${alvo.length}`);
      for (const p of alvo) console.log(`   - ${p.sgu_code} ${p.name} (${p.status})`);
      console.log('Linhas que saem junto (backup):');
      for (const [t, rows] of Object.entries(backup)) console.log(`   ${t}: ${rows.length}`);
      if (!commit) { console.log('Dry-run: nada apagado. Para apagar: --commit'); return; }

      const dir = path.resolve(__dirname, '..', 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const arq = path.join(dir, `sgu-purge-${process.env.APP_ENV ?? 'sem-env'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.writeFileSync(arq, JSON.stringify(backup, null, 1));
      console.log(`Backup: ${arq}`);
      const u = await c.query(`DELETE FROM users WHERE provider_id = ANY($1::bigint[])`, [ids]);
      const p = await c.query(`DELETE FROM providers WHERE id = ANY($1::bigint[])`, [ids]);
      console.log(`✔ Apagados: ${p.rowCount} prestadores e ${u.rowCount} usuários (o resto em cascata).`);
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 3: Scripts + tipos** — acrescentar os dois scripts ao `package.json`.

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx tsc --noEmit -p . 2>&1 | grep -E "db/sgu-" ; echo tsc-done`
Expected: nenhuma linha antes de `tsc-done`.

- [ ] **Step 4: Dry-runs no dev (SEM --commit)**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; APP_ENV=dev npm run db:sgu-rekey`
Expected: `reseau.proxy.rlwy.net:35128 | DRY-RUN`; recodificadas ≈ 632 + unidades de prestadores ausentes que casarem (os ausentes não estão na raw → suas unidades vão para "inativadas"); termina com `Dry-run: nada gravado`.

Run: `export PATH="/c/Program Files/nodejs:$PATH"; APP_ENV=dev npm run db:sgu-purge-ausentes`
Expected: `Prestadores a apagar: 89` (ou próximo, se a raw mudou), lista e contagens por tabela, `Dry-run: nada apagado`. Se o número de alvos passar de 20% do cadastro sgu, o comando aborta — relatar.

NÃO rodar `--commit` em nenhum dos dois nesta task (fica para a Task 8, com o ok da Katy).

- [ ] **Step 5: Commit** (não versionar nada de `backups/`)

```bash
git add db/sgu-rekey.ts db/sgu-purge-ausentes.ts package.json
git commit -m "feat(sgu): comandos únicos db:sgu-rekey e db:sgu-purge-ausentes (com backup)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Servidor — guarda de `suspensa`, filtros de ativo, encerramento e job

**Files:**
- Modify: `server.ts` (import; `loadInstanceForWrite` ~3756; inclusion-candidates ~5008; POST inclusions ~5063-5079; `openCycleCore` ~5193; `closeCycleCore` ~5358; jobs ~7025)

**Interfaces:**
- Consumes: `PRESTADOR_ATIVO_SQL`, `rodarSguSync` (`db/sgu-sync.ts`).
- Produces: escrita em avaliação `suspensa` → 409 em todo endpoint que usa `loadInstanceForWrite`; inativo fora de abertura/inclusão de ciclo; `suspensa` não bloqueia encerramento manual; job `runSguSyncJob` a cada 30 min com `SGU_SYNC_ENABLED=true`.

Não há harness de teste de servidor no projeto; a verificação é `tsc` + build + checagens no dev (Step 7).

- [ ] **Step 1: Import** — após a linha `import { canDownloadManual, ... } from './db/script-manual.js';` acrescentar:

```ts
import { PRESTADOR_ATIVO_SQL, rodarSguSync } from './db/sgu-sync.js';
```

- [ ] **Step 2: Guarda central** — em `loadInstanceForWrite`, entre o bloco do 403 e `return instance;`:

```ts
    // Prestador/unidade inativo no SGU (rotina diária, spec 2026-10-14): avaliação congelada para todos.
    if (instance.status === 'suspensa') {
      res.status(409).json({ error: 'Avaliação suspensa: o prestador está inativo no cadastro da Unimed.' });
      return null;
    }
```

- [ ] **Step 3: Candidatos à inclusão** — no `WHERE` de `/api/eval/cycles/:id/inclusion-candidates`, trocar `WHERE pl.in_medical_guide = true` por:

```sql
         WHERE pl.in_medical_guide = true
           AND pl.active AND ${PRESTADOR_ATIVO_SQL}
```

(a query é template literal — confirmar que está entre crases; se estiver entre aspas simples, converter para crases.)

- [ ] **Step 4: POST de inclusão** — no `SELECT` de `pair`, acrescentar a coluna após `pl.in_medical_guide,`:

```sql
               (pl.active AND ${PRESTADOR_ATIVO_SQL}) AS ativo,
```

e, logo após `if (!pair[0].in_medical_guide) return ...;`:

```ts
      if (!pair[0].ativo) return res.status(409).json({ error: 'prestador ou unidade inativo no cadastro da Unimed' });
```

- [ ] **Step 5: Abertura do ciclo** — em `openCycleCore`, no `INSERT INTO eval_instances ... SELECT`, trocar `WHERE pl.in_medical_guide = true` por:

```sql
           WHERE pl.in_medical_guide = true
             AND pl.active AND ${PRESTADOR_ATIVO_SQL}
```

- [ ] **Step 6: Encerramento manual** — em `closeCycleCore`, na contagem `pending`, trocar `status NOT IN ('aprovado', 'reprovado', 'finalizado')` por `status NOT IN ('aprovado', 'reprovado', 'finalizado', 'suspensa')` **só na contagem** (o UPDATE para `ciclo_encerrado` continua igual, para a suspensa virar histórico). Comentário na linha anterior: `// suspensa não conta como "em andamento" (prestador inativo), mas é encerrada junto.`

- [ ] **Step 7: Job** — logo após `setInterval(runAutoCycleJobs, 60 * 60 * 1000);`:

```ts

  // Rotina diária do SGU (spec 2026-10-14, fase 2): aplica a sgu_providers_raw quando chega carga nova.
  // Ligada só com SGU_SYNC_ENABLED=true (depois do db:sgu-rekey e do db:sgu-purge-ausentes no ambiente).
  async function runSguSyncJob() {
    if (process.env.SGU_SYNC_ENABLED !== 'true') return;
    try {
      const r = await rodarSguSync({ commit: true, forcar: false });
      if (r.status === 'aplicado') console.log(`[sgu-sync] ${r.message}`);
    } catch (e) {
      console.error('[sgu-sync] falhou:', e);
    }
  }
  runSguSyncJob();
  setInterval(runSguSyncJob, 30 * 60 * 1000);
```

- [ ] **Step 8: Verificar**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; npx tsc --noEmit -p . 2>&1 | grep -E "server\.ts|db/sgu-" ; echo tsc-done; npm run build 2>&1 | tail -3; npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: nenhuma linha nova de erro em `server.ts` antes de `tsc-done` (comparar com `git stash`-free baseline: rodar o mesmo grep antes da edição e relatar as linhas pré-existentes); build ok; `ℹ fail 0`.

Checagem SQL no dev (só leitura) — o filtro novo da abertura compila e conta: rodar com um script descartável no diretório do repo (apagar depois, não versionar) que execute, com `DATABASE_URL_DEV`:

```sql
SELECT count(*) FILTER (WHERE pl.active AND (p.source IS DISTINCT FROM 'sgu' OR p.status = 'ativo')) AS entram,
       count(*) AS no_guia
  FROM provider_locations pl JOIN providers p ON p.id = pl.provider_id
 WHERE pl.in_medical_guide = true
```

Expected: `entram` < `no_guia` (os afastados/excluídos ficam de fora); relatar os dois números.

- [ ] **Step 9: Commit**

```bash
git add server.ts
git commit -m "feat(sgu): avaliação suspensa é só leitura, inativo fora do ciclo, job diário (SGU_SYNC_ENABLED)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Telas — `suspensa`

**Files:**
- Modify: `src/lib/statusLabels.ts`
- Modify: `src/lib/auditorDashboard.ts` (linha do `scores.push`) e `src/lib/auditorDashboard.test.ts`
- Modify: `src/pages/qualificacao/PainelDoCiclo.tsx` (`isClosedInstance`, `statusPill`)
- Modify: `src/pages/qualificacao/AuditorPlayer.tsx` (`READONLY_STATUSES`)
- Modify: `src/pages/qualificacao/PrestadorView.tsx` (deep link `?corrigir=`)

**Interfaces:**
- Produces: `STATUS_LABEL.suspensa = 'Suspensa (prestador inativo)'`; `suspensa` sempre somente leitura e fora da média de nota.

- [ ] **Step 1: Teste que falha** — acrescentar a `src/lib/auditorDashboard.test.ts` (o helper `inst` e `cycle` já existem no arquivo):

```ts
test('suspensa: não é pendente, não é enviada e não entra na média', () => {
  const r = buildAuditorDashboard(cycle, [
    inst({ id: 1, status: 'suspensa', percentual: 0 }),
    inst({ id: 2, status: 'aprovado', percentual: 80 }),
  ], []);
  assert.equal(r.kpis.pending, 0);
  assert.equal(r.kpis.sent, 1);
  assert.equal(r.kpis.avg_score, 80);
});
```

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test src/lib/auditorDashboard.test.ts`
Expected: FAIL em `avg_score` (40 ≠ 80). Se o campo da média tiver outro nome em `r.kpis`, usar o nome real (ver o teste existente "avg_score ignora em_andamento") e relatar.

- [ ] **Step 2: Implementar**

`src/lib/auditorDashboard.ts`:

```ts
    if (inst.status !== 'em_andamento' && inst.status !== 'suspensa') scores.push(Number(inst.percentual) || 0);
```

`src/lib/statusLabels.ts`, após `ciclo_encerrado: 'Ciclo Encerrado',`:

```ts
  suspensa:              'Suspensa (prestador inativo)',   // rotina diária do SGU (spec 2026-10-14)
```

`src/pages/qualificacao/PainelDoCiclo.tsx`:

```ts
const isClosedInstance = (status: string) =>
  ['aprovado', 'reprovado', 'finalizado', 'ciclo_encerrado', 'suspensa'].includes(status);
```

e no mapa de `statusPill`, após `ciclo_encerrado: ...,`:

```ts
    suspensa: 'bg-gray-200 text-gray-700',
```

`src/pages/qualificacao/AuditorPlayer.tsx`:

```ts
// Enquanto o prestador não enviou (pendente/em_andamento) não há o que analisar — abre só leitura.
// Suspensa (prestador inativo no SGU) também é só leitura.
const READONLY_STATUSES = [...CLOSED_STATUSES, 'em_andamento', 'pendente', 'suspensa'];
```

`src/pages/qualificacao/PrestadorView.tsx`, no efeito do `?corrigir=`:

```ts
    if (inst && !OPEN_STATES.includes(inst.status) && inst.status !== 'suspensa') {
```

- [ ] **Step 3: Verificar**

Run: `export PATH="/c/Program Files/nodejs:$PATH"; node --import tsx --test src/lib/auditorDashboard.test.ts && npm test 2>&1 | grep -E "^ℹ (pass|fail)" && npm run build 2>&1 | tail -3`
Expected: PASS; `ℹ fail 0`; build ok.

- [ ] **Step 4: Commit**

```bash
git add src/lib/statusLabels.ts src/lib/auditorDashboard.ts src/lib/auditorDashboard.test.ts src/pages/qualificacao/PainelDoCiclo.tsx src/pages/qualificacao/AuditorPlayer.tsx src/pages/qualificacao/PrestadorView.tsx
git commit -m "feat(qualificacao): status Suspensa (prestador inativo) somente leitura nas telas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Validação real no dev (controlador, com ok da Katy antes do purge)

Executada pelo controlador (não por subagente), comando a comando, sempre conferindo `reseau.proxy.rlwy.net:35128` na primeira linha.

- [ ] **Step 1:** `APP_ENV=dev npm run db:sgu-rekey -- --commit` → anotar recodificadas/inativadas.
- [ ] **Step 2:** `APP_ENV=dev npm run db:sgu-purge-ausentes` (dry-run) → mostrar à Katy a lista e as contagens. **Parar e pedir o ok explícito dela** para apagar no dev.
- [ ] **Step 3:** com o ok: `APP_ENV=dev npm run db:sgu-purge-ausentes -- --commit` → anotar o arquivo de backup.
- [ ] **Step 4:** `APP_ENV=dev npm run db:sgu-sync` (dry-run) → a trava não pode disparar; conferir novos (~15), ignorados (EXCLUÍDO novo ~295, grupo 27 = 1).
- [ ] **Step 5:** `APP_ENV=dev npm run db:sgu-sync -- --commit` → `aplicado`; anotar o JSON `gravado`.
- [ ] **Step 6:** rodar `--commit` de novo → `aplicado` com novos 0, unidades novas 0, unidades inativadas 0, excluídos por ausência 0, suspensas 0, restauradas 0 (idempotência).
- [ ] **Step 7:** `APP_ENV=dev npm run db:sgu-diff` → `ausentes 0`, `novos` = só os EXCLUÍDO/grupo 27 ignorados; alterados só residuais explicáveis.
- [ ] **Step 8:** regra "carga nunca altera usuário" no dado real: tirar snapshot `SELECT id, email, invite_status, password IS NULL AS sem_senha FROM users ORDER BY id` antes do Step 5 e depois do Step 6; todo usuário que existia antes tem que estar idêntico depois (só podem aparecer ids novos, dos acessos de unidades novas).
- [ ] **Step 9:** registrar no ledger e na memória; push só com ok da Katy.

---

## Promoção (fora deste plano)

Por ambiente: deploy (0060 no boot) → `db:sgu-rekey --commit` → `db:sgu-purge-ausentes --commit` (prod: Katy) → `db:sgu-sync --commit` e conferência → `SGU_SYNC_ENABLED=true` no serviço.
