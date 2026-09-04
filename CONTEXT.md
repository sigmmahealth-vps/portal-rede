# Contexto — Portal da Rede de Prestadores (PRP)

Glossário da linguagem do domínio. Só termos; sem detalhes de implementação.

## Ciclo de qualificação
Janela em que os prestadores são avaliados. Tem início e fim, um rótulo e no
máximo um ciclo ativo por vez. Passa por dois momentos distintos: **criar** o
ciclo (define seus parâmetros) e **abrir** o ciclo (gera as instâncias de
avaliação e passa a aceitar emissão de certificados).

## Critério eliminatório (documento legal)
Critério cuja **não conformidade** rebaixa o selo a Bronze independentemente da nota.
São os documentos legais (dimensão "Documento Legal", `is_eliminatory`). **Não
conformidade** aqui = o critério entra no cálculo e não pontuou o máximo (por
qualquer motivo: reprovado, respondido "não", ou N/A reprovado) — não é apenas o
formalmente **reprovado** pelo auditor. Pontuação cheia ou N/A aprovado (não se
aplica) não são não conformidade. Basta uma para rebaixar a Bronze.

## Status de e-mail (notificações)
Estado do e-mail de uma notificação (`notifications.email_status`), espelhando o
provedor (Resend). Caminho de sucesso: **pendente** (na fila) → **enviado**
("Sent" — aceito pelo provedor) → **entregue** ("Delivered") → **aberto** ("Lido",
via open tracking). Falhas: **rejeitado** (bounce/devolvido), **reclamado** (marcou
como spam), **falhou** (provedor não conseguiu enviar), **atrasado** (transiente,
vai retentar). Fora disso: **suprimido** (não saiu — allowlist de teste/sem envio
real) e **sem e-mail** (`na` — notificação só de portal). Entrega/abertura reais
vêm dos webhooks do Resend; falhas são "grudentas" (não regridem para entregue/lido).

## Validade do certificado
Data até a qual um certificado de qualificação é válido. É **escolhida por quem
cria o ciclo** e vale igual para todos os certificados emitidos naquele ciclo
(um valor único por ciclo). É obrigatória, mas pode ser qualquer data (sem
exigência de ser posterior ao fim do ciclo). Fica
**travada assim que o ciclo é aberto** e é **congelada em cada certificado no
momento da emissão** — editar o ciclo depois não altera certificados já
emitidos. Não é mais derivada por regra automática (antes era "fim do ciclo +
1 ano").
