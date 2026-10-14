# Rotina de atualização de prestadores — fase 1: comparação SGU × Portal

**Data:** 14/10/2026 · **Status:** aprovado para plano

## Contexto

A Unimed passou a carregar a extração do SGU numa tabela do próprio banco do Portal,
`public.sgu_providers_raw` (dev e homolog; 2012 linhas, 897 prestadores na carga de
13/10/2026 21:00). A carga dessa tabela **já existe e está fora do escopo**.

Decisões da Katy (14/10/2026):

- A `sgu_providers_raw` é a **fonte de verdade** do cadastro de prestadores.
- **Por ora a rotina só compara.** Nenhuma escrita em `providers`, `provider_locations`,
  `users` ou qualquer tabela de cadastro. Aplicar as diferenças é uma fase posterior.
- A saída é **um comando + registro no banco** (sem tela nova).

## Formato da raw

Uma linha por prestador × endereço comercial × especialidade/grupo de serviço.
Colunas usadas (snake_case, nomes reais):

| Uso | Colunas |
|---|---|
| Identidade | `codigo_prestador` (bigint), `nome_prestador`, `nome_fantasia`, `tipo_pessoa`, `numero_documento` |
| Classificação | `status_prestador` (ATIVO/AFASTADO/EXCLUÍDO), `grupo_prestador`, `tipo_prestador`, `especialidade_grupo_servico`, `numero_conselho_regional`, `nome_responsavel_tecnico` |
| Afastamento/exclusão | `tipo_operacao_afastamento_exclusao` (AFASTAMENTO/EXCLUSAO), `data_inicio_afastamento_exclusao`, `data_fim_afastamento_exclusao`, `codigo_motivo_afastamento_exclusao`, `motivo_afastamento_exclusao` |
| Unidade | `codigo_tipo_endereco`, `tipo_endereco`, `cep`, `logradouro`, `numero_endereco`, `complemento_endereco`, `bairro`, `cidade`, `uf_endereco`, `telefone`, `celular`, `email_principal`, `imprimir_no_guia_medico` |
| Carga | `dh_carga` (timestamp da foto) |

Fatos verificados no dev (14/10):

- Uma única `dh_carga` → a tabela é a **foto completa**, não acumula.
- Só endereços comerciais. `(codigo_prestador, codigo_tipo_endereco)` nunca aponta para
  dois endereços distintos → é a chave estável de unidade (usada na fase 2).
- Afastamento/exclusão: EXCLUÍDO sempre tem `EXCLUSAO` + início, sem fim; AFASTADO tem
  `AFASTAMENTO` + início (fim às vezes); 9 ATIVO têm afastamento já encerrado (histórico);
  **2 ATIVO têm `EXCLUSAO` com início futuro (01/11/2026) = exclusão agendada**.

## Arquitetura

```
sgu_providers_raw ──SELECT──► rawToTabelaRows() ──► parseTabela() ──┐
                                                                     ├─► diffProviders() ──► relatório
providers + provider_locations ──SELECT──► snapshot do Portal ──────┘                      │
                                                                     terminal (resumo) ◄────┤
                                                     sgu_sync_runs (report jsonb) ◄─────────┘
```

### Unidades (arquivos)

1. **`db/sgu-raw.ts`** — puro, sem banco.
   - `rawToTabelaRows(rows)`: traduz cada linha da raw para o formato `TabelaRow` que o
     `parseTabela` já entende (`codigo_prestador` → `'Código do prestador'`,
     `status_prestador` → `'Situação do prestador'`, `uf_endereco` → `'UF'`, etc.).
     Assim a regra de roteiro, PF/PJ, CPF/CNPJ e especialidades continua só em
     `tabela-parser.ts`.
   - `afastamentoPorPrestador(rows, hoje)`: por `codigo_prestador`, devolve
     `{ operacao, inicio, fim, motivo, codigo_motivo, situacao }`, onde `situacao` é:
     - `exclusao_agendada` — ATIVO com `EXCLUSAO` e início > hoje;
     - `afastamento_encerrado` — ATIVO com `AFASTAMENTO` e fim ≤ hoje;
     - `vigente` — AFASTADO/EXCLUÍDO com a operação correspondente;
     - `nenhum` — colunas vazias.
     Datas tratadas como data civil (sem fuso): a coluna é `timestamp without time zone`.

2. **`db/sgu-diff.ts`** — `diffProviders(raw, portal)` puro + CLI `main()`.

3. **Migration `0059_sgu_sync_runs_report.sql`** — em `sgu_sync_runs`:
   `ADD COLUMN report jsonb`, `ADD COLUMN raw_loaded_at timestamp`.

