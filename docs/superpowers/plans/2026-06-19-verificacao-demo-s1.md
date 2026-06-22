# Verificação para a Demo S1 (RN 630) — Plano de Teste

> **Tipo:** checklist de *smoke / verificação manual* (sem código novo). Rode os passos
> na ordem; cada um tem `- [ ]` para marcar. Não é um plano de build TDD — é a prova de que
> as WS já entregues funcionam fim-a-fim antes da reunião de **sexta, 26/06/2026**.

**Objetivo:** confirmar que WS1, WS3, WS4, WS5 e WS6 estão operacionais (local + Railway) e
deixar pronto o roteiro de demonstração. WS2 (pipeline SGU) está bloqueada por acesso — ver Task 6.

**Abordagem:** verificação manual via API (`Invoke-RestMethod` no PowerShell) + conferência de
tela no navegador. **Não** mexer em estrutura do banco. Cuidado: o `.env` aponta para o **Postgres
compartilhado dev/homolog** da Railway — todo POST/DELETE abaixo grava nesse banco; os passos que
escrevem usam dados sintéticos descartáveis e/ou desfazem o que criaram.

**Stack:** Express (`server.ts`, porta 3000) + Postgres (`pg`) + React/Vite (`src/`). Migrations
em `db/migrations/*.sql`. Sem framework de teste — gate de tipo é `npm run lint` (`tsc --noEmit`).

---

## Pré-condições (uma vez, antes de tudo)

**Arquivos relevantes:**
- App: `portal-rede-v1-main/server.ts`
- Seed demo: `portal-rede-v1-main/db/seed-synthetic.ts`
- Env: `portal-rede-v1-main/.env` (DATABASE_URL — **não** versionar)

- [ ] **P1: Subir o backend local**

No diretório `portal-rede-v1-main/`:
```powershell
npm run dev
```
Esperado: `Server running on http://localhost:3000`. (Backend roda via `tsx server.ts` SEM watch —
qualquer mudança em `.ts` de servidor exige Ctrl+C e novo `npm run dev`.)

- [ ] **P2: Garantir os dados de demo (10 prestadores SYN-*)**

Em **outro** terminal, no mesmo diretório:
```powershell
npx tsx db/seed-synthetic.ts
```
Esperado: `Upsert de 10 prestadores sintéticos + locais concluído.` (Idempotente por `sgu_code`.)

- [ ] **P3: Definir a base e logar como admin (captura o token JWT)**

```powershell
$BASE = 'http://localhost:3000'
$login = Invoke-RestMethod -Uri "$BASE/api/auth/login" -Method Post -ContentType 'application/json' `
  -Body (@{ email='admin@unimed.com'; password='senha123' } | ConvertTo-Json)
