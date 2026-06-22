// =============================================================================
// seed-synthetic.ts
// Dados SINTÉTICOS de teste: 10 prestadores + 1 local cada (região Criciúma/SC).
// Marcados por sgu_code = 'SYN-0xx' para facilitar limpeza.
//
// Uso:  npx tsx db/seed-synthetic.ts
// Limpeza: npx tsx db/seed-synthetic.ts --clean
//
// ATENÇÃO: usa DATABASE_URL do .env, que aponta para o MESMO Postgres do deploy.
// Idempotente: reexecutar atualiza os mesmos registros (ON CONFLICT por sgu_code).
// =============================================================================
import { pool, query } from './db.js';

type SyntheticProvider = {
  code: string;
  name: string;
  trade_name: string | null;
  person_type: 'PF' | 'PJ';
  cnpj: string | null;
  cpf: string | null;
  council_registry: string | null;
  specialties: string[];
  provider_group: string;
  qualification_level: string;
  status: string;
  location: {
    label: string;
    cep: string;
    logradouro: string;
    numero: string;
    bairro: string;
    cidade: string;
    uf: string;
    phone: string;
  };
};

const PROVIDERS: SyntheticProvider[] = [
  {
    code: 'SYN-001', name: 'Clínica Cardiológica Criciúma Ltda', trade_name: 'CardioCriciúma',
    person_type: 'PJ', cnpj: '10.001.001/0001-01', cpf: null, council_registry: 'CNES 2100011',
    specialties: ['Cardiologia'], provider_group: 'Cardiologia', qualification_level: 'A', status: 'Ativo',
    location: { label: 'Sede Centro', cep: '88801-100', logradouro: 'Av. Centenário', numero: '1200', bairro: 'Centro', cidade: 'Criciúma', uf: 'SC', phone: '(48) 3433-1001' },
  },
  {
    code: 'SYN-002', name: 'Centro Oftalmológico Sul Catarinense Ltda', trade_name: 'Visão Sul',
    person_type: 'PJ', cnpj: '10.002.002/0001-02', cpf: null, council_registry: 'CNES 2100022',
    specialties: ['Oftalmologia'], provider_group: 'Oftalmologia', qualification_level: 'B', status: 'Ativo',
    location: { label: 'Unidade Próspera', cep: '88815-000', logradouro: 'Rua Henrique Lage', numero: '345', bairro: 'Próspera', cidade: 'Criciúma', uf: 'SC', phone: '(48) 3433-2002' },
  },
  {
    code: 'SYN-003', name: 'Marcelo Pereira da Silva', trade_name: null,
    person_type: 'PF', cnpj: null, cpf: '101.101.101-01', council_registry: 'CRM/SC 12301',
    specialties: ['Ortopedia', 'Traumatologia'], provider_group: 'Ortopedia', qualification_level: 'A', status: 'Ativo',
    location: { label: 'Consultório', cep: '88802-200', logradouro: 'Rua Coronel Pedro Benedet', numero: '78', bairro: 'Centro', cidade: 'Criciúma', uf: 'SC', phone: '(48) 99961-3003' },
  },
  {
    code: 'SYN-004', name: 'Laboratório de Análises Clínicas Criciúma Ltda', trade_name: 'LabCriciúma',
    person_type: 'PJ', cnpj: '10.004.004/0001-04', cpf: null, council_registry: 'CNES 2100044',
    specialties: ['Análises Clínicas', 'Patologia'], provider_group: 'Laboratório', qualification_level: 'A', status: 'Ativo',
    location: { label: 'Matriz', cep: '88803-300', logradouro: 'Av. Universitária', numero: '900', bairro: 'Universitário', cidade: 'Criciúma', uf: 'SC', phone: '(48) 3433-4004' },
  },
  {
    code: 'SYN-005', name: 'Clínica da Mulher Içara Ltda', trade_name: 'Clínica da Mulher',
    person_type: 'PJ', cnpj: '10.005.005/0001-05', cpf: null, council_registry: 'CNES 2100055',
    specialties: ['Ginecologia', 'Obstetrícia'], provider_group: 'Ginecologia', qualification_level: 'C', status: 'Ativo',
    location: { label: 'Sede Içara', cep: '88820-000', logradouro: 'Av. Nações Unidas', numero: '455', bairro: 'Centro', cidade: 'Içara', uf: 'SC', phone: '(48) 3462-5005' },
  },
  {
    code: 'SYN-006', name: 'Fernanda Lima Rodrigues', trade_name: null,
    person_type: 'PF', cnpj: null, cpf: '106.106.106-06', council_registry: 'CRM/SC 12306',
    specialties: ['Dermatologia'], provider_group: 'Dermatologia', qualification_level: 'B', status: 'Ativo',
    location: { label: 'Consultório', cep: '88804-400', logradouro: 'Rua Marcos Rovaris', numero: '230', bairro: 'Centro', cidade: 'Criciúma', uf: 'SC', phone: '(48) 99962-6006' },
  },
  {
    code: 'SYN-007', name: 'Instituto do Coração de Cocal do Sul Ltda', trade_name: 'InCor Cocal',
    person_type: 'PJ', cnpj: '10.007.007/0001-07', cpf: null, council_registry: 'CNES 2100077',
    specialties: ['Cardiologia'], provider_group: 'Cardiologia', qualification_level: 'A', status: 'Inativo',
    location: { label: 'Sede Cocal', cep: '88845-000', logradouro: 'Rua Marcos Rovaris', numero: '12', bairro: 'Centro', cidade: 'Cocal do Sul', uf: 'SC', phone: '(48) 3466-7007' },
  },
  {
    code: 'SYN-008', name: 'Centro de Imagem e Diagnóstico por Imagem Ltda', trade_name: 'ImagemDiag',
    person_type: 'PJ', cnpj: '10.008.008/0001-08', cpf: null, council_registry: 'CNES 2100088',
    specialties: ['Radiologia', 'Diagnóstico por Imagem'], provider_group: 'Diagnóstico', qualification_level: 'A', status: 'Ativo',
    location: { label: 'Unidade Central', cep: '88805-500', logradouro: 'Av. Centenário', numero: '2100', bairro: 'Centro', cidade: 'Criciúma', uf: 'SC', phone: '(48) 3433-8008' },
  },
  {
    code: 'SYN-009', name: 'Rafael Souza Martins', trade_name: null,
    person_type: 'PF', cnpj: null, cpf: '109.109.109-09', council_registry: 'CRM/SC 12309',
    specialties: ['Pediatria'], provider_group: 'Pediatria', qualification_level: 'B', status: 'Ativo',
    location: { label: 'Consultório', cep: '88806-600', logradouro: 'Rua Desembargador Pedro Silva', numero: '410', bairro: 'Comerciário', cidade: 'Criciúma', uf: 'SC', phone: '(48) 99963-9009' },
  },
  {
    code: 'SYN-010', name: 'Clínica Odontológica Sorriso Ltda', trade_name: 'Sorriso',
    person_type: 'PJ', cnpj: '10.010.010/0001-10', cpf: null, council_registry: 'CRO/SC 9010',
    specialties: ['Odontologia'], provider_group: 'Odontologia', qualification_level: 'C', status: 'Ativo',
    location: { label: 'Unidade Michel', cep: '88804-100', logradouro: 'Rua Cônego Miguel Giacca', numero: '155', bairro: 'Michel', cidade: 'Criciúma', uf: 'SC', phone: '(48) 3433-1010' },
  },
];