4. **`package.json`** — `"db:sgu-diff": "tsx db/sgu-diff.ts"`.

### O que `diffProviders` compara

Lado Portal = `providers` com `source='sgu'` + suas `provider_locations` ativas.
Cadastros `source='manual'` ficam fora da comparação (são listados só como contagem).

| Bloco | Regra | Conteúdo por item |
|---|---|---|
| **novos** | na raw, fora do Portal | código, nome, situação, grupo, roteiro sugerido, nº de unidades, afastamento. Ativos/afastados listados; EXCLUÍDO só em contagem + lista no JSON |
| **ausentes** | no Portal, fora da raw | código, nome, status no Portal, `tem_avaliacao` (existe `eval_instances` do prestador) |
| **alterados** | nos dois lados, algum campo diferente | lista `{campo, portal, sgu}` para: `name`, `trade_name`, `cnpj`, `cpf`, `status`, `provider_type`, `provider_group`, `specialties` (comparado como conjunto), `responsavel_tecnico`, `roteiro_cod` |
| **unidades** | prestador nos dois lados | `novas`, `removidas`, `alteradas` (`complemento`, `bairro`, `cidade`, `uf`, `phone`, `email`, `in_medical_guide`) |
| **afastamentos** | todo prestador da raw com `situacao ≠ nenhum` que esteja no Portal | operação, início, fim, motivo, situação. **`exclusao_agendada` vira aviso em destaque** |

Normalização para comparar: `trim`, comparação de texto sem diferenciar maiúsculas
para nomes; CPF/CNPJ só dígitos; vazio ≡ `null`.

**Casamento de unidade:** chave de endereço `cep(só dígitos)|logradouro(maiúsculo, trim)|numero(trim)`,
a mesma do parser. O Portal ainda não guarda `codigo_tipo_endereco`; ele vai no relatório
de cada unidade da raw para a fase 2.

### CLI `npm run db:sgu-diff`

1. Mostra `APP_ENV` e host do banco.
2. Lê a raw. **Aborta com erro** se estiver vazia ou tiver mais de uma `dh_carga`.
3. Lê o snapshot do Portal; roda `diffProviders`.
4. Imprime o resumo: contagens por bloco + até 15 itens de cada; avisos de exclusão
   agendada sempre listados inteiros.
5. Grava `sgu_sync_runs` com `source='sgu-raw-diff'`, `status='success'`,
   `raw_loaded_at = dh_carga`, `report` = relatório completo, `message` = resumo de uma
   linha. `providers_upserted`/`locations_upserted` ficam 0. Em erro: `status='error'`
   e a mensagem.

Só SELECT no cadastro; a única escrita é o registro em `sgu_sync_runs`. Por isso **não
usa a trava de host** do `import-tabela` e pode rodar em dev, homolog e prod.

## Testes

`db/sgu-raw.test.ts` e `db/sgu-diff.test.ts` (`node:test`, padrão do repo), com linhas
sintéticas:

- `rawToTabelaRows` + `parseTabela`: agrega especialidades, PF/PJ, unidades por endereço.
- `afastamentoPorPrestador`: os quatro valores de `situacao`, incluindo exclusão futura
  e afastamento com fim no passado.
- `diffProviders`: novo, ausente (com e sem avaliação), campo alterado, especialidades
  só reordenadas (não é diferença), unidade nova, unidade removida, unidade com e-mail
  alterado, cadastro manual ignorado.

Validação real: rodar no dev e conferir com o levantamento de 14/10 — 15 novos ATIVO,
295 novos EXCLUÍDO, 89 ausentes (88 com avaliação), 632 de 646 unidades casadas,
2 exclusões agendadas.

## Fora do escopo (fase 2 — aplicar)

- Gravar novos/alterados em `providers`/`provider_locations`.
- Desativar ausentes e tratar EXCLUÍDO/AFASTADO (login, ciclo, avaliação em curso).
- **Pré-requisito da fase 2:** trocar `sgu_location_code` posicional (`<código>-1`) por
  `<código>-<codigo_tipo_endereco>`, migrando as unidades existentes pelo endereço —
  senão login/senha por unidade/qualificação podem trocar de endereço numa recarga.
- Criar acesso e senha provisória para prestadores/unidades novos.
- Agendamento automático após cada carga da raw.

## Promoção

Migration **0059** sobe com o deploy (boot-migrate). A `sgu_providers_raw` precisa
existir no ambiente (em prod não foi verificada — leitura de prod bloqueada nesta sessão).
