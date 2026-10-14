# Rotina de atualização de prestadores — fase 2: aplicar a `sgu_providers_raw` no cadastro

**Data:** 14/10/2026 · **Status:** em revisão pela Katy
**Base:** fase 1 (`docs/superpowers/specs/2026-10-14-sgu-raw-diff-design.md`, código em `db/sgu-raw.ts` e
`db/sgu-diff.ts`, origin/dev `4007bfb`).

## Decisões da Katy (14/10/2026)

1. A `sgu_providers_raw` é a **fonte de verdade** do cadastro. Substitui `Prestadores Portal.xlsx` /
   `db/import-tabela.ts`. A Unimed recarrega a raw **todo dia às 23h** (foto completa, uma `dh_carga`).
2. **Aplica todo dia após a carga**, automaticamente; há também comando manual com dry-run.
3. **Afastado = inativo** enquanto o SGU disser AFASTADO (EXCLUÍDO também é inativo). Inativo **não entra
   em ciclo novo** e a **avaliação em andamento fica suspensa**; **o login continua liberado**.
4. **Os ausentes de hoje (89 no dev) são apagados do banco, uma única vez**, com backup. Daqui em diante,
   quem sumir da raw vira `excluído` — a rotina diária nunca apaga.
5. **A carga nunca altera usuário.** E-mail editado no Portal é intocável. A rotina só **cria** acesso de
   unidade nova; nenhum UPDATE/DELETE em `users`.
6. Regras aprovadas: **trava de 10%**; **RT só sobrescreve se o SGU trouxer valor**; **EXCLUÍDO novo é
   ignorado**; **grupo "27 – PRESTADOR SEM VINCULO" é ignorado**.
7. Suspensão por **status novo `suspensa`** com `status_before_suspend` (mesmo modelo de
   `status_before_close`/`ciclo_encerrado`, migration 0048).

## Os dois e-mails

| Campo | Quem altera | Uso | Rotina |
|---|---|---|---|
| `users.email` | prestador (1º acesso), admin (aba Acessos), "usar para todas" | 2FA, redefinição, avisos | **nunca altera** |
| `provider_locations.email` | só a carga (sem tela de edição) | sugestão no 1º acesso; e-mail pendente de acesso novo | atualiza com `email_principal` |

## A. Preparação (uma vez por ambiente)

### A1. Migration `0060_sgu_sync.sql`

```sql
ALTER TABLE provider_locations ADD COLUMN IF NOT EXISTS sgu_tipo_endereco text;
ALTER TABLE eval_instances ADD COLUMN IF NOT EXISTS status_before_suspend text;
```

(`sgu_sync_runs.report/raw_loaded_at` já vieram na 0059.)

### A2. `npm run db:sgu-rekey` (dry-run padrão, `--commit` aplica)

Hoje `sgu_location_code` é posicional (`<código>-1`, `-2`…). Com carga diária, mudar a ordem das linhas
trocaria login, senha por unidade e avaliações de endereço.

- Para cada `provider_locations` de `providers.source='sgu'`: casa com a raw por
  `sgu_code` + `addrKey(cep, logradouro, numero)` (função da fase 1) e grava
  `sgu_tipo_endereco = codigo_tipo_endereco` e `sgu_location_code = '<código>-<codigo_tipo_endereco>'`,
  **mantendo o `id`**. Não casou → `active = false` (código inalterado).
- Conflito (dois registros do mesmo prestador caindo no mesmo código novo): mantém o de menor `id`, o outro
  fica `active=false` e entra no relatório.
- Uma transação; idempotente (unidade já com `sgu_tipo_endereco` é pulada).
- No dev: 632 de 646 unidades ativas casam.

### A3. `npm run db:sgu-purge-ausentes` (dry-run padrão, `--commit` aplica)

- Alvo: `providers.source='sgu'` cujo `sgu_code` não está na raw (89 no dev em 14/10).
- Dry-run: lista + contagem do que cai em cascata (unidades, avaliações, respostas, planos, anexos, usuários).
- `--commit`: grava backup JSON em `backups/sgu-purge-<APP_ENV>-<AAAAMMDD-HHmm>.json` com todas as linhas
  afetadas; depois, numa transação, `DELETE FROM users WHERE provider_id = ANY(...)` e
  `DELETE FROM providers WHERE id = ANY(...)` (o resto cai pelos FKs `ON DELETE CASCADE`). Nunca `TRUNCATE`.
