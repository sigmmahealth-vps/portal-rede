import PoliticaTexto from '../components/PoliticaTexto';

// Dentro do sistema (só logado) — spec 2026-09-29; saiu da tela de login.
export default function PoliticaPrivacidade() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 sm:p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Política de Privacidade</h1>
      <PoliticaTexto />
    </div>
  );
}
