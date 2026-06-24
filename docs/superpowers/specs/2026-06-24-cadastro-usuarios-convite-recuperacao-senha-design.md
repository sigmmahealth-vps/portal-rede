# Cadastro de usuários + convite por e-mail + esqueci minha senha — design

**Data:** 2026-06-24
**Status:** aprovado pela usuária; pronto para virar plano de implementação
**Escopo:** complementa o [2FA por e-mail](./2026-06-22-2fa-email-seguranca-portal-design.md) já em produção
**Pré-requisito:** Resend configurado em prod (já em uso pelo 2FA)

## Problema

Hoje o portal só tem 4 usuários, todos criados via seed no boot (`server.ts:134-137`):
`admin@unimed.com`, `auditoria@unimed.com`, `prestador@unimed.com`, `cooperado@unimed.com`. Não existe rota para criar novos usuários nem fluxo de recuperação de senha. Para adicionar a equipe administrativa real (admin, auditoria) é preciso rodar SQL direto no Postgres de produção — não-escalável e perigoso.

## Objetivos

1. **Aba "Usuários" no Admin** para criar e gerenciar contas administrativas (admin, auditoria) pela UI.
2. **Convite por e-mail com link único** para que o novo usuário defina a própria senha — senha nunca trafega por e-mail.
3. **"Esqueci minha senha"** disponível na tela de login para qualquer usuário (admin, auditoria, prestador, cooperado).

## Fora de escopo

- Integração SGU para criar prestadores/cooperados (esses virão por sync, não pela UI).
- Deletar usuário permanentemente (use desativar — preserva histórico).
- Auto-cadastro público sem convite.
- Mudança de e-mail (se errou, admin recria a conta).
- Política de expiração obrigatória de senha (rotação periódica).

## Decisões-chave (capturadas no brainstorming)

| Decisão | Escolha | Razão |
|---|---|---|
| Como o novo usuário recebe acesso? | Link único de "definir senha" | Senha nunca trafega por e-mail; padrão GitHub/Notion/Slack |
| Quem pode cadastrar? | Só role `admin` | Concentra poder no papel de gestão; auditoria não cria usuários |
| Quais roles a UI cria? | Apenas `admin` e `auditoria` | Prestador/cooperado vêm por integração SGU (fora deste design) |
| Vincular a prestador? | Não | Não há prestadores/cooperados pela UI, logo `provider_id` sempre `NULL` para esses cadastros |
| Esqueci senha alcança quem? | Todos os usuários | Inclusive os integrados via SGU |
| Ações pós-criação | Ativar/desativar, reenviar convite, mudar role | Sem deletar — desativar preserva histórico |
| Tokens convite vs reset | Mesma tabela, campo `kind` diferenciando | Operação é idêntica (validar + trocar senha); UI muda só o copy |
| Expiração | 24h convite, 30min reset | Convite precisa folga (e-mail pode demorar); reset é janela curta de risco |

## Modelagem de dados (migration 0010)

### Alterações em `users`

| Coluna | Mudança | Comportamento |
|---|---|---|
| `password` | passa a aceitar `NULL` | Usuário convidado fica sem senha até consumir o token; login com senha `NULL` é bloqueado em `/api/auth/login` |
| `invite_status` | nova coluna `text` default `'accepted'` | `'pending'` (token ativo, ainda não definiu), `'accepted'` (já definiu senha pelo menos uma vez), `'expired'` (convite venceu, admin precisa reenviar). Usuários existentes recebem `'accepted'` no momento da migration |
| `last_login_at` | nova coluna `timestamptz NULL` | Atualizada em todo login bem-sucedido (após verify-otp); exibida em "Último acesso" na lista |

`is_active` (já existe) é usada pelo toggle ativar/desativar.

### Nova tabela `password_setup_tokens`

Mesma forma de `otp_codes`: tokens de uso único, hash no banco, valor opaco no link.

```sql
CREATE TABLE password_setup_tokens (
  id                 SERIAL PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash         TEXT    NOT NULL,
  kind               TEXT    NOT NULL CHECK (kind IN ('invite','reset')),
  expires_at         TIMESTAMPTZ NOT NULL,
  used_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id INTEGER REFERENCES users(id)
);

CREATE INDEX idx_pst_user_kind_used ON password_setup_tokens (user_id, kind, used_at);
CREATE INDEX idx_pst_expires        ON password_setup_tokens (expires_at);
```

**Notas:**
- `token_hash`: `bcrypt(token_opaco, 10)`. O `token_opaco` que vai no link é `crypto.randomBytes(32).toString('hex')` (64 chars).
- `kind`: discriminador para mensagens diferentes na UI e para janela de expiração.
- `used_at`: NULL = ainda pode ser consumido; quando consumido → `now()`. Uso único.
- `created_by_user_id`: admin que disparou o convite; NULL para tokens de reset (gerados pelo próprio usuário).
- Quando admin reenvia convite ou usuário pede outro reset, tokens anteriores do mesmo `(user_id, kind)` são marcados `used_at=now()` (invalidação imediata).

