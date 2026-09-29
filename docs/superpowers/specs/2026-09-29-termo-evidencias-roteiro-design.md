# Termo de Ciência e Responsabilidade pelo Envio de Evidências — design

**Data:** 2026-09-29 · **Origem:** Unimed Criciúma (`Termo - Revisado e Atualizado.docx`).

## Objetivo

Antes de preencher um roteiro, o prestador lê o termo e marca "Declaro que li e compreendi…" — obrigatório para continuar. O aceite (com o texto aceito) fica registrado **no roteiro** (eval_instance) e é visível ao auditor.

## Decisões

| Tema | Decisão |
|---|---|
| Granularidade | 1 aceite por eval_instance (prestador × unidade × ciclo); reanálise/devolução não repedem |
| Quem aceita | Acessos de prestador que preenchem o roteiro (staff não) |
| Prova | Snapshot integral do texto + versão, quem, quando, ip_hash; só INSERT |
| Trava servidor | `POST /api/eval/instances/:id/submit` recusa (409) sem aceite |
| Visibilidade | Cabeçalho do AuditorPlayer: "Termo aceito por X em dd/mm/aaaa hh:mm · Ver termo" ou "Termo não aceito" |
| Roteiros em andamento | Pedem o aceite na próxima abertura |

## Desenho

- **Texto/versão:** `src/lib/termoEvidencias.ts` — `TERMO_EVIDENCIAS_VERSION = '2026-09-29'`, `TERMO_EVIDENCIAS_TITULO`, `TERMO_EVIDENCIAS_PARAGRAFOS: string[]`, `TERMO_EVIDENCIAS_DECLARACAO`, `termoEvidenciasTexto(): string` (snapshot gravado).
- **Migration 0056** `eval_instance_terms(id, instance_id NOT NULL, user_id, user_name, user_email, term_version, term_text, accepted_at, ip_hash)` + índice `(instance_id, accepted_at DESC)`. Sem FK (registro sobrevive).
- **API:**
  - `GET /api/eval/instances/:id` inclui `term` = último aceite da instância `{ user_name, accepted_at, term_version, term_text }` ou `null`.
  - `POST /api/eval/instances/:id/term` (loadInstanceForWrite; só não-staff) body `{version}`: versão ≠ atual → 409; já aceito nesta versão → 200 sem inserir; senão INSERT + auditLog `eval_term_accepted`.
  - `submit`: sem aceite na instância → 409 `termo de ciência não aceito`.
- **RoteiroPlayer:** se `!readOnly` e sem aceite da versão atual, o corpo mostra o termo (texto, checkbox com a declaração, botão **Iniciar preenchimento** habilitado só com check) no lugar dos critérios. Sem instância ainda → cria via `POST /eval/instances` antes de gravar o aceite (helper `ensureInstance`, reusado pelo upload).
- **AuditorPlayer:** linha no cabeçalho com o aceite + modal "Ver termo" exibindo `term_text` gravado.

## Testes

- `src/lib/termoEvidencias.test.ts`: snapshot contém título, parágrafos e declaração; versão definida.
- Smoke API: 409 versão errada; 200 grava 1 linha; repetido não duplica; submit sem aceite → 409; GET traz `term`.
- Browser: termo antes dos critérios, botão desabilitado sem check, aceitar mostra critérios e não volta; cabeçalho do auditor.

## Promoção

0056 sobe no boot. Roteiros em andamento pedem o termo na próxima abertura.
