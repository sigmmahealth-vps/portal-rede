# Qualificação (5.4.3) — Admin e Prestador a 100% — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os bugs de autopreenchimento do prestador e substituir o mock do dashboard admin por dado real, mantendo o motor de roteiros (`eval_*`) existente.

**Architecture:** Frontend React (Vite) + backend Express (`server.ts`, tsx) sobre Postgres. Nada de motor novo — só corrige `RoteiroPlayer.tsx`/`GestorDashboard.tsx` e três endpoints em `server.ts`. Um helper puro de score (`src/lib/score.ts`) isola a única lógica com teste automatizado.

**Tech Stack:** React 18, TypeScript, Express, `pg`, Recharts, `node:test` + `node:assert/strict` (único harness de teste do projeto — só backend/utilitários puros).

## Global Constraints

- Sem migration: `eval_answers` já tem `provider_observation` e `evidence_url`. Não criar colunas.
- Branch de trabalho: `dev`. Não tocar produção.
- Testes rodam via `npm test` (`node --import tsx --test ...`). Não há harness de teste de React — tarefas de UI são verificadas rodando o app.
- `fetchApi(endpoint, options)` (`src/lib/api.ts`) já injeta `Content-Type: application/json` (exceto FormData) e `credentials: include`. Endpoints são chamados **sem** o prefixo `/api` (ex.: `fetchApi('/eval/dashboard')`).
- Postgres `numeric` chega como **string** ("10.00") — sempre `Number(...)` antes de somar.
- Commits pequenos e frequentes, um por task.

---

### Task 1: Helper puro `computeScore` + teste

Isola a regra de pontuação (inclusive N/A fora do denominador) num módulo testável. É a base da Task 2.

**Files:**
- Create: `src/lib/score.ts`
- Test: `src/lib/score.test.ts`
- Modify: `package.json:20` (adicionar o teste à lista do script `test`)

**Interfaces:**
- Consumes: nada.
- Produces:
  ```ts
  export interface ScoreQuestion { id: number; max_score: number | string; }
  export interface ScoreAnswer { answer_value?: string | null; }
  export function computeScore(
    questions: ScoreQuestion[],
    answers: Record<number, ScoreAnswer>
  ): { score: number; maxPossible: number; percentual: number };
  ```

- [ ] **Step 1: Escrever o teste que falha**

Create `src/lib/score.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScore } from './score.js';

const qs = [
  { id: 1, max_score: '10' }, // sim  -> 10
  { id: 2, max_score: '10' }, // nao  -> 0
  { id: 3, max_score: '10' }, // na   -> excluído (fora do denominador)
];

test('sim pontua, nao zera, N/A sai do denominador', () => {
  const r = computeScore(qs, {
    1: { answer_value: 'sim' },
    2: { answer_value: 'nao' },
    3: { answer_value: 'na' },
  });
  assert.equal(r.score, 10);
  assert.equal(r.maxPossible, 20); // 10 + 10, N/A não conta
  assert.equal(r.percentual, 50);
});

test('sem respostas e sem critérios aplicáveis -> percentual 0, sem divisão por zero', () => {
  assert.deepEqual(computeScore([], {}), { score: 0, maxPossible: 0, percentual: 0 });
  const allNa = computeScore([{ id: 1, max_score: '10' }], { 1: { answer_value: 'na' } });
  assert.deepEqual(allNa, { score: 0, maxPossible: 0, percentual: 0 });
});
```

- [ ] **Step 2: Adicionar o teste ao script `test`**

Modify `package.json:20` — acrescentar `src/lib/score.test.ts` ao final da lista de arquivos do script `"test"`:
```
... db/resolveDbUrl.test.ts src/lib/score.test.ts"
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL — `Cannot find module './score.js'`.

- [ ] **Step 4: Implementar o helper mínimo**

Create `src/lib/score.ts`:
```ts
export interface ScoreQuestion { id: number; max_score: number | string; }
export interface ScoreAnswer { answer_value?: string | null; }

/**
 * Pontuação de um roteiro. N/A ("na") é "Não Pontuado": sai do numerador E do
 * denominador (peso a considerar = 0), para não penalizar critério que
 * legitimamente não se aplica. "sim" pontua o peso máximo; qualquer outra
 * resposta (nao/em branco) pontua 0 mas conta no denominador.
 */
