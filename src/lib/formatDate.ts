// Formatação de datas no padrão pt-BR (dd/mm/aaaa). Fonte única — substitui as
// várias cópias de fmtDate/fmtDateOnly espalhadas pelo portal.
//
// Datas "só-data" ('YYYY-MM-DD', com ou sem hora/zona depois) são formatadas a
// partir dos componentes, sem passar por Date — evita o shift de -1 dia no fuso
// de Brasília (UTC-3), onde a meia-noite UTC cai no dia anterior.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

/** Data em dd/mm/aaaa. '' para valor vazio/ inválido. */
export function fmtData(v: string | number | Date | null | undefined): string {
  if (v == null || v === '') return '';
  if (typeof v === 'string') {
    const m = DATE_ONLY.exec(v);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
}

/** Data e hora em dd/mm/aaaa hh:mm. '' para valor vazio/inválido. */
export function fmtDataHora(v: string | number | Date | null | undefined): string {
  if (v == null || v === '') return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
