# Reprovar critério em reanálise e emitir parecer — design

**Data:** 2026-09-11
**Demanda do cliente:** "Quando o auditor clicar em reprovar o item deve receber valor 0
e é uma resposta válida e não pode travar a emissão do parecer."

## Problema (o deadlock atual)

Cenário: auditor devolveu critério(s) para reanálise e o prestador não responde.

1. Critério `aguardando_reanalise` só aceita "ajustar orientação" — `auditorAction`
   rejeita `reprovou`/`aprovou`/`marcou_na` (409 "só é possível ajustar a orientação").
2. Mesmo decidindo tudo, `POST /instances/:id/parecer` exige `status === 'em_analise'`
   — após a devolução a instância está `aguardando_evidencia` → 409 de status.

Resultado: avaliação presa até o encerramento do ciclo.

## Decisões (usuário aprovou em 2026-09-11)

1. **Reprovar liberado em critério devolvido**: `auditorAction('reprovou')` passa a
   aceitar `evidence_status='aguardando_reanalise'` — justificativa obrigatória (regra
   já existente), score 0, decisão terminal. `aprovou`/`marcou_na` continuam bloqueados
   com a bola no prestador (mensagem: "reprove ou ajuste a orientação").
2. **Parecer aceita `aguardando_evidencia`**: a trava real do parecer já é "todos os
   critérios com decisão terminal" — satisfeita, não sobra nada editável pelo prestador,
   então o status da devolução não pode impedir. Sem lógica de flip de status de volta
   (menor mudança que elimina o deadlock, inclusive quando o prestador respondeu e
   nunca reenviou — o auditor decide os critérios e emite).
3. **UI (AuditorPlayer)**: no critério "Aguardando reenvio do prestador", o botão
   **Reprovar** fica habilitado (Aprovar/Não se aplica seguem desabilitados); dica vira
   "Aguardando reenvio do prestador — você pode reprovar ou ajustar a orientação."

## Não muda

- Reprovado já não pontua (score 0) e já é terminal para o parecer — isso não era o bug.
- Plano de ação: reprovado segue candidato automático ("não pontuou").
- Sem migration.

## Verificação

- `npm run lint` + suíte.
- Dry-run transacional no dev (instância 8004): simular reprovação do 3.2.2
  (`aguardando_reanalise` → `reprovado`, score 0) e conferir que a checagem de
  critérios não-terminais do parecer zera; ROLLBACK.
- Click-through com a Katy: reprovar o critério devolvido → Emitir Parecer Final sai.