export function computeScore(
  questions: ScoreQuestion[],
  answers: Record<number, ScoreAnswer>,
): { score: number; maxPossible: number; percentual: number } {
  let score = 0;
  let maxPossible = 0;
  for (const q of questions) {
    const a = answers[q.id];
    if (a?.answer_value === 'na') continue;
    const pts = Number(q.max_score) || 0;
    maxPossible += pts;
    if (a?.answer_value === 'sim') score += pts;
  }
  const percentual = maxPossible > 0 ? (score / maxPossible) * 100 : 0;
  return { score, maxPossible, percentual };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test`
Expected: PASS (todos, incl. os 2 novos de score).

- [ ] **Step 6: Commit**

```bash
git add src/lib/score.ts src/lib/score.test.ts package.json
git commit -m "feat(qualificacao): helper puro computeScore com regra de N/A"
```

---

### Task 2: Prestador — N/A não pontua + justificativa/observação (P1, P2, P4)

`RoteiroPlayer` passa a usar `computeScore`, N/A deixa de dar pontos, e cada critério ganha textarea de observação (obrigatória quando N/A).

**Files:**
- Modify: `src/pages/qualificacao/RoteiroPlayer.tsx`

**Interfaces:**
- Consumes: `computeScore` (Task 1).
- Produces: envia `provider_observation` no array de `saveProgress` (já aceito pelo endpoint `PUT /eval/instances/:id/answers`, `server.ts:2909`).

- [ ] **Step 1: N/A pontua 0**

Em `RoteiroPlayer.tsx:440`, trocar o score do N/A de `q.max_score` para `0`:
```tsx
<input type="radio" name={`q_${q.id}`} className="hidden" checked={ans?.answer_value === 'na'} onChange={() => handleAnswerChange(q.id, 'na', 0)} />
```

- [ ] **Step 2: Estender o tipo `Answer` e adicionar handler de observação**

Em `RoteiroPlayer.tsx` interface `Answer` (linha ~28), garantir o campo:
```ts
interface Answer {
  answer_value: string;
  score_obtained: number;
  file?: File | null;
  file_url?: string;
  is_na?: boolean;
  provider_observation?: string;
}
```
Adicionar handler perto de `handleAnswerChange`:
```tsx
const handleObservationChange = (questionId: number, value: string) => {
  setAnswers(prev => ({
    ...prev,
    [questionId]: { ...prev[questionId], provider_observation: value },
  }));
};
```

- [ ] **Step 3: Renderizar o textarea de observação (obrigatório quando N/A)**

No card do critério, logo após o bloco de `sim_nao` (depois da linha ~444), adicionar:
```tsx
{ans?.answer_value === 'na' && (
  <div className="mt-3">
    <label className="text-sm font-bold text-gray-700 block mb-1">
      Justificativa (obrigatória para "Não se aplica")
    </label>
    <textarea
      value={ans?.provider_observation || ''}
      onChange={(e) => handleObservationChange(q.id, e.target.value)}
      className="w-full border border-gray-300 rounded-lg p-2 text-sm"
      rows={2}
      placeholder="Explique por que este critério não se aplica ao seu estabelecimento."
    />
  </div>
)}
{ans?.answer_value && ans.answer_value !== 'na' && (
  <div className="mt-3">
    <label className="text-xs font-semibold text-gray-500 block mb-1">Observação (opcional)</label>
    <textarea
      value={ans?.provider_observation || ''}
      onChange={(e) => handleObservationChange(q.id, e.target.value)}
      className="w-full border border-gray-200 rounded-lg p-2 text-sm"
      rows={2}
    />
  </div>
)}
```

- [ ] **Step 4: Enviar `provider_observation` no save**

Em `saveProgress` (`RoteiroPlayer.tsx:191-196`), incluir o campo no objeto:
```tsx
const answersArray = Object.keys(answers).map(qId => ({
  question_id: parseInt(qId),
  answer_value: answers[parseInt(qId)].answer_value,
  score_obtained: answers[parseInt(qId)].score_obtained,
  provider_observation: answers[parseInt(qId)].provider_observation || null,
  is_non_compliant: (answers[parseInt(qId)].answer_value === 'nao' || answers[parseInt(qId)].answer_value === 'NAO') ? 1 : 0,
}));
```

- [ ] **Step 5: Usar `computeScore` no finish**

No topo do arquivo adicionar `import { computeScore } from '../../lib/score';`. Substituir o cálculo manual em `finishEvaluation` (`RoteiroPlayer.tsx:228-240`) por:
```tsx
const { score: totalScore, maxPossible: maxScore, percentual } = computeScore(questions, answers);
```
(remover o bloco `let totalScore...forEach...` e a linha `const percentual = ...`).

- [ ] **Step 6: Verificar no app**

Run: `npm run dev` e abrir o portal como prestador (ver README/host dev).
Verificar: marcar N/A exige justificativa e não soma pontos; marcar Sim soma; observação aparece; salvar rascunho, sair e reabrir mantém a observação (vem de `provider_observation` no GET da instância — carregado na Task 3).
Expected: comportamento acima OK; sem erro no console.

- [ ] **Step 7: Commit**

```bash
git add src/pages/qualificacao/RoteiroPlayer.tsx
git commit -m "feat(qualificacao): N/A nao pontua e exige justificativa; observacao por criterio"
```

---

### Task 3: Evidência persistente por critério (P3)

Upload passa a vincular o arquivo ao critério (`eval_answers.evidence_url`) e o player recarrega evidência + observação ao reabrir.

**Files:**
- Modify: `server.ts` (endpoint `POST /api/eval/instances/:id/evidence`, ~2959)
- Modify: `src/pages/qualificacao/RoteiroPlayer.tsx` (upload e carga inicial)

**Interfaces:**
- Consumes: `loadInstanceForWrite(req, res)` (`server.ts:2887`) já existente.
- Produces: `POST /evidence` passa a exigir `question_id` no body e devolve `{ success, url }`; `GET /eval/instances/:id` já devolve `eval_answers.*` (inclui `evidence_url`, `provider_observation`).

- [ ] **Step 1: Endpoint grava `evidence_url` no answer**

No endpoint de evidência (`server.ts:2959`), após obter `fileUrl` e antes do `res.json`, adicionar o upsert do answer (mantendo o insert em `documents`):
```ts
const questionId = req.body.question_id;
if (questionId) {
  await query(`
    INSERT INTO eval_answers (instance_id, question_id, evidence_url, evidence_status)
    VALUES ($1, $2, $3, 'pendente')
    ON CONFLICT (instance_id, question_id) DO UPDATE SET
      evidence_url = excluded.evidence_url,
      evidence_status = 'pendente'
  `, [instanceId, questionId, fileUrl]);
}
```
(O upsert de `/answers` não lista `evidence_url` no SET, então salvar rascunho preserva a evidência.)

- [ ] **Step 2: Frontend envia `question_id` no upload**

Em `handleFileUpload` (`RoteiroPlayer.tsx:154-156`), adicionar ao FormData:
```tsx
const formData = new FormData();
formData.append('file', file);
formData.append('provider_id', providerId.toString());
formData.append('question_id', questionId.toString());
```

- [ ] **Step 3: Carregar evidência e observação ao reabrir**

Em `loadScript` (`RoteiroPlayer.tsx:103-108`), incluir os campos ao montar `loadedAnswers`:
```tsx
instanceData.answers.forEach((ans: any) => {
  loadedAnswers[ans.question_id] = {
    answer_value: ans.answer_value,
    score_obtained: ans.score_obtained,
    file_url: ans.evidence_url || undefined,
    provider_observation: ans.provider_observation || undefined,
  };
});
```

- [ ] **Step 4: Verificar no app**

Run: `npm run dev`. Como prestador: anexar evidência num critério, salvar rascunho, fechar o player e reabrir a mesma avaliação.
Expected: o critério mostra "Evidência Anexada com Sucesso" (não some); a observação também reaparece.

- [ ] **Step 5: Commit**

```bash
git add server.ts src/pages/qualificacao/RoteiroPlayer.tsx
git commit -m "fix(qualificacao): evidencia vinculada ao criterio e persistente ao reabrir"
```

---

### Task 4: Obrigatórios não respondidos + bloqueio de finalização (P5)

**Files:**
- Modify: `src/pages/qualificacao/RoteiroPlayer.tsx`

**Interfaces:**
- Consumes: `questions`, `answers` (estado do componente).
- Produces: função local `pendingItems()` usada para sinalizar e bloquear o Finalizar.

- [ ] **Step 1: Calcular pendências**

Adicionar helper dentro do componente (perto de `calculateProgress`, ~304):
```tsx
// Pendência = critério sem resposta; ou evidência obrigatória sem arquivo (exceto N/A);
// ou N/A sem justificativa.
const pendingItems = () => questions.filter(q => {
  const a = answers[q.id];
  if (!a?.answer_value) return true;
  if (a.answer_value === 'na') return !a.provider_observation?.trim();
  if (q.evidence_required && !a.file_url) return true;
  return false;
});
```

- [ ] **Step 2: Sinalizar critério pendente no card**

No card do critério (após o cabeçalho do critério, ~427), adicionar um selo quando pendente:
```tsx
{pendingItems().some(pq => pq.id === q.id) && (
  <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-700 border border-amber-200">
    Pendente
  </span>
)}
```

- [ ] **Step 3: Bloquear a finalização**

Em `saveProgress` (`RoteiroPlayer.tsx:213-217`), no ramo da última etapa, checar pendências antes de concluir:
```tsx
} else if (currentIndex === rootSections.length - 1) {
  const pend = pendingItems();
  if (pend.length > 0) {
    alert(`Há ${pend.length} critério(s) pendente(s) (sem resposta, evidência ou justificativa). Complete-os antes de finalizar.`);
    return;
  }
  if (confirm('Deseja concluir a avaliação? Ela será enviada para análise.')) {
    await finishEvaluation(instId);
  }
}
```
("Salvar Rascunho" continua sem bloqueio.)

- [ ] **Step 4: Verificar no app**

Run: `npm run dev`. Como prestador, tentar Finalizar com um critério em branco / N/A sem justificativa / evidência obrigatória faltando.
Expected: alerta lista a quantidade e bloqueia; cards pendentes mostram o selo "Pendente"; ao completar tudo, finaliza.

- [ ] **Step 5: Commit**

```bash
git add src/pages/qualificacao/RoteiroPlayer.tsx
git commit -m "feat(qualificacao): sinaliza obrigatorios e bloqueia finalizacao com pendencias"
```

---

### Task 5: Endpoint `/eval/dashboard` com dado real (A6)

**Files:**
- Modify: `server.ts` (endpoint `GET /api/eval/dashboard`, ~2985)

**Interfaces:**
- Produces: além de `total`, `approved`, `avg_score`, `by_status`, o JSON passa a conter:
  ```ts
  non_conformities: number;
  seal_distribution: { name: string; value: number }[]; // Ouro/Prata/Bronze/Não Qualificado
  ranking: { provider: string; score: number; seal: string | null }[]; // top 10 por percentual
  evolution: { name: string; media: number }[]; // média mensal de percentual
  ```

- [ ] **Step 1: Adicionar as queries e campos**

Dentro do `try` do endpoint, após a query `instancesByStatus`, adicionar:
```ts
const { rows: ncRows } = await query(
  'SELECT COUNT(*)::int AS count FROM eval_answers WHERE is_non_compliant = true'
);

