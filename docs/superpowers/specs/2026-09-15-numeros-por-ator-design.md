# Números por ator — Design

**Data:** 2026-09-15
**Status:** Aprovado (decisões tomadas em sessão com a SIGMMA/Katy)
**Área:** Dashboards (Estratégico, Painel do Ciclo, Admin, Prestador)

## Problema

O portal exibe dezenas de números, mas sem definição de **quem monitora o quê**:
admin e auditoria veem telas idênticas, duas contas de "distribuição de selos"
convivem sem bater (por prestador × por endereço), e o backend calcula
indicadores que nenhuma tela mostra (ranking, evolução mensal, distribuição por
grupo). Origem: item 18 da homologação ("evidenciar as movimentações em cada
tela"), promovido a definição de produto.

## Decisões (fechadas em 15/09/2026)

| Tema | Decisão |
|------|---------|
| Atores | 3 — admin, auditoria, prestador (conjunto único p/ cooperado/PF/PJ, ocultando o que não se aplica) |
| Admin × auditoria | Diferença de ÊNFASE, sem restringir acesso: ambos seguem vendo tudo |
| Famílias | Fluxo + resultado p/ todos; engajamento (acessos/e-mails) só admin |
| Recorte | Ciclo vigente p/ auditoria e prestador; tendência entre ciclos só no Estratégico |
| Consumo | No portal + export .xlsx existente; sem e-mail periódico |
| Selo — conta oficial | **Por endereço** (qualificação é por unidade desde a 0035); telas que contam por prestador são corrigidas |
| Benchmark p/ prestador | **Descartado** — prestador não vê notas agregadas da rede |

## Mapa ator → números

**Prestador** (só o que é dele, ciclo vigente): pendências do mural Início,
progresso do roteiro, nota/selo próprios + % por dimensão, ações do plano
(X de Y, prazos 30/60/90), chamados e treinamentos pendentes.

**Auditoria** (operação do ciclo — painel primário: Painel do Ciclo, Planos,
Pesquisa): KPIs atuais do Painel + badges por linha + **distribuição por grupo
de prestador** (novo, dado já calculado) + **tempo médio envio→parecer** (novo).

**Admin** (rede, tendência, engajamento — painel primário: Estratégico, Rede,
Usuários/E-mails): tudo do Estratégico + **ranking top-10** e **evolução mensal
do score** (novos, dados já calculados) + **card de adoção de acessos** (novo)
+ cards de e-mail existentes.

## Trabalho decorrente (sem migration)

1. **Bug**: card "Treinamentos — A concluir" do prestador PJ mostra o total;
   passar a filtrar `status !== 'concluido'` (variante cooperado já faz).
2. **Selos por endereço** no `GET /api/dashboard` (admin): trocar
   `DISTINCT ON (provider_id)` por `DISTINCT ON (provider_id, location_id)`.
3. **Estratégico**: exibir `ranking` (top-10 prestadores por nota, com selo e
   unidade) e `evolution` (score médio por mês) — payload já traz ambos.
4. **Painel do Ciclo**: exibir `group_distribution` (pares por grupo) — payload
   já traz — e novo KPI **tempo médio de análise** (envio→parecer, dias, média
   das instâncias com parecer no ciclo).
5. **Aba Usuários**: card de adoção no segmento Acessos de prestadores —
   Ativos / Pendentes / Sem e-mail / % de convites aceitos (client-side, a
   lista já carrega tudo).

Fora de escopo (YAGNI): e-mail periódico com resumo; restrição de telas por
role; benchmark ao prestador; status extras de e-mail como cards.
