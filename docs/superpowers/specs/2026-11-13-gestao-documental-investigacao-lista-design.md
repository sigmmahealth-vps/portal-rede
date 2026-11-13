# Gestão Documental — Investigação e Lista (painel admin) — Design

**Data:** 2026-11-13
**Status:** aprovado (desenho) — pendente revisão da spec escrita

## Contexto e objetivo

Os mockups do painel admin de Gestão Documental descrevem três subsistemas: **BI Painéis**
(dashboard), **Investigação e Lista** (fluxo de homologação) e **Matriz Legal**. Esta spec cobre
a **primeira fatia: Investigação e Lista** — a tela onde o admin revisa os documentos enviados
pelos prestadores, aprova/reprova e notifica. BI Painéis e Matriz Legal ficam para fatias futuras
(entram agora apenas como abas "em breve" na casca).

Depende da Parte 1 (catálogo `document_types`, `documents.type_id`, upload validado), já na `dev`.

### Estado atual reaproveitado (verificado no código)
- `PUT /api/documents/:id/status` ([server.ts:2493](../../../server.ts)) já aprova/reprova:
  grava `status` (`valido`/`reprovado`), `issue_date`, `expiry_date`, `rejection_reason`. É o "Analisar".
- `notifyEvent(...)` ([server.ts:312](../../../server.ts)) cria notificação in-app **e** dispara
  e-mail a partir de um tipo do catálogo (`src/lib/notifyCatalog.ts`). É o motor do "Notificar".
- `prestadorRecipients(providerId)` ([server.ts:220](../../../server.ts)) resolve os acessos do prestador.
- `GET /api/documents` já retorna `provider_name` e `uploaded_by_name`.
- `src/lib/auditorXlsx.ts` é o padrão de geração de `.xlsx` (XLSX.utils.aoa_to_sheet → buffer).
- `deriveProviderRole` / `COOPERADO_GROUP_RE` / `CREDENCIADO_GROUP_RE` ([db/provider-role.ts](../../../db/provider-role.ts))
  classificam Médico (cooperado/credenciado) × Rede.
- A tela admin de documentos, o viewer e o modal de aprovar/reprovar já existem em
  [Documentos.tsx](../../../src/pages/Documentos.tsx) — serão reorganizados nesta fatia.

## Escopo

### Dentro
- Casca **Gestão Documental** (admin) com abas de topo: **Investigação & Lista** (real), **BI Painéis**
  e **Matriz Legal** (stubs "em breve"), e alternância **Médicos × Rede Prestadora**.
- Tela **Investigação & Lista**: lista dos documentos enviados, busca, filtros (status, grupo), export `.xlsx`.
- **Analisar**: modal único com viewer do anexo + aprovar/reprovar (validade/emissão + justificativa).
- **Notificar**: modal com mensagem semi-pronta editável → notificação in-app + e-mail ao prestador.

### Fora (fatias futuras)
- BI Painéis (cards, taxas de conformidade, gráficos, sub-abas Overview/Alvarás/Certificações/Escolaridade).
- Matriz Legal (obrigatoriedade por categoria — diretriz OPS-COP-FLU-009).
- Atributos de prestador: ISS, Prontuário Eletrônico, Escolaridade, estados de CNES.
- Status **Isento / Vencendo / Verificar** (conceitos do dashboard). Esta tela usa só
  **Pendente / Aprovado / Vencido / Reprovado**.

## Arquitetura (frontend)

Para não inchar o `Documentos.tsx`, a visão admin é extraída:

- `src/pages/Documentos.tsx`: se `isAdmin`, renderiza `<GestaoDocumental/>`; senão, mantém a visão
  pessoal do prestador como está hoje.
- `src/pages/documentos/GestaoDocumental.tsx`: casca — abas de topo (Investigação & Lista | BI Painéis |
  Matriz Legal) + toggle Médicos × Rede. BI Painéis e Matriz Legal renderizam um placeholder "Em breve".
- `src/pages/documentos/InvestigacaoLista.tsx`: a lista + os modais Analisar e Notificar.

O viewer de anexo e a lógica de aprovar/reprovar hoje embutidos no `Documentos.tsx` migram para os
modais da `InvestigacaoLista` (um modal "Analisar" único, em vez dos dois separados de hoje).

## Tela Investigação & Lista

**Fonte de dados:** `GET /api/documents` (admin já recebe todos). A classificação Médico×Rede e os
filtros são aplicados no cliente sobre essa lista (volume é baixo: documentos de gestão documental,
não as evidências de qualificação — ver "Convivência").