$TOKEN = $login.token
$H = @{ Authorization = "Bearer $TOKEN" }
$TOKEN.Substring(0,12)   # só pra confirmar que veio um JWT
```
Esperado: imprime os primeiros caracteres do token (ex.: `eyJhbGciOi`). Se der **401**, os usuários
de demo não foram semeados — eles só nascem no boot quando a tabela `users` está vazia
(`server.ts:67-80`). Credenciais (todas senha `senha123`): `admin@unimed.com`,
`prestador@unimed.com`, `auditoria@unimed.com`, `cooperado@unimed.com`.

---

## Task 1 — WS1: Data layer → Postgres

**Meta:** o app fala com o Postgres (não SQLite) e as 5 migrations estão aplicadas.

**Arquivos:** `db/db.ts`, `db/migrate.ts`, `db/migrations/0001..0005`, `server.ts:475` (`GET /api/providers`).

- [ ] **1.1: Confirmar que as migrations estão todas aplicadas (leitura, não reaplica)**
```powershell
npm run db:migrate
```
Esperado: linhas `= já aplicada: 0001_baseline.sql` … `0005_sgu_cadastro_fields.sql` e ao final
`Nada a aplicar — banco já atualizado.` (Se aparecer `+ aplicada`, alguma faltava — anote e siga.)

- [ ] **1.2: Listar prestadores via API (prova ponta-a-ponta Express→pg)**
```powershell
$provs = Invoke-RestMethod -Uri "$BASE/api/providers" -Headers $H
$provs.Count
$provs | Select-Object -First 3 sgu_code, name, provider_group, status
```
Esperado: `Count` ≥ 10 e os `SYN-001..` aparecem (ex.: `SYN-001 / Clínica Cardiológica Criciúma`).

- [ ] **1.3: Conferir que os campos novos do SGU 2.0 existem no payload (migration 0005)**
```powershell
$provs | Select-Object -First 1 | Format-List sgu_code, provider_type, area_atuacao
```
Esperado: o objeto tem as **chaves** `provider_type` e `area_atuacao` (valores podem vir `null` nos
SYN-* — o que importa é a coluna existir e ser serializada).

---

## Task 2 — WS3: Acesso & perfis (login único + último acesso + IP) — §5.2.2 Tela 4

**Meta:** login único pelos 4 perfis; o sistema mostra "seu último acesso foi…" e registra IP+data;
a trilha de acesso é restrita.

**Arquivos:** `server.ts:219` (login), `server.ts:200-216` (recordAccess/IP), `server.ts:252` (`GET /api/access-logs`).

- [ ] **2.1: Login funciona nos 4 perfis**
```powershell
foreach ($e in 'admin@unimed.com','prestador@unimed.com','auditoria@unimed.com','cooperado@unimed.com') {
  $r = Invoke-RestMethod -Uri "$BASE/api/auth/login" -Method Post -ContentType 'application/json' `
    -Body (@{ email=$e; password='senha123' } | ConvertTo-Json)
  "{0,-26} role={1}" -f $e, $r.user.role
}
```
Esperado: 4 linhas com os papéis `admin`, `prestador`, `auditoria`, `cooperado`.

- [ ] **2.2: "Último acesso anterior" é devolvido (Tela 4)**
```powershell
$a = Invoke-RestMethod -Uri "$BASE/api/auth/login" -Method Post -ContentType 'application/json' `
  -Body (@{ email='prestador@unimed.com'; password='senha123' } | ConvertTo-Json)
$a.user.last_login_at      # acesso ANTERIOR (pode ser null no 1º login de todos)
Start-Sleep -Seconds 1
$b = Invoke-RestMethod -Uri "$BASE/api/auth/login" -Method Post -ContentType 'application/json' `
  -Body (@{ email='prestador@unimed.com'; password='senha123' } | ConvertTo-Json)
$b.user.last_login_at      # agora traz o timestamp do login anterior (passo acima)
```
Esperado: na 2ª chamada, `last_login_at` vem **preenchido** com a data/hora do login imediatamente
anterior (confirma a captura do acesso prévio antes de sobrescrever — `server.ts:236`).

- [ ] **2.3: Tentativa inválida é registrada com `success=false`**
```powershell
try {
  Invoke-RestMethod -Uri "$BASE/api/auth/login" -Method Post -ContentType 'application/json' `
    -Body (@{ email='prestador@unimed.com'; password='ERRADA' } | ConvertTo-Json)
} catch { "401 esperado: $($_.Exception.Response.StatusCode.value__)" }
```
Esperado: imprime `401 esperado: 401`.

- [ ] **2.4: Trilha de acesso mostra IP + data; só admin/auditoria leem**
```powershell
$logs = Invoke-RestMethod -Uri "$BASE/api/access-logs?limit=5" -Headers $H   # $H = admin
$logs.logs | Select-Object email, ip, success, created_at
```
Esperado: linhas recentes com `ip` preenchido (ex.: `127.0.0.1` ou `::1`), o `created_at`, e tanto
`success=true` (2.1/2.2) quanto `success=false` (2.3).

- [ ] **2.5: Prestador NÃO acessa a trilha (autorização)**
```powershell
$pl = Invoke-RestMethod -Uri "$BASE/api/auth/login" -Method Post -ContentType 'application/json' `
  -Body (@{ email='prestador@unimed.com'; password='senha123' } | ConvertTo-Json)
try {
  Invoke-RestMethod -Uri "$BASE/api/access-logs" -Headers @{ Authorization = "Bearer $($pl.token)" }
} catch { "403 esperado: $($_.Exception.Response.StatusCode.value__)" }
```
Esperado: imprime `403 esperado: 403`.

---

## Task 3 — WS4: Importador de roteiros (15 .xlsx → eval_*)

**Meta:** os 15 roteiros estão carregados, cada um com seções e questões.

