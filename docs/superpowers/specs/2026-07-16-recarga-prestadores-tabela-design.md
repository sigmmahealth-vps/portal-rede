# Recarga de Prestadores a partir da aba `tabela` (wipe + reload) — só dev

**Data:** 2026-07-16 · **Branch:** `dev` · **Ambiente-alvo:** somente dev (prod e homolog intocados)

## Contexto e objetivo

Substituir a base de prestadores do banco pela extração nova `Prestadores Portal.xlsx`, aba **`tabela`** (recorte guia médico: 676 prestadores, sem EXCLUÍDOS, sem os grupos "PRESTADOR SEM VINCULO" e "CLINICAS PRESTADORAS DE SERVIÇO"). A carga vira **wipe total + reinserção**, e cada prestador recebe o **roteiro de qualificação** calculado por uma regra determinística derivada dos próprios campos da planilha.

O importador atual (`db/import-providers.ts`) **não serve**: foi escrito para o layout do `cadastro_prestadores_v1.xlsx` (colunas `Código Prestador`, `Razão Social`, `GRUPO_PREST`, `Endereço Comercial`…), diferente do layout da `tabela`. Precisa de parser e importador novos.

## Decisões travadas (com o cliente)

1. **Método:** wipe total (`TRUNCATE providers CASCADE`) + reinserção. IDs de prestador novos. Aceita-se perder as 48 respostas de qualificação de teste e as 1.270 certificações (dado de teste em dev).
2. **Universo:** somente a aba `tabela` (676 prestadores). O banco encolhe de 2.800 → 676. Perde endereços não-guia-médico, `trade_name` e `area_atuacao` que a `tabela` não traz.
3. **Regra de roteiro:** plana por `Grupo do Prestador`, com exceção só para RECURSO PRÓPRIO (por `Tipo de prestador` + especialidade). Sem refino de clínica médica (FOR-013/016).
4. **person_type:** derivado do `Tipo de prestador` (não do comprimento do documento, que vem sujo).
5. **FOR-024 entra no escopo:** importar o roteiro Hospitais antes da recarga, para os hospitais receberem `eval_script_id` real. Regra de negócio: roteiro sem data de revisão herda a **data de Implantação** (criado então, ainda não revisado). Ver pré-requisito 0.
6. **Sem backup automático** antes do TRUNCATE e **sem re-vínculo automático** dos usuários de teste (opções não selecionadas). Ver "Riscos aceitos".

## Blast radius do TRUNCATE (verificado no banco)

Tudo que referencia `providers` é `ON DELETE CASCADE`, exceto 3 FKs `SET NULL`:

- **CASCADE** (apagado junto): `provider_locations`, `provider_certifications` (1.270), `eval_instances`/`eval_answers` (48), `contracts`, `documents`, `audits`, `action_plans`, `financials`, `price_tables`, `qualifications`, `qualification_submissions`, `tickets`, `survey_responses`, `provider_contacts`, `provider_trainings`.
- **SET NULL**: `users.provider_id` (5 usuários), `announcements.target_provider_id`, `trainings.target_provider_id`.

Consequência: após a recarga, os 5 usuários de teste ficam sem prestador vinculado e o histórico de qualificação some (aceito — dev).

## Arquitetura

Um pré-requisito (roteiro FOR-024) + três módulos + validação:

### 0) Pré-requisito — importar o roteiro FOR-024 (Hospitais)

Hoje FOR-024 não existe em `eval_scripts`. Causa-raiz (verificada): o cabeçalho usa `Revisão: 30/09/2025` (data direta, sem número de revisão), então o parser lê "30" como número de revisão e não acha data → `revisao_date=null` → o `INSERT` na coluna NOT NULL falha.

**Regra de negócio (definida pelo cliente):** um roteiro pode não ter data de revisão — nesse caso, considera-se a **data de Implantação**. Semântica: o roteiro foi criado na Implantação e **ainda não passou por revisão**.

Implementação (sem tocar planilha nem schema):
- **`db/roteiro-parser.ts`**: extrair `implantacaoDate` sempre; extrair `revisaoDate`/número de revisão **apenas** da forma de revisão real `Revisão: N em DD/MM/YYYY`. A forma `Revisão: DD/MM/YYYY` (sem número) **não** é tratada como revisão — deixa `revisaoDate=null` e número de revisão nulo (corrige o falso "30"). Tecnicamente: lookahead negativo `(?!\/)` no grupo do número de revisão.
- **`db/import-roteiros.ts` (`commitScript`)**: gravar `revisao_date = parsed.revisaoDate ?? parsed.implantacaoDate`. Se ambos faltarem, é erro de dado — falhar com aviso claro (não gravar null).

