import { BookOpen, Download, Search } from 'lucide-react';
import { useState } from 'react';

const MOCK_LIBRARY = [
  { id: 1, title: 'Manual do Prestador 2024', category: 'Manuais', date: '10/01/2024', size: '2.4 MB' },
  { id: 2, title: 'Guia de Faturamento TISS', category: 'Guias', date: '15/02/2024', size: '1.8 MB' },
  { id: 3, title: 'Protocolos Clínicos - Cardiologia', category: 'Protocolos', date: '20/02/2024', size: '5.1 MB' },
  { id: 4, title: 'Normas de Auditoria Médica', category: 'Normas', date: '05/03/2024', size: '3.2 MB' },
  { id: 5, title: 'Tabela de Materiais e Medicamentos', category: 'Tabelas', date: '01/03/2024', size: '8.5 MB' },
];

export default function Biblioteca() {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredDocs = MOCK_LIBRARY.filter(doc => 
    doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    doc.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Caixa de Ferramentas</h1>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4">
        <div className="flex-1 relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-5 w-5 text-gray-400" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-emerald-500 focus:border-emerald-500 sm:text-sm"
            placeholder="Buscar documentos, manuais, guias..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Documento</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Categoria</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tamanho</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredDocs.map((doc) => (
                <tr key={doc.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <BookOpen className="h-5 w-5 text-emerald-600 mr-3" />
                      <div className="text-sm font-medium text-gray-900">{doc.title}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-md text-xs font-medium">
                      {doc.category}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{doc.date}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{doc.size}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button className="text-emerald-600 hover:text-emerald-900 flex items-center justify-end w-full">
                      <Download className="h-4 w-4 mr-1" /> Baixar
                    </button>
                  </td>
                </tr>
              ))}
              {filteredDocs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    Nenhum documento encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
