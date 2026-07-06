# Carga de prestadores (import-providers) + vínculo de roteiro — design

**Data:** 2026-07-06
**Status:** aprovado pelo usuário; pronto para virar plano de implementação
**Escopo:** primeira carga real de prestadores (WS2) a partir de `cadastro_prestadores_v0.xlsx`; precursor do pipeline SGU ao vivo
**Pré-requisito:** roteiros já importados (`tsx db/import-roteiros.ts --commit`) para resolver o vínculo `eval_script_id`

## Problema

O portal roda hoje só com prestadores **sintéticos** (`db/seed-synthetic.ts`, `sgu_code = 'SYN-*'`) e cadastro manual pela rota `POST /api/providers`. A base real (~2.788 prestadores da Unimed Criciúma) existe apenas em planilha. Não há importador que leve esse cadastro para o Postgres. Enquanto o SGU ao vivo não é integrado, precisamos de uma carga **repetível e idempotente** a partir do `.xlsx`, que já siga a chave de integração do SGU (`Código Prestador → providers.sgu_code`) para virar o embrião do pipeline futuro.

Além do cadastro, queremos gravar em cada prestador **qual roteiro de avaliação se aplica a ele** — o resultado do match já produzido (colunas `ROTEIRO_COD`/`CONFIANCA`/`ROTEIRO_SUGERIDO_REVISAR` da planilha). Hoje `eval_scripts` não tem vínculo com tipo de prestador; abrir uma avaliação exige escolher o roteiro na mão.

## Objetivos

1. **Importador idempotente** `db/import-providers.ts` que carrega `cadastro_prestadores_v0.xlsx` em `providers`, `provider_locations` e `provider_certifications`.
2. **Agregação por `Código Prestador`**: 1 código = 1 prestador; as múltiplas linhas (uma por especialidade/serviço) viram o array `specialties`.
3. **Vínculo do roteiro** em cada prestador: FK `providers.eval_script_id` (resolvido de `FOR-XXX → eval_scripts` pelo `source_file`) + colunas de rastro `roteiro_cod`/`roteiro_confianca`.
4. **Log de sincronização** em `sgu_sync_runs` (contadores, origem, data/hora).
5. **Parser puro e testável**, separado do CLI, no mesmo padrão dos roteiros.

## Fora de escopo

- Conexão SGU ao vivo (DB/API) — esta carga lê o `.xlsx`; a chave `sgu_code` deixa o caminho pronto.
- Fluxo de avaliação S2 (criar `eval_instances`, preencher roteiro) — aqui só gravamos **qual** roteiro se aplica, não abrimos a avaliação.
- Revisão manual dos 1.136 "A DEFINIR" e das sugestões de especializados (fica para operação; os dados ficam gravados para isso).
- Geocoding / normalização de endereço além do parse best-effort.
- UI de upload — a carga roda por script (decisão do brainstorming).

## Decisões-chave (capturadas no brainstorming)

| Decisão | Escolha | Razão |
|---|---|---|
| Escopo de tabelas | providers + locations + certifications (completo) | Aproveita o schema já desenhado para o cadastro SGU 2.0 (migration 0005) |
| Mecanismo | Script tsx idempotente (dry-run + `--commit`) | Espelha `seed-synthetic.ts`/`import-roteiros.ts`; é o embrião do pipeline SGU |
| Grão da entidade | 1 `Código Prestador` = 1 prestador | Dados confirmam: 0 códigos com CNPJ/Tipo/Razão divergente; linhas repetem só por especialidade |
| Armazenar o roteiro | FK `eval_script_id` + `roteiro_cod`/`roteiro_confianca` | Liga de verdade ao motor de avaliação e preserva rastro/confiança p/ revisão |
| Chave de conflito | `sgu_code` (upsert `ON CONFLICT`) | Mesma chave do SGU; re-execução atualiza |
| CNPJ/CPF vindo como número | Recupera dígitos + zero-pad (14/11) | Excel converteu documentos em número/científico |
| Locais | Comercial = primário + guia médico; Residencial = secundário | Comercial é o local de atendimento (§5.4.1.1) |
| Inativos (PREST_MOT_EXCL) | Carrega com `status='inativo'` | Preserva base completa; filtro fica na consulta |