Para o FOR-024: `revisao_date = 2025-09-30` (herda a Implantação), número de revisão nulo, `implantacao_date=2025-09-30`, 34 seções / 359 critérios. Depois: `import-roteiros --commit --file FOR-024` (dry-run antes). O parser é compartilhado → **dry-run de todos os roteiros** após a mudança para confirmar zero regressão (FOR-017 permanece 01 / 2026-01-28).

Com FOR-024 em `eval_scripts`, o `resolveScriptIds()` da recarga resolve `FOR-024 → id`, e os 13 hospitais recebem `eval_script_id` real (deixa de haver prestador com FK null).

### Módulos da recarga

### 1) `db/roteiro-rule.ts` — regra de seleção de roteiro (função pura, sem I/O)

```
selecionaRoteiro(grupo: string, tipo: string, especialidades: string[])
  => { cod: string | null, confianca: 'Alta'|'Média'|null }
```

Normaliza (strip do prefixo `NN - `, UPPER, colapso de espaços) e aplica:

**Base — `Grupo do Prestador` → roteiro (confiança Alta):**

| Grupo (normalizado) | Roteiro |
|---|---|
| MEDICOS COOPERADOS · MEDICOS COOPERADOS ARARANGUA · MEDICOS CREDENCIADOS | FOR-017 |
| LABORATORIOS · LABORATORIOS ARARANGUA | FOR-004 |
| CLINICAS DE IMAGEM · CLINICAS DE IMAGEM ARARANGUA | FOR-002 |
| CLINICAS DE FISIOTERAPIAS · CLINICAS DE FISIOTERAPIA ARARANGUA | FOR-003 |
| ANATOMOPATOLOGIA | FOR-001 |
| PSICOLOGOS · PSICOLOGOS ARARANGUA · FONOAUDIOLOGOS · FONOAUDIOLOGOS ARARANGUA · NUTRICIONISTAS · NUTRICIONISTAS ARARANGUA · TERAPIA OCUPACIONAL | FOR-015 |
| CLINICA PSICOLOGO,FONO E/OU NUTRICIONIST | FOR-005 |
| CLINICAS MEDICAS · CLINICAS MEDICAS ARARANGUA | FOR-006 |
| HOSPITAIS · HOSPITAIS ARARANGUA | FOR-024 |

**Exceção — RECURSO PRÓPRIO (confiança Média), ordem de decisão:**
1. `Tipo` = HOSPITAL → FOR-024
2. `Tipo` = LABORATÓRIO → FOR-004
3. senão (CLÍNICAS) pela especialidade:
   - ≥2 de {FISIOTERAPIA, FONOAUDIOLOGIA, PSICOLOGIA, TERAPIA OCUPACIONAL} → FOR-005
   - alguma contendo "ANÁLISES CLÍNICAS" → FOR-004
   - senão → FOR-006

**A DEFINIR (`cod=null`):** HEMOSC e qualquer grupo não previsto (fail-safe — nunca chuta).

Teste `db/roteiro-rule.test.ts` (`node --test`): um caso por grupo + os 5 ramos de RECURSO PRÓPRIO + HEMOSC + grupo desconhecido.

### 2) `db/tabela-parser.ts` — parser do layout `tabela` (puro)

Agrega linhas por `Código do prestador` e produz um `ParsedProvider` por prestador. Mapeamento:

| Campo banco | Origem na `tabela` | Regra |
|---|---|---|
| `sgu_code` | Código do prestador | string |
| `name` | Nome do prestador | — |
| `trade_name` | Nome Fantasia | quase sempre null |
| `council_registry` | CRM | dígitos; null se 0/vazio |
| `status` | Situação do prestador | ATIVO→`ativo`, AFASTADO→`inativo` |
| `person_type` | Tipo de prestador | MÉDICO→PF; HOSPITAL/LABORATÓRIO/CLÍNICAS/CENTRO DE DIAGNÓSTICOS→PJ |
| `cnpj`/`cpf` | Número do CPF e/ou CNJP | dígitos, padStart(11) se PF → `cpf`; padStart(14) se PJ → `cnpj` |
| `provider_type` | Tipo de prestador | sem prefixo numérico |
| `provider_group` | Grupo do Prestador | sem prefixo numérico |
| `specialties` | Especialidades/Gr Serv | nomes distintos, sem prefixo, sem o flag S/N |
| `responsavel_tecnico` | Nome Responsavel Técnico | — |
| `area_atuacao` | — | null (não há na `tabela`) |
| `roteiro_cod`/`roteiro_confianca` | (calculado) | via `selecionaRoteiro(grupo, tipo, especialidades)` |

