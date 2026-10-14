// Leitura da sgu_providers_raw (extração do SGU carregada pela Unimed no banco do Portal)
// e comparação com o cadastro de prestadores. Puro, sem banco — o CLI é db/sgu-diff.ts.
import { clean, onlyDigits, type ParsedLocation } from './providers-parser.js';
import { parseTabela, type TabelaProvider, type TabelaRow } from './tabela-parser.js';

export type SguRawRow = Record<string, unknown>;

// Coluna da planilha (o que o parseTabela lê) ← coluna da raw.
const COLUNAS: Record<string, string> = {
  'Código do prestador': 'codigo_prestador',
  'Nome do prestador': 'nome_prestador',
  'Nome Fantasia': 'nome_fantasia',
  CRM: 'numero_conselho_regional',
  'Situação do prestador': 'status_prestador',
  'Número do CPF e/ou CNJP': 'numero_documento',
  'Tipo de prestador': 'tipo_prestador',
  'Grupo do Prestador': 'grupo_prestador',
  'Especialidades/Gr Serv': 'especialidade_grupo_servico',
  'Nome Responsavel Técnico': 'nome_responsavel_tecnico',
  Logradouro: 'logradouro',
  'Número': 'numero_endereco',
  Complemento: 'complemento_endereco',
  Bairro: 'bairro',
  CEP: 'cep',
  Cidade: 'cidade',
  UF: 'uf_endereco',
  Telefone: 'telefone',
  Celular: 'celular',
  'E-mail': 'email_principal',
  'Tipo de Endereço': 'tipo_endereco',
  'Imprimir no guia médico': 'imprimir_no_guia_medico',
  'Código tipo endereço': 'codigo_tipo_endereco',
};

export function rawToTabelaRows(rows: SguRawRow[]): TabelaRow[] {
  return rows.map((r) =>
    Object.fromEntries(Object.entries(COLUNAS).map(([planilha, col]) => [planilha, r[col] ?? null])));
}

export const addrKey = (cep: unknown, logradouro: unknown, numero: unknown): string =>
  `${onlyDigits(cep)}|${clean(logradouro).toUpperCase()}|${clean(numero).replace(/^0+(?=\d)/, '')}`;

export function tipoEnderecoPorChave(rows: SguRawRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) {
    const k = `${clean(r.codigo_prestador)}#${addrKey(r.cep, r.logradouro, r.numero_endereco)}`;
    if (!m.has(k)) m.set(k, clean(r.codigo_tipo_endereco));
  }
  return m;
}

// Coluna é timestamp without time zone: o pg devolve Date no horário local.
export function dataCivil(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m ? m[1] : null;
}

export type SituacaoAfastamento =
  'nenhum' | 'vigente' | 'exclusao_agendada' | 'afastamento_encerrado' | 'inconsistente';

export interface Afastamento {
  operacao: string | null;
  inicio: string | null;
  fim: string | null;
  codigo_motivo: string | null;
  motivo: string | null;
  situacao: SituacaoAfastamento;
}

export function afastamentoPorPrestador(rows: SguRawRow[], hoje: string): Map<string, Afastamento> {
  const out = new Map<string, Afastamento>();
  for (const r of rows) {
    const code = clean(r.codigo_prestador);
    if (!code || out.has(code)) continue;
    const status = clean(r.status_prestador).toUpperCase();
    const operacao = clean(r.tipo_operacao_afastamento_exclusao).toUpperCase() || null;
    const inicio = dataCivil(r.data_inicio_afastamento_exclusao);
    const fim = dataCivil(r.data_fim_afastamento_exclusao);
    let situacao: SituacaoAfastamento;
    if (!operacao) situacao = 'nenhum';
    else if (status === 'ATIVO' && operacao === 'EXCLUSAO' && inicio && inicio > hoje) situacao = 'exclusao_agendada';
    else if (status === 'ATIVO' && operacao === 'AFASTAMENTO' && fim && fim <= hoje) situacao = 'afastamento_encerrado';
    else if ((status === 'AFASTADO' && operacao === 'AFASTAMENTO')
          || (status.startsWith('EXCLU') && operacao === 'EXCLUSAO')) situacao = 'vigente';
    else situacao = 'inconsistente';
    out.set(code, {
      operacao, inicio, fim,
      codigo_motivo: clean(r.codigo_motivo_afastamento_exclusao) || null,
      motivo: clean(r.motivo_afastamento_exclusao) || null,
      situacao,
    });
  }
  return out;
}