async function clean() {
  const codes = PROVIDERS.map((p) => p.code);
  // provider_locations cai via ON DELETE CASCADE ao remover o provider.
  const { rowCount } = await query('DELETE FROM providers WHERE sgu_code = ANY($1)', [codes]);
  console.log(`Removidos ${rowCount ?? 0} prestadores sintéticos (SYN-*).`);
}

async function seed() {
  let inserted = 0;
  for (const p of PROVIDERS) {
    const { rows } = await query(
      `INSERT INTO providers
         (sgu_code, name, trade_name, person_type, cnpj, cpf, council_registry,
          specialties, provider_group, qualification_level, status, source, sgu_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,'sgu', now())
       ON CONFLICT (sgu_code) DO UPDATE SET
         name = EXCLUDED.name,
         trade_name = EXCLUDED.trade_name,
         person_type = EXCLUDED.person_type,
         cnpj = EXCLUDED.cnpj,
         cpf = EXCLUDED.cpf,
         council_registry = EXCLUDED.council_registry,
         specialties = EXCLUDED.specialties,
         provider_group = EXCLUDED.provider_group,
         qualification_level = EXCLUDED.qualification_level,
         status = EXCLUDED.status,
         sgu_synced_at = now()
       RETURNING id`,
      [p.code, p.name, p.trade_name, p.person_type, p.cnpj, p.cpf, p.council_registry,
       JSON.stringify(p.specialties), p.provider_group, p.qualification_level, p.status]
    );
    const providerId = rows[0].id;

    // Local primário idempotente: limpa locais do prestador sintético e reinsere.
    await query('DELETE FROM provider_locations WHERE provider_id = $1', [providerId]);
    const l = p.location;
    await query(
      `INSERT INTO provider_locations
         (provider_id, sgu_location_code, label, cep, logradouro, numero, bairro, cidade, uf, phone,
          is_primary, in_medical_guide, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,true,true)`,
      [providerId, `${p.code}-L1`, l.label, l.cep, l.logradouro, l.numero, l.bairro, l.cidade, l.uf, l.phone]
    );
    inserted++;
  }
  console.log(`Upsert de ${inserted} prestadores sintéticos + locais concluído.`);
}

async function main() {
  const mode = process.argv.includes('--clean') ? 'clean' : 'seed';
  try {
    if (mode === 'clean') await clean();
    else await seed();
  } catch (err) {
    console.error('Falha no seed sintético:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