## Modelagem de dados (migration 0015)

`db/migrations/0015_provider_roteiro.sql` — aditiva e idempotente:

```sql
ALTER TABLE providers
  ADD COLUMN IF NOT EXISTS eval_script_id   bigint REFERENCES eval_scripts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS roteiro_cod      text,   -- 'FOR-017' (rastro do match; null p/ 'A DEFINIR')
  ADD COLUMN IF NOT EXISTS roteiro_confianca text;  -- Alta|Média|Baixa|A DEFINIR

CREATE INDEX IF NOT EXISTS providers_eval_script_idx ON providers (eval_script_id);
```

`eval_script_id` é **nullable**: fica null quando o roteiro é "A DEFINIR" ou quando o `eval_scripts` correspondente ainda não foi importado. `roteiro_cod`/`roteiro_confianca` guardam o resultado do match mesmo sem FK resolvida (rastreabilidade e fila de revisão).

## Arquitetura (2 arquivos, espelhando os roteiros)

### `db/providers-parser.ts` (puro — sem I/O de disco/banco)
- Entrada: array de linhas cruas (objetos por cabeçalho) — como `XLSX.utils.sheet_to_json(sheet, { raw: true })` devolve.
- Saída: `ParsedProvider[]` + `warnings[]`.
- Helpers reaproveitando o estilo de `roteiro-parser.ts` (`clean`, `num`).
- **Detecção de colunas por nome de cabeçalho** (robusto a deslocamento/ordem).
- **Limpeza de documento** `onlyDigits` + zero-pad: CNPJ→14, CPF→11; sinaliza tamanho inválido.
- **Agregação por `Código Prestador`**: campos cadastrais do 1º registro (constantes); `specialties` = união distinta de `Especialidade` no grupo, com `Espec. Principal` na frente.
- `person_type`: CNPJ→`PJ`; senão CPF→`PF`; senão null.
- `status`: `inativo` se `PREST_MOT_EXCL` preenchido; senão `ativo`.
- **Roteiro**: pega `ROTEIRO_COD`/`CONFIANCA` do grupo (constantes, derivam de tipo/grupo); mantém texto mesmo sem FK.
- **Locations**: Comercial (`is_primary=true`, `in_medical_guide=true`) e Residencial (secundário), cada um com CEP + endereço + telefone/celular + e-mail. Parse best-effort do endereço-texto (`logradouro`, `numero`, `bairro`, `cidade`, `uf`); **texto cru em `logradouro`** no fallback, com warn.
- **Certifications**: `ISO`→`iso_9001`; `Nível/Data/Validade/Instituição Acreditação`→`acreditacao`; `Preferencias Mestrado/Pós/Doutorado`→`mestrado`/`pos_graduacao`/`doutorado`. Só gera linha quando o campo tem conteúdo.

`ParsedProvider` (forma):
```ts
interface ParsedProvider {
  sgu_code: string;
  name: string; trade_name: string | null;
  person_type: 'PF' | 'PJ' | null;
  cnpj: string | null; cpf: string | null; council_registry: string | null;
  specialties: string[];
  provider_type: string | null; provider_group: string | null; area_atuacao: string | null;
  status: string;
  roteiro_cod: string | null; roteiro_confianca: string | null; // eval_script_id resolvido no CLI
  locations: ParsedLocation[];
  certifications: ParsedCertification[];
}
```

