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
  sgu_tipo_endereco?: string | null;   // codigo_tipo_endereco do SGU (chave estável da unidade)
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

export interface ParsedAddr {
  logradouro: string | null; numero: string | null; complemento: string | null;
  bairro: string | null; cidade: string | null; uf: string | null;
}

/** Parse best-effort do endereço-texto "LOGRADOURO, N - ... - CIDADE - UF". */
export function parseAddress(raw: string): ParsedAddr {
  const s = clean(raw);
  const empty: ParsedAddr = { logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null };
  if (!s) return empty;
  const parts = s.split(' - ').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return { ...empty, logradouro: s };
  let uf: string | null = null;
  const last = parts[parts.length - 1];
  if (/^[A-Za-z]{2}$/.test(last)) { uf = last.toUpperCase(); parts.pop(); }
  const cidade = parts.length ? parts.pop()! : null;
  const first = parts.shift() ?? '';
  let logradouro = first;
  let numero: string | null = null;
  const m = /^(.*?),\s*(\d+[A-Za-z]?)$/.exec(first);
  if (m) { logradouro = m[1].trim(); numero = m[2]; }
  const bairro = parts.length ? parts.join(' - ') : null;
  return { logradouro: logradouro || null, numero, complemento: null, bairro, cidade, uf };
}

/** Constrói os locais (comercial primário + residencial) a partir de uma linha. */
export function buildLocations(row: RawRow, code: string): ParsedLocation[] {
  const out: ParsedLocation[] = [];
  const phone = val(row, H.tel) || val(row, H.cel) || null;
  const email = val(row, H.email) || null;
  const endCom = val(row, H.endCom);
  const cepCom = val(row, H.cepCom);
  if (endCom || cepCom || phone || email) {
    const a = parseAddress(endCom);
    out.push({
      sgu_location_code: `${code}-COM`, label: 'Comercial', cep: cepCom || null,
      logradouro: a.logradouro, numero: a.numero, complemento: a.complemento, bairro: a.bairro,
      cidade: a.cidade, uf: a.uf, phone, email, is_primary: true, in_medical_guide: true,
    });
  }
  const endRes = val(row, H.endRes);
  const cepRes = val(row, H.cepRes);
  if (endRes || cepRes) {
    const a = parseAddress(endRes);
    out.push({
      sgu_location_code: `${code}-RES`, label: 'Residencial', cep: cepRes || null,
      logradouro: a.logradouro, numero: a.numero, complemento: a.complemento, bairro: a.bairro,
      cidade: a.cidade, uf: a.uf, phone: null, email: null,
      is_primary: out.length === 0, in_medical_guide: false,
    });
  }
  return out;
}

/** Converte Date (cellDates) ou 'DD/MM/YYYY' em 'YYYY-MM-DD'; senão null. */
function toISODate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(clean(v));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Um campo "presente" (ignora vazio, N/NÃO/0). */
function isPresent(s: string): boolean {
  const u = s.toUpperCase();
  return !!s && u !== 'N' && u !== 'NAO' && u !== 'NÃO' && u !== '0';
}

/** Extrai certificações acadêmicas, ISO 9001 e acreditação de uma linha. */
export function buildCertifications(row: RawRow): ParsedCertification[] {
  const out: ParsedCertification[] = [];
  const iso = val(row, H.iso);
  if (isPresent(iso)) out.push({ kind: 'iso_9001', title: iso, issuer: null, level: null, issued_date: null, expiry_date: null });

  const nivel = val(row, H.nivelAcred);
  const inst = val(row, H.instAcred);
  const dataAcred = toISODate(row[H.dataAcred]);
  if (isPresent(nivel) || isPresent(inst) || dataAcred) {
    out.push({
      kind: 'acreditacao', title: null, issuer: inst || null, level: nivel || null,
      issued_date: dataAcred, expiry_date: toISODate(row[H.validAcred]),
    });
  }

  const academic: Array<[string, ParsedCertification['kind']]> = [
    [H.mestrado, 'mestrado'], [H.pos, 'pos_graduacao'], [H.doutorado, 'doutorado'],
  ];
  for (const [key, kind] of academic) {
    const v = val(row, key);
    if (isPresent(v)) out.push({ kind, title: v, issuer: null, level: null, issued_date: null, expiry_date: null });
  }
  return out;
}

/** Estrutural mínimo p/ dedupeDocs — permite reuso por outros parsers (ex.: tabela-parser). */
export interface HasDocs { sgu_code: string; cnpj: string | null; cpf: string | null; }

/** Zera CNPJ/CPF repetidos entre prestadores distintos (índice único parcial). */
export function dedupeDocs(providers: HasDocs[], warnings: string[]): void {
  const seenCnpj = new Map<string, string>();
  const seenCpf = new Map<string, string>();
  for (const p of providers) {
    if (p.cnpj) {
      const owner = seenCnpj.get(p.cnpj);
      if (owner) { warnings.push(`CNPJ ${p.cnpj} duplicado (código ${p.sgu_code} já em ${owner}); documento zerado em ${p.sgu_code}.`); p.cnpj = null; }
      else seenCnpj.set(p.cnpj, p.sgu_code);
    }
    if (p.cpf) {
      const owner = seenCpf.get(p.cpf);
      if (owner) { warnings.push(`CPF ${p.cpf} duplicado (código ${p.sgu_code} já em ${owner}); documento zerado em ${p.sgu_code}.`); p.cpf = null; }
      else seenCpf.set(p.cpf, p.sgu_code);
    }
  }
}

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
      locations: buildLocations(first, code),
      certifications: buildCertifications(first),
    });
  }

  dedupeDocs(providers, warnings);
  return { providers, warnings };
}
