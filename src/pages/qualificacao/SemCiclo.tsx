import React from 'react';
import { CalendarDays } from 'lucide-react';

/** Estado vazio das telas por ciclo (Painel, Plano de Ação, Pesquisa) quando não há nenhum ciclo cadastrado. */
export default function SemCiclo() {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-12 text-center">
      <CalendarDays className="mx-auto mb-4 h-12 w-12 text-gray-400" />
      <h3 className="mb-1 text-lg font-medium text-gray-900">Nenhum ciclo de qualificação cadastrado</h3>
      <p className="text-gray-500">Crie e abra um ciclo na aba <strong>Ciclos</strong> para acompanhar as avaliações por aqui.</p>
    </div>
  );
}
