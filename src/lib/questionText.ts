// Perguntas do SGU vêm concatenadas com a legislação:
//   <pergunta[?/.]> "<TIPO>" <legislação>
// onde <TIPO> são 1-3 letras maiúsculas ("DL", "S", "E", "NC", etc.).
// Normalmente a pergunta inteira precede o marcador, então cortamos ali.
//
// Exceção: quesito enumerado — a intro termina em ":" e os itens (I, II, a)…) vêm
// DEPOIS do marcador. Aí mantemos os itens (são o resto da pergunta) e cortamos só a
// legislação do fim. A legislação já é exibida à parte (q.legislation).
// Fallback sem marcador: primeiro "?"; se nada bater, o texto integral.

const LEGISLACAO = /\b(ANS|ANVISA|RDC|RN|CFM|CRM|COREN|ABNT|CONSELHO|Lei|Portaria|Minist[ée]rio)\b/i;

export function questionOnly(text: string): string {
  const s = text ?? '';
  const m = s.match(/\s+"[A-Z]{1,3}"\s/);
  if (m && m.index != null) {
    const before = s.slice(0, m.index).trimEnd();
    if (before.endsWith(':')) {
      // Quesito enumerado: os itens após o marcador são a continuação da pergunta.
      let after = s.slice(m.index + m[0].length);
      const leg = after.match(LEGISLACAO);
      if (leg && leg.index != null) after = after.slice(0, leg.index);
      after = after.trim();
      return after ? `${before} ${after}` : before;
    }
    return before;
  }
  const i = s.indexOf('?');
  return i >= 0 ? s.slice(0, i + 1) : s;
}
