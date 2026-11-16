# Gestão Documental — Painel de Controle (Overview + Alvarás) — Design

**Data:** 2026-11-16
**Status:** aprovado (desenho) — pendente revisão da spec escrita

## Contexto e objetivo

Terceira fatia do painel admin de Gestão Documental: o **Painel de Controle** (dashboard/BI),
hoje um stub "em breve" na casca `GestaoDocumental`. Esta spec cobre as duas abas **construíveis a
partir dos documentos** que já circulam — **Overview** e **Alvarás de Prestadores** — com cards,
gráficos e taxas de conformidade.

Depende da Parte 1 (catálogo) e da fatia Investigação e Lista (statusDocumento, providerAudience,
casca com toggle Médicos/Rede), já na `dev`.

### Fora desta fatia (dependem de dados que o schema não tem)
- Card **Verificar** (documento obrigatório não enviado) e status **Isento** → precisam da Matriz
  Legal (diretriz OPS-COP-FLU-009). O 4º card desta fatia é **Pendentes** no lugar.
- Abas **Certificações e Dados Técnicos** (CNES com estados, ISS, Prontuário) e **Escolaridade** →
  atributos de prestador/profissional inexistentes. Entram como sub-abas "em breve".
- Filtros de **Município** e **Status Médico** → ficam para depois. Esta fatia usa só o toggle
  **Médicos/Rede** (da casca) como recorte.

## Métricas (funções puras testadas)

`src/lib/painelMetrics.ts`, consumindo `statusDocumento` (fatia anterior). `hoje` injetável.

- `situacaoDocumento(doc, hoje): 'regular' | 'vencendo' | 'irregular' | 'pendente' | 'historico'`
  derivada de `statusDocumento`:
  - `historico` → `historico` (excluído das contagens pelo chamador).
  - `pendente` → `pendente`.
  - `reprovado` → `irregular`.
  - `vencido` → `irregular`.
  - `aprovado` → `vencendo` se `expiry_date` existe e está nos próximos **30 dias**; senão `regular`.
- `contarSituacoes(docs, hoje): { regular, vencendo, irregular, pendente, total }` — contagem por
  situação (ignora `historico`).
- `conformidade(docs, hoje): number` — **% de documentos enviados que estão conformes**:
  - Conforme = `regular + vencendo` (documentos válidos).
  - Não conforme = `irregular`.
  - `conformidade = conforme / (conforme + irregular)` em %, 0 quando não há nenhum dos dois.
    **Pendentes não entram** (ainda não analisados).
- `baldesAlvara(docs, tipoNome, hoje): { noPrazo, aVencer, vencido }` — para os documentos cujo
  `type === tipoNome`: `noPrazo = regular`, `aVencer = vencendo`, `vencido = irregular`.
- `conformidadePorTipo(docs, tipoNome, hoje): { conforme, total, pct }` — conformidade restrita aos
  documentos daquele tipo.

Todas operam sobre documentos **de gestão documental** (`type_id != null`); o chamador já filtra
por `audiencia` (via `providerAudience`) e exclui `historico`.

## Arquitetura (frontend)

- `src/pages/documentos/PainelControle.tsx`: recebe `audiencia`, busca `GET /api/documents`
  (mesmo dado da Investigação), filtra (`type_id != null`, audiência, sem histórico) e mantém as
  **sub-abas**: **Overview** (padrão) · **Alvarás de Prestadores** · **Certificações** (stub) ·
  **Escolaridade** (stub).
- `GestaoDocumental.tsx`: no `aba === 'bi'`, renderiza `<PainelControle audiencia={audiencia} />`
  no lugar do `<EmBreve titulo="Painel de Controle" />`.
- Gráficos com **`recharts`** (já é dependência): `BarChart` e `PieChart` (donut).

### Aba Overview
- **4 cards** (componente `StatCard`: rótulo, número, cor): Regulares · Irregulares · Vencendo · Pendentes.
- **Barra** (`BarChart`): Documentos Regulares × Irregulares (duas colunas com a contagem).
- **Donut** (`PieChart` com `innerRadius`): Taxa de Conformidade (% `conformidade`), com o número no centro.
- **Tiles de conformidade por alvará**: para Alvará Sanitário, Alvará de Localização, Alvará do Corpo
  de Bombeiros — `conformidadePorTipo` de cada um, como um bloco "nome + %".

### Aba Alvarás de Prestadores
- Para cada alvará (**Alvará Sanitário**, **Alvará de Localização**, **Alvará do Corpo de Bombeiros**):
  um **`BarChart` horizontal** com os baldes **No Prazo / A Vencer / Vencido** (`baldesAlvara`).
- **Donut** de **Taxa de Conformidade Geral de Alvarás**: `conformidade` restrita aos documentos
  cujo tipo é um dos três alvarás.

## Nomes de tipo usados
Os três alvarás são casados por `doc.type` (nome do catálogo): `'Alvará Sanitário'`,
`'Alvará de Localização'`, `'Alvará do Corpo de Bombeiros'`. Os tiles de "Certificados" do Overview
ficam de fora nesta fatia (não há um tipo único de certificado no catálogo ainda) — ou, se incluído,
usa o tipo `'Outros'` como aproximação; **decisão: deixar só os 3 alvarás + a conformidade geral**.

## Dados de teste
O `db/seed-documentos.ts` será estendido para distribuir documentos pelos 3 prestadores cobrindo as
4 situações (regular, vencendo, irregular, pendente), para o dashboard mostrar números visíveis.

## Testes
- `src/lib/painelMetrics.test.ts` — `situacaoDocumento` (cada ramo, incl. vencendo ≤30d e a borda de
  30 dias), `contarSituacoes`, `conformidade` (com/sem pendentes, divisão por zero), `baldesAlvara`,
  `conformidadePorTipo`. `node:test`, incluído no script `test`.
- Os componentes React não têm harness no repo — verificados por `tsc` + build + smoke no navegador.

## Fora de escopo (reforço)
Card Verificar, status Isento, abas Certificações/Escolaridade, filtros Município/Status Médico,
endpoint de agregação no servidor (agregação é no cliente nesta fatia).
