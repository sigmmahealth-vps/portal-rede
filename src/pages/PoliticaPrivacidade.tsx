import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export default function PoliticaPrivacidade() {
  const [dpo, setDpo] = useState<{ name: string; email: string | null } | null>(null);
  useEffect(() => { fetch('/api/privacy/dpo').then(r => r.json()).then(setDpo); }, []);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Política de Privacidade</h1>
      <p className="text-gray-700 mb-6">
        Esta política descreve como o Portal Integrado da Rede de Prestadores trata dados pessoais,
        em conformidade com a LGPD (Lei 13.709/2018).
      </p>

      <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">Dados que coletamos</h2>
      <ul className="list-disc pl-6 text-gray-700 space-y-1">
        <li>Nome, e-mail e papel do usuário com acesso ao portal.</li>
        <li>Dados de prestador/cooperado vindos do SGU (CPF/CNPJ, registro de conselho, endereços de atendimento).</li>
        <li>Trilha de acessos pseudonimizada (data, ação, hash do IP truncado).</li>
      </ul>

      <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">Finalidades e base legal</h2>
      <ul className="list-disc pl-6 text-gray-700 space-y-1">
        <li><strong>Execução de contrato</strong> — operação do portal de qualificação da rede.</li>
        <li><strong>Cumprimento de obrigação legal</strong> — RN ANS 630/2024 e LGPD.</li>
        <li><strong>Legítimo interesse</strong> — segurança e prevenção a fraude (trilha de acessos).</li>
      </ul>

      <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">Retenção</h2>
      <p className="text-gray-700">
        Logs de login são retidos por até 180 dias; eventos administrativos por até 5 anos.
        Após o prazo, são expurgados automaticamente.
      </p>

      <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">Direitos do titular</h2>
      <p className="text-gray-700">
        Para exercer seus direitos (acesso, correção, eliminação, portabilidade), acesse{' '}
        <Link to="/meus-dados" className="text-blue-600 hover:underline">Meus dados</Link> ou contate o encarregado abaixo.
      </p>

      <h2 className="text-xl font-semibold text-gray-900 mt-8 mb-3">Encarregado pelo Tratamento de Dados (DPO)</h2>
      {dpo ? (
        <p className="text-gray-700">
          <strong>{dpo.name}</strong>
          {dpo.email && <> — <a href={`mailto:${dpo.email}`} className="text-blue-600 hover:underline">{dpo.email}</a></>}
        </p>
      ) : <p className="text-gray-500">Carregando…</p>}

      <div className="mt-12">
        <Link to="/login" className="text-sm text-blue-600 hover:underline">← Voltar para o login</Link>
      </div>
    </main>
  );
}
