# Dashboard de Qualificação (Estratégico) — P1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a aba Estratégico (`GestorDashboard`) num centro de comando: cobertura da rede, funil de andamento, onde a rede falha (dimensão + top critérios) e engajamento na pesquisa — usando dados que já existem.

**Architecture:** Estender o endpoint `GET /api/eval/dashboard` com campos novos (agregações SQL + reuso de `computePlanStatus` e `computeSurveyStats`) e reescrever os blocos do `GestorDashboard` para consumi-los. Sem migration.

**Tech Stack:** Express + `pg`, React 19 + TypeScript, recharts, Tailwind, lucide-react.

## Global Constraints

- **Node:** rodar via `"/c/Program Files/nodejs/node"` (Bash tool). Lint: `"/c/Program Files/nodejs/npm" run lint` (`tsc --noEmit`). Ver `[[node-nao-esta-no-path]]`.
- **Sem migration** neste P1 — só código.
- **Colunas reais** (não inventar): `eval_questions` usa `eq.code` (código do critério) e `eq.text` (enunciado), `eq.dimension`, `eq.max_score`. `eval_answers.is_non_compliant` (boolean). `eval_survey_responses` tem `q1_clareza,q2_portal,q3_documentos,q4_dificuldade,q5_geral,q6_nps,within_deadline`.
- **Concluído (avaliação)** = `status IN ('aprovado','reprovado','finalizado')`. `ciclo_encerrado` fica fora do funil.
- **Denominador de cobertura (rede)** = **endereços comerciais** de prestadores com roteiro: `provider_locations pl JOIN providers p ON p.id=pl.provider_id` com `p.eval_script_id IS NOT NULL` e o filtro comercial (`COALESCE(pl.label,'') NOT ILIKE 'residencial%' AND COALESCE(pl.sgu_location_code,'') !~ '-RES$'`). Numeradores (cobertura e qualificados) na mesma granularidade: `COUNT(DISTINCT ei.location_id)` (não-nulo).
- **Dimensão:** consolidar `Documento Legal` em `Segurança` (mesmo padrão de `loadCertificates`).
- Todos os campos respeitam o filtro `?cycle_id=` (null = todos).
- Reusar libs existentes: `src/lib/actionPlan.ts` (`computePlanStatus`), `src/lib/surveyStats.ts` (`computeSurveyStats`). Não reimplementar NPS/CSAT nem status de plano.

---

## File Structure

- `server.ts` — **modificar** o handler `GET /api/eval/dashboard` (~linha 3394): adicionar as queries e campos novos ao `res.json`.
- `src/pages/qualificacao/GestorDashboard.tsx` — **reescrever** os blocos (KPIs, funil, onde-falha, engajamento); manter evolução (linha) e selos (pizza).

---

## Task 1: Backend — campos novos em `/api/eval/dashboard`

**Files:**
- Modify: `server.ts` (handler `GET /api/eval/dashboard`, ~3394–3464)

**Interfaces:**
- Produces (consumido pela Task 2), adicionados ao JSON já existente (`total`, `approved`, `providers_evaluated`, `avg_score`, `by_status`, `seal_distribution`, `evolution` continuam):
  ```ts
  network_total: number         // endereços comerciais de prestadores com roteiro (denominador)
  addresses_evaluated: number   // endereços distintos avaliados (numerador da cobertura)
  addresses_qualified: number   // endereços distintos com selo (numerador de qualificados)
  by_dimension_nc: { dimension: string; nc: number; total: number; rate: number }[]   // rate = round(nc/total*100)
  top_nc_criteria: { question_code: string; question_text: string; count: number }[]   // top 8
  action_plans: { open: number; overdue: number; concluded: number }
  survey_engagement: { available: number; responded: number; response_rate: number; within_deadline_rate: number; nps: number | null; csat: number | null }
  ```

- [ ] **Step 1: Adicionar as queries antes do `res.json`**

No handler, logo antes do `res.json({...})` (após a query `evoRows`), inserir:

