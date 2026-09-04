# Contexto — Portal da Rede de Prestadores (PRP)

Glossário da linguagem do domínio. Só termos; sem detalhes de implementação.

## Ciclo de qualificação
Janela em que os prestadores são avaliados. Tem início e fim, um rótulo e no
máximo um ciclo ativo por vez. Passa por dois momentos distintos: **criar** o
ciclo (define seus parâmetros) e **abrir** o ciclo (gera as instâncias de
avaliação e passa a aceitar emissão de certificados).

## Validade do certificado
Data até a qual um certificado de qualificação é válido. É **escolhida por quem
cria o ciclo** e vale igual para todos os certificados emitidos naquele ciclo
(um valor único por ciclo). Deve ser igual ou posterior ao fim do ciclo. Fica
**travada assim que o ciclo é aberto** e é **congelada em cada certificado no
momento da emissão** — editar o ciclo depois não altera certificados já
emitidos. Não é mais derivada por regra automática (antes era "fim do ciclo +
1 ano").