const { rows: sealRows } = await query(`
  SELECT COALESCE(seal, 'Não Qualificado') AS name, COUNT(*)::int AS value
  FROM eval_instances WHERE status = 'finalizado'
  GROUP BY COALESCE(seal, 'Não Qualificado')
`);

const { rows: rankingRows } = await query(`
  SELECT p.trade_name AS provider, ROUND(ei.percentual)::int AS score, ei.seal
  FROM eval_instances ei
  JOIN providers p ON p.id = ei.provider_id
  WHERE ei.status = 'finalizado'
  ORDER BY ei.percentual DESC
  LIMIT 10
`);

const { rows: evoRows } = await query(`
  SELECT to_char(date_trunc('month', completed_at), 'YYYY-MM') AS name,
         ROUND(AVG(percentual))::int AS media
  FROM eval_instances
  WHERE status = 'finalizado' AND completed_at IS NOT NULL
  GROUP BY 1 ORDER BY 1
`);
```
E no `res.json({...})` acrescentar:
```ts
non_conformities: (ncRows[0] as any).count,
seal_distribution: sealRows,
ranking: rankingRows,
evolution: evoRows,
```

- [ ] **Step 2: Confirmar a coluna de nome do prestador**

Run (ajustar host/DB de dev conforme README):
```bash
grep -n "trade_name\|legal_name\|razao\|fantasia\|name" db/migrations/0001_baseline.sql | grep -i "provider" | head
```
Expected: existe `providers.trade_name`. Se o nome for outro (ex.: `legal_name`), trocar no SELECT do ranking. **Não** prosseguir com um nome de coluna inexistente.

- [ ] **Step 3: Verificar o endpoint**

Run: `npm run dev` e autenticado como admin, chamar `GET /api/eval/dashboard`.
Expected: JSON com `non_conformities`, `seal_distribution`, `ranking`, `evolution` (podem vir vazios/zerados se não houver instância finalizada — correto).

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "feat(qualificacao): dashboard endpoint com selos, nao-conformidades, ranking e evolucao reais"
```