```ts
      // Denominador da cobertura: endereços comerciais de prestadores com roteiro (independe de ciclo).
      const { rows: netRows } = await query(`
        SELECT COUNT(*)::int AS count
          FROM provider_locations pl
          JOIN providers p ON p.id = pl.provider_id
         WHERE p.eval_script_id IS NOT NULL
           AND COALESCE(pl.label,'') NOT ILIKE 'residencial%'
           AND COALESCE(pl.sgu_location_code,'') !~ '-RES$'`);
      // Numeradores na granularidade de endereço (endereços distintos avaliados / com selo).
      const { rows: addrEvalRows } = await query(
        "SELECT COUNT(DISTINCT ei.location_id)::int AS count FROM eval_instances ei WHERE ei.location_id IS NOT NULL AND ($1::bigint IS NULL OR ei.cycle_id = $1)", [cycleId]);
      const { rows: addrQualRows } = await query(
        "SELECT COUNT(DISTINCT ei.location_id)::int AS count FROM eval_instances ei WHERE ei.location_id IS NOT NULL AND ei.seal IS NOT NULL AND ei.status IN ('finalizado','aprovado') AND ($1::bigint IS NULL OR ei.cycle_id = $1)", [cycleId]);

      // Não-conformidade por dimensão (DL consolida em Segurança).
      const { rows: dimRows } = await query(`
        SELECT CASE WHEN eq.dimension IN ('Segurança','Documento Legal') THEN 'Segurança' ELSE eq.dimension END AS dimension,
               COUNT(*) FILTER (WHERE ea.is_non_compliant)::int AS nc,
               COUNT(*)::int AS total
          FROM eval_answers ea
          JOIN eval_questions eq ON eq.id = ea.question_id
          JOIN eval_instances ei ON ei.id = ea.instance_id
         WHERE eq.dimension IS NOT NULL AND ($1::bigint IS NULL OR ei.cycle_id = $1)
         GROUP BY 1
         ORDER BY nc DESC
      `, [cycleId]);

      // Top critérios mais reprovados na rede.
      const { rows: topNcRows } = await query(`
        SELECT eq.code AS question_code, eq.text AS question_text, COUNT(*)::int AS count
          FROM eval_answers ea
          JOIN eval_questions eq ON eq.id = ea.question_id
          JOIN eval_instances ei ON ei.id = ea.instance_id
         WHERE ea.is_non_compliant AND ($1::bigint IS NULL OR ei.cycle_id = $1)
         GROUP BY eq.code, eq.text
         ORDER BY count DESC
         LIMIT 8
      `, [cycleId]);

      // Saúde dos planos de ação (reusa computePlanStatus).
      const { rows: planAggRows } = await query(`
        SELECT p.id, p.closed_without_completion,
               COALESCE(json_agg(json_build_object('status', i.status, 'due_date', i.due_date))
                        FILTER (WHERE i.id IS NOT NULL), '[]') AS items,
               EXISTS (SELECT 1 FROM eval_action_events e JOIN eval_action_items ii ON ii.id = e.item_id
                        WHERE ii.plan_id = p.id AND e.actor_role = 'prestador') AS has_provider_interaction
          FROM eval_action_plans p
          LEFT JOIN eval_action_items i ON i.plan_id = p.id
         WHERE ($1::bigint IS NULL OR p.cycle_id = $1)
         GROUP BY p.id
      `, [cycleId]);
      const { computePlanStatus } = await import('./src/lib/actionPlan.js');
      const nowDash = new Date();
      let apOpen = 0, apOverdue = 0, apConcluded = 0;
      for (const r of planAggRows as any[]) {
        const st = computePlanStatus({
          items: r.items, hasProviderInteraction: r.has_provider_interaction,
          closedWithoutCompletion: r.closed_without_completion, now: nowDash,
        });
        if (st === 'concluido') apConcluded++;
        else if (st !== 'encerrado_sem_conclusao') { apOpen++; if (st === 'atrasado') apOverdue++; }
      }

      // Engajamento na Pesquisa de Satisfação (reusa computeSurveyStats).
      const { rows: availRows } = await query(
        "SELECT COUNT(*)::int AS count FROM eval_instances WHERE submitted_at IS NOT NULL AND ($1::bigint IS NULL OR cycle_id = $1)", [cycleId]);
      const { rows: srRows } = await query(`
        SELECT sr.q1_clareza, sr.q2_portal, sr.q3_documentos, sr.q4_dificuldade,
               sr.q5_geral, sr.q6_nps, sr.within_deadline
          FROM eval_survey_responses sr
          JOIN eval_instances ei ON ei.id = sr.instance_id
         WHERE ($1::bigint IS NULL OR ei.cycle_id = $1)
      `, [cycleId]);
      const { computeSurveyStats } = await import('./src/lib/surveyStats.js');
      const sstats = computeSurveyStats(srRows as any[]);
      const surveyAvailable = (availRows[0] as any).count;
      const surveyResponded = srRows.length;
      const surveyWithinDeadline = (srRows as any[]).filter(r => r.within_deadline).length;
```

