# Política de Privacidade com aceite no primeiro acesso — design

**Data:** 2026-09-29 · **Origem:** pedido da Unimed Criciúma no go-live de produção.

## Objetivo

1. A Política de Privacidade fica **dentro do sistema** (só logado) e **sai da tela de login**.
2. No primeiro acesso, **todo usuário** (prestadores e equipe interna) lê a política e marca "Li e aceito" antes de usar o portal.
3. O aceite fica **registrado de forma definitiva** e é visível ao admin na tela Usuários.

## Decisões

| Tema | Decisão |
|---|---|
| Texto | O atual de `PoliticaPrivacidade.tsx`, **sem a seção do DPO** |
| Quem aceita | Todos os usuários (prestador, cooperado, credenciado, pf_nao_medico, admin, auditoria) |
| Mudança de texto | Aceite é por **versão**; versão nova → todos aceitam de novo; aceites antigos permanecem |
| Link no login | Removido |
| Visibilidade | Coluna "Política" nas duas abas da tela Usuários |

## Desenho

### Dados — migration `0055_privacy_acceptances.sql`

```sql
CREATE TABLE privacy_acceptances (
  id             bigserial PRIMARY KEY,
  user_id        bigint      NOT NULL,   -- sem FK de propósito: o registro sobrevive à exclusão do usuário
  user_name      text,
  user_email     text,
  policy_version text        NOT NULL,
  accepted_at    timestamptz NOT NULL DEFAULT now(),
  ip_hash        text
);
CREATE INDEX privacy_acceptances_user_idx ON privacy_acceptances (user_id, accepted_at DESC);
```

Somente INSERT (nenhuma rota faz UPDATE/DELETE). `user_name`/`user_email` são o retrato no momento do aceite. O aceite também grava `auditLog` com ação `privacy_policy_accepted` e `meta: { version }`.

### Versão

Constante única `PRIVACY_POLICY_VERSION = '2026-09-29'` em `src/lib/privacyPolicy.ts`, importada pelo servidor e pelo frontend. Função pura `needsPrivacyAcceptance(acceptedVersion: string | null, current: string): boolean` (true quando diferente/ausente) no mesmo arquivo.

### API

- `GET /api/auth/me` passa a devolver `privacy_accepted_version` (versão do último aceite do usuário, ou `null`).
- `POST /api/privacy/accept` (autenticado), body `{ version }`:
  - `version !== PRIVACY_POLICY_VERSION` → 409 (tela desatualizada, recarregar).
  - Grava `privacy_acceptances` + `auditLog`; responde `{ ok: true, accepted_at }`.
  - Se o usuário já aceitou a versão atual, responde 200 sem inserir de novo (idempotente).
- Listagens da tela Usuários (`/api/users` e a de acessos de prestadores) passam a trazer `privacy_accepted_at` e `privacy_accepted_version` do último aceite (LATERAL/subquery).

### Frontend

- `src/components/PoliticaTexto.tsx`: o texto (sem DPO), usado pela página e pelo modal — fonte única.
- `/politica-privacidade` sai das rotas públicas e passa a ser rota **dentro do `Layout`** (autenticada); remove "Voltar para o login".
- `Login.tsx`: remove o link "Política de Privacidade".
- Menu do perfil (`Layout.tsx`): link "Política de Privacidade" ao lado de "Meus dados".
- `Layout.tsx`: se `needsPrivacyAcceptance(me.privacy_accepted_version, PRIVACY_POLICY_VERSION)`, renderiza modal bloqueante (via `createPortal`, acima do header — ver camadas z-index): texto com rolagem, checkbox "Li e aceito a Política de Privacidade", botão **Continuar** (habilitado só com o check) e **Sair**. Sem botão de fechar, sem fechar por ESC/clique fora. Ao aceitar, atualiza o estado local e libera o portal.
- Tela Usuários (`UsuariosTab.tsx` e aba de acessos de prestadores): coluna "Política" — `Aceita em dd/mm/aaaa hh:mm (v2026-09-29)` ou badge `Pendente`. Aceite de versão antiga aparece como `Pendente (aceitou vX)`.

### Simplificação deliberada

O bloqueio de quem não aceitou é **no frontend**. Um cliente que chame a API diretamente não é barrado. Upgrade: middleware após `authenticate` recusando rotas (exceto `/api/auth/*` e `/api/privacy/accept`) sem aceite da versão atual — custo de uma query por request.

## Testes

- `src/lib/privacyPolicy.test.ts`: `needsPrivacyAcceptance` (null, versão antiga, versão atual).
- Smoke da API: 409 com versão errada; 200 + linha gravada com versão certa; segunda chamada não duplica.
- Browser: usuário sem aceite → modal; Continuar desabilitado sem check; aceitar → portal liberado e não reaparece; página no menu do perfil; login sem o link; coluna na tela Usuários.

## Promoção

Migration 0055 sobe junto (boot-migrate). Efeito: **todos** os usuários de dev/homolog/prod verão o modal no próximo acesso.