---

### Task 6: GestorDashboard com dado real (A1–A4)

**Files:**
- Modify: `src/pages/qualificacao/GestorDashboard.tsx`

**Interfaces:**
- Consumes: campos de `/eval/dashboard` da Task 5.

- [ ] **Step 1: Card Não Conformidades**

Em `GestorDashboard.tsx:144`, trocar o `12` fixo por `{data.non_conformities}`.

- [ ] **Step 2: Linha de evolução**

Em `GestorDashboard.tsx:155`, trocar o array mock por `data.evolution` (chaves já são `name`/`media`):
```tsx
<LineChart data={data.evolution || []}>
```

- [ ] **Step 3: Pizza de selos**

Em `GestorDashboard.tsx:177-199`, usar `data.seal_distribution`. Definir um mapa de cor por nome e mapear:
```tsx
const SEAL_COLORS: Record<string, string> = {
  'Ouro': '#FCD34D', 'Prata': '#9CA3AF', 'Bronze': '#B45309', 'Não Qualificado': '#EF4444',
};
// ...
<Pie data={data.seal_distribution || []} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
  {(data.seal_distribution || []).map((entry: any, index: number) => (
    <Cell key={`cell-${index}`} fill={SEAL_COLORS[entry.name] || '#CBD5E1'} />
  ))}
</Pie>
```

