// Termo de Ciência e Responsabilidade pelo Envio de Evidências (spec 2026-09-29).
// Texto literal de "Termo - Revisado e Atualizado.docx" (Unimed Criciúma). Mudou o texto?
// Troque a versão: roteiros que ainda não aceitaram esta versão pedem o aceite de novo.
// O servidor grava o snapshot (termoEvidenciasTexto) em eval_instance_terms a cada aceite.
export const TERMO_EVIDENCIAS_VERSION = '2026-09-29';

export const TERMO_EVIDENCIAS_TITULO =
  'Termo de Ciência e Responsabilidade pelo Envio de Evidências no Processo de Qualificação da Rede Prestadora';

export const TERMO_EVIDENCIAS_PARAGRAFOS: string[] = [
  'Ao prosseguir com o preenchimento do Roteiro de Qualificação, declaro estar ciente de que as informações, os documentos, as fotografias e as demais evidências inseridas no PRP – Portal Rede Prestadora serão disponibilizadas à Unimed de Criciúma – Cooperativa de Trabalho Médico da Região Carbonífera e tratadas para a avaliação e a qualificação técnica da rede prestadora, incluindo a verificação do atendimento aos critérios técnicos, assistenciais, regulatórios, de qualidade, segurança e governança aplicáveis.',
  'Declaro estar ciente de que a Unimed Criciúma realizará o recebimento, o acesso, a análise, o armazenamento e as demais operações de tratamento necessárias às finalidades acima indicadas, com fundamento nas bases legais aplicáveis, inclusive para o cumprimento de obrigações legais ou regulatórias, a execução da relação contratual e o exercício regular de direitos.',
  'As evidências poderão ser acessadas por profissionais e áreas internas autorizadas da Unimed Criciúma, por fornecedores responsáveis pela operação, hospedagem, manutenção ou segurança do Portal, sujeitos a deveres de confidencialidade e proteção de dados, bem como por autoridades competentes, quando houver obrigação legal, regulatória ou determinação válida.',
  'Os dados e documentos serão conservados pelo período necessário à realização e à documentação do processo de qualificação, à manutenção da relação contratual, ao cumprimento de obrigações legais ou regulatórias e ao exercício regular de direitos, sendo posteriormente eliminados ou anonimizados, quando cabível. A Unimed Criciúma adota medidas técnicas, administrativas e organizacionais destinadas à proteção das informações contra acessos não autorizados e situações acidentais ou ilícitas de destruição, perda, alteração, comunicação ou difusão.',
  'Os titulares dos dados pessoais poderão exercer os direitos previstos na Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 – LGPD), quando aplicáveis, mediante solicitação ao Encarregado pelo Tratamento de Dados Pessoais da Unimed Criciúma, pelo canal oficial de atendimento: csi@criciuma.unimedsc.com.br.',
  'Declaro, sob minha responsabilidade, que as informações e os documentos encaminhados são verdadeiros, íntegros, pertinentes e atualizados e que possuo legitimidade e fundamento jurídico para disponibilizá-los à Unimed Criciúma. Comprometo-me a observar os princípios da finalidade, adequação e necessidade, abstendo-me de inserir dados pessoais desnecessários ou excessivos e adotando, sempre que possível, medidas de anonimização, pseudonimização ou ocultação de informações que não sejam indispensáveis à comprovação dos critérios avaliados.',
  'Comprometo-me, ainda, a não inserir prontuários, fotografias de pacientes, dados de saúde ou outros dados pessoais sensíveis de terceiros, salvo quando expressamente solicitados pela Unimed Criciúma, estritamente necessários à finalidade informada e amparados por fundamento jurídico adequado, permanecendo responsável pela regularidade da coleta, da utilização e do compartilhamento dessas informações.',
];

export const TERMO_EVIDENCIAS_DECLARACAO =
  'Declaro que li e compreendi as informações acima, que estou legitimado a encaminhar as evidências apresentadas e que me responsabilizo pela pertinência, veracidade e regularidade do seu compartilhamento no processo de qualificação.';

export const termoEvidenciasTexto = (): string =>
  [TERMO_EVIDENCIAS_TITULO, ...TERMO_EVIDENCIAS_PARAGRAFOS, TERMO_EVIDENCIAS_DECLARACAO].join('\n\n');
