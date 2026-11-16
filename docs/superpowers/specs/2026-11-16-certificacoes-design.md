# Gestão Documental — Certificações (autosserviço + validação) — Design

**Data:** 2026-11-16
**Status:** aprovado (desenho) — pendente revisão da spec escrita

## Contexto e objetivo

Primeira das três sub-fatias de atributos de prestador (Certificações, Escolaridade, Dados
Técnicos), todas **autoinformadas pelo prestador** e validadas pelo admin. Esta cobre
**Certificações**: o prestador cadastra suas certificações (campos estruturados + arquivo PDF)
e o admin valida ou reprova, no mesmo padrão dos documentos.

A tabela `provider_certifications` já existe (hoje **vazia**, 0 linhas) com
`id, provider_id, kind, title, issuer, level, issued_date, expiry_date, validated, source,
sgu_synced_at, created_at`. Ela é lida no detalhe do prestador (admin) em
`GET /api/providers/:id` (server.ts:2065) com `SELECT *`, então colunas novas fluem sem quebrar.

### Fora de escopo
- Sub-aba **Certificações e Dados Técnicos** do Painel (métricas/dashboard) — fatia futura.
- **Escolaridade** e **Dados Técnicos** (CNES/ISS/Prontuário) — próximas sub-fatias.
- Catálogo de tipos de certificação — `kind`/`level` ficam **texto livre** por ora.
- Notificação ao prestador na reprovação — pode reusar o motor depois; fora desta fatia.

## Modelo de dados

Migration nova `db/migrations/0064_provider_certifications_upload.sql` — adiciona à tabela:
- `file_url text` — caminho do PDF anexado (como `documents.file_url`);
- `status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','valido','reprovado'))`;
- `rejection_reason text`;
- `uploaded_by bigint REFERENCES users(id)`;
- `upload_date timestamptz`.

O boolean `validated` existente é mantido em sincronia (`validated = (status = 'valido')`),
para a leitura atual do detalhe do prestador continuar correta sem alteração.

## Servidor (espelha `/api/documents`)

- `GET /api/certifications`
  - prestador (`req.user.provider_id`): as suas (`WHERE provider_id = $user`).
  - admin/auditoria: todas, com `p.name, p.person_type, p.provider_group` (JOIN providers) para
    o recorte por audiência no cliente, se necessário.
- `POST /api/certifications` (`authenticate, docUpload`): prestador cria. Campos do corpo:
  `kind, title, issuer, level, issued_date, expiry_date`; **arquivo obrigatório** em `req.file`
  (400 se ausente). `title` obrigatório; datas validadas como nos documentos (emissão não-futura;
  validade pode ser passada). Grava `status='pendente'`, `validated=false`, `uploaded_by`,
  `upload_date`, `file_url`.
- `PUT /api/certifications/:id/status` (`authenticate`, admin): `{ status: 'valido'|'reprovado', rejection_reason? }`.
  Define `status`, `validated=(status==='valido')`, `rejection_reason`. 400 se status inválido;
  404 se não existe.
- `DELETE /api/certifications/:id` (`authenticate`, prestador dono): remove **só se `status='pendente'`**
  (não apaga certificação já analisada). Valida que o registro é do `provider_id` do usuário.

Validação de arquivo: reusa `docUpload` (mesmos formato/tamanho — `isAcceptedDocFormat`, 20 MB).

## Funções puras

Esta fatia é CRUD + validação espelhando `/api/documents`, sem lógica pura nova não-trivial:
a regra de exclusão (`status === 'pendente'`) e a de data (emissão não-futura) são guardas inline
de uma linha, iguais às dos documentos. **Nenhum módulo/teste de lib novo** (YAGNI). A verificação
fica em `tsc` + build + smoke no navegador.

## Telas

### Prestador — nova seção "Certificações"
- Nova página/rota no portal do prestador, ao lado de **Documentos** (segue o mesmo shell/menu).
- Lista as certificações do prestador (título, tipo, emissor, validade, **status** com cor:
  pendente=azul, válido=verde, reprovado=vermelho + motivo).
- Botão **"Adicionar certificação"** → modal com os campos + **upload do arquivo** (igual ao
  Enviar Documento: validações de data, formato, tamanho).
- Enquanto `pendente`, permite **excluir**; depois de analisado, só leitura.

### Admin — validação no detalhe do prestador
- No componente que consome `GET /api/providers/:id`, a seção de certificações (já renderizada)
  ganha: link do **arquivo**, o **status**, e os botões **Aprovar / Reprovar** (reprovar pede
  motivo), chamando `PUT /api/certifications/:id/status`. Recarrega a lista ao concluir.
- Nenhuma tela admin nova — reusa a página de detalhe existente.

## Testes
- Sem teste de lib novo (não há lógica pura nova). Verificação por `tsc` + build + smoke no
  navegador: prestador adiciona → aparece **pendente**; admin aprova no detalhe → vira **válido**;
  prestador vê **válido**; reprovar grava motivo; excluir só enquanto pendente.
- Ajuste de testes de regressão apenas se algum existente tocar `provider_certifications`
  (hoje nenhum).

## Dados de teste
Opcional no plano: semear 1–2 certificações pendentes para um prestador de teste, para o admin
ter o que validar sem depender do upload manual. Não bloqueia (fluxo real é o prestador criar).
