import { deriveProviderRole } from '../../db/provider-role.js';

// Separa Médicos (cooperado/credenciado) da Rede Prestadora (o resto), reusando a
// regra única de deriveProviderRole.
export function providerAudience(personType: string | null, providerGroup: string | null): 'medicos' | 'rede' {
  const role = deriveProviderRole(personType, providerGroup);
  return role === 'cooperado' || role === 'credenciado' ? 'medicos' : 'rede';
}
