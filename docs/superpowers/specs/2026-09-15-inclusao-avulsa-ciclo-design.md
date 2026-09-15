# Inclusão avulsa no ciclo de qualificação — Design

**Data:** 2026-09-15
**Status:** Para validação com a Unimed (decisões em aberto sinalizadas com ❓)
**Área:** Qualificação (Admin → Painel do Ciclo)

## Problema

A abertura do ciclo é um **snapshot**: `openCycleCore` cria as avaliações
(`eval_instances`) uma única vez — 1 por prestador×unidade no guia médico, com
roteiro resolvido por grupo/override, menos as exclusões (migration 0047) — e
recusa reexecução ("ciclo já tem instâncias"). Quem entra na base **depois da
abertura** fica de fora até o próximo ciclo:

- **Prestador novo** credenciado durante a vigência do ciclo.
- **Endereço novo** (unidade de atendimento) de prestador que já estava no ciclo.

Hoje isso só acontece via recarga manual da planilha; com a **integração
cadastro→portal** prevista, atualizações passarão a chegar continuamente, e o
portal precisa de uma conduta definida para esses casos.

Há também o caso da **alteração de endereço já cadastrado**: a recarga atualiza
a linha existente (mesmo `location_id`), então a avaliação em andamento continua
válida apontando para ela — comportamento atual que precisa ser ratificado (ou
não) pelo cliente.

## Objetivo

Permitir que o admin **inclua prestador×unidade num ciclo já aberto** ("inclusão
avulsa"), com roteiro atribuído automaticamente por uma cascata de resolução,
motivo obrigatório, trilha de auditoria e notificação — o espelho simétrico das
**Exclusões** (0047), que o cliente já aprovou. A mesma mecânica atende a
recarga manual de hoje e a integração futura: muda só quem alimenta a fila.

## Escopo

Incluído:
- Fila **"Aguardando inclusão"** no Painel do Ciclo: pares prestador×unidade
  comercial no guia médico **sem instância** no ciclo aberto (e não excluídos).
- Ação **"Incluir no ciclo"** com motivo obrigatório, confirmação, auditoria
  (`cycle_inclusion_added`), lista "Incluídos" e notificação ao prestador
  (`ciclo_aberto` para o incluído).
- **Cascata de atribuição de roteiro** no momento da inclusão (ver abaixo).
- **DL bypass** aplicado ao incluído (mesma lógica da abertura: documentos
  válidos no cadastro aprovam critérios DL automaticamente).
- Estado **"pendente de roteiro"** para pares que a cascata não resolve — o
  admin vincula manualmente (via override), como já faz com grupos ambíguos.
- Resumo da fila no card do ciclo (ex.: "3 aguardando inclusão").

Fora de escopo (YAGNI):
- Edição de endereços pela tela (aba Unidades) — as alterações continuam vindo
  da recarga/integração; editar no portal é fatia própria, se aprovada.
- A integração cadastro→portal em si (webhook/job) — esta spec só garante que,
  quando existir, ela alimenta a mesma fila sem mudar o módulo de qualificação.
- Inclusão automática sem confirmação do admin (ver decisão ❓3).
- Remoção de instância de quem saiu do guia médico no meio do ciclo (a exclusão
  0047 já cobre o gesto manual).

## Cascata de atribuição do roteiro

Na inclusão, o roteiro do par prestador×unidade resolve na ordem:

| # | Fonte | Quando se aplica |
|---|-------|------------------|
| 1 | `eval_cycle_overrides` (prestador×local) | Admin definiu roteiro específico para o par |
| 2 | `eval_cycle_groups` do ciclo (grupo→roteiro congelado na abertura) | Grupo do prestador está no mapa do ciclo — caminho esperado de ~100% dos casos |
| 3 | `providers.eval_script_id` (match da carga por `roteiro_cod` FOR-XXX) | Grupo fora do mapa do ciclo (ficou de fora na abertura ou era ambíguo) |
| 4 | **Pendência manual** | Nada resolveu (ex.: grupo novo que não existia na abertura) — par fica "pendente de roteiro" na fila até o admin vincular |

Endereço novo de prestador já no ciclo é o caso trivial: o roteiro é do
prestador/grupo, não do endereço — a unidade nova herda o mesmo roteiro das
irmãs.

## Fluxo

1. Recarga/integração insere prestador ou unidade nova (`in_medical_guide`).
2. A fila do Painel do Ciclo passa a listar o par, com o roteiro já resolvido
   pela cascata (ou marcado "pendente de roteiro").
3. Admin clica **Incluir no ciclo** → modal com prestador, unidade, roteiro
   resolvido e campo **motivo** (pré-sugerido: "Credenciamento em DD/MM" /
   "Nova unidade em DD/MM").
4. Confirmação → cria a `eval_instance` no ciclo (status `pendente`), roda DL
   bypass, audita, notifica o prestador.
5. O incluído aparece no Painel do Ciclo e segue o fluxo normal (prazo, selo,
   certificado do ciclo).

Regra de corte (❓1): a fila continua exibindo o par, mas o botão avisa quando a
inclusão estiver a menos de X dias do fim do ciclo.

## Decisões já tomadas (proposta SIGMMA)

| Tema | Decisão |
|------|---------|
| Mecanismo | Espelho das Exclusões (0047): fila + ação com motivo + lista + auditoria |
| Confirmação | Sempre com humano no laço (admin confirma cada inclusão) |
| Roteiro | Cascata 1→4 acima; pendência manual em vez de bloquear |
| DL bypass | Aplicado na inclusão, igual à abertura |
| Alteração de endereço existente | Mantém a avaliação (mesmo `location_id`); caso a mudança física exija reavaliar, o admin usa Excluir + Incluir |
| Backend | Reusa `POST /api/eval/instances` estendido (já amarra ao ciclo ativo) ou INSERT da abertura parametrizado por par — decisão de implementação |

## ❓ Decisões para a Unimed validar

1. **Prazo do incluído tardio** — corre com o prazo do ciclo vigente (proposta),
   ou ganha prazo próprio? E existe **data de corte** ("até X dias antes do fim
   entra; depois, espera o próximo ciclo")? Qual X?
2. **Validade do certificado** — o incluído tardio herda a validade do ciclo
   (`cert_valid_until`, proposta — mantém a rede uniforme), ou proporcional à
   data de inclusão?
3. **Automação com a integração** — mantém a confirmação do admin (proposta) ou,
   no futuro, inclusão automática configurável por ciclo ("incluir novos
   credenciados automaticamente até X dias do fim")?
4. **Alteração de endereço já cadastrado** — ratificam que a avaliação/certificado
   do local permanece válida quando o endereço muda na recarga? Ou mudança de
   endereço exige reavaliação (via Excluir + Incluir)?
5. **Quem pode incluir** — só admin (proposta) ou auditoria também?

## Dados

- Nova tabela `eval_cycle_inclusions` (espelho de `eval_cycle_exclusions`):
  `cycle_id`, `provider_id`, `location_id`, `reason`, `created_by`,
  `created_at`, `instance_id` — registra o ato e liga à instância criada.
  Migration ⚠️ obrigatória ao promover.
- A fila **não** precisa de tabela: é derivada (pares comerciais no guia médico
  sem instância e sem exclusão no ciclo aberto), como o `surveyState`.
