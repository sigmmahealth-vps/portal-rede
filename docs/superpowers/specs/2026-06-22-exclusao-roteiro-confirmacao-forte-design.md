# Exclusão de roteiro com confirmação forte — Design

**Data:** 2026-06-22
**Status:** Aprovado para planejamento
**Área:** Qualificação (Admin → "Roteiros de Avaliação")

## Problema

Hoje, excluir um roteiro (`DELETE /api/eval/scripts/:id`) remove `eval_sections` →
`eval_questions` → `eval_scripts`. Como `eval_instances.script_id` tem
`ON DELETE CASCADE` (e `eval_answers.instance_id` idem), **todas as avaliações
preenchidas por prestadores e suas respostas são apagadas silenciosamente** junto
com o roteiro. Não há aviso nem proteção. Um clique acidental destrói histórico.

## Objetivo

Impedir a exclusão acidental de um roteiro que já foi usado em avaliações:
- Roteiro **nunca usado** (`usage_count = 0`): exclusão direta, como hoje.
- Roteiro **já usado** (`usage_count > 0`): exige **confirmação forte** — o usuário
  precisa digitar a frase `excluir roteiro`. Antes disso, vê uma mensagem dizendo
  quantas avaliações preenchidas existem e que a exclusão removerá esse histórico.

## Decisões tomadas

| Tema | Decisão |
|------|---------|
| Mensagem | Mostra o **número** real de avaliações preenchidas |
| Frase de confirmação | `excluir roteiro` — comparação `trim().toLowerCase()` (ignora espaços nas pontas e caixa) |
| Roteiro não usado | Mantém o `window.confirm` simples atual |
| Cascade do banco | **Inalterado** (não vira soft-delete; arquivar já existe via status) |
| Enforcement | Servidor **recalcula** o uso; nunca confia no frontend |

## Arquitetura

### 1. Backend — `server.ts`

**`GET /api/eval/scripts`:** acrescentar `usage_count` por roteiro:
`SELECT count(*)::int AS n FROM eval_instances WHERE script_id = $1`. Devolver
`usage_count: n` em cada objeto de roteiro (ao lado de `items`, `is_current`,
`alerts`). Frontend usa para decidir o fluxo de exclusão.

**`DELETE /api/eval/scripts/:id`:** antes de excluir, dentro da transação:
1. Recalcular `usage_count` do roteiro.
2. Se `usage_count > 0` **e** `String(req.body?.confirm ?? '').trim().toLowerCase() !== 'excluir roteiro'`:
   responder **409** com
   `{ error: '<mensagem>', usage_count: n, requiresConfirmation: true }`, sem
   excluir nada. Mensagem:
   *"Há N avaliação(ões) preenchida(s) por prestadores usando este roteiro. A
   exclusão também removerá esse histórico permanentemente. Para confirmar, digite:
   excluir roteiro."* (singular/plural conforme N).
3. Caso contrário, prosseguir com a exclusão atual (sections → questions → script;
   `eval_instances`/`eval_answers` caem por cascade).

Observação: o handler passa a ler `req.body` — confirmar que o app tem
`express.json()` registrado (tem; os POSTs usam JSON). O `fetchApi` precisa
enviar corpo no `DELETE` (ver item 3).

### 2. Frontend — `src/pages/Admin.tsx` + componente novo

**`handleDeleteScript(script)`** (passar o `script`, não só o `id`):
- `usage_count === 0` (ou ausente): mantém `window.confirm('Tem certeza que deseja
  excluir este roteiro?')` e `DELETE` sem corpo.
- `usage_count > 0`: abre o modal `ConfirmDeleteRoteiroModal` (estado local com o
  roteiro alvo). O modal mostra a mensagem + o número e um `<input>`; o botão
  "Excluir definitivamente" só habilita quando `input.trim().toLowerCase() === 'excluir roteiro'`.
  Ao confirmar, chama `DELETE /eval/scripts/:id` com corpo `{ confirm: 'excluir roteiro' }`.

**Novo componente `src/pages/qualificacao/ConfirmDeleteRoteiroModal.tsx`:** recebe
`{ script, onCancel, onConfirm }`. Renderiza overlay + card com título de alerta,
a mensagem (com `usage_count`), o input controlado, e os botões Cancelar / Excluir
definitivamente (este desabilitado até a frase conferir). Sem dependências novas
(usa `lucide-react`, já no projeto).

**`fetchApi`:** confirmar que aceita `body` em `DELETE`. Se hoje só serializa body
quando presente e sempre manda `Content-Type: application/json`, funciona sem
alteração. Caso contrário, ajuste mínimo para serializar o body no DELETE.

## Tratamento de erros

| Situação | Comportamento |
|----------|---------------|
| `usage_count > 0` sem frase correta | 409, nada é excluído; UI mostra a mensagem |
| Frase digitada errada no modal | Botão "Excluir definitivamente" permanece desabilitado |
| Roteiro não usado | Fluxo simples atual (window.confirm) |
| Falha de rede/servidor | `alert(err.message)` como hoje |

## Testes

- **Manual (base = produção; roteiro descartável `OPS-RED-FOR-999`):**
  1. Subir o roteiro de teste; sem nenhuma avaliação → excluir direto (confirm simples).
  2. Criar/registrar uma avaliação (`eval_instances`) para ele → tentar excluir:
     aparece o modal com a contagem; botão só habilita ao digitar `excluir roteiro`;
     confirmar exclui roteiro + instância.
  3. Conferir que sem a frase o servidor responde 409 e nada é apagado.
- Sem testes unitários novos (mudança concentrada em endpoint + UI); o gate é
  `npm run lint` + `npm run build`.

## Riscos e observações

- **Base de produção:** o teste manual grava em produção; usar roteiro descartável.
- **`usage_count` por roteiro = +1 query por roteiro no GET** (já há esse padrão N+1
  no handler para `items`); custo desprezível no volume atual.
- **Não confiar no frontend:** o 409 do servidor é a real proteção; o modal é UX.
- **Push na `main` = deploy Railway;** decisão explícita do usuário, fora do plano.
