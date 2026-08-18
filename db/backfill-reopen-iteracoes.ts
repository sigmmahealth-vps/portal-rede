// Corrige instâncias devolvidas integralmente (POST /reopen) ANTES do fix ad60d81:
// ficaram em aguardando_evidencia sem nenhum critério liberado (nenhuma iteração
// 'solicitou_reanalise'), então o prestador não conseguia anexar nem salvar nada.
// Insere a mesma iteração que o /reopen corrigido passou a gravar, por critério
// não decidido (aprovado/reprovado seguem travados — D-04).
//
// Uso: [APP_ENV=homolog] node --import tsx db/backfill-reopen-iteracoes.ts [--commit]
// Dry-run por padrão. Idempotente: só considera instância presa (zero iterações
// de reanálise), então rodar de novo não duplica nada.
import 'dotenv/config';
import { query, pool, withTransaction } from './db.js';

const COMMIT = process.argv.includes('--commit');

async function main() {
  const url = new URL(process.env[`DATABASE_URL_${(process.env.APP_ENV || 'dev').toUpperCase()}`] || process.env.DATABASE_URL || '');
  console.log(`[backfill-reopen] APP_ENV=${process.env.APP_ENV || '(vazio)'} host=${url.hostname}:${url.port} ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);

  // Instância presa: devolvida (aguardando_evidencia) mas sem nenhum critério
  // liberado — nem status 'aguardando_reanalise' nem histórico de reanálise.
  const { rows: stuck } = await query(`
    SELECT ei.id, ei.provider_id, p.name AS provider_name,
           (SELECT COUNT(*) FROM eval_answers ea
             WHERE ea.instance_id = ei.id
               AND COALESCE(ea.evidence_status, 'pendente') NOT IN ('aprovado','reprovado')) AS to_mark,
           (SELECT al.user_id FROM access_logs al
             WHERE al.action = 'evaluation_reopened' AND (al.meta->>'instance_id')::bigint = ei.id
             ORDER BY al.created_at DESC LIMIT 1) AS reopen_actor
      FROM eval_instances ei
      JOIN providers p ON p.id = ei.provider_id
     WHERE ei.status = 'aguardando_evidencia'
       AND NOT EXISTS (
         SELECT 1 FROM eval_answers ea
          WHERE ea.instance_id = ei.id
            AND (ea.evidence_status = 'aguardando_reanalise'
                 OR EXISTS (SELECT 1 FROM eval_answer_iterations it
                             WHERE it.answer_id = ea.id AND it.action = 'solicitou_reanalise'))
       )
     ORDER BY ei.id
  `);

  if (!stuck.length) {
    console.log('[backfill-reopen] nenhuma instância presa encontrada. Nada a fazer.');
    return;
  }
  for (const s of stuck) {
    console.log(`  instância ${s.id} — ${s.provider_name} — ${s.to_mark} critérios a liberar (actor ${s.reopen_actor ?? 'desconhecido'})`);
  }

  if (!COMMIT) {
    console.log('[backfill-reopen] dry-run: nada gravado. Rode com --commit para aplicar.');
    return;
  }

  for (const s of stuck) {
    await withTransaction(async (client) => {
      const res = await client.query(`
        INSERT INTO eval_answer_iterations
          (answer_id, iteration_number, actor_id, actor_role, action, answer_value, score_obtained, evidence_url, observation)
        SELECT ea.id,
               COALESCE((SELECT MAX(it.iteration_number) FROM eval_answer_iterations it WHERE it.answer_id = ea.id), 0) + 1,
               $2, 'auditor', 'solicitou_reanalise', ea.answer_value, ea.score_obtained, ea.evidence_url,
               'Avaliação devolvida integralmente ao prestador (backfill)'
          FROM eval_answers ea
         WHERE ea.instance_id = $1
           AND COALESCE(ea.evidence_status, 'pendente') NOT IN ('aprovado','reprovado')
      `, [s.id, s.reopen_actor]);
      console.log(`[backfill-reopen] instância ${s.id}: ${res.rowCount} iterações gravadas`);
    });
  }
  console.log('[backfill-reopen] concluído.');
}

main()
  .then(() => pool.end())
  .catch((err) => { console.error(err); process.exit(1); });
