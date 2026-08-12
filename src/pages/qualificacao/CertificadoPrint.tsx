// src/pages/qualificacao/CertificadoPrint.tsx
// Diploma do certificado (spec 5.4.5): arte final da Operadora (um SVG por selo em
// public/certificados/) com os dados dinâmicos sobrepostos em SVG, A4 paisagem +
// window.print(). As coordenadas do overlay são em unidades do viewBox da arte
// (842.25 x 595.5) e foram calibradas sobre as artes em branco.
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { fetchApi } from '../../lib/api';
import type { Certificate } from './CertificadosTab';

const SEAL_SLUG: Record<string, string> = { Ouro: 'ouro', Prata: 'prata', Bronze: 'bronze' };
// Cor do número por selo (nome e validade são sempre verdes na arte).
const NUM_COLOR: Record<string, string> = { Ouro: '#b8860b', Prata: '#7a7f87', Bronze: '#a85a2a' };
const GREEN = '#0f5c3f';

const fmtDateOnly = (d: string) => {
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
};
// Percentual no formato da arte: vírgula, até 2 casas, sem zero à toa (94,44% / 100% / 96%).
const fmtPct = (n: number) => `${(Math.round(Number(n) * 100) / 100).toString().replace('.', ',')}%`;
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

  const slug = SEAL_SLUG[cert.seal] ?? 'prata';
  const numColor = NUM_COLOR[cert.seal] ?? '#7a7f87';
  const dim = (prefix: string) => cert.dimensions.find(d => d.dimension.startsWith(prefix));
  const seg = dim('Segurança');
  const conf = dim('Conforto');
  const exp = dim('Experiência');
  const name = cert.provider_name || '';
  // Encolhe o nome se for longo, pra caber na faixa (~580 unidades).
  const nameSize = Math.min(30, 580 / Math.max(1, name.length * 0.55));

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 842.25 595.5" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      <image href="/certificados/${slug}.jpg" x="0" y="0" width="842.25" height="595.5" preserveAspectRatio="none"/>
      <g font-family="Georgia, 'Times New Roman', serif" font-weight="bold">
        <text x="421.12" y="262" text-anchor="middle" font-size="${nameSize.toFixed(1)}" fill="${GREEN}">${esc(name)}</text>
        <text x="132" y="402" font-size="22" fill="${numColor}">${seg ? fmtPct(seg.pct) : '—'}</text>
        <text x="322" y="402" font-size="22" fill="${numColor}">${conf ? fmtPct(conf.pct) : '—'}</text>
        <text x="498" y="402" font-size="22" fill="${numColor}">${exp ? fmtPct(exp.pct) : '—'}</text>
        <text x="680" y="402" font-size="22" fill="${numColor}">${fmtPct(cert.percentual)}</text>
        <text x="113" y="532" font-size="17" fill="${GREEN}">${fmtDateOnly(cert.valid_until)}</text>
      </g>
      ${qr ? `<image href="${qr}" x="742" y="430" width="70" height="70"/>` : ''}
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
