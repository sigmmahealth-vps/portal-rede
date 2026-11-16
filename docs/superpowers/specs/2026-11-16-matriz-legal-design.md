# Gestão Documental — Matriz Legal editável — Design

**Data:** 2026-11-16
**Status:** aprovado (desenho) — pendente revisão da spec escrita

## Contexto e objetivo

Quinta fatia da Gestão Documental. O catálogo `document_types` tem um flag **global**
`obrigatorio` + `escopo` (prestador/profissional), mas não distingue obrigatoriedade **por
categoria de prestador**. A **Matriz Legal** resolve isso: uma grade **tipo de documento ×
categoria**, editável pelo admin, que define quais documentos são obrigatórios para cada
função de prestador. Hoje a aba **Matriz Legal** é um stub `<EmBreve/>` na casca
`GestaoDocumental`.

Esta fatia entrega a **matriz editável**. O **Verificar** (quais obrigatórios faltam por
prestador) é a fatia seguinte, que esta desbloqueia.

### Colunas (decidido)
As **4 funções derivadas** por `deriveProviderRole(person_type, provider_group)`
(`db/provider-role.ts`), já atribuídas automaticamente a todo prestador:
- `cooperado` — Médico Cooperado
- `credenciado` — Médico Credenciado
- `pf_nao_medico` — PF não médico
- `prestador` — Prestador PJ (clínicas, laboratórios, etc.)

### Fora de escopo
- Card/tela **Verificar** (obrigatórios faltantes por prestador) — próxima fatia.
- Status **Isento** e célula tri-estado (obrigatório/isento/opcional) — binário por ora.
- Categorias customizadas / subdivisão do PJ (clínica/lab/fisio) — precisa de classificação nova.
- Recorte pelo toggle Médicos/Rede — a matriz é configuração global, mostra as 4 colunas sempre.

## Modelo de dados

Migration nova `db/migrations/0063_document_type_requirements.sql` — junção **por presença**:

```sql
CREATE TABLE IF NOT EXISTS document_type_requirements (
  type_id bigint NOT NULL REFERENCES document_types(id) ON DELETE CASCADE,
  role    text   NOT NULL CHECK (role IN ('cooperado','credenciado','pf_nao_medico','prestador')),
  PRIMARY KEY (type_id, role)
);
```

**Linha existe ⇒ obrigatório** para aquela função. Sem coluna booleana: marcar = INSERT,
desmarcar = DELETE. Sem seed (admin preenche conforme a diretriz OPS-COP-FLU-009). `ON DELETE
CASCADE` limpa requisitos quando um tipo é removido do catálogo.

## Função pura (testada) — `src/lib/matrizLegal.ts`

```ts
export type Requirement = { type_id: number; role: string };
// Conjunto de type_id obrigatórios para uma função, a partir da lista plana da matriz.
export function obrigatoriosPara(role: string, reqs: Requirement[]): Set<number>;
```

Base do Verificar na próxima fatia. Testes: função com reqs de várias funções, role sem
nenhum obrigatório (Set vazio), role desconhecida.

## Servidor (admin-only, espelha `/api/admin/document-types` — guard `authenticate, requireAdmin`)

- `GET /api/admin/document-requirements` →
  `{ types: DocumentType[]; requirements: { type_id, role }[] }`
  (tipos ativos ordenados por `ordem`; a matriz plana). Reusa o guard de admin existente.
- `PUT /api/admin/document-requirements` body `{ type_id: number, role: string, obrigatorio: boolean }`:
  - valida `type_id` existe e `role` ∈ as 4 funções (senão 400);
  - `obrigatorio=true` → `INSERT ... ON CONFLICT (type_id, role) DO NOTHING`;
  - `obrigatorio=false` → `DELETE WHERE type_id=$1 AND role=$2`.
  - Responde `{ ok: true }`. Um toggle por célula (sem batch — UX de grade de permissões).

## UI — `src/pages/documentos/MatrizLegal.tsx`

- Na casca `GestaoDocumental`, `aba === 'matriz'` renderiza `<MatrizLegal/>` no lugar do
  `<EmBreve titulo="Matriz Legal"/>`.
- Busca `GET /api/admin/document-requirements` no mount; monta um `Set` de `"${type_id}:${role}"`
  para marcação O(1).
- Tabela: 1ª coluna = nome do tipo (ordenado por `ordem`); 4 colunas = as funções (rótulos
  legíveis: "Médico Cooperado", "Médico Credenciado", "PF não médico", "Prestador PJ"); cada
  célula = checkbox.
- Ao clicar, faz `PUT` otimista (atualiza o Set na hora; reverte e mostra erro se o PUT falhar).
- Estados: loading no fetch inicial, empty (catálogo vazio → orienta cadastrar tipos), erro de
  rede não apaga a grade (segue o padrão das telas anteriores).
- Sem recorte pelo toggle Médicos/Rede (config global).

## Testes
- `src/lib/matrizLegal.test.ts` (`node:test`, incluído no script `test`): `obrigatoriosPara`
  (vários roles, vazio, role inexistente).
- Servidor/React: sem harness no repo → `tsc` + build + smoke no navegador (marcar/desmarcar
  célula persiste após reload).

## Dados de teste
Opcional: estender `db/seed-teste.ts` ou um seed próprio para semear alguns requisitos (ex.:
Alvarás obrigatórios p/ `prestador`; CRM p/ `cooperado`/`credenciado`), só para a grade não
nascer vazia no DEV. Decidir no plano; não bloqueia a fatia.