export interface PortalLocation {
  cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null;
  bairro: string | null; cidade: string | null; uf: string | null; phone: string | null; email: string | null;
  in_medical_guide: boolean;
}

export interface PortalProvider {
  sgu_code: string; name: string; trade_name: string | null; cnpj: string | null; cpf: string | null;
  status: string | null; provider_type: string | null; provider_group: string | null;
  specialties: string[]; responsavel_tecnico: string | null; roteiro_cod: string | null;
  tem_avaliacao: boolean; locations: PortalLocation[];
}

export interface CampoDiff { campo: string; portal: unknown; sgu: unknown }

export interface DiffReport {
  novos: { sgu_code: string; name: string; status: string; provider_group: string | null;
           roteiro_cod: string | null; unidades: number; afastamento: Afastamento | null }[];
  ausentes: { sgu_code: string; name: string; status: string | null; tem_avaliacao: boolean }[];
  alterados: { sgu_code: string; name: string; campos: CampoDiff[] }[];
  unidades: { sgu_code: string; name: string;
              novas: (PortalLocation & { codigo_tipo_endereco: string | null })[];
              removidas: PortalLocation[];
              alteradas: { endereco: string; codigo_tipo_endereco: string | null; campos: CampoDiff[] }[] }[];
  afastamentos: ({ sgu_code: string; name: string } & Afastamento)[];
  avisos: string[];
}

const txt = (v: unknown) => clean(v).toUpperCase();
const mesmoTexto = (a: unknown, b: unknown) => txt(a) === txt(b);
const mesmosDigitos = (a: unknown, b: unknown) => onlyDigits(a) === onlyDigits(b);
const mesmoConjunto = (a: unknown, b: unknown) => {
  const n = (x: unknown) => [...new Set((x as string[] ?? []).map(txt).filter(Boolean))].sort().join('|');
  return n(a) === n(b);
};

type Campo = [string, (p: PortalProvider) => unknown, (s: TabelaProvider) => unknown, (a: unknown, b: unknown) => boolean];
const CAMPOS: Campo[] = [
  ['name', (p) => p.name, (s) => s.name, mesmoTexto],
  ['trade_name', (p) => p.trade_name, (s) => s.trade_name, mesmoTexto],
  ['cnpj', (p) => p.cnpj, (s) => s.cnpj, mesmosDigitos],
  ['cpf', (p) => p.cpf, (s) => s.cpf, mesmosDigitos],
  ['status', (p) => p.status, (s) => s.status, mesmoTexto],
  ['provider_type', (p) => p.provider_type, (s) => s.provider_type, mesmoTexto],
  ['provider_group', (p) => p.provider_group, (s) => s.provider_group, mesmoTexto],
  ['specialties', (p) => p.specialties, (s) => s.specialties, mesmoConjunto],
  ['responsavel_tecnico', (p) => p.responsavel_tecnico, (s) => s.responsavel_tecnico, mesmoTexto],
  ['roteiro_cod', (p) => p.roteiro_cod, (s) => s.roteiro_cod, mesmoTexto],
];

const CAMPOS_UNIDADE = ['complemento', 'bairro', 'cidade', 'uf', 'phone', 'email'] as const;

const unidade = (l: ParsedLocation): PortalLocation => ({
  cep: l.cep, logradouro: l.logradouro, numero: l.numero, complemento: l.complemento, bairro: l.bairro,
  cidade: l.cidade, uf: l.uf, phone: l.phone, email: l.email, in_medical_guide: l.in_medical_guide,
});