## API

### Administrativos (auth: admin)

| Método | Path | Body | Sucesso | Erros |
|---|---|---|---|---|
| `POST` | `/api/users` | `{ name, email, role: 'admin'\|'auditoria' }` | `201 { id, name, email, role, is_active, invite_status: 'pending' }` | `400` validação, `403` role não permitida, `409` e-mail já existe |
| `GET` | `/api/users` | — | `200 [{ id, name, email, role, is_active, invite_status, last_login_at, created_at }]` | `403` não-admin |
| `PATCH` | `/api/users/:id` | `{ role?, is_active? }` | `200` usuário atualizado | `400` validação, `403` não-admin, `404` |
| `POST` | `/api/users/:id/resend-invite` | — | `200 { ok: true }` | `403`, `404`, `409` (usuário já aceitou convite) |

**Validações em `POST /api/users`:**
- `name` ≥ 2 chars, ≤ 100
- `email` formato válido, único (case-insensitive)
- `role` ∈ `{'admin','auditoria'}` — `prestador`/`cooperado` retornam 403 (não suportado pela UI)
- Sucesso: cria usuário com `password=NULL`, `is_active=true`, `invite_status='pending'`, gera token `kind='invite'` expirando em 24h, dispara `sendInvite(email, name, link)`

**Comportamento de `PATCH`:**
- `is_active=false`: usuário não consegue mais logar; tokens não são invalidados (caso reative).
- `role` mudança: registra `user_role_changed` em `access_logs` com `meta: { from, to }`.
- Admin não pode desativar a própria conta nem rebaixar a própria role (400 com mensagem clara).

**Comportamento de `resend-invite`:**
- Só atua em usuários `invite_status='pending'` ou `'expired'`. Se já `accepted`, retorna 409 ("Usuário já definiu senha; oriente a usar 'Esqueci minha senha'").
- Marca tokens `kind='invite'` anteriores como usados; gera novo; envia e-mail; volta `invite_status='pending'`.

### Públicos (sem auth, com rate-limit)

| Método | Path | Body | Sucesso | Notas |
|---|---|---|---|---|
| `POST` | `/api/auth/forgot-password` | `{ email }` | `200 { ok: true }` **sempre** | Não vaza se e-mail existe. Se existe: gera token `kind='reset'` (30min), dispara `sendPasswordReset(email, link)`. Se não existe: registra evento em `access_logs` e retorna 200. |
| `GET` | `/api/auth/validate-setup-token?token=...` | — | `200 { valid: true, kind: 'invite'\|'reset', name: string }` ou `200 { valid: false, reason: 'expired'\|'consumed'\|'unknown' }` | Não consome o token. Usado pela UI para mostrar formulário com nome do usuário. |
| `POST` | `/api/auth/redeem-token` | `{ token, new_password }` | `200 { ok: true }` | Valida token (não-usado, não-expirado), valida senha pela `passwordPolicy`, faz `bcrypt(new_password)`, atualiza `users.password` + `invite_status='accepted'`, marca `used_at=now()` no token. Se `kind='reset'`: deleta todos os `trusted_devices` do usuário (mitiga comprometimento). |

### Rate limits (reusa `auth/rateLimit.ts`)

| Endpoint | Limite |
|---|---|
| `/api/auth/forgot-password` | 5 por e-mail por hora + 10 por IP por hora |
| `/api/auth/redeem-token` | 10 por IP por hora |

### Auditoria em `access_logs`

Novos valores de `action`:
- `user_invited` (`user_id` = admin que convidou; `meta: { invited_email, invited_role }`)
- `invite_resent` (`user_id` = admin; `meta: { target_user_id }`)
- `user_role_changed` (`user_id` = admin; `meta: { target_user_id, from, to }`)
- `user_activated`, `user_deactivated` (`user_id` = admin; `meta: { target_user_id }`)
- `password_reset_requested` (`user_id` = NULL; `meta: { email, exists: bool }`) — registra mesmo se e-mail não existir, para detectar enumeração
- `password_set` (`user_id` = usuário que definiu; `meta: { kind: 'invite'\|'reset' }`)

## Mailer

Dois métodos novos em `auth/mailer.ts`:

```ts
interface Mailer {
  sendOtp(to: string, code: string): Promise<void>;                        // já existe
  sendInvite(to: string, name: string, link: string): Promise<void>;       // novo
  sendPasswordReset(to: string, link: string): Promise<void>;              // novo
}
```

