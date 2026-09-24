// Selo exibido na barra lateral: só o de certificado VIGENTE (valid_until >= hoje).
// Sem certificado ou com todos vencidos → null ("SEM SELO"). Com mais de um vigente
// (várias unidades/ciclos), vale o emitido mais recentemente.
export interface CertLike { seal?: string | null; valid_until?: string | null; issued_at?: string | null }

export function currentCertificate<T extends CertLike>(certs: T[], today: string = new Date().toISOString().slice(0, 10)): T | null {
  const vigentes = (certs || []).filter(c => c.seal && c.valid_until && String(c.valid_until).slice(0, 10) >= today);
  if (!vigentes.length) return null;
  return vigentes.reduce((a, b) => (String(b.issued_at ?? '') > String(a.issued_at ?? '') ? b : a));
}