// O SGU mantém o código antigo ("MUDOU DE CÓDIGO") como EXCLUÍDO com o mesmo CPF/CNPJ; o dedupeDocs
// do parser fica com o documento do primeiro código visto — excluídos por último para o ativo ficar com ele.
const excluido = (r: SguRawRow) => clean(r.status_prestador).toUpperCase().startsWith('EXCLU');
// Ordem total e determinística (o SELECT da raw não garante ordem): o "primeiro" de cada código/endereço/documento
// não pode depender da posição física das linhas.
const num = (a: unknown, b: unknown) => clean(a).localeCompare(clean(b), undefined, { numeric: true });
export const ordenaRaw = (rows: SguRawRow[]): SguRawRow[] => [...rows].sort((a, b) =>
  Number(excluido(a)) - Number(excluido(b))
  || num(a.codigo_prestador, b.codigo_prestador)
  || num(a.codigo_tipo_endereco, b.codigo_tipo_endereco)
  || clean(a.especialidade_grupo_servico).localeCompare(clean(b.especialidade_grupo_servico)));

export function diffProviders(raw: SguRawRow[], portal: PortalProvider[], hoje: string): DiffReport {
  const rows = ordenaRaw(raw);
  const { providers: sgu, warnings } = parseTabela(rawToTabelaRows(rows));
  const afast = afastamentoPorPrestador(rows, hoje);
  const tipos = tipoEnderecoPorChave(rows);
  const doPortal = new Map(portal.map((p) => [p.sgu_code, p]));
  const doSgu = new Set(sgu.map((s) => s.sgu_code));
  const r: DiffReport = { novos: [], ausentes: [], alterados: [], unidades: [], afastamentos: [], avisos: warnings };

  for (const s of sgu) {
    const a = afast.get(s.sgu_code) ?? null;
    const p = doPortal.get(s.sgu_code);
    if (!p) {
      r.novos.push({ sgu_code: s.sgu_code, name: s.name, status: s.status, provider_group: s.provider_group,
                     roteiro_cod: s.roteiro_cod, unidades: s.locations.length, afastamento: a });
      continue;
    }

    const campos = CAMPOS.filter(([, gp, gs, igual]) => !igual(gp(p), gs(s)))
      .map(([campo, gp, gs]) => ({ campo, portal: gp(p), sgu: gs(s) }));
    if (campos.length) r.alterados.push({ sgu_code: s.sgu_code, name: s.name, campos });

    const lp = new Map(p.locations.map((l) => [addrKey(l.cep, l.logradouro, l.numero), l]));
    const ls = new Map(s.locations.map((l) => [addrKey(l.cep, l.logradouro, l.numero), unidade(l)]));
    const tipo = (k: string) => tipos.get(`${s.sgu_code}#${k}`) ?? null;
    const novas = [...ls].filter(([k]) => !lp.has(k)).map(([k, l]) => ({ ...l, codigo_tipo_endereco: tipo(k) }));
    const removidas = [...lp].filter(([k]) => !ls.has(k)).map(([, l]) => l);
    const alteradas = [...ls].filter(([k]) => lp.has(k)).map(([k, l]) => {
      const antes = lp.get(k)!;
      const c: CampoDiff[] = CAMPOS_UNIDADE.filter((f) => !mesmoTexto(antes[f], l[f]))
        .map((f) => ({ campo: f, portal: antes[f], sgu: l[f] }));
      if (antes.in_medical_guide !== l.in_medical_guide) {
        c.push({ campo: 'in_medical_guide', portal: antes.in_medical_guide, sgu: l.in_medical_guide });
      }
      return { endereco: k, codigo_tipo_endereco: tipo(k), campos: c };
    }).filter((x) => x.campos.length);
    if (novas.length || removidas.length || alteradas.length) {
      r.unidades.push({ sgu_code: s.sgu_code, name: s.name, novas, removidas, alteradas });
    }

    if (a && a.situacao !== 'nenhum') r.afastamentos.push({ sgu_code: s.sgu_code, name: s.name, ...a });
  }

  for (const p of portal) {
    if (!doSgu.has(p.sgu_code)) {
      r.ausentes.push({ sgu_code: p.sgu_code, name: p.name, status: p.status, tem_avaliacao: p.tem_avaliacao });
    }
  }
  return r;
}
