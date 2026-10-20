// Planejamento da rotina diária SGU → cadastro (spec 2026-10-14, fase 2). Puro, sem banco:
// decide o que criar, atualizar e inativar; quem grava é db/sgu-sync.ts.
import { clean, type ParsedLocation } from './providers-parser.js';
import { parseTabela, type TabelaProvider } from './tabela-parser.js';
import { addrKey, ordenaRaw, rawToTabelaRows, tipoEnderecoPorChave, type SguRawRow } from './sgu-raw.js';

// Mais que isso de ativos virando excluídos numa carga só = provável carga incompleta.
export const LIMITE_SAIDA = 0.10;

export interface PortalUnidadeSync { id: number; sgu_location_code: string | null; active: boolean }
export interface PortalPrestadorSync { id: number; sgu_code: string; status: string | null; source: string | null; locations: PortalUnidadeSync[] }

export interface PlanoSync {
  inserir: TabelaProvider[];
  atualizar: { id: number; p: TabelaProvider }[];
  excluirPorAusencia: number[];
  unidadesNovas: { provider_id: number; prestador: TabelaProvider; loc: ParsedLocation }[];
  unidadesAtualizar: { id: number; loc: ParsedLocation }[];
  unidadesInativar: number[];
  ignorados: { excluido_novo: string[]; grupo_27: string[]; intercambio: string[]; manual: string[] };
  ativos: number;
  ativosQueSaem: number;
}

const ehExcluido = (status: unknown) => clean(status).toLowerCase().startsWith('exclu');
const GRUPO_27 = /^\s*27\s*-/;
// Tipo "07 - INTERCÂMBIO" (prestadores de outras Unimeds) não é a rede da Unimed Criciúma:
// fica fora como o grupo 27 (Katy, 17/10/2026).
export const TIPO_INTERCAMBIO = /^\s*0?7\s*-|INTERC[ÂA]MBIO/i;

export function planejarSync(raw: SguRawRow[], portal: PortalPrestadorSync[]): PlanoSync {
  const rows = ordenaRaw(raw);
  const cods = (pred: (r: SguRawRow) => boolean) =>
    new Set(rows.filter(pred).map((r) => clean(r.codigo_prestador)).filter(Boolean));
  const grupo27 = cods((r) => GRUPO_27.test(clean(r.grupo_prestador)));
  const intercambio = cods((r) => TIPO_INTERCAMBIO.test(clean(r.tipo_prestador)));
  // Descarta intercâmbio e grupo 27 ANTES do parse: se passassem pelo parseTabela, o gêmeo
  // intercâmbio (mesmo documento, código menor) entraria no dedupeDocs e zeraria o CNPJ do
  // prestador real. Os códigos seguem em naRaw (continuam presentes na raw) para não virarem
  // exclusão por ausência.
  const ignorarCod = new Set([...grupo27, ...intercambio]);
  const { providers: sgu } = parseTabela(
    rawToTabelaRows(rows.filter((r) => !ignorarCod.has(clean(r.codigo_prestador)))));
  const doPortal = new Map(portal.map((p) => [p.sgu_code, p]));
  const naRaw = new Set(rows.map((r) => clean(r.codigo_prestador)).filter(Boolean));
  const plano: PlanoSync = {
    inserir: [], atualizar: [], excluirPorAusencia: [], unidadesNovas: [], unidadesAtualizar: [],
    unidadesInativar: [],
    ignorados: { excluido_novo: [], grupo_27: [...grupo27],
      intercambio: [...intercambio].filter((c) => !grupo27.has(c)), manual: [] },
    ativos: portal.filter((p) => p.source === 'sgu' && p.status === 'ativo').length, ativosQueSaem: 0,
  };

  for (const s of sgu) {
    const p = doPortal.get(s.sgu_code);
    if (p && p.source !== 'sgu') { plano.ignorados.manual.push(s.sgu_code); continue; }
    if (!p) {
      if (ehExcluido(s.status)) plano.ignorados.excluido_novo.push(s.sgu_code);
      else plano.inserir.push(s);
      continue;
    }
    plano.atualizar.push({ id: p.id, p: s });
    if (p.status === 'ativo' && ehExcluido(s.status)) plano.ativosQueSaem++;

    const atuais = new Map(p.locations.map((l) => [l.sgu_location_code, l]));
    const codigos = new Set<string>();
    const novas: ParsedLocation[] = [];
    for (const loc of s.locations) {
      codigos.add(loc.sgu_location_code);
      const u = atuais.get(loc.sgu_location_code);
      if (u) plano.unidadesAtualizar.push({ id: u.id, loc });
      else novas.push(loc);
    }
    const inativar = p.locations.filter((l) => l.active && !codigos.has(l.sgu_location_code ?? '')).map((l) => l.id);
    // Relocação 1↔1: exatamente 1 unidade sairia e 1 entraria = é a mesma unidade com endereço (e
    // código) novo. Recodifica no lugar mantendo o id — logo o acesso/senha/avaliação seguem com ela,
    // em vez de criar acesso novo (senha provisória) e deixar o velho órfão. Mesma regra do planejarRekey.
    if (novas.length === 1 && inativar.length === 1) {
      plano.unidadesAtualizar.push({ id: inativar[0], loc: novas[0] });
    } else {
      for (const loc of novas) plano.unidadesNovas.push({ provider_id: p.id, prestador: s, loc });
      plano.unidadesInativar.push(...inativar);
    }
  }

  for (const p of portal) {
    if (p.source !== 'sgu' || naRaw.has(p.sgu_code) || ehExcluido(p.status)) continue;
    plano.excluirPorAusencia.push(p.id);
    if (p.status === 'ativo') plano.ativosQueSaem++;
  }
  return plano;
}