**Arquivos:** `db/import-roteiros.ts`, `server.ts:1665` (`GET /api/eval/scripts`), `server.ts:1685` (`/:id`).

- [ ] **3.1: Contar os roteiros carregados**
```powershell
$scripts = Invoke-RestMethod -Uri "$BASE/api/eval/scripts" -Headers $H
$scripts.Count
$scripts | Select-Object -First 5 title, source_file
```
Esperado: `Count` = **15**. Se vier 0, rode o import: `npx tsx db/import-roteiros.ts --commit`
(idempotente por `source_file`). Se vier menos de 15, identifique quais `source_file` faltam.

- [ ] **3.2: Um roteiro tem seções + questões (abre o FOR-017 Médicos)**
```powershell
$id = ($scripts | Where-Object { $_.source_file -match 'FOR-017' } | Select-Object -First 1).id
$full = Invoke-RestMethod -Uri "$BASE/api/eval/scripts/$id" -Headers $H
"seções: $($full.sections.Count)"
$full.sections | Select-Object -First 1 | ForEach-Object { "questões na 1ª seção: $($_.questions.Count)" }
```
Esperado: `seções` maior que 0 e a primeira seção tem `questões` maior que 0 (estrutura
GRUPO→SEÇÃO→critério importada). Se `FOR-017` não existir, troque por qualquer `source_file` do 3.1.

---

## Task 4 — WS5: Cadastro de equipe do prestador (provider_contacts) — §5.2.3 Tela 3

**Meta:** o prestador cadastra/lista/remove sua equipe (contatos informativos, **sem login**).

**Arquivos:** `server.ts:305/328/352` (GET/POST/DELETE), `src/pages/Equipe.tsx` (tela "Novo Contato/Profissional").

- [ ] **4.1: Logar como prestador**
```powershell
$pl = Invoke-RestMethod -Uri "$BASE/api/auth/login" -Method Post -ContentType 'application/json' `
  -Body (@{ email='prestador@unimed.com'; password='senha123' } | ConvertTo-Json)
$PH = @{ Authorization = "Bearer $($pl.token)" }
```

- [ ] **4.2: Criar um contato de teste**
```powershell
$novo = Invoke-RestMethod -Uri "$BASE/api/provider-contacts" -Method Post -Headers $PH `
  -ContentType 'application/json' `
  -Body (@{ name='Contato Smoke Test'; position='Recepção'; email='smoke@teste.com'; phone='(48) 90000-0000' } | ConvertTo-Json)
$novo.id; $novo.name
```
Esperado: retorna o registro criado com `id` e `name = 'Contato Smoke Test'`. (Validação: POST sem
`name` deve dar 400 — opcional testar.)

- [ ] **4.3: O contato aparece na listagem do próprio prestador**
```powershell
$lista = Invoke-RestMethod -Uri "$BASE/api/provider-contacts" -Headers $PH
$lista | Where-Object { $_.id -eq $novo.id } | Select-Object id, name, position
```
Esperado: a linha do contato recém-criado aparece.

- [ ] **4.4: Remover o contato de teste (limpa o que foi criado)**
```powershell
Invoke-RestMethod -Uri "$BASE/api/provider-contacts/$($novo.id)" -Method Delete -Headers $PH
$depois = Invoke-RestMethod -Uri "$BASE/api/provider-contacts" -Headers $PH
"ainda existe? " + [bool]($depois | Where-Object { $_.id -eq $novo.id })
```
Esperado: `{ success = True }` no delete e `ainda existe? False`.

- [ ] **4.5: Conferência de tela (frontend)**

Abra `http://localhost:3000` no navegador (com `npm run dev` rodando), entre como
`prestador@unimed.com` / `senha123`, vá em **Equipe** (`src/pages/Equipe.tsx`), use **"Novo
Contato/Profissional"** para adicionar e remover um contato. Esperado: a tela cria, lista e remove
sem erro de console.

---

## Task 5 — WS6: Deploy & demo (Railway)

**Meta:** o ambiente publicado responde, loga e mostra dados; o roteiro da reunião está pronto.

**Arquivos:** `nixpacks.toml`, `server.ts:1903` (listen `0.0.0.0:$PORT`), `server.ts:1912` (estático `dist/`).

- [ ] **5.1: Anotar a URL pública da Railway**

