/**
 * Regra única da "Função" dos acessos de prestador (users.role).
 * Fonte: providers.person_type (CNPJ→PJ / CPF→PF, da planilha de cadastro)
 * + providers.provider_group (GRUPO_PREST).
 *
 *   PF + grupo MEDICOS COOPERADOS (com ou sem sufixo ARARANGUA) → cooperado
 *   PF + qualquer outro grupo                                   → pf_nao_medico
 *   caso contrário (PJ ou sem documento)                        → prestador
 */
export const COOPERADO_GROUP_RE = /^MEDICOS COOPERADOS(\s+ARARANGUA)?$/i;

export type ProviderRole = 'cooperado' | 'pf_nao_medico' | 'prestador';

export function deriveProviderRole(personType: string | null, providerGroup: string | null): ProviderRole {
  if (personType !== 'PF') return 'prestador';
  return COOPERADO_GROUP_RE.test(String(providerGroup ?? '').trim()) ? 'cooperado' : 'pf_nao_medico';
}
