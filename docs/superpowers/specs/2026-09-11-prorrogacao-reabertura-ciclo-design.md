# Prorrogação e reabertura de ciclo encerrado — design

**Data:** 2026-09-11
**Demanda do cliente (Qualificação → Ciclos):** o sistema permite alterar a data fim
após o término do ciclo (prorrogação), mas todos os roteiros seguem encerrados — a
prorrogação não tem efeito.

## Causa raiz

O encerramento (POST `/encerrar`, PATCH `active=false`, job auto-close) sobrescreve o
status das instâncias não-terminais com `ciclo_encerrado` sem guardar o anterior, e não
existe caminho de reabertura: editar `end_date`/reativar só mexe no ciclo, nunca nas
instâncias.

## Decisões (validadas com o usuário em 2026-09-11)

- **Botões explícitos** "Reabrir" e "Prorrogar" na lista de ciclos (não efeito colateral
  do Salvar do modal).
- **Notificação nova** `ciclo_reaberto` (sininho + e-mail) para os prestadores cujas
  avaliações forem restauradas.

## Dados

Migration `0048_eval_instances_status_before_close.sql`:

```sql
ALTER TABLE eval_instances ADD COLUMN IF NOT EXISTS status_before_close TEXT;
```

Os dois caminhos de encerramento passam a fazer `SET status_before_close = status,
status = 'ciclo_encerrado', ...` (o SET usa o valor antigo da linha — semântica do
Postgres). Job de auto-close usa `closeCycleCore` → coberto.

## Reabertura (server)

Core único `reopenCycleCore(cycleId, newEndDate?)` + rota staff
`POST /api/eval/cycles/:id/reabrir` body `{end_date?}` (Prorrogar = com `end_date`;
Reabrir = sem):

- Validações: ciclo existe; está inativo (409 se ativo); regra de 1 ciclo ativo
  (`findConflictingActiveCycle`); data fim efetiva (nova ou a atual) ≥ hoje — senão 409
  "prazo no passado — informe uma nova data fim (prorrogação)"; se `end_date` veio,
  também ≥ `start_date`.
- Transação: `UPDATE eval_cycles SET end_date (se veio), active = true`; restaura:

```sql
UPDATE eval_instances ei
   SET status = COALESCE(ei.status_before_close,
         CASE WHEN EXISTS (
                SELECT 1 FROM eval_answers a
                  JOIN eval_answer_iterations it ON it.answer_id = a.id
                 WHERE a.instance_id = ei.id AND it.actor_role = 'prestador')
              THEN 'em_andamento' ELSE 'pendente' END),
       status_before_close = NULL,
       completed_at = NULL
 WHERE ei.cycle_id = $1 AND ei.status = 'ciclo_encerrado'
 RETURNING ei.provider_id
```

  Fallback (`CASE`) é só para instâncias legadas encerradas antes da migration; terminais
  (`aprovado`/`reprovado`/`finalizado`) intocadas.
- Audit `cycle_reopened` (meta: `cycle_id`, `restored`, `end_date`).
- Notificação `ciclo_reaberto` fire-and-forget para os prestadores restaurados
  (`notifyEvent` + `prestadorRecipients`, padrão do `openCycleCore`).

## Porta trapaceira fechada

PATCH `active: true` num ciclo **inativo** que tem instâncias `ciclo_encerrado` → 409
"ciclo encerrado com avaliações — use Reabrir ou Prorrogar". Sem isso o botão "Ativar" da
lista e o checkbox do modal continuariam reativando sem restaurar (a raiz da reclamação).

## Notificação

`notifyCatalog.ts`: novo tipo `ciclo_reaberto`, ctx `{cycle_label, end_date}`:
título "Ciclo {label} reaberto — prazo prorrogado"; corpo "O ciclo de qualificação foi
reaberto e você pode concluir sua avaliação até {end_date}." + caso no
`notifyCatalog.test.ts`.

## UI

- **CiclosAdmin**: ciclo inativo com `instances_count > 0` → em vez do link "Ativar",
  dois botões: **Reabrir** (confirm "as avaliações encerradas serão reabertas"; POST sem
  end_date; 409 de prazo no passado → alert sugerindo Prorrogar) e **Prorrogar**
  (mini-modal com date input ≥ hoje; POST com end_date). Resposta mostra
  "N avaliação(ões) reaberta(s)". Ciclo nunca aberto mantém o "Ativar" atual.
- **NovoCicloModal**: para ciclo encerrado com instâncias, o checkbox "Ativar este ciclo"
  some (não envia `active`), com dica "Ciclo encerrado — use Reabrir/Prorrogar na lista
  de ciclos".

## Não muda

- Validade dos certificados (0039) segue congelada — prorrogação não a altera.
- Editar Fim de ciclo **ativo** continua livre (prorrogação natural, nada a restaurar).
- ⚠️ Migration 0048 obrigatória ao promover homolog/prod.

## Verificação

- `npm run lint` + suíte (`npm test`, incluindo caso novo do catálogo).
- Dry-run transacional no banco dev (encerrar → conferir `status_before_close` → reabrir
  → status restaurados, terminais intactos, ROLLBACK).
- Click-through autenticado fica com o usuário (sem credenciais staff para o agente).