**`sendInvite`** (assunto: "Bem-vindo ao Portal Unimed Criciúma"):
> Olá, {name}!
> Sua conta foi criada no Portal Unimed Criciúma. Para começar, defina sua senha:
> {link}
> Este link vale por 24 horas e só pode ser usado uma vez.
> Se você não esperava este convite, ignore este e-mail.

**`sendPasswordReset`** (assunto: "Redefinição de senha — Portal Unimed"):
> Recebemos uma solicitação para redefinir sua senha. Clique no link abaixo:
> {link}
> Este link vale por 30 minutos e só pode ser usado uma vez.
> Se você não solicitou, ignore este e-mail e sua senha continuará a mesma.

Ambos os métodos sem links clicáveis para outras páginas — apenas o link de definir/redefinir senha.

`ConsoleMailer` (dev) loga o link no console. `ResendMailer` (prod) usa o template HTML simples.

## Frontend

### Rotas novas em `App.tsx`

| Rota | Componente | Auth |
|---|---|---|
| `/esqueci-senha` | `EsqueciSenha.tsx` | pública |
| `/definir-senha` | `DefinirSenha.tsx` | pública (token na query) |

Ambas fora do `<Layout>` autenticado (mesmo nível de `/login`).

### Aba "Usuários" em `Admin.tsx`

Adicionar entry em `TABS`:
```ts
{ id: 'usuarios', label: 'Usuários', icon: UserPlus }
```
Posição: antes de `Trilha de Acesso` (agrupar com a outra aba de segurança/acesso).

Conteúdo da aba: componente novo `src/pages/admin/UsuariosTab.tsx` (extraído porque `Admin.tsx` já é grande).

**Lista (`UsuariosTab.tsx`):**
- Busca por nome ou e-mail (filtro client-side).
- Colunas: Nome, E-mail, Role, Status visual, Último acesso.
- Status visuais:
  - `● Ativo` (verde) — `is_active && invite_status='accepted'`
  - `◐ Pendente` (amarelo) — `invite_status='pending'`
  - `○ Expirado` (cinza) — `invite_status='expired'`
  - `✕ Inativo` (vermelho) — `!is_active`
- Botão `+ Novo usuário` abre `NovoUsuarioModal`.
- Menu ⋮ por linha (popover) mostra só ações aplicáveis ao status:
  - **Mudar role** → submenu com `admin`/`auditoria`
  - **Desativar** (se `is_active`) / **Reativar** (se inativo)
  - **Reenviar convite** (só se `pending` ou `expired`)

**Modal (`NovoUsuarioModal.tsx`):**
- Campos: nome (text), e-mail (email), role (radio: Admin / Auditoria — default Auditoria).
- Validação cliente: nome ≥ 2 chars, e-mail formato, role obrigatório.
- Mensagem no rodapé: "O usuário receberá um e-mail com link para definir a senha (válido por 24 horas)."
- Botões: Cancelar, Criar.
- Sucesso: fecha modal, refetch lista, toast "Convite enviado para {email}".
- Erro 409: mostra inline "Já existe um usuário com este e-mail".

### Tela `EsqueciSenha.tsx`

Layout visual igual ao `Login.tsx` (logo Unimed, card centralizado, fundo verde claro).

- Título: "Esqueceu sua senha?"
- Subtítulo: "Digite seu e-mail e enviaremos um link para redefinir."
- Campo: e-mail.
- Botão: "Enviar link".
- Após submit (sucesso ou não): toast "Se o e-mail existir no sistema, você receberá instruções em alguns minutos." + redirecionamento pra `/login` em 3s.
- Link "← Voltar para o login".

### Tela `DefinirSenha.tsx`

Lê `?token=...` da URL. No mount, chama `GET /api/auth/validate-setup-token`.

**Estado 1 — validando:** spinner.

**Estado 2 — token válido (`kind='invite'`):**
- Título: "Bem-vindo, {name}!"
- Subtítulo: "Defina sua senha para acessar o Portal Unimed."
- 2 campos: nova senha, confirmar senha.
- Indicadores visuais de força (✓/✗ ao vivo): "Mínimo 8 caracteres", "Pelo menos 1 letra", "Pelo menos 1 número".
- Botão: "Definir senha".

**Estado 2' — token válido (`kind='reset'`):**
- Igual ao acima mas título "Redefinir senha", subtítulo "Escolha sua nova senha.", botão "Redefinir senha".

**Estado 3 — token inválido/expirado/consumido:**
- Mensagem específica: "Link expirado", "Link já utilizado", "Link inválido".
- Botão: "Solicitar novo link" → vai pra `/esqueci-senha`.

**Após sucesso:** redireciona para `/login` com toast "Senha definida! Faça login para continuar."

