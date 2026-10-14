// Leitura da sgu_providers_raw (extração do SGU carregada pela Unimed no banco do Portal)
// e comparação com o cadastro de prestadores. Puro, sem banco — o CLI é db/sgu-diff.ts.
import { clean, onlyDigits } from './providers-parser.js';
import { type TabelaRow } from './tabela-parser.js';

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
};

export function rawToTabelaRows(rows: SguRawRow[]): TabelaRow[] {
  return rows.map((r) =>
    Object.fromEntries(Object.entries(COLUNAS).map(([planilha, col]) => [planilha, r[col] ?? null])));
}

export const addrKey = (cep: unknown, logradouro: unknown, numero: unknown): string =>
  `${onlyDigits(cep)}|${clean(logradouro).toUpperCase()}|${clean(numero)}`;

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
