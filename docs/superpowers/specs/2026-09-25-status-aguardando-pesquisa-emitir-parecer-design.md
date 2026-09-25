# Status "Aguardando Pesquisa" e "Emitir Parecer Final" — design

**Data:** 2026-09-25 · **Origem:** pedido da cliente (Katy) · **Migration:** nenhuma

## Objetivo

Deixar claro, pelo status do roteiro, de quem é a vez depois que o auditor terminou de avaliar os critérios:

- **Aguardando Pesquisa** — o auditor já decidiu todos os critérios, mas o parecer está travado porque o prestador ainda não respondeu a Pesquisa de Satisfação e o prazo de 7 dias não venceu (spec 5.4.6).
- **Emitir Parecer Final** — nada mais trava: só falta o auditor emitir o parecer.

Sequência resultante: *Em Análise → Aguardando Pesquisa → Emitir Parecer Final → Concluído*.

## Decisões (brainstorming 25/09)

1. "Emitir Parecer Final" = todos os critérios decididos **e** pesquisa não trava mais (respondida ou 7 dias vencidos).
2. "Aguardando Pesquisa" só quando é a pesquisa que segura o parecer; enquanto o auditor ainda avalia, o status continua "Em Análise".
3. Os dois lados veem: auditor vê os dois status novos; prestador vê "Aguardando Pesquisa" e continua vendo "Em Análise" no lugar de "Emitir Parecer Final" (etapa interna da auditoria).
4. **Status calculado, não gravado** (caminho 1): nada muda em `eval_instances.status`.

## Regra — `displayStatus`

Função pura em `src/lib/auditorDashboard.ts` (ao lado de `surveyState`, que já usa o mesmo prazo):

```ts
displayStatus(
  status: string,                 // eval_instances.status gravado
  pendingCount: number,           // critérios sem decisão terminal
  submittedAt: string | null | undefined,
  hasSurveyResponse: boolean | undefined,
  now: Date,
  audience: 'auditor' | 'prestador' = 'auditor',
): string
```

| Condição | Retorno |
|---|---|
| `status` ∉ {`em_analise`, `aguardando_evidencia`} | `status` (sem mudança) |
| `pendingCount > 0` | `status` (sem mudança) |
| sem resposta **e** `submittedAt` presente **e** `isWithinDeadline(submittedAt, now)` | `aguardando_pesquisa` |
| caso contrário | `emitir_parecer` (prestador: `em_analise`) |

- **Critério decidido** = `evidence_status IN ('aprovado','reprovado','nao_se_aplica')` — a mesma lista que `POST /api/eval/instances/:id/parecer` usa. Critério em reanálise (inclusive rascunho, `aguardando_reanalise`) não está decidido.
- **Invariante:** `emitir_parecer` ⇔ o `POST .../parecer` passaria nas três travas atuais (status permitido, pesquisa liberada, sem critério pendente). Os dois usam as mesmas condições; a borda do prazo é a de `isWithinDeadline` (inclusive o instante exato dos 7 dias = ainda dentro).
- Sem `submittedAt` a pesquisa não trava (igual ao parecer hoje).

## Rótulos

Em `src/lib/statusLabels.ts` (mapa canônico, mesmo estilo Title Case dos atuais):

- `aguardando_pesquisa`: **Aguardando Pesquisa**
- `emitir_parecer`: **Emitir Parecer Final**

## Dados (servidor)

Nenhuma regra de negócio muda; só dados passam a ser devolvidos.

- **`GET /api/eval/dashboard/auditor`**: a query ganha `pending_count` por instância com **exatamente o mesmo predicado do parecer**: `COUNT(*) FROM eval_answers WHERE instance_id = ei.id AND evidence_status NOT IN ('aprovado','reprovado','nao_se_aplica')` (atenção: `NOT IN` não conta `evidence_status NULL` — mantido de propósito para a invariante valer; a lista terminal vira uma constante SQL compartilhada pelas duas queries). `buildAuditorDashboard` passa a devolver `display_status` em cada instância (`audience='auditor'`), com o `now` injetável que já existe.
- **`GET /api/eval/instances`** (lista do prestador): passa a devolver `pending_count` (mesmo predicado acima) e `has_survey_response` por instância; `submitted_at` já vem (`ei.*`). O cálculo é feito na tela com `displayStatus(..., 'prestador')`.

## Telas

**Painel do Ciclo (auditor)** — `PainelDoCiclo.tsx`:
- Pill da coluna Status e cor (`statusPill`) usam `display_status`. Cores: Aguardando Pesquisa = sky (a mesma da etiqueta de pesquisa atual); Emitir Parecer Final = cor própria de destaque (violeta).
- Filtro de status lista os `display_status` presentes, com contagem; filtrar por "Emitir Parecer Final" dá a fila do que falta fechar.
- Etiqueta "Aguardando finalização da pesquisa": só aparece quando o status mostrado é Em Análise ou Reanálise (com "Aguardando Pesquisa" ela seria repetição). "Pesquisa finalizada" permanece como está.
- Cards do topo inalterados ("Em análise" segue contando todos os enviados sem parecer).

**Prestador** — `PrestadorView.tsx` (Início / Meus Roteiros): o selo de status usa `displayStatus(..., 'prestador')`.

## Fora do escopo

Gravação de status, parecer, encerramento/reabertura de ciclo, e-mails/notificações, exportação .xlsx (não tem coluna de status), `GestorDashboard`.

## Testes

- `displayStatus` (tabela): cada linha da regra; `aguardando_evidencia` com e sem pendência; pesquisa respondida; prazo vencido; borda exata dos 7 dias (= Aguardando Pesquisa); sem `submittedAt` (= Emitir Parecer Final); status terminal/`pendente`/`ciclo_encerrado` inalterados; modo prestador troca `emitir_parecer` por `em_analise` e mantém `aguardando_pesquisa`.
- `buildAuditorDashboard`: instância com `pending_count = 0` e pesquisa respondida sai com `display_status = 'emitir_parecer'`.
