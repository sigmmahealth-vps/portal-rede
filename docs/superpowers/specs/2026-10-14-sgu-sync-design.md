# Rotina diária de atualização de prestadores a partir do SGU

**Data:** 14/10/2026 · **Status:** em revisão pela Katy

## Contexto e decisões

A Unimed carrega a extração do SGU na tabela `public.sgu_providers_raw`, no próprio banco
do Portal. A carga dessa tabela é da Unimed e está fora do escopo.

Decisões da Katy (14/10/2026):

1. A `sgu_providers_raw` é a **fonte de verdade** do cadastro de prestadores. Substitui a
   planilha `Prestadores Portal.xlsx` / `db/import-tabela.ts`.
2. A raw é atualizada **todo dia às 23h**. A cada atualização o Portal atualiza o cadastro.
3. **Afastado = inativo enquanto durar o afastamento** (enquanto o SGU disser AFASTADO).
4. Prestador inativo: **não entra em ciclo novo**, **avaliação em andamento fica suspensa**
   e o **rótulo** reflete a situação. O login **não** é bloqueado.
5. Os **89 prestadores** que estão hoje no Portal e não vêm na raw são **apagados do banco
   uma única vez** (limpeza inicial). Daqui em diante, quem sumir da raw vira `excluído`
   (inativo, reversível) — a rotina diária nunca apaga.
6. **E-mail editado no Portal nunca é alterado pela carga.** A rotina nunca altera um
   registro existente de `users`.
7. Cuidado central: **não quebrar o código atual** com cargas diárias.

## Formato da raw (verificado no dev em 14/10)

Uma linha por prestador × endereço comercial × especialidade/grupo de serviço; foto
completa (uma única `dh_carga`; 2012 linhas, 897 prestadores: 595 ATIVO, 5 AFASTADO,
297 EXCLUÍDO). Colunas usadas:

| Uso | Colunas |
|---|---|
| Identidade | `codigo_prestador`, `nome_prestador`, `nome_fantasia`, `numero_documento` |
| Classificação | `status_prestador`, `grupo_prestador`, `tipo_prestador`, `especialidade_grupo_servico`, `numero_conselho_regional`, `nome_responsavel_tecnico` |
| Afastamento/exclusão | `tipo_operacao_afastamento_exclusao`, `data_inicio_afastamento_exclusao`, `data_fim_afastamento_exclusao`, `codigo_motivo_afastamento_exclusao`, `motivo_afastamento_exclusao` |
| Unidade | `codigo_tipo_endereco`, `tipo_endereco`, `cep`, `logradouro`, `numero_endereco`, `complemento_endereco`, `bairro`, `cidade`, `uf_endereco`, `telefone`, `celular`, `email_principal`, `imprimir_no_guia_medico` |
| Carga | `dh_carga` |

- `(codigo_prestador, codigo_tipo_endereco)` nunca aponta para dois endereços → chave
  estável da unidade.
- EXCLUÍDO: `EXCLUSAO` + início, sem fim. AFASTADO: `AFASTAMENTO` + início (fim às vezes).
  ATIVO com afastamento encerrado (9) é histórico. ATIVO com `EXCLUSAO` de início futuro (2,
  01/11/2026) = exclusão agendada.

## Os dois e-mails (regra 6)

| Campo | Quem altera | Para que serve | Rotina |
|---|---|---|---|
| `users.email` (e-mail de acesso) | prestador no 1º acesso, admin na aba Acessos, "usar para todas" | 2FA, redefinição de senha, avisos | **nunca altera** |
| `provider_locations.email` (cadastral) | só a carga (sem tela de edição) | sugestão no 1º acesso de unidade sem e-mail confirmado; e-mail pendente de acesso novo | atualiza com `email_principal` |

Escrita da rotina em `users`: **somente INSERT** do acesso de unidade nova. Nenhum
UPDATE/DELETE em `users` na rotina diária (a limpeza inicial, item 1b, é separada).

## 1. Preparação (uma vez por ambiente)

### 1a. Chave estável da unidade — migration 0059 + backfill

