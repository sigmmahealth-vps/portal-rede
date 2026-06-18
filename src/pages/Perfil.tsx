import React, { useState, useEffect } from 'react';
import { User, Building, Mail, Phone, MapPin, Edit2, CheckCircle, Shield, FileText, AlertCircle, Clock } from 'lucide-react';
import { fetchApi } from '../lib/api';

export default function Perfil() {
  const [user, setUser] = useState<any>(null);
  const [provider, setProvider] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    phone: '(48) 99999-9999',
    address: 'Rua Exemplo, 123 - Centro, Criciúma - SC',
    specialties: 'Clínica Geral, Cardiologia'
  });

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      const parsedUser = JSON.parse(storedUser);
      setUser(parsedUser);
      
      if (parsedUser.role === 'prestador') {
        // Fetch provider data
        fetchApi('/dashboard')
          .then(data => {
            if (data.provider) {
              setProvider(data.provider);
            }
          })
          .catch(err => console.error(err))
          .finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    }
  }, []);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    // In a real app, this would send an API request to update the profile or create a change request
    alert('Solicitação de alteração cadastral enviada com sucesso! Um chamado foi aberto para análise.');
    setIsEditing(false);
  };

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Carregando perfil...</div>;
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Meu Perfil</h1>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Header/Cover */}
        <div className="h-32 bg-gradient-to-r from-[#00995D] to-[#007A4A]"></div>
        
        <div className="px-6 sm:px-10 pb-8 relative">
          {/* Avatar */}
          <div className="absolute -top-16 left-6 sm:left-10 h-32 w-32 rounded-full border-4 border-white bg-white shadow-md flex items-center justify-center overflow-hidden">
            <div className="h-full w-full bg-gray-100 flex items-center justify-center text-gray-400">
              <User className="h-16 w-16" />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end pt-4">
            {!isEditing ? (
              <button 
                onClick={() => setIsEditing(true)}
                className="flex items-center px-4 py-2 bg-gray-50 text-gray-700 text-sm font-medium rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors"
              >
                <Edit2 className="h-4 w-4 mr-2" />
                Solicitar Alteração
              </button>
            ) : (
              <div className="flex space-x-3">
                <button 
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 text-gray-600 text-sm font-medium hover:bg-gray-50 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleSave}
                  className="flex items-center px-4 py-2 bg-[#00995D] text-white text-sm font-medium rounded-lg hover:bg-[#007A4A] transition-colors"
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Salvar Alterações
                </button>
              </div>
            )}
          </div>

          {/* User Info */}
          <div className="mt-8 sm:mt-4">
            <h2 className="text-2xl font-bold text-gray-900">{user?.name}</h2>
            <p className="text-gray-500 flex items-center mt-1">
              <Shield className="h-4 w-4 mr-1.5 text-[#00995D]" />
              {user?.role === 'prestador' ? 'Prestador Credenciado' : 
               user?.role === 'cooperado' ? 'Médico Cooperado' :
               user?.role === 'admin' ? 'Administrador' : 'Auditoria'}
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Personal/Account Info */}
            <div className="space-y-6">
              <h3 className="text-lg font-bold text-gray-900 border-b border-gray-100 pb-2">Informações da Conta</h3>
              
              <div className="space-y-4">
                <div className="flex items-start">
                  <Mail className="h-5 w-5 text-gray-400 mt-0.5 mr-3" />
                  <div>
                    <p className="text-sm font-medium text-gray-500">E-mail</p>
                    <p className="text-base text-gray-900">{user?.email}</p>
                  </div>
                </div>

                <div className="flex items-start">
                  <Clock className="h-5 w-5 text-gray-400 mt-0.5 mr-3" />
                  <div>
                    <p className="text-sm font-medium text-gray-500">Último acesso</p>
                    <p className="text-base text-gray-900">
                      {user?.last_login_at
                        ? new Date(user.last_login_at).toLocaleString('pt-BR', {
                            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                          })
                        : 'Primeiro acesso'}
                    </p>
                  </div>
                </div>

                <div className="flex items-start">
                  <Phone className="h-5 w-5 text-gray-400 mt-0.5 mr-3" />
                  <div className="w-full">
                    <p className="text-sm font-medium text-gray-500">Telefone</p>
                    {isEditing ? (
                      <input 
                        type="text" 
                        value={formData.phone}
                        onChange={(e) => setFormData({...formData, phone: e.target.value})}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00995D]"
                      />
                    ) : (
                      <p className="text-base text-gray-900">{formData.phone}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Provider Info (if applicable) */}
            {provider && (
              <div className="space-y-6">
                <h3 className="text-lg font-bold text-gray-900 border-b border-gray-100 pb-2">Dados do Prestador</h3>
                
                <div className="space-y-4">
                  <div className="flex items-start">
                    <Building className="h-5 w-5 text-gray-400 mt-0.5 mr-3" />
                    <div>
                      <p className="text-sm font-medium text-gray-500">Razão Social</p>
                      <p className="text-base text-gray-900">{provider.name}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start">
                    <FileText className="h-5 w-5 text-gray-400 mt-0.5 mr-3" />
                    <div>
                      <p className="text-sm font-medium text-gray-500">CNPJ</p>
                      <p className="text-base text-gray-900">{provider.cnpj}</p>
                    </div>
                  </div>

                  <div className="flex items-start">
                    <MapPin className="h-5 w-5 text-gray-400 mt-0.5 mr-3" />
                    <div className="w-full">
                      <p className="text-sm font-medium text-gray-500">Endereço</p>
                      {isEditing ? (
                        <input 
                          type="text" 
                          value={formData.address}
                          onChange={(e) => setFormData({...formData, address: e.target.value})}
                          className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#00995D]"
                        />
                      ) : (
                        <p className="text-base text-gray-900">{formData.address}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {isEditing && (
            <div className="mt-8 bg-blue-50 p-4 rounded-lg border border-blue-100 flex items-start">
              <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5 mr-3 flex-shrink-0" />
              <p className="text-sm text-blue-800">
                <strong>Atenção:</strong> As alterações de dados cadastrais (endereço, telefone, especialidades) passarão por uma análise da equipe de credenciamento antes de serem efetivadas no sistema.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