Pegue no painel da Railway a URL do serviço web (formato `https://<seu-app>.up.railway.app`) e defina:
```powershell
$PROD = 'https://COLE_A_URL_AQUI.up.railway.app'
```

- [ ] **5.2: Frontend de produção carrega**
```powershell
(Invoke-WebRequest -Uri $PROD -UseBasicParsing).StatusCode
```
Esperado: `200`. No navegador, a tela de **Login** deve renderizar.

- [ ] **5.3: Login + dados funcionam em produção**
```powershell
$pr = Invoke-RestMethod -Uri "$PROD/api/auth/login" -Method Post -ContentType 'application/json' `
  -Body (@{ email='admin@unimed.com'; password='senha123' } | ConvertTo-Json)
$provP = Invoke-RestMethod -Uri "$PROD/api/providers" -Headers @{ Authorization = "Bearer $($pr.token)" }
"prestadores em prod: $($provP.Count)"
```
Esperado: token retornado e `prestadores em prod` ≥ 10. Se vier 0, rode o seed apontando o `.env`
para o banco de produção (`npx tsx db/seed-synthetic.ts`) — lembrando que dev/homolog e produção
**compartilham** o mesmo Postgres hoje.

- [ ] **5.4: Roteiro da demo de sexta (sequência de cliques — ensaie 1x)**

  1. **Login único / Tela 4** — entrar como `prestador@unimed.com`; mostrar "seu último acesso foi…".
  2. **Perfis** — sair e entrar como `admin@unimed.com`; abrir a **trilha de acesso** (IP + data) e
     mostrar que o prestador não a vê (governança RN 630).
  3. **Cadastro do prestador** — listar prestadores; abrir um e mostrar o campo **Tipo (SGU)**
     (`provider_type`) já no cadastro (`src/pages/Admin.tsx`).
  4. **Equipe** — como prestador, cadastrar um **Novo Contato/Profissional** (WS5).
  5. **Roteiros de qualificação** — abrir o módulo de qualificação e mostrar um dos **15 roteiros**
     importados (ex.: FOR-017 Médicos) com seções/critérios (WS4).
  6. **Fechar** com a mensagem de WS2 (Task 6).

---

## Task 6 — WS2: Pipeline SGU (BLOQUEADA) — o que dizer na demo

**Meta:** posicionar a única WS aberta sem prometer o que não existe.

- [ ] **6.1: Falar a verdade técnica**

A **infra de dados já está pronta** para receber o SGU: a migration `0005_sgu_cadastro_fields.sql`
adicionou `providers.provider_type`, `providers.area_atuacao`, `provider_locations.email` e a tabela
`provider_certifications` (campos 12–20: mestrado/doutorado/pós/ISO 9001/acreditação). Falta apenas
o **acesso à base do SGU** para construir a carga real (chave = código do prestador, idempotente).
Hoje os dados são sintéticos (`SYN-*`). **Não** há importador SGU mockado (decisão de escopo desta
verificação). Próximo passo, quando o acesso chegar: construir o pipeline espelhando o padrão de
`db/import-roteiros.ts` (dry-run → `--commit` idempotente).

---

## Checklist de prontidão (rodar na véspera, 25/06)

- [ ] `npm run lint` passa limpo (`tsc --noEmit`).
- [ ] Tasks 1–5 todas verdes em **local**.
- [ ] Task 5 (5.2/5.3) verde em **produção (Railway)**.
- [ ] Seed de demo presente em produção (≥10 prestadores).
- [ ] Roteiro 5.4 ensaiado pelo menos uma vez ponta-a-ponta.
- [ ] Senha do Postgres exposta: **rotacionar ao fim da S1** (após a demo) — está no `.env` e aponta
      para dev/homolog; trocar e atualizar a var na Railway.

## Rollback / se algo quebrar na demo

- **API 500 logo após deploy:** quase sempre `DATABASE_URL` ausente no serviço da Railway — confirmar
  a var de referência `${{Postgres.DATABASE_URL}}` (já foi causa de crash em `db.ts`).
- **Login 401 em produção:** tabela `users` não foi semeada (só nasce no boot com `users` vazia) —
  conferir se o deploy subiu com o banco esperado.
- **Dados sumiram:** rerodar `npx tsx db/seed-synthetic.ts` (idempotente, não duplica).
- **Roteiros zerados:** `npx tsx db/import-roteiros.ts --commit` (idempotente por `source_file`).
