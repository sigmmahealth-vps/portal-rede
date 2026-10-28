// Versão vigente da Política de Privacidade (spec 2026-09-29). Trocar esta string =
// todos os usuários aceitam de novo no próximo acesso; aceites antigos ficam em privacy_acceptances.
export const PRIVACY_POLICY_VERSION = '2026-10-28';

export function needsPrivacyAcceptance(accepted: string | null | undefined, current: string = PRIVACY_POLICY_VERSION): boolean {
  return accepted !== current;
}
