import React, { useEffect, useState } from 'react';
import GestorDashboard from './GestorDashboard';
import PrestadorView from './PrestadorView';
import AuditorView from './AuditorView';

export default function QualificacaoModule() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
  }, []);

  if (!user) return null;

  if (user.role === 'admin') return <GestorDashboard user={user} />;
  if (user.role === 'auditoria') return <AuditorView user={user} />;
  // prestador e cooperado usam a mesma view; PrestadorView filtra roteiros por person_type (PF/PJ).
  return <PrestadorView user={user} />;
}