- [ ] **Step 4: Tabela de ranking**

Em `GestorDashboard.tsx:225-244`, trocar as 3 linhas fake por `data.ranking`:
```tsx
<tbody>
  {(data.ranking || []).map((r: any, i: number) => (
    <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
      <td className="p-4"><div className="w-8 h-8 rounded bg-gray-100 text-gray-700 font-bold flex items-center justify-center">{i + 1}º</div></td>
      <td className="p-4 font-medium text-gray-900">{r.provider}</td>
      <td className="p-4 font-bold text-emerald-600">{r.score}%</td>
      <td className="p-4">{r.seal
        ? <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-bold uppercase tracking-wide">{r.seal}</span>
        : <span className="text-gray-400 text-xs">—</span>}</td>
    </tr>
  ))}
  {(!data.ranking || data.ranking.length === 0) && (
    <tr><td colSpan={4} className="p-6 text-center text-gray-400 text-sm">Nenhuma avaliação finalizada ainda.</td></tr>
  )}
</tbody>
```

- [ ] **Step 5: Verificar no app**

Run: `npm run dev` como admin, abrir o Dashboard de Qualificação.
Expected: cards/gráficos/tabela refletem o dado real (podem estar zerados/vazios enquanto não houver finalizadas — correto); nenhum valor hardcoded remanescente.

- [ ] **Step 6: Commit**

```bash
git add src/pages/qualificacao/GestorDashboard.tsx
git commit -m "feat(qualificacao): dashboard admin com dado real (nao-conformidades, selos, evolucao, ranking)"
```

---

### Task 7: Exportar Relatório → CSV do ranking (A5)

**Files:**
- Modify: `src/pages/qualificacao/GestorDashboard.tsx`

