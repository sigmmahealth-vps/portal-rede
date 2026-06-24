export interface PasswordValidation {
  ok: boolean;
  errors: string[];
}

const MIN_LENGTH = 8;
const HAS_LETTER = /\p{L}/u;
const HAS_DIGIT = /\d/;

export function validatePassword(pw: string): PasswordValidation {
  const errors: string[] = [];
  if (pw.length < MIN_LENGTH) errors.push(`A senha precisa ter no mínimo ${MIN_LENGTH} caracteres.`);
  if (!HAS_LETTER.test(pw)) errors.push('A senha precisa conter pelo menos uma letra.');
  if (!HAS_DIGIT.test(pw)) errors.push('A senha precisa conter pelo menos um número.');
  return { ok: errors.length === 0, errors };
}
