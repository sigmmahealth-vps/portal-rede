# Melhorias no Plano de Ação — visão staff (UI) — Design

**Data:** 2026-08-10
**Escopo:** só frontend — `src/pages/qualificacao/QualificacaoStaff.tsx` e
`src/pages/qualificacao/PlanosBoard.tsx`. Nenhuma mudança de API ou banco.

## Objetivo

Alinhar a tela "Plano de Ação" do staff (admin/auditoria) ao visual do restante do
portal: abas com ícones no estilo do prestador, botão "+ Novo Plano" no padrão da
casa, filtros agrupados num painel recolhível e cards de status para todas as
colunas do kanban.

## Decisões de produto (validadas com o usuário)

1. **Abas:** adotar o estilo pill do `PrestadorView` (bandeja com ícones, aba ativa
   em verde sólido). Mantêm-se as 4 abas atuais — só muda o visual.
2. **Filtros:** botão "Filtros" recolhível (outline + funil), não régua fixa.
   Campos: Ciclo, Status e Prestador (busca por nome **ou** código). A busca livre
   continua sempre visível fora do painel.
3. **Cards de status:** 5 cards espelhando as colunas do kanban (não 7 por status
   individual), **apenas informativos** (sem clique-filtro).
4. **Botão:** texto "Novo Plano" (era "Novo plano avulso").

## Estado atual (referências)

- `QualificacaoStaff.tsx:9-14` — TABS texto puro; barra sublinhada em `:38-54`;
  sincroniza `?aba=<slug>` na URL (`:20-32`).
- `PlanosBoard.tsx` — select de ciclo solto no cabeçalho (`:97-107`); botão
  "Novo plano avulso" com classes **mortas** `btn btn-primary` (`:108-110` — não
  existem no CSS, renderiza sem estilo; mesmo problema nos botões do modal
  `:176-177`); 3 KPIs (`:114-118`); busca (`:120-129`); kanban 5 colunas
  (`:131-149`, grupos em `:9-15`).
- Cores de status de plano: `planoStatus.ts:2-14` (`PLAN_COLOR_CLASS`, tokens
  verde/azul/laranja/vermelho/cinza vindos do servidor).
- Padrão "+ Novo": `CiclosAdmin.tsx:60-66` (`bg-[#00995D]`, hover `#007A4A`,
  ícone `Plus`).
- Padrão de pill de abas: `PrestadorView.tsx:315-330`.

## Design

### 1. Abas com ícones (`QualificacaoStaff.tsx`)

- TABS ganham campo `icon` (lucide): Estratégico `TrendingUp`, Painel do Ciclo
  `LayoutGrid`, Ciclos `CalendarRange`, Plano de Ação `Target`.
- Barra substituída pela bandeja pill do prestador (mesmas classes de
  `PrestadorView.tsx:315-330`): container `flex gap-1 overflow-x-auto rounded-xl
  border border-gray-200 bg-white p-1.5 shadow-sm`; aba ativa
  `bg-emerald-500 text-white shadow-sm`; inativa `text-gray-600 hover:bg-gray-50`.
- Sincronização com `?aba=` e default por papel não mudam.

### 2. Botão "+ Novo Plano" (`PlanosBoard.tsx`)

- Substituir `btn btn-primary` por:
  `flex items-center gap-2 bg-[#00995D] text-white px-4 py-2 rounded-lg
  hover:bg-[#007A4A] transition-colors` + `<Plus className="w-5 h-5" />` +
  texto **"Novo Plano"**.
- Modal de novo plano: "Cancelar" vira outline padrão
  (`rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700
  hover:bg-gray-50`) e "Criar" vira o mesmo verde do botão principal.

### 3. Painel "Filtros" (`PlanosBoard.tsx`)

- Sai o select de ciclo do cabeçalho.
- Linha de controles: busca livre (como está) + botão outline **"Filtros"**
  (`Filter` do lucide). Clicar alterna a exibição do painel (estado local
  `showFilters`).
- Painel (card branco `rounded-xl border`) com grid de 3 campos:
  - **Ciclo** — select sobre `cycles` (default: ciclo ativo; comportamento de
    carga atual não muda — trocar ciclo refaz o fetch de planos).
  - **Status** — select "Todos" + os 7 status de `PLAN_STATUS_LABEL`
    (`planoStatus.ts:2-7`); filtra client-side por `plan.status`.
  - **Prestador** — combobox: input de texto que filtra sugestões por
    `provider_name` ou `provider_code` (case-insensitive) sobre os planos já
    carregados do ciclo (sem fetch extra; lista deduplicada por prestador).
    Selecionar fixa `providerFilter` (id); um "×" limpa.
- Botão "Filtros" mostra contador de filtros ativos além do ciclo (ex.:
  "Filtros · 2" quando status + prestador ativos). Link "Limpar" aparece quando
  contador > 0 e zera status/prestador (ciclo volta ao ativo).
- Busca livre e filtros compõem (E lógico), tudo client-side como hoje.

### 4. Cards de status (5, informativos)

Substituem os 3 KPIs atuais. Um card por coluna do kanban (grupos de
`PlanosBoard.tsx:9-15`), com o esquema de cores existente:

| Card | Status agrupados | Tom |
|------|------------------|-----|
| Abertos | aberto, em_andamento | azul |
| Aguardando revisão | aguardando_revisao | laranja |
| A vencer | a_vencer | âmbar |
| Atrasados | atrasado | vermelho |
| Finalizados | concluido, encerrado_sem_conclusao | verde |

- Visual: componente `Kpi` local existente (`:210-223`), estendido com os tons
  que faltarem (âmbar, verde) — ícone em círculo + label + contagem.
- Contagens refletem o conjunto **filtrado** (coerente com o board abaixo).
- Grid responsivo `grid-cols-2 md:grid-cols-3 lg:grid-cols-5`.
- Sem interação de clique.

## Tratamento de erros

Nada novo — sem novas chamadas de API. Filtro/combobox operam sobre dados já
carregados; estados de carregamento e erro da tela não mudam.

## Testes

Sem testes novos: mudança 100% de UI num projeto sem testes de componente; a
lógica de status/cores permanece em `planoStatus.ts`/`actionPlan.ts`, já cobertas.
Verificação: `npx tsc --noEmit && npm run build` + smoke manual (abas, botão,
painel de filtros com nome e com código, contadores dos 5 cards).

## Fora de escopo

- Cores por status de **item** no `PlanoDetail` (hoje pill cinza única).
- Filtro server-side (`?status=`, `?provider_id=`) — volumes atuais não pedem.
- Unificar os componentes `Kpi` duplicados entre telas.
- Aba "Certificados" para staff.