### `db/import-providers.ts` (CLI + banco)
- Lê `CADASTRO_FILE` (default `../cadastro_prestadores_v0.xlsx`), aba `"Match"` (env `CADASTRO_SHEET`).
- `XLSX.read(buffer)` → `sheet_to_json(raw:true)` → `parseWorkbook`.
- **Dry-run por padrão**; `--commit` grava. `--file`/args no estilo do `import-roteiros.ts`.
- **Resolução do roteiro**: carrega `eval_scripts (id, source_file)`, extrai `FOR-\d+` do `source_file`, monta mapa `código→id`; resolve `eval_script_id` por `roteiro_cod`. Conta resolvidos vs. não-resolvidos.
- **Commit** dentro de `withTransaction` (execução atômica):
  - `providers`: upsert `ON CONFLICT (sgu_code) DO UPDATE` (inclui `eval_script_id`, `roteiro_cod`, `roteiro_confianca`, `source='sgu'`, `sgu_synced_at=now()`).
  - `provider_locations` e `provider_certifications`: **delete-by-provider_id + reinsere** (idempotente, igual ao seed).
  - Grava 1 linha em `sgu_sync_runs` com contadores/origem/timestamp.
- `pool.end()` ao final quando em commit.

## Fluxo de dados

```
cadastro_prestadores_v0.xlsx (aba "Match", 4.446 linhas)
        │  XLSX.read → sheet_to_json(raw)
        ▼
providers-parser  ── agrega por Código Prestador ──▶  ParsedProvider[] (~2.788) + warnings
        │
import-providers  ── resolve FOR-XXX → eval_scripts.id ──▶  eval_script_id
        │  withTransaction (--commit)
        ▼
providers (upsert)  +  provider_locations (replace)  +  provider_certifications (replace)  +  sgu_sync_runs (log)
```

## Tratamento de erros / edge cases (reportados no dry-run)

- **CNPJ/CPF com tamanho inválido** após limpeza → mantém dígitos + warn (não bloqueia).
- **CNPJ/CPF duplicado entre códigos diferentes** (viola índice único parcial `providers_cnpj_uniq`/`_cpf_uniq`): mantém o 1º; nos seguintes, **zera o documento** + warn (evita quebrar a transação).
- **184 sem CNPJ nem CPF** → `person_type=null`, carrega assim.
- **Endereço não-parseável** → texto cru em `logradouro` + warn.
- **Roteiro não-resolvível** (A DEFINIR ou `eval_scripts` ausente) → `eval_script_id=null`, mantém `roteiro_cod`/`confianca`; conta no relatório.
- **Divergência de campo constante dentro do código** (não esperada) → usa o 1º + warn.

## Testes

`db/providers-parser.test.ts` (`node --test`, adicionado ao script `test`):
- Agrega múltiplas linhas do mesmo código em 1 prestador, com `specialties` unidas e sem duplicata; `Espec. Principal` na frente.
- Limpeza/pad de documento: número/científico → dígitos; CPF 11, CNPJ 14; tamanho inválido gera warn.
- `person_type` por presença de CNPJ/CPF; `status` por `PREST_MOT_EXCL`.
- Locations: comercial primário + guia médico; residencial secundário; fallback de endereço cru.
- Certifications: gera linha só quando o campo tem conteúdo; mapeia `kind` corretamente.
- Roteiro: propaga `roteiro_cod`/`roteiro_confianca`; "A DEFINIR" não vira código.

## Definition of Done

- `npm run db:migrate` aplica a 0015 sem erro; re-executável.
- `tsx db/import-providers.ts` (dry-run) imprime relatório com contadores (prestadores, PF/PJ, locations, certs, roteiros resolvidos) e warnings, **sem gravar**.
- `tsx db/import-providers.ts --commit` carrega ~2.788 prestadores idempotentemente; re-execução não duplica.
- `providers` populada com `sgu_code`, `specialties`, `provider_type/group`, `eval_script_id` (quando resolvível), `roteiro_cod/confianca`.
- `sgu_sync_runs` registra a execução.
- `npm test` verde, incluindo o novo teste do parser.
- Prestador enxerga (via app) o roteiro do seu tipo através do `eval_script_id`.
