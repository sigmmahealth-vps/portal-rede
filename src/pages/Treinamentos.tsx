import React, { useEffect, useState } from 'react';
import { fetchApi } from '../lib/api';
import { GraduationCap, PlayCircle, FileText, CheckCircle, Clock, Award, ChevronRight, ArrowLeft } from 'lucide-react';

export default function Treinamentos() {
  const [trainings, setTrainings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedTraining, setSelectedTraining] = useState<any>(null);
  const [activeModule, setActiveModule] = useState<number>(0);
  const [showEvaluation, setShowEvaluation] = useState(false);
  const [evaluationScore, setEvaluationScore] = useState<number | null>(null);

  // Mock Training Data for demonstration
  const mockTraining = {
    id: 'mock-1',
    title: 'Trilha de Qualificação ONA - Nível 1',
    description: 'Capacitação completa sobre os padrões de qualidade e segurança do paciente exigidos pela ONA.',
    status: 'em_andamento',
    progress: 60,
    modules: [
      {
        id: 1,
        title: 'Módulo 1: Introdução à Qualidade',
        duration: '15 min',
        completed: true,
        videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
        materialUrl: '#'
      },
      {
        id: 2,
        title: 'Módulo 2: Segurança do Paciente',
        duration: '25 min',
        completed: true,
        videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
        materialUrl: '#'
      },
      {
        id: 3,
        title: 'Módulo 3: Protocolos Clínicos',
        duration: '20 min',
        completed: false,
        videoUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
        materialUrl: '#'
      }
    ]
  };

  useEffect(() => {
    const loadTrainings = async () => {
      try {
        const data = await fetchApi('/trainings');
        // Add the mock training to the list for demonstration
        setTrainings([mockTraining, ...data]);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    loadTrainings();
  }, []);

  const handleCompleteModule = () => {
    if (selectedTraining.id === 'mock-1') {
      const updatedModules = [...selectedTraining.modules];
      updatedModules[activeModule].completed = true;
      
      const allCompleted = updatedModules.every(m => m.completed);
      
      setSelectedTraining({
        ...selectedTraining,
        modules: updatedModules,
        progress: allCompleted ? 100 : Math.round((updatedModules.filter(m => m.completed).length / updatedModules.length) * 100)
      });

      if (allCompleted) {
        setShowEvaluation(true);
      } else if (activeModule < updatedModules.length - 1) {
        setActiveModule(activeModule + 1);
      }
    }
  };

  const handleSubmitEvaluation = (e: React.FormEvent) => {
    e.preventDefault();
    setEvaluationScore(90); // Mock score
    setSelectedTraining({
      ...selectedTraining,
      status: 'concluido',
      completed_at: new Date().toISOString()
    });
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Carregando treinamentos...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;

  if (selectedTraining) {
    return (
      <div className="space-y-6">
        <button 
          onClick={() => {
            setSelectedTraining(null);
            setShowEvaluation(false);
            setEvaluationScore(null);
          }}
          className="flex items-center text-gray-600 hover:text-[#00995D] transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Voltar para Treinamentos
        </button>

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-6 border-b border-gray-100">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">{selectedTraining.title}</h1>
                <p className="text-gray-600">{selectedTraining.description}</p>
              </div>
              {selectedTraining.status === 'concluido' && (
                <div className="flex flex-col items-end">
                  <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-full text-sm font-bold flex items-center mb-2">
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Concluído
                  </span>
                  <button className="flex items-center text-sm text-[#00995D] hover:underline font-medium">
                    <Award className="w-4 h-4 mr-1" />
                    Baixar Certificado
                  </button>
                </div>
              )}
            </div>
            
            {/* Progress Bar */}
            <div className="mt-6">
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium text-gray-700">Progresso da Trilha</span>
                <span className="font-bold text-[#00995D]">{selectedTraining.progress || 0}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div className="bg-[#00995D] h-2.5 rounded-full transition-all duration-500" style={{ width: `${selectedTraining.progress || 0}%` }}></div>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row">
            {/* Sidebar Modules */}
            <div className="w-full md:w-1/3 border-r border-gray-100 bg-gray-50">
              <div className="p-4 font-bold text-gray-800 border-b border-gray-200">
                Módulos
              </div>
              <div className="divide-y divide-gray-200">
                {selectedTraining.modules?.map((module: any, index: number) => (
                  <button
                    key={module.id}
                    onClick={() => {
                      setActiveModule(index);
                      setShowEvaluation(false);
                    }}
                    className={`w-full text-left p-4 flex items-start transition-colors ${activeModule === index && !showEvaluation ? 'bg-white border-l-4 border-[#00995D]' : 'hover:bg-gray-100'}`}
                  >
                    <div className="mt-0.5 mr-3">
                      {module.completed ? (
                        <CheckCircle className="w-5 h-5 text-[#00995D]" />
                      ) : (
                        <PlayCircle className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                    <div>
                      <h4 className={`text-sm font-medium ${activeModule === index && !showEvaluation ? 'text-[#00995D]' : 'text-gray-900'}`}>
                        {module.title}
                      </h4>
                      <span className="text-xs text-gray-500 flex items-center mt-1">
                        <Clock className="w-3 h-3 mr-1" /> {module.duration}
                      </span>
                    </div>
                  </button>
                ))}
                
                {/* Evaluation Tab */}
                {selectedTraining.modules?.every((m: any) => m.completed) && (
                  <button
                    onClick={() => setShowEvaluation(true)}
                    className={`w-full text-left p-4 flex items-start transition-colors ${showEvaluation ? 'bg-white border-l-4 border-[#00995D]' : 'hover:bg-gray-100'}`}
                  >
                    <div className="mt-0.5 mr-3">
                      <FileText className={`w-5 h-5 ${evaluationScore !== null ? 'text-[#00995D]' : 'text-amber-500'}`} />
                    </div>
                    <div>
                      <h4 className={`text-sm font-medium ${showEvaluation ? 'text-[#00995D]' : 'text-gray-900'}`}>
                        Avaliação Final
                      </h4>
                      {evaluationScore !== null && (
                        <span className="text-xs text-[#00995D] font-bold mt-1 block">
                          Nota: {evaluationScore}/100
                        </span>
                      )}
                    </div>
                  </button>
                )}
              </div>
            </div>

            {/* Content Area */}
            <div className="w-full md:w-2/3 p-6">
              {showEvaluation ? (
                <div className="max-w-xl mx-auto">
                  <h3 className="text-xl font-bold text-gray-900 mb-6">Avaliação de Conhecimento</h3>
                  
                  {evaluationScore !== null ? (
                    <div className="text-center py-8">
                      <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-emerald-100 mb-4">
                        <Award className="w-12 h-12 text-[#00995D]" />
                      </div>
                      <h4 className="text-2xl font-bold text-gray-900 mb-2">Parabéns!</h4>
                      <p className="text-gray-600 mb-6">Você foi aprovado com nota {evaluationScore}.</p>
                      <button className="bg-[#00995D] text-white px-6 py-3 rounded-lg font-medium hover:bg-[#007A4A] transition-colors flex items-center mx-auto">
                        <Award className="w-5 h-5 mr-2" />
                        Gerar Certificado
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleSubmitEvaluation} className="space-y-6">
                      <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                        <p className="font-medium text-gray-900 mb-4">1. Qual é o principal objetivo da acreditação ONA?</p>
                        <div className="space-y-3">
                          <label className="flex items-center p-3 bg-white border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                            <input type="radio" name="q1" className="text-[#00995D] focus:ring-[#00995D]" required />
                            <span className="ml-3 text-sm text-gray-700">Reduzir custos operacionais.</span>
                          </label>
                          <label className="flex items-center p-3 bg-white border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                            <input type="radio" name="q1" className="text-[#00995D] focus:ring-[#00995D]" />
                            <span className="ml-3 text-sm text-gray-700">Garantir a segurança do paciente e a qualidade da assistência.</span>
                          </label>
                        </div>
                      </div>
                      
                      <button type="submit" className="w-full bg-[#00995D] text-white px-4 py-3 rounded-lg font-medium hover:bg-[#007A4A] transition-colors">
                        Finalizar Avaliação
                      </button>
                    </form>
                  )}
                </div>
              ) : (
                <div>
                  <h3 className="text-xl font-bold text-gray-900 mb-4">
                    {selectedTraining.modules?.[activeModule]?.title || selectedTraining.title}
                  </h3>
                  
                  {/* Video Player Mock */}
                  <div className="aspect-video bg-black rounded-xl overflow-hidden mb-6 relative group">
                    <video 
                      src={selectedTraining.modules?.[activeModule]?.videoUrl || "https://www.w3schools.com/html/mov_bbb.mp4"} 
                      controls 
                      className="w-full h-full object-cover"
                    ></video>
                  </div>

                  <div className="flex justify-between items-center">
                    <button className="flex items-center text-gray-600 hover:text-[#00995D] font-medium transition-colors">
                      <FileText className="w-5 h-5 mr-2" />
                      Material de Apoio (PDF)
                    </button>
                    
                    {!selectedTraining.modules?.[activeModule]?.completed && (
                      <button 
                        onClick={handleCompleteModule}
                        className="flex items-center bg-[#00995D] text-white px-6 py-2 rounded-lg font-medium hover:bg-[#007A4A] transition-colors"
                      >
                        <CheckCircle className="w-5 h-5 mr-2" />
                        Marcar como Concluído
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Treinamentos e Capacitação</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {trainings.map((training) => (
          <div key={training.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col">
            <div className="h-40 bg-gray-200 relative flex items-center justify-center">
              <GraduationCap className="h-16 w-16 text-gray-400" />
              {training.status === 'concluido' && (
                <div className="absolute top-2 right-2 bg-emerald-500 text-white px-2 py-1 rounded-full text-xs font-bold flex items-center">
                  <CheckCircle className="h-3 w-3 mr-1" /> Concluído
                </div>
              )}
              {training.status === 'em_andamento' && (
                <div className="absolute top-2 right-2 bg-blue-500 text-white px-2 py-1 rounded-full text-xs font-bold flex items-center">
                  <PlayCircle className="h-3 w-3 mr-1" /> Em Andamento
                </div>
              )}
            </div>
            <div className="p-6 flex-1 flex flex-col">
              <div className="flex justify-between items-start mb-2">
                <h3 className="text-lg font-bold text-gray-900">{training.title}</h3>
              </div>
              <p className="text-sm text-gray-600 mb-4 flex-1">{training.description}</p>
              
              {training.progress !== undefined && (
                <div className="mb-4">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-500">Progresso</span>
                    <span className="font-bold text-[#00995D]">{training.progress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div className="bg-[#00995D] h-1.5 rounded-full" style={{ width: `${training.progress}%` }}></div>
                  </div>
                </div>
              )}

              <div className="flex space-x-3 mt-auto">
                <button 
                  onClick={() => setSelectedTraining(training)}
                  className="w-full flex items-center justify-center px-4 py-2 bg-[#00995D] text-white rounded-lg hover:bg-[#007A4A] transition-colors text-sm font-medium"
                >
                  {training.status === 'concluido' ? 'Revisar Treinamento' : 'Acessar Trilha'}
                  <ChevronRight className="w-4 h-4 ml-1" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
