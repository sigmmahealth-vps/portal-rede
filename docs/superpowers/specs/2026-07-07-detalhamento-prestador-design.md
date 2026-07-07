# Detalhamento do Prestador (item 5.2, Tela 2)

Fonte: OPS-CTR-FOR-002 - Portal da Rede de Prestadores, item 5.2 "Cadastro de
Prestadores", trecho "Tela 2 – Detalhamento do Prestador": _"Ao visualizar um
prestador, uma sidebar de navegação passa a exibir abas para dados
cadastrais."_

## Contexto

A listagem "Rede de Prestadores" (`src/pages/Admin.tsx`, aba `prestadores`)
já existe, mas clicar numa linha não faz nada — não há para onde ir. Este
design cobre a página de detalhe de um prestador específico, primeira peça do
item 5.2 a ser construída (decisão tomada em brainstorming: começar pela
Tela 2, não pelas Telas 1/3/4/5).

O schema de banco já suporta tudo que esta tela precisa
(`providers`, `provider_locations`, `provider_contacts`,
`provider_certifications`, `documents`, `qualification_submissions`) —
não são necessárias novas tabelas.

## Objetivo

Uma página `/admin/prestadores/:id`, acessível a partir da listagem, que
mostra os dados de um prestador em 4 abas via sidebar de navegação lateral.
Acesso restrito a `admin`/`auditoria` (mesma regra do endpoint
`GET /api/providers` atual).

## Não-objetivos (fora de escopo desta entrega)

- Edição do cadastro básico do prestador (nome, CNPJ, tipo, etc.) — dado vem
  do SGU 2.0 via sync automática; tela é somente leitura.
- CRUD de unidades de atendimento (`provider_locations`) — hoje só chega via
  importação do SGU; criar edição manual é escopo maior, tratado depois
  (Tela 3 dedicada do item 5.2).
- Upload/revisão de documentos e avaliações de qualificação dentro desta
  tela — já existem fluxos completos em `Documentos.tsx` e `Auditorias.tsx`;
  esta tela apenas resume e linka para eles.
- Telas 1, 3, 4, 5 do item 5.2 (listagem completa com filtros/export,
  unidades dedicada, gestão de acessos, histórico/auditoria por prestador) —
  cada uma vira seu próprio design quando for a vez.

## Arquitetura

### Rota e navegação

- Nova rota em `src/App.tsx`: `<Route path="admin/prestadores/:id"
  element={<ProviderDetail />} />`.
- Em `Admin.tsx`, a linha da tabela de prestadores (hoje sem `onClick`, linha
  ~403) passa a navegar para `/admin/prestadores/${prestador.id}` via
  `useNavigate` do react-router.
- Sidebar de navegação lateral dentro da própria página (não é o menu global
  do `Layout.tsx`), com 4 itens: Dados Cadastrais, Unidades de Atendimento,
  Equipe/Contatos, Documentos e Qualificação. Estado local (`useState`) troca
  a aba ativa, sem mudar a URL — consistente com o padrão de abas já usado em
  `Admin.tsx`.

### Backend: novo endpoint `GET /api/providers/:id`

Não existe hoje um endpoint de detalhe (só o `GET /api/providers` de
listagem). Novo handler em `server.ts`, próximo aos outros de `providers`:

```
GET /api/providers/:id
Autorização: admin | auditoria (403 para os demais papéis)
404 se o prestador não existir
```

Resposta:

```jsonc
{
  "id": 123, "name": "...", "trade_name": "...", "person_type": "PJ",
  "cnpj": "...", "cpf": null, "council_registry": "...",
  "specialties": [...], "provider_group": "...", "provider_type": "...",
  "area_atuacao": "...", "qualification_level": "...", "status": "Ativo",
  "sgu_code": "...", "sgu_synced_at": "2026-07-01T12:00:00Z",
  "locations": [ { "id": 1, "label": "...", "cidade": "...", "uf": "SC",
                   "is_primary": true, "in_medical_guide": true,
                   "active": true, ... } ],
  "certifications": [ { "id": 1, "kind": "iso_9001", "title": "...",
                         "issued_date": "...", "expiry_date": "..." } ],
  "summary": {
    "documents_pending": 2, "documents_expired": 1, "documents_total": 10,
    "certifications_total": 3,
    "last_qualification_submission": { "id": 55, "cycle_title": "...",
                                        "status": "...", "created_at": "..." }
  }
}
```

