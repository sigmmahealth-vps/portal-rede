# Sessão JWT — revogação no servidor e timeout por inatividade (spec)

Data: 2026-09-08. Origem: questão da equipe de Segurança da Unimed sobre o token
de sessão ("é encerrado ou fica em aberto?"). O e-mail de resposta comprometeu
revogação no servidor e encerramento por inatividade. Este spec cobre os dois.
Fora daqui: logout por dispositivo (tabela de sessões), rotação do `JWT_SECRET`.

## Objetivo

1. **Revogar sessões no servidor**: logout, troca de senha e desativação de
   usuário invalidam na hora todas as sessões ativas daquele usuário.
2. **Encerrar por inatividade**: sessão expira após 30 min sem uso, com teto
   absoluto de 8 h desde o login. Ambos configuráveis por ambiente.

## Estado atual

- JWT assinado (HS256) com `expiresIn: '24h'` fixo, em cookie `session`
  (`httpOnly`, `secure` em prod, `sameSite: 'lax'`, `maxAge` 24 h) —
  `issueSession`, `server.ts:447-467`.
- `authenticate` (`server.ts:395`) só faz `jwt.verify`; não consulta o banco.
  Aceita também `Authorization: Bearer` como fallback de transição.
- Logout (`server.ts:1017`) só `clearCookie('session')`. O token continua válido
  até expirar.
- `role` vem do JWT; mudança de perfil ou desativação só valem quando o token
  expira (até 24 h).
- Escopo por unidade já é lido do banco a cada request (`userLocationIds`).
- Dispositivo confiável: cookie separado, 90 dias, revogável (`trusted_devices`).
- Frontend: `src/lib/api.ts:14` já redireciona para `/login` em 401.

## Decisões

1. **Inatividade 30 min, teto 8 h.** Env `SESSION_IDLE_MINUTES` (default 30) e
   `SESSION_MAX_HOURS` (default 8). Documentar no `.env.example`.
2. **Sessão deslizante.** O JWT expira na janela de inatividade e é **reemitido
   a cada request autenticado**, preservando a claim de início de sessão. O
   cookie desliza junto (`maxAge` = janela de inatividade).
3. **Revogação por versão de sessão.** Coluna `users.session_version`. O valor
   vai no JWT (`sv`) e é comparado com o banco a cada request. Incrementar a
   versão mata todas as sessões do usuário.
4. **Logout invalida todas as sessões do usuário** (todos os dispositivos).
   É o comportamento natural da versão única; logout por dispositivo exigiria
   tabela de sessões e fica fora do escopo. Aceitável para este portal.
5. **`is_active` e `role` passam a ser lidos do banco a cada request.**
   Desativação e mudança de perfil valem na hora, sem precisar incrementar a
   versão. O `role` do JWT deixa de ser fonte de autorização.
6. **Troca ou definição de senha incrementa a versão.** Cobre convite, reset e
   reprovisionamento.
7. **Dispositivo confiável não muda.** Continua dispensando só o 2FA, com seus
   90 dias e revogação própria. Logout não o afeta (comportamento atual).
8. **Fallback `Authorization: Bearer` removido.** Verificado: o frontend nunca
   envia token por header (só guarda o perfil `user` em `localStorage`, nunca o
   token). Era código morto.
9. **Tokens emitidos antes do deploy** (sem `sv`/`sa`) são rejeitados com 401.
   Todo mundo faz login de novo uma vez. Avisar na promoção.

## Dados — migration `0046_users_session_version.sql`

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_version integer NOT NULL DEFAULT 1;
```

Obrigatória ao promover para homolog e prod (o middleware consulta a coluna).

## Token

Claims emitidas por `issueSession`:

| claim | conteúdo |
|---|---|
| `id`, `name`, `provider_id` | como hoje |
| `role` | mantido por compatibilidade do payload; **não** é usado para autorizar |
| `sv` | `users.session_version` no momento do login |
| `sa` | início da sessão, epoch ms — fixado no login, copiado nas reemissões |
| `iat`, `exp` | padrão do `jsonwebtoken`; `exp` = agora + `SESSION_IDLE_MINUTES` |

Cookie: mesmas flags de hoje; `maxAge` = `SESSION_IDLE_MINUTES`.

## Middleware `authenticate`

```
1. token ← cookie `session` (ou header, se o fallback for mantido)
2. jwt.verify → falhou ou expirou → 401 "Sessão expirada"
3. sem `sv` ou `sa` (token antigo) → 401
4. agora − sa > SESSION_MAX_HOURS → 401 "Sessão expirada"        (teto absoluto)
5. SELECT is_active, role, session_version FROM users WHERE id = $1
   - não existe ou is_active = false → 401
   - session_version ≠ sv → 401 "Sessão encerrada"                (revogação)
