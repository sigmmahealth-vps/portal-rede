# Gestão Documental — Painel: métricas de Certificações e Escolaridade — Design

**Data:** 2026-11-18
**Status:** aprovado (desenho) — pendente revisão da spec escrita

## Contexto e objetivo

As sub-abas **"Certificações e Dados Técnicos"** (`cert`) e **"Escolaridade"** (`escol`) do Painel
de Controle (`PainelControle.tsx`) são stubs `<EmBreve/>`. Agora que Certificações e Escolaridade
têm dados reais (fatias anteriores), esta fatia preenche as duas com métricas, no mesmo padrão das
abas Overview/Alvarás (cards + gráficos + conformidade, agregação no cliente, recorte por audiência
Médicos/Rede). A parte **Dados Técnicos** continua bloqueada (sem dados) e fica como "em breve"
dentro da aba `cert`.

### Fora de escopo
- **Dados Técnicos** (CNES/ISS/Prontuário) — bloqueado.
- Tendências temporais, exportação, drill-down por prestador (o **Verificar** já lista faltantes).

## Dados — endpoint admin agregado

Os endpoints de listagem (`GET /api/certifications`, `/api/education`) são **só-prestador**. Para
métricas globais, novo endpoint:

`GET /api/admin/atributos-metrics` (`authenticate, requireAdmin`) →
```json
{
  "certifications": [{ "status": "...", "expiry_date": "YYYY-MM-DD|null", "person_type": "PF|PJ", "provider_group": "..." }],
  "education":      [{ "status": "...", "nivel": "graduacao", "person_type": "...", "provider_group": "..." }]
}
```
Cada linha junta `providers` para trazer `person_type`/`provider_group` (recorte por audiência no
cliente, via `providerAudience`). SQL: `JOIN providers p ON p.id = c.provider_id`.

## Funções puras

### Certificações — reusa `painelMetrics` (já testado)
Certificação tem `status` (`pendente`/`valido`/`reprovado`) + `expiry_date`, o mesmo formato que
`situacaoDocumento` consome. Então a aba Certificações usa **`contarSituacoes`** (→ `{regular,
vencendo, irregular, pendente, total}`) e **`conformidade`** do `src/lib/painelMetrics.ts`, sem
função nova. O balde **vencendo** é o "a vencer" (válida com validade nos próximos 30 dias).

### Escolaridade — `src/lib/atributosMetrics.ts` (novo, testado)
Escolaridade não tem validade; usa contagem por status próprio:
- `contarStatus(itens: { status: string }[]): { pendente, valido, reprovado, total }`.
- `conformidadeStatus(itens): number` — `valido / (valido + reprovado)` em %, 0 se nenhum;
  pendentes fora (ainda não analisados).
- `distribuicaoPorNivel(education: { nivel: string }[]): { nivel, n }[]` — contagem por nível,
  retornando **só os níveis com `n > 0`**, na ordem canônica (ensino_medio…pos_doutorado).

Testes em `src/lib/atributosMetrics.test.ts`: `contarStatus` (cada status, vazio), `conformidadeStatus`
(com/sem pendentes, divisão por zero), `distribuicaoPorNivel` (ordem canônica, só n>0, vazio).

## Telas — dentro do `PainelControle`

`PainelControle` busca o endpoint novo (uma vez, junto do `/documents` atual, ou lazy quando `cert`/
`escol` abre — decisão no plano) e passa os dados para dois componentes, filtrando por audiência:

### Aba "Certificações e Dados Técnicos"
- **4 cards**: Regulares / Vencendo / Irregulares / Pendentes (de `contarSituacoes`).
- **Donut** de conformidade (`conformidade`).
- Bloco **"Dados Técnicos — em breve"** (reusa `EmBreve` ou um card simples).

### Aba "Escolaridade"
- **3 cards**: Pendentes / Válidas / Reprovadas (de `contarStatus`).
- **Barra** (`BarChart`) de **distribuição por nível** (`distribuicaoPorNivel`, rótulos legíveis).
- **Donut** de conformidade (`conformidadeStatus`).

Gráficos com `recharts` (já usado no Painel). Rótulos de nível: o mesmo mapa de
`Escolaridade.tsx`/`EducacaoAdmin.tsx` (ensino_medio→"Ensino Médio" … pos_doutorado→"Pós-Doutorado").

## Testes
- `src/lib/atributosMetrics.test.ts` (`node:test`, no script `test`) — as três funções.
- Certificações reusam `painelMetrics` (já coberto) — sem teste novo.
- Componentes React: `tsc` + build + smoke no navegador (abrir cada sub-aba, conferir cards/gráficos
  com os dados semeados).

## Dados de teste
O DEV pode ter poucas certificações/formações (criadas no smoke). Opcional no plano: semear algumas
válidas/pendentes/reprovadas e níveis variados para os gráficos não nascerem vazios. Não bloqueia
(com dados reais já aparece algo; vazio mostra "sem dados").
