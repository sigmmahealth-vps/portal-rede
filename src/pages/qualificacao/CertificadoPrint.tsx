// src/pages/qualificacao/CertificadoPrint.tsx
// "PDF" do certificado (spec 5.4.5): A4 paisagem + window.print().
// Arte simples com paleta Unimed — quando a arte final da Operadora chegar,
// troca-se apenas o visual desta página (dados/estrutura ficam).
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { fetchApi } from '../../lib/api';
import type { Certificate } from './CertificadosTab';
import { fmtDateOnly } from './CertificadosTab';

// Textos fixos por dimensão (arte de referência da Operadora). Lookup por
// prefixo para tolerar variações de rótulo ('Conforto' vs 'Conforto e Facilidades').
const DIM_DESCRIPTIONS: [string, string][] = [
  ['Segurança', 'Dimensão avaliada com base nos processos gerenciais (manuais, normas e qualificação), segurança do paciente e riscos ambientais, certificações, segurança da informação, protocolos de segurança, manutenções preventivas e higienização.'],
  ['Conforto', 'Dimensão avaliada com base na infraestrutura do local, garantindo satisfação, conforto e acessibilidade ao cliente e seus familiares.'],
  ['Experiência', 'Dimensão avaliada com base na estruturação dos processos, proporcionando segurança e conforto para o paciente. Dentre eles: termos de consentimento, prazos de agendamento, pesquisa de satisfação e incidentes.'],
];
const dimDescription = (dimension: string) =>
  DIM_DESCRIPTIONS.find(([prefix]) => dimension.startsWith(prefix))?.[1] ?? '';

const SIGNATURES = [
  { name: 'Dr. Leandro Avany Nunes', role: 'Diretor Presidente Unimed Criciúma' },
  { name: 'Dra. Clarissa Ines Almeida', role: 'Vice Presidente Unimed Criciúma' },
];

const SEAL_BADGE: Record<string, string> = {
  Ouro: 'bg-amber-400 text-amber-950',
  Prata: 'bg-gray-300 text-gray-800',
  Bronze: 'bg-orange-400 text-orange-950',
};

export default function CertificadoPrint() {
  const { id } = useParams();
  const [cert, setCert] = useState<Certificate | null>(null);
  const [qr, setQr] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    fetchApi('/me/certificates')
      .then((data: Certificate[]) => {
        const found = data.find(c => c.id === Number(id));
        if (!found) { setError('Certificado não encontrado.'); return; }
        setCert(found);
        return QRCode.toDataURL(`${window.location.origin}/verificar/${found.verify_code}`, { margin: 1, width: 120 })
          .then(setQr);
      })
      .catch(() => setError('Erro ao carregar o certificado.'));
  }, [id]);

  // Imprime quando certificado + QR estão prontos (um repaint depois).
  useEffect(() => {
    if (cert && qr) {
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
  }, [cert, qr]);

  if (error) return <div className="grid min-h-screen place-items-center text-gray-600">{error}</div>;
  if (!cert) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-emerald-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <style>{`@page { size: A4 landscape; margin: 0; } @media print { html, body { background: white; } }`}</style>
      <div className="mx-auto my-6 flex aspect-[297/210] w-[1122px] max-w-full flex-col border-[10px] border-emerald-700 bg-white p-10 shadow-lg print:my-0 print:w-full print:shadow-none">
        {/* Cabeçalho */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-4xl font-extrabold tracking-widest text-emerald-800">CERTIFICADO</h1>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-wider text-emerald-700">
              Avaliação, Qualificação e Desenvolvimento dos Prestadores
            </p>
          </div>
          <div className={`grid h-24 w-24 place-items-center rounded-full border-4 border-emerald-700 ${SEAL_BADGE[cert.seal] ?? SEAL_BADGE.Prata}`}>
            <div className="text-center leading-tight">
              <p className="text-[9px] font-bold uppercase">Selo</p>
              <p className="text-lg font-extrabold uppercase">{cert.seal}</p>
            </div>
          </div>
        </div>

        {/* Nome e endereço */}
        <div className="mt-6 border-b-2 border-emerald-700 pb-2 text-center">
          <p className="text-3xl font-extrabold uppercase text-secondary-900">{cert.provider_name}</p>
          {(cert.location_label || cert.location_address) && (
            <p className="mt-1 text-sm font-semibold text-gray-600">
              {[cert.location_label, cert.location_address].filter(Boolean).join(' — ')}
            </p>
          )}
        </div>

        {/* Corpo: dimensões à esquerda, total/validade/classificação à direita */}
        <div className="mt-6 flex flex-1 gap-10">
          <div className="flex-1 space-y-4">
            {cert.dimensions.map(d => (
              <div key={d.dimension} className="flex gap-4">
                <div className="w-28 shrink-0 border-b-2 border-emerald-700 text-center">
                  <p className="text-xl font-extrabold text-secondary-900">{d.pct.toFixed(2).replace('.', ',')}%</p>
                  <p className="text-xs font-bold text-emerald-800">{d.dimension}</p>
                </div>
                <p className="flex-1 text-justify text-[11px] leading-relaxed text-gray-600">
                  {dimDescription(d.dimension)}
                </p>
              </div>
            ))}
          </div>

          <div className="w-56 shrink-0 space-y-6 text-center">
            <div className="border-b-2 border-emerald-700 pb-1">
              <p className="text-4xl font-extrabold text-secondary-900">{Math.round(cert.percentual)}%</p>
              <p className="text-lg font-bold text-emerald-700">Total</p>
            </div>
            <div className="border-b-2 border-emerald-700 pb-1">
              <p className="text-xl font-extrabold text-secondary-900">{fmtDateOnly(cert.valid_until)}</p>
              <p className="text-sm font-bold text-emerald-700">Validade</p>
            </div>
            <div className="text-left">
              <p className="mb-1 text-sm font-extrabold italic text-emerald-800">Classificação</p>
              <p className="text-[11px] text-gray-600"><span className="font-bold">Ouro</span> — acima de 90,00%</p>
              <p className="text-[11px] text-gray-600"><span className="font-bold">Prata</span> — 60,01% a 90,00%</p>
              <p className="text-[11px] text-gray-600"><span className="font-bold">Bronze</span> — até 60,00%</p>
            </div>
          </div>
        </div>

        {/* Rodapé: assinaturas + QR */}
        <div className="mt-8 flex items-end justify-between gap-8">
          <div className="flex flex-1 justify-around gap-8">
            {SIGNATURES.map(s => (
              <div key={s.name} className="w-64 border-t-2 border-emerald-700 pt-1 text-center">
                <p className="text-sm font-bold text-secondary-900">{s.name}</p>
                <p className="text-xs text-gray-600">{s.role}</p>
              </div>
            ))}
          </div>
          <div className="shrink-0 text-center">
            {qr && <img src={qr} alt="QR code de verificação" className="mx-auto h-20 w-20" />}
            <p className="mt-1 text-[9px] font-semibold text-gray-500">Verifique a autenticidade</p>
          </div>
        </div>
      </div>
    </div>
  );
}
