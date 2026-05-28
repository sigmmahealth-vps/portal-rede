import { useEffect, useState } from 'react';
import { fetchApi } from '../lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';

export default function Indicadores() {
  const [financials, setFinancials] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await fetchApi('/financials');
        setFinancials(data.reverse()); // Reverse to show oldest first on X axis
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  if (loading) return <div className="p-8 text-center text-gray-500">Carregando indicadores...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;

  const chartData = Object.values(financials.reduce((acc: any, f: any) => {
    if (!acc[f.competence]) {
      acc[f.competence] = {
        name: f.competence,
        Bruto: 0,
        Líquido: 0,
        Glosa: 0,
      };
    }
    acc[f.competence].Bruto += f.gross_value;
    acc[f.competence].Líquido += f.net_value;
    acc[f.competence].Glosa += f.glosa_value;
    return acc;
  }, {})).map((data: any) => ({
    ...data,
    TaxaGlosa: ((data.Glosa / data.Bruto) * 100).toFixed(2)
  }));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Indicadores de Desempenho</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Produção vs Glosas (R$)</h2>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} tickFormatter={(value) => `R$${value/1000}k`} />
                <Tooltip cursor={{fill: '#f9fafb'}} formatter={(value: number) => `R$ ${value.toLocaleString()}`} />
                <Legend iconType="circle" />
                <Bar dataKey="Bruto" fill="#34d399" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Glosa" fill="#f87171" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 mb-4">Evolução da Taxa de Glosa (%)</h2>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} tickFormatter={(value) => `${value}%`} />
                <Tooltip cursor={{fill: '#f9fafb'}} formatter={(value: number) => `${value}%`} />
                <Legend iconType="circle" />
                <Line type="monotone" dataKey="TaxaGlosa" stroke="#f59e0b" strokeWidth={3} dot={{r: 6, fill: '#f59e0b', strokeWidth: 2, stroke: '#fff'}} activeDot={{r: 8}} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
