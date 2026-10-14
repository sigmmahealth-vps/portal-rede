import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { executarPlano } from './sgu-sync.js';
import { planejarSync } from './sgu-sync-plan.js';
import { raw } from './sgu-test-fixtures.js';

function clienteFalso() {
  const sql: string[] = [];
  const params: unknown[][] = [];
  let id = 1000;
  return {
    sql, params,
    query: async (text: string, p: unknown[] = []) => {
      sql.push(text.replace(/\s+/g, ' ')); params.push(p);
      return { rows: [{ id: ++id }], rowCount: 1 };
    },
  };
}

test('acesso novo nasce com a senha padrão (bcrypt) e troca obrigatória', async () => {
  const plano = planejarSync([raw({ codigo_prestador: '2000001', numero_documento: '11111111111' })], []);
  const c = clienteFalso();
  await executarPlano(c, plano, new Map(), 'Senha@Teste1');
  const i = c.sql.findIndex((s) => /INSERT INTO users\b/i.test(s));
  const [, , hash, mustChange] = c.params[i] as [unknown, unknown, string, boolean];
  assert.match(hash, /^\$2[aby]\$10\$/);
  assert.equal(await bcrypt.compare('Senha@Teste1', hash), true);
  assert.equal(mustChange, true);
});

test('sem senha padrão o acesso novo nasce sem senha', async () => {
  const plano = planejarSync([raw({ codigo_prestador: '2000001', numero_documento: '11111111111' })], []);
  const c = clienteFalso();
  await executarPlano(c, plano, new Map(), '');
  const i = c.sql.findIndex((s) => /INSERT INTO users\b/i.test(s));
  const [, , hash, mustChange] = c.params[i] as [unknown, unknown, unknown, boolean];
  assert.equal(hash, null);
  assert.equal(mustChange, false);
});

test('executarPlano nunca altera nem apaga users/user_locations e cria 1 acesso por unidade nova', async () => {
  const plano = planejarSync([
    raw(),
    raw({ codigo_tipo_endereco: '3', logradouro: 'RUA B', numero_endereco: '10' }),
    raw({ codigo_prestador: '2000001', nome_prestador: 'NOVO', numero_documento: '11111111111' }),
  ], [
    { id: 10, sgu_code: '1000546', status: 'ativo', source: 'sgu', locations: [
      { id: 100, sgu_location_code: '1000546-2', active: true },
      { id: 101, sgu_location_code: '1000546-9', active: true }] },
    { id: 11, sgu_code: '5000001', status: 'ativo', source: 'sgu', locations: [] },
  ]);
  const c = clienteFalso();
  const g = await executarPlano(c, plano, new Map());
  assert.equal(c.sql.filter((s) => /\b(UPDATE|DELETE FROM)\s+(users|user_locations)\b/i.test(s)).length, 0);
  assert.equal(c.sql.filter((s) => /INSERT INTO users\b/i.test(s)).length, 2);
  assert.equal(c.sql.filter((s) => /INSERT INTO user_locations\b/i.test(s)).length, 2);
  assert.deepEqual(g, { criados: 1, atualizados: 1, excluidos_por_ausencia: 1, unidades_criadas: 2,
    unidades_atualizadas: 1, unidades_inativadas: 1, acessos_criados: 2, documentos_descartados: 0 });
});
