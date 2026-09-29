# Termo de Ciência no roteiro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Termo de Ciência obrigatório antes de preencher cada roteiro, gravado na instância com snapshot do texto e visível ao auditor.

**Architecture:** Texto/versão em `src/lib/termoEvidencias.ts` (fonte única, servidor grava o snapshot). Tabela append-only `eval_instance_terms` (0056). Rota de aceite + trava no submit. Gate no RoteiroPlayer, linha + modal no AuditorPlayer.

**Tech Stack:** Express + pg, React + Tailwind, `node --import tsx --test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-29-termo-evidencias-roteiro-design.md`.
- Texto literal do `Termo - Revisado e Atualizado.docx` (título, 7 parágrafos, declaração).
- Versão `'2026-09-29'`. Tabela só INSERT, sem FK.

---

### Task 1: Texto e versão
**Files:** Create `src/lib/termoEvidencias.ts`, `src/lib/termoEvidencias.test.ts`; Modify `package.json` (script test).
- [ ] Teste: `termoEvidenciasTexto()` contém título, cada parágrafo e a declaração; `TERMO_EVIDENCIAS_VERSION === '2026-09-29'`. Rodar → FAIL.
- [ ] Implementar constantes + `termoEvidenciasTexto = () => [TITULO, ...PARAGRAFOS, DECLARACAO].join('\n\n')`. Rodar → PASS. Commit.

### Task 2: Migration 0056 + API
**Files:** Create `db/migrations/0056_eval_instance_terms.sql`; Modify `server.ts` (GET instância, nova rota `/term`, `submit`).
- [ ] Migration (colunas da spec + índice).
- [ ] GET `/api/eval/instances/:id`: `term` = `SELECT user_name, accepted_at, term_version, term_text FROM eval_instance_terms WHERE instance_id=$1 ORDER BY accepted_at DESC, id DESC LIMIT 1` (ou null).
- [ ] `POST /api/eval/instances/:id/term`: `loadInstanceForWrite`; staff → 403; versão ≠ atual → 409; já aceito na versão → 200; INSERT (snapshot `termoEvidenciasTexto()`, dados do usuário via SELECT em users, `hashClientIp`) + `auditLog` `eval_term_accepted` `{instance_id, version}`.
- [ ] `submit`: após checagem de status, sem linha em `eval_instance_terms` para a instância → 409 `{ error: 'Aceite o Termo de Ciência antes de enviar.' }`.
- [ ] `tsc`, `db:migrate` (dev), smoke (servidor local + cookie de prestador de teste). Commit.

### Task 3: RoteiroPlayer
**Files:** Create `src/components/TermoEvidenciasTexto.tsx`; Modify `src/pages/qualificacao/RoteiroPlayer.tsx`.
- [ ] Componente renderiza título/parágrafos da lib.
- [ ] Estado `termVersion: string | null` do `instanceData.term?.term_version`; `needsTerm = !readOnly && !loading && termVersion !== TERMO_EVIDENCIAS_VERSION`.
- [ ] Helper `ensureInstance()` (extrai o POST `/eval/instances` do upload; upload passa a usá-lo).
- [ ] `needsTerm` → corpo mostra o termo + checkbox (texto da declaração) + **Iniciar preenchimento** (disabled sem check) → `ensureInstance()` → `POST /eval/instances/:id/term` → `setTermVersion(atual)`. "Salvar e continuar depois" oculto enquanto `needsTerm`.
- [ ] `tsc`. Commit.

### Task 4: AuditorPlayer + QA
**Files:** Modify `src/pages/qualificacao/AuditorPlayer.tsx`.
- [ ] Abaixo do subtítulo: `instance.term` → "Termo de Ciência aceito por {user_name} em {fmtDataHora(accepted_at)} · Ver termo" (modal com `term_text` em `whitespace-pre-line`); senão "Termo de Ciência não aceito" (âmbar).
- [ ] `tsc`, `npm test`, `npm run build`, QA browser (prestador e auditor). Commit.
