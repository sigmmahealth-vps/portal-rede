# Gestão Documental — Parte 1: Catálogo de tipos + regras + validação

**Data:** 2026-11-13
**Status:** aprovado (desenho) — pendente revisão da spec escrita

## Contexto e objetivo

O portal tem um módulo de Gestão Documental herdado da Criciúma: página
[Documentos.tsx](../../../src/pages/Documentos.tsx), API CRUD `/api/documents`
([server.ts](../../../server.ts)) e tabela `documents`. Ele está **construído mas
congelado** — travado como "Em breve" para prestadores em
[Layout.tsx](../../../src/components/Layout.tsx) (`PROVIDER_SOON`).

Hoje os **tipos de documento são um dropdown chumbado** (11 strings) gravados no
campo texto livre `documents.type`, **sem catálogo nem regras por tipo**. Esta é a
fundação que falta para todas as demais partes (obrigatoriedade, validade, bloqueio,
formatos — tudo depende de "qual tipo tem qual regra").

A Parte 1 substitui o dropdown fixo por um **catálogo editável por admin**, com regras
por tipo, e passa a **validar formato e tamanho** no upload.

### Estado atual relevante (verificado no banco DEV anonimizado)

- A tabela `documents` hoje é **100% evidência de qualificação**: todos os 9839 registros
  têm `type = 'qualificacao_evidencia'` (agrupados por `question_id`, migration 0017).
- **Não há nenhum documento de Gestão Documental real** — o dropdown de alvará/CNES/etc.
  nunca foi usado em produção. Logo o catálogo nasce limpo e o backfill não tem legado a casar
  (fica como passo defensivo para rows manuais em outros ambientes).
- Papéis existentes: `admin`, `auditoria`, e os de prestador. `requireAdmin` já existe
  ([server.ts](../../../server.ts)).

## Escopo

### Dentro da Parte 1
- Tabela `document_types` (catálogo com regras).
- Coluna `documents.type_id` (FK), convivendo com `documents.type` texto.
- CRUD admin do catálogo (aba em `Admin.tsx` + API `requireAdmin`).
- Endpoint de leitura do catálogo para o dropdown de upload.
- Validação de upload: tipo ativo, validade quando a regra exige, formato PDF/JPG/PNG/DOCX,
  tamanho ≤ 20 MB.
- Migração: cria a tabela, semeia o catálogo inicial, backfill `type → type_id`.
- Teste: regra de validação como função pura.

### Fora da Parte 1 (próximas partes)
- Destravar para o prestador + notificação de homologação (Parte 2).
- Status `vencido` no servidor + alertas de vencimento (Parte 3).
- Versionamento formal + cadência de POP (Parte 4).
- Documentos de profissionais vinculados (Parte 5) — o catálogo já carrega `escopo` como metadado.
- Contratos + aditivos (Parte 6).
- Bloqueio preventivo conforme regras Unimed (Parte 7) — `obrigatorio` é só metadado agora.
- Assinatura eletrônica + guarda LGPD (Parte 8).

## Modelo de dados

### Nova tabela `document_types`

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | bigint identity PK | |
| `nome` | text NOT NULL UNIQUE | ex.: "Alvará Sanitário" |
| `categoria` | text NULL CHECK in (`obrigatoria`,`tecnica`,`regulatoria`,`contratual`) | metadado p/ admin (os 4 baldes do objetivo); `NULL` para "Outros" |
| `obrigatorio` | boolean NOT NULL DEFAULT false | **só metadado** nesta parte (bloqueio é Parte 7) |
| `escopo` | text NOT NULL DEFAULT `prestador` CHECK in (`prestador`,`profissional`) | profissional só "liga" na Parte 5 |
| `ativo` | boolean NOT NULL DEFAULT true | desativa sem apagar |
| `ordem` | integer NOT NULL DEFAULT 0 | ordenação no dropdown |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

### Alteração em `documents`
- `ADD COLUMN type_id bigint REFERENCES document_types(id)` (nullable).
- A coluna `type` texto **permanece** por compatibilidade. Rows de evidência
  (`type='qualificacao_evidencia'`) e quaisquer legados ficam com `type_id` nulo e
  **não são tocados** — o catálogo (`type_id`) vale só para documentos de Gestão Documental.

## Catálogo inicial (seed)

A semente é a **lista do mockup do prestador** (tela "Enviar Documento"), semeada pela migration.
Como o catálogo é **editável por admin**, os demais tipos do objetivo (RQE, Simples Nacional,
ISO/ONA, POP, diplomas, contratos vigentes/aditivos) podem ser adicionados depois na tela, sem deploy.

| nome | categoria | escopo |
|---|---|---|
| Alvará de Localização | obrigatoria | prestador |
| Alvará Sanitário | obrigatoria | prestador |
| Alvará do Corpo de Bombeiros | obrigatoria | prestador |
| Anotação de Responsabilidade Técnica (ART) | regulatoria | prestador |
| CNES | obrigatoria | prestador |
| Contrato Social | regulatoria | prestador |
| CRM do Responsável Técnico | regulatoria | profissional |
| Declaração de Regularidade - CR | regulatoria | prestador |
| Autorização de Funcionamento - CNEN | obrigatoria | prestador |
| Outros | (NULL) | prestador |

> `emissão` e `validade` são **opcionais** em todos os tipos (requisito do mockup). O catálogo
> não guarda regra de validade; o alerta de vencimento (Parte 3) usa apenas a validade que o
> prestador informar — documento sem validade não vence.

## API

Todas em [server.ts](../../../server.ts), seguindo o padrão existente.