- [ ] **Step 2: Acrescentar os campos ao `res.json`**

No objeto do `res.json({...})`, após `evolution: evoRows`, adicionar:

```ts
        network_total: (netRows[0] as any).count,
        by_dimension_nc: (dimRows as any[]).map(r => ({
          dimension: r.dimension, nc: r.nc, total: r.total,
          rate: r.total ? Math.round((r.nc / r.total) * 100) : 0,
        })),
        top_nc_criteria: topNcRows,
        action_plans: { open: apOpen, overdue: apOverdue, concluded: apConcluded },
        survey_engagement: {
          available: surveyAvailable,
          responded: surveyResponded,
          response_rate: surveyAvailable ? Math.round((surveyResponded / surveyAvailable) * 100) : 0,
          within_deadline_rate: surveyResponded ? Math.round((surveyWithinDeadline / surveyResponded) * 100) : 0,
          nps: sstats.nps.score,
          csat: sstats.csat.q5,
        },
```

- [ ] **Step 3: Typecheck**

Run: `"/c/Program Files/nodejs/npm" run lint`
Expected: sem erros novos.

- [ ] **Step 4: Verificar a forma no banco de dev (não há teste de integração no repo)**

Confirme `APP_ENV=dev` (`grep -E '^\s*APP_ENV' .env`). Crie `db/_dash_tmp.ts`, rode e apague:

```ts
import { query, pool } from './db.js';
import { computePlanStatus } from '../src/lib/actionPlan.js';
import { computeSurveyStats } from '../src/lib/surveyStats.js';
(async () => {
  const cyc = 3; // ciclo ativo 'teste'
  const net = (await query(`SELECT COUNT(*)::int c FROM provider_locations pl JOIN providers p ON p.id=pl.provider_id
     WHERE p.eval_script_id IS NOT NULL AND COALESCE(pl.label,'') NOT ILIKE 'residencial%' AND COALESCE(pl.sgu_location_code,'') !~ '-RES$'`)).rows[0].c;
  const addrEval = (await query("SELECT COUNT(DISTINCT ei.location_id)::int c FROM eval_instances ei WHERE ei.location_id IS NOT NULL AND ei.cycle_id=$1", [cyc])).rows[0].c;
  const dim = (await query(`SELECT CASE WHEN eq.dimension IN ('Segurança','Documento Legal') THEN 'Segurança' ELSE eq.dimension END AS dimension,
      COUNT(*) FILTER (WHERE ea.is_non_compliant)::int nc, COUNT(*)::int total
      FROM eval_answers ea JOIN eval_questions eq ON eq.id=ea.question_id JOIN eval_instances ei ON ei.id=ea.instance_id
      WHERE eq.dimension IS NOT NULL AND ei.cycle_id=$1 GROUP BY 1 ORDER BY nc DESC`, [cyc])).rows;
  const top = (await query(`SELECT eq.code question_code, eq.text question_text, COUNT(*)::int count
      FROM eval_answers ea JOIN eval_questions eq ON eq.id=ea.question_id JOIN eval_instances ei ON ei.id=ea.instance_id
      WHERE ea.is_non_compliant AND ei.cycle_id=$1 GROUP BY eq.code, eq.text ORDER BY count DESC LIMIT 8`, [cyc])).rows;
  const sr = (await query(`SELECT sr.q1_clareza,sr.q2_portal,sr.q3_documentos,sr.q4_dificuldade,sr.q5_geral,sr.q6_nps,sr.within_deadline
      FROM eval_survey_responses sr JOIN eval_instances ei ON ei.id=sr.instance_id WHERE ei.cycle_id=$1`, [cyc])).rows;
  console.log('network_total (endereços com roteiro)', net, '| addresses_evaluated', addrEval);
  console.log('by_dimension_nc', dim.map((r:any)=>({...r, rate: r.total?Math.round(r.nc/r.total*100):0})));
  console.log('top_nc_criteria', top);
  console.log('survey', { responded: sr.length, nps: computeSurveyStats(sr as any).nps.score, csat: computeSurveyStats(sr as any).csat.q5 });
  await pool.end();
})();
```
Run: `"/c/Program Files/nodejs/node" --import tsx db/_dash_tmp.ts` then delete it.
Expected: `network_total` > 0; `by_dimension_nc` com `rate` 0–100; `top_nc_criteria` ordenado desc; `survey` com nps/csat numéricos ou null. Sem exceção.