Hoje `sgu_location_code` é posicional (`<código>-1`, `-2`, pela ordem das linhas). Com
carga diária, uma mudança de ordem trocaria login, senha por unidade e avaliações de
endereço. Por isso:

- Migration **0059**: `provider_locations.sgu_tipo_endereco bigint` (nullable);
  `eval_instances.status_before_suspend text`; `sgu_sync_runs.report jsonb`,
  `sgu_sync_runs.raw_loaded_at timestamp`.
- Backfill (comando `db:sgu-rekey`, dry-run padrão): para cada unidade `source='sgu'`,
  casa com a raw pelo endereço (`cep` só dígitos | `logradouro` maiúsculo/trim |
  `numero` trim) e grava `sgu_tipo_endereco` + `sgu_location_code =
  '<código>-<codigo_tipo_endereco>'`, **mantendo o `id`**. Não casou → `active=false`.
  No dev: 632 de 646 casam.
- A partir daí a unidade é identificada por `(provider_id, sgu_location_code)` com o
  código novo; o endereço pode mudar sem trocar a unidade.

### 1b. Limpeza dos ausentes — `db:sgu-purge-ausentes`

- Alvo: `providers` com `source='sgu'` cujo `sgu_code` não está na raw (hoje 89).
- Dry-run padrão: lista e contagens do que cai em cascata (unidades, avaliações,
  respostas, planos, anexos, usuários).
- `--commit`: grava backup JSON em `backups/sgu-purge-<ambiente>-<data>.json` (todas as
  linhas afetadas) e, numa transação, apaga os `users` desses prestadores e depois os
  `providers` (o resto cai pelos FKs `ON DELETE CASCADE`). `DELETE`, nunca `TRUNCATE`.
- Roda uma vez por ambiente, **depois** do 1a. Em prod é executado pela Katy.

## 2. Rotina diária — `sgu-sync`

### Disparo

- Job no `server.ts`, no padrão de `runAutoCycleJobs`/`runNotificationJobs`: a cada
  30 min compara `max(dh_carga)` da raw com o `raw_loaded_at` da última execução
  `source='sgu-sync'` com sucesso; se for mais nova, aplica. Atraso da carga das 23h é
  absorvido.
- `pg_try_advisory_lock` impede duas execuções simultâneas.
- Comando manual `npm run db:sgu-sync` (dry-run padrão, `--commit` aplica) com o mesmo
  núcleo.

### Travas (abortam sem gravar; registram `status='error'`)

- raw vazia ou com mais de uma `dh_carga`;
- `dh_carga` igual à última aplicada (no comando manual: só avisa);
- mais de **10% dos prestadores ativos** do Portal virariam `excluído` nesta execução
  (sinal de carga incompleta).

### O que aplica (uma transação)

Parser: a raw é traduzida para o formato `TabelaRow` e passa pelo `parseTabela` existente
(regra de roteiro, PF/PJ, CPF/CNPJ, especialidades num lugar só). O parser passa a usar
`codigo_tipo_endereco` como código da unidade.

| Caso | Ação |
|---|---|
| Novo na raw, ATIVO ou AFASTADO | INSERT do prestador e das unidades; INSERT de 1 acesso por unidade, sem senha, e-mail pendente = `email_principal` (como o `provision-users`); papel por `db/provider-role.ts` |
| Novo na raw, EXCLUÍDO | ignora |
| Grupo "27 – PRESTADOR SEM VINCULO" | ignora (regra da aba `tratativas`) |
| Nos dois lados | UPDATE dos campos do SGU: `name`, `trade_name`, `person_type`, `cnpj`, `cpf`, `council_registry`, `specialties`, `provider_type`, `provider_group`, `status`, `eval_script_id`, `roteiro_cod`, `roteiro_confianca`, `sgu_synced_at` |
| `responsavel_tecnico` | só sobrescreve se o SGU trouxer valor (o admin edita na tela) |
| Unidade nova de prestador existente | INSERT da unidade + INSERT do acesso dela (como acima) |
| Unidade existente | UPDATE de endereço, telefone, `email` cadastral, `in_medical_guide`; `active=true` |
| Unidade que sumiu da raw | `active=false` |
| Prestador `source='sgu'` que sumiu da raw | `status='excluído'` |
| Cadastro `source='manual'` | não toca |

