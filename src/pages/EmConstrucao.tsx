import { Wrench } from 'lucide-react';

export default function EmConstrucao() {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] text-center space-y-4">
      <div className="bg-gray-100 p-6 rounded-full">
        <Wrench className="h-12 w-12 text-gray-400" />
      </div>
      <h1 className="text-2xl font-bold text-gray-800">Página em Construção</h1>
      <p className="text-gray-500 max-w-md">
        Estamos trabalhando para trazer esta funcionalidade em breve. Agradecemos a sua paciência!
      </p>
    </div>
  );
}
