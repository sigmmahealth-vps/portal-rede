// Manual (PDF) do roteiro — regras puras (sem DB), usadas pelas rotas de server.ts.
// Spec: docs/superpowers/specs/2026-09-24-manual-do-roteiro-design.md
export const MANUAL_MAX_BYTES = 20 * 1024 * 1024;
import { PROVIDER_ACCESS_ROLES as PROVIDER_ROLES } from './provider-role.js';

// Staff baixa qualquer manual; acesso de prestador só o do roteiro ligado a ele
// (linkedSourceFiles = source_file do eval_script_id do prestador + das instâncias dele).
export function canDownloadManual(role: string, linkedSourceFiles: string[], sourceFile: string | null): boolean {
  if (role === 'admin' || role === 'auditoria') return true;
  if (!PROVIDER_ROLES.includes(role) || !sourceFile) return false;
  return linkedSourceFiles.includes(sourceFile);
}

export function isPdf(name: string, buf: Buffer): boolean {
  return /\.pdf$/i.test(name) && buf.subarray(0, 4).toString('latin1') === '%PDF';
}