Implementação: uma query em `providers` + `provider_locations` +
`provider_certifications` (3 queries simples, sem necessidade de JSON
aggregation em SQL) e 2 queries de contagem/última linha para o `summary`
(uma em `documents` agrupando por `status`, uma em
`qualification_submissions` pegando a mais recente por `created_at`). Segue
o mesmo estilo dos handlers vizinhos (queries diretas com `pg`, sem
query builder).

### Frontend: componente `ProviderDetail`

Novo arquivo `src/pages/admin/ProviderDetail.tsx` (mesma pasta de
`UsuariosTab.tsx`). Estrutura:

- Header: nome do prestador, status (badge), botão "Voltar" para a listagem.
- Sidebar (lateral esquerda) com os 4 itens de navegação; usa o mesmo padrão
  visual de tabs já usado em `Admin.tsx` (ex.: `bg-[#00995D]` para item
  ativo), mas em coluna em vez de linha.
- Área de conteúdo à direita renderiza a aba ativa:
  1. **Dados Cadastrais** — grid de campos somente leitura (nome, CNPJ/CPF,
     tipo, área de atuação, especialidades, grupo, nível de qualificação,
     status, código SGU, última sincronização). Sem formulário, sem botão
     salvar.
  2. **Unidades de Atendimento** — tabela somente leitura das `locations`:
     endereço completo, telefone/email, badges "Principal" e "Guia Médico"
     quando aplicável, ativo/inativo. Estado vazio: "Nenhuma unidade
     cadastrada."
  3. **Equipe/Contatos** — reaproveita a lógica de `Equipe.tsx`
     (`GET /api/provider-contacts?provider_id=:id`, `POST`/`DELETE`), mas com
     `provider_id` fixo (o da URL) em vez de resolvido do usuário logado.
     Extrai o formulário de contato de `Equipe.tsx` para um componente
     compartilhado (`ProviderContactsPanel`) parametrizado por
     `providerId`, usado tanto aqui quanto em `Equipe.tsx`, para não duplicar
     a lógica de listar/criar/remover contato.
  4. **Documentos e Qualificação** — cards de resumo (`summary` da API):
     documentos pendentes/vencidos/total, certificações, última submissão de
     qualificação com status. Cada card tem um link
     (`/documentos?provider_id=:id` e `/auditorias?provider_id=:id`) para a
     tela cheia já existente. *(Nota: `Documentos.tsx`/`Auditorias.tsx`
     hoje não leem query param de filtro; se o usuário quiser o link já
     filtrando, isso exige um ajuste pequeno nessas páginas — tratado como
     ajuste incremental, não bloqueia esta entrega: sem o filtro automático,
     o link ainda funciona, só abre a tela sem pré-filtro.)*

### Fluxo de dados

1. `ProviderDetail` monta, lê `:id` da URL, chama
   `GET /api/providers/:id`.
2. 404 → tela "Prestador não encontrado" com link de volta à listagem.
3. 403 (papel errado) → mesmo tratamento hoje usado em `Admin.tsx` para rotas
   restritas (redireciona ou mostra mensagem, replicar o padrão existente).
4. Sucesso → guarda o objeto completo em estado; troca de aba é só troca de
   view sobre o mesmo estado (não recarrega, exceto a aba Equipe/Contatos,
   que tem sua própria busca via `ProviderContactsPanel`, com mutação
   local de estado ao adicionar/remover contato — mesma lógica que
   `Equipe.tsx` já tem hoje).

### Erros e casos de borda

- Prestador sem unidades / sem contatos / sem documentos: mensagens de
  estado vazio (mesmo padrão textual de `MeusDados.tsx`: "Nenhum X
  encontrado.").
- `person_type` PF sem `cnpj` / PJ sem `cpf`: mostrar apenas o campo
  aplicável (o schema já é `NULL` no que não se aplica).
- Falha de rede ao carregar: mensagem de erro com botão "Tentar novamente"
  (padrão já usado em outras páginas com `useEffect`/`fetch`).

## Testes

Não há testes automatizados de rota HTTP hoje em `server.ts` (a suíte
`npm test` cobre só módulos puros — parsers, `auth/*`, etc.); este endpoint
segue o mesmo padrão dos handlers vizinhos e não será coberto por teste
automatizado, consistente com o restante do arquivo.
Verificação será manual: subir o servidor dev, logar como admin, abrir um
prestador da listagem, conferir as 4 abas com dados reais do ambiente de
dev, testar os casos 404/403/vazio.
