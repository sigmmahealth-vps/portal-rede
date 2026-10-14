// Linha sintética da sgu_providers_raw para os testes das fases 1 e 2.
import type { SguRawRow } from './sgu-raw.js';

export const HOJE = '2026-10-14';

export function raw(over: Record<string, unknown> = {}): SguRawRow {
  return {
    codigo_prestador: '1000546', nome_prestador: 'SERGIO LUIZ BORTOLUZZI', nome_fantasia: null,
    status_prestador: 'ATIVO', grupo_prestador: '1 - MEDICOS COOPERADOS', tipo_prestador: '1 - MÉDICO',
    numero_documento: '352470968', numero_conselho_regional: 546,
    especialidade_grupo_servico: 'ANESTESIOLOGIA', nome_responsavel_tecnico: null,
    codigo_tipo_endereco: '2', tipo_endereco: 'COMERCIAL', cep: '88801250',
    logradouro: 'RUA CORONEL PEDRO BENEDET', numero_endereco: '505', complemento_endereco: 'SALA 609',
    bairro: 'CENTRO', cidade: 'CRICIUMA', uf_endereco: 'SC', telefone: '(48)30452678', celular: null,
    email_principal: null, imprimir_no_guia_medico: 'S',
    tipo_operacao_afastamento_exclusao: null, data_inicio_afastamento_exclusao: null,
    data_fim_afastamento_exclusao: null, codigo_motivo_afastamento_exclusao: null,
    motivo_afastamento_exclusao: null, dh_carga: new Date(2026, 9, 13, 21, 0),
    ...over,
  };
}
