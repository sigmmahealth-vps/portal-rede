export interface PasswordValidation {
  ok: boolean;
  errors: string[];
}

// 8 por pedido da Unimed (homologação 09/2026): unificar com as senhas dos
// demais sistemas deles. A complexidade (Aa/dígito/símbolo) continua exigida.
const MIN_LENGTH = 8;
const HAS_UPPER = /\p{Lu}/u;
const HAS_LOWER = /\p{Ll}/u;
const HAS_DIGIT = /\d/;
const HAS_SYMBOL = /[^\p{L}\d\s]/u;

export function validatePassword(pw: string): PasswordValidation {
  const errors: string[] = [];
  if (pw.length < MIN_LENGTH) errors.push(`A senha precisa ter no mínimo ${MIN_LENGTH} caracteres.`);
  if (!HAS_UPPER.test(pw)) errors.push('A senha precisa conter pelo menos uma letra maiúscula.');
  if (!HAS_LOWER.test(pw)) errors.push('A senha precisa conter pelo menos uma letra minúscula.');
  if (!HAS_DIGIT.test(pw)) errors.push('A senha precisa conter pelo menos um número.');
  if (!HAS_SYMBOL.test(pw)) errors.push('A senha precisa conter pelo menos um símbolo (ex: !@#$%).');
  return { ok: errors.length === 0, errors };
}