6. req.user = { id, name, provider_id, role: <do banco> }
7. reemitir token com mesmo `sa`, `sv` atual, novo `exp`; res.cookie   (deslizante)
8. em qualquer 401: res.clearCookie('session')
```

Custo: uma consulta por chave primária em `users` por request. Prestadores já
fazem outra em `user_locations`. Sem cache.

`// ponytail: reemite em toda request; se virar custo, reemitir só quando idade > IDLE/3.`

## Pontos que incrementam `session_version`

| Onde | Hoje | Mudança |
|---|---|---|
| `POST /api/auth/logout` (`server.ts:1017`) | só limpa cookie | ler o cookie sem `authenticate` (para não devolver 401); se decodificar, `UPDATE users SET session_version = session_version + 1 WHERE id = $1`; depois limpa o cookie |
| `POST /api/auth/redeem-token` (`server.ts:992`) | grava senha | incrementar no mesmo `UPDATE` |
| reprovisionamento (`server.ts:1872`) | grava senha | incrementar no mesmo `UPDATE` |
| `PATCH /api/users/:id` (role / is_active) | — | **nada**: ambos são lidos do banco no request |
| desativações em massa (`server.ts:1990`, `2058`) | `is_active = false` | **nada**: cai no passo 5 |

## Módulo puro `auth/session.ts` (+ `auth/session.test.ts`)

Lógica testável sem servidor, no padrão de `auth/otp.ts`:

```ts
export const SESSION_IDLE_MS = minutos(env.SESSION_IDLE_MINUTES ?? 30);
export const SESSION_MAX_MS  = horas(env.SESSION_MAX_HOURS ?? 8);

export function isAbsoluteExpired(sessionStartMs: number, now: Date, maxMs = SESSION_MAX_MS): boolean;
export function isRevoked(tokenSv: number | undefined, dbSv: number): boolean;
```

Casos de teste: dentro do teto; exatamente no teto; fora do teto; `sv` igual;
`sv` diferente; `sv` ausente (token antigo). Adicionar ao script `test` do
`package.json`.

## Frontend

Nenhuma mudança obrigatória: `api.ts` já manda para `/login` em 401.
Opcional (fora do mínimo): `/login?motivo=expirada` com aviso "Sua sessão
expirou por inatividade".

## Configuração

`.env.example`, seção AUTENTICAÇÃO / SEGURANÇA:

```
# Sessão: expira após SESSION_IDLE_MINUTES sem uso e, no máximo, SESSION_MAX_HOURS
# após o login. Logout, troca de senha e desativação encerram todas as sessões.
SESSION_IDLE_MINUTES="30"
SESSION_MAX_HOURS="8"
```

## Ordem de implementação

1. Migration 0046 + `auth/session.ts` + testes.
2. `issueSession` (claims `sv`, `sa`, `exp` novo, cookie).
3. `authenticate` (passos 1–8).
4. Incrementos: logout, redeem-token, reprovisionamento.
5. `.env.example`. Decidir e aplicar o item 8 (fallback do header).
6. Rodar `npm test`; validar no dev: login → esperar > 30 min → 401; login em
   dois navegadores → logout em um → o outro cai; trocar senha → sessões caem.

## O que muda na resposta para Segurança

| | Antes | Depois |
|---|---|---|
| Validade | 24 h fixas | 30 min sem uso, máximo 8 h |
| Logout | remove cookie | encerra todas as sessões do usuário no servidor |
| Troca de senha | sessões continuam | sessões encerradas |
| Desativação / mudança de perfil | vale ao expirar (até 24 h) | vale na próxima requisição |
