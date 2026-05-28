import React, { useEffect, useState } from 'react';
import { fetchApi } from '../../lib/api';
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

  if (user.role === 'admin') {
    return <GestorDashboard user={user} />;
  } else if (user.role === 'auditoria') {
    return <AuditorView user={user} />;
  } else {
    return <PrestadorView user={user} />;
  }
}