- [ ] **Step 5: Commit**

```bash
git add server.ts
git commit -m "feat(dashboard): campos P1 no /eval/dashboard (cobertura, dimensao, planos, pesquisa)"
```

---

## Task 2: Frontend — reescrever os blocos do `GestorDashboard`

**Files:**
- Modify: `src/pages/qualificacao/GestorDashboard.tsx`

**Interfaces:**
- Consumes: os campos da Task 1 + os já existentes.

- [ ] **Step 1: Faixa de KPIs (5) — manter "Total de Avaliações", remover o card cru de Não Conformidades**

Primeiro, adicionar `MapPin` ao import do lucide (a linha `import { Building2, CheckCircle, TrendingUp, AlertTriangle, Award, Search, ArrowRight } from 'lucide-react';`) → incluir `MapPin`.

Substituir o bloco `{/* Main indicators */}` inteiro (o `<div className="grid ... lg:grid-cols-4 gap-6">…</div>` com os 4 `StatCard` atuais) por 5 cards — **mantendo o "Total de Avaliações" original com seu subtítulo** e removendo o card "Não Conformidades":

```tsx
          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
            <StatCard icon={Building2} iconBg="bg-blue-50" iconColor="text-blue-600" label="Total de Avaliações" value={data.total}>
              {(() => {
                const byStatus: any[] = data.by_status || [];
                const countOf = (s: string) => Number(byStatus.find((r) => r.status === s)?.count || 0);
                const finalizadas = countOf('finalizado') + countOf('aprovado');
                const pendentes = countOf('pendente');
                const provs = Number(data.providers_evaluated || 0);
                const total = Number(data.total || 0);
                const parts: string[] = [];
                if (finalizadas > 0) parts.push(`${finalizadas} ${finalizadas === 1 ? 'finalizada' : 'finalizadas'}`);
                if (pendentes > 0) parts.push(`${pendentes} ${pendentes === 1 ? 'pendente' : 'pendentes'}`);
                if (provs > 0 && provs < total) parts.push(`em ${provs} ${provs === 1 ? 'prestador' : 'prestadores'}`);
                return parts.length ? <p className="mt-1 text-xs text-gray-500">{parts.join(' · ')}</p> : null;
              })()}
            </StatCard>

            <StatCard icon={MapPin} iconBg="bg-indigo-50" iconColor="text-indigo-600" label="Cobertura da rede"
              value={`${Number(data.addresses_evaluated || 0)} / ${Number(data.network_total || 0)}`}>
              {(() => {
                const net = Number(data.network_total || 0);
                const pct = net ? Math.round((Number(data.addresses_evaluated || 0) / net) * 100) : 0;
                return (
                  <div className="mt-2">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{pct}% dos endereços com roteiro</p>
                  </div>
                );
              })()}
            </StatCard>

            <StatCard icon={CheckCircle} iconBg="bg-emerald-50" iconColor="text-emerald-600" label="Endereços qualificados"
              value={(() => {
                const net = Number(data.network_total || 0);
                const pct = net ? Math.round((Number(data.addresses_qualified || 0) / net) * 100) : 0;
                return `${Number(data.addresses_qualified || 0)} (${pct}%)`;
              })()} />

            <StatCard icon={TrendingUp} iconBg="bg-purple-50" iconColor="text-purple-600" label="Score médio"
              value={`${Number(data.avg_score).toFixed(1)}%`} />

            <StatCard icon={AlertTriangle} iconBg={data.action_plans?.overdue > 0 ? 'bg-red-50' : 'bg-gray-50'}
              iconColor={data.action_plans?.overdue > 0 ? 'text-red-600' : 'text-gray-500'} label="Planos de ação atrasados"
              value={Number(data.action_plans?.overdue || 0)}>
              <p className="mt-1 text-xs text-gray-500">
                {Number(data.action_plans?.open || 0)} abertos · {Number(data.action_plans?.concluded || 0)} concluídos
              </p>
            </StatCard>
          </div>
```

