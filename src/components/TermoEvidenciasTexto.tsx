import { TERMO_EVIDENCIAS_TITULO, TERMO_EVIDENCIAS_PARAGRAFOS } from '../lib/termoEvidencias';

// Corpo do Termo de Ciência (spec 2026-09-29) — texto vem da lib, mesma fonte do snapshot gravado.
export default function TermoEvidenciasTexto() {
  return (
    <div className="text-sm leading-relaxed text-gray-700">
      <h2 className="mb-4 text-lg font-bold text-secondary-900">{TERMO_EVIDENCIAS_TITULO}</h2>
      <div className="space-y-3">
        {TERMO_EVIDENCIAS_PARAGRAFOS.map((p, i) => <p key={i}>{p}</p>)}
      </div>
    </div>
  );
}
