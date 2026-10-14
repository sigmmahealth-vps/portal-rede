/**
 * Compara a sgu_providers_raw (extração do SGU) com o cadastro de prestadores do Portal.
 * Só lê o cadastro; a única escrita é o registro da execução em sgu_sync_runs.
 *   APP_ENV=dev npx tsx db/sgu-diff.ts
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { pickDatabaseUrl } from './resolveDbUrl.js';
import { query, pool } from './db.js';
import { diffProviders, dataCivil, type DiffReport, type PortalProvider, type SguRawRow } from './sgu-raw.js';

const LISTA = 15;

export async function lerPortal(): Promise<PortalProvider[]> {
  const { rows } = await query<PortalProvider>(`
    SELECT p.sgu_code, p.name, p.trade_name, p.cnpj, p.cpf, p.status, p.provider_type, p.provider_group,
           p.specialties, p.responsavel_tecnico, p.roteiro_cod,
           EXISTS (SELECT 1 FROM eval_instances e WHERE e.provider_id = p.id) AS tem_avaliacao,
           COALESCE((
             SELECT json_agg(json_build_object(
                      'cep', l.cep, 'logradouro', l.logradouro, 'numero', l.numero,
                      'complemento', l.complemento, 'bairro', l.bairro, 'cidade', l.cidade, 'uf', l.uf,
                      'phone', l.phone, 'email', l.email, 'in_medical_guide', l.in_medical_guide)
                    ORDER BY l.id)
               FROM provider_locations l
              WHERE l.provider_id = p.id AND l.active), '[]'::json) AS locations
      FROM providers p
     WHERE p.source = 'sgu'`);
  return rows;
}

function imprimir(r: DiffReport, manuais: number) {
  const porStatus = (xs: { status: string | null }[]) => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(x.status ?? '(vazio)', (m.get(x.status ?? '(vazio)') ?? 0) + 1);
    return [...m].map(([k, v]) => `${k}=${v}`).join(', ') || '0';
  };
  const lista = <T>(titulo: string, xs: T[], fmt: (x: T) => string, todos = false) => {
    console.log(`\n${titulo}: ${xs.length}`);
    for (const x of todos ? xs : xs.slice(0, LISTA)) console.log(`   - ${fmt(x)}`);
    if (!todos && xs.length > LISTA) console.log(`   ... (+${xs.length - LISTA})`);
  };

  console.log(`\nNovos (na raw, fora do Portal): ${r.novos.length} [${porStatus(r.novos)}]`);
  for (const n of r.novos.filter((x) => !x.status.startsWith('exclu')).slice(0, LISTA)) {
    console.log(`   - ${n.sgu_code} ${n.name} (${n.status}, ${n.provider_group ?? '-'}, roteiro ${n.roteiro_cod ?? 'A DEFINIR'}, ${n.unidades} unid.)`);
  }
  const novosAtivos = r.novos.filter((x) => !x.status.startsWith('exclu')).length;
  if (novosAtivos > LISTA) console.log(`   ... (+${novosAtivos - LISTA})`);
  lista('Ausentes (no Portal, fora da raw)', r.ausentes,
    (a) => `${a.sgu_code} ${a.name} (${a.status ?? '-'})${a.tem_avaliacao ? ' — TEM AVALIAÇÃO' : ''}`);
  console.log(`   com avaliação: ${r.ausentes.filter((a) => a.tem_avaliacao).length}`);
  lista('Alterados', r.alterados,
    (a) => `${a.sgu_code} ${a.name}: ${a.campos.map((c) => `${c.campo} ${JSON.stringify(c.portal)} → ${JSON.stringify(c.sgu)}`).join('; ')}`);
  const tot = (k: 'novas' | 'removidas' | 'alteradas') => r.unidades.reduce((s, u) => s + u[k].length, 0);
  lista(`Prestadores com mudança de unidade (novas ${tot('novas')}, removidas ${tot('removidas')}, alteradas ${tot('alteradas')})`,
    r.unidades, (u) => `${u.sgu_code} ${u.name}: +${u.novas.length} −${u.removidas.length} ~${u.alteradas.length}`);
  lista('Exclusões agendadas (ATIVO com exclusão futura)', r.afastamentos.filter((a) => a.situacao === 'exclusao_agendada'),
    (a) => `${a.sgu_code} ${a.name}: exclusão em ${a.inicio} (${a.motivo ?? 'sem motivo'})`, true);
  lista('Afastamento/exclusão (demais)', r.afastamentos.filter((a) => a.situacao !== 'exclusao_agendada'),
    (a) => `${a.sgu_code} ${a.name}: ${a.situacao} — ${a.operacao} ${a.inicio ?? ''}${a.fim ? ` a ${a.fim}` : ''} (${a.motivo ?? 'sem motivo'})`);
  console.log(`\nCadastros manuais fora da comparação: ${manuais} | avisos do parser: ${r.avisos.length}`);
}

async function main() {
  const url = pickDatabaseUrl();
  console.log(`APP_ENV=${process.env.APP_ENV ?? '(vazio)'} | banco: ${url ? new URL(url).host : '(vazio)'}`);
  try {
    const { rows: raw } = await query<SguRawRow>(
      `SELECT *, dh_carga::text AS dh_carga_txt FROM sgu_providers_raw
        ORDER BY codigo_prestador, codigo_tipo_endereco, especialidade_grupo_servico`);
    if (!raw.length) throw new Error('sgu_providers_raw está vazia — nada a comparar.');
    const cargas = new Set(raw.map((r) => (r.dh_carga instanceof Date ? r.dh_carga.getTime() : String(r.dh_carga))));
    if (cargas.size > 1) throw new Error(`sgu_providers_raw tem ${cargas.size} cargas (dh_carga) misturadas — comparação abortada.`);
    const dhCarga = raw[0].dh_carga;
    console.log(`Raw: ${raw.length} linhas, carga de ${dhCarga instanceof Date ? dhCarga.toLocaleString('pt-BR') : dhCarga}`);

    const portal = await lerPortal();
    const { rows: [{ n: manuais }] } = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM providers WHERE source IS DISTINCT FROM 'sgu'`);
    const report = diffProviders(raw, portal, dataCivil(new Date())!);
    imprimir(report, manuais);

    const message = `novos ${report.novos.length}, ausentes ${report.ausentes.length}, alterados ${report.alterados.length}, `
      + `unidades ${report.unidades.length}, afastamentos ${report.afastamentos.length}`;
    await query(
      `INSERT INTO sgu_sync_runs (source, status, message, raw_loaded_at, report, finished_at)
       -- texto da mesma leitura da raw: o Date do JS corta os microssegundos e uma carga nova entre as consultas
       VALUES ('sgu-raw-diff', 'success', $1, $3::timestamp, $2, now())`,
      [message, JSON.stringify({ ...report, manuais }), raw[0].dh_carga_txt]);
    console.log(`\n✔ Registrado em sgu_sync_runs: ${message}`);
  } catch (err: any) {
    await query(
      `INSERT INTO sgu_sync_runs (source, status, message, finished_at) VALUES ('sgu-raw-diff', 'error', $1, now())`,
      [String(err?.message ?? err)]).catch(() => {});
    throw err;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
