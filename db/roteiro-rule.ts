// Regra determinística de seleção de roteiro de qualificação a partir dos
// campos da aba `tabela` (Grupo do Prestador, Tipo de prestador, especialidades).

export type Confianca = 'Alta' | 'Média' | null;
export interface RoteiroSel {
  cod: string | null;
  confianca: Confianca;
}

/** Remove prefixo "NN - " ou "NN-", colapsa espaços, UPPER. */
export function normGrupo(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/^\s*\d+\s*-\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

const GRUPO2ROTEIRO: Record<string, string> = {
  'MEDICOS COOPERADOS': 'FOR-017',
  'MEDICOS COOPERADOS ARARANGUA': 'FOR-017',
  'MEDICOS CREDENCIADOS': 'FOR-017',
  LABORATORIOS: 'FOR-004',
  'LABORATORIOS ARARANGUA': 'FOR-004',
  'CLINICAS DE IMAGEM': 'FOR-002',
  'CLINICAS DE IMAGEM ARARANGUA': 'FOR-002',
  'CLINICAS DE FISIOTERAPIAS': 'FOR-003',
  'CLINICAS DE FISIOTERAPIA ARARANGUA': 'FOR-003',
  ANATOMOPATOLOGIA: 'FOR-001',
  PSICOLOGOS: 'FOR-015',
  'PSICOLOGOS ARARANGUA': 'FOR-015',
  FONOAUDIOLOGOS: 'FOR-015',
  'FONOAUDIOLOGOS ARARANGUA': 'FOR-015',
  NUTRICIONISTAS: 'FOR-015',
  'NUTRICIONISTAS ARARANGUA': 'FOR-015',
  'TERAPIA OCUPACIONAL': 'FOR-015',
  'CLINICA PSICOLOGO,FONO E/OU NUTRICIONIST': 'FOR-005',
  'CLINICAS MEDICAS': 'FOR-006',
  'CLINICAS MEDICAS ARARANGUA': 'FOR-006',
  HOSPITAIS: 'FOR-024',
  'HOSPITAIS ARARANGUA': 'FOR-024',
};

const MULTIPROF = ['FISIOTERAPIA', 'FONOAUDIOLOGIA', 'PSICOLOGIA', 'TERAPIA OCUPACIONAL'];

export function selecionaRoteiro(
  grupo: string | null | undefined,
  tipo: string | null | undefined,
  especialidades: string[],
): RoteiroSel {
  const g = normGrupo(grupo);
  const t = normGrupo(tipo);
  const esp = new Set(especialidades.map((e) => normGrupo(e)));

  if (g === 'HEMOSC') return { cod: null, confianca: null };

  if (g === 'RECURSO PRÓPRIO') {
    if (t === 'HOSPITAL') return { cod: 'FOR-024', confianca: 'Média' };
    if (t === 'LABORATÓRIO') return { cod: 'FOR-004', confianca: 'Média' };
    const multi = MULTIPROF.filter((m) => esp.has(m)).length;
    if (multi >= 2) return { cod: 'FOR-005', confianca: 'Média' };
    for (const e of esp) if (e.includes('ANÁLISES CLÍNICAS')) return { cod: 'FOR-004', confianca: 'Média' };
    return { cod: 'FOR-006', confianca: 'Média' };
  }

  const cod = GRUPO2ROTEIRO[g] ?? null;
  return { cod, confianca: cod ? 'Alta' : null };
}
