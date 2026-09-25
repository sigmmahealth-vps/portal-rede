/**
 * Regra única da "Função" dos acessos de prestador (users.role).
 * Fonte: providers.person_type (CNPJ→PJ / CPF→PF, da planilha de cadastro)
 * + providers.provider_group (GRUPO_PREST).
 *
 *   PF + grupo MEDICOS COOPERADOS   (com ou sem sufixo ARARANGUA) → cooperado     (Médico Cooperado)
 *   PF + grupo MEDICOS CREDENCIADOS (com ou sem sufixo ARARANGUA) → credenciado   (Médico Credenciado)
 *   PF + qualquer outro grupo                                     → pf_nao_medico (PF não médico)
 *   caso contrário (PJ ou sem documento)                          → prestador
 */
export const COOPERADO_GROUP_RE = /^MEDICOS COOPERADOS(\s+ARARANGUA)?$/i;
export const CREDENCIADO_GROUP_RE = /^MEDICOS CREDENCIADOS(\s+ARARANGUA)?$/i;

export type ProviderRole = 'cooperado' | 'credenciado' | 'pf_nao_medico' | 'prestador';

// Todas as Funções de acesso de prestador (o que não é admin/auditoria).
export const PROVIDER_ACCESS_ROLES: string[] = ['prestador', 'cooperado', 'credenciado', 'pf_nao_medico'];

export function deriveProviderRole(personType: string | null, providerGroup: string | null): ProviderRole {
  if (personType !== 'PF') return 'prestador';
  const group = String(providerGroup ?? '').trim();
  if (COOPERADO_GROUP_RE.test(group)) return 'cooperado';
  if (CREDENCIADO_GROUP_RE.test(group)) return 'credenciado';
  return 'pf_nao_medico';
}