### Catálogo (admin)
- `GET /api/admin/document-types` (`authenticate`, `requireAdmin`) — lista todos (inclui inativos).
- `POST /api/admin/document-types` (`requireAdmin`) — cria. Valida `categoria`/`escopo` nos enums,
  `nome` único.
- `PUT /api/admin/document-types/:id` (`requireAdmin`) — edita.
- `DELETE /api/admin/document-types/:id` (`requireAdmin`) — **soft delete** (`ativo=false`) se já
  houver `documents.type_id` apontando para ele; **hard delete** se nenhum documento usa.

### Catálogo (leitura para upload)
- `GET /api/document-types` (`authenticate`) — só `ativo=true`, ordenado por `categoria`,`ordem`,`nome`.
  Alimenta o dropdown de upload.

### Upload (alteração em `POST /api/documents`)
- O cliente passa a enviar `type_id` (fonte da verdade); o campo `type` texto deixa de ser enviado.
- O servidor grava `type_id` e também `type` = nome do tipo do catálogo (mantém a coluna texto
  coerente/legível para telas e relatórios).
- `issue_date` (emissão) e `expiry_date` (validade) continuam **opcionais**.
- Aplica a validação (abaixo) antes de persistir.

## Frontend

### Aba de catálogo no admin
Nova aba **"Tipos de Documento"** em [Admin.tsx](../../../src/pages/Admin.tsx) (que já é um
conjunto de abas). Tabela com os tipos + modal de criar/editar (nome, categoria, obrigatorio,
escopo, ativo, ordem). Segue o visual das abas existentes (ex.: `UsuariosTab`, `EmailsTab`).

### Dropdown de upload
Em [Documentos.tsx](../../../src/pages/Documentos.tsx), o `<select>` de tipo passa a ler de
`GET /api/document-types` em vez da lista chumbada. Emissão e validade seguem como campos
**opcionais** no formulário.

## Regras de validação (upload)

Função pura em `src/lib/documentTypeRules.ts`, consumida pela rota de upload e coberta por teste.

- **Formato:** extensão/mimetype em { PDF, JPG, JPEG, PNG, DOCX }. Fora disso → 400.
- **Tamanho:** ≤ 20 MB. Acima → 400 (reusar o padrão de mensagem de
  [server.ts](../../../server.ts), que já tem o limite de 20 MB para manuais).
- **Tipo:** `type_id` precisa existir e estar `ativo`. Senão → 400.

Emissão e validade **não são validadas** (opcionais).

A aplicação no multer: o upload de documentos deixa de usar o `upload` cru (sem limite) e passa a
usar um middleware com `limits.fileSize = 20 MB` e `fileFilter` pelos formatos aceitos.

## Migração

Nova migration `db/migrations/0062_document_types.sql` (próximo número após o 0061):

1. `CREATE TABLE document_types (...)` com os CHECKs.
2. `ALTER TABLE documents ADD COLUMN IF NOT EXISTS type_id bigint REFERENCES document_types(id)`.
3. `INSERT` do catálogo inicial (tabela "Catálogo inicial" acima), idempotente
   (`ON CONFLICT (nome) DO NOTHING`).
4. **Backfill defensivo:** `UPDATE documents d SET type_id = t.id FROM document_types t
   WHERE d.type_id IS NULL AND d.type = t.nome`. (Hoje casa zero rows, pois tudo é
   `qualificacao_evidencia`; fica para rows manuais de outros ambientes.)
5. Índice: `CREATE INDEX documents_type_id_idx ON documents (type_id)`.

Idempotente e segura de reexecutar, como as demais migrations
([db/migrate.ts](../../../db/migrate.ts) roda cada arquivo uma vez, em transação).

## Testes

- `src/lib/documentTypeRules.test.ts` — cobre: formato aceito/recusado, tamanho no limite e acima,
  tipo inativo/inexistente. Segue o padrão `node:test` do repositório (incluir no script `test`
  do `package.json`).

## Convivência com a qualificação

A tabela `documents` continua servindo às evidências de qualificação
(`type='qualificacao_evidencia'`, `question_id`, `reference_id`). O catálogo e a validação de
formato/tamanho da Parte 1 **só se aplicam ao fluxo de Gestão Documental** (`POST /api/documents`
com `type_id`). O caminho de evidência não recebe `type_id` e não é afetado.

## Requisitos capturados dos mockups do prestador (Partes 2–3, fora desta parte)

Registrados aqui para não se perderem; **não** são implementados na Parte 1.

- **Lista do prestador (Parte 2):** na aba "Documentação", o prestador/cooperado vê todos os seus
  documentos, em colunas Tipo · Emissão · Validade · Status · Ações.
- **Status (Parte 2/3):**
  - *Válido* — aprovado e dentro da validade.
  - *Vencido* — passou da validade e nenhum documento foi enviado para substituir.
  - *Pendente* — enviado um novo documento, mas sem análise/aprovação ainda.
  - *Reprovado* — após análise do auditor/admin, o documento enviado não foi aprovado.
- **Visualizar (Parte 2):** ação "Visualizar" abre janela suspensa com a imagem do documento
  (o modal já existe em `Documentos.tsx`).
- **Atualizar (Parte 2/4):** quando o documento está vencido, botão "Atualizar" permite enviar nova
  versão (o upload já marca a anterior como `historico`).
- **E-mails de vencimento (Parte 3):** 30 dias antes de vencer, dispara e-mail ao prestador/cooperado
  avisando e pedindo novo envio; após o vencimento, repete **a cada 3 dias**.
