// Aplica a planilha "CRITÉRIOS ELIMINATÓRIOS PRP.xlsx" da Unimed (Katy, 17/10/2026; revê a Q13 da spec
// 2026-09-21, que deixava a marcação só na tela). Casa por roteiro (FOR-XXX) + item (code), e só marca se
// o texto do critério confirmar o tipo de documento da planilha; o que divergir vai para o relatório.
// O roteiro fica com exatamente os eliminatórios da planilha (os demais são desmarcados).

export interface ItemPlanilha { roteiro: string; item: string; tipoDoc: string }
export interface CriterioAtual { id: number; code: string | null; text: string; is_eliminatory: boolean }

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Palavra que precisa aparecer no texto do critério para confirmar o tipo de documento da planilha.
const CONFIRMA: [RegExp, RegExp][] = [
  [/funcionamento cnen|cnen/, /energia nuclear|cnen/],
  [/alvara de funcionamento/, /alvara de funcionamento/],
  [/bombeiros/, /bombeiros/],
  [/alvara sanitario/, /sanitario/],
  [/responsabilidade tecnica/, /responsabilidade tecnica/],
];

export function textoConfirma(tipoDoc: string, texto: string): boolean {
  const t = sem(tipoDoc), x = sem(texto);
  const regra = CONFIRMA.find(([tipo]) => tipo.test(t));
  return regra ? regra[1].test(x) : false;
}

export const chave = (roteiro: string, item: string) => `${roteiro}:${item}`;

export function planejarEliminatorios(itens: ItemPlanilha[], criterios: CriterioAtual[], aceitar = new Set<string>()) {
  const marcarIds = new Set<number>();
  const divergentes: { item: string; tipoDoc: string; texto: string }[] = [];
  const ausentes: { item: string; tipoDoc: string }[] = [];
  for (const it of itens) {
    const achados = criterios.filter((c) => (c.code ?? '').trim() === it.item);
    if (!achados.length) { ausentes.push({ item: it.item, tipoDoc: it.tipoDoc }); continue; }
    for (const c of achados) {
      if (textoConfirma(it.tipoDoc, c.text) || aceitar.has(chave(it.roteiro, it.item))) marcarIds.add(c.id);
      else divergentes.push({ item: it.item, tipoDoc: it.tipoDoc, texto: c.text });
    }
  }
  return {
    marcar: criterios.filter((c) => marcarIds.has(c.id) && !c.is_eliminatory),
    desmarcar: criterios.filter((c) => !marcarIds.has(c.id) && c.is_eliminatory),
    final: criterios.filter((c) => marcarIds.has(c.id)),
    divergentes, ausentes,
  };
}
