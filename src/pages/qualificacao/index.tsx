import React, { useEffect, useState } from 'react';
import QualificacaoStaff from './QualificacaoStaff';
import PrestadorView from './PrestadorView';

export default function QualificacaoModule() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (storedUser) setUser(JSON.parse(storedUser));
  }, []);

  if (!user) return null;

  if (user.role === 'admin' || user.role === 'auditoria') {
    return <QualificacaoStaff user={user} />;
  }
  return <PrestadorView user={user} />;
}