### Atualização em `Login.tsx`

O texto "Esqueceu sua senha?" hoje é estático. Trocar pra `<Link to="/esqueci-senha">Esqueceu sua senha?</Link>`.

## Helpers puros (testáveis sem DB)

| Arquivo | Funções |
|---|---|
| `auth/setupToken.ts` | `generateToken()` (32 bytes hex), `hashToken(plain)` (bcrypt), `verifyToken(plain, hash)`, `expirationFor(kind)` (24h ou 30min), `isExpired(expiresAt, now)` |
| `auth/passwordPolicy.ts` | `validatePassword(str)` → `{ ok: bool, errors: string[] }`. Regra: ≥8 chars + ≥1 letra + ≥1 número |

Reuso (sem mudança): `auth/rateLimit.ts`, `auth/mailer.ts` (só ganha 2 métodos).

## Testes

### Automatizados (Node test runner)

- `auth/setupToken.test.ts` — geração, hash, verify, expiração por kind
- `auth/passwordPolicy.test.ts` — válidas, curtas, só dígitos, só letras, com espaços, unicode
- `auth/mailer.test.ts` — adicionar 2 testes para `ConsoleMailer.sendInvite()` e `sendPasswordReset()`

Cobertura-meta nos helpers de auth: 80%+ (mesmo padrão do 2FA).

Sem teste automatizado de `server.ts` (decisão herdada do 2FA — `.env` local aponta para Postgres de produção).

### Smoke manual ponta-a-ponta

**Backend (curl):**
1. Login admin → cookie sessão
2. `POST /api/users` cria auditor-test → 201 pending
3. `GET /api/users` lista contém o novo
4. Captura link do e-mail (logs Resend)
5. `GET /validate-setup-token` → valid
6. `POST /redeem-token` define senha → 200
7. Login com auditor-test → OTP → cookie ✓
8. `PATCH /api/users/:id` role → access_logs registra
9. `PATCH is_active=false` → novo login bloqueia
10. `forgot-password` → e-mail dispara
11. Redeem token reset → senha trocada + `trusted_devices` deletados
12. `resend-invite` em pendente → token antigo invalidado
13. Negativos: role inválido (403), token consumido (400), senha fraca (400), rate-limit (429)

**UI (Chrome DevTools MCP):**
1. `/login` → link "Esqueceu sua senha?" → `/esqueci-senha`
2. Submit e-mail → toast genérico → `/login`
3. Abrir link do e-mail → `/definir-senha?token=...` carrega com nome
4. Senha fraca → erros inline; senha forte → redireciona pra `/login`
5. Admin: aba Usuários → criar → modal fecha → lista atualiza
6. Menu ⋮ → mudar role → linha atualiza
7. Menu ⋮ → desativar → status muda
8. Menu ⋮ em pendente → reenviar convite → toast

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Vazamento de existência de e-mail via `forgot-password` | Sempre retorna 200 idêntico; rate-limit por IP+e-mail; log de tentativa |
| Brute-force de token no `redeem-token` | Token de 64 chars hex (2^256 espaço); rate-limit 10/h por IP; uso único |
| Convite interceptado em e-mail | Link expira em 24h; uso único; usuário pode ignorar e admin reenviar |
| Reset de senha quando dispositivo está comprometido | Reset deleta todos os `trusted_devices` daquele usuário |
| Admin desativa-se acidentalmente | Validação no PATCH: admin não pode desativar a própria conta nem rebaixar a própria role |
| Race no reenvio de convite (dois admins clicam simultaneamente) | Transação SQL: marca tokens antigos + insere novo atomicamente |
| Token de reset usado depois de mudar senha por outro caminho | Token tem `used_at` único — segunda tentativa cai em `consumed` |

## Configuração

Nenhuma variável de ambiente nova necessária. Reusa:
- `RESEND_API_KEY`, `MAIL_FROM` (já em prod)
- `JWT_SECRET` (já em prod)
- `ALLOWED_ORIGINS` (já em prod)
- `APP_URL` (já existe) — usado para montar o link absoluto no e-mail: `{APP_URL}/definir-senha?token=...`

## Padrões de código (herdados)

- Helpers puros em `auth/*.ts`, testáveis sem DB.
- SQL inline em `server.ts` dentro dos handlers (mesmo padrão do 2FA).
- `fetchApi` no frontend (já existe) com `credentials: 'include'`.
- Errors com mensagens em pt-BR para o usuário; logs em console com contexto técnico.
- Sem documentação extra no `README.md` — o spec é a fonte da verdade.

## Próximos passos

1. Spec aprovado pela usuária → invocar `superpowers:writing-plans` para gerar plano de implementação task-a-task.
2. Após implementação + smoke test em prod, atualizar memória de projeto referenciando este design.