- [ ] **Step 2: Funil de andamento do ciclo**

Adicionar, logo após a faixa de KPIs, o bloco do funil. Primeiro um helper no topo do arquivo (após `fmtMonth`):

```tsx
const FUNNEL: { key: string; label: string; color: string }[] = [
  { key: 'pendente',             label: 'Não iniciado',    color: 'bg-gray-400' },
  { key: 'em_andamento',         label: 'Em preenchimento', color: 'bg-blue-500' },
  { key: 'em_analise',           label: 'Em análise',      color: 'bg-amber-500' },
  { key: 'aguardando_evidencia', label: 'Devolvido',       color: 'bg-orange-500' },
  { key: 'concluido',            label: 'Concluído',       color: 'bg-emerald-500' },
];
// Conta por estado a partir de by_status; 'concluido' agrega aprovado/reprovado/finalizado.
function funnelCounts(byStatus: any[]): Record<string, number> {
  const c = (s: string) => Number((byStatus || []).find((r: any) => r.status === s)?.count || 0);
  return {
    pendente: c('pendente'), em_andamento: c('em_andamento'), em_analise: c('em_analise'),
    aguardando_evidencia: c('aguardando_evidencia'),
    concluido: c('aprovado') + c('reprovado') + c('finalizado'),
  };
}
```

E o bloco (após o grid de KPIs):

```tsx
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Andamento do ciclo</h3>
            {(() => {
              const counts = funnelCounts(data.by_status);
              const max = Math.max(1, ...FUNNEL.map(f => counts[f.key]));
              return (
                <div className="space-y-3">
                  {FUNNEL.map(f => (
                    <div key={f.key} className="flex items-center gap-3">
                      <span className="w-32 shrink-0 text-sm text-gray-600">{f.label}</span>
                      <div className="h-6 flex-1 overflow-hidden rounded bg-gray-100">
                        <div className={`h-full ${f.color}`} style={{ width: `${(counts[f.key] / max) * 100}%` }} />
                      </div>
                      <span className="w-10 shrink-0 text-right text-sm font-bold tabular-nums text-gray-900">{counts[f.key]}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
```

- [ ] **Step 3: Onde a rede falha (dimensão + top critérios)**

Adicionar como um grid de 2 colunas (após o funil):

```tsx
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Não-conformidade por dimensão</h3>
              {(data.by_dimension_nc || []).length === 0 ? (
                <p className="text-sm text-gray-400">Sem respostas avaliadas ainda.</p>
              ) : (
                <div className="space-y-3">
                  {(data.by_dimension_nc || []).map((d: any) => (
                    <div key={d.dimension} className="flex items-center gap-3">
                      <span className="w-40 shrink-0 truncate text-sm text-gray-600" title={d.dimension}>{d.dimension}</span>
                      <div className="h-6 flex-1 overflow-hidden rounded bg-gray-100">
                        <div className="h-full bg-red-500" style={{ width: `${d.rate}%` }} />
                      </div>
                      <span className="w-14 shrink-0 text-right text-sm font-bold tabular-nums text-gray-900">{d.rate}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Critérios mais reprovados</h3>
              {(data.top_nc_criteria || []).length === 0 ? (
                <p className="text-sm text-gray-400">Nenhuma não-conformidade registrada.</p>
              ) : (
                <ul className="space-y-2">
                  {(data.top_nc_criteria || []).map((t: any) => (
                    <li key={t.question_code} className="flex items-start gap-3">
                      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-gray-600">{t.question_code}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-700" title={t.question_text}>{t.question_text}</span>
                      <span className="shrink-0 text-sm font-bold text-red-600">{t.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
```

- [ ] **Step 4: Engajamento na pesquisa**

Adicionar (após o bloco anterior; antes de Evolução/Selos, ou depois — livre):

