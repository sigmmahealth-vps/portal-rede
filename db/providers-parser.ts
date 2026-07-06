/**
 * Parser puro da carga de prestadores (WS2).
 * Recebe as linhas do .xlsx (objetos por cabeçalho) e devolve prestadores
 * agregados por Código Prestador. Sem I/O de disco/banco (testável em memória).
 */

export type RawRow = Record<string, unknown>;

export const clean = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();
export const onlyDigits = (v: unknown): string => clean(v).replace(/\D/g, '');

/** Só dígitos + zero-pad ao tamanho esperado (CNPJ 14 / CPF 11). */
export function normalizeDoc(v: unknown, len: number): { value: string | null; invalid: boolean } {
  const digits = onlyDigits(v);
  if (!digits) return { value: null, invalid: false };
  if (digits.length > len) return { value: digits, invalid: true };
  return { value: digits.padStart(len, '0'), invalid: false };
}

export interface ParsedLocation {
  sgu_location_code: string;
  label: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
  in_medical_guide: boolean;
}

export interface ParsedCertification {
  kind: 'iso_9001' | 'acreditacao' | 'mestrado' | 'pos_graduacao' | 'doutorado';
  title: string | null;
  issuer: string | null;
  level: string | null;
  issued_date: string | null; // 'YYYY-MM-DD'
  expiry_date: string | null;
}

export interface ParsedProvider {
  sgu_code: string;
  name: string;
  trade_name: string | null;
  person_type: 'PF' | 'PJ' | null;
  cnpj: string | null;
  cpf: string | null;
  council_registry: string | null;
  specialties: string[];
  provider_type: string | null;
  provider_group: string | null;
  area_atuacao: string | null;
  status: string;
  roteiro_cod: string | null;
  roteiro_confianca: string | null;
  locations: ParsedLocation[];
  certifications: ParsedCertification[];
}

export interface ParseResult {
  providers: ParsedProvider[];
  warnings: string[];
}

// Nomes de cabeçalho da aba "Match" do cadastro.
const H = {
  code: 'Código Prestador', crm: 'CRM', razao: 'Razão Social', abrev: 'Razão Social Abrev',
  tipo: 'Tipo Prestador', grupoPrest: 'GRUPO_PREST', area: 'Desc. Área de Atuação',
  esp: 'Especialidade', espPrinc: 'Espec. Principal', cnpj: 'CNPJ', cpf: 'CPF',
  motExcl: 'PREST_MOT_EXCL',
  cepCom: 'CEP Comercial', cepRes: 'CEP Residencial', endCom: 'Endereço Comercial', endRes: 'Endereço Residencial',
  tel: 'Telefone', cel: 'Celular', email: 'Email',
  iso: 'ISO', nivelAcred: 'Nivel Acreditação', dataAcred: 'Data Acreditação',
  validAcred: 'Validade Acreditação', instAcred: 'Instituição Acreditadora',
  mestrado: 'Preferencias Mestrado', pos: 'Preferencias Pós', doutorado: 'Preferencias Doutorado',
  roteiroCod: 'ROTEIRO_COD', roteiroConf: 'CONFIANCA',
} as const;

const val = (row: RawRow, key: string): string => clean(row[key]);

export function parseProviders(rows: RawRow[]): ParseResult {
  const warnings: string[] = [];
  const groups = new Map<string, RawRow[]>();
  let semCodigo = 0;
  for (const r of rows) {
    const code = val(r, H.code);
    if (!code) { semCodigo++; continue; }
    let arr = groups.get(code);
    if (!arr) { arr = []; groups.set(code, arr); }
    arr.push(r);
  }
  if (semCodigo) warnings.push(`${semCodigo} linha(s) sem Código Prestador ignorada(s).`);

  const providers: ParsedProvider[] = [];
  for (const [code, groupRows] of groups) {
    const first = groupRows[0];
    const cnpjN = normalizeDoc(first[H.cnpj], 14);
    const cpfN = normalizeDoc(first[H.cpf], 11);
    if (cnpjN.invalid) warnings.push(`Código ${code}: CNPJ com ${onlyDigits(first[H.cnpj]).length} dígitos (esperado 14).`);
    if (cpfN.invalid) warnings.push(`Código ${code}: CPF com ${onlyDigits(first[H.cpf]).length} dígitos (esperado 11).`);

    const person_type: 'PF' | 'PJ' | null = cnpjN.value ? 'PJ' : cpfN.value ? 'PF' : null;

    const specialties: string[] = [];
    const seen = new Set<string>();
    const pushSpec = (s: string) => { const k = s.toLowerCase(); if (s && !seen.has(k)) { seen.add(k); specialties.push(s); } };
    pushSpec(val(first, H.espPrinc));
    for (const r of groupRows) pushSpec(val(r, H.esp));

    const crm = val(first, H.crm);
    const name = val(first, H.razao);
    if (!name) warnings.push(`Código ${code}: sem Razão Social.`);

    providers.push({
      sgu_code: code,
      name,
      trade_name: val(first, H.abrev) || null,
      person_type,
      cnpj: cnpjN.value,
      cpf: cpfN.value,
      council_registry: crm && crm !== '0' ? crm : null,
      specialties,
      provider_type: val(first, H.tipo) || null,
      provider_group: val(first, H.grupoPrest) || null,
      area_atuacao: val(first, H.area) || null,
      status: val(first, H.motExcl) ? 'inativo' : 'ativo',
      roteiro_cod: val(first, H.roteiroCod) || null,
      roteiro_confianca: val(first, H.roteiroConf) || null,
      locations: [],
      certifications: [],
    });
  }

  return { providers, warnings };
}
