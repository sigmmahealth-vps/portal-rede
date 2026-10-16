// Coerência ciclo × certificado (2026-10-16): ciclo encerrado — ou com a data fim já
// passada — não emite certificado, e certificado não nasce vencido. Datas 'AAAA-MM-DD'.

const br = (d: string) => d.slice(0, 10).split('-').reverse().join('/');

export interface CycleForParecer { active: boolean; end_date: string | null; cert_valid_until: string | null }

// Motivo para recusar o parecer final (que emite o certificado), ou null se pode emitir.
export function parecerBlock(c: CycleForParecer, today: string): string | null {
  if (!c.active) return 'Ciclo encerrado — não é possível emitir parecer nem certificado.';
  if (c.end_date && c.end_date.slice(0, 10) < today) {
    return `O prazo do ciclo terminou em ${br(c.end_date)} — não é possível emitir parecer nem certificado. `
      + 'Para continuar as análises, o administrador precisa prorrogar o ciclo (Editar ciclo → data fim).';
  }
  if (!c.cert_valid_until) return 'Ciclo sem data de validade de certificado definida.';
  if (c.cert_valid_until.slice(0, 10) < today) {
    return `A validade dos certificados deste ciclo (${br(c.cert_valid_until)}) já passou — o certificado nasceria vencido. `
      + 'Peça ao administrador para ajustar a validade em Ciclos (Editar ciclo) e emita o parecer em seguida.';
  }
  return null;
}

// Validade e fim do ciclo ficam coerentes: todo certificado emitido até o fim do ciclo nasce válido.
// validityLocked = já há certificado emitido (a validade não muda mais); o fim não pode passar dela.
export function validityVsEndError(endDate: string | null, certValidUntil: string | null, validityLocked = false): string | null {
  if (!endDate || !certValidUntil) return null;
  if (certValidUntil.slice(0, 10) >= endDate.slice(0, 10)) return null;
  return validityLocked
    ? `A data fim não pode passar da validade dos certificados (${br(certValidUntil)}), que já está travada por certificado emitido.`
    : `A validade dos certificados (${br(certValidUntil)}) não pode ser anterior ao fim do ciclo (${br(endDate)}).`;
}
