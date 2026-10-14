/**
 * Rotina diária SGU → cadastro (spec docs/superpowers/specs/2026-10-14-sgu-sync-fase2-design.md).
 * Nunca altera nem apaga users/user_locations: só cria o acesso de unidade nova.
 */
import 'dotenv/config';
import { deriveProviderRole } from './provider-role.js';
import { type ParsedLocation } from './providers-parser.js';
import { type TabelaProvider } from './tabela-parser.js';
import { type PlanoSync } from './sgu-sync-plan.js';

export interface Consulta {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
}

// Inativo pela rotina = só cadastro vindo do SGU fora de 'ativo'; cadastro manual nunca é suspenso.
export const PRESTADOR_ATIVO_SQL = `(p.source IS DISTINCT FROM 'sgu' OR p.status = 'ativo')`;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface Gravado {
  criados: number; atualizados: number; excluidos_por_ausencia: number;
  unidades_criadas: number; unidades_atualizadas: number; unidades_inativadas: number; acessos_criados: number;
}

// $2..$15 comuns ao INSERT e ao UPDATE de providers.
const colunas = (p: TabelaProvider, scriptId: number | null) => [
  p.name, p.trade_name, p.person_type, p.cnpj, p.cpf, p.council_registry, JSON.stringify(p.specialties),
  p.provider_type, p.provider_group, p.status, p.responsavel_tecnico, scriptId, p.roteiro_cod, p.roteiro_confianca,
];

// Unidade nova + o acesso dela (mesma regra do provision-users: sem senha, sem convite,
// e-mail cadastral válido ou NULL).
async function criarUnidade(c: Consulta, providerId: number, prestador: TabelaProvider, loc: ParsedLocation) {
  const { rows } = await c.query(
    `INSERT INTO provider_locations (provider_id, sgu_location_code, sgu_tipo_endereco, label, cep, logradouro,
       numero, complemento, bairro, cidade, uf, phone, email, is_primary, in_medical_guide, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true) RETURNING id`,
    [providerId, loc.sgu_location_code, loc.sgu_tipo_endereco ?? null, loc.label, loc.cep, loc.logradouro,
     loc.numero, loc.complemento, loc.bairro, loc.cidade, loc.uf, loc.phone, loc.email, loc.is_primary,
     loc.in_medical_guide]);
  const email = loc.email && EMAIL_RE.test(loc.email.trim()) ? loc.email.trim().toLowerCase() : null;
  const { rows: u } = await c.query(
    `INSERT INTO users (name, email, password, role, provider_id, is_active, invite_status)
     VALUES ($1, $2, NULL, $3, $4, true, 'pending') RETURNING id`,
    [prestador.name, email, deriveProviderRole(prestador.person_type, prestador.provider_group), providerId]);
  await c.query(
    `INSERT INTO user_locations (user_id, location_id, provider_id) VALUES ($1, $2, $3)`,
    [u[0].id, rows[0].id, providerId]);
}

export async function executarPlano(c: Consulta, plano: PlanoSync, scriptPorRoteiro: Map<string, number>): Promise<Gravado> {
  const g: Gravado = { criados: 0, atualizados: 0, excluidos_por_ausencia: 0, unidades_criadas: 0,
    unidades_atualizadas: 0, unidades_inativadas: 0, acessos_criados: 0 };
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
       RETURNING id`,
      [p.sgu_code, ...colunas(p, script(p))]);
    g.criados++;
    for (const loc of p.locations) {
      await criarUnidade(c, Number(rows[0].id), p, loc);
      g.unidades_criadas++; g.acessos_criados++;
    }
  }

  for (const { id, p } of plano.atualizar) {
    await c.query(
      `UPDATE providers SET name = $2, trade_name = $3, person_type = $4,
         cnpj = CASE WHEN EXISTS (SELECT 1 FROM providers o WHERE o.cnpj = $5::text AND o.id <> $1) THEN cnpj ELSE $5::text END,
         cpf  = CASE WHEN EXISTS (SELECT 1 FROM providers o WHERE o.cpf = $6::text AND o.id <> $1) THEN cpf ELSE $6::text END,
         council_registry = $7, specialties = $8::jsonb, provider_type = $9, provider_group = $10, status = $11,
         responsavel_tecnico = COALESCE($12, responsavel_tecnico),
         eval_script_id = COALESCE($13, CASE WHEN roteiro_cod IS NOT DISTINCT FROM $14 THEN eval_script_id END),
         roteiro_cod = $14, roteiro_confianca = $15, sgu_synced_at = now()
       WHERE id = $1`,
      [id, ...colunas(p, script(p))]);
    g.atualizados++;
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
    await criarUnidade(c, provider_id, prestador, loc);
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
