// Perguntas do SGU vêm concatenadas com a legislação:
//   <pergunta[?/.]> "<TIPO>" <legislação>
// onde <TIPO> são 1-3 letras maiúsculas ("DL", "S", "E", "NC", etc.).
// A legislação já é exibida separadamente (q.legislation), então cortamos a pergunta
// antes desse marcador. Fallback: primeiro "?"; se nada bater, o texto integral.

export function questionOnly(text: string): string {
  const s = text ?? '';
  const m = s.match(/\s+"[A-Z]{1,3}"\s/);
  if (m && m.index != null) return s.slice(0, m.index).trimEnd();
  const i = s.indexOf('?');
  return i >= 0 ? s.slice(0, i + 1) : s;
}
