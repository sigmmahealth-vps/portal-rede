# PRODUCT.md — Portal da Rede de Prestadores (Unimed Criciúma)

**Register:** product (UI serve à tarefa — portal autenticado, formulários, dashboards, tabelas).

**O que é:** Portal web para a operadora Unimed Criciúma gerir sua rede de prestadores credenciados sob a RN 630 (ANS). Perfis: **admin** (gestor da operadora), **auditoria** (analista técnico), **prestador** e **cooperado** (a rede). Stack: React 18 + Vite + TypeScript + Tailwind v4 (`@theme`), backend Express (`server.ts`) + Postgres.

**Usuários e cenário:** profissionais em escritório, luz de ambiente de trabalho, foco em tarefa longa e burocrática (responder/auditar roteiros de qualificação, gerir documentos, contratos). Confiabilidade e clareza > espetáculo. A ferramenta some na tarefa (familiaridade conquistada, padrão Linear/Stripe).

**Módulo em foco (5.4.3 — Roteiros de Qualificação):** o prestador responde um roteiro (checklist hierárquico Seção > Subseção > Critério) da RN 630; cada critério é Sim/Não/N-A + evidência, com dimensão (Segurança/Conforto/Experiência), peso, eliminatório e base legal. Admin e auditoria acompanham por dashboard. Selo (Bronze/Prata/Ouro) sai no fluxo do auditor.

## Identidade visual (comprometida — preservar)

Tokens oficiais em `src/index.css` (`@theme`, escalas mapeadas p/ nomes Tailwind):
- **emerald** = Verde Principal Unimed (Pantone 348c), oficial `#00995d` (500); primário de ações/seleção/estado positivo.
- **secondary** = Verde escuro/teal (Pantone 7722c) `#004e4c`; texto tinta (`secondary-900`) e camada de painéis.
- **accent** = Verde limão (Pantone 381c) `#b1d34b`; uso pontual.
- **orange** `#f47920` (Pantone 1585c); alertas/atenção.
- Apoio pastel (brown/pink/beige/yellow/palegreen/lightblue) p/ categorização leve.
- Fonte: `UnimedFont` (fallback Inter). Body bg `#f8fafc`, texto `secondary-900`.

**Estratégia de cor:** Restrained — neutros + emerald como acento de ação/seleção/estado; não decorar com saturação. Camada neutra secundária para rails/painéis.

## Convenções

- Ícones: `lucide-react`. Componentes: `src/components/` (Layout, RightSidebar), páginas em `src/pages/`, módulo em `src/pages/qualificacao/`.
- Estados de componente obrigatórios: default/hover/focus/active/disabled/loading/error. Skeleton no lugar de spinner no meio de conteúdo. Empty states que ensinam.
- Motion 150–250ms, transmite estado, respeita `prefers-reduced-motion`. Sem modal por reflexo — preferir fluxo inline/progressivo.
