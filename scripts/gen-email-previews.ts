// Gera os arquivos de pré-visualização/aprovação dos modelos de e-mail (5.4.7)
// com dados ilustrativos e o logo embutido em base64 (abrem offline).
// Uso: npm run emails:preview [-- "C:/caminho/da/pasta"]   (default: ../S5)
import { renderNotificationEmail } from '../src/lib/notifyEmail.js';
import { otpEmailHtml, inviteEmailHtml, resetEmailHtml } from '../auth/mailer.js';
import fs from 'fs';
import path from 'path';

const dest = process.argv[2] ?? path.resolve(process.cwd(), '..', 'S5');
fs.mkdirSync(dest, { recursive: true });

// Embute em base64 imagens e fontes que os modelos referenciam (abrem offline).
const ASSETS = ['logo-prp-branco.png', 'logo-unimed-chip.png', 'logo-unimed-criciuma.png', 'selos/ouro.png', 'selos/prata.png', 'selos/bronze.png', 'calendario.png', 'codigo.png'];
const FONTES = ['fonts/Unimed-Regular.woff2', 'fonts/Unimed-Bold.woff2'];
const embed = (h: string) => {
  let out = h;
  for (const rel of ASSETS) {
    const p = path.resolve(process.cwd(), 'public', rel);
    if (!fs.existsSync(p)) continue;
    const b64 = fs.readFileSync(p).toString('base64');
    out = out.replace(new RegExp(`src="[^"]*/${rel.replace('/', '\\/').replace('.', '\\.')}"`, 'g'), `src="data:image/png;base64,${b64}"`);
  }
  for (const rel of FONTES) {
    const p = path.resolve(process.cwd(), 'public', rel);
    if (!fs.existsSync(p)) continue;
    const b64 = fs.readFileSync(p).toString('base64');
    out = out.replace(new RegExp(`url\\('[^']*/${rel.replace('/', '\\/').replace('.', '\\.')}'\\)`, 'g'), `url('data:font/woff2;base64,${b64}')`);
  }
  return out;
};

const CTX = {
  cycle_label: '2026', provider_name: 'Clínica de Fisioterapia Reabilitar Ltda',
  question_code: '1.1.4', seal: 'Ouro', percentual: 87.3, valid_until: '2027-12-31',
  items: 3, what: 'Elaborar e implantar o PGRSS', due_date: '2026-09-02',
  end_date: '2026-12-31', count: 12,
};
const APP = 'https://portal-unimed-criciuma.exemplo';
const NOME = 'Clínica de Fisioterapia Reabilitar';

const modelos: Array<[string, string, { subject: string; html: string }]> = [
  ['01-abertura-ciclo-roteiro-disponivel', 'Abertura do ciclo + roteiro disponível (Prestador)', renderNotificationEmail('ciclo_aberto', CTX, APP, NOME)],
  ['02-roteiro-enviado-analise', 'Prestador enviou roteiro para análise (Auditor — hoje só portal)', renderNotificationEmail('roteiro_enviado', CTX, APP, 'Auditoria Unimed')],
  ['03-reanalise-criterio', 'Reanálise de critério solicitada (Prestador)', renderNotificationEmail('reanalise_solicitada', CTX, APP, NOME)],
  ['04-devolucao-integral', 'Avaliação devolvida integralmente (Prestador)', renderNotificationEmail('reanalise_solicitada', { ...CTX, integral: true }, APP, NOME)],
  ['05-roteiro-aprovado', 'Roteiro aprovado (Prestador)', renderNotificationEmail('parecer_aprovado', CTX, APP, NOME)],
  // Reprovado e certificado emitido ficaram fora do canal e-mail (rodada de
  // aprovação de 2026-08-19) — os eventos seguem como notificação no portal.
  ['06-plano-acao-gerado', 'Plano de ação gerado (Prestador + Auditor)', renderNotificationEmail('plano_gerado', CTX, APP, NOME)],
  ['07-acao-aguardando-validacao', 'Ação concluída aguardando validação (Auditor — hoje só portal)', renderNotificationEmail('acao_aguardando_validacao', CTX, APP, 'Auditoria Unimed')],
  ['08-acao-proxima-vencimento', 'Ação próxima do vencimento — 15 dias (Prestador)', renderNotificationEmail('acao_vencendo', CTX, APP, NOME)],
  ['09-acao-em-atraso', 'Ação em atraso (Prestador + Auditor)', renderNotificationEmail('acao_atrasada', CTX, APP, NOME)],
  ['10-roteiro-pendente-30d', 'Roteiro pendente 30 dias antes do encerramento (Prestador)', renderNotificationEmail('roteiro_pendente', CTX, APP, NOME)],
  ['11-roteiros-pendentes-resumo-auditoria', 'Roteiros pendentes — resumo por ciclo (Auditor)', renderNotificationEmail('roteiro_pendente', { ...CTX, digest: true }, APP, 'Auditoria Unimed')],
  ['12-certificado-proximo-vencimento', 'Certificado próximo do vencimento (Prestador)', renderNotificationEmail('certificado_vencendo', CTX, APP, NOME)],
  ['13-convite-de-acesso', 'Convite de acesso — definir senha', { subject: 'Bem-vindo ao Portal Unimed Criciúma', html: inviteEmailHtml(NOME, `${APP}/definir-senha?token=exemplo`) }],
  ['14-codigo-de-acesso-otp', 'Código de acesso (OTP do login)', { subject: 'Seu código de acesso ao Portal Unimed: 483920', html: otpEmailHtml('483920') }],
  ['15-redefinicao-de-senha', 'Redefinição de senha', { subject: 'Redefinição de senha — Portal Unimed', html: resetEmailHtml(`${APP}/definir-senha?token=exemplo`) }],
];

for (const [file, , e] of modelos) fs.writeFileSync(path.join(dest, `${file}.html`), embed(e.html));

const strip = (h: string) => h.replace(/^[\s\S]*?<body[^>]*>/, '').replace(/<\/body><\/html>$/, '');
let out = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Modelos de e-mail — Qualificação da Rede (aprovação)</title></head><body style="background:#e5e7eb;font-family:Arial;margin:0;padding:24px 0;">';
out += `<div style="max-width:640px;margin:0 auto 8px;text-align:center;"><h1 style="color:#00483A;font-size:22px;margin:0;">Modelos de e-mail — Programa de Qualificação da Rede</h1><p style="color:#6b7280;font-size:13px;">Para aprovação · dados ilustrativos · ${modelos.length} modelos</p></div>`;
modelos.forEach(([file, label, e]) => {
  // Numeração pelo prefixo do arquivo (estável entre rodadas, mesmo com exclusões).
  out += `<p style="max-width:640px;margin:36px auto 8px;font-weight:bold;color:#374151;font-size:14px;">${file.slice(0, 2)}. ${label}<br><span style="font-weight:normal;color:#6b7280;">Assunto: ${e.subject}</span></p>${strip(embed(e.html))}`;
});
out += '</body></html>';
fs.writeFileSync(path.join(dest, '00-todos-os-modelos.html'), out);
console.log(`[emails:preview] ${modelos.length + 1} arquivos salvos em ${dest}`);
