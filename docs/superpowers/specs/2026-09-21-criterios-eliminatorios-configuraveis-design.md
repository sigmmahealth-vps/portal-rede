# Critérios eliminatórios configuráveis por roteiro — design

Data: 21/09/2026 · Origem: sessão de grilling com a Katy · Status: implementado no dev em 21/09/2026 (c9479eb..0f598ce); marcações de homolog/prod são refeitas à mão na promoção.

## Problema

Hoje só o parser decide o que é eliminatório (`db/roteiro-parser.ts:251`: dimensão
"Documento Legal" ou seção com "eliminatório/mandatório" no nome). Não existe
caminho de escrita para `eval_questions.is_eliminatory` além do import. A Unimed
quer que `admin` e `auditoria` escolham os eliminatórios de cada roteiro.

Estado de partida (dev): todos os DL marcados (inclui CNES); FOR-024 (Hospitais)
tem **zero** eliminatórios porque seus alvarás estão na dimensão "Segurança".

## Decisões

| # | Decisão |
|---|---|
| Q1 | "Eliminatório" é marcação do critério, independente da dimensão. Glossário em `CONTEXT.md`. |
| Q2 | Documento Legal pode ser desmarcado. Sem piso fixo. |
| Q3 | Obrigatoriedade no plano de ação e teto Bronze por plano pendente de ciclo anterior passam a seguir a marcação, não `dimension = 'Documento Legal'`. DL bypass segue por `document_type` (inalterado). |
| Q4 | Sem snapshot por ciclo. **Trava**: edição bloqueada enquanto o roteiro tiver avaliação em ciclo aberto. Memória de cálculo de ciclos fechados não é congelada (o selo gravado não muda). |
| Q5/Q8 | Revisão de roteiro **herda** as marcações da versão vigente, casando por `code` + texto normalizado (`code` sozinho não é único: 6 de 15 planilhas têm repetição, e pode ser NULL). O que não casar nasce desmarcado e aparece no preview do import como "revisar". |
| Q6 | Roles: `admin` e `auditoria` (mesmo guard da aba Roteiros). |
| Q7 | Uma tela "Critérios eliminatórios" por roteiro (lista por seção, checkbox por critério, filtro por dimensão), acessível na aba Roteiros — inclusive versões anteriores — e destino do redirect ao concluir o import. Um endpoint PATCH. |
| Q9/Q14 | Teto Bronze por plano pendente usa a marcação **atual** do critério via `eval_action_items.answer_id → eval_answers → eval_questions`. Sem `answer_id` (ON DELETE SET NULL): fallback `dimension = 'Documento Legal'`. |
| Q10 | Roteiro sem nenhum eliminatório é permitido; aviso na tela + alerta em `RoteiroAlerts`. |
| Q11 | Sem notificação ao prestador (o badge "Eliminatório" do `RoteiroPlayer` já reflete a marcação; a trava impede mudança com avaliação aberta). Remover badge morto `q.type === 'DL'` (`RoteiroPlayer.tsx:742`). |
| Q13 | A planilha `CRITÉRIOS ELIMINATÓRIOS PRP.xlsx` **não** entra no sistema. Marcação 100% manual na tela. |
| Q16 | Roteiro inédito nasce **sem nenhum** eliminatório: o parser deixa de marcar (`isEliminatory` sempre `false`; cai também a regra do nome de seção). Dados já existentes no banco não são alterados. |

Auditoria: toda alteração grava `auditLog()` (`auth/auditLog.ts`) com quem, critério,
de→para. Aproveitar para auditar import e exclusão de roteiro (hoje não auditados).

## Limitações conhecidas (marcar com `ponytail:` no código)

- Q9-B lê a flag da **versão do roteiro usada naquele ciclo**. Depois da primeira
  revisão importada, desmarcar na versão nova não alcança planos antigos; contorno:
  editar a versão anterior na tela. Upgrade: congelar `is_eliminatory` em
  `eval_action_items` na geração do plano.
- Marcar é retroativo sobre planos pendentes de ciclos anteriores.
- A trava cobre só avaliações ligadas a um ciclo ativo. Instância criada fora de
  ciclo (`eval_instances.cycle_id` NULL, em andamento) não trava a marcação —
  leitura literal da Q4; alargar é uma query (`eliminatoryLocked` em `server.ts`).
- Os eventos de auditoria novos (`eval_eliminatory_changed`, `eval_script_imported`,
  `eval_script_deleted`) ficam só em `access_logs`; nenhuma tela os lista ainda.

## Fora do escopo

Snapshot por ciclo; notificação; planilha como fonte; coluna "tipo doc" →
`document_type`.

## Migrations

Nenhuma.

## Promoção homolog/prod

Sem script de carga: as marcações são **ajustadas à mão em cada ambiente**. Homolog
e prod chegam com todos os DL já marcados (migration 0033), então o trabalho é:
marcar os alvarás/ART do FOR-024 (hoje sem nenhum eliminatório), revisar CNES e os
DL do FOR-011, e conferir que nenhum roteiro mostra o alerta "Sem critérios
eliminatórios" sem querer. Entrar no checklist de promoção.

## Pendência à parte

Verificar se o DL bypass alcança hospitais (alvarás do FOR-024 em "Segurança").
