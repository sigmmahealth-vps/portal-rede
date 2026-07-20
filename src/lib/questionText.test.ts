import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questionOnly } from './questionText.js';

test('corta antes do marcador "DL"/"S"/"E" da legislação', () => {
  assert.equal(
    questionOnly('Dispõe de alvará do Corpo de Bombeiros. "DL" Lei Federal 13.425/2017'),
    'Dispõe de alvará do Corpo de Bombeiros.',
  );
  assert.equal(
    questionOnly('Possui descrito norma (POPS ou fluxos). "S" ANVISA - RDC 63/2011 Art. 51'),
    'Possui descrito norma (POPS ou fluxos).',
  );
  assert.equal(
    questionOnly('Aplica pesquisa de satisfação. "E" Boas práticas'),
    'Aplica pesquisa de satisfação.',
  );
});

test('preserva o ? quando pergunta termina em interrogação e vem seguida do marcador', () => {
  assert.equal(
    questionOnly('Dispõe de alvará válido? "DL" Legislação Municipal e ANVISA'),
    'Dispõe de alvará válido?',
  );
});

test('sem marcador de legislação: cai no primeiro "?"', () => {
  assert.equal(questionOnly('Quanto tempo? Muito.'), 'Quanto tempo?');
});

test('sem marcador e sem "?": devolve o texto integral', () => {
  assert.equal(questionOnly('Descrição livre sem interrogação'), 'Descrição livre sem interrogação');
});

test('lida com null/undefined via optional chaining seguro', () => {
  assert.equal(questionOnly(null as any), '');
  assert.equal(questionOnly(undefined as any), '');
});

test('não confunde marcador com aspas contendo palavra normal', () => {
  // "Dr" não deveria ser tratado como marcador (só 1-3 letras maiúsculas TODAS caps)
  assert.equal(
    questionOnly('Pergunta genérica sobre o "Dr" João?'),
    'Pergunta genérica sobre o "Dr" João?',
  );
});
