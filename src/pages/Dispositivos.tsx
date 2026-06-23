import { useEffect, useState } from 'react';
import { Laptop, Trash2 } from 'lucide-react';
import { fetchApi } from '../lib/api';

interface Device {
  id: number;
  label: string | null;
  last_ip: string | null;
  last_used_at: string;
  expires_at: string;
}

export default function Dispositivos() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    fetchApi('/auth/trusted-devices')
      .then((data) => setDevices(data.devices))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const revoke = async (id: number) => {
    if (!confirm('Revogar este dispositivo? Ele exigirá novo código no próximo acesso.')) return;
    try {
      await fetchApi(`/auth/trusted-devices/${id}`, { method: 'DELETE' });
      setDevices((ds) => ds.filter((d) => d.id !== id));
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">Dispositivos confiáveis</h1>
      <p className="text-sm text-gray-500">
        Nestes dispositivos o código de verificação não é pedido a cada acesso. Revogue qualquer um que você não reconheça.
      </p>
      {error && <div className="bg-red-50 text-red-700 p-3 rounded-md text-sm">{error}</div>}
      {loading ? (
        <div className="text-gray-500">Carregando...</div>
      ) : devices.length === 0 ? (
        <div className="text-gray-500">Nenhum dispositivo confiável.</div>
      ) : (
        <ul className="divide-y divide-gray-100 bg-white rounded-xl border border-gray-100">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Laptop className="h-5 w-5 text-[#00995D]" />
                <div>
                  <p className="font-medium text-gray-900">{d.label || 'Dispositivo'}</p>
                  <p className="text-xs text-gray-500">
                    Último acesso: {new Date(d.last_used_at).toLocaleString('pt-BR')} · IP {d.last_ip || '—'}
                  </p>
                </div>
              </div>
              <button onClick={() => revoke(d.id)} className="text-red-500 hover:text-red-700 p-2" title="Revogar">
                <Trash2 className="h-5 w-5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
