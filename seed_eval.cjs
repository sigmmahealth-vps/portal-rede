const Database = require('better-sqlite3');
const db = new Database('unimed_mvp.db');

const scriptCount = db.prepare('SELECT COUNT(*) as c FROM eval_scripts').get();
if (scriptCount.c === 0) {
  const insertScript = db.prepare('INSERT INTO eval_scripts (title, description, version, created_at) VALUES (?, ?, ?, ?)');
  const scriptId = insertScript.run('Roteiro RN 630 - Profissionais Não Médicos', 'Avaliação técnica para operadora de saúde conforme RN 630 da ANS', '1.0', new Date().toISOString()).lastInsertRowid;

  const insertSection = db.prepare('INSERT INTO eval_sections (script_id, parent_section_id, name, order_index) VALUES (?, ?, ?, ?)');
  
  const sec1 = insertSection.run(scriptId, null, '1. CONDIÇÕES ORGANIZACIONAIS', 1).lastInsertRowid;
  const sec11 = insertSection.run(scriptId, sec1, '1.1 DOCUMENTAÇÕES MANDATÓRIAS', 1).lastInsertRowid;
  
  const insertQuestion = db.prepare(`INSERT INTO eval_questions (section_id, code, text, legislation, type, weight, max_score, evidence_required, is_eliminatory, order_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  insertQuestion.run(sec11, '1.1.1', 'Dispõe de alvará de funcionamento válido e expedido pelo órgão competente?', 'ANVISA - RDC 63/2011', 'sim_nao', 10, 10, 1, 1, 1);
  insertQuestion.run(sec11, '1.1.2', 'Dispõe de alvará do Corpo de Bombeiros/Auto de Vistoria do Corpo de Bombeiros.', 'Lei Federal 13.425/2017', 'sim_nao', 10, 10, 1, 1, 2);
  insertQuestion.run(sec11, '1.1.3', 'Dispõe de alvará sanitário válido ou protocolo de solicitação?', 'ANVISA - RDC 63/2011', 'sim_nao', 10, 10, 1, 1, 3);
  insertQuestion.run(sec11, '1.1.4', 'Declaração de regularidade no conselho profissional.', 'ANVISA - RDC 63/2011', 'sim_nao', 10, 10, 1, 0, 4);
  insertQuestion.run(sec11, '1.1.5', 'Cadastro Nacional Estabelecimento Saúde (CNES).', 'MINISTÉRIO DA SAÚDE - Portaria 1.646/2015', 'sim_nao', 10, 10, 1, 0, 5);

  const sec12 = insertSection.run(scriptId, sec1, '1.2 PROCESSOS GERENCIAIS', 2).lastInsertRowid;
  insertQuestion.run(sec12, '1.2.1', 'Programa de educação continuada de trabalhadores.', 'ANVISA - RDC 63/2011', 'sim_nao', 20, 20, 1, 0, 1);
  insertQuestion.run(sec12, '1.2.2', 'Participou de algum treinamento realizado pela Unimed Criciúma no último ano?', 'Boas práticas', 'sim_nao', 10, 10, 1, 0, 2);
  insertQuestion.run(sec12, '1.2.3', 'Possui descrito norma, procedimentos e rotinas técnicas atualizadas (POPs ou fluxos).', 'ANVISA - RDC 63/2011', 'sim_nao', 10, 10, 1, 0, 3);

  const sec13 = insertSection.run(scriptId, sec1, '1.3 GESTÃO DA SEGURANÇA', 3).lastInsertRowid;
  insertQuestion.run(sec13, '1.3.1', 'Dispõe de PCMSO (Programa de Controle Médico e Saúde Ocupacional).', 'MINISTÉRIO DO TRABALHO - NR 7', 'sim_nao', 10, 10, 1, 0, 1);
  insertQuestion.run(sec13, '1.3.3', 'Controle vacinal dos funcionários e profissionais da clínica/consultório.', 'ANVISA - RDC 63/2011', 'sim_nao', 10, 10, 1, 0, 2);
  
  console.log('Seed completo.');
} else {
  console.log('Script ja estao cacheados.');
}
