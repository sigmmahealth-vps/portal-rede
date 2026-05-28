import React from 'react';
import { Wrench, FileText, Calculator, Calendar, Activity, Link as LinkIcon } from 'lucide-react';

export default function Ferramentas() {
  const tools = [
    {
      title: 'Calculadora de Honorários',
      description: 'Simule o valor de procedimentos com base na tabela THM vigente e porte anestésico.',
      icon: Calculator,
      color: 'bg-blue-100 text-blue-600',
      link: '#'
    },
    {
      title: 'Validador de Guias TISS',
      description: 'Verifique a estrutura e regras de negócio de arquivos XML antes do envio.',
      icon: FileText,
      color: 'bg-emerald-100 text-emerald-600',
      link: '#'
    },
    {
      title: 'Consulta de Elegibilidade',
      description: 'Verifique a situação cadastral e carências de beneficiários em tempo real.',
      icon: Activity,
      color: 'bg-purple-100 text-purple-600',
      link: '#'
    },
    {
      title: 'Agendamento Cirúrgico',
      description: 'Solicite autorização e agende procedimentos cirúrgicos na rede própria.',
      icon: Calendar,
      color: 'bg-amber-100 text-amber-600',
      link: '#'
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ferramentas Operacionais</h1>
          <p className="text-sm text-gray-500 mt-1">Acesse os sistemas e utilitários para o dia a dia do seu atendimento.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {tools.map((tool, index) => (
          <div key={index} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-4 ${tool.color}`}>
              <tool.icon className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">{tool.title}</h3>
            <p className="text-sm text-gray-500 mb-4 h-10">{tool.description}</p>
            <a 
              href={tool.link}
              className="inline-flex items-center text-sm font-medium text-[#00995D] hover:text-[#007A4A]"
            >
              Acessar Ferramenta
              <LinkIcon className="h-4 w-4 ml-1.5" />
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