**Colunas:** Prestador · Documento (nome do tipo) · Data Envio (`upload_date`) · Validade (`expiry_date`) ·
Status · Ação.

**Status exibido** (derivado no cliente, função pura testável `statusDocumento(doc, hoje)`):
- `pendente` → **Pendente** (em análise).
- `valido` com `expiry_date` nula **ou** futura → **Aprovado**.
- `valido` com `expiry_date` passada → **Vencido**.
- `reprovado` → **Reprovado**.
- `historico` → não aparece na lista (versões antigas).

**Filtros/controles:**
- Toggle **Médicos × Rede Prestadora** (classifica cada linha pelo grupo do prestador).
- Busca por texto (nome do prestador ou do documento).
- Filtro de **status** (Todos/Pendente/Aprovado/Vencido/Reprovado).
- Filtro de **grupo** (lista de grupos presentes na visão atual).
- **Exportar .xlsx** da lista filtrada.

**Ações por linha:**
- **Analisar** (status Pendente): abre o modal Analisar.
- **Notificar** (status Vencido ou Reprovado): abre o modal Notificar.

## Modal Analisar (aprovar/reprovar)

Um modal único:
- **Esquerda:** viewer do anexo (`file_url`) — imagem/PDF com zoom in/out e botão de baixar/abrir
  (reaproveita o viewer atual).
- **Direita:** campos de **emissão** e **validade** (opcionais) e, ao reprovar, **justificativa**
  (`rejection_reason`, obrigatória ao reprovar).
- Botões **Aprovar** (`status='valido'`) e **Reprovar** (`status='reprovado'`) → `PUT /api/documents/:id/status`
  com os campos. Sem mudança no endpoint.

## Modal Notificar + backend

**Frontend:** ao abrir, pré-preenche uma mensagem semi-pronta citando o documento e o motivo
(ex.: *"O documento **{tipo}** está **{vencido|reprovado}**. Por favor, envie uma nova versão..."*).
O admin edita e envia.

**Backend — nova rota** `POST /api/documents/:id/notificar` (`authenticate`, `requireAdmin`):
- Body: `{ message: string }`.
- Resolve o documento → `provider_id`; `prestadorRecipients(provider_id)`.
- Chama `notifyEvent('documento_atualizacao', recipients, ctx)` com `ctx = { message, document_id, type,
  link: '/documentos' }`. Dispara in-app + e-mail pelo motor existente.
- A `dedupe_key` deve incluir um instante/nonce (ex.: `document_id + timestamp`) para o admin poder
  **re-notificar** o mesmo documento — cada clique envia, não é suprimido como duplicata.

**Catálogo de notificação** (`src/lib/notifyCatalog.ts`):
- Adicionar `'documento_atualizacao'` a `NOTIFY_TYPES` e um rótulo em `NOTIFY_TYPE_LABELS`.
- `renderNotification`: `case 'documento_atualizacao'` → `{ title: 'Atualização de documento solicitada',
  body: ctx.message, link: ctx.link ?? '/documentos' }`.

## Export .xlsx

**Nova rota** `GET /api/documents/export` (`authenticate`, `requireAdmin`):
- Query: `view` (medicos|rede), `status`, `grupo`, `q` — os mesmos filtros da tela.
- Monta as linhas (Prestador, Documento, Data Envio, Validade, Status) e devolve um buffer `.xlsx`
  (padrão `auditorXlsx.ts`: `aoa_to_sheet` → `XLSX.write(..., {type:'buffer'})`), com
  `Content-Disposition: attachment; filename="documentos.xlsx"`.
- A derivação de status reusa a mesma função pura `statusDocumento`.

## Classificação Médicos × Rede (função pura)

`src/lib/providerAudience.ts` → `providerAudience(person_type, provider_group): 'medicos' | 'rede'`:
- `'medicos'` quando `deriveProviderRole` dá `cooperado` ou `credenciado`; senão `'rede'`.
- Testada com casos PF cooperado/credenciado e PJ/pf_nao_medico.

## Testes
- `src/lib/documentoStatus.test.ts` — `statusDocumento` (pendente, aprovado, vencido por data,
  reprovado, histórico fora).
- `src/lib/providerAudience.test.ts` — `providerAudience` (médico × rede).
- Rotas (notificar/export) não têm harness HTTP no repo — verificadas via `tsc` + boot + smoke manual.

## Convivência com a qualificação
A lista filtra para documentos de **gestão documental** (com `type_id` não nulo, ou seja, do catálogo),
excluindo as evidências de qualificação (`type='qualificacao_evidencia'`, `type_id` nulo). O endpoint
de notificação e o export operam só sobre esses.