**Interfaces:**
- Consumes: `data.ranking`. Segue o padrão client-side de `src/pages/Documentos.tsx:197-213`.

- [ ] **Step 1: Função de export**

Adicionar dentro do componente:
```tsx
const exportRankingCsv = () => {
  const rows = data?.ranking || [];
  const headers = ['Colocacao', 'Prestador', 'Score', 'Selo'];
  const csvContent = [
    headers.join(','),
    ...rows.map((r: any, i: number) =>
      [i + 1, `"${(r.provider || '').replace(/"/g, '""')}"`, r.score, r.seal || ''].join(',')),
  ].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.setAttribute('download', 'ranking_qualificacao.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
```

- [ ] **Step 2: Ligar o botão**

Em `GestorDashboard.tsx:83-84`, trocar `onClick={() => {}}` por `onClick={exportRankingCsv}`.

- [ ] **Step 3: Verificar no app**

Run: `npm run dev` como admin, clicar "Exportar Relatório".
Expected: baixa `ranking_qualificacao.csv` com as linhas do ranking (cabeçalho + prestadores; vazio além do cabeçalho se não houver finalizadas).

- [ ] **Step 4: Commit**

```bash
git add src/pages/qualificacao/GestorDashboard.tsx
git commit -m "feat(qualificacao): exportar ranking em CSV no dashboard admin"
```

---

### Task 8: Marcar trabalho adiado (parser lê "Tipo")

Deixa rastro no código do que foi conscientemente adiado, para não virar "depois = nunca".

**Files:**
- Modify: `db/roteiro-parser.ts` (função `addQuestion`, ~189)
- Modify: `server.ts` (insert de `eval_questions`, ~2683)

**Interfaces:** nenhuma (só comentários).

- [ ] **Step 1: Comentar no parser**

Em `db/roteiro-parser.ts`, na `addQuestion` (onde hoje `markMatch` de `DL|S|C|E` só vira `dimension`, ~189), adicionar:
```ts
// ponytail: hoje S/DL/E/C só alimenta `dimension`; o tipo de resposta é sempre
// tratado como sim_nao no import. Adiado: ler a coluna "Tipo" e emitir o tipo real
// (numerico/data/texto/upload/DL) — ver spec 5.4.3.3 e docs/superpowers/specs/2026-07-09-qualificacao-admin-prestador-design.md.
```

- [ ] **Step 2: Comentar no import**

Em `server.ts:2683` (o `VALUES (...,'sim_nao',...)` do insert de `eval_questions`), adicionar acima:
```ts
// ponytail: type fixo em 'sim_nao' — todo roteiro atual é conformidade + evidência.
// Adiado: derivar o type do "Tipo" (S/DL/E/C) quando o parser passar a lê-lo.
```

- [ ] **Step 3: Commit**

```bash
git add db/roteiro-parser.ts server.ts
git commit -m "docs(qualificacao): marca adiamento da leitura do Tipo (S/DL/E/C) no parser/import"
```

---

## Self-Review

**Cobertura da spec:**
- P1/P2 (N/A não pontua + justificativa) → Task 1 (regra) + Task 2 (UI/score).
- P3 (evidência persistente) → Task 3.
- P4 (observação) → Task 2.
- P5 (obrigatórios + bloqueio) → Task 4.
- A6 (endpoint) → Task 5. A1–A4 (UI) → Task 6. A5 (CSV) → Task 7.
- Adiado (parser Tipo) → Task 8 (marcação). Fluxo auditor/parecer/plano/DL → fora de escopo, documentado no spec.

**Placeholders:** nenhum — todos os steps têm código/comando concretos. Tarefas de UI usam verificação manual por falta de harness de teste React (constraint global), não por omissão.

**Consistência de tipos:** `computeScore(questions, answers)` com a mesma assinatura na Task 1 e no uso da Task 2; campos do dashboard (`non_conformities`, `seal_distribution`, `ranking`, `evolution`) idênticos entre Task 5 (produz) e Tasks 6/7 (consomem); `provider_observation`/`evidence_url` idênticos entre server e player.

**Risco conhecido:** Task 5 Step 2 valida o nome real da coluna de prestador antes de commitar o SQL do ranking.