- Roda depois do A2. **Em prod é executado pela Katy.** É a única exceção à regra 5, por decisão explícita.

## B. Núcleo — `db/sgu-sync.ts`

### Entrada

- Raw lida com `SELECT *, dh_carga::text AS dh_carga_txt FROM sgu_providers_raw ORDER BY codigo_prestador,
  codigo_tipo_endereco, especialidade_grupo_servico` e ordenada por `ordenaRaw` (fase 1).
- Parser: o mesmo `parseTabela` via `rawToTabelaRows`. O adaptador passa `codigo_tipo_endereco` na coluna
  `'Código tipo endereço'`; o `parseTabela` usa essa coluna para `sgu_location_code =
  '<código>-<tipo>'` quando presente (planilha antiga, sem a coluna, continua posicional).
- Afastamento: `afastamentoPorPrestador` (fase 1), para o relatório.

### Travas (abortam sem gravar; registram `status='error'`)

1. raw vazia;
2. mais de uma `dh_carga`;
3. mais de **10%** dos prestadores `source='sgu'` com `status='ativo'` virariam `excluído` nesta execução
   (somando os que somem da raw e os que viram EXCLUÍDO no SGU).

### Aplicação (uma transação)

| Caso | Ação |
|---|---|
| Novo na raw, ATIVO ou AFASTADO | INSERT em `providers` (`source='sgu'`) + unidades + **1 acesso por unidade** |
| Novo na raw, EXCLUÍDO | ignora |
| Grupo começando por `27 -` | ignora (novo ou existente: existente não é tocado) |
| Nos dois lados | UPDATE de `name`, `trade_name`, `person_type`, `cnpj`, `cpf`, `council_registry`, `specialties`, `provider_type`, `provider_group`, `status`, `eval_script_id`, `roteiro_cod`, `roteiro_confianca`, `sgu_synced_at=now()` |
| `responsavel_tecnico` | `COALESCE(<valor do SGU>, responsavel_tecnico)` |
| Unidade nova | INSERT (`sgu_location_code` estável, `sgu_tipo_endereco`) + 1 acesso |
| Unidade existente | UPDATE de `label`, endereço, `phone`, `email`, `is_primary`, `in_medical_guide`, `active=true` |
| Unidade que sumiu da raw | `active=false` |
| `source='sgu'` ausente da raw | `status='excluído'` |
| `source='manual'` | não toca |

**Acesso de unidade nova** (mesma regra do `provision-users`): `INSERT INTO users (name, email, password,
role, provider_id, is_active, invite_status) VALUES (<nome>, <e-mail cadastral válido ou NULL>, NULL,
deriveProviderRole(person_type, provider_group), <id>, true, 'pending')` + `user_locations`. Sem senha (o
admin define a provisória), sem convite.

**Regra 5:** a rotina não executa UPDATE nem DELETE em `users`/`user_locations`. Coberta por teste.

### Suspensão e restauração (mesma transação, depois dos upserts)

- **Inativo** = prestador com `status <> 'ativo'` ou unidade com `active = false`.
- **Suspende:** `eval_instances` do ciclo com `active = true`, de unidade inativa, com status fora de
  (`aprovado`, `reprovado`, `finalizado`, `ciclo_encerrado`, `suspensa`) →
  `status_before_suspend = status, status = 'suspensa'`.
- **Restaura:** `status = 'suspensa'`, unidade ativa e prestador ativo, ciclo ainda `active` →
  `status = status_before_suspend, status_before_suspend = NULL`.
- Encerramento de ciclo (já existente) trata `suspensa` como não terminal → vira `ciclo_encerrado` com
  `status_before_close='suspensa'`. Reabertura (0048) devolve `suspensa`; a próxima execução da rotina
  restaura se o prestador estiver ativo.
- Prestador reativado que não estava no ciclo **não** é incluído automaticamente.

### Registro

`sgu_sync_runs`: `source='sgu-sync'`, `status`, `raw_loaded_at = $dh_carga_txt::timestamp`,
`providers_upserted`, `locations_upserted`, `message` (resumo de uma linha), `report` jsonb =
`{ diff: <DiffReport da fase 1, calculado antes de aplicar>, aplicado: { criados, atualizados,
excluidos_por_ausencia, unidades_criadas, unidades_inativadas, acessos_criados, suspensas, restauradas,
ignorados: { excluido_novo, grupo_27 } } }`.