export function checarTravas(raw: SguRawRow[], plano: PlanoSync): string | null {
  if (!raw.length) return 'sgu_providers_raw está vazia.';
  const cargas = new Set(raw.map((r) =>
    String(r.dh_carga_txt ?? (r.dh_carga instanceof Date ? r.dh_carga.getTime() : r.dh_carga))));
  if (cargas.size > 1) return `sgu_providers_raw tem ${cargas.size} cargas (dh_carga) misturadas.`;
  if (plano.ativosQueSaem > LIMITE_SAIDA * plano.ativos) {
    return `${plano.ativosQueSaem} de ${plano.ativos} prestadores ativos virariam excluídos `
      + `(limite ${LIMITE_SAIDA * 100}%) — provável carga incompleta.`;
  }
  return null;
}

export interface UnidadeRekey {
  id: number; provider_id: number; sgu_code: string; sgu_location_code: string | null;
  sgu_tipo_endereco: string | null; cep: string | null; logradouro: string | null; numero: string | null;
}
export interface PlanoRekey { rekey: { id: number; codigo: string; tipo: string; mudou_endereco?: boolean }[]; inativar: { id: number; codigo: string }[] }

// Troca o código posicional (<código>-N) pelo estável (<código>-<tipo de endereço>), casando pelo
// endereço e mantendo o id. Quem não casa (ou repete um tipo já tomado) fica inativo com '-x' no
// código, para não colidir com o código novo de outra unidade.
export function planejarRekey(unidades: UnidadeRekey[], raw: SguRawRow[]): PlanoRekey {
  const tipos = tipoEnderecoPorChave(ordenaRaw(raw));
  const ocupados = new Set(unidades.filter((u) => u.sgu_tipo_endereco)
    .map((u) => `${u.provider_id}#${u.sgu_tipo_endereco}`));
  const plano: PlanoRekey = { rekey: [], inativar: [] };
  for (const u of [...unidades].sort((a, b) => a.id - b.id)) {
    if (u.sgu_tipo_endereco || (u.sgu_location_code ?? '').endsWith('-x')) continue;
    const tipo = tipos.get(`${u.sgu_code}#${addrKey(u.cep, u.logradouro, u.numero)}`);
    const chave = `${u.provider_id}#${tipo}`;
    if (tipo && !ocupados.has(chave)) {
      ocupados.add(chave);
      plano.rekey.push({ id: u.id, codigo: `${u.sgu_code}-${tipo}`, tipo });
    } else {
      plano.inativar.push({ id: u.id, codigo: `${u.sgu_location_code ?? `${u.sgu_code}-${u.id}`}-x` });
    }
  }
  // Sobrou exatamente 1 unidade do portal e exatamente 1 endereço do SGU no prestador: é a mesma
  // unidade com endereço novo — mantém o id (e a senha/avaliação) em vez de inativar.
  const sguTipos = new Map<string, Set<string>>();
  for (const r of ordenaRaw(raw)) {
    const c = String(r.codigo_prestador ?? '').trim();
    if (!sguTipos.has(c)) sguTipos.set(c, new Set());
    sguTipos.get(c)!.add(String(r.codigo_tipo_endereco ?? '').trim());
  }
  const porId = new Map(unidades.map((u) => [u.id, u]));
  const sobraPortal = new Map<number, number[]>();
  for (const i of plano.inativar) {
    const u = porId.get(i.id)!;
    sobraPortal.set(u.provider_id, [...(sobraPortal.get(u.provider_id) ?? []), u.id]);
  }
  for (const [pid, ids] of sobraPortal) {
    const u = porId.get(ids[0])!;
    const sobraSgu = [...(sguTipos.get(u.sgu_code) ?? [])].filter((t) => t && !ocupados.has(`${pid}#${t}`));
    if (ids.length !== 1 || sobraSgu.length !== 1) continue;
    const tipo = sobraSgu[0];
    ocupados.add(`${pid}#${tipo}`);
    plano.inativar = plano.inativar.filter((i) => i.id !== u.id);
    plano.rekey.push({ id: u.id, codigo: `${u.sgu_code}-${tipo}`, tipo, mudou_endereco: true });
  }
  plano.rekey.sort((a, b) => a.id - b.id);
  plano.inativar.sort((a, b) => a.id - b.id);
  return plano;
}
