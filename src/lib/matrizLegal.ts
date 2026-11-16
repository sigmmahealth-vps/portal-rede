// Matriz Legal: a partir da lista plana de requisitos (type_id × role), o conjunto de
// type_id obrigatórios para uma função. Puro; base do "Verificar" (fatia seguinte).

export type Requirement = { type_id: number; role: string };

export function obrigatoriosPara(role: string, reqs: Requirement[]): Set<number> {
  const out = new Set<number>();
  for (const r of reqs) if (r.role === role) out.add(r.type_id);
  return out;
}
