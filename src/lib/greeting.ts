// Saudação da home/dashboard.
// - Horário (Bom dia / Boa tarde / Boa noite) baseado no horário local do navegador.
// - "Seja bem-vindo" no 1º acesso (lastLoginAt=null); "Bem-vindo de volta" nos seguintes.

export function timeGreeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'Bom dia';
  if (h >= 12 && h < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function welcomeLine(lastLoginAt: string | null | undefined, now: Date = new Date()): string {
  const isFirst = lastLoginAt == null;
  return `${timeGreeting(now)}, ${isFirst ? 'seja bem-vindo' : 'bem-vindo de volta'}`;
}
