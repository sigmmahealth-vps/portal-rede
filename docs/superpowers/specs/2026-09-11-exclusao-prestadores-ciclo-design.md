# Exclusão individual de prestadores na abertura do ciclo — design

**Data:** 2026-09-11
**Demanda do cliente (Qualificação → Ciclos → Abrir):** permitir remover do ciclo
prestadores que não participarão da qualificação vigente (ex.: médicos em processo de
aposentadoria, radiologistas, atendimento exclusivo CC/hospitalar), com dupla checagem.

## Contexto (o que existe hoje)

- Remoção só por **grupo inteiro** (tabela "Grupos participantes", `eval_cycle_groups`).
- Por linha (prestador × local) só há **troca de roteiro** (`eval_cycle_overrides`).
- `openCycleCore` (server.ts) cria 1 instância por local `in_medical_guide` cujo grupo
  está mapeado: `COALESCE(ov.script_id, ecg.script_id) IS NOT NULL`.
- Não existe exclusão individual — é o gap apontado.

## Decisões (validadas com o usuário em 2026-09-11)

1. **Granularidade: por linha (prestador × local)** — consistente com a tabela da tela.
   Médico cooperado (1 local) equivale a excluir o prestador; hospital pode tirar só uma
   unidade.
2. **Dupla checagem: motivo obrigatório + revisão na abertura** (1 usuário staff), não
   quatro-olhos. Três camadas: modal com justificativa ao excluir; lista revisável de
   excluídos na tela (reversível até abrir); total de excluídos repetido no "Confirmar
   abertura". Tudo no audit log.

## Dados

Migration `0047_eval_cycle_exclusions.sql`:

```sql
CREATE TABLE eval_cycle_exclusions (
  id          BIGSERIAL PRIMARY KEY,
  cycle_id    BIGINT NOT NULL REFERENCES eval_cycles(id) ON DELETE CASCADE,
  provider_id BIGINT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES provider_locations(id) ON DELETE CASCADE,
  reason      TEXT   NOT NULL,
  created_by  BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cycle_id, provider_id, location_id)
);
CREATE INDEX eval_cycle_exclusions_cycle_idx ON eval_cycle_exclusions (cycle_id);
```

Tabela própria (não `eval_cycle_overrides` com script NULL) porque: overrides são salvos
por replace em lote (perderiam autor/data), e exclusão carrega motivo — semânticas
distintas.

## API (staff; imutável após abertura, mesma regra dos grupos/overrides)

- `POST /api/eval/cycles/:id/exclusions` — body `{provider_id, location_id, reason}`.
  `reason` obrigatório (trim não-vazio). 409 se o ciclo já tem instâncias. Upsert por
  `(cycle_id, provider_id, location_id)` (re-excluir atualiza motivo). Audit
  `cycle_exclusion_added`.
- `DELETE /api/eval/cycles/:id/exclusions/:exclusionId` — reinclui. 409 se já aberto.
  Audit `cycle_exclusion_removed`.
- `GET /instances-preview` (existente) passa a devolver por linha:
  `excluded_id, excluded_reason, excluded_by (nome), excluded_at` via LEFT JOIN.
  Sem endpoint novo de listagem.

## Abertura e preview

- `openCycleCore`: INSERT de instâncias ganha
  `AND NOT EXISTS (SELECT 1 FROM eval_cycle_exclusions x WHERE x.cycle_id = $1 AND x.provider_id = p.id AND x.location_id = pl.id)`.
- `buildAperturaPreview`: mesmo filtro na contagem de instâncias (`would_create.instances`)
  — o KPI reflete exclusões na hora. Contagem de prestadores por grupo continua sendo o
  tamanho do grupo (universo), sem subtrair excluídos.
- Prestador excluído não recebe instância nem notificação `ciclo_aberto` (deriva das
  instâncias criadas — nada a fazer).
- Exclusões de grupos removidos do ciclo ficam na tabela (inócuas; se o grupo voltar, a
  exclusão volta a valer — comportamento desejado).

## UI — AbrirCicloPage

1. **Por linha** (só quando não readOnly): botão "remover do ciclo" (ícone UserMinus/×)
   → modal com campo de motivo obrigatório e chips de atalho que preenchem o texto
   (editável): "Aposentadoria", "Atendimento exclusivo CC/hospitalar", "Outro".
   Salva na hora (POST + reload do preview); sem estado sujo.
2. **Seção "Excluídos deste ciclo (N)"** (visível quando N > 0, inclusive readOnly como
   registro histórico): prestador, local, motivo, quem/quando; botão **Reincluir**
   (DELETE) quando não readOnly. Linhas excluídas saem da tabela principal.
3. **Confirmar abertura**: o confirm existente passa a incluir
   "N prestador(es) excluído(s) manualmente" quando N > 0.

## Fora do escopo

- Troca/remoção de roteiro por grupo: já existe, não muda.
- Quatro-olhos (aprovação por segundo usuário): descartado nesta fase.
- Exclusão após o ciclo aberto: não permitida (imutabilidade vigente).

## Verificação

- `npm run lint` (tsc) + suíte atual (`npm test`).
- Manual em dev: excluir linha → KPI Instâncias cai; reincluir → volta; abrir ciclo →
  excluído sem instância; tentar excluir com ciclo aberto → 409; audit log com as duas
  ações.
- Sem harness de endpoint no projeto — não será criado para isso.
