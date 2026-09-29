import { Link } from 'react-router-dom';

// Texto da Política de Privacidade — fonte única da página e do modal de aceite.
// Mudou o texto? Atualize PRIVACY_POLICY_VERSION (src/lib/privacyPolicy.ts) para todos aceitarem de novo.
export default function PoliticaTexto() {
  return (
    <div className="text-gray-700">
      <p className="mb-6">
        Esta política descreve como o Portal Integrado da Rede de Prestadores trata dados pessoais,
        em conformidade com a LGPD (Lei 13.709/2018).
      </p>

      <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">Dados que coletamos</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>Nome, e-mail e papel do usuário com acesso ao portal.</li>
        <li>Dados de prestador/cooperado vindos do SGU (CPF/CNPJ, registro de conselho, endereços de atendimento).</li>
        <li>Trilha de acessos pseudonimizada (data, ação, hash do IP truncado).</li>
      </ul>

      <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">Finalidades e base legal</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li><strong>Execução de contrato</strong> — operação do portal de qualificação da rede.</li>
        <li><strong>Cumprimento de obrigação legal</strong> — RN ANS 630/2024 e LGPD.</li>
        <li><strong>Legítimo interesse</strong> — segurança e prevenção a fraude (trilha de acessos).</li>
      </ul>

      <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">Retenção</h2>
      <p>
        Logs de login são retidos por até 180 dias; eventos administrativos por até 5 anos.
        Após o prazo, são expurgados automaticamente.
      </p>

      <h2 className="text-lg font-semibold text-gray-900 mt-6 mb-2">Direitos do titular</h2>
      <p>
        Para exercer seus direitos (acesso, correção, eliminação, portabilidade), acesse{' '}
        <Link to="/meus-dados" className="text-[#00995D] hover:underline">Meus dados</Link>.
      </p>
    </div>
  );
}
