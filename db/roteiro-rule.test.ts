import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selecionaRoteiro } from './roteiro-rule.js';

test('grupo mapeia direto para roteiro (confiança Alta)', () => {
  assert.deepEqual(selecionaRoteiro('1 - MEDICOS COOPERADOS', '01 - MÉDICO', []), { cod: 'FOR-017', confianca: 'Alta' });
  assert.deepEqual(selecionaRoteiro('2 - LABORATORIOS', '', []), { cod: 'FOR-004', confianca: 'Alta' });
  assert.deepEqual(selecionaRoteiro('4 - HOSPITAIS', '', []), { cod: 'FOR-024', confianca: 'Alta' });
  assert.deepEqual(selecionaRoteiro('13 - CLINICA PSICOLOGO,FONO E/OU NUTRICIONIST', '', []), { cod: 'FOR-005', confianca: 'Alta' });
  assert.deepEqual(selecionaRoteiro('9 - PSICOLOGOS', '', []), { cod: 'FOR-015', confianca: 'Alta' });
});

test('RECURSO PRÓPRIO roteia por tipo + especialidade (confiança Média)', () => {
  assert.deepEqual(selecionaRoteiro('26 - RECURSO PRÓPRIO', '02 - LABORATÓRIO', ['ANATOMIA PATOLÓGICA']), { cod: 'FOR-004', confianca: 'Média' });
  assert.deepEqual(selecionaRoteiro('26 - RECURSO PRÓPRIO', 'HOSPITAL', []), { cod: 'FOR-024', confianca: 'Média' });
  assert.deepEqual(selecionaRoteiro('26 - RECURSO PRÓPRIO', '05 - CLÍNICAS', ['FISIOTERAPIA', 'FONOAUDIOLOGIA', 'PSICOLOGIA', 'TERAPIA OCUPACIONAL']), { cod: 'FOR-005', confianca: 'Média' });
  assert.deepEqual(selecionaRoteiro('26 - RECURSO PRÓPRIO', '05 - CLÍNICAS', ['ANÁLISES CLÍNICAS DIVERSAS']), { cod: 'FOR-004', confianca: 'Média' });
  assert.deepEqual(selecionaRoteiro('26 - RECURSO PRÓPRIO', '05 - CLÍNICAS', ['GERIATRIA', 'PSICOLOGIA', 'CONSULTA COM NUTRICIONISTA']), { cod: 'FOR-006', confianca: 'Média' });
});

test('HEMOSC e grupo desconhecido = A DEFINIR', () => {
  assert.deepEqual(selecionaRoteiro('8 - HEMOSC', '', []), { cod: null, confianca: null });
  assert.deepEqual(selecionaRoteiro('99 - XPTO', '', []), { cod: null, confianca: null });
});
