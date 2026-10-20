/**
 * Rotina diária SGU → cadastro (spec docs/superpowers/specs/2026-10-14-sgu-sync-fase2-design.md).
 * Nunca altera nem apaga users/user_locations: só cria o acesso de unidade nova.
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { deriveProviderRole } from './provider-role.js';
import { type ParsedLocation } from './providers-parser.js';
import { type TabelaProvider } from './tabela-parser.js';
import { pathToFileURL } from 'node:url';
import { pool, query, withTransaction } from './db.js';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import { dataCivil, diffProviders } from './sgu-raw.js';
import { lerPortal } from './sgu-diff.js';
import { checarTravas, planejarSync, type PlanoSync, type PortalPrestadorSync } from './sgu-sync-plan.js';

export interface Consulta {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
}

// Inativo pela rotina = só cadastro vindo do SGU fora de 'ativo'; cadastro manual nunca é suspenso.
export const PRESTADOR_ATIVO_SQL = `(p.source IS DISTINCT FROM 'sgu' OR p.status = 'ativo')`;

// Unidade elegível ao ciclo (regra da Unimed, 19/10/2026 — antes era "imprimir no guia médico"): fica fora
// quem na carga do SGU tem divulga_a400 = N ou suspende_atendimento = S; o resto entra. Cadastro manual
// (fora do SGU) segue pelo guia médico. Aliases: p = providers, pl = provider_locations.
const RAW_DA_UNIDADE = `sgu_providers_raw r WHERE r.codigo_prestador::text || '-' || r.codigo_tipo_endereco::text = pl.sgu_location_code`;
export const UNIDADE_ELEGIVEL_SQL = `(CASE WHEN p.source = 'sgu' THEN
    EXISTS (SELECT 1 FROM ${RAW_DA_UNIDADE})
    AND NOT EXISTS (SELECT 1 FROM ${RAW_DA_UNIDADE}
      AND (upper(btrim(coalesce(r.divulga_a400, ''))) = 'N' OR upper(btrim(coalesce(r.suspende_atendimento, ''))) = 'S'))
  ELSE pl.in_medical_guide END)`;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface Gravado {
  criados: number; atualizados: number; excluidos_por_ausencia: number;
  unidades_criadas: number; unidades_atualizadas: number; unidades_inativadas: number; acessos_criados: number;
  documentos_descartados: number;
}

// $2..$15 comuns ao INSERT e ao UPDATE de providers.
const colunas = (p: TabelaProvider, scriptId: number | null) => [
  p.name, p.trade_name, p.person_type, p.cnpj, p.cpf, p.council_registry, JSON.stringify(p.specialties),
  p.provider_type, p.provider_group, p.status, p.responsavel_tecnico, scriptId, p.roteiro_cod, p.roteiro_confianca,
];

// Unidade nova + o acesso dela: sem convite, e-mail cadastral válido ou NULL; senha = a padrão da Unimed
// (SENHA_PADRAO_PRESTADOR, troca obrigatória no 1º acesso) ou nenhuma, se a variável não existir.
async function criarUnidade(c: Consulta, providerId: number, prestador: TabelaProvider, loc: ParsedLocation,
                            senhaHash: string | null) {
  const { rows } = await c.query(
    `INSERT INTO provider_locations (provider_id, sgu_location_code, sgu_tipo_endereco, label, cep, logradouro,
       numero, complemento, bairro, cidade, uf, phone, email, is_primary, in_medical_guide, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true) RETURNING id`,
    [providerId, loc.sgu_location_code, loc.sgu_tipo_endereco ?? null, loc.label, loc.cep, loc.logradouro,
     loc.numero, loc.complemento, loc.bairro, loc.cidade, loc.uf, loc.phone, loc.email, loc.is_primary,
     loc.in_medical_guide]);
  const email = loc.email && EMAIL_RE.test(loc.email.trim()) ? loc.email.trim().toLowerCase() : null;
  const { rows: u } = await c.query(
    `INSERT INTO users (name, email, password, must_change_password, role, provider_id, is_active, invite_status)
     VALUES ($1, $2, $3, $4, $5, $6, true, 'pending') RETURNING id`,
    [prestador.name, email, senhaHash, senhaHash != null,
     deriveProviderRole(prestador.person_type, prestador.provider_group), providerId]);
  await c.query(
    `INSERT INTO user_locations (user_id, location_id, provider_id) VALUES ($1, $2, $3)`,
    [u[0].id, rows[0].id, providerId]);
}

export async function executarPlano(c: Consulta, plano: PlanoSync, scriptPorRoteiro: Map<string, number>,
                                    senhaPadrao: string | undefined = process.env.SENHA_PADRAO_PRESTADOR): Promise<Gravado> {
  const senhaHash = senhaPadrao ? await bcrypt.hash(senhaPadrao, 10) : null;
  const g: Gravado = { criados: 0, atualizados: 0, excluidos_por_ausencia: 0, unidades_criadas: 0,
    unidades_atualizadas: 0, unidades_inativadas: 0, acessos_criados: 0, documentos_descartados: 0 };
  const script = (p: TabelaProvider) => (p.roteiro_cod ? scriptPorRoteiro.get(p.roteiro_cod) ?? null : null);

  for (const p of plano.inserir) {
    // CPF/CNPJ já usado por outro cadastro (índice único): grava sem o documento em vez de abortar a carga.
    const { rows } = await c.query(
      `INSERT INTO providers (sgu_code, name, trade_name, person_type, cnpj, cpf, council_registry, specialties,
         provider_type, provider_group, status, responsavel_tecnico, eval_script_id, roteiro_cod, roteiro_confianca,
         source, sgu_synced_at)
       VALUES ($1, $2, $3, $4,
         CASE WHEN EXISTS (SELECT 1 FROM providers o WHERE o.cnpj = $5::text) THEN NULL ELSE $5::text END,
         CASE WHEN EXISTS (SELECT 1 FROM providers o WHERE o.cpf = $6::text) THEN NULL ELSE $6::text END,
         $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, 'sgu', now())
       RETURNING id, (cnpj IS NULL AND $5::text IS NOT NULL) OR (cpf IS NULL AND $6::text IS NOT NULL) AS doc_descartado`,
      [p.sgu_code, ...colunas(p, script(p))]);
    g.criados++;
    if (rows[0].doc_descartado) g.documentos_descartados++;
    for (const loc of p.locations) {
      await criarUnidade(c, Number(rows[0].id), p, loc, senhaHash);
      g.unidades_criadas++; g.acessos_criados++;
    }
  }

  for (const { id, p } of plano.atualizar) {
    const { rows } = await c.query(
      `UPDATE providers SET name = $2, trade_name = $3, person_type = $4,
         cnpj = CASE WHEN EXISTS (SELECT 1 FROM providers o WHERE o.cnpj = $5::text AND o.id <> $1) THEN cnpj ELSE $5::text END,
         cpf  = CASE WHEN EXISTS (SELECT 1 FROM providers o WHERE o.cpf = $6::text AND o.id <> $1) THEN cpf ELSE $6::text END,
         council_registry = $7, specialties = $8::jsonb, provider_type = $9, provider_group = $10, status = $11,
         responsavel_tecnico = COALESCE($12, responsavel_tecnico),
         eval_script_id = COALESCE($13, CASE WHEN roteiro_cod IS NOT DISTINCT FROM $14 THEN eval_script_id END),
         roteiro_cod = $14, roteiro_confianca = $15, sgu_synced_at = now()
       WHERE id = $1
       RETURNING (cnpj IS DISTINCT FROM $5::text AND $5::text IS NOT NULL) OR (cpf IS DISTINCT FROM $6::text AND $6::text IS NOT NULL) AS doc_mantido`,
      [id, ...colunas(p, script(p))]);
    g.atualizados++;
    if (rows[0]?.doc_mantido) g.documentos_descartados++;
  }

  for (const { id, loc } of plano.unidadesAtualizar) {
    await c.query(
      `UPDATE provider_locations SET sgu_tipo_endereco = $2, label = $3, cep = $4, logradouro = $5, numero = $6,
         complemento = $7, bairro = $8, cidade = $9, uf = $10, phone = $11, email = $12, is_primary = $13,
         in_medical_guide = $14, active = true
       WHERE id = $1`,
      [id, loc.sgu_tipo_endereco ?? null, loc.label, loc.cep, loc.logradouro, loc.numero, loc.complemento,
       loc.bairro, loc.cidade, loc.uf, loc.phone, loc.email, loc.is_primary, loc.in_medical_guide]);
    g.unidades_atualizadas++;
  }

  for (const { provider_id, prestador, loc } of plano.unidadesNovas) {
    await criarUnidade(c, provider_id, prestador, loc, senhaHash);
    g.unidades_criadas++; g.acessos_criados++;
  }

  if (plano.unidadesInativar.length) {
    const r = await c.query(
      `UPDATE provider_locations SET active = false WHERE id = ANY($1::bigint[]) AND active`, [plano.unidadesInativar]);
    g.unidades_inativadas = r.rowCount ?? 0;
  }
  if (plano.excluirPorAusencia.length) {
    const r = await c.query(
      `UPDATE providers SET status = 'excluído', sgu_synced_at = now() WHERE id = ANY($1::bigint[]) AND source = 'sgu'`,
      [plano.excluirPorAusencia]);
    g.excluidos_por_ausencia = r.rowCount ?? 0;
  }
  return g;
}

const NAO_SUSPENDE = `('aprovado', 'reprovado', 'finalizado', 'ciclo_encerrado', 'suspensa')`;

// Avaliações do ciclo ativo: suspende as de prestador/unidade inativo e restaura as que voltaram.
// Estado → efeito (idempotente): pode rodar a cada carga sem acumular.
export async function suspenderERestaurar(c: Consulta): Promise<{ suspensas: number; restauradas: number }> {
  const s = await c.query(`
    UPDATE eval_instances ei SET status_before_suspend = ei.status, status = 'suspensa'
      FROM eval_cycles cy, providers p
     WHERE cy.id = ei.cycle_id AND cy.active AND p.id = ei.provider_id
       AND NOT (${PRESTADOR_ATIVO_SQL}
                AND COALESCE((SELECT pl.active FROM provider_locations pl WHERE pl.id = ei.location_id), true))
       AND ei.status NOT IN ${NAO_SUSPENDE}`);
  const r = await c.query(`
    UPDATE eval_instances ei SET status = COALESCE(ei.status_before_suspend, 'pendente'), status_before_suspend = NULL
      FROM eval_cycles cy, providers p
     WHERE cy.id = ei.cycle_id AND cy.active AND p.id = ei.provider_id
       AND ei.status = 'suspensa' AND ${PRESTADOR_ATIVO_SQL}
       AND COALESCE((SELECT pl.active FROM provider_locations pl WHERE pl.id = ei.location_id), true)`);
  return { suspensas: s.rowCount ?? 0, restauradas: r.rowCount ?? 0 };
}

async function lerPortalSync(c: Consulta): Promise<PortalPrestadorSync[]> {
  const { rows } = await c.query(`
    SELECT p.id, p.sgu_code, p.status, p.source,
           COALESCE((SELECT json_agg(json_build_object('id', l.id, 'sgu_location_code', l.sgu_location_code,
                                                       'active', l.active))
                       FROM provider_locations l WHERE l.provider_id = p.id), '[]'::json) AS locations
      FROM providers p
     WHERE p.sgu_code IS NOT NULL`);
  return rows.map((r) => ({
    id: Number(r.id), sgu_code: r.sgu_code, status: r.status, source: r.source,
    locations: r.locations.map((l: any) => ({ id: Number(l.id), sgu_location_code: l.sgu_location_code, active: l.active })),
  }));
}

// FOR-NNN → id do roteiro (o mais recente vence), como no import-tabela.
async function scriptPorRoteiro(c: Consulta): Promise<Map<string, number>> {
  const { rows } = await c.query('SELECT id, source_file FROM eval_scripts ORDER BY id');
  const m = new Map<string, number>();
  for (const r of rows) {
    const f = /FOR-(\d+)/i.exec(r.source_file ?? '');
    if (f) m.set(`FOR-${f[1]}`, Number(r.id));
  }
  return m;
}

export type ResultadoSync = {
  status: 'aplicado' | 'simulado' | 'sem_carga_nova' | 'ocupado';
  message: string;
  plano?: PlanoSync;
  gravado?: Gravado & { suspensas: number; restauradas: number };
};

// forcar=false (job): só pula carga já aplicada com sucesso; erro tenta de novo na próxima volta (30 min).
// forcar=true (comando manual): aplica sempre.
export async function rodarSguSync(opts: { commit: boolean; forcar: boolean }): Promise<ResultadoSync> {
  let carga: string | null = null;
  try {
    return await withTransaction(async (c): Promise<ResultadoSync> => {
      const { rows: [lock] } = await c.query(`SELECT pg_try_advisory_xact_lock(hashtext('sgu-sync')) AS ok`);
      if (!lock.ok) return { status: 'ocupado', message: 'outra execução em andamento' };
      const { rows: [{ n: semCodigo }] } = await c.query(
        `SELECT count(*)::int AS n FROM provider_locations pl JOIN providers p ON p.id = pl.provider_id
          WHERE p.source = 'sgu' AND pl.active AND pl.sgu_tipo_endereco IS NULL`);
      if (semCodigo > 0) throw new Error(`${semCodigo} unidade(s) ativa(s) sem código estável — rode db:sgu-rekey antes da rotina.`);
      const { rows: raw } = await c.query(
        `SELECT *, dh_carga::text AS dh_carga_txt FROM sgu_providers_raw
          ORDER BY codigo_prestador, codigo_tipo_endereco, especialidade_grupo_servico`);
      carga = raw[0]?.dh_carga_txt ?? null;
      if (!opts.forcar && carga) {
        const { rows: [ult] } = await c.query(
          `SELECT raw_loaded_at::text AS t FROM sgu_sync_runs
            WHERE source = 'sgu-sync' AND status = 'success' AND raw_loaded_at IS NOT NULL ORDER BY id DESC LIMIT 1`);
        if (ult?.t === carga) return { status: 'sem_carga_nova', message: `carga ${carga} já aplicada` };
      }
      const plano = planejarSync(raw, await lerPortalSync(c));
      const trava = checarTravas(raw, plano);
      if (trava) throw new Error(trava);
      const resumo = `novos ${plano.inserir.length}, atualizados ${plano.atualizar.length}, `
        + `excluídos por ausência ${plano.excluirPorAusencia.length}, unidades novas ${plano.unidadesNovas.length}, `
        + `unidades inativadas ${plano.unidadesInativar.length}, ignorados `
        + `${plano.ignorados.excluido_novo.length + plano.ignorados.grupo_27.length + plano.ignorados.intercambio.length + plano.ignorados.manual.length}`;
      if (!opts.commit) return { status: 'simulado', message: resumo, plano };

      const diff = diffProviders(raw, await lerPortal(), dataCivil(new Date())!);
      const gravado = { ...(await executarPlano(c, plano, await scriptPorRoteiro(c))), ...(await suspenderERestaurar(c)) };
      const message = `${resumo}; avaliações suspensas ${gravado.suspensas}, restauradas ${gravado.restauradas}`;
      await c.query(
        `INSERT INTO sgu_sync_runs (source, status, raw_loaded_at, providers_upserted, locations_upserted, message, report, finished_at)
         VALUES ('sgu-sync', 'success', $1::timestamp, $2, $3, $4, $5, now())`,
        [carga, gravado.criados + gravado.atualizados, gravado.unidades_criadas + gravado.unidades_atualizadas,
         message, JSON.stringify({ diff, gravado, ignorados: plano.ignorados })]);
      return { status: 'aplicado', message, plano, gravado };
    });
  } catch (err: any) {
    if (opts.commit) {
      await query(
        `INSERT INTO sgu_sync_runs (source, status, raw_loaded_at, message, finished_at)
         VALUES ('sgu-sync', 'error', $1::timestamp, $2, now())`,
        [carga, String(err?.message ?? err)]).catch(() => {});
    }
    throw err;
  }
}

async function main() {
  const commit = process.argv.includes('--commit');
  const url = pickDatabaseUrl();
  console.log(`APP_ENV=${process.env.APP_ENV ?? '(vazio)'} | banco: ${url ? new URL(url).host : '(vazio)'} | ${commit ? 'COMMIT' : 'DRY-RUN'}`);
  try {
    const r = await rodarSguSync({ commit, forcar: true });
    console.log(`${r.status}: ${r.message}`);
    if (r.plano) {
      console.log(`ignorados: EXCLUÍDO novo ${r.plano.ignorados.excluido_novo.length}, grupo 27 ${r.plano.ignorados.grupo_27.length}, intercâmbio ${r.plano.ignorados.intercambio.length}, cadastro manual ${r.plano.ignorados.manual.length}`);
      console.log(`ativos que viram excluídos: ${r.plano.ativosQueSaem} de ${r.plano.ativos}`);
    }
    if (r.gravado) console.log(JSON.stringify(r.gravado));
    if (!commit) console.log('Dry-run: nada gravado. Para aplicar: --commit');
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