## C. Disparo

- **Job em `server.ts`**, no padrão de `runAutoCycleJobs`/`runNotificationJobs`: a cada 30 min, só se
  `SGU_SYNC_ENABLED === 'true'`. Aplica quando `max(dh_carga)::text` for diferente do `raw_loaded_at::text`
  da última execução `sgu-sync` com `status='success'`. `pg_try_advisory_xact_lock` impede execução
  simultânea (se não pegar o lock, sai em silêncio).
- **Comando `npm run db:sgu-sync`**: dry-run padrão (calcula e imprime o que faria, sem gravar e sem registrar),
  `--commit` aplica com o mesmo núcleo, mesmo que a `dh_carga` já tenha sido aplicada.
- Erro no job: registra `status='error'` e loga; tenta de novo na próxima volta (30 min).

## D. Efeito no app

- **Abertura de ciclo** (`openCycleCore`, `server.ts` ~5185) e **candidatos/inclusão avulsa**
  (`/api/eval/cycles/:id/inclusion-candidates` e `POST .../inclusions`, ~4987–5130) passam a exigir
  `p.status = 'ativo' AND pl.active = true`.
- **Status `suspensa`:** rótulo "Suspensa (prestador inativo)" e tratamento em todo lugar que enumera status
  de avaliação: `server.ts` (contagens, prazos, jobs de notificação, reanálise, parecer), `PainelDoCiclo.tsx`,
  `PrestadorView.tsx`, `AuditorPlayer.tsx` e as libs de `src/lib` que listam status. Regra: `suspensa` não
  conta como pendente, não recebe aviso de prazo, não pode ser respondida nem avaliada (somente leitura) e
  aparece com o rótulo próprio. O plano começa com o levantamento exaustivo desses pontos
  (`grep` por `'ciclo_encerrado'` e por cada status) antes de editar.

## E. O que muda no código existente

- `db/tabela-parser.ts`: `sgu_location_code` usa `'Código tipo endereço'` quando presente.
- `db/sgu-raw.ts`: adaptador passa `codigo_tipo_endereco`; `diffProviders` passa a casar unidades por
  `sgu_location_code` estável quando o Portal já tiver `sgu_tipo_endereco` (fallback: endereço).
- `db/import-tabela.ts`: aposentado como rotina (fica no repo, cabeçalho marca como legado).
- `server.ts`: job, filtros de ativo no ciclo e na inclusão, `suspensa`.
- Front: rótulo e somente leitura de `suspensa`.

## F. Testes

`node:test`, padrão do repo:

- parser: código estável com a coluna de tipo; posicional sem ela;
- decisão por prestador/unidade: novo, alterado, sumiu → excluído, EXCLUÍDO novo ignorado, grupo 27
  ignorado, manual intocado, unidade nova/sumida;
- RT vazio no SGU mantém o do Portal;
- **nenhum UPDATE/DELETE em `users`/`user_locations`** (teste falha se houver);
- acesso criado para unidade nova (papel, e-mail válido ou NULL, sem senha);
- suspensão e restauração, incluindo ciclo encerrado no meio;
- travas: raw vazia, duas cargas, >10%;
- rekey: casa por endereço mantendo `id`; não casado → inativo; conflito;
- purge: dry-run não grava; backup contém as linhas; cascata.

**Validação real (dev):** 0060 → rekey → purge → `db:sgu-sync --commit` duas vezes (a segunda não pode
alterar nada além de `sgu_synced_at`) → conferir contagens com o relatório da fase 1 → ligar o job e ver uma
execução automática. Depois homolog. Prod pela Katy.

## Fora do escopo

- Bloquear login de inativo.
- Incluir automaticamente no ciclo prestador novo/reativado.
- Senha provisória para acessos novos.
- Tela de acompanhamento das execuções.

## Promoção (por ambiente)

1. Deploy (0060 no boot).
2. `db:sgu-rekey --commit`.
3. `db:sgu-purge-ausentes --commit` (prod: Katy).
4. `db:sgu-sync --commit` manual e conferência.
5. `SGU_SYNC_ENABLED=true` no serviço.

A `sgu_providers_raw` precisa existir no ambiente; em prod não foi verificada (leitura de prod bloqueada
nesta sessão).
