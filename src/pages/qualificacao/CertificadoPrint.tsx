// src/pages/qualificacao/CertificadoPrint.tsx
// Diploma do certificado (spec 5.4.5): arte final da Operadora (um SVG por selo em
// public/certificados/) com os dados dinâmicos sobrepostos em SVG, A4 paisagem +
// window.print(). As coordenadas do overlay são em unidades do viewBox da arte
// (842.25 x 595.5) e foram calibradas sobre as artes em branco.
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { fetchApi } from '../../lib/api';
import { fmtData } from '../../lib/formatDate';
import type { Certificate } from './CertificadosTab';

// Cor do número por selo (nome e validade são sempre verdes na arte).
const NUM_COLOR: Record<string, string> = { Ouro: '#b8860b', Prata: '#7a7f87', Bronze: '#a85a2a' };
const GREEN = '#0f5c3f';

const fmtDateOnly = (d: string) => fmtData(d);
// Percentual no formato da arte: vírgula, 1 casa decimal, sem zero à toa (94,4% / 100% / 96%).
const fmtPct = (n: number) => `${(Math.round(Number(n) * 10) / 10).toString().replace('.', ',')}%`;
const esc = (s: string) =>
  String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));

export default function CertificadoPrint() {
  const { id } = useParams();
  const [cert, setCert] = useState<Certificate | null>(null);
  const [qr, setQr] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    setError('');
    setCert(null);
    setQr('');
    fetchApi(`/eval/certificates/${id}`)
      .then((found: Certificate) => {
        if (!found) { setError('Certificado não encontrado.'); return; }
        setCert(found);
        return QRCode.toDataURL(`${window.location.origin}/verificar/${found.verify_code}`, { margin: 1, width: 200 })
          .then(setQr);
      })
      .catch(() => setError('Erro ao carregar o certificado.'));
  }, [id]);

  // Imprime quando certificado + QR estão prontos (um repaint depois).
  useEffect(() => {
    if (cert && qr) {
      const t = setTimeout(() => window.print(), 400);
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

  const numColor = NUM_COLOR[cert.seal] ?? '#7a7f87';
  const dim = (prefix: string) => cert.dimensions.find(d => d.dimension.startsWith(prefix));
  const seg = dim('Segurança');
  const conf = dim('Conforto');
  const exp = dim('Experiência');
  const name = cert.provider_name || '';
  // Encolhe o nome se for longo, pra caber na faixa (~400 unidades).
  const nameSize = Math.min(22, 580 / Math.max(1, name.length * 0.55));
  // Nome da arte = o próprio selo (Ouro/Prata/Bronze.svg); fallback Prata.
  const art = (['Ouro', 'Prata', 'Bronze'] as const).includes(cert.seal) ? cert.seal : 'Prata';
  // Local de atendimento (E-02): endereço avaliado, ou o logradouro como fallback.
  const local = cert.location_address || cert.location_label || '';

  // Coordenadas calibradas sobre a arte nova (viewBox 842.25 x 595.5): valores das
  // 4 dimensões centralizados sob cada ícone; pin do local e validade à esquerda.
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 842.25 595.5" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      <image href="/certificados/${art}.svg" x="0" y="0" width="842.25" height="595.5" preserveAspectRatio="none"/>
      <g font-family="'UnimedFont', 'Inter', sans-serif" font-weight="bold" text-anchor="middle">
        <text x="421.1" y="253.5" font-size="${nameSize.toFixed(1)}" fill="${GREEN}">${esc(name)}</text>
        <text x="158.3" y="390" font-size="18.5" fill="${numColor}">${seg ? fmtPct(seg.pct) : '—'}</text>
        <text x="349.5" y="390" font-size="18.5" fill="${numColor}">${conf ? fmtPct(conf.pct) : '—'}</text>
        <text x="530" y="390" font-size="18.5" fill="${numColor}">${exp ? fmtPct(exp.pct) : '—'}</text>
        <text x="700" y="390" font-size="18.5" fill="${numColor}">${fmtPct(cert.percentual)}</text>
      </g>
      <text x="165" y="488" font-family="'UnimedFont', 'Inter', sans-serif" font-weight="bold" font-size="12.6" fill="${GREEN}">${fmtDateOnly(cert.valid_until)}</text>
      ${local ? `<text x="95" y="440" font-family="'UnimedFont', 'Inter', sans-serif" font-size="11" fill="#4b5563">${esc(local)}</text>` : ''}
      ${qr ? `<image href="${qr}" x="735.3" y="392.5" width="60.6" height="60.6"/>` : ''}
    </svg>`;

  return (
    <div className="cert-wrap min-h-screen bg-gray-100 print:bg-white">
      <style>{`
        @page { size: A4 landscape; margin: 0; }
        .cert-page, .cert-wrap { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @media print {
          html, body { background: #fff !important; }
          .cert-wrap { min-height: 0 !important; }
          .cert-page { width: 297mm !important; height: 210mm !important; margin: 0 !important; box-shadow: none !important; }
        }
      `}</style>
      <div
        className="cert-page mx-auto my-6 aspect-[297/210] w-[1122px] max-w-full bg-white shadow-lg print:my-0 print:w-full print:shadow-none"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
