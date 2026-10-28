import type { ReactNode } from 'react';

// Texto da Política de Privacidade — fonte única da página e do modal de aceite.
// Mudou o texto? Atualize PRIVACY_POLICY_VERSION (src/lib/privacyPolicy.ts) para todos aceitarem de novo.
// Fonte: "Revisão - Política de Privacidade.docx" (Unimed Criciúma, out/2026) — transcrito sem alterar a redação.
const H = ({ children }: { children: ReactNode }) => <h2 className="text-lg font-semibold text-gray-900 mt-8 mb-3">{children}</h2>;
const P = ({ children }: { children: ReactNode }) => <p className="mb-3">{children}</p>;
const UL = ({ children }: { children: ReactNode }) => <ul className="list-disc pl-6 space-y-1 mb-3">{children}</ul>;
const A = ({ href }: { href: string }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#00995D] hover:underline break-all">{href}</a>;
const EMAIL = <a href="mailto:csi@criciuma.unimedsc.com.br" className="text-[#00995D] hover:underline">csi@criciuma.unimedsc.com.br</a>;

export default function PoliticaTexto() {
  return (
    <div className="text-gray-700 text-sm leading-relaxed">
      <p className="text-base font-semibold text-gray-900 mb-4">Termos de Uso e Política de Privacidade e Proteção de Dados - Unimed Criciúma</p>

      <H>I – APRESENTAÇÃO</H>
      <P>
        A Unimed Criciúma Cooperativa Trabalho Medico Região Carbonífera, pessoa jurídica de Direito Interno Privado, devidamente inscrita no CNPJ sob o n° 82.996.703/0001-86, com sede na Avenida Estevão Emílio de Souza, nº 201, bairro Ceará, em Criciúma (SC), CEP 88815-180, entende como extremamente relevantes os registros eletrônicos e os dados pessoais deixados por você (Titular) na utilização dos diversos sites e serviços da Unimed Criciúma.
      </P>
      <P>
        O presente documento regula, de forma simples, transparente e objetiva, tanto as condições e termos de uso de nossos ambientes digitais, quanto as regras de privacidade e proteção de dados pessoais. A presente Política se aplica a serviços relacionados às atividades da Unimed Criciúma, entendendo como tal todas aquelas elencadas no site oficial da Unimed Criciúma, nos endereços <A href="https://www.unimedcriciuma.com.br" />, <A href="https://www.laboratorioburigo.com.br/" />, <A href="https://hsjb.com.br/" />, <A href="https://prp.criciuma.unimedsc.com.br/login" /> e também aquelas relacionadas às funcionalidades e recursos do APP Unimed Criciúma.
      </P>
      <P>
        A presente política aplica-se aos clientes da Unimed Criciúma, ao público em geral, bem como aos seus funcionários, colaboradores e fornecedores, estabelecendo as diretrizes gerais sobre como tratamos os dados pessoais de todos os titulares, na função de titular de dados. No entanto, na função de operador de dados, caso você seja um funcionário, colaborador ou fornecedor, ou esteja participando de algum projeto ou atividade específica, as disposições desta política devem ser analisadas e interpretadas em conjunto com o contrato firmado entre as partes, observando as obrigações e especificidades aplicáveis à sua relação contratual.
      </P>
      <P>
        O Portal Corporativo e APP Unimed Criciúma, através da explicitação de suas Políticas de Privacidade, quer demonstrar que a privacidade da informação dos seus usuários e/ou visitantes é muito importante e, por isso, toma precauções e cautelas para resguardá-las, procurando utilizar mecanismos completos e eficazes de segurança em informática. Para utilizar-se dos serviços oferecidos pelo Portal Corporativo da Unimed Criciúma e APP Unimed Criciúma todo Usuário tem que registrar-se e informar seus dados pessoais completos e exatos, conforme as telas de cadastramento de Usuários, e estes dados serão armazenados na base de dados do Portal Corporativo da Unimed Criciúma e APP Unimed Criciúma, que reserva-se no direito de buscar todas as formas possíveis para confirmar os dados pessoais informados, podendo inclusive consultar entidades públicas, companhias especializadas ou bancos de dados de outras empresas ou entidades. O Usuário, ao cadastrar-se, expressamente concorda com tais procedimentos, sendo que as informações que a Unimed Criciúma obtiver destas entidades será tratada de forma confidencial. Em caso de dúvidas adicionais ou requisições, por favor, entre em contato com nosso Encarregado – Gestor de proteção de dados, Dr. Marcos Roberto de Faveri de Souza, por meio do endereço de e-mail: {EMAIL}.
      </P>

      <H>II – RESUMO</H>
      <P>Para ilustrar melhor a forma como realizamos o tratamento de dados, apresentamos um resumo de nossa Política de Privacidade e Proteção de Dados Pessoais.</P>
      <P><strong>a) Quadro resumo</strong></P>
      <UL>
        <li><strong>Agente de Tratamento:</strong> Unimed Criciúma.</li>
        <li><strong>CNPJ:</strong> 82.996.703/0001-86.</li>
        <li><strong>Endereço:</strong> Avenida Estevão Emílio de Souza, nº 201, bairro Ceará, Em Criciúma (SC), CEP 88815-180.</li>
        <li><strong>Papel no tratamento:</strong> Predominantemente controladora.</li>
        <li><strong>Natureza dos dados tratados:</strong> Dados pessoais fornecidos pelo Titular e/ou coletados automaticamente.</li>
        <li><strong>Objeto do documento:</strong> Regras de uso dos portais/APP e diretrizes de proteção de dados pessoais.</li>
      </UL>
      <P><strong>b) Principais finalidades do tratamento</strong></P>
      <P>
        <strong>b.1) Finalidades:</strong> A Unimed Criciúma poderá utilizar dados pessoais para entrar, responder ou manter contatos, antes, durante ou após uma relação contratual com o Titular, fornecer os seus produtos e serviços, emitir alertas sobre agendamentos de consultas e exames, cuidados preventivos entre outras atividades visando o cumprimento do contrato.
      </P>
      <P>Base legal:</P>
      <UL>
        <li>Dados pessoais não sensíveis;</li>
        <li>Execução de contrato (art. 7º, inc. V, LGPD);</li>
        <li>Dados referentes à saúde;</li>
        <li>Exceção de comunicação ou uso compartilhado de dados de saúde (art. 11, § 4º, II, LGPD).</li>
      </UL>
      <P>
        <strong>b.2) Finalidades:</strong> Uso compartilhado de informações para prestação dos serviços de saúde, uso compartilhado de informações para permitir transações financeiras envolvendo as cooperativas e, uso compartilhado de informações para permitir transações administrativas e como validação de normas do Sistemas Unimed.
      </P>
      <P>Base legal:</P>
      <UL>
        <li>Dados pessoais não sensíveis;</li>
        <li>Interesse legítimo (artigo 7º, inc. IX, LGPD);</li>
        <li>Dados referentes à saúde;</li>
        <li>Exceção de comunicação ou uso compartilhado de dados de saúde (artigo 11º, § 4º, II, LGPD).</li>
      </UL>
      <P><strong>b.3) Finalidade:</strong> Operações de tratamento de dados pessoais ou sensíveis de menores de idade.</P>
      <P>Base legal:</P>
      <UL>
        <li>Consentimento de, pelo menos, um dos responsáveis do menor (artigo 14º, § 1º, LGPD).</li>
      </UL>
      <P><strong>c) Compartilhamento:</strong> Com operadores e fornecedores de serviços essenciais para nossas atividades, provedores de infraestrutura em nuvem, outras empresas do Sistema Unimed e autoridades/órgãos governamentais por decorrência de obrigações legais ou regulatórias.</P>
      <P><strong>d) Proteção de dados:</strong> Medidas de segurança, técnicas e administrativas adequadas.</P>
      <P><strong>e) Seus direitos:</strong> Confirmação da existência de tratamento, acesso, correção, portabilidade etc.</P>
      <P>Esta Política poderá ser atualizada, a qualquer tempo, pela Unimed Criciúma mediante aviso no site, e/ou por e-mail, caso o Titular tenha optado por receber comunicações da Unimed Criciúma.</P>

      <H>III – DEFINIÇÕES</H>
      <P>Caso tenha alguma dúvida sobre os termos utilizados nesta Política, sugerimos consultar a tabela abaixo:</P>
      <UL>
        <li><strong>Dado pessoal:</strong> Qualquer informação relacionada a pessoa natural, direta ou indiretamente, identificada ou identificável.</li>
        <li><strong>Dado pessoal sensível:</strong> Categoria especial de dados pessoais referentes à origem racial ou étnica, convicção religiosa, opinião política, filiação a sindicato ou à organização de caráter religioso, filosófico ou político, referentes à saúde ou à vida sexual, dados genéticos ou biométricos relativos à pessoa natural.</li>
        <li><strong>Titular:</strong> Pessoa natural a quem se referem os dados pessoais, tais como antigos, presentes ou potenciais clientes, colaboradores, contratados, parceiros comerciais e terceiros.</li>
        <li><strong>Tratamento:</strong> Toda operação realizada com dados pessoais, como as que se referem a coleta, produção, recepção, classificação, utilização, acesso, reprodução, transmissão, distribuição, processamento, arquivamento, armazenamento, eliminação, avaliação ou controle da informação, modificação, comunicação, transferência, difusão ou extração.</li>
        <li><strong>Anonimização:</strong> Processo por meio do qual o dado perde a possibilidade de associação, direta ou indireta, a um indivíduo, considerados os meios técnicos razoáveis e disponíveis no momento do tratamento.</li>
        <li><strong>Cookies:</strong> Arquivos enviados pelo servidor dos sites e APP para o computador e aparelhos celulares dos Titulares/Usuários, com a finalidade de identificá-lo e obter os dados de acesso, como páginas navegadas ou links clicados, permitindo, desta forma, personalizar a navegação dos Usuários no Site, de acordo com o seu perfil.</li>
        <li><strong>IP Abreviatura de Internet Protocol:</strong> É um conjunto de números que identifica o computador dos Titulares/Usuários na Internet.</li>
        <li><strong>Logs:</strong> Registros de atividades dos Titulares/Usuários efetuadas nos sites e APP Unimed Criciúma.</li>
        <li><strong>Site/Portal:</strong> Designa o endereço eletrônico https://www.unimedcriciuma.com.br e seus subdomínios.</li>
        <li><strong>Usuário:</strong> Pessoas que acessam os sites da Unimed Criciúma ou APP Unimed Criciúma e/ou interagem com as atividades nele oferecidas.</li>
        <li><strong>Aplicativo (APP):</strong> Um aplicativo (app) é um software projetado para executar tarefas específicas em dispositivos como smartphones, tablets e computadores.</li>
      </UL>

      <H>IV – QUAIS DADOS UTILIZAMOS</H>
      <P>A Unimed Criciúma poderá coletar as informações inseridas ativamente pelo Titular no momento de seu contato ou de seu cadastro e, ainda, informações coletadas automaticamente quando da utilização dos serviços disponíveis em nosso portal, da rede e APP Unimed Criciúma, como, por exemplo, identificação do estabelecimento comercial utilizado, IP com data e hora da conexão, entre outras.</P>
      <P>Há, assim, o tratamento de dois tipos de dados pessoais:</P>
      <P>a) Aqueles fornecidos pelo próprio Titular;<br />b) Aqueles coletados automaticamente.</P>
      <P>Neste sentido, dispõe as seguintes informações detalhadas:</P>
      <P><strong>a) Dados pessoais fornecidos pelo Titular:</strong> a Unimed Criciúma coleta todos os dados pessoais inseridos ou encaminhadas ativamente pelo Titular ao entrar em contato ou acessar os portais da Unimed Criciúma e APP Unimed Criciúma, tais como nome completo, e-mail, gênero, data de nascimento, cidade e Estado, quando do preenchimento de formulários nos serviços, pelo Titular. Independentemente de quais dados o Titular fornecer ativamente à Unimed Criciúma, nós apenas faremos uso daqueles efetivamente relevantes e necessários para o atingimento das finalidades a ele declaradas, caso a caso. Os dados coletados variam de acordo com o tipo de serviço em que você está cadastrado.</P>
      <P><strong>b) Dados pessoais fornecidos por terceiros:</strong> A Unimed Criciúma recebe dados pessoais de terceiros, sejam parceiros e prestadores de serviços, relacionados a você. Os dados recebidos de tais fontes, possibilitam que a Unimed Criciúma preste os seus serviços a você.</P>
      <P><strong>c) Dados coletados automaticamente:</strong> a Unimed Criciúma também coleta uma série de informações de modo automático, tais como: características do dispositivo de acesso, do navegador, IP (com data e hora), origem do IP, informações sobre cliques, páginas acessadas, termos de procura digitados em nossos portais, dentre outras. Para tal coleta, fará uso de algumas tecnologias padrões, como cookies, pixel tags, beacons e local shared objects, que são utilizadas com o propósito de melhorar a experiência de navegação do Titular nos serviços, de acordo com seus hábitos e suas preferências.</P>
      <P><strong>d) Dados para agendamento de consultas e/ou exames:</strong> São coletados os seguintes dados, como nome, CPF/MF, telefone, dados do plano de saúde, dados do médico, tipo de exame, dados clínicos.</P>
      <P><strong>e) Contratação:</strong> São coletados os seguintes dados, como nome, RG, CPF/MF, telefone, endereço, declaração pessoal de saúde com dados de saúde como doenças pré-existentes.</P>
      <P><strong>f) Cadastro para atendimento domiciliar:</strong> São coletados os seguintes dados, como nome, endereço, idade, telefone, sexo, CPF/MF, RG, número do cartão, diagnóstico, estado civil, profissão, ocupação, data de nascimento, nome da mãe, tipo de moradia, questões sócio econômicas, situação trabalhista.</P>
      <P><strong>g) Pesquisas:</strong> São coletados os seguintes dados, como nome, CPF/MF, dados do prontuário.</P>
      <P><strong>h) Dados para auditorias e qualificações:</strong> São coletados os dados necessários aos itens avaliados nos quesitos formulados, neste sentido, pode haver a coleta de dados pessoais e sensíveis, a depender do tipo de auditoria e qualificação realizada.</P>
      <P>É possível desabilitar, por meio das configurações de seu navegador de internet, a coleta automática de informações por meio de algumas tecnologias, como cookies e caches, bem como em nosso próprio website, conforme item VI. No entanto, o Titular deve estar ciente de que, se desabilitadas essas tecnologias, alguns recursos oferecidos pelos sites ou APP Unimed Criciúma, que dependem do tratamento dos referidos dados, poderão não funcionar corretamente.</P>
      <P>O Titular poderá acessar, atualizar e complementar seus dados, bem como solicitar a exclusão dos seus dados coletados pela Unimed Criciúma, pelo e-mail: {EMAIL}.</P>
      <P>A Unimed Criciúma não trata, para as finalidades específicas aqui dispostas, os seguintes dados considerados sensíveis pela Lei nº 13.709/2019: aqueles relacionados à origem racial ou étnica, convicção religiosa, opinião política, filiação a sindicato ou à organização de caráter religioso, filosófico ou político ou à vida sexual.</P>

      <H>V. COMO UTILIZAMOS OS DADOS</H>
      <P>Os dados pessoais tratados pela Unimed Criciúma têm como finalidade predominante o estabelecimento de vínculo contratual ou a gestão, administração, prestação, ampliação e o melhoramento dos serviços ao Titular, adequando-as às suas preferências e aos seus gostos, bem como a criação de novos serviços e produtos a serem oferecidos.</P>
      <P>A Unimed Criciúma, em alguns casos, trata os dados pessoais que são coletados para viabilizar a prestação de serviço assistencial junto as demais Unimeds, respeitadas as finalidades ora dispostas e/ou consentimento do Titular, sempre que exigido por lei. A Unimed Criciúma, em alguns casos, também pode tratar dados pessoais quando necessários para o cumprimento de obrigação legal ou regulatória.</P>
      <P>Além disso, a Unimed Criciúma também poderá tratar dados pessoais com base em seu interesse legítimo (ou no interesse legítimo de outra Unimed), sempre no limite do quanto é esperado pelo Titular, e nunca em prejuízo aos seus interesses, direitos e liberdades fundamentais.</P>
      <P>Adicionalmente, as informações coletadas poderão, mediante o consentimento do Titular, serem utilizadas para a realização de pesquisas relacionadas às suas atividades.</P>

      <H>VI. O QUE SÃO E COMO UTILIZAMOS OS COOKIES</H>
      <P>Cookies são arquivos ou informações que podem ser armazenadas em seus dispositivos quando você visita os websites, aplicativos ou utiliza os serviços on-line da Unimed Criciúma. Geralmente, contém o nome do site ou aplicativo que o originou, seu tempo de vida e um valor, que é gerado aleatoriamente.</P>
      <P>A Unimed Criciúma utiliza cookies para facilitar o uso e adaptar melhor suas páginas aos interesses e às necessidades dos Titulares, bem como para compilar informações sobre a utilização de seus sites, APP e serviços, auxiliando a melhorar suas estruturas e seus conteúdos. Eles também podem ser utilizados para acelerar as suas atividades e experiências futuras em nosso portal e aplicativo.</P>
      <P>Neste sentido, os cookies podem ser classificados como:</P>
      <UL>
        <li><strong>Necessários:</strong> São essenciais para que as páginas da Unimed Criciúma carreguem corretamente e permitam que você navegue em nossos sites e APP e faça uso de todas as funcionalidades.</li>
        <li><strong>Desempenho:</strong> Nos ajudam a entender como os visitantes interagem com as páginas da Unimed Criciúma, fornecendo informações sobre as áreas visitadas, o tempo de visita ao site, ao APP e quaisquer problemas encontrados, como mensagens de erro.</li>
        <li><strong>Funcionais:</strong> Permitem que as páginas da Unimed Criciúma lembrem de suas escolhas, para proporcionar uma experiência mais personalizada. Também, possibilitam que os Titulares assistam a vídeos e utilizem ferramentas sociais, campos para comentários, fóruns, entre outros.</li>
        <li><strong>Marketing:</strong> São utilizados para fornecer mais conteúdo relevante e do interesse dos Titulares. Podem ser utilizados para apresentar publicidade mais direcionada ou limitar o número que esta é veiculada, nas páginas da Unimed Criciúma. Também, permitem a medição da eficácia de uma campanha publicitária da Unimed Criciúma.</li>
      </UL>
      <P>Ainda, podem ser utilizados para indicar as páginas dos sites da Unimed Criciúma que o Titular visitou e a Unimed Criciúma pode compartilhar essas informações com terceiros, tais como agências publicitárias contratadas.</P>
      <P>Ao acessar, pela primeira vez, o Portal da Unimed Criciúma, você nos informou as suas preferências para a utilização destas ferramentas. Caso queira revisitar a autorização concedida, entre em contato via e-mail: {EMAIL}.</P>
      <P>Para toda a coleta de dados pessoais, a Unimed Criciúma sempre seguirá as seguintes regras:</P>
      <UL>
        <li>Apenas serão coletadas informações imprescindíveis para a prestação dos serviços oferecidos.</li>
        <li>Caso seja necessária à coleta de demais dados pessoais, tomaremos o devido cuidado de coletar a sua autorização para tanto ou avisá-lo sobre tal ação.</li>
        <li>Qualquer autorização que coletarmos de você será acompanhada do devido grau de informação.</li>
        <li>Os dados pessoais coletados somente serão utilizados para cumprir com as finalidades informadas a você.</li>
      </UL>
      <P>Após o Titular autorizar a utilização, quando do uso das páginas da Unimed Criciúma, será armazenado um cookie em seu dispositivo para lembrá-lo na próxima sessão.</P>
      <P>A qualquer momento, o Titular poderá revogar seu consentimento quanto aos cookies, devendo apagá-los das páginas da Unimed Criciúma, utilizando as configurações de seu navegador de preferência.</P>
      <P>Por fim, lembramos que, caso o Titular não aceite alguns cookies das páginas da Unimed Criciúma, certos serviços poderão não funcionar de maneira ideal.</P>

      <H>VII. COMO UTILIZAMOS OS SEUS DADOS PESSOAIS</H>
      <P>Dados pessoais são tratados pela Unimed Criciúma para diversas finalidades. Abaixo apresentamos as principais hipóteses em que trataremos as suas informações:</P>
      <P>Para a execução de contratos ou diligências preliminares, como:</P>
      <UL>
        <li>Gestão, administração, prestação, ampliação e melhoramento dos Serviços oferecidos ao Titular;</li>
        <li>Para o relacionamento e oferecimento de informações relacionadas aos produtos e serviços contratados pelos clientes da Unimed Criciúma;</li>
        <li>Para avaliar se é possível o oferecimento de determinados produtos ou serviços e sob quais condições.</li>
        <li>
          Caso a Unimed Criciúma tenha que cumprir alguma obrigação legal ou regulatória, como:
          <ul className="list-[circle] pl-6 space-y-1 mt-1">
            <li>Guarda de prontuário médico pelo período de 20 (vinte anos) a partir do último registro, conforme artigo 6º da Lei nº 13.787/2018;</li>
            <li>Notificação compulsória em caso de suspeita de maus tratos de crianças, conforme artigo 13 do Estatuto da Criança e Adolescente;</li>
            <li>Coleta de consentimento do paciente para realização de procedimento médico indicando os riscos inerentes ao referido procedimento, conforme artigo 22 do Código de Ética Médica;</li>
            <li>Compartilhamento de dados com o Ministério da Saúde para formação do conjunto mínimo de dados, consoante artigo 47 da Lei nº 8.080/1990 e artigo 4º do Decreto 29/2017;</li>
            <li>Notificação compulsória de doenças, conforme Lei nº 6.259/1975.</li>
            <li>Guarda de registro de acesso ao WiFi de Unidades Hospitalares e Laboratoriais, conforme artigo 13 do Marco Civil da Internet.</li>
          </ul>
        </li>
        <li>
          Para a tutela da saúde, em procedimentos que, pelas suas particularidades, dispensam a coleta de consentimento:
          <ul className="list-[circle] pl-6 space-y-1 mt-1">
            <li>Como por exemplo, nos casos de consultas médicas em que são coletados dados como altura, peso, hábitos alimentares, pressão arterial entre outras informações.</li>
          </ul>
        </li>
        <li>Na persecução do interesse legítimo da Unimed Criciúma, sempre no limite de sua expectativa, e nunca em prejuízo de seus interesses, direitos e liberdades fundamentais.</li>
        <li>
          Para a condução de atividades que visam prevenir a ocorrência de fraudes, como:
          <ul className="list-[circle] pl-6 space-y-1 mt-1">
            <li>A condução de investigações internas, quando houver o envolvimento de dados pessoais sensíveis.</li>
          </ul>
        </li>
        <li>Por meio de autorização concedida por você.</li>
        <li>Para defesa dos direitos da Cooperativa.</li>
      </UL>

      <H>VIII. COM QUEM COMPARTILHAMOS OS DADOS</H>
      <P>A Unimed Criciúma trabalha em parceria com diversas empresas no Brasil. Desse modo, poderá compartilhar as informações coletadas nas seguintes hipóteses:</P>
      <UL>
        <li>Com outras Unimeds, constituídas ou atuantes em qualquer Estado do Brasil, por meio do Sistema de Intercâmbio.</li>
        <li>Com empresas parceiras e fornecedores, na prestação dos serviços voltados ao Titular.</li>
        <li>Com autoridades, entidades governamentais ou outros terceiros, para a proteção dos interesses da Unimed Criciúma em qualquer tipo de conflito, incluindo ações judiciais e processos administrativos.</li>
        <li>No caso de transações e alterações societárias envolvendo a Unimed Criciúma, hipótese em que a transferência das informações será necessária para a continuidade dos serviços.</li>
        <li>Com provedores de computação em nuvem (Transferência Internacional): Para fins de armazenamento seguro em servidores de infraestrutura em nuvem (cloud computing) que cumprem com os padrões legais de proteção de dados.</li>
        <li>Mediante ordem judicial ou pelo requerimento de autoridades administrativas que detenham competência legal para a sua requisição.</li>
      </UL>
      <P>Adicionalmente, é possível que algumas das transferências indicadas acima ocorram para fora do Brasil, ocasião em que a Unimed Criciúma se compromete a fazê-lo somente para países que proporcionem grau de proteção de dados pessoais adequado ao previsto na lei aplicável; ou mediante a utilização de garantias e salvaguardas como cláusulas específicas, cláusulas-padrão, normas corporativas globais, entre outras ou a observância das demais hipóteses autorizadas por lei.</P>

      <H>IX. COMO MANTEMOS OS DADOS SEGUROS</H>
      <P>A Unimed Criciúma utiliza os meios razoáveis de mercado e legalmente requeridos para preservar a privacidade dos dados pessoais que coleta. Dessa forma, adota diversas precauções, em observância às diretrizes sobre padrões de segurança, tais como:</P>
      <UL>
        <li>A Unimed Criciúma utiliza os métodos padrão e de mercado para criptografar e anonimizar os dados coletados.</li>
        <li>A Unimed Criciúma possui proteção contra acesso não autorizado a seus sistemas.</li>
        <li>A Unimed Criciúma somente autoriza o acesso aos dados por pessoas devidamente qualificadas e com finalidade específica.</li>
        <li>Aqueles que entram em contato com dados pessoais devem se comprometer a manter sigilo absoluto. A quebra do sigilo acarretará responsabilidade civil, bem como responsabilização nos moldes da legislação brasileira.</li>
        <li>Garantia para que agentes, funcionários internos ou parceiros externos que realizarem o tratamento de dados pessoais deverão se comprometer a manter o sigilo absoluto das informações, adotando as melhores práticas para manuseio destes dados, conforme determinado nas políticas e procedimentos corporativos.</li>
        <li>Manutenção do inventário indicando momento, duração, identidade do funcionário, ou do responsável pelo acesso, e o arquivo objeto, com base nos registros de conexão e de acesso a aplicações, conforme determinado no artigo 13 do Decreto nº 8.771/2016.</li>
      </UL>
      <P>Além dos esforços técnicos, a Unimed Criciúma também adota medidas institucionais visando a proteção de dados pessoais, de modo que mantém uma estrutura e um programa de governança em privacidade aplicado às suas atividades e estrutura de governança, constantemente atualizados e gerido pelo Encarregado pela Proteção de dados Pessoais.</P>
      <P>Embora adote os melhores esforços no sentido de preservar a privacidade e proteger os dados dos Titulares, nenhuma transmissão de informações é totalmente segura, estando sempre suscetíveis a ocorrência de falhas técnicas, vírus ou ações similares, de modo que a Unimed Criciúma não pode garantir integralmente que todos os dados que recebe ou envia não sejam alvo de acessos não autorizados perpetrados por meio de métodos desenvolvidos para obter informações de forma indevida. Por esse motivo, nós incentivamos os Titulares a tomarem as medidas apropriadas para se proteger, como, por exemplo, mantendo confidenciais todos os nomes de Titular e senhas, sendo certo que tais informações são pessoais, intransferíveis e de exclusiva responsabilidade dos Titulares.</P>
      <P>De qualquer forma, na remota hipótese de incidência de episódios desta natureza, a Unimed Criciúma garante o pleno esforço para remediar as consequências do evento, sempre garantindo a devida transparência a você.</P>

      <H>X. RETENÇÃO DAS INFORMAÇÕES COLETADAS</H>
      <P>Visando proteger a privacidade dos Titulares, os dados pessoais tratados pela Unimed Criciúma serão automaticamente eliminados quando deixarem de ser úteis para os fins para os quais foram coletados, ou quando o Titular solicitar sua eliminação, exceto se a sua manutenção for expressamente autorizada por lei ou regulação aplicável.</P>
      <P>Contudo, as informações poderão ser conservadas para o cumprimento de obrigação legal ou regulatória, transferência a terceiro – desde que respeitados os requisitos de tratamento de dados – e uso exclusivo da Unimed Criciúma, inclusive para o exercício de seus direitos em processos judiciais ou administrativos.</P>

      <H>XI. DIREITOS DOS TITULARES DE DADOS</H>
      <P>Em cumprimento à regulamentação aplicável, no que diz respeito ao tratamento de dados pessoais, a Unimed Criciúma, enquanto Controladora de seus dados pessoais, respeita e garante ao Titular a possibilidade de apresentação de solicitações baseadas nos seguintes direitos:</P>
      <UL>
        <li>A confirmação da existência de tratamento;</li>
        <li>O acesso aos dados;</li>
        <li>A correção de dados incompletos, inexatos ou desatualizados;</li>
        <li>Anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade;</li>
        <li>A portabilidade de seus dados a outro fornecedor de serviços ou produtos, mediante requisição expressa pelo Titular;</li>
        <li>A eliminação dos dados tratados com consentimento do Titular;</li>
        <li>A obtenção de informações sobre as entidades públicas ou privadas com as quais a Unimed Criciúma compartilhou seus dados;</li>
        <li>A informação sobre a possibilidade de não fornecer o seu consentimento, bem como de ser informado sobre as consequências, em caso de negativa;</li>
        <li>A revogação do consentimento;</li>
      </UL>
      <P>Neste ponto, todas as requisições serão:</P>
      <UL>
        <li>Oportunizadas de forma gratuita;</li>
        <li>Submetidas a uma forma de validação de sua identidade (a fim de que a Unimed Criciúma direcione o atendimento de requisições, exclusivamente ao titular dos dados).</li>
      </UL>
      <P>Parte desses direitos poderá ser exercida diretamente pelo Titular, a partir da gestão de informações sobre a sua conta, enquanto outra parte dependerá do envio de requisição para nosso Encarregado de Proteção de Dados via e-mail: {EMAIL}.</P>
      <P>A Unimed Criciúma ressalta a possibilidade da sua requisição ser legalmente rejeitada, seja por motivos formais (a exemplo de impossibilidade de comprovação da sua identidade) ou legais (a exemplo do pedido de exclusão de dados cuja manutenção é livre exercício de direito pela Unimed Criciúma), sendo certo que, na hipótese de impossibilidade de atendimento destas requisições, a Unimed Criciúma apresentará a você, as justificativas razoáveis.</P>
      <P>O Titular fica ciente de que a exclusão das informações essenciais para gestão de sua conta junto à Unimed Criciúma implicará no término de seu cadastro, com consequente cancelamento dos serviços então prestados.</P>
      <P>A Unimed Criciúma empreenderá todos os esforços para atender aos pedidos no menor espaço de tempo possível, no entanto, fatores justificáveis, tais como a complexidade da ação requisitada, poderão atrasar ou impedir seu rápido atendimento. Por fim, o Titular deve estar ciente que a sua requisição poderá ser legalmente rejeitada, seja por motivos formais (a exemplo de sua incapacidade de comprovar sua identidade) ou legais (a exemplo do pedido de exclusão de dados cuja manutenção é livre exercício de direito pela Unimed Criciúma).</P>

      <H>XII. OBRIGAÇÕES E RESTRIÇÕES</H>
      <P>Visando proteger os Direitos Autorais e as funcionalidades dos sites e APP Unimed Criciúma, deverão ser respeitadas as seguintes obrigações e restrições:</P>
      <UL>
        <li>Não é permitido aos visitantes e usuários acessarem as áreas de programação, seu banco de dados ou qualquer outro conjunto de informações que faça parte dos sites da Unimed Criciúma e também do APP Unimed Criciúma, ficando sujeito quem o fizer à legislação penal brasileira e obrigados a reparar os danos que causarem;</li>
        <li>Não é permitido realizar ou permitir engenharia reversa, nem traduzir, descompilar, copiar, modificar, reproduzir, alugar, sublicenciar, publicar, divulgar, transmitir, emprestar, distribuir ou, de outra maneira, dispor das ferramentas de consulta dos sites da Unimed Criciúma e também do APP Unimed Criciúma e de suas funcionalidades;</li>
        <li>É proibida a utilização de aplicativos spider, ou de mineração de dados, de qualquer tipo ou espécie, além de outro aqui não tipificado, mas que atue de modo automatizado, tanto para realizar operações massificadas ou para quaisquer outras finalidades, sob pena de aplicação da legislação penal brasileira e de reparar os danos que decorrerem desta utilização;</li>
        <li>Os sites da Unimed Criciúma e também do APP Unimed Criciúma foram desenvolvidos para a utilização de seres humanos com a finalidade de obterem informações e detalhes sobre os planos médicos da Unimed Criciúma;</li>
        <li>É ônus dos visitantes e usuários arcar com os meios necessários para navegar e utilizar os sites da Unimed Criciúma e também o APP Unimed Criciúma, incluindo os requisitos para o acesso à Internet;</li>
        <li>Os visitantes e usuários se obrigam a realizar uma navegação e utilização com retidão ética, sempre respeitando as condições que regem a utilização dos sites da Unimed Criciúma e APP Unimed Criciúma;</li>
        <li>Ao fornecerem dados e informações, o visitante e usuário se obrigam a fazê-lo sempre com compromisso de veracidade e autenticidade, sob pena da aplicação das penas da lei, de indenizar a quem causar dano e de ter as contas excluídas;</li>
        <li>Na incidência de danos dos sites da Unimed Criciúma, ao APP Unimed Criciúma ou a terceiros, o responsável se compromete a arcar com todas as obrigações de indenizar o sujeito lesado, não devendo a Unimed Criciúma responder por tais prejuízos;</li>
        <li>Os visitantes e usuários devem utilizar os recursos dos sites da Unimed Criciúma e também do APP Unimed Criciúma para as finalidades para as quais foram constituídos, sob pena da aplicação das penas da lei, de indenizarem a quem causarem dano e de terem a conta de acesso dos sites e APP excluída;</li>
        <li>Os visitantes e usuários devem manter o sigilo dos dados de sua conta de acesso em relação a terceiros, não divulgando ou compartilhando sua senha a quem quer que seja, sob pena da exclusão da conta, de ter o contrato de licença rescindido e de ressarcir os danos que sobrevierem dessa divulgação indevida;</li>
        <li>O uso comercial da expressão Unimed Criciúma, nomes empresariais ou nomes de domínio, além dos conteúdos das páginas dos sites e APP, assim como os programas, bancos de dados, redes e seus arquivos são de propriedade da Unimed Criciúma e estão protegidos pelas leis e tratados internacionais de direito autoral, marcas, patentes, modelos e desenhos industriais;</li>
        <li>Ao acessar os sites e o APP Unimed Criciúma, os visitantes e usuários declaram que respeitarão todos os direitos de propriedade intelectual e os decorrentes da proteção de marcas, patentes e/ou desenhos industriais, depositados ou registrados em nome da Unimed Criciúma, bem como de todos os direitos referentes a terceiros que porventura estejam, ou estiveram, de alguma forma, disponíveis nos sites e APP. O simples acesso aos sites e APP não confere a este qualquer direito ao uso dos nomes, títulos, palavras, frases, marcas, patentes, obras literárias, artísticas, lítero-musicais, imagens, dados e informações, dentre outras, que nele estejam ou estiveram disponíveis;</li>
        <li>A reprodução dos conteúdos descritos anteriormente está proibida, salvo com prévia autorização por escrito da Unimed Criciúma ou caso se destinem ao uso exclusivamente pessoal e sem que em nenhuma circunstância os visitantes e usuários adquiram qualquer direito sobre os mesmos;</li>
        <li>É permitido fazer somente o arquivo temporário dos sites da Unimed Criciúma, APP Unimed Criciúma e de seu conteúdo, sendo vedada sua utilização para finalidades comerciais, publicitárias ou qualquer outra que contrarie a realidade para o qual foi concebido, conforme definido neste documento.</li>
      </UL>
      <P>Restam igualmente proibidas a reprodução, distribuição e divulgação, total ou parcial, dos textos, figuras, gráficos que compõem os sites da Unimed Criciúma e APP Unimed Criciúma, sem prévia e expressa autorização da Unimed Criciúma, sendo permitida somente a impressão de cópias para uso e arquivo pessoal, sem que sejam separadas as partes que permitam dar o fiel e real entendimento de seu conteúdo e objetivo;</P>
      <UL>
        <li>Os visitantes e usuários assumem toda e qualquer responsabilidade, de caráter civil e/ou criminal, pela utilização indevida das informações, textos, gráficos, marcas, obras, imagens, enfim, de todo e qualquer direito de propriedade intelectual ou industrial dos sites da Unimed Criciúma e APP Unimed Criciúma;</li>
        <li>Qualquer outro tipo de utilização de material autorizado, inclusive para fins editoriais, comerciais ou publicitários, só poderá ser feito mediante prévio e expresso consentimento da Unimed Criciúma. Os visitantes e usuários estão cientes, através deste item, que o uso comercial não autorizado poderá incorrer em infrações cíveis e criminais, por estar infringindo a lei dos direitos autorais.</li>
        <li>Qualquer reutilização do material autorizado deverá ser objeto de uma nova autorização da Unimed Criciúma;</li>
        <li>A autorização para utilização do material solicitado não poderá ser transferida a terceiros, mesmo que vinculados ao sujeito autorizado por alguma razão;</li>
        <li>Qualquer utilização não contemplada na mencionada autorização será considerada como uma violação dos direitos de autor e sujeita às sanções cabíveis na Lei nº 9.610, de 19 de fevereiro de 1998, que protege os direitos autorais no Brasil;</li>
        <li>A utilização das funcionalidades oferecidas se dará na forma de prestação de serviço, não conferindo ao visitante ou ao usuário nenhum direito sobre o software utilizado pela Unimed Criciúma ou de suas estruturas de informática que sustentam as aplicações de internet;</li>
        <li>A eventual retirada de qualquer conteúdo ou funcionalidade dos sites da Unimed Criciúma e APP Unimed Criciúma, em decorrência de alguma reclamação, deverá ser sempre compreendida como uma demonstração de nossa intenção de evitar dissabores e, jamais, como reconhecimento de culpa ou de qualquer infração pela Unimed Criciúma a direito de terceiros;</li>
        <li>Caso o visitante ou usuário enviar conteúdo para a Unimed Criciúma por meio dos sites, do APP Unimed Criciúma ou pelos canais divulgados que diga respeito a ideias para novos produtos, ou melhorias nos já existentes, campanhas publicitárias ou qualquer outra ação de marketing, elas deixarão de pertencer ao patrimônio imaterial do visitante, ingressando na Unimed Criciúma, nada podendo reclamar neste sentido, sobretudo recompensa pecuniária pelo que foi enviado ou revisão nos modelos usados;</li>
        <li>O acesso a algumas funcionalidades dos sites da Unimed Criciúma e também do APP Unimed Criciúma está condicionado ao cadastramento do visitante para abertura de uma conta de acesso;</li>
        <li>As contas de acesso que forem excluídas sob motivo de irregularidade ou por desrespeito às regras contidas na Política de Privacidade não estarão sujeitas a qualquer espécie de indenização;</li>
        <li>Os presentes Termos de Uso e Condições de Navegação estão sujeitos a constante melhoria e aprimoramento. Assim, a Unimed Criciúma se reserva o direito de modificar a qualquer momento, de forma unilateral, o presente documento e sua Política de Privacidade;</li>
        <li>Ao navegar pelos sites da Unimed Criciúma e também do APP Unimed Criciúma e utilizar suas funcionalidades, você aceita guiar-se pela Política de Privacidade que se encontra vigente na data e, portanto, deve verificar as mesmas cada vez que visitar os sites e APP Unimed Criciúma;</li>
        <li>A tolerância do eventual descumprimento de quaisquer das cláusulas e condições do presente instrumento não constituirá novação das obrigações aqui estipuladas e tampouco impedirá ou inibirá a exigibilidade das mesmas a qualquer tempo;</li>
        <li>Os sites e APP Unimed Criciúma têm como base o horário oficial de Brasília.</li>
      </UL>

      <H>XIII. LEGISLAÇÃO E FORO</H>
      <P>Esta Política será regida, interpretada e executada de acordo com as leis da República Federativa do Brasil, especialmente a Lei nº 13.709/2018, independentemente das leis de outros Estados ou países, sendo competente o foro de domicílio do Titular para dirimir qualquer dúvida decorrente deste documento.</P>
      <P>A Unimed Criciúma poderá atualizar este documento a qualquer momento. O uso continuado das plataformas e serviços após a publicação das alterações constitui concordância com os novos Termos de Uso e Política de Privacidade.</P>
    </div>
  );
}
