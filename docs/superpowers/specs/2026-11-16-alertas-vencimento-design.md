# Gestão Documental — Alertas de vencimento — Design

**Data:** 2026-11-16
**Status:** aprovado (desenho) — pendente revisão da spec escrita

## Contexto e objetivo

Quarta fatia da Gestão Documental. Agora que os documentos têm `expiry_date`, o sistema
deve **avisar o prestador/cooperado** quando um documento está prestes a vencer ou já venceu,
pedindo um novo envio. Do mockup do prestador (Tela 4):

> "30 dias antes do documento vencer, deve ser disparado ao prestador/cooperado e-mails
> informando do vencimento e solicitando um novo envio. Os e-mails devem ser disparados uma
> vez a cada 3 dias, após o vencimento."

Reaproveita o motor de notificação que já existe (`runNotificationJobs` + `notifyEvent` +
`prestadorRecipients` + catálogo de e-mail). **Nenhuma UI nova** — a tela do prestador já
mostra validade vencida em vermelho (fatia anterior) e já tem o upload para reenvio.

### Regra de cadência (decidida)
- **30 dias antes de vencer:** 1 aviso **único** (`documento_vencendo`).
- **Após vencer:** 1 aviso **a cada 3 dias**, com **teto de 10 avisos** (`documento_vencido`) —
  marcos 0,3,6…27 dias de atraso (~30 dias de cobrança); depois para sozinho. Evita e-mail
  infinito num prestador abandonado.

## Função pura (testada) — `src/lib/vencimentoAlertas.ts`

Assinatura:

```ts
type MarcoVencimento = { tipo: 'vencendo' | 'vencido'; marco: string } | null;
function marcoVencimento(doc: { expiry_date: string | null }, hoje: Date): MarcoVencimento;
```

Regras (datas **locais** — não há helper exportado; inline a mesma fórmula YMD de
`statusDocumento` (`${y}-${mm}-${dd}` com `getFullYear/getMonth/getDate`) para evitar drift de UTC):
- `expiry_date` nulo → `null`.
- `expiry_date` entre hoje e hoje+30 (inclusive ambas as bordas) → `{ 'vencendo', 'aviso30' }`.
- `expiry_date` < hoje:
  - `diasVencido = hoje − expiry_date` (dias inteiros).
  - `n = floor(diasVencido / 3)`; se `n <= 9` → `{ 'vencido', 'atraso:' + n }`; senão `null` (passou do teto).
- senão (vence em mais de 30 dias) → `null`.

Constante exportada: `TETO_AVISOS_VENCIDO = 10`.

### Bordas definidas
- `hoje` exatamente = vencendo (0 dias para vencer).
- `hoje+30` = vencendo; `hoje+31` = null.
- vencido há 0,1,2 dias → `atraso:0`; há 3,4,5 → `atraso:1`; … há 27 → `atraso:9`; há 30 → null.

## Etapa no job — `runNotificationJobs()` (server.ts)

Nova etapa (6), no mesmo padrão das etapas 1–4. Seleciona **só o documento mais recente de
cada `(provider_id, type_id)`**:

```sql
SELECT DISTINCT ON (d.provider_id, d.type_id)
       d.id, d.provider_id, d.type, d.type_id, d.expiry_date
  FROM documents d
 WHERE d.type_id IS NOT NULL
   AND d.expiry_date IS NOT NULL
   AND d.status IN ('valido','vencido')
 ORDER BY d.provider_id, d.type_id, d.upload_date DESC, d.id DESC
```

`'valido'` = aprovado e vigente; `'vencido'` = marcado como vencido manualmente. Exclui pendente,
reprovado e versões antigas (`historico`, que o upload novo marca em server.ts:2402). A tabela
`documents` **não tem `location_id`**. Para cada linha, aplica `marcoVencimento(doc, hoje)`; se
não-nulo, dispara:

- `vencendo` → `notifyEvent('documento_vencendo', { tipo: d.type, expiry_date }, await prestadorRecipients(provider_id, null), { providerId, dedupeRef: 'doc:'+d.id+':aviso30' })`
- `vencido`  → `notifyEvent('documento_vencido',  { tipo: d.type, expiry_date, dias }, await prestadorRecipients(provider_id, null), { providerId, dedupeRef: 'doc:'+d.id+':'+marco })`

Sininho + e-mail (padrão do `notifyEvent`), link `/documentos`. `dedupeRef` garante disparo
único por marco (mesmo mecanismo do `roteiro_pendente`/`certificado_vencendo`).

## Catálogo de e-mail

- `src/lib/notifyCatalog.ts`: adicionar `documento_vencendo` e `documento_vencido` em
  `NOTIFY_TYPES` (título, corpo, CTA → `/documentos`), seguindo o molde de `certificado_vencendo`.
- `src/lib/notifyEmail.ts`: adicionar os blocos HTML dos 2 tipos no switch
  (`notificationBlocks`/`renderNotificationEmail`), com o nome do documento e a data de validade.

Copy (resumo):
- **vencendo:** "Seu documento **{tipo}** vence em {expiry_date}. Envie a versão atualizada pelo portal."
- **vencido:** "Seu documento **{tipo}** venceu em {expiry_date} (há {dias} dias). Reenvie o quanto antes."

## Testes

- `src/lib/vencimentoAlertas.test.ts` (`node:test`, incluído no script `test`): cada ramo de
  `marcoVencimento`, todas as bordas acima, o teto (dia 27 dispara, dia 30 não), e `expiry_date` nulo.
- Ajuste em `src/lib/notifyEmail.test.ts`: os CTAs dos 2 tipos novos apontam para `/documentos`
  (o teste atual afirma CTAs; incluir as exceções, como foi feito para `documento_atualizacao`).
- Componentes/servidor: sem harness no repo → validados por `tsc` + build + smoke manual.

## Fora de escopo
- Botão "Atualizar"/reenvio dedicado na tela do prestador (o upload já existe).
- Toggle Médicos/Rede (o job é global; notifica cada prestador do seu documento).
- Digest para a auditoria (só prestador, conforme o mockup).
- Preferências de opt-out/frequência por prestador.
