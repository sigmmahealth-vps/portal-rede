# Manual do roteiro — design

Data: 2026-09-24 · Origem: item 8 da homologação ("Manual da especialidade na notificação de abertura")

## Objetivo

A Unimed tem um manual (PDF) por tipo de roteiro. O admin/auditoria sobe o manual no portal e o
prestador o baixa **só dentro do portal** (logado). E-mail e sininho não carregam o arquivo nem um
link público: avisam que o manual existe e levam o prestador à tela onde está o download.

## Decisões

- **Acesso só com login** (decisão da Katy, 24/09): o documento não fica público.
- **Armazenamento no Postgres** (tabela própria, `bytea`). Descartados: `/uploads` (sem auth, sem
  volume persistente confirmado no Railway), volume do Railway (config por ambiente), S3/R2 (fornecedor
  novo para ~15 arquivos).
- **Chave = roteiro, não versão**: `eval_scripts.source_file` identifica o roteiro através das
  revisões (`UNIQUE (source_file, version)`). Reimportar uma revisão não perde o manual.
- **1 manual por roteiro**, só PDF, até 20 MB. Enviar de novo substitui. Sem histórico de versões.

## Dados — migration `0053_eval_script_manuals.sql`

```sql
CREATE TABLE eval_script_manuals (
  source_file  text PRIMARY KEY,
  filename     text        NOT NULL,
  size_bytes   integer     NOT NULL,
  content      bytea       NOT NULL,
  uploaded_by  bigint      REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);
```

Sem FK para `eval_scripts` (não há tabela de "roteiro" acima das versões; `source_file` não é único
lá). Manual de roteiro excluído fica órfão e inofensivo (e volta a valer se o roteiro for
reimportado com o mesmo arquivo) — não há limpeza automática.

## API (server.ts)

| Rota | Quem | Faz |
|---|---|---|
| `PUT /api/eval/scripts/:id/manual` (multipart `file`) | staff (`isStaff`) | grava/substitui o manual do `source_file` do roteiro `:id`; valida PDF (extensão + assinatura `%PDF`) e ≤ 20 MB (multer em memória) |
| `DELETE /api/eval/scripts/:id/manual` | staff | remove |
| `GET /api/eval/scripts/:id/manual` | autenticado com acesso | devolve o PDF (`Content-Type: application/pdf`, `Content-Disposition: attachment; filename*=UTF-8''…`) |
| `GET /api/eval/scripts` (existente) | — | passa a trazer `manual_filename` e `manual_uploaded_at` (LEFT JOIN, sem o conteúdo) |

**Regra de acesso ao download** (função pura testável, `canDownloadManual`): staff baixa qualquer um;
prestador (`prestador`/`cooperado`/`credenciado`) só se o `source_file` pedido for o de um roteiro
ligado a ele — `providers.eval_script_id` do seu prestador **ou** `script_id` de uma instância dele
(nas suas unidades, via `userLocationIds`). Caso contrário 403; sem manual, 404. Tudo passa por
`authenticate` (cookie de sessão), então clicar no botão logado baixa direto.

`auditLog`: `script_manual_uploaded` / `script_manual_removed` (quem, roteiro, arquivo, tamanho).

## Telas

**Admin → Roteiros de Avaliação** (`Admin.tsx`): em cada roteiro, ação "Manual" abre um modal
pequeno: estado atual (nome, tamanho, data, quem enviou), **Enviar PDF / Substituir**, **Baixar**,
**Remover** (com confirmação). Um selo "Manual" na linha indica roteiro com manual.

**Prestador** (só aparece se o roteiro tem manual; mesmo link `GET …/manual`):
1. Card do roteiro em **Meus Roteiros** (`PrestadorView.tsx`): botão secundário "Baixar manual".
2. **Dentro do preenchimento** (`RoteiroPlayer.tsx`): link "Manual do roteiro" no rail lateral
   (e no resumo mobile).
3. **Início**: link "Baixar manual" no card de roteiro a iniciar/continuar.

## Notificação de abertura

`ciclo_aberto` ganha `ctx.has_manual` (calculado por prestador no loop de abertura e na inclusão
avulsa: alguma instância dele no ciclo tem roteiro cujo `source_file` tem manual). Com
`has_manual`, o sininho e o e-mail acrescentam: "O manual do seu roteiro está disponível no portal,
em Meus Roteiros." O CTA já leva a `?aba=roteiros` (`notifyLink`). Nenhum anexo, nenhum link ao
arquivo.

## Erros

- Upload não-PDF ou > 20 MB → 400 com mensagem clara (padrão `multerErr` existente).
- Download sem manual → 404 ("Este roteiro ainda não tem manual."); sem permissão → 403.
- Botões do prestador escondidos quando não há manual, então 404 só por link manual.

## Testes

- `db/manual-access.test.ts` (ou `src/lib`): `canDownloadManual` — staff sim; prestador do roteiro
  sim; prestador de outro roteiro não; sem vínculo não.
- `notifyCatalog.test.ts` / `notifyEmail.test.ts`: `ciclo_aberto` com e sem `has_manual`.
- QA no navegador (admin, dev): enviar PDF, ver selo, baixar, substituir, remover; conferir 400 com
  arquivo não-PDF.

## Fora do escopo

Biblioteca de materiais; histórico de versões do manual; mais de um manual por roteiro; manual em
e-mail/anexo ou link público.

## Promoção

⚠️ Migration 0053 obrigatória ao promover homolog/prod (o boot-migrate do homolog aplica).