```tsx
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Engajamento na Pesquisa de Satisfação</h3>
            {(() => {
              const e = data.survey_engagement || {};
              return (
                <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
                  <div>
                    <p className="text-sm text-gray-500">Taxa de resposta</p>
                    <p className="text-2xl font-bold text-gray-900">{Number(e.response_rate || 0)}%</p>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Number(e.response_rate || 0)}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{Number(e.responded || 0)} de {Number(e.available || 0)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Respondidas no prazo</p>
                    <p className="text-2xl font-bold text-gray-900">{Number(e.within_deadline_rate || 0)}%</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">NPS</p>
                    <p className="text-2xl font-bold text-gray-900">{e.nps == null ? '—' : e.nps}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">CSAT (geral)</p>
                    <p className="text-2xl font-bold text-gray-900">{e.csat == null ? '—' : `${e.csat}/5`}</p>
                  </div>
                </div>
              );
            })()}
          </div>
```

- [ ] **Step 5: Manter Evolução (linha) e Selos (pizza); remover o Ranking Top**

Os dois blocos existentes de gráfico (`Evolução do Nível de Conformidade` e `Classificação da Rede (Selos)`) **permanecem** como estão. O bloco da tabela **"Ranking Top Prestadores"** sai do P1 (será substituído por "Precisam de atenção" no P2) — remover esse `<div>` da tabela inteira, incluindo o botão morto "Ver todos". Remover os imports que ficarem sem uso (`Search`, `ArrowRight`) — deixar o `tsc` limpo.

- [ ] **Step 6: Typecheck**

Run: `"/c/Program Files/nodejs/npm" run lint`
Expected: sem erros. Ajuste imports não usados até passar.

- [ ] **Step 7: Verificar no preview (dev)**

Subir o dev server, logar como staff (admin/auditoria), abrir a aba Estratégico:
- KPIs mostram Cobertura `X / N (%)`, Qualificados `(%)`, Score, Planos atrasados.
- Funil com os 5 estados e contagens; sem "ciclo_encerrado".
- Blocos de dimensão (barras vermelhas com %) e critérios reprovados.
- Engajamento da pesquisa com taxa de resposta/no prazo/NPS/CSAT.
- Trocar o filtro de ciclo atualiza tudo.

- [ ] **Step 8: Commit**

```bash
git add src/pages/qualificacao/GestorDashboard.tsx
git commit -m "feat(dashboard): Estrategico com cobertura, funil, onde-falha e engajamento (P1)"
```

---

## Self-Review

**Cobertura da spec (P1):**
1. KPI Cobertura `endereços avaliados / network_total (%)` — Task 2 Step 1 (`addresses_evaluated` / `network_total`); "Total de Avaliações" mantido. ✅
2. Funil com 5 estados na ordem, sem `ciclo_encerrado` — Task 2 Step 2 (`FUNNEL`/`funnelCounts`). ✅
3. Não-conformidade por dimensão + top critérios (some o card cru) — Task 1 (`by_dimension_nc`,`top_nc_criteria`) + Task 2 Steps 1/3. ✅
4. Engajamento da pesquisa (taxa + NPS/CSAT) — Task 1 (`survey_engagement`) + Task 2 Step 4. ✅
5. KPI Planos atrasados — Task 1 (`action_plans`) + Task 2 Step 1. ✅
6. Tudo respeita `?cycle_id=` — todas as queries usam `$1`. ✅

**Placeholders:** nenhum "TBD/etc." — SQL e JSX completos.

**Consistência de tipos:** nomes dos campos (`network_total`, `by_dimension_nc.rate`, `action_plans.overdue`, `survey_engagement.response_rate/nps/csat`, `top_nc_criteria.question_code/question_text`) idênticos entre Task 1 (produz) e Task 2 (consome). `eq.code`/`eq.text` conferidos no schema. `computePlanStatus`/`computeSurveyStats` usados com as assinaturas reais.

**Decisão:** "Qualificados" = % da **rede** (`approved/network_total`), conforme aprovado na spec.

---

## Execution Handoff

Plano salvo em `docs/superpowers/plans/2026-08-13-dashboard-qualificacao-estrategico-p1.md`. Duas opções:

**1. Subagent-Driven (recomendado)** — 1 subagente por task + review entre elas.
**2. Inline** — executo nesta sessão com checkpoints.

Qual abordagem?