**Locations:** uma por endereço distinto (chave `CEP|Logradouro|Número`) do prestador — 619 têm 1, 52 têm 2, poucos 3–5 (~740 locais no total). Campos: `logradouro, numero, complemento, bairro, cep, cidade, uf, phone (Telefone/Celular), email`. Todos `in_medical_guide=true` (a `tabela` é guia médico) e `active=true`; `is_primary=true` no primeiro. `sgu_location_code = <sgu_code>-<n>`.

Colunas sem destino no schema: `RQE`, `Especialidade Principal(S/N)`, `Tipo de Endereço`, `Ponto de Referencia`, `Fax` — ignoradas. `ponytail:` se um dia forem necessárias, adicionar coluna + mapeamento.

### 3) `db/import-tabela.ts` — recarregador (CLI)

Dry-run por padrão; `--commit` grava. **Trava de host:** aborta se a `DATABASE_URL` resolvida não apontar para o host de **dev** (`reseau.proxy.rlwy.net`) — espelha a trava usada no clone dev→homolog, para nunca rodar em prod/homolog por engano.

Sequência do `--commit`, numa transação:
1. `INSERT INTO sgu_sync_runs (source='xlsx-tabela', status='running')`.
2. `TRUNCATE providers RESTART IDENTITY CASCADE`.
3. Para cada `ParsedProvider`: `INSERT` em `providers` (com roteiro já resolvido; `eval_script_id` via `resolveScriptIds()` — `FOR-(\d+)` sobre `eval_scripts.source_file`) e `INSERT` das locations. Com o pré-requisito 0 feito, todos os FOR resolvem; só A DEFINIR (HEMOSC) fica sem `eval_script_id`.
4. `UPDATE sgu_sync_runs` com contagens.

Dry-run imprime: nº de prestadores/locais parseados, distribuição por roteiro, quantos A DEFINIR, quantos com `eval_script_id` null, e avisos do parser (doc inválido, grupo desconhecido, endereço vazio).

## Sequência esperada e resultado

- **676 prestadores**, **~740 locations**, **0 certs** (a `tabela` não traz certificação).
- Distribuição de roteiro (validada sobre os 676): `FOR-017:496 · FOR-004:39 · FOR-006:39 · FOR-003:28 · FOR-005:25 · FOR-015:23 · FOR-024:13 · FOR-002:10 · FOR-001:2 · A DEFINIR:1 (HEMOSC)`.
- **Todos com `eval_script_id` resolvido**, exceto o 1 A DEFINIR (HEMOSC) — pois FOR-024 passa a existir (pré-requisito 0). Nenhum hospital fica com FK null.

## Validação (pós-recarga)

Script/consultas de conferência: `count(providers)=676`, `count(provider_locations)≈740`, distribuição de roteiro conforme acima, nenhum `roteiro_cod` fora do conjunto de FOR válidos, todos os `sgu_code` únicos. Rodar o dry-run e conferir os números **antes** do `--commit`.

## Riscos aceitos (decisão do cliente)

- **Irreversível:** sem backup antes do TRUNCATE. Recuperação do estado atual só re-clonando de homolog. *(Reversível a pedido: adicionar passo de dump JSON antes do TRUNCATE.)*
- **Usuários de teste sem prestador:** os 5 `users.provider_id` viram null; o fluxo de qualificação do `prestador-homolog` fica inoperante até religar manualmente. *(Reversível a pedido: passo de re-vínculo por `sgu_code` ao fim da recarga.)*

## Simplificações deliberadas (`ponytail:`)

- **Laboratório de anatomia em RECURSO PRÓPRIO:** os 20 "LABORATÓRIO" têm especialidades idênticas; vão todos a FOR-004. Upgrade: refinar por especialidade se a Unimed distinguir anatomopatologia.
- **Sem FOR-013/016/007/008/009/011:** fora de escopo por decisão de granularidade.
- **Certificações não migradas:** a `tabela` não traz; providers ficam sem certs até um fluxo próprio.

## Fora de escopo

- Promoção da recarga para homolog/prod (só após validar em dev). Nota: a mesma correção do parser (revisão→implantação) precisará ser aplicada ao importar FOR-024 em homolog/prod.
- Reintrodução de endereços de faturamento/correspondência, `trade_name`, `area_atuacao`, EXCLUÍDOS e grupos 24/27.
- Backup e re-vínculo de usuários (disponíveis a pedido — ver Riscos aceitos).
