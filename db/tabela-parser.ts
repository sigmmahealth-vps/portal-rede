// Parser da aba `tabela` de Prestadores Portal.xlsx (layout novo).
// Agrega linhas por Código do prestador → 1 TabelaProvider (com N locations).
import { clean, onlyDigits, dedupeDocs, type ParsedLocation } from './providers-parser.js';
import { selecionaRoteiro, type Confianca } from './roteiro-rule.js';

export type TabelaRow = Record<string, unknown>;

export interface TabelaProvider {
  sgu_code: string;
  name: string;
  trade_name: string | null;
  person_type: 'PF' | 'PJ';
  cnpj: string | null;
  cpf: string | null;
  council_registry: string | null;
  specialties: string[];
  provider_type: string | null;
  provider_group: string | null;
  responsavel_tecnico: string | null;
  status: string;
  roteiro_cod: string | null;
  roteiro_confianca: Confianca;
  locations: ParsedLocation[];
}

const stripPrefix = (v: unknown): string => clean(v).replace(/^\s*\d+\s*-\s*/, '');

/** PF/PJ pelo Tipo de prestador (MÉDICO = pessoa física; resto = jurídica). */
function personTypeFromTipo(tipoLimpo: string): 'PF' | 'PJ' {
  return /M[ÉE]DICO/i.test(tipoLimpo) ? 'PF' : 'PJ';
}

interface Acc {
  row: TabelaRow;
  grupo: string;
  tipo: string;
  specialties: Set<string>;
  addrs: Map<string, ParsedLocation>;
}

export function parseTabela(rows: TabelaRow[]): { providers: TabelaProvider[]; warnings: string[] } {
  const warnings: string[] = [];
  const byCode = new Map<string, Acc>();

  for (const r of rows) {
    const code = clean(r['Código do prestador']);
    if (!code) continue;
    let acc = byCode.get(code);
    if (!acc) {
      acc = {
        row: r,
        grupo: clean(r['Grupo do Prestador']),
        tipo: clean(r['Tipo de prestador']),
        specialties: new Set(),
        addrs: new Map(),
      };
      byCode.set(code, acc);
    }
    const esp = stripPrefix(r['Especialidades/Gr Serv']);
    if (esp) acc.specialties.add(esp);

    const cep = onlyDigits(r['CEP']);
    const logradouro = clean(r['Logradouro']);
    const numero = clean(r['Número']);
    const key = `${cep}|${logradouro}|${numero}`;
    if ((cep || logradouro) && !acc.addrs.has(key)) {
      const phone = clean(r['Telefone']) || clean(r['Celular']) || null;
      acc.addrs.set(key, {
        sgu_location_code: '',
        label: clean(r['Tipo de Endereço']) || 'Comercial',
        cep: cep || null,
        logradouro: logradouro || null,
        numero: numero || null,
        complemento: clean(r['Complemento']) || null,
        bairro: clean(r['Bairro']) || null,
        cidade: clean(r['Cidade']) || null,
        uf: clean(r['UF']).toUpperCase() || null,
        phone,
        email: clean(r['E-mail']) || null,
        is_primary: false,
        in_medical_guide: true,
      });
    }
  }

  const providers: TabelaProvider[] = [];
  for (const [code, acc] of byCode) {
    const especialidades = [...acc.specialties];
    const { cod, confianca } = selecionaRoteiro(acc.grupo, acc.tipo, especialidades);
    if (!cod) warnings.push(`${code}: roteiro A DEFINIR (grupo "${acc.grupo}")`);

    const tipoLimpo = stripPrefix(acc.tipo);
    const person_type = personTypeFromTipo(tipoLimpo);
    const docDigits = onlyDigits(acc.row['Número do CPF e/ou CNJP']);
    let cnpj: string | null = null;
    let cpf: string | null = null;
    if (docDigits) {
      if (person_type === 'PF') cpf = docDigits.padStart(11, '0').slice(-11);
      else cnpj = docDigits.padStart(14, '0').slice(-14);
    }

    // situação cadastral: reflete o valor real da tabela, sem tradução
    // (ATIVO->ativo, AFASTADO->afastado, EXCLUÍDO->excluído).
    const status = clean(acc.row['Situação do prestador']).toLowerCase();
    const crm = onlyDigits(acc.row['CRM']);
    const council_registry = crm && crm !== '0' ? crm : null;

    const locations = [...acc.addrs.values()].map((l, i) => ({
      ...l,
      sgu_location_code: `${code}-${i + 1}`,
      is_primary: i === 0,
    }));
    if (locations.length === 0) warnings.push(`${code}: sem endereço`);

    providers.push({
      sgu_code: code,
      name: clean(acc.row['Nome do prestador']),
      trade_name: clean(acc.row['Nome Fantasia']) || null,
      person_type,
      cnpj,
      cpf,
      council_registry,
      specialties: especialidades,
      provider_type: tipoLimpo || null,
      provider_group: stripPrefix(acc.grupo) || null,
      responsavel_tecnico: clean(acc.row['Nome Responsavel Técnico']) || null,
      status,
      roteiro_cod: cod,
      roteiro_confianca: confianca,
      locations,
    });
  }
  dedupeDocs(providers, warnings);
  return { providers, warnings };
}
