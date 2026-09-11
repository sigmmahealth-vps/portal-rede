# Reanálise em lote (devolução única ao fim da análise) — design

**Data:** 2026-09-11
**Demanda do cliente:** durante a auditoria, cada item submetido a reanálise é enviado
em tempo real ao prestador e cada item gera uma notificação. Ajustar para que todos os
itens sejam enviados de uma única vez ao final da avaliação, com **uma** notificação
listando os itens e suas descrições.

## Comportamento atual (causa)

`auditorAction('solicitou_reanalise')` (server.ts):
- marca o item `evidence_status='aguardando_reanalise'` + iteração;
- **flipa a instância** `em_analise → aguardando_evidencia` no PRIMEIRO item — daí os
  seguintes "chegam em tempo real" (prestador já pode editar itens devolvidos);
- **notifica por item** (`reanalise_solicitada` com `question_code`).

O parecer já exige decisão terminal em todos os itens (bloqueia com
`aguardando_reanalise` pendente) — o auditor não consegue "esquecer" rascunhos.

## Decisões (usuário aprovou o desenho em 2026-09-11)

1. **Marcar vira rascunho**: solicitar reanálise continua gravando
   `aguardando_reanalise` + iteração, mas NÃO flipa a instância nem notifica. Com a
   instância `em_analise`, o prestador não edita nada (`providerCanEditCriterion`).
2. **Máscara anti-vazamento**: o prestador abre o roteiro em read-only durante a
   análise. No `GET /api/eval/instances/:id`, quando o viewer é prestador E
   `instance.status==='em_analise'`: respostas `aguardando_reanalise` aparecem como
   `pendente` com `auditor_observation=null`, e as iterações `solicitou_reanalise`
   dessas respostas são omitidas da lista.
3. **Envio em lote**: novo `POST /api/eval/instances/:id/enviar-reanalise` (staff):
   exige `status='em_analise'` e ≥1 `aguardando_reanalise`; flipa para
   `aguardando_evidencia`; audit `reanalise_enviada` (meta: instance, provider, count);
   dispara UMA notificação `reanalise_solicitada` com
   `{items: [{code, text}], end_date}` (destinatários: `prestadorRecipients`).
4. **Catálogo**: `reanalise_solicitada` ganha a variante em lote — `ctx.items` presente:
   título `Reanálise solicitada — N critério(s)`; corpo lista `code — texto` (texto do
   critério via `questionOnly`, truncado a ~90 chars por item, no máx. 15 itens +
   "… e mais X critério(s)"), prazo (`end_date`) ao final. As variantes atuais
   (integral e por critério, usadas pela devolução integral) permanecem.
5. **AuditorPlayer**: botão **"Devolver para reanálise (N)"** no header (visível quando
   `!readOnly`, `status==='em_analise'` e N>0), confirm listando os códigos marcados;
   badge do item em `em_analise` mostra "Reanálise — a enviar" (após o envio, volta a
   "Aguardando Reanálise").
6. **Consequências assumidas**: "ajustar orientação" de item já devolvido deixa de
   notificar (a notificação de reanálise é só a do lote); devolução integral
   (1 notificação `integral:true`) intocada; auditor pode revisar um rascunho antes de
   enviar (justificativa obrigatória, como hoje).

## Fora do escopo

- Mascarar aprovado/reprovado em tempo real no read-only do prestador (não reclamado).
- Mudar o fluxo de reenvio do prestador ou a devolução integral.

## Verificação

- Testes puros: variante em lote no `notifyCatalog.test.ts`.
- `npm run lint` + suíte.
- Dry-run transacional no dev: instância `em_analise` com 2 itens marcados → GET como
  prestador mascara; enviar-reanalise flipa + 1 notificação com lista; parecer segue
  bloqueado com rascunho.
