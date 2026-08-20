// Decide o escopo de leitura do portal do prestador a partir das unidades vinculadas.
// Fail-closed: prestador sem unidades => vê NADA (conjunto vazio). Staff (não-prestador)
// não é escopado por unidade (o helper nem é chamado nas rotas de staff).
export function scopeFromUnits(units: number[]): { seesNothing: boolean; ids: number[] } {
  return { seesNothing: units.length === 0, ids: units };
}