### Inatividade

**Prestador inativo** = `status` ≠ `ativo`. **Unidade inativa** = `active=false` ou
prestador inativo.

- **Ciclo novo:** a abertura de ciclo (`openCycleCore`, `server.ts` ~5185) e a inclusão
  passam a exigir `p.status = 'ativo' AND pl.active = true`.
- **Suspensão:** avaliação do ciclo ativo, de unidade que ficou inativa, em status não
  terminal (fora de `aprovado`, `reprovado`, `finalizado`, `ciclo_encerrado`,
  `suspensa`) → `status_before_suspend = status`, `status = 'suspensa'`.
- **Restauração:** unidade volta a ativa e o ciclo da avaliação ainda está ativo →
  `status = status_before_suspend`, `status_before_suspend = NULL`.
- Ciclo encerrado com avaliação suspensa: o encerramento atual já trata não terminais →
  vira `ciclo_encerrado` com `status_before_close = 'suspensa'`. Sem mudança.
- Prestador reativado que não estava no ciclo atual não é incluído automaticamente.

O status `suspensa` é novo: o plano revisa todo lugar que enumera status de avaliação
(Painel do Ciclo, portal do prestador, `displayStatus`, contagens/dashboards, jobs de
prazo e notificação, reanálise) para que `suspensa` não conte como pendente nem receba
aviso de prazo, e apareça com rótulo próprio.

### Registro

Cada execução grava `sgu_sync_runs` (`source='sgu-sync'`, `raw_loaded_at`,
`providers_upserted`, `locations_upserted`, `message`) com `report` jsonb: novos,
alterados (campo, antes, depois), inativados, reativados, unidades novas/inativadas,
avaliações suspensas/restauradas, exclusões agendadas (ATIVO com `EXCLUSAO` futura) e
ignorados.

## O que muda no código existente

- `db/tabela-parser.ts`: código da unidade passa a vir de `codigo_tipo_endereco` quando
  presente (a planilha antiga continua funcionando com o posicional, mas deixa de ser
  usada).
- `db/import-tabela.ts`: aposentado como rotina (fica no repo; documentado como legado).
- `server.ts`: filtro de ativo na abertura/inclusão de ciclo; job `sgu-sync`; status
  `suspensa` nas listas de status.
- Front: rótulo de `suspensa`.

## Testes

`node:test`, padrão do repo:

- tradução raw → `TabelaRow` + `parseTabela` (código da unidade por tipo de endereço);
- decisão por prestador/unidade (novo, alterado, sumiu, EXCLUÍDO novo ignorado, grupo 27
  ignorado, manual intocado);
- RT vazio no SGU não apaga RT do Portal;
- **nenhum UPDATE/DELETE em `users`** na rotina (teste falha se houver);
- suspensão e restauração (inclui ciclo encerrado no meio);
- travas (raw vazia, duas cargas, >10% virando excluído);
- rekey: casa por endereço mantendo `id`; não casado vira inativo.

Validação real: dev (rekey → purge → sync, conferindo contagens com o levantamento de
14/10), depois homolog. Prod pela Katy.

## Fora do escopo

- Bloquear login de inativo.
- Incluir automaticamente no ciclo atual prestador reativado ou novo.
- Senha provisória para acessos novos (o admin define, como hoje).
- Tela de acompanhamento das execuções (o relatório fica em `sgu_sync_runs`).

## Promoção

Ordem por ambiente: deploy (migration 0059 no boot) → `db:sgu-rekey --commit` →
`db:sgu-purge-ausentes --commit` → job passa a rodar. O job só deve ser ligado depois do
rekey (flag de ambiente `SGU_SYNC_ENABLED=true`). A existência da raw em prod não foi
verificada (leitura de prod bloqueada nesta sessão).
