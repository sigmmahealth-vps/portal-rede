# Gestão Documental — Verificar (obrigatórios faltantes) — Design

**Data:** 2026-11-16
**Status:** aprovado (desenho) — pendente revisão da spec escrita

## Contexto e objetivo

Sexta fatia da Gestão Documental. A Matriz Legal (fatia anterior) define quais tipos de
documento são obrigatórios por função de prestador. O **Verificar** cruza essa matriz com os
documentos de cada prestador e mostra, por prestador, quais documentos obrigatórios estão
**sem um documento aprovado e vigente** — e por quê. Fecha o ciclo da Matriz Legal.

Reusa `obrigatoriosPara` (Matriz Legal), `statusDocumento` (fatia Investigação & Lista),
`deriveProviderRole` e `providerAudience`.

### Regra de "faltante" (decidida)
Para a função do prestador, um tipo obrigatório é **faltante** quando o prestador **não tem
nenhum documento daquele tipo com status efetivo `aprovado`** (aprovado e vigente). O **motivo**
é derivado:
- `ausente` — nenhum documento daquele tipo.
- senão, o status efetivo do documento **mais recente** daquele tipo: `vencido`, `reprovado` ou `pendente`.

### Fora de escopo
- Status **Isento** (exceção por prestador/tipo) — fatia futura.
- Ações em massa (notificar todos), export, filtro por município.
- Inclusão no `historico` na contagem (documentos substituídos não contam).

## Funções puras (testadas) — `src/lib/verificar.ts`

```ts
import { statusDocumento, type StatusDoc } from './documentoStatus.js';

export type MotivoFaltante = 'ausente' | 'vencido' | 'reprovado' | 'pendente';
export type Faltante = { type_id: number; motivo: MotivoFaltante };

// Status efetivo "melhor" por tipo, a partir dos documentos de UM prestador.
// Reduz vários documentos do mesmo tipo a um só status (o do mais recente por upload_date),
// EXCETO se já houver um 'aprovado' daquele tipo — aí o tipo está satisfeito.
export function statusPorTipo(
  docs: { type_id: number | null; status: string; expiry_date: string | null; upload_date?: string | null }[],
  hoje?: Date,
): Map<number, StatusDoc>;

// Tipos obrigatórios (requiredTypeIds) sem status 'aprovado' → faltantes com motivo.
// motivo = statusPorTipo.get(type_id) mapeado (vencido/reprovado/pendente) ou 'ausente'.
// 'historico' e qualquer status não esperado caem em 'ausente' (não satisfaz nem explica).
export function faltantesPara(
  requiredTypeIds: Iterable<number>,
  porTipo: Map<number, StatusDoc>,
): Faltante[];
```

Regras de `statusPorTipo`:
- Ignora docs com `type_id` nulo.
- Para cada `type_id`, se **qualquer** documento daquele tipo é `aprovado` → o mapa guarda `aprovado`
  (tipo satisfeito). Senão, guarda o status efetivo do documento de maior `upload_date`.
- `statusDocumento` já esconde `historico` como status efetivo; o chamador do servidor não envia
  documentos `historico` (ver query), então não poluem o "mais recente".

Regras de `faltantesPara`:
- Para cada `type_id` em `requiredTypeIds`: `s = porTipo.get(type_id)`.
  - `s === 'aprovado'` → não é faltante.
  - `s` ∈ {`vencido`,`reprovado`,`pendente`} → faltante com esse motivo.
  - `s` ausente ou qualquer outro → faltante `ausente`.
- Ordena por `type_id` para saída determinística (facilita teste).

## Servidor — `GET /api/admin/document-verificar` (`authenticate, requireAdmin`)

Monta a resposta cruzando quatro conjuntos:
1. Prestadores: `SELECT id, name, person_type, provider_group FROM providers`.
2. Matriz **só de tipos ativos** (resolve a nota da revisão da Matriz Legal):
   `SELECT r.type_id, r.role FROM document_type_requirements r JOIN document_types t ON t.id = r.type_id AND t.ativo = true`.
3. Catálogo ativo: `SELECT id, nome FROM document_types WHERE ativo = true` (para o nome de cada faltante).
4. Documentos de gestão documental **não-histórico**:
   `SELECT provider_id, type_id, status, expiry_date, upload_date FROM documents WHERE type_id IS NOT NULL AND status <> 'historico'`.

Para cada prestador:
- `role = deriveProviderRole(person_type, provider_group)`;
- `required = obrigatoriosPara(role, requirements)` (Set de type_id);
- `porTipo = statusPorTipo(docsDoPrestador)`;
- `faltantes = faltantesPara(required, porTipo)` → anexa `nome` de cada `type_id` pelo catálogo.

Responde **só os prestadores com ≥1 faltante**:
```json
[{ "provider_id": 1, "name": "...", "person_type": "PF", "provider_group": "...",
   "role": "cooperado", "faltantes": [{ "type_id": 7, "nome": "CRM...", "motivo": "ausente" }] }]
```
Agrupa os documentos por `provider_id` em memória (uma passada) — carga pequena, sem N+1.

## UI — sub-aba "Verificar" no Painel de Controle

- Em `src/pages/documentos/PainelControle.tsx`, adicionar a sub-aba **Verificar** à lista de
  sub-abas (hoje: Overview, Alvarás, Certificações [stub], Escolaridade [stub]). Posição: logo
  após Alvarás.
- Componente próprio `src/pages/documentos/Verificar.tsx` (recebe `audiencia`), que:
  - busca `GET /api/admin/document-verificar` no mount (lazy — só quando a sub-aba abre, ou no
    mount do componente, que só monta quando a sub-aba está ativa);
  - filtra os prestadores por audiência: `providerAudience(person_type, provider_group) === audiencia`;
  - tabela **Prestador | Função | Documentos faltantes**; cada faltante é um chip com o nome do
    tipo e cor por motivo (cinza=ausente, vermelho=vencido/reprovado, azul=pendente);
  - rótulo legível da função (reusa o mapa de rótulos: Médico Cooperado / Médico Credenciado /
    PF não médico / Prestador PJ);
  - contagem no topo ("N prestadores com pendências"); estados loading / vazio ("Nenhuma
    pendência") / erro (banner que não apaga a tabela).

## Testes
- `src/lib/verificar.test.ts` (`node:test`, incluído no script `test`):
  - `statusPorTipo`: tipo com vários docs (aprovado vence os demais; sem aprovado pega o mais
    recente); ignora `type_id` nulo; vencido via `expiry_date` passado.
  - `faltantesPara`: tipo aprovado (não faltante); vencido/reprovado/pendente com o motivo certo;
    tipo obrigatório sem nenhum doc → `ausente`; ordenação por `type_id`.
- Servidor/React: sem harness → `tsc` + build + smoke no navegador.

## Dados de teste
O DEV já tem 3 prestadores, documentos semeados e a Matriz Legal vazia. Para o Verificar
mostrar linhas, a matriz precisa ter requisitos marcados (feito na UI da Matriz Legal) — ou
semear alguns requisitos. Decidir no plano; não bloqueia a fatia (com matriz vazia, a tela
mostra corretamente "Nenhuma pendência").
