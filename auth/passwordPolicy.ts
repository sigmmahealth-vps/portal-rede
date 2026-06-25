export interface PasswordValidation {
  ok: boolean;
  errors: string[];
}

const MIN_LENGTH = 10;
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
