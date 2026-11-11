// Lógica pura da anonimização (LGPD) de uma CÓPIA de produção para dev/homolog.
// Separada do runner (anonimiza.ts) para ser testável sem tocar o banco — mesmo
// padrão de sgu-sync-plan.ts. NÃO roda nada aqui; só gera valores sintéticos e
// implementa a trava anti-produção.

// Fakes DETERMINÍSTICOS por id: preservam unicidade (email de staff, índices
// únicos de cnpj/cpf de providers) e mantêm os FKs intactos (os ids não mudam).
// TLD .invalid é reservado (RFC 2606): nunca é entregável — e-mail seguro.

export const fakeEmail = (id: number) => `u${id}@exemplo.invalid`;
export const fakeNome = (prefixo: string, id: number) => `${prefixo} ${id}`;

// cnpj/cpf: só comprimento/formato de dígitos importam (o valor gravado só precisa
// bater com o input normalizado no login). Prefixo 9 evita colidir com docs reais.
// ponytail: dígitos verificadores NÃO são válidos; se algo validar o DV do valor
// GRAVADO (não do input), troque por um gerador com DV correto.
export const fakeCnpj = (id: number) => String(90000000000000 + id).slice(0, 14);
export const fakeCpf = (id: number) => String(90000000000 + id).slice(0, 11);
export const fakePhone = (id: number) => '4790000' + String(id % 10000).padStart(4, '0');
export const fakeCep = (id: number) => '88' + String(id % 1000000).padStart(6, '0');
export const fakeCouncil = (id: number) => 'CRM-SC ' + String(id % 100000).padStart(5, '0');

// Tabelas operacionais/log zeradas por completo (texto livre / PII que o dev não
// precisa dos dados reais). Ordem: filhas antes das mães p/ TRUNCATE encadeado.
export const TABELAS_TRUNCAR = [
  'ticket_messages',
  'tickets',
  'access_logs',
  'otp_codes',
  'trusted_devices',
  'notifications',
  'survey_responses',
  'privacy_acceptances',
] as const;

// Host+banco de uma connection string, para comparar alvo × produção.
function hostDb(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.toLowerCase();
  } catch {
    return null;
  }
}

// Trava: recusa anonimizar se o ALVO for o mesmo host+banco da produção.
// Lança Error (mensagem sem credenciais) quando bate; retorna em silêncio se ok.
export function assertNaoProducao(targetUrl: string | undefined, prodUrl: string | undefined): void {
  if (!targetUrl) throw new Error('Sem connection string do alvo — defina APP_ENV + DATABASE_URL_<AMBIENTE>.');
  const alvo = hostDb(targetUrl);
  const prod = prodUrl ? hostDb(prodUrl) : null;
  if (alvo && prod && alvo === prod) {
    throw new Error('ABORTADO: o banco alvo é o de PRODUÇÃO (DATABASE_URL_PROD). Aponte para a cópia dev/homolog.');
  }
}
