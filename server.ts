import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { query, pool, withTransaction } from './db/db.js';
import { COOPERADO_GROUP_RE, deriveProviderRole, PROVIDER_ACCESS_ROLES } from './db/provider-role.js';
import { parseWorkbook, effectiveRevision } from './db/roteiro-parser.js';
import { generateOtpCode, hashOtp, verifyOtp, isOtpExpired, OTP_TTL_MS, OTP_MAX_ATTEMPTS, isTestMasterOtp } from './auth/otp.js';
import { generateDeviceSecret, hashDeviceSecret, deviceLabelFromUserAgent, isTrustedDeviceValid, TRUSTED_DEVICE_TTL_MS } from './auth/trustedDevice.js';
import { isRateLimited, checkRateLimit, PASSWORD_MAX_FAILURES, PASSWORD_WINDOW_MS } from './auth/rateLimit.js';
import { createMailer, type EmailSendOutcome } from './auth/mailer.js';
import { generateToken, hashToken, verifyToken, expirationFor } from './auth/setupToken.js';
import { validatePassword } from './auth/passwordPolicy.js';
import { auditLog } from './auth/auditLog.js';
import { inheritEliminatory, diffEliminatory, PLAN_ITEM_QUESTION_JOIN_SQL, PLAN_ITEM_ELIMINATORY_SQL, type PrevCriterion } from './src/lib/eliminatory.js';
import { hashIp } from './auth/ipHash.js';
import { SESSION, isAbsoluteExpired, isRevoked } from './auth/session.js';
import { purgeExpiredLogs } from './db/purgeExpiredLogs.js';
import { PROVIDER_EDIT_STATUSES, providerCanEditCriterion } from './src/lib/providerEdit.js';
import { questionOnly } from './src/lib/questionText.js';
import { PRIVACY_POLICY_VERSION } from './src/lib/privacyPolicy.js';
import { TERMO_EVIDENCIAS_VERSION, termoEvidenciasTexto } from './src/lib/termoEvidencias.js';
import { buildScoreMemory } from './src/lib/scoreMemory.js';
import { renderNotification, dedupeKey, roteiroReminderMarco, type NotifyType } from './src/lib/notifyCatalog.js';
import { renderNotificationEmail } from './src/lib/notifyEmail.js';
import { canDownloadManual, isPdf, MANUAL_MAX_BYTES } from './db/script-manual.js';
import { verifyResendWebhook, resendEventToStatus, webhookOverwriteCondition } from './src/lib/resendWebhook.js';

// Regra de N/A no cálculo da nota (spec 5.4): uma resposta só SAI do cálculo
// quando é N/A aprovado pelo auditor. Todo o resto entra no denominador com seu
// score_obtained — inclusive N/A reprovado, que conta como não conformidade (0).
// Sim/aprovado = pontua; Não/aprovado = 0; N/A/aprovado = fora; N/A/reprovado = 0.
// Predicado sobre a resposta aliasada como `ea`. Usado em parecer, segurança%,
// dims (painel/export), parcial ao vivo e candidatos de plano — sempre igual.
const COUNTS_IN_SCORE_SQL =
  "NOT (LOWER(COALESCE(ea.answer_value,'')) = 'na' AND ea.evidence_status = 'aprovado')" +
  " AND ea.evidence_status IS DISTINCT FROM 'nao_se_aplica'";

// Critério ainda sem decisão terminal (resposta aliasada `ea`). Fonte única do parecer
// (trava "critérios sem decisão") e do pending_count (painel e /api/eval/instances);
// NULL conta como pendente (resposta sem evidência ainda não decidida), igual ao
// AuditorPlayer e à rota de reabertura; decisão da Katy em 25/09 — o parecer passa a
// recusar critério respondido sem decisão.
const PENDING_ANSWER_SQL = "COALESCE(ea.evidence_status, 'pendente') NOT IN ('aprovado','reprovado','nao_se_aplica')";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: variável de ambiente JWT_SECRET não definida. Abortando boot.');
  process.exit(1);
}

const IP_HASH_SECRET = process.env.IP_HASH_SECRET;
if (!IP_HASH_SECRET || IP_HASH_SECRET.length < 32) {
  console.error('FATAL: variável IP_HASH_SECRET ausente ou com menos de 32 caracteres. Abortando boot.');
  process.exit(1);
}

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// Upload em memória, só para .xlsx (parse de roteiro). Limite de 5 MB.
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.xlsx$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos .xlsx são aceitos'));
    }
  },
});

// Adapta erros do multer (ex.: tamanho) para 400 com mensagem clara.
const xlsxUpload = (req: any, res: any, next: any) => {
  uploadMemory.single('file')(req, res, (err: any) => {
    if (err) {
      const isSize = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({ error: isSize ? 'Arquivo maior que 5 MB' : (err.message || 'Falha no upload') });
    }
    next();
  });
};

// Upload do manual do roteiro (PDF, em memória → bytea). Tipo validado na rota (isPdf).
const pdfUpload = (req: any, res: any, next: any) => {
  multer({ storage: multer.memoryStorage(), limits: { fileSize: MANUAL_MAX_BYTES } }).single('file')(req, res, (err: any) => {
    if (err) {
      const isSize = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({ error: isSize ? 'Arquivo maior que 20 MB' : (err.message || 'Falha no upload') });
    }
    next();
  });
};

// Extrai o número da versão a partir do texto livre gravado ("03", "v2", "" → 0).
// Observação: remove TODOS os não-dígitos, então versões pontuadas como "1.0"
// viram 10. Isso é seguro aqui porque o import grava sempre inteiros sequenciais
// (String(maxv + 1)); só o criador manual antigo usa "1.0", e ele não define
// source_file, então nunca entra no cálculo de vigência por arquivo.
const scriptVersionNum = (v: unknown): number => {
  const digits = String(v ?? '').replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
};

// ISO "YYYY-MM-DD" → "DD/MM/AAAA" para mensagens ao usuário.
const isoToBR = (iso: unknown): string => {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(iso ?? '');
};

// =============================================================================
// Seed inicial / dados de demonstração.
// O schema vive nas migrations (db/migrations/*.sql). Aqui apenas semeamos
// dados de exemplo de forma idempotente, somente quando as tabelas estão vazias.
// =============================================================================
async function initData() {
  // Seed do cooperado "Ana Souza" — só em base vazia (primeiro boot). Depois que o
  // import de prestadores rodou, esse fallback vira lixo: inflava a base a cada
  // startup quando o cooperado ficava sem provider por algum motivo.
  try {
    const { rows: provCount } = await query('SELECT COUNT(*)::int AS n FROM providers');
    if (Number(provCount[0].n) === 0) {
      const { rows: coopRows } = await query("SELECT id FROM users WHERE role = 'cooperado' AND provider_id IS NULL");
      const cooperado = coopRows[0] as any;
      if (cooperado) {
        const { rows: provRows } = await query(
          "INSERT INTO providers (name, cnpj, provider_group, qualification_level, status) VALUES ($1, $2, $3, $4, $5) RETURNING id",
          ['Consultório Dra. Ana Souza', '98.765.432/0001-10', 'Cardiologia', 'A', 'Ativo']
        );
        await query("UPDATE users SET provider_id = $1 WHERE id = $2", [provRows[0].id, cooperado.id]);
      }
    }
  } catch (e) {
    console.error("Error fixing cooperado:", e);
  }

  try {
    const { rows: settingsRows } = await query('SELECT COUNT(*) as count FROM settings');
    if (Number(settingsRows[0].count) === 0) {
      await query('INSERT INTO settings (key, value) VALUES ($1, $2)', ['current_competence', '2025-10']);

      // Calculate a default payment date (e.g., 15th of next month)
      const today = new Date();
      const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 15);
      await query('INSERT INTO settings (key, value) VALUES ($1, $2)', ['payment_date', nextMonth.toISOString().split('T')[0]]);
    }
  } catch (e) {
    console.error("Error seeding settings:", e);
  }

  // (Removido 2026-09-28) Seed de demo em base vazia criava admin@unimed.com com senha
  // fixa — em produção zerada seria um admin aberto. Equipe interna nasce sem senha e
  // define a sua pelo "Esqueci minha senha".

  // (Removido) O seed idempotente de "Dra. Ana Souza" (cooperado@unimed.com)
  // recriava o usuário a cada boot, ressuscitando a conta de demo mesmo depois
  // de excluída. A base real vem do import de prestadores + provision-users.
}

async function startServer() {
  console.log("=== STARTING THE SERVER ===");
  const app = express();
  const mailer = createMailer();
  const PORT = Number(process.env.PORT) || 3000;

  // ===== Notificações (spec 5.4.7) =====
  type NotifyRecipient = { user_id: number | null; email: string | null; name?: string | null };

  const notifyAppUrl = () => process.env.APP_URL ?? `http://localhost:${PORT}`;

  // locationId preenchido = evento de uma unidade só: notifica o acesso que cobre
  // aquela unidade (via user_locations — migration 0036). Vínculo perdido (unidade
  // sem responsável) NÃO recebe mais nada por fallback — fail-closed; a lista
  // "precisa responsável" do admin é responsabilidade da Fatia 4.
  // Só quem ativou a conta (invite_status 'accepted') recebe avisos — sininho e e-mail.
  // Acesso 'Pendente' nunca entrou no portal; o canal dele é o convite (pedido do cliente, 2026-09-24).
  async function prestadorRecipients(providerId: number, locationId: number | null = null): Promise<NotifyRecipient[]> {
    const { rows } = await query(
      `SELECT DISTINCT u.id AS user_id, u.email, u.name
         FROM user_locations ul JOIN users u ON u.id = ul.user_id
        WHERE ul.provider_id = $1 AND u.is_active = true AND u.invite_status = 'accepted'
          AND u.role IN ('prestador','cooperado','credenciado','pf_nao_medico')
          AND ($2::bigint IS NULL OR ul.location_id = ANY(ARRAY[$2]::bigint[]))`,
      [providerId, locationId]);
    return rows.map(r => ({ user_id: Number(r.user_id), email: r.email, name: r.name }));
  }

  // Algum roteiro do prestador neste ciclo tem manual enviado? (aviso de abertura, spec 2026-09-24)
  async function providerHasManual(providerId: number, cycleId: number): Promise<boolean> {
    const { rows } = await query(
      `SELECT EXISTS (
         SELECT 1 FROM eval_instances i
           JOIN eval_scripts s ON s.id = i.script_id
           JOIN eval_script_manuals m ON m.source_file = s.source_file
          WHERE i.provider_id = $1 AND i.cycle_id = $2) AS has`, [providerId, cycleId]);
    return !!rows[0]?.has;
  }

  async function auditoriaRecipients(): Promise<NotifyRecipient[]> {
    const { rows } = await query(
      `SELECT id AS user_id, email, name FROM users WHERE role = 'auditoria' AND is_active = true AND invite_status = 'accepted'`);
    return rows.map(r => ({ user_id: Number(r.user_id), email: r.email, name: r.name }));
  }

  // Envia o e-mail de uma notification e atualiza o outbox. O UPDATE inicial é o
  // "claim": incrementa attempts atomicamente e some da fila se outro tick pegou.
  // force=true: reenvio manual (staff) — ignora o teto de 3 e o filtro de status do
  // retry automático, mas SEMPRE incrementa email_attempts (o contador acumula, nunca zera).
  // Nome do destinatário p/ "Olá, Fulano." ao remontar um e-mail (retry/reenviar). Aviso só
  // por e-mail (portal:false) grava user_id NULL → cai no usuário com o mesmo e-mail.
  const RECIPIENT_NAME_SQL =
    `COALESCE(u.name, (SELECT u2.name FROM users u2 WHERE LOWER(u2.email) = LOWER(n.email_to) ORDER BY u2.id LIMIT 1))`;

  async function sendNotificationEmail(rowId: number, to: string, subject: string, text: string, html?: string, force = false) {
    try {
      const guard = force ? '' : "AND email_attempts < 3 AND email_status IN ('pendente','falhou')";
      const { rows: claimed } = await query(
        `UPDATE notifications SET email_attempts = email_attempts + 1
          WHERE id = $1 ${guard}
          RETURNING id`, [rowId]);
      if (!claimed.length) return;
      const { result, messageId } = await mailer.sendNotification(to, subject, text, html);
      await query(`UPDATE notifications SET email_status = $2, provider_message_id = COALESCE($3, provider_message_id) WHERE id = $1`,
        [rowId, result === 'suppressed' ? 'ignorado' : 'enviado', messageId ?? null]);
    } catch (e) {
      console.error(`[notify] e-mail falhou (notification ${rowId}):`, e);
      await query(`UPDATE notifications SET email_status = 'falhou' WHERE id = $1`, [rowId]).catch(() => {});
    }
  }

  // Tipos de e-mail transacional (acesso) — registrados na base de e-mails, mas NÃO
  // reenviáveis pela tela (o link/token é de uso único e não é guardado; reenvio tem
  // fluxo próprio: "Reenviar convite" / "Esqueci a senha" / novo login).
  const TRANSACTIONAL_EMAIL_TYPES = ['convite', 'reset_senha', 'otp'];

  // Registra e envia um e-mail transacional (convite/reset/OTP), guardando só tipo +
  // destinatário + status na tabela `notifications` (nunca o código do OTP nem o token
  // do link). Preserva o comportamento antigo: relança o erro do envio ao chamador.
  async function sendTransactionalEmail(
    to: string, type: string, title: string, send: () => Promise<EmailSendOutcome>,
    ref: { userId?: number; providerId?: number } = {},
  ): Promise<void> {
    let rowId: number | null = null;
    // Resolve o prestador do e-mail (para a coluna Prestador da tela): explícito, ou
    // via users.provider_id do usuário. NÃO grava user_id (não é notificação de sininho).
    let providerId = ref.providerId ?? null;
    if (providerId == null && ref.userId != null) {
      try { const { rows } = await query('SELECT provider_id FROM users WHERE id = $1', [ref.userId]); providerId = rows[0]?.provider_id ?? null; } catch { /* ignora */ }
    }
    try {
      const { rows } = await query(
        `INSERT INTO notifications (email_to, type, title, email_status, provider_id) VALUES ($1, $2, $3, 'pendente', $4) RETURNING id`,
        [to, type, title, providerId]);
      rowId = Number(rows[0].id);
    } catch (e) { console.error(`[email-log] falha ao registrar ${type}:`, e); }
    try {
      const { result, messageId } = await send();
      if (rowId) await query(`UPDATE notifications SET email_status = $2, email_attempts = 1, provider_message_id = $3 WHERE id = $1`,
        [rowId, result === 'suppressed' ? 'ignorado' : 'enviado', messageId ?? null]).catch(() => {});
    } catch (e) {
      if (rowId) await query(`UPDATE notifications SET email_status = 'falhou', email_attempts = 1 WHERE id = $1`, [rowId]).catch(() => {});
      throw e;
    }
  }

  // Grava as notificações e dispara os e-mails (fire-and-forget). NUNCA lança.
  // opts.email=false → só portal; opts.portal=false → só e-mail;
  // opts.dedupeRef → eventos de prazo (disparo único por item×destinatário).
  async function notifyEvent(
    type: NotifyType,
    ctx: Record<string, any>,
    recipients: NotifyRecipient[],
    opts: { providerId?: number; email?: boolean; portal?: boolean; dedupeRef?: string } = {},
  ) {
    const wantEmail = opts.email !== false;
    const wantPortal = opts.portal !== false;
    try {
      const c = renderNotification(type, ctx);
      // Mesmo e-mail em várias unidades (responsável único): o aviso do prestador sai
      // em um e-mail só; o sininho continua em todas as unidades.
      const emailed = new Set<string>();
      for (const r of recipients) {
        const userId = wantPortal ? r.user_id : null;
        let emailTo = wantEmail ? r.email : null;
        if (emailTo) {
          if (emailed.has(emailTo.toLowerCase())) emailTo = null;
          else emailed.add(emailTo.toLowerCase());
        }
        if (!userId && !emailTo) continue;
        const key = opts.dedupeRef ? dedupeKey(type, opts.dedupeRef, r.user_id ?? r.email ?? '') : null;
        const { rows } = await query(`
          INSERT INTO notifications (user_id, email_to, provider_id, type, title, body, link, dedupe_key, email_status, ctx)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $2::text IS NULL THEN 'na' ELSE 'pendente' END, $9)
          ON CONFLICT (dedupe_key) DO NOTHING
          RETURNING id`,
          [userId, emailTo, opts.providerId ?? null, type, c.title, c.body, c.link, key, JSON.stringify(ctx ?? {})]);
        const row = rows[0];
        if (row && emailTo) {
          // HTML no padrão visual Unimed (spec do cliente); texto puro como fallback.
          const appUrl = notifyAppUrl();
          const { subject, html } = renderNotificationEmail(type, ctx, appUrl, r.name ?? undefined);
          void sendNotificationEmail(Number(row.id), emailTo, subject, `${c.body}\n\nAcesse: ${appUrl}${c.link}`, html);
        }
      }
    } catch (e) {
      console.error(`[notify] falha ao emitir ${type}:`, e);
    }
  }

  // Atrás do proxy do Railway: confia no X-Forwarded-For para obter o IP real do cliente (RN 630 — trilha de acesso).
  app.set('trust proxy', true);

  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:3000')
    .split(',').map((o) => o.trim()).filter(Boolean);
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) {
    console.error('FATAL: ALLOWED_ORIGINS não definido em produção. Abortando boot.');
    process.exit(1);
  }
  app.use(cors({
    origin: (origin, cb) => {
      // Permite same-origin (sem header Origin) e qualquer domínio listado.
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`Origem não permitida: ${origin}`));
    },
    credentials: true,
  }));
  // Guarda o corpo cru (para verificar a assinatura do webhook do Resend).
  app.use(express.json({ verify: (req: any, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));
  app.use(cookieParser());

  // Seed/init data BEFORE routes are registered.
  await initData();

  // --- API Routes ---

  const isProd = process.env.NODE_ENV === 'production';

  // Sessão (spec 2026-09-08): JWT curto (janela de inatividade) reemitido a cada
  // request, com `sa` = início da sessão (teto absoluto) e `sv` = users.session_version
  // (revogação). Escopo por unidade continua fora do JWT (migration 0036).
  const signSession = (user: { id: number; name: string; role: string; provider_id: number | null }, sv: number, sa: number) =>
    jwt.sign(
      { id: user.id, name: user.name, role: user.role, provider_id: user.provider_id, sv, sa },
      JWT_SECRET as string,
      { expiresIn: Math.floor(SESSION.idleMs / 1000) },
    );
  const setSessionCookie = (res: any, token: string) =>
    res.cookie('session', token, { httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: SESSION.idleMs });

  // Auth Middleware — sessão só por cookie httpOnly (o fallback ao header Authorization
  // foi removido: o frontend nunca envia token por header). A cada request confere
  // assinatura e exp (inatividade), teto absoluto, e lê is_active/role/session_version
  // do banco — desativação, mudança de perfil e revogação valem na requisição seguinte.
  const authenticate = async (req: any, res: any, next: any) => {
    const token = req.cookies?.session;
    const reject = (error: string) => { res.clearCookie('session'); return res.status(401).json({ error }); };
    if (!token) return reject('No token provided');
    let claims: any;
    try {
      claims = jwt.verify(token, JWT_SECRET as string);
    } catch {
      return reject('Sessão expirada');
    }
    if (isAbsoluteExpired(claims.sa, new Date())) return reject('Sessão expirada');
    try {
      const { rows } = await query('SELECT is_active, role, session_version FROM users WHERE id = $1', [claims.id]);
      const u = rows[0];
      if (!u || u.is_active === false) return reject('Sessão encerrada');
      if (isRevoked(claims.sv, Number(u.session_version))) return reject('Sessão encerrada');
      req.user = { id: claims.id, name: claims.name, provider_id: claims.provider_id, role: u.role };
      setSessionCookie(res, signSession(req.user, Number(u.session_version), claims.sa)); // deslizante
      next();
    } catch (err) {
      console.error('authenticate:', err);
      return res.status(500).json({ error: 'Falha ao validar sessão.' });
    }
  };

  // Anexos (evidências, documentos) só com sessão válida — antes eram públicos por URL.
  // ponytail: não confere o dono do arquivo; prestador logado com o link de outro ainda abre.
  // Upgrade: servir por /api/... checando provider_id/location do registro dono do arquivo.
  app.use('/uploads', authenticate, express.static(path.join(process.cwd(), 'uploads')));
  // Se o arquivo não existe, retorna 404 explícito — evita cair no SPA fallback
  // (`app.get('*')`) e o React renderizar "página em construção" no lugar do anexo.
  app.use('/uploads', (_req, res) => res.status(404).type('text').send('Arquivo não encontrado'));

  const requireAdmin = (req: any, res: any, next: any) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores.' });
    next();
  };

  // Consolida IP_HASH_SECRET num único call-site — todos os auditLog usam este helper.
  const hashClientIp = (req: any): string | null => hashIp(req.ip, IP_HASH_SECRET as string);

  // Escopo por unidade (migration 0036): o conjunto de unidades do acesso vem do
  // banco (user_locations), resolvido por request e memoizado só nele — nunca do
  // JWT. Fail-closed: sem vínculo => conjunto vazio => não enxerga nada (staff
  // não é escopado por unidade; o helper nem é chamado nas rotas de staff).
  const userLocationIds = async (req: any): Promise<number[]> => {
    if (req._locIds) return req._locIds;
    if (!req.user?.provider_id) return (req._locIds = []);
    const { rows } = await query(
      `SELECT location_id FROM user_locations WHERE user_id = $1`, [req.user.id]);
    return (req._locIds = rows.map((r: any) => Number(r.location_id)));
  };

  // Metadados do cliente para a trilha de acesso (RN 630 — §5.2.2).
  const clientMeta = (req: any) => ({
    ipHash: hashClientIp(req),
    userAgent: (req.headers['user-agent'] as string | undefined)?.slice(0, 500) || null,
  });

  // Registra uma tentativa de login na trilha de acesso. Nunca lança — auditoria não pode quebrar o login.
  const recordAccess = async (userId: number | null, email: string | null, success: boolean, req: any) => {
    const { ipHash, userAgent } = clientMeta(req);
    await auditLog({
      query, userId, email, action: null, success,
      ip: ipHash, meta: { user_agent: userAgent },
    });
  };

  // Emite a sessão (JWT em cookie httpOnly) e devolve o payload do usuário.
  // Traz do provider: person_type (PF/PJ) e is_cooperado (grupo "MEDICOS COOPERADOS").
  const issueSession = async (res: any, user: any, previousLoginAt: any) => {
    let providerPersonType: string | null = null;
    let providerGroup: string | null = null;
    if (user.provider_id) {
      const { rows } = await query('SELECT person_type, provider_group FROM providers WHERE id = $1', [user.provider_id]);
      providerPersonType = rows[0]?.person_type ?? null;
      providerGroup = rows[0]?.provider_group ?? null;
    }
    // Cooperado = grupo "MEDICOS COOPERADOS" (com ou sem sufixo ARARANGUA). Regra ancorada
    // no provider_group porque o provider_type "MÉDICO" cobre também psicólogos/nutris/etc.
    const isCooperado = COOPERADO_GROUP_RE.test(String(providerGroup ?? '').trim());
    // `sv` lido do banco (o `user` do login pode vir de um SELECT sem a coluna); `sa` = agora.
    const { rows: svRows } = await query('SELECT session_version FROM users WHERE id = $1', [user.id]);
    setSessionCookie(res, signSession(user, Number(svRows[0]?.session_version ?? 1), Date.now()));
    return {
      user: {
        id: user.id, name: user.name, email: user.email, role: user.role,
        provider_id: user.provider_id,
        provider_person_type: providerPersonType,
        provider_group: providerGroup, is_cooperado: isCooperado,
        last_login_at: previousLoginAt,
      },
    };
  };

  // Marca login bem-sucedido: atualiza último acesso + trilha.
  const finalizeLogin = async (user: any, req: any) => {
    const previousLoginAt = user.last_login_at ?? null;
    await query('UPDATE users SET last_login_at = now(), last_login_ip = $1 WHERE id = $2', [req.ip, user.id]);
    await recordAccess(user.id, user.email, true, req);
    return previousLoginAt;
  };

  // Confere o cookie de dispositivo confiável; devolve a linha válida ou null.
  // O dispositivo vale por e-mail: confiado numa unidade, dispensa o código nas outras
  // unidades do mesmo prestador que usam o mesmo e-mail (responsável único).
  const findValidTrustedDevice = async (user: any, secret: string | undefined) => {
    if (!secret) return null;
    const hash = hashDeviceSecret(secret);
    const { rows } = await query(
      `SELECT td.* FROM trusted_devices td JOIN users u ON u.id = td.user_id
        WHERE td.token_hash = $1
          AND (td.user_id = $2 OR (u.provider_id = $3 AND u.is_active = true AND LOWER(u.email) = LOWER($4)))`,
      [hash, user.id, user.provider_id ?? null, user.email ?? null],
    );
    const device = rows[0] as any;
    if (!device) return null;
    return isTrustedDeviceValid({ expiresAt: device.expires_at, revokedAt: device.revoked_at }, new Date())
      ? device : null;
  };

  // Cria um desafio OTP, envia o e-mail e devolve o id do desafio. `setEmail` = o código
  // vai para um e-mail ainda não gravado (cadastro do e-mail da unidade); ele só entra
  // em users quando o código é validado (verify-otp).
  const createOtpChallenge = async (user: any, req: any, setEmail?: { email: string; allUnits: boolean }): Promise<number> => {
    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    const to = setEmail?.email ?? user.email;
    const { rows } = await query(
      'INSERT INTO otp_codes (user_id, code_hash, expires_at, ip, email, all_units) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [user.id, hashOtp(code), expiresAt, req.ip, setEmail?.email ?? null, !!setEmail?.allUnits],
    );
    await sendTransactionalEmail(to, 'otp', 'Código de acesso ao Portal', () => mailer.sendOtp(to, code, user.name), { userId: user.id });
    return rows[0].id;
  };

  // Bloqueio por excesso de falhas recentes (conta na trilha access_logs). A chave é o
  // login digitado: e-mail (equipe interna) ou CPF/CNPJ só com dígitos (prestador).
  const isLoginBlocked = async (email: string): Promise<boolean> => {
    const { rows } = await query(
      `SELECT created_at FROM access_logs
        WHERE email = $1 AND success = false
          AND created_at > now() - interval '15 minutes'`,
      [email],
    );
    return isRateLimited(rows.map((r: any) => r.created_at), new Date(), PASSWORD_WINDOW_MS, PASSWORD_MAX_FAILURES);
  };

  // ===== Login do prestador por CPF/CNPJ (spec 2026-10-06) =====
  // O documento identifica o prestador; cada unidade segue com o seu acesso (users).
  // A senha é única por prestador: toda gravação passa por setProviderPassword.
  // ponytail: a mesma senha fica replicada em N linhas de users (1 por unidade), não
  // numa tabela própria; se um dia divergirem, o login aceita a de qualquer unidade.
  const onlyDigits = (s: string) => s.replace(/\D/g, '');
  const maskEmail = (e: string) => {
    const [u, d] = e.split('@');
    return d ? `${u.slice(0, 2)}${'*'.repeat(Math.max(1, u.length - 2))}@${d}` : e;
  };
  // Segredo próprio: o token da etapa "senha conferida" nunca vale como sessão.
  const PRE_LOGIN_SECRET = `${JWT_SECRET}:pre-login`;

  const providerAccessesByDoc = async (doc: string): Promise<any[]> => {
    if (!doc) return [];
    const { rows } = await query(
      `SELECT u.* FROM users u JOIN providers p ON p.id = u.provider_id
        WHERE COALESCE(p.cnpj, p.cpf) = $1 AND u.is_active = true AND u.role = ANY($2)
        ORDER BY u.id`,
      [doc, PROVIDER_ACCESS_ROLES]);
    return rows;
  };

  // Acessos do prestador com o nome da(s) unidade(s) que cobrem — a lista de escolha
  // após a senha. E-mail confirmado = a unidade já fez o primeiro acesso ('accepted').
  const accessUnits = async (providerId: number) => {
    const { rows } = await query(
      `SELECT u.id AS user_id, u.email, u.invite_status,
              string_agg(concat_ws(' — ', NULLIF(pl.label, ''),
                           NULLIF(concat_ws(', ', NULLIF(pl.logradouro, ''), NULLIF(pl.bairro, ''), NULLIF(pl.cidade, '')), '')),
                         ' | ' ORDER BY pl.id) AS label,
              min(LOWER(TRIM(pl.email))) AS cadastro_email
         FROM users u
         JOIN user_locations ul ON ul.user_id = u.id
         JOIN provider_locations pl ON pl.id = ul.location_id
        WHERE u.provider_id = $1 AND u.is_active = true AND u.role = ANY($2)
        GROUP BY u.id
        ORDER BY bool_or(pl.is_primary) DESC, u.id`,
      [providerId, PROVIDER_ACCESS_ROLES]);
    return rows.map((r: any) => {
      const hasEmail = r.invite_status === 'accepted' && !!r.email;
      const suggested = hasEmail ? null : (r.email || r.cadastro_email);
      return {
        user_id: Number(r.user_id),
        label: r.label || 'Unidade',
        has_email: hasEmail,
        email: hasEmail ? String(r.email) : null,
        suggested_email: suggested && EMAIL_RE.test(suggested) ? suggested : null,
      };
    });
  };
  // O que a tela vê: o e-mail confirmado vai mascarado (a etapa ainda é pré-2FA).
  const publicUnit = ({ email, ...u }: Awaited<ReturnType<typeof accessUnits>>[number]) =>
    ({ ...u, email_masked: email ? maskEmail(email) : null });

  const setProviderPassword = (providerId: number, pwHash: string, mustChange: boolean) => query(
    `UPDATE users SET password = $1, must_change_password = $2, session_version = session_version + 1
      WHERE provider_id = $3 AND role = ANY($4)`,
    [pwHash, mustChange, providerId, PROVIDER_ACCESS_ROLES]);

  async function adminRecipients(): Promise<NotifyRecipient[]> {
    const { rows } = await query(
      `SELECT id AS user_id, email, name FROM users WHERE role = 'admin' AND is_active = true AND invite_status = 'accepted'`);
    return rows.map((r: any) => ({ user_id: Number(r.user_id), email: r.email, name: r.name }));
  }

  // Notificações do portal (Task 8) — sempre filtradas por user_id (anti-IDOR).
  app.get('/api/notifications', authenticate, async (req: any, res) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const onlyUnread = req.query.unread === '1';
      const params: any[] = [req.user.id];
      let where = 'user_id = $1';
      if (onlyUnread) where += ' AND read_at IS NULL';
      if (typeof req.query.type === 'string' && req.query.type) {
        params.push(req.query.type);
        where += ` AND type = $${params.length}`;
      }
      if (typeof req.query.q === 'string' && req.query.q.trim()) {
        params.push(`%${req.query.q.trim()}%`);
        where += ` AND (title ILIKE $${params.length} OR body ILIKE $${params.length})`;
      }
      params.push((page - 1) * 20);
      const { rows } = await query(
        `SELECT id, type, title, body, link, ctx, read_at, created_at
           FROM notifications
          WHERE ${where}
          ORDER BY id DESC LIMIT 20 OFFSET $${params.length}`,
        params);
      res.json({ page, items: rows });
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Tipos que este usuário já recebeu — alimenta o filtro "tipo" da caixa de entrada.
  app.get('/api/notifications/types', authenticate, async (req: any, res) => {
    try {
      const { rows } = await query('SELECT DISTINCT type FROM notifications WHERE user_id = $1', [req.user.id]);
      res.json(rows.map((r: any) => r.type));
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  app.get('/api/notifications/unread-count', authenticate, async (req: any, res) => {
    try {
      const { rows } = await query(
        'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
        [req.user.id]);
      res.json({ count: rows[0].count });
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  app.post('/api/notifications/:id/read', authenticate, async (req: any, res) => {
    try {
      await query('UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL',
        [req.params.id, req.user.id]);
      res.json({ ok: true });
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  app.post('/api/notifications/read-all', authenticate, async (req: any, res) => {
    try {
      await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
      res.json({ ok: true });
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // E-mails enviados (staff: admin/auditoria) — lista notificações que têm e-mail,
  // com status real (inclui 'suprimido'). Filtros: status, tipo, período (padrão 90d),
  // busca por e-mail OU nome/código do prestador. Paginado, mais recentes primeiro.
  app.get('/api/admin/emails', authenticate, async (req: any, res) => {
    try {
      if (req.user.role !== 'admin' && req.user.role !== 'auditoria')
        return res.status(403).json({ error: 'Unauthorized' });
      const page = Math.max(1, Number(req.query.page) || 1);
      const perPage = 25;
      const params: any[] = [];
      const cond: string[] = ['n.email_to IS NOT NULL'];
      const days = req.query.days === 'all' ? null : Math.max(1, Number(req.query.days) || 90);
      if (days) { params.push(days); cond.push(`n.created_at >= now() - ($${params.length}::text || ' days')::interval`); }
      if (typeof req.query.status === 'string' && req.query.status) {
        params.push(req.query.status); cond.push(`n.email_status = $${params.length}`);
      }
      if (typeof req.query.type === 'string' && req.query.type) {
        params.push(req.query.type); cond.push(`n.type = $${params.length}`);
      }
      if (typeof req.query.q === 'string' && req.query.q.trim()) {
        params.push(`%${req.query.q.trim()}%`);
        const i = params.length;
        cond.push(`(n.email_to ILIKE $${i} OR p.name ILIKE $${i} OR p.sgu_code ILIKE $${i})`);
      }
      const where = cond.join(' AND ');
      const { rows: cnt } = await query(
        `SELECT COUNT(*)::int AS total FROM notifications n LEFT JOIN providers p ON p.id = n.provider_id WHERE ${where}`, params);
      params.push((page - 1) * perPage);
      const { rows } = await query(`
        SELECT n.id, n.email_to, n.type, n.title, n.email_status, n.email_attempts, n.created_at,
               p.name AS provider_name, p.sgu_code AS provider_code
          FROM notifications n
          LEFT JOIN providers p ON p.id = n.provider_id
         WHERE ${where}
         ORDER BY n.id DESC LIMIT ${perPage} OFFSET $${params.length}`, params);
      res.json({ page, per_page: perPage, total: cnt[0].total, items: rows });
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Números do dashboard de e-mails (staff): totais por status + por tipo, no mesmo
  // recorte de período e busca da listagem (ignora o filtro de status, de propósito).
  app.get('/api/admin/emails/stats', authenticate, async (req: any, res) => {
    try {
      if (req.user.role !== 'admin' && req.user.role !== 'auditoria')
        return res.status(403).json({ error: 'Unauthorized' });
      const params: any[] = [];
      const cond: string[] = ['n.email_to IS NOT NULL'];
      const days = req.query.days === 'all' ? null : Math.max(1, Number(req.query.days) || 90);
      if (days) { params.push(days); cond.push(`n.created_at >= now() - ($${params.length}::text || ' days')::interval`); }
      if (typeof req.query.q === 'string' && req.query.q.trim()) {
        params.push(`%${req.query.q.trim()}%`);
        const i = params.length;
        cond.push(`(n.email_to ILIKE $${i} OR p.name ILIKE $${i} OR p.sgu_code ILIKE $${i})`);
      }
      const where = cond.join(' AND ');
      const base = `FROM notifications n LEFT JOIN providers p ON p.id = n.provider_id WHERE ${where}`;
      const { rows: [s] } = await query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE n.email_status = 'enviado')::int   AS enviado,
               COUNT(*) FILTER (WHERE n.email_status = 'entregue')::int  AS entregue,
               COUNT(*) FILTER (WHERE n.email_status = 'aberto')::int    AS aberto,
               COUNT(*) FILTER (WHERE n.email_status = 'rejeitado')::int AS rejeitado,
               COUNT(*) FILTER (WHERE n.email_status = 'reclamado')::int AS reclamado,
               COUNT(*) FILTER (WHERE n.email_status = 'atrasado')::int  AS atrasado,
               COUNT(*) FILTER (WHERE n.email_status = 'suprimido')::int AS suprimido,
               COUNT(*) FILTER (WHERE n.email_status = 'ignorado')::int  AS ignorado,
               COUNT(*) FILTER (WHERE n.email_status = 'falhou')::int    AS falhou,
               COUNT(*) FILTER (WHERE n.email_status = 'pendente')::int  AS pendente,
               COUNT(*) FILTER (WHERE n.email_attempts > 1)::int         AS reenviados
          ${base}`, params);
      const { rows: byType } = await query(
        `SELECT n.type, COUNT(*)::int AS count ${base} GROUP BY n.type ORDER BY count DESC LIMIT 8`, params);
      res.json({ ...s, by_type: byType });
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Reenviar um e-mail (staff): dispara na hora, remontando o e-mail rico do ctx.
  // NÃO zera email_attempts — o contador acumula (force ignora o teto de 3 do retry).
  app.post('/api/admin/emails/:id/reenviar', authenticate, async (req: any, res) => {
    try {
      if (req.user.role !== 'admin' && req.user.role !== 'auditoria')
        return res.status(403).json({ error: 'Unauthorized' });
      const id = Number(req.params.id);
      const { rows: [n] } = await query(
        `SELECT n.id, n.type, n.ctx, n.email_to, n.body, n.link, ${RECIPIENT_NAME_SQL} AS user_name
           FROM notifications n LEFT JOIN users u ON u.id = n.user_id WHERE n.id = $1`, [id]);
      if (!n) return res.status(404).json({ error: 'not found' });
      if (!n.email_to) return res.status(409).json({ error: 'notificação sem e-mail' });
      if (TRANSACTIONAL_EMAIL_TYPES.includes(n.type)) {
        return res.status(409).json({ error: 'E-mail de acesso (convite/senha/código) não é reenviável por aqui — use o fluxo próprio (Reenviar convite / Esqueci a senha / novo login).' });
      }
      const appUrl = notifyAppUrl();
      const link = n.link ?? '/qualificacao';
      const { subject, html } = renderNotificationEmail(n.type, n.ctx ?? {}, appUrl, n.user_name ?? undefined);
      await sendNotificationEmail(id, n.email_to, subject, `${n.body ?? ''}\n\nAcesse: ${appUrl}${link}`, html, true);
      const { rows: [after] } = await query('SELECT email_status, email_attempts FROM notifications WHERE id = $1', [id]);
      res.json({ ok: true, email_status: after.email_status, email_attempts: after.email_attempts });
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Webhook do Resend (público, autenticado por assinatura Svix): eventos de entrega/
  // bounce/reclamação atualizam o status do e-mail pela id da mensagem. Sem segredo
  // configurado, responde 503 (não processa nada).
  app.post('/api/webhooks/resend', async (req: any, res) => {
    try {
      const secret = process.env.RESEND_WEBHOOK_SECRET;
      if (!secret) return res.status(503).json({ error: 'webhook não configurado' });
      const ok = verifyResendWebhook(secret,
        { id: req.headers['svix-id'], timestamp: req.headers['svix-timestamp'], signature: req.headers['svix-signature'] },
        req.rawBody ?? '');
      if (!ok) return res.status(401).json({ error: 'assinatura inválida' });
      const emailId = req.body?.data?.email_id;
      const status = resendEventToStatus(req.body?.type);
      if (emailId && status) {
        // Precedência centralizada (falhas grudentas; caminho feliz não regride).
        await query(
          `UPDATE notifications SET email_status = $2 WHERE provider_message_id = $1 AND ${webhookOverwriteCondition(status)}`,
          [emailId, status]);
      }
      res.json({ ok: true });
    } catch (err: any) { console.error('[webhook resend]', err); res.status(500).json({ error: err.message }); }
  });

  // Login — etapa 1: senha. Emite sessão se o dispositivo for confiável; senão, dispara OTP.
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { password } = req.body ?? {};
      // `login` = CPF/CNPJ (prestador) ou e-mail (equipe interna). `email` é o nome antigo do campo.
      const login = String(req.body?.login ?? req.body?.email ?? '').trim();
      const isEmail = login.includes('@');
      const email = isEmail ? login : onlyDigits(login);
      if (email && await isLoginBlocked(email)) {
        return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em alguns minutos.' });
      }
      if (!isEmail) {
        // Prestador: confere a senha (única) e devolve as unidades para a escolha.
        // Sessão só sai em /api/auth/unit, depois do código no e-mail da unidade.
        const accesses = await providerAccessesByDoc(email);
        const ok = typeof password === 'string'
          && accesses.some((u) => u.password && bcrypt.compareSync(password, u.password));
        if (!ok) {
          await recordAccess(null, email || null, false, req);
          return res.status(401).json({ error: 'CPF/CNPJ ou senha incorretos.' });
        }
        const providerId = Number(accesses[0].provider_id);
        const units = await accessUnits(providerId);
        if (!units.length) {
          return res.status(403).json({ error: 'Seu acesso está sem unidade vinculada. Procure a Unimed.' });
        }
        return res.json({
          needs_unit: true,
          pre_token: jwt.sign({ pid: providerId, doc: email }, PRE_LOGIN_SECRET, { expiresIn: '15m' }),
          must_change_password: accesses.some((u) => u.must_change_password),
          units: units.map(publicUnit),
        });
      }
      const { rows } = await query('SELECT * FROM users WHERE email = $1 AND provider_id IS NULL', [email]);
      const user = rows[0] as any;
      if (!user) {
        await recordAccess(null, email ?? null, false, req);
        return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      }
      if (user.is_active === false) {
        await recordAccess(user.id, user.email, false, req);
        return res.status(403).json({ error: 'Sua conta está inativa. Procure o administrador.' });
      }
      if (!user.password) {
        await recordAccess(user.id, user.email, false, req);
        return res.status(403).json({ error: 'Sua conta ainda não foi ativada. Verifique seu e-mail.' });
      }
      if (!bcrypt.compareSync(password, user.password)) {
        await recordAccess(user.id, user.email, false, req);
        return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      }
      const device = await findValidTrustedDevice(user, req.cookies?.trusted_device);
      if (device) {
        await query('UPDATE trusted_devices SET last_used_at = now(), last_ip = $1 WHERE id = $2',
          [req.ip, device.id]);
        const previousLoginAt = await finalizeLogin(user, req);
        return res.json(await issueSession(res, user, previousLoginAt));
      }
      try {
        const challengeId = await createOtpChallenge(user, req);
        return res.json({ needs_otp: true, challenge_id: challengeId, email_masked: maskEmail(user.email) });
      } catch (mailErr: any) {
        console.error('Falha ao enviar OTP:', mailErr);
        return res.status(502).json({ error: 'Não foi possível enviar o código por e-mail. Tente novamente.' });
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Login do prestador — etapa 2: escolha da unidade. No primeiro acesso também troca
  // a senha provisória e cadastra o e-mail da unidade (confirmado pelo código).
  app.post('/api/auth/unit', async (req: any, res) => {
    try {
      let pre: any;
      try {
        pre = jwt.verify(String(req.body?.pre_token ?? ''), PRE_LOGIN_SECRET);
      } catch {
        return res.status(401).json({ error: 'Seu login expirou. Entre novamente.' });
      }
      const providerId = Number(pre.pid);
      const units = await accessUnits(providerId);
      const chosen = units.length === 1 ? units[0] : units.find((u) => u.user_id === Number(req.body?.user_id));
      if (!chosen) return res.status(400).json({ error: 'Selecione a unidade.' });
      const { rows } = await query('SELECT * FROM users WHERE id = $1', [chosen.user_id]);
      const user = rows[0] as any;

      // Valida tudo antes de gravar qualquer coisa.
      const { rows: flag } = await query(
        `SELECT bool_or(must_change_password) AS must FROM users WHERE provider_id = $1 AND is_active = true AND role = ANY($2)`,
        [providerId, PROVIDER_ACCESS_ROLES]);
      const mustChange = !!flag[0]?.must;
      const newPassword = req.body?.new_password;
      if (mustChange) {
        if (typeof newPassword !== 'string' || !newPassword) {
          return res.status(400).json({ error: 'Defina uma nova senha para continuar.' });
        }
        const policy = validatePassword(newPassword);
        if (!policy.ok) return res.status(400).json({ error: policy.errors.join(' ') });
        if (user.password && await bcrypt.compare(newPassword, user.password)) {
          return res.status(400).json({ error: 'A nova senha não pode ser igual à senha provisória.' });
        }
      }
      let setEmail: { email: string; allUnits: boolean } | undefined;
      if (!chosen.has_email) {
        const email = String(req.body?.email ?? '').trim().toLowerCase();
        if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Informe um e-mail válido para a unidade.' });
        setEmail = { email, allUnits: !!req.body?.all_units };
      }

      if (mustChange) {
        await setProviderPassword(providerId, await bcrypt.hash(newPassword, 10), false);
        await auditLog({
          query, userId: user.id, action: 'password_set',
          meta: { kind: 'first_access', provider_id: providerId }, ip: hashClientIp(req),
        });
      }

      if (!setEmail) {
        const device = await findValidTrustedDevice(user, req.cookies?.trusted_device);
        if (device) {
          await query('UPDATE trusted_devices SET last_used_at = now(), last_ip = $1 WHERE id = $2', [req.ip, device.id]);
          const previousLoginAt = await finalizeLogin(user, req);
          return res.json(await issueSession(res, user, previousLoginAt));
        }
      }
      // Quem tem a senha escolhe para onde vai o código: teto por hora evita usar o portal para disparar e-mails.
      const { rows: sent } = await query(
        `SELECT count(*)::int AS n FROM otp_codes WHERE user_id = $1 AND created_at > now() - interval '1 hour'`, [user.id]);
      if (sent[0].n >= 6) {
        return res.status(429).json({ error: 'Limite de códigos por hora atingido. Tente mais tarde.' });
      }
      try {
        const challengeId = await createOtpChallenge(user, req, setEmail);
        return res.json({ needs_otp: true, challenge_id: challengeId, email_masked: maskEmail(setEmail?.email ?? user.email) });
      } catch (mailErr: any) {
        console.error('Falha ao enviar OTP:', mailErr);
        return res.status(502).json({ error: 'Não foi possível enviar o código por e-mail. Tente novamente.' });
      }
    } catch (err: any) {
      console.error('POST /api/auth/unit:', err);
      res.status(500).json({ error: 'Falha ao entrar na unidade.' });
    }
  });

  // Unidades do prestador logado — para trocar de unidade sem sair.
  app.get('/api/auth/units', authenticate, async (req: any, res) => {
    if (!req.user.provider_id) return res.json({ units: [] });
    const units = await accessUnits(Number(req.user.provider_id));
    const mine = units.find((u) => u.user_id === Number(req.user.id));
    res.json({
      units: units.map((u) => ({
        user_id: u.user_id, label: u.label, current: u.user_id === Number(req.user.id),
        // Troca direta só entre unidades com o mesmo e-mail confirmado; as demais pedem o código (novo login).
        can_switch: !!mine?.email && !!u.email && u.email.toLowerCase() === mine.email.toLowerCase(),
      })),
    });
  });

  app.post('/api/auth/switch-unit', authenticate, async (req: any, res) => {
    try {
      if (!req.user.provider_id) return res.status(403).json({ error: 'Unauthorized' });
      const units = await accessUnits(Number(req.user.provider_id));
      const mine = units.find((u) => u.user_id === Number(req.user.id));
      const target = units.find((u) => u.user_id === Number(req.body?.user_id));
      if (!target) return res.status(404).json({ error: 'Unidade não encontrada.' });
      if (!mine?.email || !target.email || target.email.toLowerCase() !== mine.email.toLowerCase()) {
        return res.status(409).json({ error: 'Esta unidade usa outro e-mail. Saia e entre novamente escolhendo a unidade.' });
      }
      const { rows } = await query('SELECT * FROM users WHERE id = $1', [target.user_id]);
      const previousLoginAt = await finalizeLogin(rows[0], req);
      res.json(await issueSession(res, rows[0], previousLoginAt));
    } catch (err: any) {
      console.error('POST /api/auth/switch-unit:', err);
      res.status(500).json({ error: 'Falha ao trocar de unidade.' });
    }
  });

  // Login — etapa 2: verificação do código OTP.
  app.post('/api/auth/verify-otp', async (req, res) => {
    try {
      const { challenge_id, code, trust_device } = req.body;
      const { rows } = await query('SELECT * FROM otp_codes WHERE id = $1', [challenge_id]);
      const challenge = rows[0] as any;
      if (!challenge || challenge.consumed_at) {
        return res.status(400).json({ error: 'Código inválido ou já utilizado. Solicite um novo.' });
      }
      if (isOtpExpired(challenge.expires_at, new Date())) {
        return res.status(400).json({ error: 'Código expirado. Solicite um novo.' });
      }
      // Incremento atômico de tentativas (evita TOCTOU em requisições concorrentes).
      const reserved = await query(
        `UPDATE otp_codes
            SET attempts = attempts + 1
          WHERE id = $1 AND consumed_at IS NULL AND attempts < $2
          RETURNING attempts`,
        [challenge.id, OTP_MAX_ATTEMPTS],
      );
      if (reserved.rowCount === 0) {
        await query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL', [challenge.id]);
        return res.status(429).json({ error: 'Muitas tentativas. Solicite um novo código.' });
      }
      const { rows: userRows } = await query('SELECT * FROM users WHERE id = $1', [challenge.user_id]);
      const user = userRows[0] as any;
      if (!user) {
        return res.status(400).json({ error: 'Usuário não encontrado.' });
      }
      if (user.is_active === false) {
        await recordAccess(user.id, user.email, false, req);
        return res.status(403).json({ error: 'Usuário inativo' });
      }
      const codeStr = String(code ?? '');
      if (!isTestMasterOtp(codeStr) && !verifyOtp(codeStr, challenge.code_hash)) {
        await recordAccess(user.id, user.email, false, req);
        return res.status(401).json({ error: 'Código incorreto.' });
      }
      await query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [challenge.id]);
      // Código validado no e-mail informado: agora sim ele vira o e-mail da unidade
      // (2FA e avisos). all_units = também nas demais unidades que ainda não têm e-mail.
      if (challenge.email) {
        await query(`UPDATE users SET email = $1, invite_status = 'accepted' WHERE id = $2`, [challenge.email, user.id]);
        if (challenge.all_units && user.provider_id) {
          await query(
            `UPDATE users SET email = $1, invite_status = 'accepted'
              WHERE provider_id = $2 AND id <> $3 AND is_active = true AND role = ANY($4) AND invite_status <> 'accepted'`,
            [challenge.email, user.provider_id, user.id, PROVIDER_ACCESS_ROLES]);
        }
        user.email = challenge.email;
        await auditLog({
          query, userId: user.id, action: 'unit_email_set',
          meta: { provider_id: user.provider_id ?? null, all_units: !!challenge.all_units }, ip: hashClientIp(req),
        });
      }
      if (trust_device) {
        const secret = generateDeviceSecret();
        const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_TTL_MS);
        const { userAgent } = clientMeta(req);
        await query(
          `INSERT INTO trusted_devices (user_id, token_hash, label, last_ip, expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [user.id, hashDeviceSecret(secret), deviceLabelFromUserAgent(userAgent ?? undefined), req.ip, expiresAt],
        );
        res.cookie('trusted_device', secret, {
          httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: TRUSTED_DEVICE_TTL_MS,
        });
      }
      const previousLoginAt = await finalizeLogin(user, req);
      return res.json(await issueSession(res, user, previousLoginAt));
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Reenvio de OTP — cooldown de 60s e teto de 6 códigos/hora por usuário.
  app.post('/api/auth/resend-otp', async (req, res) => {
    try {
      const { challenge_id } = req.body;
      const { rows } = await query('SELECT * FROM otp_codes WHERE id = $1', [challenge_id]);
      const challenge = rows[0] as any;
      if (!challenge || challenge.consumed_at) {
        return res.status(400).json({ error: 'Desafio inválido. Faça login novamente.' });
      }
      const { rows: countRows } = await query(
        `SELECT count(*)::int AS n FROM otp_codes
          WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
        [challenge.user_id],
      );
      if (countRows[0].n >= 6) {
        return res.status(429).json({ error: 'Limite de códigos por hora atingido. Tente mais tarde.' });
      }
      const { rows: userRows } = await query('SELECT id, email, name FROM users WHERE id = $1', [challenge.user_id]);
      const user = userRows[0] as any;
      if (!user) {
        return res.status(400).json({ error: 'Usuário não encontrado.' });
      }
      const code = generateOtpCode();
      // Cooldown + reset atômico (evita corrida em resends concorrentes).
      const reserved = await query(
        `UPDATE otp_codes
            SET code_hash = $1, attempts = 0, expires_at = $2, created_at = now()
          WHERE id = $3
            AND consumed_at IS NULL
            AND created_at <= now() - interval '60 seconds'
          RETURNING id`,
        [hashOtp(code), new Date(Date.now() + OTP_TTL_MS), challenge.id],
      );
      if (reserved.rowCount === 0) {
        return res.status(429).json({ error: 'Aguarde alguns segundos antes de pedir um novo código.' });
      }
      try {
        const to = challenge.email ?? user.email;
        await sendTransactionalEmail(to, 'otp', 'Código de acesso ao Portal', () => mailer.sendOtp(to, code, user.name), { userId: user.id });
      } catch (mailErr: any) {
        console.error('Falha ao reenviar OTP:', mailErr);
        return res.status(502).json({ error: 'Não foi possível reenviar o código. Tente novamente.' });
      }
      return res.json({ ok: true });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Esqueci a senha — sempre responde { ok: true } para evitar enumeração de logins.
  // Rate-limit duplo (IP e login) usa access_logs como fonte de verdade.
  // Equipe interna (e-mail): link de redefinição. Prestador (CPF/CNPJ): link só quando
  // tem UM local com e-mail confirmado; com mais de um local — ou sem e-mail — o pedido
  // vira aviso para os administradores, que definem nova senha provisória.
  app.post('/api/auth/forgot-password', async (req: any, res) => {
    try {
      const raw = req.body?.login ?? req.body?.email;
      if (typeof raw !== 'string') return res.json({ ok: true });

      const isEmail = raw.includes('@');
      const emailLc = isEmail ? raw.trim().toLowerCase() : onlyDigits(raw);
      if (!emailLc) return res.json({ ok: true });

      const ipOk = await checkRateLimit('', hashClientIp(req) ?? '', 'password_reset_requested', 60, 10);
      const emailOk = await checkRateLimit(emailLc, '', 'password_reset_requested', 60, 5);
      if (!ipOk || !emailOk) return res.json({ ok: true });

      let user: any = null;
      let askTeam: any = null;
      if (isEmail) {
        const { rows } = await query(
          'SELECT id, email, name FROM users WHERE LOWER(email) = $1 AND is_active = true AND provider_id IS NULL',
          [emailLc],
        );
        user = rows[0] ?? null;
      } else {
        const accesses = await providerAccessesByDoc(emailLc);
        if (accesses.length === 1 && accesses[0].email && accesses[0].invite_status === 'accepted') user = accesses[0];
        else askTeam = accesses[0] ?? null;
      }

      // meta.email é a chave que o checkRateLimit por login conta.
      await auditLog({
        query, action: 'password_reset_requested',
        meta: { exists: !!(user || askTeam), email: emailLc, to_team: !!askTeam },
        ip: hashClientIp(req),
      });

      if (askTeam) {
        // dedupeRef por dia: no máximo um aviso por prestador × administrador por dia.
        await notifyEvent('senha_solicitada', { provider_name: askTeam.name, provider_id: Number(askTeam.provider_id) },
          await adminRecipients(),
          { providerId: Number(askTeam.provider_id), dedupeRef: `${askTeam.provider_id}:${new Date().toISOString().slice(0, 10)}` });
        return res.json({ ok: true });
      }
      if (!user) return res.json({ ok: true });

      await query(
        `UPDATE password_setup_tokens SET used_at = now()
         WHERE user_id = $1 AND kind = 'reset' AND used_at IS NULL`,
        [user.id],
      );

      const token = generateToken();
      const tokenHash = await hashToken(token);
      const expiresAt = expirationFor('reset');
      await query(
        `INSERT INTO password_setup_tokens (user_id, token_hash, kind, expires_at)
         VALUES ($1, $2, 'reset', $3)`,
        [user.id, tokenHash, expiresAt],
      );

      const appUrl = process.env.APP_URL ?? `${req.protocol}://${req.get('host')}`;
      const link = `${appUrl}/definir-senha?token=${token}`;
      await sendTransactionalEmail(user.email, 'reset_senha', 'Redefinição de senha', () => mailer.sendPasswordReset(user.email, link, user.name), { userId: user.id });

      res.json({ ok: true });
    } catch (err: any) {
      console.error('POST /api/auth/forgot-password:', err);
      res.json({ ok: true });
    }
  });

  // Valida um token de convite/reset sem consumi-lo — usado pelo /definir-senha
  // para exibir o nome do usuário e diferenciar fluxo (invite vs reset).
  app.get('/api/auth/validate-setup-token', async (req: any, res) => {
    try {
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      if (!/^[0-9a-f]{64}$/.test(token)) {
        return res.json({ valid: false, reason: 'unknown' });
      }

      const { rows } = await query(
        `SELECT t.id, t.user_id, t.kind, t.expires_at, t.used_at, t.token_hash, u.name
         FROM password_setup_tokens t
         JOIN users u ON u.id = t.user_id
         WHERE t.kind IN ('invite','reset') AND t.used_at IS NULL AND t.expires_at > now()`,
      );

      for (const row of rows as any[]) {
        if (await verifyToken(token, row.token_hash)) {
          return res.json({ valid: true, kind: row.kind, name: row.name });
        }
      }
      return res.json({ valid: false, reason: 'expired' });
    } catch (err: any) {
      console.error('GET /api/auth/validate-setup-token:', err);
      res.json({ valid: false, reason: 'unknown' });
    }
  });

  // Encarregado de Dados (DPO) — público, sem autenticação.
  app.get('/api/privacy/dpo', (_req, res) => {
    res.json({
      name: process.env.DPO_NAME ?? 'A definir',
      email: process.env.DPO_EMAIL ?? null,
    });
  });

  // Consome um token de convite/reset definindo a senha. Em reset, derruba os
  // trusted_devices do usuário para invalidar sessões antigas após troca de senha.
  app.post('/api/auth/redeem-token', async (req: any, res) => {
    try {
      const { token, new_password } = req.body ?? {};

      if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
        return res.status(400).json({ error: 'Link inválido.' });
      }
      if (typeof new_password !== 'string') {
        return res.status(400).json({ error: 'Senha obrigatória.' });
      }

      const ipOk = await checkRateLimit('', hashClientIp(req) ?? '', 'redeem_token', 60, 10);
      if (!ipOk) return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em 1 hora.' });

      const policy = validatePassword(new_password);
      if (!policy.ok) return res.status(400).json({ error: policy.errors.join(' ') });

      const { rows } = await query(
        `SELECT t.id, t.user_id, t.kind, t.token_hash
         FROM password_setup_tokens t
         WHERE t.kind IN ('invite','reset') AND t.used_at IS NULL AND t.expires_at > now()`,
      );

      let matched: any = null;
      for (const row of rows as any[]) {
        if (await verifyToken(token, row.token_hash)) {
          matched = row;
          break;
        }
      }
      if (!matched) return res.status(400).json({ error: 'Link inválido ou expirado.' });

      if (matched.kind === 'reset') {
        const { rows: pwRows } = await query('SELECT password FROM users WHERE id = $1', [matched.user_id]);
        const currentHash = pwRows[0]?.password;
        if (currentHash && await bcrypt.compare(new_password, currentHash)) {
          return res.status(400).json({ error: 'A nova senha não pode ser igual à anterior.' });
        }
      }

      const pwHash = await bcrypt.hash(new_password, 10);

      await withTransaction(async (client) => {
        const claim = await client.query(
          `UPDATE password_setup_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
          [matched.id]
        );
        if (claim.rowCount === 0) throw new Error('token_already_consumed');
        await client.query(
          `UPDATE users SET password = $1, invite_status = 'accepted', must_change_password = false, session_version = session_version + 1 WHERE id = $2`,
          [pwHash, matched.user_id],
        );
        // Senha única do prestador: replica nos demais acessos (equipe interna não tem provider_id).
        await client.query(
          `UPDATE users SET password = $1, must_change_password = false, session_version = session_version + 1
            WHERE id <> $2 AND role = ANY($3) AND provider_id = (SELECT provider_id FROM users WHERE id = $2)`,
          [pwHash, matched.user_id, PROVIDER_ACCESS_ROLES],
        );
        if (matched.kind === 'reset') {
          await client.query(`DELETE FROM trusted_devices WHERE user_id = $1`, [matched.user_id]);
        }
      });

      await auditLog({
        query, userId: matched.user_id, action: 'password_set',
        meta: { kind: matched.kind },
        ip: hashClientIp(req),
      });

      res.json({ ok: true });
    } catch (err: any) {
      if (err?.message === 'token_already_consumed') {
        return res.status(400).json({ error: 'Link inválido ou expirado.' });
      }
      console.error('POST /api/auth/redeem-token:', err);
      res.status(500).json({ error: 'Falha ao definir senha.' });
    }
  });

  // Logout — incrementa session_version (encerra TODAS as sessões do usuário, em todos os
  // dispositivos) e limpa o cookie. Não passa por `authenticate` para nunca devolver 401
  // no logout; aceita token já expirado só para identificar o usuário. trusted_device
  // segue valendo (só dispensa o 2FA).
  app.post('/api/auth/logout', async (req: any, res) => {
    try {
      const claims: any = req.cookies?.session
        ? jwt.verify(req.cookies.session, JWT_SECRET as string, { ignoreExpiration: true })
        : null;
      if (claims?.id) await query('UPDATE users SET session_version = session_version + 1 WHERE id = $1', [claims.id]);
    } catch { /* token inválido: só limpa o cookie */ }
    res.clearCookie('session');
    res.json({ ok: true });
  });

  // Dados do usuário autenticado (substitui leitura do localStorage no frontend).
  app.get('/api/auth/me', authenticate, async (req: any, res) => {
    const { rows } = await query(
      `SELECT id, name, email, role, provider_id, last_login_at,
              (SELECT pa.policy_version FROM privacy_acceptances pa WHERE pa.user_id = users.id
                ORDER BY pa.accepted_at DESC, pa.id DESC LIMIT 1) AS privacy_accepted_version
         FROM users WHERE id = $1`,
      [req.user.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({ user: rows[0] });
  });

  // Aceite da Política de Privacidade (spec 2026-09-29) — só INSERT, registro definitivo.
  app.post('/api/privacy/accept', authenticate, async (req: any, res) => {
    try {
      if (req.body?.version !== PRIVACY_POLICY_VERSION) {
        return res.status(409).json({ error: 'A política foi atualizada. Recarregue a página.' });
      }
      const { rows: prev } = await query(
        'SELECT accepted_at FROM privacy_acceptances WHERE user_id = $1 AND policy_version = $2 LIMIT 1',
        [req.user.id, PRIVACY_POLICY_VERSION]);
      if (prev[0]) return res.json({ ok: true, accepted_at: prev[0].accepted_at });
      const { rows } = await query(
        `INSERT INTO privacy_acceptances (user_id, user_name, user_email, policy_version, ip_hash)
         SELECT id, name, email, $2, $3 FROM users WHERE id = $1
         RETURNING accepted_at`,
        [req.user.id, PRIVACY_POLICY_VERSION, hashClientIp(req)]);
      await auditLog({ query, userId: req.user.id, action: 'privacy_policy_accepted', meta: { version: PRIVACY_POLICY_VERSION }, ip: hashClientIp(req) });
      res.json({ ok: true, accepted_at: rows[0]?.accepted_at ?? null });
    } catch (err) {
      console.error('POST /api/privacy/accept:', err);
      res.status(500).json({ error: 'Falha ao registrar o aceite.' });
    }
  });

  // Lista dispositivos confiáveis ativos do usuário corrente.
  app.get('/api/auth/trusted-devices', authenticate, async (req: any, res) => {
    const { rows } = await query(
      `SELECT id, label, last_ip, last_used_at, expires_at, created_at
         FROM trusted_devices
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY last_used_at DESC`,
      [req.user.id],
    );
    res.json({ devices: rows });
  });

  // Revoga um dispositivo confiável do usuário corrente.
  app.delete('/api/auth/trusted-devices/:id', authenticate, async (req: any, res) => {
    const result = await query(
      'UPDATE trusted_devices SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
      [req.params.id, req.user.id],
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Dispositivo não encontrado' });
    res.json({ ok: true });
  });

  // Trilha de acesso do próprio titular (LGPD art. 19) — sem ip_hash nem user_agent.
  app.get('/api/me/access-logs', authenticate, async (req: any, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const { rows: countRows } = await query(
        'SELECT COUNT(*)::int AS total FROM access_logs WHERE user_id = $1', [req.user.id],
      );
      const { rows } = await query(
        `SELECT id, action, meta, success, created_at
           FROM access_logs
          WHERE user_id = $1
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3`,
        [req.user.id, limit, offset],
      );
      res.json({ logs: rows, total: countRows[0]?.total ?? 0, limit, offset });
    } catch (err: any) {
      console.error('GET /api/me/access-logs:', err);
      res.status(500).json({ error: 'Falha ao carregar logs.' });
    }
  });

  // Trilha de acesso — leitura (RN 630). Restrito a admin/auditoria.
  app.get('/api/access-logs', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Acesso restrito a administradores e auditoria' });
      }

      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      // Filtros opcionais.
      const where: string[] = [];
      const params: any[] = [];
      if (req.query.email) { params.push(`%${req.query.email}%`); where.push(`al.email ILIKE $${params.length}`); }
      if (req.query.success === 'true' || req.query.success === 'false') {
        params.push(req.query.success === 'true'); where.push(`al.success = $${params.length}`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const { rows: countRows } = await query(`SELECT COUNT(*)::int AS total FROM access_logs al ${whereSql}`, params);
      const total = countRows[0]?.total ?? 0;

      params.push(limit, offset);
      const { rows } = await query(
        `SELECT al.id, al.user_id, al.email, al.ip_hash, al.success, al.action, al.meta, al.created_at,
                u.name AS user_name, u.role AS user_role
         FROM access_logs al
         LEFT JOIN users u ON u.id = al.user_id
         ${whereSql}
         ORDER BY al.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );

      res.json({ logs: rows, total, limit, offset });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // === Cadastro de usuários internos (admin/auditoria) por convite por e-mail ===

  app.post('/api/users', authenticate, requireAdmin, async (req: any, res) => {
    try {
      const { name, email, role } = req.body ?? {};

      if (typeof name !== 'string' || name.trim().length < 2 || name.length > 100) {
        return res.status(400).json({ error: 'Nome inválido (2 a 100 caracteres).' });
      }
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'E-mail inválido.' });
      }
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Esta UI só cria usuários admin ou auditoria.' });
      }

      const emailLc = email.trim().toLowerCase();
      const dup = await query('SELECT id FROM users WHERE LOWER(email) = $1', [emailLc]);
      if (dup.rows.length > 0) {
        return res.status(409).json({ error: 'Já existe um usuário com este e-mail.' });
      }

      const ins = await query(
        `INSERT INTO users (name, email, password, role, provider_id, is_active, invite_status)
         VALUES ($1, $2, NULL, $3, NULL, true, 'pending')
         RETURNING id, name, email, role, is_active, invite_status`,
        [name.trim(), emailLc, role]
      );
      const newUser = ins.rows[0];

      const token = generateToken();
      const tokenHash = await hashToken(token);
      const expiresAt = expirationFor('invite');
      await query(
        `INSERT INTO password_setup_tokens (user_id, token_hash, kind, expires_at, created_by_user_id)
         VALUES ($1, $2, 'invite', $3, $4)`,
        [newUser.id, tokenHash, expiresAt, req.user.id]
      );

      const appUrl = process.env.APP_URL ?? `${req.protocol}://${req.get('host')}`;
      const link = `${appUrl}/definir-senha?token=${token}`;
      await sendTransactionalEmail(newUser.email, 'convite', 'Convite de acesso ao Portal', () => mailer.sendInvite(newUser.email, newUser.name, link), { userId: newUser.id });

      await auditLog({
        query, userId: req.user.id, action: 'user_invited',
        meta: { invited_email: newUser.email, invited_role: newUser.role },
        ip: hashClientIp(req),
      });

      res.status(201).json(newUser);
    } catch (err: any) {
      console.error('POST /api/users:', err);
      res.status(500).json({ error: 'Falha ao criar usuário.' });
    }
  });

  app.post('/api/admin/data-retention/run', authenticate, requireAdmin, async (req: any, res) => {
    try {
      const result = await purgeExpiredLogs(query);
      await auditLog({
        query, userId: req.user.id, action: 'data_retention_run',
        meta: { ...result }, ip: hashClientIp(req),
      });
      res.json(result);
    } catch (err: any) {
      console.error('POST /api/admin/data-retention/run:', err);
      await auditLog({
        query, userId: req.user.id, action: 'data_retention_run',
        meta: { error: String(err?.message ?? err) },
        ip: hashClientIp(req), success: false,
      }).catch(e => console.error('[retention] falhou ao registrar audit de erro:', e));
      res.status(500).json({ error: 'Falha ao executar expurgo.' });
    }
  });

  app.get('/api/users', authenticate, requireAdmin, async (_req: any, res) => {
    try {
      const { rows } = await query(
        `SELECT u.id, u.name, u.email, u.role, u.is_active, u.invite_status, u.last_login_at, u.created_at,
                u.provider_id, p.sgu_code AS provider_code,
                ul.location_id, pl.sgu_location_code,
                COALESCE(NULLIF(pl.logradouro, ''), NULLIF(pl.label, ''), pl.cidade) AS location_label, pl.cidade AS location_cidade,
                pa.accepted_at AS privacy_accepted_at, pa.policy_version AS privacy_accepted_version
         FROM users u
         LEFT JOIN providers p ON p.id = u.provider_id
         LEFT JOIN LATERAL (
           SELECT accepted_at, policy_version FROM privacy_acceptances
            WHERE user_id = u.id ORDER BY accepted_at DESC, id DESC LIMIT 1
         ) pa ON true
         LEFT JOIN LATERAL (
           SELECT location_id FROM user_locations WHERE user_id = u.id ORDER BY location_id LIMIT 1
         ) ul ON true
         LEFT JOIN provider_locations pl ON pl.id = ul.location_id
         ORDER BY u.created_at DESC`
      );
      res.json(rows);
    } catch (err: any) {
      console.error('GET /api/users:', err);
      res.status(500).json({ error: 'Falha ao listar usuários.' });
    }
  });

  app.patch('/api/users/:id', authenticate, requireAdmin, async (req: any, res) => {
    try {
      const targetId = parseInt(req.params.id, 10);
      if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'ID inválido.' });

      const { rows: targetRows } = await query('SELECT id, role, is_active, email, invite_status FROM users WHERE id = $1', [targetId]);
      const target = targetRows[0];
      if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

      const { role: newRole, is_active: newActive } = req.body ?? {};
      const newEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : undefined;

      if (typeof newEmail !== 'undefined' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) {
        return res.status(400).json({ error: 'E-mail inválido.' });
      }

      if (typeof newRole !== 'undefined') {
        if (newRole !== 'admin' && newRole !== 'auditoria' && !PROVIDER_ACCESS_ROLES.includes(newRole)) {
          return res.status(400).json({ error: 'Role inválida.' });
        }
        if (targetId === req.user.id && target.role === 'admin' && newRole !== 'admin') {
          return res.status(400).json({ error: 'Você não pode rebaixar a própria conta.' });
        }
        // Fronteira de conceito: usuário operacional (admin/auditoria) e acesso de
        // prestador (prestador/cooperado) nunca se convertem um no outro.
        const OPERATOR_ROLES = ['admin', 'auditoria'];
        if (OPERATOR_ROLES.includes(newRole) !== OPERATOR_ROLES.includes(target.role)) {
          return res.status(400).json({ error: 'Não é possível converter entre usuário operacional e acesso de prestador.' });
        }
      }

      if (typeof newActive !== 'undefined') {
        if (typeof newActive !== 'boolean') return res.status(400).json({ error: 'is_active deve ser booleano.' });
        if (targetId === req.user.id && newActive === false) {
          return res.status(400).json({ error: 'Você não pode desativar a própria conta.' });
        }
      }

      const updates: string[] = [];
      const params: any[] = [];
      if (typeof newRole !== 'undefined' && newRole !== target.role) {
        params.push(newRole);
        updates.push(`role = $${params.length}`);
      }
      if (typeof newActive !== 'undefined' && newActive !== target.is_active) {
        params.push(newActive);
        updates.push(`is_active = $${params.length}`);
      }
      const emailChanged = typeof newEmail !== 'undefined' && newEmail !== (target.email ?? '').toLowerCase();
      if (emailChanged) {
        params.push(newEmail);
        updates.push(`email = $${params.length}`);
      }

      if (updates.length === 0) {
        const { rows } = await query('SELECT id, name, email, role, is_active, invite_status, last_login_at FROM users WHERE id = $1', [targetId]);
        return res.json(rows[0]);
      }

      params.push(targetId);
      let rows: any[];
      try {
        ({ rows } = await query(
          `UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length}
           RETURNING id, name, email, role, is_active, invite_status, last_login_at`,
          params
        ));
      } catch (e: any) {
        if (e?.code === '23505') return res.status(409).json({ error: 'Este e-mail já está em uso por outro usuário.' });
        throw e;
      }

      if (emailChanged) {
        // Convite pendente apontava pro e-mail antigo — invalida; o envio é ação separada do admin.
        await query(
          `UPDATE password_setup_tokens SET used_at = now()
            WHERE user_id = $1 AND kind = 'invite' AND used_at IS NULL`,
          [targetId]
        );
        await auditLog({
          query, userId: req.user.id, action: 'user_email_changed',
          meta: { target_user_id: targetId, from: target.email, to: newEmail },
          ip: hashClientIp(req),
        });
      }

      if (typeof newRole !== 'undefined' && newRole !== target.role) {
        await auditLog({
          query, userId: req.user.id, action: 'user_role_changed',
          meta: { target_user_id: targetId, from: target.role, to: newRole },
          ip: hashClientIp(req),
        });
      }
      if (typeof newActive !== 'undefined' && newActive !== target.is_active) {
        await auditLog({
          query, userId: req.user.id,
          action: newActive ? 'user_activated' : 'user_deactivated',
          meta: { target_user_id: targetId },
          ip: hashClientIp(req),
        });
      }

      res.json(rows[0]);
    } catch (err: any) {
      console.error('PATCH /api/users/:id:', err);
      res.status(500).json({ error: 'Falha ao atualizar usuário.' });
    }
  });

  app.post('/api/users/:id/resend-invite', authenticate, requireAdmin, async (req: any, res) => {
    try {
      const targetId = parseInt(req.params.id, 10);
      if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'ID inválido.' });

      const { rows: targetRows } = await query('SELECT id, name, email, invite_status, provider_id FROM users WHERE id = $1', [targetId]);
      const target = targetRows[0];
      if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
      // Convite é só da equipe interna (login por e-mail). Prestador entra por CPF/CNPJ.
      if (target.provider_id) {
        return res.status(400).json({ error: 'Prestador não usa convite: defina a senha provisória na aba Acessos do prestador.' });
      }
      if (target.invite_status === 'accepted') {
        return res.status(409).json({ error: 'Usuário já definiu senha. Oriente-o a usar "Esqueci minha senha".' });
      }
      if (!target.email) {
        return res.status(400).json({ error: 'Usuário sem e-mail — defina o e-mail antes de enviar o convite.' });
      }

      await query(
        `UPDATE password_setup_tokens SET used_at = now()
         WHERE user_id = $1 AND kind = 'invite' AND used_at IS NULL`,
        [targetId]
      );

      const token = generateToken();
      const tokenHash = await hashToken(token);
      const expiresAt = expirationFor('invite');
      await query(
        `INSERT INTO password_setup_tokens (user_id, token_hash, kind, expires_at, created_by_user_id)
         VALUES ($1, $2, 'invite', $3, $4)`,
        [targetId, tokenHash, expiresAt, req.user.id]
      );

      await query(`UPDATE users SET invite_status = 'pending' WHERE id = $1`, [targetId]);

      const appUrl = process.env.APP_URL ?? `${req.protocol}://${req.get('host')}`;
      const link = `${appUrl}/definir-senha?token=${token}`;
      await sendTransactionalEmail(target.email, 'convite', 'Convite de acesso ao Portal', () => mailer.sendInvite(target.email, target.name, link), { userId: target.id });

      await auditLog({
        query, userId: req.user.id, action: 'invite_resent',
        meta: { target_user_id: targetId },
        ip: hashClientIp(req),
      });

      res.json({ ok: true });
    } catch (err: any) {
      console.error('POST /api/users/:id/resend-invite:', err);
      res.status(500).json({ error: 'Falha ao reenviar convite.' });
    }
  });

  // === WS5: Equipe do prestador (provider_contacts) — §5.2.3 Tela 3. Contatos informativos, sem login. ===

  // Resolve o provider_id do usuário logado (JWT já traz; faz fallback no banco por segurança).
  const resolveProviderId = async (req: any): Promise<number | null> => {
    let { provider_id, role, id: user_id } = req.user;
    if (!provider_id && role !== 'admin' && role !== 'auditoria') {
      const { rows } = await query('SELECT provider_id FROM users WHERE id = $1', [user_id]);
      provider_id = (rows[0] as any)?.provider_id ?? null;
    }
    return provider_id ?? null;
  };

  app.get('/api/provider-contacts', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role === 'admin' || role === 'auditoria') {
        if (req.query.provider_id) {
          const { rows } = await query('SELECT * FROM provider_contacts WHERE provider_id = $1 ORDER BY created_at DESC', [req.query.provider_id]);
          return res.json(rows);
        }
        const { rows } = await query(
          'SELECT pc.*, p.name as provider_name FROM provider_contacts pc JOIN providers p ON pc.provider_id = p.id ORDER BY pc.created_at DESC'
        );
        return res.json(rows);
      }
      const providerId = await resolveProviderId(req);
      if (!providerId) return res.json([]);
      const { rows } = await query('SELECT * FROM provider_contacts WHERE provider_id = $1 ORDER BY created_at DESC', [providerId]);
      res.json(rows);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/provider-contacts', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      const { name, position, email, phone, cpf, council_registry } = req.body;
      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'Nome é obrigatório' });
      }
      // Prestador/cooperado só cadastra na própria equipe; admin/auditoria informam o provider_id.
      const providerId = (role === 'admin' || role === 'auditoria') ? req.body.provider_id : await resolveProviderId(req);
      if (!providerId) {
        return res.status(400).json({ error: 'Prestador não identificado para este contato' });
      }
      const { rows } = await query(
        `INSERT INTO provider_contacts (provider_id, name, position, email, phone, cpf, council_registry)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [providerId, String(name).trim(), position || null, email || null, phone || null, cpf || null, council_registry || null]
      );
      await auditLog({
        query, userId: req.user.id, action: 'provider_contact_created',
        meta: { provider_id: Number(providerId), contact_id: rows[0].id, name: rows[0].name, position: rows[0].position },
        ip: hashClientIp(req),
      });
      res.json(rows[0]);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/provider-contacts/:id', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      const { rows: existing } = await query('SELECT provider_id FROM provider_contacts WHERE id = $1', [req.params.id]);
      const contact = existing[0] as any;
      if (!contact) return res.status(404).json({ error: 'Contato não encontrado' });

      if (role !== 'admin' && role !== 'auditoria') {
        const providerId = await resolveProviderId(req);
        if (String(contact.provider_id) !== String(providerId)) {
          return res.status(403).json({ error: 'Você não tem permissão para editar este contato' });
        }
      }

      const { name, position, email, phone, cpf, council_registry } = req.body;
      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'Nome é obrigatório' });
      }
      const { rows } = await query(
        `UPDATE provider_contacts
            SET name = $1, position = $2, email = $3, phone = $4, cpf = $5, council_registry = $6
          WHERE id = $7 RETURNING *`,
        [String(name).trim(), position || null, email || null, phone || null, cpf || null, council_registry || null, req.params.id],
      );
      await auditLog({
        query, userId: req.user.id, action: 'provider_contact_updated',
        meta: { provider_id: Number(contact.provider_id), contact_id: Number(req.params.id), name: rows[0].name, position: rows[0].position },
        ip: hashClientIp(req),
      });
      res.json(rows[0]);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/provider-contacts/:id', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      const { rows } = await query('SELECT provider_id FROM provider_contacts WHERE id = $1', [req.params.id]);
      const contact = rows[0] as any;
      if (!contact) return res.status(404).json({ error: 'Contato não encontrado' });

      if (role !== 'admin' && role !== 'auditoria') {
        const providerId = await resolveProviderId(req);
        if (String(contact.provider_id) !== String(providerId)) {
          return res.status(403).json({ error: 'Você não tem permissão para remover este contato' });
        }
      }
      await query('DELETE FROM provider_contacts WHERE id = $1', [req.params.id]);
      await auditLog({
        query, userId: req.user.id, action: 'provider_contact_deleted',
        meta: { provider_id: Number(contact.provider_id), contact_id: Number(req.params.id) },
        ip: hashClientIp(req),
      });
      res.json({ success: true });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Dashboard Data
  app.get('/api/dashboard', authenticate, async (req: any, res) => {
    try {
      let { provider_id, role, id: user_id } = req.user;

      if (!provider_id && role !== 'admin' && role !== 'auditoria') {
        const { rows } = await query('SELECT provider_id FROM users WHERE id = $1', [user_id]);
        const dbUser = rows[0] as any;
        if (dbUser && dbUser.provider_id) {
          provider_id = dbUser.provider_id;
        }
      }

      if (role === 'admin' || role === 'auditoria') {
        // Admin/Auditor dashboard data
        const { rows: providersCountRows } = await query('SELECT COUNT(*) as count FROM providers');
        const { rows: openTicketsCountRows } = await query('SELECT COUNT(*) as count FROM tickets WHERE status = $1', ['aberto']);
        const { rows: pendingDocsCountRows } = await query('SELECT COUNT(*) as count FROM documents WHERE status = $1', ['pendente']);
        const { rows: pendingCredentialingCountRows } = await query('SELECT COUNT(*) as count FROM credentialing_requests WHERE status = $1', ['pendente']);

        const { rows: recentPendingDocs } = await query('SELECT d.*, p.name as provider_name FROM documents d JOIN providers p ON d.provider_id = p.id WHERE d.status = $1 ORDER BY d.id DESC LIMIT 5', ['pendente']);
        const { rows: recentOpenTickets } = await query('SELECT t.*, p.name as provider_name FROM tickets t JOIN providers p ON t.provider_id = p.id WHERE t.status = $1 ORDER BY t.created_at DESC LIMIT 5', ['aberto']);

        // Distribuição de selos: POR ENDEREÇO (conta oficial, spec 2026-09-15 —
        // qualificação é por unidade desde a 0035), avaliação finalizada mais recente.
        const { rows: sealDistribution } = await query(
          `SELECT seal, COUNT(*)::int AS count
             FROM (
               SELECT DISTINCT ON (provider_id, COALESCE(location_id, 0)) seal
                 FROM eval_instances
                WHERE seal IS NOT NULL AND status IN ('finalizado','aprovado')
                ORDER BY provider_id, COALESCE(location_id, 0), completed_at DESC NULLS LAST, started_at DESC
             ) latest
            GROUP BY seal`
        );

        // Avaliações submetidas pelo prestador aguardando análise do auditor.
        const { rows: pendingEvalRows } = await query(
          `SELECT COUNT(*)::int AS count FROM eval_instances WHERE status = 'pendente'`
        );

        res.json({
          providersCount: providersCountRows[0],
          openTicketsCount: openTicketsCountRows[0],
          pendingDocsCount: pendingDocsCountRows[0],
          pendingCredentialingCount: pendingCredentialingCountRows[0],
          pendingEvaluationsCount: pendingEvalRows[0],
          sealDistribution,
          recentPendingDocs,
          recentOpenTickets
        });
      } else if (provider_id) {
        const { rows: providerRows } = await query('SELECT * FROM providers WHERE id = $1', [provider_id]);
        const { rows: docs } = await query('SELECT * FROM documents WHERE provider_id = $1', [provider_id]);
        const { rows: tickets } = await query('SELECT * FROM tickets WHERE provider_id = $1', [provider_id]);
        const { rows: trainings } = await query('SELECT pt.*, t.title FROM provider_trainings pt JOIN trainings t ON pt.training_id = t.id WHERE pt.provider_id = $1', [provider_id]);
        const { rows: audits } = await query('SELECT * FROM audits WHERE provider_id = $1', [provider_id]);
        const { rows: financials } = await query('SELECT * FROM financials WHERE provider_id = $1 ORDER BY competence DESC LIMIT 3', [provider_id]);
        const { rows: announcements } = await query('SELECT * FROM announcements ORDER BY date DESC LIMIT 5');
        // Avaliação finalizada mais recente do prestador (qualificação individual + selo).
        const { rows: latestEval } = await query(
          `SELECT percentual, seal, completed_at
             FROM eval_instances
            WHERE provider_id = $1 AND status IN ('finalizado','aprovado')
            ORDER BY completed_at DESC NULLS LAST, started_at DESC
            LIMIT 1`,
          [provider_id]
        );

        res.json({
          provider: providerRows[0],
          documents: docs,
          tickets: tickets,
          trainings: trainings,
          audits: audits,
          financials: financials,
          announcements: announcements,
          latestEvaluation: latestEval[0] || null
        });
      } else {
        res.json({
          provider: null,
          documents: [],
          tickets: [],
          trainings: [],
          audits: [],
          financials: [],
          announcements: []
        });
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Settings
  app.get('/api/settings', authenticate, async (req: any, res) => {
    try {
      const { rows: settings } = await query('SELECT * FROM settings');
      const result = settings.reduce((acc: any, curr: any) => {
        acc[curr.key] = curr.value;
        return acc;
      }, {});
      res.json(result);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/settings', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      const { current_competence, payment_date } = req.body;
      try {
        if (current_competence) await query('UPDATE settings SET value = $1 WHERE key = $2', [current_competence, 'current_competence']);
        if (payment_date) await query('UPDATE settings SET value = $1 WHERE key = $2', [payment_date, 'payment_date']);
        res.json({ success: true });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Providers
  app.get('/api/providers', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role === 'admin' || role === 'auditoria') {
        const { rows: providers } = await query(`
          SELECT p.id, p.name, p.cnpj, p.cpf, p.sgu_code AS code, p.provider_group, p.provider_type,
                 p.area_atuacao, p.qualification_level, p.status, p.sgu_synced_at,
                 loc.cidade, loc.uf,
                 COALESCE(
                   (SELECT jsonb_agg(
                             jsonb_build_object(
                               'unidade', NULLIF(pl.logradouro, ''), 'cidade', pl.cidade, 'uf', pl.uf,
                               -- Selo do certificado vigente (valid_until >= hoje) desta unidade; o mais recente vence.
                               'seal', (SELECT ei.seal FROM eval_certificates ec
                                          JOIN eval_instances ei ON ei.id = ec.instance_id
                                         WHERE ei.location_id = pl.id AND ec.valid_until >= CURRENT_DATE
                                         ORDER BY ec.valid_until DESC, ec.issued_at DESC LIMIT 1))
                             ORDER BY pl.is_primary DESC NULLS LAST, pl.id)
                      FROM provider_locations pl WHERE pl.provider_id = p.id),
                   '[]'::jsonb
                 ) AS locais
          FROM providers p
          LEFT JOIN LATERAL (
            SELECT cidade, uf FROM provider_locations pl
            WHERE pl.provider_id = p.id
            ORDER BY pl.is_primary DESC NULLS LAST, pl.id ASC
            LIMIT 1
          ) loc ON true
          ORDER BY p.name ASC`);
        res.json(providers);
      } else {
        res.status(403).json({ error: 'Unauthorized' });
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/providers', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      const { name, cnpj, code, provider_group, provider_type, area_atuacao, qualification_level, status } = req.body;
      if (!name || !cnpj) {
        return res.status(400).json({ error: 'Name and CNPJ are required' });
      }
      try {
        const { rows } = await query(
          'INSERT INTO providers (name, cnpj, sgu_code, provider_group, provider_type, area_atuacao, qualification_level, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
          [name, cnpj, code || null, provider_group || null, provider_type || null, area_atuacao || null, qualification_level || null, status || 'Ativo']
        );
        res.json({ id: rows[0].id, name, cnpj, code, provider_group, provider_type, area_atuacao, qualification_level, status });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/providers/:id', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      const providerId = req.params.id;
      const { rows: providerRows } = await query('SELECT * FROM providers WHERE id = $1', [providerId]);
      const provider = providerRows[0] as any;
      if (!provider) {
        return res.status(404).json({ error: 'Prestador não encontrado' });
      }

      const { rows: locations } = await query(
        'SELECT * FROM provider_locations WHERE provider_id = $1 ORDER BY is_primary DESC, id ASC',
        [providerId]
      );
      const { rows: certifications } = await query(
        'SELECT * FROM provider_certifications WHERE provider_id = $1 ORDER BY issued_date DESC NULLS LAST, id DESC',
        [providerId]
      );
      const { rows: docStatusRows } = await query(
        'SELECT lower(status) AS status, COUNT(*)::int AS count FROM documents WHERE provider_id = $1 GROUP BY lower(status)',
        [providerId]
      );
      const documentsTotal = docStatusRows.reduce((sum: number, r: any) => sum + r.count, 0);
      const documentsPending = docStatusRows.find((r: any) => r.status === 'pendente')?.count ?? 0;
      const documentsExpired = docStatusRows.find((r: any) => r.status === 'vencido')?.count ?? 0;

      res.json({
        ...provider,
        locations,
        certifications,
        summary: {
          documents_pending: documentsPending,
          documents_expired: documentsExpired,
          documents_total: documentsTotal,
          certifications_total: certifications.length,
        },
      });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Atualiza campos editáveis do prestador (por ora, responsável técnico). Só admin.
  app.patch('/api/providers/:id', authenticate, requireAdmin, async (req: any, res) => {
    try {
      if (!('responsavel_tecnico' in (req.body ?? {}))) {
        return res.status(400).json({ error: 'Nada para atualizar.' });
      }
      const raw = req.body.responsavel_tecnico;
      const rt = raw === null ? null : (String(raw).trim() || null);
      const { rows } = await query(
        'UPDATE providers SET responsavel_tecnico = $1 WHERE id = $2 RETURNING id, responsavel_tecnico',
        [rt, req.params.id],
      );
      if (!rows[0]) return res.status(404).json({ error: 'Prestador não encontrado' });
      await auditLog({
        query, userId: req.user.id, action: 'provider_updated',
        meta: { provider_id: Number(req.params.id), field: 'responsavel_tecnico' },
        ip: hashClientIp(req),
      });
      res.json(rows[0]);
    } catch (err: any) {
      console.error('PATCH /providers/:id:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // === Gestão de Acessos do prestador (Tela 4 da spec) — 1 acesso por UNIDADE ===
  // Desde a migration 0035 o acesso é do par (prestador, endereço): cada unidade
  // comercial tem seu próprio acesso, e o portal do prestador só mostra a dela.
  // Desde a 0057 o login é o CPF/CNPJ com senha única do prestador; o que é de cada
  // unidade é o e-mail (2FA e avisos), cadastrado por ela no primeiro acesso.
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  // Unidades comerciais do prestador, cada uma com o seu acesso (ou null).
  async function providerUnits(providerId: string) {
    const { rows } = await query(
      `SELECT pl.id AS location_id, pl.label, pl.logradouro, pl.cidade, pl.uf, pl.sgu_location_code,
              LOWER(TRIM(pl.email)) AS cadastro_email,
              u.id, u.name, u.email, u.role, u.is_active, u.last_login_at, u.last_login_ip, u.invite_status
         FROM provider_locations pl
         LEFT JOIN user_locations ul ON ul.location_id = pl.id
         LEFT JOIN users u ON u.id = ul.user_id AND u.role = ANY($2)
        WHERE pl.provider_id = $1
          AND COALESCE(pl.label,'') NOT ILIKE 'residencial%'
          AND COALESCE(pl.sgu_location_code,'') !~ '-RES$'
        ORDER BY pl.is_primary DESC NULLS LAST, pl.id`,
      [providerId, PROVIDER_ACCESS_ROLES]);
    return rows.map((r: any) => ({
      location_id: Number(r.location_id),
      label: r.label, logradouro: r.logradouro, cidade: r.cidade, uf: r.uf, sgu_location_code: r.sgu_location_code,
      suggested_email: !r.id && EMAIL_RE.test(r.cadastro_email ?? '') ? r.cadastro_email : null,
      user: r.id ? {
        id: Number(r.id), name: r.name, email: r.email, role: r.role, is_active: r.is_active,
        last_login_at: r.last_login_at, last_login_ip: r.last_login_ip, invite_status: r.invite_status,
      } : null,
    }));
  }

  // Resolve a unidade alvo de uma ação: explícita no corpo, ou a única do prestador.
  async function resolveUnit(providerId: string, rawLocationId: any) {
    const units = await providerUnits(providerId);
    if (rawLocationId == null || rawLocationId === '') {
      return units.length === 1 ? units[0] : null;
    }
    return units.find((u) => u.location_id === Number(rawLocationId)) ?? null;
  }

  app.get('/api/providers/:id/access', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      const { rows: provRows } = await query('SELECT id, name FROM providers WHERE id = $1', [req.params.id]);
      if (!provRows[0]) return res.status(404).json({ error: 'Prestador não encontrado' });
      const units = await providerUnits(req.params.id);
      // Acessos sem unidade (vínculo perdido num reimport de cadastro) não podem
      // sumir da tela — aparecem à parte para o admin re-vincular.
      const { rows: orphans } = await query(
        `SELECT id, name, email, role, is_active, last_login_at, last_login_ip, invite_status
           FROM users u
          WHERE provider_id = $1 AND role = ANY($2)
            AND NOT EXISTS (SELECT 1 FROM user_locations ul WHERE ul.user_id = u.id)
          ORDER BY id`,
        [req.params.id, PROVIDER_ACCESS_ROLES]);
      const { rows: pw } = await query(
        `SELECT COALESCE(bool_or(password IS NOT NULL), false) AS has_password,
                COALESCE(bool_or(must_change_password), false) AS must_change_password
           FROM users WHERE provider_id = $1 AND role = ANY($2) AND is_active = true`,
        [req.params.id, PROVIDER_ACCESS_ROLES]);
      res.json({ provider_name: provRows[0].name, units, orphans, ...pw[0] });
    } catch (err: any) {
      console.error('GET /providers/:id/access:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Garante 1 acesso por unidade comercial (sem senha própria nem e-mail: a senha é a
  // do prestador e o e-mail é cadastrado pela unidade no primeiro acesso).
  async function ensureUnitAccesses(providerId: string) {
    const { rows: provRows } = await query('SELECT id, name, person_type, provider_group FROM providers WHERE id = $1', [providerId]);
    if (!provRows[0]) return null;
    const role = deriveProviderRole(provRows[0].person_type, provRows[0].provider_group);
    for (const unit of await providerUnits(providerId)) {
      if (unit.user) continue;
      const { rows: created } = await query(
        `INSERT INTO users (name, email, password, role, provider_id, is_active, invite_status)
         VALUES ($1, NULL, (SELECT password FROM users WHERE provider_id = $3 AND role = ANY($4) AND password IS NOT NULL LIMIT 1),
                 $2, $3, true, 'pending') RETURNING id`,
        [provRows[0].name, role, providerId, PROVIDER_ACCESS_ROLES]);
      await query(
        `INSERT INTO user_locations (user_id, location_id, provider_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [created[0].id, unit.location_id, Number(providerId)]);
    }
    return provRows[0];
  }

  // Define a senha provisória do prestador (vale para todas as unidades). Só admin.
  // O prestador é obrigado a trocá-la no primeiro acesso; sessões abertas caem.
  app.post('/api/providers/:id/access/password', authenticate, requireAdmin, async (req: any, res) => {
    try {
      const providerId = req.params.id;
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (password.length < 8) return res.status(400).json({ error: 'A senha deve ter ao menos 8 caracteres.' });
      if (!await ensureUnitAccesses(providerId)) return res.status(404).json({ error: 'Prestador não encontrado' });
      await setProviderPassword(Number(providerId), await bcrypt.hash(password, 10), true);
      await auditLog({
        query, userId: req.user.id, action: 'provider_password_set',
        meta: { provider_id: Number(providerId), provisional: true },
        ip: hashClientIp(req),
      });
      res.json({ ok: true, units: await providerUnits(providerId) });
    } catch (err: any) {
      console.error('POST /providers/:id/access/password:', err);
      res.status(500).json({ error: 'Falha ao definir a senha.' });
    }
  });

  // Corrige ou limpa o e-mail de UMA unidade. Só admin. Limpar (e-mail vazio) faz a
  // unidade cadastrar um novo no próximo acesso — é a saída quando o antigo se perdeu.
  app.post('/api/providers/:id/access', authenticate, requireAdmin, async (req: any, res) => {
    try {
      const providerId = req.params.id;
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'E-mail inválido.' });
      if (!await ensureUnitAccesses(providerId)) return res.status(404).json({ error: 'Prestador não encontrado' });
      const unit = await resolveUnit(providerId, req.body?.location_id);
      if (!unit?.user) return res.status(400).json({ error: 'Informe a unidade (location_id) do acesso.' });
      // O dispositivo confiável vale por e-mail: trocou o e-mail, a unidade volta a pedir código.
      await query(
        `UPDATE users SET email = $1, invite_status = $2, session_version = session_version + 1 WHERE id = $3`,
        [email || null, email ? 'accepted' : 'pending', unit.user.id]);
      await query('DELETE FROM trusted_devices WHERE user_id = $1', [unit.user.id]);
      await auditLog({
        query, userId: req.user.id, action: 'provider_access_updated',
        meta: { provider_id: Number(providerId), location_id: unit.location_id, user_id: unit.user.id, email_cleared: !email },
        ip: hashClientIp(req),
      });
      res.json({ units: await providerUnits(providerId) });
    } catch (err: any) {
      console.error('POST /providers/:id/access:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Trilha de Histórico e Auditoria do prestador (Tela 5 da spec).
  app.get('/api/providers/:id/audit', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      const { rows: userRows } = await query('SELECT id FROM users WHERE provider_id = $1', [req.params.id]);
      const userIds = userRows.map((r: any) => r.id);
      // Só as interações dos usuários DO prestador (C-09): logins, envios, pesquisa,
      // credenciais. Ações do staff sobre o prestador (parecer, contatos, planos)
      // ficam fora desta aba — poluíam a trilha como "histórico de todos os usuários".
      // Enriquece com al.meta e junta o rótulo da unidade quando meta.location_id existe.
      const { rows: events } = await query(
        `SELECT al.id, al.action, al.success, al.ip_hash, al.created_at, al.meta,
                u.name AS actor_name, u.email AS actor_email,
                COALESCE(NULLIF(pl.logradouro, ''), pl.label, pl.cidade) AS location_label
           FROM access_logs al
           LEFT JOIN users u ON u.id = al.user_id
           LEFT JOIN provider_locations pl
                  ON pl.id = NULLIF(al.meta->>'location_id','')::int
          WHERE al.user_id = ANY($1::int[])
          ORDER BY al.created_at DESC
          LIMIT 100`,
        [userIds.length ? userIds : [-1]],
      );
      res.json({ events });
    } catch (err: any) {
      console.error('GET /providers/:id/audit:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Documents
  app.get('/api/documents', authenticate, async (req: any, res) => {
    try {
      const { provider_id, role } = req.user;
      if (role === 'admin' || role === 'auditoria') {
        const { rows: docs } = await query('SELECT d.*, p.name as provider_name, u.name as uploaded_by_name FROM documents d JOIN providers p ON d.provider_id = p.id LEFT JOIN users u ON d.uploaded_by = u.id ORDER BY d.id DESC');
        res.json(docs);
      } else if (provider_id) {
        const { rows: docs } = await query('SELECT d.*, u.name as uploaded_by_name FROM documents d LEFT JOIN users u ON d.uploaded_by = u.id WHERE d.provider_id = $1 ORDER BY d.id DESC', [provider_id]);
        res.json(docs);
      } else {
        res.json([]);
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/documents', authenticate, upload.single('file'), async (req: any, res) => {
    try {
      const { provider_id, role, id: user_id } = req.user;
      const { type, issue_date, expiry_date } = req.body;

      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Determine the provider ID to use (admins might upload for a provider, but for now let's assume provider uploads their own)
      const targetProviderId = role === 'prestador' ? provider_id : req.body.provider_id;

      if (!targetProviderId) {
        return res.status(400).json({ error: 'Provider ID is required' });
      }

      const file_url = '/uploads/' + req.file.filename;
      const status = 'pendente'; // New documents are pending approval
      const upload_date = new Date().toISOString();

      // Mark previous documents of the same type as 'historico'
      await query("UPDATE documents SET status = 'historico' WHERE provider_id = $1 AND type = $2 AND status != 'historico'", [targetProviderId, type]);

      const { rows } = await query(
        'INSERT INTO documents (provider_id, type, issue_date, expiry_date, status, file_url, upload_date, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
        [targetProviderId, type, issue_date || null, expiry_date || null, status, file_url, upload_date, user_id]
      );

      const { rows: newDocRows } = await query('SELECT * FROM documents WHERE id = $1', [rows[0].id]);
      await auditLog({
        query, userId: user_id, action: 'document_uploaded',
        meta: { provider_id: Number(targetProviderId), document_id: rows[0].id, type, filename: req.file?.originalname ?? null },
        ip: hashClientIp(req),
      });
      res.json(newDocRows[0]);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/documents/:id', authenticate, upload.single('file'), async (req: any, res) => {
    try {
      const { role, provider_id } = req.user;
      const { id } = req.params;
      const { type, issue_date, expiry_date } = req.body;

      const { rows: docRows } = await query('SELECT * FROM documents WHERE id = $1', [id]);
      const doc = docRows[0] as any;
      if (!doc) return res.status(404).json({ error: 'Document not found' });

      if (role === 'prestador' && doc.provider_id !== provider_id) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      if (doc.status !== 'pendente') {
        return res.status(400).json({ error: 'Only pending documents can be edited' });
      }

      let file_url = doc.file_url;
      if (req.file) {
        file_url = '/uploads/' + req.file.filename;
      }

      await query('UPDATE documents SET type = $1, issue_date = $2, expiry_date = $3, file_url = $4 WHERE id = $5', [type, issue_date || null, expiry_date || null, file_url, id]);

      const { rows: updatedDocRows } = await query('SELECT * FROM documents WHERE id = $1', [id]);
      await auditLog({
        query, userId: req.user.id, action: 'document_updated',
        meta: { provider_id: Number(doc.provider_id), document_id: Number(id), type, filename: req.file?.originalname ?? null },
        ip: hashClientIp(req),
      });
      res.json(updatedDocRows[0]);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/documents/:id', authenticate, async (req: any, res) => {
    try {
      const { role, provider_id } = req.user;
      const { id } = req.params;

      const { rows: docRows } = await query('SELECT * FROM documents WHERE id = $1', [id]);
      const doc = docRows[0] as any;
      if (!doc) return res.status(404).json({ error: 'Document not found' });

      if (role === 'prestador' && doc.provider_id !== provider_id) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      if (doc.status !== 'pendente') {
        return res.status(400).json({ error: 'Only pending documents can be deleted' });
      }

      await query('DELETE FROM documents WHERE id = $1', [id]);
      await auditLog({
        query, userId: req.user.id, action: 'document_deleted',
        meta: { provider_id: Number(doc.provider_id), document_id: Number(id), type: doc.type },
        ip: hashClientIp(req),
      });
      res.json({ success: true });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/documents/:id/status', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      const { id } = req.params;
      const { status, issue_date, expiry_date, rejection_reason } = req.body; // 'valido', 'reprovado'

      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized to change document status' });
      }

      if (!['valido', 'reprovado', 'pendente', 'vencido'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      if (issue_date !== undefined || expiry_date !== undefined || rejection_reason !== undefined) {
        await query('UPDATE documents SET status = $1, issue_date = $2, expiry_date = $3, rejection_reason = $4 WHERE id = $5', [status, issue_date || null, expiry_date || null, rejection_reason || null, id]);
      } else {
        await query('UPDATE documents SET status = $1 WHERE id = $2', [status, id]);
      }

      const { rows: updatedDocRows } = await query('SELECT * FROM documents WHERE id = $1', [id]);
      await auditLog({
        query, userId: req.user.id, action: 'document_status_changed',
        meta: {
          provider_id: Number(updatedDocRows[0]?.provider_id),
          document_id: Number(id), status,
          type: updatedDocRows[0]?.type,
          rejection_reason: rejection_reason || null,
        },
        ip: hashClientIp(req),
      });
      res.json(updatedDocRows[0]);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Tickets
  app.get('/api/tickets', authenticate, async (req: any, res) => {
    try {
      let { provider_id, role, id: user_id } = req.user;

      if (!provider_id && role !== 'admin' && role !== 'auditoria') {
        const { rows } = await query('SELECT provider_id FROM users WHERE id = $1', [user_id]);
        const dbUser = rows[0] as any;
        if (dbUser && dbUser.provider_id) {
          provider_id = dbUser.provider_id;
        }
      }

      if (role === 'admin' || role === 'auditoria') {
        const { rows: tickets } = await query('SELECT t.*, p.name as provider_name FROM tickets t JOIN providers p ON t.provider_id = p.id ORDER BY created_at DESC');
        res.json(tickets);
      } else if (provider_id) {
        const { rows: tickets } = await query('SELECT * FROM tickets WHERE provider_id = $1 ORDER BY created_at DESC', [provider_id]);
        res.json(tickets);
      } else {
        res.json([]);
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tickets', authenticate, async (req: any, res) => {
    try {
      let { provider_id, id: user_id, name: user_name, role } = req.user;

      if (!provider_id && role !== 'admin' && role !== 'auditoria') {
        const { rows } = await query('SELECT provider_id FROM users WHERE id = $1', [user_id]);
        const dbUser = rows[0] as any;
        if (dbUser && dbUser.provider_id) {
          provider_id = dbUser.provider_id;
        }
      }

      if (!user_name) {
        const { rows } = await query('SELECT name FROM users WHERE id = $1', [user_id]);
        const user = rows[0] as any;
        user_name = user?.name || 'Usuário';
      }
      const { title, description, category, priority } = req.body;
      const created_at = new Date().toISOString();

      if (!provider_id) {
        return res.status(400).json({ error: 'Prestador não encontrado para este usuário.' });
      }

      const { rows } = await query(
        'INSERT INTO tickets (provider_id, title, description, category, priority, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [provider_id, title, description, category, priority, 'aberto', created_at]
      );

      const { rows: ticketRows } = await query('SELECT * FROM tickets WHERE id = $1', [rows[0].id]);
      res.json(ticketRows[0]);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tickets/:id/messages', authenticate, async (req: any, res) => {
    try {
      let { role, provider_id, id: user_id } = req.user;
      const { id } = req.params;

      if (!provider_id && role !== 'admin' && role !== 'auditoria') {
        const { rows } = await query('SELECT provider_id FROM users WHERE id = $1', [user_id]);
        const dbUser = rows[0] as any;
        if (dbUser && dbUser.provider_id) {
          provider_id = dbUser.provider_id;
        }
      }

      const { rows: ticketRows } = await query('SELECT * FROM tickets WHERE id = $1', [id]);
      const ticket = ticketRows[0] as any;
      if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

      if (role !== 'admin' && role !== 'auditoria' && ticket.provider_id !== provider_id) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const { rows: messages } = await query('SELECT * FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC', [id]);
      res.json(messages);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/tickets/:id/messages', authenticate, async (req: any, res) => {
    try {
      let { role, provider_id, id: user_id, name: user_name } = req.user;

      if (!provider_id && role !== 'admin' && role !== 'auditoria') {
        const { rows } = await query('SELECT provider_id FROM users WHERE id = $1', [user_id]);
        const dbUser = rows[0] as any;
        if (dbUser && dbUser.provider_id) {
          provider_id = dbUser.provider_id;
        }
      }

      if (!user_name) {
        const { rows } = await query('SELECT name FROM users WHERE id = $1', [user_id]);
        const user = rows[0] as any;
        user_name = user?.name || 'Usuário';
      }
      const { id } = req.params;
      const { message } = req.body;

      const { rows: ticketRows } = await query('SELECT * FROM tickets WHERE id = $1', [id]);
      const ticket = ticketRows[0] as any;
      if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

      if (role !== 'admin' && role !== 'auditoria' && ticket.provider_id !== provider_id) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const created_at = new Date().toISOString();
      const { rows: msgRows } = await query(
        'INSERT INTO ticket_messages (ticket_id, user_id, user_name, role, message, is_status_change, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [id, user_id, user_name, role, message, false, created_at]
      );

      // Auto-reopen if provider sends a message and ticket is not 'aberto'
      if (role !== 'admin' && role !== 'auditoria' && ticket.status !== 'aberto') {
        await query('UPDATE tickets SET status = $1 WHERE id = $2', ['aberto', id]);
        await query(
          'INSERT INTO ticket_messages (ticket_id, user_id, user_name, role, message, is_status_change, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [id, user_id, user_name, role, 'Status alterado para: Aberto', true, new Date(Date.now() + 1000).toISOString()]
        );
      }

      const { rows: newMsgRows } = await query('SELECT * FROM ticket_messages WHERE id = $1', [msgRows[0].id]);
      res.json(newMsgRows[0]);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/tickets/:id', authenticate, async (req: any, res) => {
    try {
      let { role, provider_id, id: user_id, name: user_name } = req.user;

      if (!provider_id && role !== 'admin' && role !== 'auditoria') {
        const { rows } = await query('SELECT provider_id FROM users WHERE id = $1', [user_id]);
        const dbUser = rows[0] as any;
        if (dbUser && dbUser.provider_id) {
          provider_id = dbUser.provider_id;
        }
      }

      if (!user_name) {
        const { rows } = await query('SELECT name FROM users WHERE id = $1', [user_id]);
        const user = rows[0] as any;
        user_name = user?.name || 'Usuário';
      }
      const { id } = req.params;
      const { status, response } = req.body;

      const { rows: ticketRows } = await query('SELECT * FROM tickets WHERE id = $1', [id]);
      const ticket = ticketRows[0] as any;
      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' });
      }

      const created_at = new Date().toISOString();

      if (role !== 'admin' && role !== 'auditoria') {
        // Allow provider to reopen their own ticket
        if (ticket.provider_id !== provider_id || status !== 'aberto') {
          return res.status(403).json({ error: 'Unauthorized to update tickets' });
        }
        // Reopening keeps the existing response
        await query('UPDATE tickets SET status = $1 WHERE id = $2', [status, id]);

        if (ticket.status !== status) {
          await query(
            'INSERT INTO ticket_messages (ticket_id, user_id, user_name, role, message, is_status_change, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [id, user_id, user_name, role, `Status alterado para: Aberto`, true, created_at]
          );
        }
      } else {
        await query('UPDATE tickets SET status = $1 WHERE id = $2', [status, id]);

        if (ticket.status !== status) {
          await query(
            'INSERT INTO ticket_messages (ticket_id, user_id, user_name, role, message, is_status_change, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [id, user_id, user_name, role, `Status alterado para: ${status}`, true, created_at]
          );
        }
      }

      const { rows: updatedTicketRows } = await query('SELECT * FROM tickets WHERE id = $1', [id]);
      res.json(updatedTicketRows[0]);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Trainings
  app.get('/api/trainings', authenticate, async (req: any, res) => {
    try {
      const { provider_id, role } = req.user;
      if (role === 'admin' || role === 'auditoria') {
        const { rows: trainings } = await query('SELECT * FROM trainings ORDER BY created_at DESC');
        res.json(trainings);
      } else if (provider_id) {
        const { rows: provRows } = await query('SELECT provider_group FROM providers WHERE id = $1', [provider_id]);
        const provider = provRows[0] as any;
        const providerGroup = provider?.provider_group || null;

        const { rows: trainings } = await query(`
          SELECT t.*, pt.status, pt.completed_at
          FROM trainings t
          LEFT JOIN provider_trainings pt ON t.id = pt.training_id AND pt.provider_id = $1
          WHERE t.target_type = 'geral'
             OR t.target_type IS NULL
             OR (t.target_type = 'grupo' AND t.target_group = $2)
             OR (t.target_type = 'especifico' AND t.target_provider_id = $3)
          ORDER BY t.created_at DESC
        `, [provider_id, providerGroup, provider_id]);
        res.json(trainings);
      } else {
        res.json([]);
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/trainings', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      const { title, description, video_url, pdf_url, target_type, target_group, target_provider_id } = req.body;
      if (!title) {
        return res.status(400).json({ error: 'Title is required' });
      }
      try {
        const { rows } = await query(
          'INSERT INTO trainings (title, description, video_url, pdf_url, created_at, target_type, target_group, target_provider_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
          [title, description || null, video_url || null, pdf_url || null, new Date().toISOString(), target_type || 'geral', target_group || null, target_provider_id || null]
        );
        if (target_provider_id) {
          await auditLog({
            query, userId: req.user.id, action: 'training_targeted',
            meta: { provider_id: Number(target_provider_id), training_id: rows[0].id, title },
            ip: hashClientIp(req),
          });
        }
        res.json({ id: rows[0].id, title, description, video_url, pdf_url, target_type: target_type || 'geral', target_group, target_provider_id });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/trainings/:id', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      try {
        await query('DELETE FROM trainings WHERE id = $1', [req.params.id]);
        res.json({ success: true });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Financials
  app.get('/api/financials', authenticate, async (req: any, res) => {
    try {
      const { provider_id, role } = req.user;
      if (role === 'admin' || role === 'auditoria') {
        const { rows: financials } = await query('SELECT f.*, p.name as provider_name FROM financials f JOIN providers p ON f.provider_id = p.id ORDER BY competence DESC');
        res.json(financials);
      } else if (provider_id) {
        const { rows: financials } = await query('SELECT * FROM financials WHERE provider_id = $1 ORDER BY competence DESC', [provider_id]);
        res.json(financials);
      } else {
        res.json([]);
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Announcements
  app.get('/api/announcements', authenticate, async (req: any, res) => {
    try {
      const { role, provider_id } = req.user;
      if (role === 'admin' || role === 'auditoria') {
        const { rows: announcements } = await query('SELECT * FROM announcements ORDER BY date DESC');
        res.json(announcements);
      } else if (provider_id) {
        const { rows: provRows } = await query('SELECT provider_group FROM providers WHERE id = $1', [provider_id]);
        const provider = provRows[0] as any;
        const providerGroup = provider?.provider_group || null;

        const { rows: announcements } = await query(`
          SELECT * FROM announcements
          WHERE target_type = 'geral'
             OR target_type IS NULL
             OR (target_type = 'grupo' AND target_group = $1)
             OR (target_type = 'especifico' AND target_provider_id = $2)
          ORDER BY date DESC
        `, [providerGroup, provider_id]);
        res.json(announcements);
      } else {
        res.json([]);
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/announcements', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      const { title, description, category, image_url, date, target_type, target_group, target_provider_id } = req.body;
      if (!title || !description || !category || !date) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      try {
        const { rows } = await query(
          'INSERT INTO announcements (title, description, category, image_url, date, target_type, target_group, target_provider_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
          [title, description, category, image_url || null, date, target_type || 'geral', target_group || null, target_provider_id || null]
        );
        if (target_provider_id) {
          await auditLog({
            query, userId: req.user.id, action: 'announcement_targeted',
            meta: { provider_id: Number(target_provider_id), announcement_id: rows[0].id, title },
            ip: hashClientIp(req),
          });
        }
        res.json({ id: rows[0].id, title, description, category, image_url, date, target_type: target_type || 'geral', target_group, target_provider_id });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Audits
  app.get('/api/audits', authenticate, async (req: any, res) => {
    try {
      const { provider_id, role } = req.user;
      if (role === 'admin' || role === 'auditoria') {
        const { rows: audits } = await query('SELECT a.*, p.name as provider_name FROM audits a JOIN providers p ON a.provider_id = p.id ORDER BY scheduled_date DESC');
        res.json(audits);
      } else if (provider_id) {
        const { rows: audits } = await query('SELECT * FROM audits WHERE provider_id = $1 ORDER BY scheduled_date DESC', [provider_id]);
        res.json(audits);
      } else {
        res.json([]);
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Contracts
  app.get('/api/contracts', authenticate, async (req: any, res) => {
    try {
      let { provider_id, role, id: user_id } = req.user;

      if (!provider_id && role !== 'admin' && role !== 'auditoria') {
        const { rows } = await query('SELECT provider_id FROM users WHERE id = $1', [user_id]);
        const dbUser = rows[0] as any;
        if (dbUser && dbUser.provider_id) {
          provider_id = dbUser.provider_id;
        }
      }

      if (role === 'admin' || role === 'auditoria') {
        const { rows: contracts } = await query('SELECT c.*, p.name as provider_name FROM contracts c JOIN providers p ON c.provider_id = p.id ORDER BY created_at DESC');
        res.json(contracts);
      } else if (provider_id) {
        const { rows: contracts } = await query('SELECT * FROM contracts WHERE provider_id = $1 ORDER BY created_at DESC', [provider_id]);
        res.json(contracts);
      } else {
        res.json([]);
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/contracts', authenticate, upload.single('file'), async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const { provider_id, title, expires_at } = req.body;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const file_url = `/uploads/${file.filename}`;
      const { rows } = await query(
        'INSERT INTO contracts (provider_id, title, file_url, status, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [provider_id, title, file_url, 'pendente', expires_at || null, new Date().toISOString()]
      );

      const { rows: contractRows } = await query('SELECT * FROM contracts WHERE id = $1', [rows[0].id]);
      await auditLog({
        query, userId: req.user.id, action: 'contract_created',
        meta: { provider_id: Number(provider_id), contract_id: rows[0].id, title },
        ip: hashClientIp(req),
      });
      res.json(contractRows[0]);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/contracts/:id/sign', authenticate, async (req: any, res) => {
    try {
      let { provider_id, role, id: user_id } = req.user;
      const { id } = req.params;

      if (!provider_id && role !== 'admin' && role !== 'auditoria') {
        const { rows } = await query('SELECT provider_id FROM users WHERE id = $1', [user_id]);
        const dbUser = rows[0] as any;
        if (dbUser && dbUser.provider_id) {
          provider_id = dbUser.provider_id;
        }
      }

      const { rows: contractRows } = await query('SELECT * FROM contracts WHERE id = $1', [id]);
      const contract = contractRows[0] as any;

      if (!contract) {
        return res.status(404).json({ error: 'Contract not found' });
      }

      if (role !== 'admin' && role !== 'auditoria' && contract.provider_id !== provider_id) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      if (contract.status !== 'pendente') {
        return res.status(400).json({ error: 'Contract already signed or expired' });
      }

      await query('UPDATE contracts SET status = $1, signed_at = $2 WHERE id = $3', ['ativo', new Date().toISOString(), id]);

      const { rows: updatedContractRows } = await query('SELECT * FROM contracts WHERE id = $1', [id]);
      await auditLog({
        query, userId: req.user.id, action: 'contract_signed',
        meta: { provider_id: Number(contract.provider_id), contract_id: Number(id) },
        ip: hashClientIp(req),
      });
      res.json(updatedContractRows[0]);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/contracts/:id/download', authenticate, async (req: any, res) => {
    try {
      const { provider_id, role } = req.user;
      const { id } = req.params;

      const { rows: contractRows } = await query('SELECT * FROM contracts WHERE id = $1', [id]);
      const contract = contractRows[0] as any;

      if (!contract) {
        return res.status(404).json({ error: 'Contract not found' });
      }

      if (role !== 'admin' && role !== 'auditoria' && contract.provider_id !== provider_id) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const filePath = path.join(process.cwd(), contract.file_url);
      res.download(filePath);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Credentialing Requests
  app.post('/api/credentialing-requests', upload.single('file'), async (req: any, res) => {
    try {
      const { name, email, phone, specialty } = req.body;
      const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;

      const { rows } = await query(
        'INSERT INTO credentialing_requests (name, email, phone, specialty, file_url, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [name, email, phone, specialty, fileUrl, new Date().toISOString()]
      );

      const { rows: requestRows } = await query('SELECT * FROM credentialing_requests WHERE id = $1', [rows[0].id]);
      res.json(requestRows[0]);
    } catch (error: any) {
      console.error('Error creating credentialing request:', error);
      res.status(500).json({ error: 'Failed to create credentialing request' });
    }
  });

  app.get('/api/credentialing-requests', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const { rows: requests } = await query('SELECT * FROM credentialing_requests ORDER BY created_at DESC');
      res.json(requests);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/credentialing-requests/:id/status', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      const { id } = req.params;
      const { status } = req.body;

      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      await query('UPDATE credentialing_requests SET status = $1 WHERE id = $2', [status, id]);

      res.json({ message: 'Status updated successfully' });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Action Plans
  app.get('/api/action-plans', authenticate, async (req: any, res) => {
    try {
      const { provider_id, role } = req.user;
      if (role === 'admin' || role === 'auditoria') {
        const { rows: plans } = await query('SELECT a.*, p.name as provider_name FROM action_plans a JOIN providers p ON a.provider_id = p.id ORDER BY created_at DESC');
        res.json(plans);
      } else if (provider_id) {
        const { rows: plans } = await query('SELECT * FROM action_plans WHERE provider_id = $1 ORDER BY created_at DESC', [provider_id]);
        res.json(plans);
      } else {
        res.json([]);
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/action-plans', authenticate, async (req: any, res) => {
    try {
      const { provider_id } = req.user;
      const { title, description, deadline } = req.body;

      const { rows } = await query(
        'INSERT INTO action_plans (provider_id, title, description, deadline, status, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [provider_id, title, description, deadline, 'pendente', new Date().toISOString()]
      );

      const { rows: planRows } = await query('SELECT * FROM action_plans WHERE id = $1', [rows[0].id]);
      await auditLog({
        query, userId: req.user.id, action: 'action_plan_created',
        meta: { provider_id: Number(provider_id), plan_id: rows[0].id, title },
        ip: hashClientIp(req),
      });
      res.json(planRows[0]);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/action-plans/:id/status', authenticate, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const { rows: updRows } = await query('UPDATE action_plans SET status = $1 WHERE id = $2 RETURNING provider_id', [status, id]);

      const { rows: planRows } = await query('SELECT * FROM action_plans WHERE id = $1', [id]);
      if (updRows[0]?.provider_id != null) {
        await auditLog({
          query, userId: req.user.id, action: 'action_plan_status_changed',
          meta: { provider_id: Number(updRows[0].provider_id), plan_id: Number(id), status },
          ip: hashClientIp(req),
        });
      }
      res.json(planRows[0]);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Price Tables
  app.get('/api/price-tables', authenticate, async (req: any, res) => {
    try {
      const { provider_id, role } = req.user;
      if (role === 'admin' || role === 'auditoria') {
        const { rows: tables } = await query('SELECT pt.*, p.name as provider_name FROM price_tables pt LEFT JOIN providers p ON pt.provider_id = p.id ORDER BY effective_date DESC');
        res.json(tables);
      } else if (provider_id) {
        // Get provider specific tables and general tables
        const { rows: tables } = await query('SELECT * FROM price_tables WHERE provider_id = $1 OR provider_id IS NULL ORDER BY effective_date DESC', [provider_id]);
        res.json(tables);
      } else {
        res.json([]);
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/price-tables/:id/download', authenticate, async (req: any, res) => {
    try {
      const { provider_id, role } = req.user;
      const { id } = req.params;

      const { rows: tableRows } = await query('SELECT * FROM price_tables WHERE id = $1', [id]);
      const table = tableRows[0] as any;

      if (!table) {
        return res.status(404).json({ error: 'Table not found' });
      }

      if (role !== 'admin' && role !== 'auditoria' && table.provider_id !== provider_id && table.provider_id !== null) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      // In a real app, this would send the actual file. For now, we'll just send a dummy response or the path.
      res.json({ message: 'Download initiated', url: table.file_url });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // ---------------------------------------------------------
  // NEW EVAL (QUALIFICATION) ENGINE APIs
  // ---------------------------------------------------------

  // Marcações de eliminatório da versão vigente (maior revisão) do mesmo arquivo —
  // base da herança no import (spec 2026-09-21). Roteiro inédito → [].
  async function vigenteEliminatory(sourceFile: string): Promise<PrevCriterion[]> {
    const { rows: versions } = await query('SELECT id, version FROM eval_scripts WHERE source_file = $1', [sourceFile]);
    if (!versions.length) return [];
    const vigente = (versions as any[]).reduce((a, b) => (scriptVersionNum(b.version) > scriptVersionNum(a.version) ? b : a));
    const { rows } = await query(
      `SELECT eq.code, eq.text, eq.is_eliminatory
         FROM eval_questions eq JOIN eval_sections es ON es.id = eq.section_id
        WHERE es.script_id = $1`, [vigente.id]);
    return rows as any;
  }

  // Trava (spec Q4): marcações não mudam com avaliação do roteiro em ciclo aberto.
  // ponytail: cobre só avaliações ligadas a um ciclo ativo (leitura literal da spec Q4).
  // Instância criada fora de ciclo (eval_instances.cycle_id NULL, em_andamento) NÃO trava.
  // Upgrade: LEFT JOIN + (c.active OR (i.cycle_id IS NULL AND i.status = 'em_andamento')).
  async function eliminatoryLocked(scriptId: number | string): Promise<boolean> {
    const { rows: [r] } = await query(
      `SELECT EXISTS (
         SELECT 1 FROM eval_instances i JOIN eval_cycles c ON c.id = i.cycle_id
          WHERE i.script_id = $1 AND c.active) AS locked`, [scriptId]);
    return !!r?.locked;
  }

  app.post('/api/eval/scripts/preview', authenticate, xlsxUpload, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'Envie um arquivo .xlsx no campo "file".' });
      }

      // multer decodifica originalname como latin1; reconstruir o UTF-8 do nome do arquivo
      const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      const parsed = parseWorkbook(req.file.buffer, fileName);

      const totalMaxScore = parsed.questions.reduce((s, q) => s + q.maxScore, 0);
      const dimensions: Record<string, number> = {};
      for (const q of parsed.questions) {
        const k = q.dimension ?? '(sem dimensão)';
        dimensions[k] = (dimensions[k] ?? 0) + 1;
      }
      const noHeader = parsed.orphans.some((o) => o.startsWith('!!'));
      const blocked = parsed.questions.length === 0 || noHeader;

      // sem revisão na planilha → revisão "00" com data da implantação (roteiro original)
      const { version, revisaoDate } = effectiveRevision(parsed);
      const errors: string[] = [];
      if (!revisaoDate) errors.push('A planilha não informa a data da revisão.');
      if (!parsed.implantacaoDate) errors.push('A planilha não informa a data de implantação.');
      {
        const { rows: dupRows } = await query(
          'SELECT version, revisao_date FROM eval_scripts WHERE source_file = $1',
          [parsed.sourceFile],
        );
        if ((dupRows as any[]).some((r) => String(r.version) === version)) {
          errors.push(`Já existe uma versão com a revisão ${version} para este roteiro.`);
        }
        if (revisaoDate && (dupRows as any[]).some((r) => String(r.revisao_date).slice(0, 10) === revisaoDate)) {
          errors.push(`Já existe uma versão com a data de revisão ${isoToBR(revisaoDate)} para este roteiro.`);
        }
      }

      const prevElim = await vigenteEliminatory(parsed.sourceFile);
      const inherit = inheritEliminatory(prevElim, parsed.questions);

      res.json({
        title: parsed.title,
        version,
        revisaoDate,
        implantacaoDate: parsed.implantacaoDate,
        sourceFile: parsed.sourceFile,
        sectionCount: parsed.sections.length,
        questionCount: parsed.questions.length,
        totalMaxScore,
        dimensions,
        warnings: {
          orphans: parsed.orphans,
          noWeight: parsed.questions.filter((q) => !q.maxScore).length,
          noEvidence: parsed.questions.filter((q) => !q.guidance).length,
          noHeader,
        },
        eliminatory: {
          hasPrevious: prevElim.length > 0,
          inherited: inherit.flags.filter(Boolean).length,
          lost: inherit.lost,
        },
        errors,
        blocked: blocked || errors.length > 0,
      });
    } catch (err: any) {
      console.error(err);
      res.status(400).json({ error: err.message || 'Não foi possível ler a planilha.' });
    }
  });

  app.post('/api/eval/scripts/import', authenticate, xlsxUpload, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'Envie um arquivo .xlsx no campo "file".' });
      }

      // multer decodifica originalname como latin1; reconstruir o UTF-8 do nome do arquivo
      const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      const parsed = parseWorkbook(req.file.buffer, fileName);
      const noHeader = parsed.orphans.some((o) => o.startsWith('!!'));
      if (parsed.questions.length === 0 || noHeader) {
        return res.status(422).json({ error: 'Planilha sem critérios reconhecíveis ou cabeçalho inválido.' });
      }
      // sem revisão na planilha → revisão "00" com data da implantação (roteiro original)
      const { version, revisaoDate } = effectiveRevision(parsed);
      if (!revisaoDate) return res.status(422).json({ error: 'A planilha não informa a data da revisão.' });
      if (!parsed.implantacaoDate) return res.status(422).json({ error: 'A planilha não informa a data de implantação.' });

      const { rows: dupRows } = await query(
        'SELECT version, revisao_date FROM eval_scripts WHERE source_file = $1',
        [parsed.sourceFile],
      );
      if ((dupRows as any[]).some((r) => String(r.version) === version)) {
        return res.status(409).json({ error: `Já existe uma versão com a revisão ${version} para este roteiro.` });
      }
      if ((dupRows as any[]).some((r) => String(r.revisao_date).slice(0, 10) === revisaoDate)) {
        return res.status(409).json({ error: `Já existe uma versão com a data de revisão ${isoToBR(revisaoDate)} para este roteiro.` });
      }

      try {
        const { flags: elimFlags } = inheritEliminatory(await vigenteEliminatory(parsed.sourceFile), parsed.questions);
        const result = await withTransaction(async (client) => {
          const { rows: sr } = await client.query(
            `INSERT INTO eval_scripts (title, description, version, source_file, revisao_date, implantacao_date, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING id`,
            [parsed.title, parsed.description, version, parsed.sourceFile, revisaoDate, parsed.implantacaoDate],
          );
          const scriptId = sr[0].id as number;

          const idByTmp = new Map<number, number>();
          for (const s of parsed.sections) {
            const parentId = s.parentTmp != null ? idByTmp.get(s.parentTmp) ?? null : null;
            const { rows: secRows } = await client.query(
              `INSERT INTO eval_sections (script_id, parent_section_id, name, order_index)
               VALUES ($1, $2, $3, $4) RETURNING id`,
              [scriptId, parentId, s.name, s.order],
            );
            idByTmp.set(s.tmp, secRows[0].id);
          }
          for (const [i, q] of parsed.questions.entries()) {
            const sectionId = q.sectionTmp != null ? idByTmp.get(q.sectionTmp) ?? null : null;
            if (sectionId == null) continue;
            // ponytail: type fixo em 'sim_nao' — todo roteiro atual é conformidade + evidência.
            // Adiado: derivar o type do "Tipo" (S/DL/E/C) quando o parser passar a lê-lo.
            await client.query(
              `INSERT INTO eval_questions
                 (section_id, code, text, legislation, type, weight, max_score, dimension, document_type,
                  guidance, evidence_required, is_eliminatory, order_index)
               VALUES ($1,$2,$3,$4,'sim_nao',$5,$6,$7,$8,$9,$10,$11,$12)`,
              [sectionId, q.code, q.text, q.legislation, q.weight, q.maxScore,
               q.dimension, q.documentType, q.guidance, q.evidenceRequired, elimFlags[i], q.order],
            );
          }
          // Prestadores carregados antes de o roteiro existir ficam com eval_script_id NULL;
          // liga-os pelo roteiro_cod (FOR-XXX). Quem já tem roteiro não é tocado.
          const cod = /FOR-(\d+)/i.exec(parsed.sourceFile ?? '');
          const linked = cod ? (await client.query(
            'UPDATE providers SET eval_script_id = $1 WHERE eval_script_id IS NULL AND roteiro_cod = $2',
            [scriptId, `FOR-${cod[1]}`])).rowCount ?? 0 : 0;
          return { id: scriptId, version: parsed.version, linked };
        });

        await auditLog({
          query, userId: req.user.id, action: 'eval_script_imported',
          meta: { script_id: result.id, source_file: parsed.sourceFile, version, eliminatory_inherited: elimFlags.filter(Boolean).length, providers_linked: result.linked },
          ip: hashClientIp(req),
        });

        res.json({
          success: true,
          id: result.id,
          version: result.version,
          title: parsed.title,
          sourceFile: parsed.sourceFile,
          questionCount: parsed.questions.length,
        });
      } catch (err: any) {
        if (err?.code === '23505') {
          return res.status(409).json({ error: 'Já existe uma versão com esta revisão ou data de revisão para este roteiro.' });
        }
        console.error(err);
        res.status(500).json({ error: err.message || 'Falha ao importar o roteiro.' });
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message || 'Falha ao importar o roteiro.' });
    }
  });

  app.delete('/api/eval/scripts/:id', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      try {
        const scriptId = req.params.id;
        const { rows: [toDelete] } = await query('SELECT source_file, version FROM eval_scripts WHERE id = $1', [scriptId]);
        // Proteção: roteiro já usado em avaliações só pode ser excluído com
        // confirmação forte (frase "excluir roteiro"). Recalculamos no servidor —
        // nunca confiamos no frontend. A exclusão remove o histórico por cascade.
        const { rows: usage } = await query('SELECT count(*)::int AS n FROM eval_instances WHERE script_id = $1', [scriptId]);
        const usageCount = (usage[0] as any)?.n ?? 0;
        const confirmPhrase = String(req.body?.confirm ?? '').trim().toLowerCase();
        if (usageCount > 0 && confirmPhrase !== 'excluir roteiro') {
          const avaliacoes = usageCount === 1 ? '1 avaliação preenchida' : `${usageCount} avaliações preenchidas`;
          return res.status(409).json({
            error: `Há ${avaliacoes} por prestadores usando este roteiro. A exclusão também removerá esse histórico permanentemente. Para confirmar, digite: excluir roteiro.`,
            usage_count: usageCount,
            requiresConfirmation: true,
          });
        }
        await withTransaction(async (client) => {
          const { rows: sections } = await client.query('SELECT id FROM eval_sections WHERE script_id = $1', [scriptId]);
          for (const sec of sections as any[]) {
            await client.query('DELETE FROM eval_questions WHERE section_id = $1', [sec.id]);
          }
          await client.query('DELETE FROM eval_sections WHERE script_id = $1', [scriptId]);
          await client.query('DELETE FROM eval_scripts WHERE id = $1', [scriptId]);
        });
        await auditLog({
          query, userId: req.user.id, action: 'eval_script_deleted',
          meta: { script_id: Number(scriptId), source_file: toDelete?.source_file ?? null, version: toDelete?.version ?? null, usage_count: usageCount },
          ip: hashClientIp(req),
        });
        res.json({ success: true });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Marcação dos critérios eliminatórios do roteiro (spec 2026-09-21). Body traz o
  // conjunto COMPLETO de ids marcados — idempotente; lista vazia é permitida.
  app.patch('/api/eval/scripts/:id/eliminatory', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      const scriptId = Number(req.params.id);
      const raw = req.body?.question_ids;
      if (!Number.isInteger(scriptId) || !Array.isArray(raw) || raw.some((v: any) => !Number.isInteger(Number(v)))) {
        return res.status(400).json({ error: 'Envie question_ids como lista de ids de critérios.' });
      }
      const { rows: [script] } = await query('SELECT id, source_file, version FROM eval_scripts WHERE id = $1', [scriptId]);
      if (!script) return res.status(404).json({ error: 'Roteiro não encontrado.' });
      // ponytail: checagem fora da transação — corrida com "abrir ciclo" no mesmo
      // instante é aceitável. Upgrade: SELECT ... FOR UPDATE no ciclo.
      if (await eliminatoryLocked(scriptId)) {
        return res.status(409).json({ error: 'Este roteiro tem avaliações em ciclo aberto. Os critérios eliminatórios só podem ser alterados com o ciclo encerrado.' });
      }
      const { rows: current } = await query(
        `SELECT eq.id, eq.code, eq.is_eliminatory
           FROM eval_questions eq JOIN eval_sections es ON es.id = eq.section_id
          WHERE es.script_id = $1`, [scriptId]);
      const diff = diffEliminatory(
        (current as any[]).map((c) => ({ id: Number(c.id), code: c.code, is_eliminatory: !!c.is_eliminatory })),
        raw.map(Number),
      );
      if (diff.unknownIds.length) {
        return res.status(400).json({ error: 'Há critérios que não pertencem a este roteiro.' });
      }
      if (diff.toMark.length || diff.toUnmark.length) {
        await withTransaction(async (client) => {
          await client.query('UPDATE eval_questions SET is_eliminatory = true  WHERE id = ANY($1::bigint[])', [diff.toMark.map((c) => c.id)]);
          await client.query('UPDATE eval_questions SET is_eliminatory = false WHERE id = ANY($1::bigint[])', [diff.toUnmark.map((c) => c.id)]);
        });
        await auditLog({
          query, userId: req.user.id, action: 'eval_eliminatory_changed',
          meta: {
            script_id: scriptId, source_file: script.source_file, version: script.version,
            marked: diff.toMark.map((c) => c.code ?? `#${c.id}`),
            unmarked: diff.toUnmark.map((c) => c.code ?? `#${c.id}`),
          },
          ip: hashClientIp(req),
        });
      }
      res.json({ success: true, marked: diff.toMark.length, unmarked: diff.toUnmark.length });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eval/scripts', authenticate, async (req: any, res) => {
    try {
      const { role, provider_id } = req.user;
      // Prestador/cooperado só enxerga o roteiro do seu tipo (providers.eval_script_id);
      // admin/auditoria gerenciam todos.
      // ponytail: filtra pelo eval_script_id fixado no match; se o roteiro for reversionado,
      // resolver p/ versão vigente por source_file. Hoje há 1 versão por roteiro.
      const scripts = PROVIDER_ACCESS_ROLES.includes(role)
        ? (await query(
            `SELECT s.*, m.filename AS manual_filename, m.size_bytes AS manual_size_bytes, m.uploaded_at AS manual_uploaded_at
               FROM eval_scripts s
             JOIN providers p ON p.eval_script_id = s.id
             LEFT JOIN eval_script_manuals m ON m.source_file = s.source_file
             WHERE p.id = $1
             ORDER BY s.created_at DESC`, [provider_id])).rows
        : (await query(
            `SELECT s.*, m.filename AS manual_filename, m.size_bytes AS manual_size_bytes, m.uploaded_at AS manual_uploaded_at
               FROM eval_scripts s LEFT JOIN eval_script_manuals m ON m.source_file = s.source_file
              ORDER BY s.created_at DESC`)).rows;

      // Maior versão por source_file → define a vigência ("is_current").
      const maxBySource = new Map<string, number>();
      for (const s of scripts as any[]) {
        if (!s.source_file) continue;
        const n = scriptVersionNum(s.version);
        if (n > (maxBySource.get(s.source_file) ?? -1)) maxBySource.set(s.source_file, n);
      }

      const scriptsWithItems = [];
      for (const script of scripts as any[]) {
        const { rows: questions } = await query(`
          SELECT eq.id, eq.text as title, eq.code, eq.evidence_required, eq.max_score, eq.is_eliminatory
          FROM eval_questions eq
          JOIN eval_sections es ON eq.section_id = es.id
          WHERE es.script_id = $1
          ORDER BY eq.order_index ASC
        `, [script.id]);
        const semEvidencia = (questions as any[])
          .filter((q) => !q.evidence_required)
          .map((q) => ({ code: q.code, text: q.title }));
        const semPeso = (questions as any[])
          .filter((q) => !Number(q.max_score)) // numeric chega como string; "0"/null/NaN → sem peso
          .map((q) => ({ code: q.code, text: q.title }));
        const semEliminatorio = !(questions as any[]).some((q) => q.is_eliminatory);
        const isCurrent = !script.source_file
          || scriptVersionNum(script.version) === maxBySource.get(script.source_file);
        const { rows: usage } = await query('SELECT count(*)::int AS n FROM eval_instances WHERE script_id = $1', [script.id]);
        const usageCount = (usage[0] as any)?.n ?? 0;
        scriptsWithItems.push({
          ...script, items: questions, is_current: isCurrent,
          alerts: { semEvidencia, semPeso, semEliminatorio },
          usage_count: usageCount, eliminatory_locked: await eliminatoryLocked(script.id),
        });
      }
      res.json(scriptsWithItems);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Manual (PDF) do roteiro — spec 2026-09-24. Chave = source_file (vale p/ todas as revisões).
  const scriptSourceFile = async (id: number): Promise<string | null> =>
    (await query('SELECT source_file FROM eval_scripts WHERE id = $1', [id])).rows[0]?.source_file ?? null;

  app.put('/api/eval/scripts/:id/manual', authenticate, pdfUpload, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const sf = await scriptSourceFile(Number(req.params.id));
      if (!sf) return res.status(404).json({ error: 'Roteiro não encontrado' });
      if (!req.file) return res.status(400).json({ error: 'Envie o PDF no campo "file".' });
      // multer decodifica originalname como latin1; reconstruir o UTF-8 do nome do arquivo
      const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      if (!isPdf(name, req.file.buffer)) return res.status(400).json({ error: 'Apenas arquivos PDF são aceitos' });
      await query(
        `INSERT INTO eval_script_manuals (source_file, filename, size_bytes, content, uploaded_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_file) DO UPDATE SET filename = EXCLUDED.filename, size_bytes = EXCLUDED.size_bytes,
           content = EXCLUDED.content, uploaded_by = EXCLUDED.uploaded_by, uploaded_at = now()`,
        [sf, name, req.file.size, req.file.buffer, req.user.id]);
      await auditLog({
        query, userId: req.user.id, action: 'script_manual_uploaded',
        meta: { script_id: Number(req.params.id), source_file: sf, filename: name, size: req.file.size },
        ip: hashClientIp(req),
      });
      res.json({ success: true, filename: name, size_bytes: req.file.size });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/eval/scripts/:id/manual', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const sf = await scriptSourceFile(Number(req.params.id));
      if (!sf) return res.status(404).json({ error: 'Roteiro não encontrado' });
      await query('DELETE FROM eval_script_manuals WHERE source_file = $1', [sf]);
      await auditLog({
        query, userId: req.user.id, action: 'script_manual_removed',
        meta: { script_id: Number(req.params.id), source_file: sf },
        ip: hashClientIp(req),
      });
      res.json({ success: true });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Download só autenticado (sem link público). Prestador: só o manual do roteiro ligado a ele.
  app.get('/api/eval/scripts/:id/manual', authenticate, async (req: any, res) => {
    try {
      const sf = await scriptSourceFile(Number(req.params.id));
      let linked: string[] = [];
      if (!isStaff(req.user.role) && req.user.provider_id) {
        const { rows } = await query(
          `SELECT DISTINCT s.source_file FROM eval_scripts s
            WHERE s.source_file IS NOT NULL AND (
              s.id = (SELECT eval_script_id FROM providers WHERE id = $1)
              OR s.id IN (SELECT script_id FROM eval_instances WHERE provider_id = $1 AND location_id = ANY($2::bigint[])))`,
          [req.user.provider_id, await userLocationIds(req)]);
        linked = rows.map((r: any) => r.source_file);
      }
      if (!canDownloadManual(req.user.role, linked, sf)) return res.status(403).json({ error: 'Sem acesso a este manual' });
      const { rows } = await query('SELECT filename, content FROM eval_script_manuals WHERE source_file = $1', [sf]);
      if (!rows[0]) return res.status(404).json({ error: 'Este roteiro ainda não tem manual.' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(rows[0].filename)}`);
      res.send(rows[0].content);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eval/scripts/:id', authenticate, async (req: any, res) => {
    try {
      const { rows: scriptRows } = await query(
        `SELECT s.*, m.filename AS manual_filename, m.size_bytes AS manual_size_bytes, m.uploaded_at AS manual_uploaded_at
           FROM eval_scripts s LEFT JOIN eval_script_manuals m ON m.source_file = s.source_file
          WHERE s.id = $1`, [req.params.id]);
      const script = scriptRows[0] as any;
      if (!script) return res.status(404).json({ error: 'Script not found' });

      const { rows: sections } = await query('SELECT * FROM eval_sections WHERE script_id = $1 ORDER BY order_index ASC', [req.params.id]);

      const { rows: questions } = await query(`
        SELECT eq.* FROM eval_questions eq
        JOIN eval_sections es ON eq.section_id = es.id
        WHERE es.script_id = $1
        ORDER BY eq.order_index ASC
      `, [req.params.id]);

      res.json({ ...script, sections, questions, eliminatory_locked: await eliminatoryLocked(script.id) });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/eval/instances', authenticate, async (req: any, res) => {
    try {
      const { role, provider_id: userProviderId } = req.user;
      const { script_id } = req.body;
      // O prestador inicia a própria avaliação: provider_id vem do token (nunca do body,
      // p/ evitar IDOR). Admin/auditoria podem indicar o provider explicitamente.
      const providerId = (role === 'admin' || role === 'auditoria')
        ? req.body.provider_id
        : userProviderId;
      if (!script_id || !providerId) {
        return res.status(400).json({ error: 'script_id e provider_id são obrigatórios' });
      }
      // Avaliação é por unidade de atendimento. Se o body não trouxer location_id e o
      // prestador tem exatamente 1 unidade comercial, resolve automático. Se tem 0 ou >1
      // sem escolha, salva com NULL (compat legada — instância "do prestador inteiro").
      let locationId: number | null = req.body.location_id ? Number(req.body.location_id) : null;
      if (locationId == null) {
        const { rows: locs } = await query(
          `SELECT id FROM provider_locations
            WHERE provider_id = $1
              AND COALESCE(label,'') NOT ILIKE 'residencial%'
              AND COALESCE(sgu_location_code,'') !~ '-RES$'`,
          [providerId],
        );
        if (locs.length === 1) locationId = Number(locs[0].id);
      }
      // Amarra a instância ao ciclo ativo (partial unique garante no máx. 1). Sem isso
      // a validade do certificado (fim do ciclo + 1 ano) cairia no fallback. Se não
      // houver ciclo ativo, fica NULL e o fallback (aprovação + 1 ano) cobre.
      const { rows } = await query(`
        INSERT INTO eval_instances (script_id, provider_id, location_id, status, cycle_id, started_at)
        VALUES ($1, $2, $3, 'em_andamento', (SELECT id FROM eval_cycles WHERE active = true), $4) RETURNING id
      `, [script_id, providerId, locationId, new Date().toISOString()]);
      await auditLog({
        query, userId: req.user.id, action: 'evaluation_created',
        meta: {
          provider_id: Number(providerId), instance_id: rows[0].id,
          script_id: Number(script_id), location_id: locationId,
        },
        ip: hashClientIp(req),
      });
      res.json({ success: true, id: rows[0].id });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Nome do prestador do próprio usuário logado (o /api/providers/:id é restrito a staff).
  app.get('/api/me/provider', authenticate, async (req: any, res) => {
    try {
      const { provider_id } = req.user;
      if (!provider_id) return res.json(null);
      const { rows } = await query(
        'SELECT id, name, person_type, provider_group, eval_script_id, created_at FROM providers WHERE id = $1',
        [provider_id],
      );
      const provider = rows[0];
      if (!provider) return res.json(null);
      // Unidades comerciais (exclui residencial) para permitir avaliação por local.
      const { rows: locations } = await query(
        `SELECT id, label, cidade, uf, logradouro, numero, bairro
           FROM provider_locations
          WHERE provider_id = $1
            AND id = ANY($2::bigint[])
            AND COALESCE(label,'') NOT ILIKE 'residencial%'
            AND COALESCE(sgu_location_code,'') !~ '-RES$'
          ORDER BY is_primary DESC NULLS LAST, id ASC`,
        [provider_id, await userLocationIds(req)],
      );
      res.json({ ...provider, locations });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eval/instances', authenticate, async (req: any, res) => {
    try {
      const { provider_id, role } = req.user;
      const baseQuery = `
        SELECT ei.*, s.title as script_title, p.name as provider_name,
          COALESCE(NULLIF(pl.logradouro, ''), pl.label, pl.cidade) AS location_label,
          pl.cidade AS location_cidade, pl.uf AS location_uf, cy.label AS cycle_label,
          (SELECT count(*)::int FROM eval_questions eq
             JOIN eval_sections es ON eq.section_id = es.id
            WHERE es.script_id = ei.script_id) AS total_questions,
          (SELECT count(*)::int FROM eval_answers ea
            WHERE ea.instance_id = ei.id AND ea.answer_value IS NOT NULL) AS answered_count
          ,(SELECT count(*)::int FROM eval_answers ea
             WHERE ea.instance_id = ei.id AND ${PENDING_ANSWER_SQL}) AS pending_count,
          EXISTS (SELECT 1 FROM eval_survey_responses sr WHERE sr.instance_id = ei.id) AS has_survey_response
        FROM eval_instances ei
        JOIN eval_scripts s ON ei.script_id = s.id
        JOIN providers p ON ei.provider_id = p.id
        LEFT JOIN provider_locations pl ON pl.id = ei.location_id
        LEFT JOIN eval_cycles cy ON cy.id = ei.cycle_id
      `;
      let instances;
      if (role === 'admin' || role === 'auditoria') {
        const result = await query(baseQuery + ' ORDER BY ei.started_at DESC');
        instances = result.rows;
      } else {
        const result = await query(
          baseQuery + ' WHERE ei.provider_id = $1 AND ei.location_id = ANY($2::bigint[]) ORDER BY ei.started_at DESC',
          [provider_id, await userLocationIds(req)]);
        instances = result.rows;
      }
      res.json(instances);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eval/instances/:id', authenticate, async (req: any, res) => {
    try {
      const { rows: instanceRows } = await query(`
        SELECT ei.*, s.title as script_title, p.name as provider_name,
               COALESCE(NULLIF(pl.logradouro, ''), pl.label, pl.cidade) AS location_label,
               pl.cidade AS location_cidade, pl.uf AS location_uf
        FROM eval_instances ei
        JOIN eval_scripts s ON ei.script_id = s.id
        JOIN providers p ON ei.provider_id = p.id
        LEFT JOIN provider_locations pl ON pl.id = ei.location_id
        WHERE ei.id = $1
      `, [req.params.id]);
      const instance = instanceRows[0] as any;

      if (!instance) return res.status(404).json({ error: 'Instance not found' });

      // Anti-IDOR (mesma regra do loadInstanceForWrite): prestador/cooperado só lê a
      // própria avaliação; admin/auditoria leem qualquer uma.
      const { role: viewerRole, provider_id: viewerProviderId } = req.user;
      const viewerLocationIds = await userLocationIds(req);
      if (viewerRole !== 'admin' && viewerRole !== 'auditoria'
          && (String(instance.provider_id) !== String(viewerProviderId)
              || !viewerLocationIds.includes(Number(instance.location_id)))) {
        return res.status(403).json({ error: 'Você não tem permissão para ver esta avaliação' });
      }

      const { rows: answers } = await query('SELECT * FROM eval_answers WHERE instance_id = $1', [req.params.id]);

      const { rows: evidences } = await query('SELECT * FROM documents WHERE type = $1 AND reference_id = $2', ['qualificacao_evidencia', req.params.id]);

      // Histórico de iterações por critério — mesma fonte de verdade pros dois lados.
      const { rows: iterations } = await query(`
        SELECT eai.id, eai.answer_id, eai.iteration_number, eai.actor_id, eai.actor_role,
               eai.action, eai.answer_value, eai.score_obtained, eai.evidence_url,
               eai.observation, eai.created_at,
               u.name AS actor_name
          FROM eval_answer_iterations eai
          JOIN eval_answers ea ON ea.id = eai.answer_id
          LEFT JOIN users u ON u.id = eai.actor_id
         WHERE ea.instance_id = $1
         ORDER BY eai.answer_id, eai.iteration_number
      `, [req.params.id]);

      // Reanálise em lote (spec 2026-09-11): enquanto a análise não é devolvida, o
      // prestador não vê os rascunhos de reanálise — o item aparece como 'pendente',
      // sem observação do auditor e sem a iteração de solicitação no histórico.
      let visibleAnswers = answers;
      let visibleIterations = iterations;
      const isProviderViewer = viewerRole !== 'admin' && viewerRole !== 'auditoria';
      if (isProviderViewer && instance.status === 'em_analise') {
        const maskedIds = new Set(
          (answers as any[]).filter(a => a.evidence_status === 'aguardando_reanalise').map(a => Number(a.id)));
        visibleAnswers = (answers as any[]).map(a => maskedIds.has(Number(a.id))
          ? { ...a, evidence_status: 'pendente', auditor_observation: null }
          : a);
        visibleIterations = (iterations as any[]).filter(
          it => !(maskedIds.has(Number(it.answer_id)) && it.action === 'solicitou_reanalise'));
      }

      // Termo de Ciência (spec 2026-09-29): último aceite registrado neste roteiro.
      const { rows: termRows } = await query(
        `SELECT user_name, accepted_at, term_version, term_text FROM eval_instance_terms
          WHERE instance_id = $1 ORDER BY accepted_at DESC, id DESC LIMIT 1`, [req.params.id]);

      res.json({ ...instance, answers: visibleAnswers, evidences, iterations: visibleIterations, term: termRows[0] ?? null });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Carrega a instância garantindo posse (anti-IDOR). Prestador só acessa a própria;
  // admin/auditoria acessam qualquer uma. Responde 404/403 e retorna null se negado.
  const loadInstanceForWrite = async (req: any, res: any): Promise<any | null> => {
    const { rows } = await query('SELECT id, provider_id, location_id, status, script_id, submitted_at FROM eval_instances WHERE id = $1', [req.params.id]);
    const instance = rows[0] as any;
    if (!instance) {
      res.status(404).json({ error: 'Avaliação não encontrada' });
      return null;
    }
    const { role, provider_id } = req.user;
    const locationIds = await userLocationIds(req);
    const isStaff = role === 'admin' || role === 'auditoria';
    if (!isStaff && (String(instance.provider_id) !== String(provider_id)
        || !locationIds.includes(Number(instance.location_id)))) {
      res.status(403).json({ error: 'Você não tem permissão para alterar esta avaliação' });
      return null;
    }
    return instance;
  };

  app.put('/api/eval/instances/:id/answers', authenticate, async (req: any, res) => {
    try {
      const instance = await loadInstanceForWrite(req, res);
      if (!instance) return;

      const instanceId = req.params.id;
      const { answers } = req.body;

      const actorRole = PROVIDER_ACCESS_ROLES.includes(req.user.role) ? 'prestador' : 'auditor';
      const isProvider = actorRole === 'prestador';
      // D-04: prestador só escreve nos estados de edição. Fora disso (em_analise,
      // finalizado, etc.) rejeita — staff segue sem restrição.
      if (isProvider && !PROVIDER_EDIT_STATUSES.has(instance.status)) {
        return res.status(409).json({ error: `status ${instance.status} não permite edição pelo prestador` });
      }
      await withTransaction(async (client) => {
        // Ao primeiro save, sai de 'pendente' pra 'em_andamento' (5.4.2.2).
        if (instance.status === 'pendente') {
          await client.query(`UPDATE eval_instances SET status = 'em_andamento' WHERE id = $1 AND status = 'pendente'`, [instanceId]);
        }
        for (const ans of answers as any[]) {
          // Lê o valor anterior pra decidir se grava iteration (só quando de fato mudou).
          const { rows: prevRows } = await client.query(
            `SELECT id, answer_value, score_obtained, provider_observation, evidence_status,
                    EXISTS(SELECT 1 FROM eval_answer_iterations it
                            WHERE it.answer_id = eval_answers.id AND it.action = 'solicitou_reanalise') AS ever_reanalise
               FROM eval_answers WHERE instance_id = $1 AND question_id = $2`,
            [instanceId, ans.question_id]
          );
          const prev = prevRows[0];
          // D-04: em reanálise só o critério em reavaliação é editável; os já
          // analisados e os de 1ª rodada nunca analisados ficam travados. O payload
          // pode trazer todos — os travados são ignorados silenciosamente.
          if (isProvider && !providerCanEditCriterion(instance.status, prev?.evidence_status ?? null, prev?.ever_reanalise ?? false)) {
            continue;
          }
          const nextVal = ans.answer_value || null;
          const nextScore = Number(ans.score_obtained || 0);
          const nextObs = ans.provider_observation || null;
          const changed = !prev
            || prev.answer_value !== nextVal
            || Number(prev.score_obtained) !== nextScore
            || (prev.provider_observation ?? null) !== nextObs;

          await client.query(`
            INSERT INTO eval_answers (instance_id, question_id, answer_value, score_obtained, provider_observation, is_non_compliant)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT(instance_id, question_id) DO UPDATE SET
              answer_value = excluded.answer_value,
              score_obtained = excluded.score_obtained,
              provider_observation = excluded.provider_observation,
              is_non_compliant = excluded.is_non_compliant
          `, [
            instanceId,
            ans.question_id,
            nextVal,
            nextScore,
            nextObs,
            ans.is_non_compliant || false
          ]);

          if (!changed) continue;

          const { rows: [{ id: answerId }] } = await client.query(
            `SELECT id FROM eval_answers WHERE instance_id = $1 AND question_id = $2`,
            [instanceId, ans.question_id]
          );
          const { rows: [{ n }] } = await client.query(
            `SELECT COALESCE(MAX(iteration_number), 0) + 1 AS n FROM eval_answer_iterations WHERE answer_id = $1`,
            [answerId]
          );
          await client.query(`
            INSERT INTO eval_answer_iterations
              (answer_id, iteration_number, actor_id, actor_role, action, answer_value, score_obtained, evidence_url, observation)
            VALUES ($1, $2, $3, $4, 'respondeu', $5, $6, NULL, $7)
          `, [answerId, n, req.user.id, actorRole, nextVal, nextScore, nextObs]);
          // Reset evidence_status se estava aguardando reanálise
          await client.query(
            `UPDATE eval_answers SET evidence_status = 'pendente' WHERE id = $1 AND evidence_status = 'aguardando_reanalise'`,
            [answerId]
          );
        }
      });

      await auditLog({
        query, userId: req.user.id, action: 'evaluation_answered',
        meta: {
          provider_id: Number(instance.provider_id),
          instance_id: Number(instanceId),
          location_id: instance.location_id ?? null,
          answers_count: Array.isArray(answers) ? answers.length : 0,
        },
        ip: hashClientIp(req),
      });
      res.json({ success: true });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Aceite do Termo de Ciência pelo prestador, antes de preencher (spec 2026-09-29).
  // Só INSERT — grava o texto integral aceito; staff não aceita em nome do prestador.
  app.post('/api/eval/instances/:id/term', authenticate, async (req: any, res) => {
    try {
      const instance = await loadInstanceForWrite(req, res);
      if (!instance) return;
      if (req.user.role === 'admin' || req.user.role === 'auditoria') {
        return res.status(403).json({ error: 'O termo é aceito pelo prestador.' });
      }
      if (req.body?.version !== TERMO_EVIDENCIAS_VERSION) {
        return res.status(409).json({ error: 'O termo foi atualizado. Recarregue a página.' });
      }
      const { rows: prev } = await query(
        'SELECT accepted_at FROM eval_instance_terms WHERE instance_id = $1 AND term_version = $2 LIMIT 1',
        [instance.id, TERMO_EVIDENCIAS_VERSION]);
      if (prev[0]) return res.json({ ok: true, accepted_at: prev[0].accepted_at });
      const { rows } = await query(
        `INSERT INTO eval_instance_terms (instance_id, user_id, user_name, user_email, term_version, term_text, ip_hash)
         SELECT $1, id, name, email, $3, $4, $5 FROM users WHERE id = $2
         RETURNING accepted_at`,
        [instance.id, req.user.id, TERMO_EVIDENCIAS_VERSION, termoEvidenciasTexto(), hashClientIp(req)]);
      await auditLog({ query, userId: req.user.id, action: 'eval_term_accepted', meta: { instance_id: Number(instance.id), version: TERMO_EVIDENCIAS_VERSION }, ip: hashClientIp(req) });
      res.json({ ok: true, accepted_at: rows[0]?.accepted_at ?? null });
    } catch (err) {
      console.error('POST /api/eval/instances/:id/term:', err);
      res.status(500).json({ error: 'Falha ao registrar o aceite do termo.' });
    }
  });

  app.post('/api/eval/instances/:id/submit', authenticate, async (req: any, res) => {
    try {
      const instance = await loadInstanceForWrite(req, res);
      if (!instance) return;
      if (!['em_andamento', 'aguardando_evidencia'].includes(instance.status)) {
        return res.status(409).json({ error: `status ${instance.status} não permite submit` });
      }
      const { rows: termOk } = await query('SELECT 1 FROM eval_instance_terms WHERE instance_id = $1 LIMIT 1', [instance.id]);
      if (!termOk.length) {
        return res.status(409).json({ error: 'Aceite o Termo de Ciência antes de enviar.' });
      }

      // Completude: toda eval_questions do script precisa ter answer com answer_value não vazio.
      const { rows: missing } = await query(`
        SELECT eq.id, eq.text
          FROM eval_questions eq
          JOIN eval_sections sc ON sc.id = eq.section_id
         WHERE sc.script_id = $1
           AND NOT EXISTS (
             SELECT 1 FROM eval_answers ea
              WHERE ea.instance_id = $2 AND ea.question_id = eq.id
                AND ea.answer_value IS NOT NULL AND ea.answer_value <> ''
           )
      `, [instance.script_id, req.params.id]);
      if (missing.length) {
        return res.status(409).json({ error: 'critérios sem resposta', missing_question_ids: missing.map((r: any) => Number(r.id)) });
      }

      const { rows: pending } = await query(
        `SELECT id FROM eval_answers WHERE instance_id = $1 AND evidence_status = 'aguardando_reanalise'`,
        [req.params.id]
      );
      if (pending.length) {
        return res.status(409).json({ error: 'critérios aguardando reanálise', pending_answer_ids: pending.map((r: any) => Number(r.id)) });
      }

      // Pesquisa de Satisfação nasce só no PRIMEIRO envio; reenvios (reanálise/
      // devolução) preservam submitted_at e não geram nova pesquisa.
      const firstSubmission = !instance.submitted_at;
      await query(
        `UPDATE eval_instances SET status = 'em_analise', submitted_at = COALESCE(submitted_at, now()) WHERE id = $1`,
        [req.params.id],
      );

      await auditLog({
        query, userId: req.user.id, action: 'evaluation_submitted',
        meta: {
          provider_id: Number(instance.provider_id),
          instance_id: Number(req.params.id),
          location_id: instance.location_id ?? null,
        },
        ip: hashClientIp(req),
      });

      void (async () => {
        const { rows: [pv] } = await query('SELECT name FROM providers WHERE id = $1', [instance.provider_id]);
        // resubmission: reenvio após reanálise/devolução — o auditor vê descrição própria.
        await notifyEvent('roteiro_enviado', { provider_name: pv?.name ?? '', resubmission: !firstSubmission },
          await auditoriaRecipients(), { providerId: Number(instance.provider_id) });
      })().catch((e) => console.error('[notify] site roteiro_enviado:', e));

      res.json({ success: true, first_submission: firstSubmission });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // ponytail: legado. O selo agora é calculado exclusivamente em POST /parecer.
  // O campo `seal` do body é ignorado. Mantido para compat com o AuditorEvaluationModal
  // antigo até a Task 11 refatorar.
  app.put('/api/eval/instances/:id/status', authenticate, async (req: any, res) => {
    try {
      const instance = await loadInstanceForWrite(req, res);
      if (!instance) return;

      const { status, score, percentual, max_possible_score, seal } = req.body;
      const now = new Date().toISOString();
      await query(`
        UPDATE eval_instances
        SET status = $1, score = $2, max_possible_score = $3, percentual = $4,
            completed_at = CASE WHEN $5 IN ('pendente', 'finalizado') THEN $6 ELSE completed_at END
        WHERE id = $7
      `, [status, score || 0, max_possible_score || 0, percentual || 0, status, now, req.params.id]);

      await auditLog({
        query, userId: req.user.id, action: 'evaluation_status_changed',
        meta: {
          provider_id: Number(instance.provider_id),
          instance_id: Number(req.params.id),
          location_id: instance.location_id ?? null,
          status, seal: seal || null,
        },
        ip: hashClientIp(req),
      });
      res.json({ success: true });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/eval/instances/:id/reopen', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const id = Number(req.params.id);
      // Só faz sentido devolver o que está em análise. Estados terminais (aprovado/
      // finalizado) e o que já foi devolvido (aguardando_evidencia) ficam de fora.
      const { rows: curr } = await query('SELECT status FROM eval_instances WHERE id = $1', [id]);
      if (!curr.length) return res.status(404).json({ error: 'Instância não encontrada' });
      if (curr[0].status !== 'em_analise') {
        return res.status(409).json({ error: `instância em status ${curr[0].status} não pode ser devolvida` });
      }
      let reopened: any;
      await withTransaction(async (client) => {
        const { rows } = await client.query(
          `UPDATE eval_instances SET status = 'aguardando_evidencia'
            WHERE id = $1 RETURNING id, provider_id, location_id, status`,
          [id]
        );
        reopened = rows[0];
        // Devolução integral: sem marcar os critérios, providerCanEditCriterion nega
        // tudo (instância em aguardando_evidencia + critério sem histórico de reanálise)
        // e o prestador não consegue anexar nem salvar nada. Registra a devolução como
        // iteração 'solicitou_reanalise' em cada critério ainda não decidido — o
        // histórico (everReanalise) é o que libera a edição. evidence_status fica
        // intacto para não travar o resubmit; aprovado/reprovado seguem travados (D-04).
        await client.query(`
          INSERT INTO eval_answer_iterations
            (answer_id, iteration_number, actor_id, actor_role, action, answer_value, score_obtained, evidence_url, observation)
          SELECT ea.id,
                 COALESCE((SELECT MAX(it.iteration_number) FROM eval_answer_iterations it WHERE it.answer_id = ea.id), 0) + 1,
                 $2, 'auditor', 'solicitou_reanalise', ea.answer_value, ea.score_obtained, ea.evidence_url,
                 'Avaliação devolvida integralmente ao prestador'
            FROM eval_answers ea
           WHERE ea.instance_id = $1
             AND COALESCE(ea.evidence_status, 'pendente') NOT IN ('aprovado','reprovado','nao_se_aplica')
        `, [id, req.user.id]);
      });
      if (!reopened) return res.status(404).json({ error: 'instance not found' });

      await auditLog({
        query, userId: req.user.id, action: 'evaluation_reopened',
        meta: {
          provider_id: Number(reopened.provider_id),
          instance_id: id,
          location_id: reopened.location_id ?? null,
        },
        ip: hashClientIp(req),
      });

      void (async () => {
        await notifyEvent('reanalise_solicitada', { integral: true, instance_id: id, end_date: await instanceCycleEnd(id) },
          await prestadorRecipients(Number(reopened.provider_id), reopened.location_id ?? null),
          { providerId: Number(reopened.provider_id) });
      })().catch((e) => console.error('[notify] site reanalise_solicitada (reopen):', e));

      res.json({ success: true, new_status: reopened.status });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/eval/instances/:id/evidence', authenticate, upload.single('file'), async (req: any, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const instance = await loadInstanceForWrite(req, res);
      if (!instance) return;

      const instanceId = req.params.id;
      // A evidência pertence ao prestador da própria instância (evita gravar no prestador errado).
      const providerId = instance.provider_id;
      const fileUrl = '/uploads/' + req.file.filename;
      const questionId = req.body.question_id ? Number(req.body.question_id) : null;

      // D-04: prestador só anexa evidência em estado de edição e, na reanálise, só
      // no critério devolvido. Remove o upload órfão ao rejeitar. Staff sem restrição.
      const isProvider = PROVIDER_ACCESS_ROLES.includes(req.user.role);
      if (isProvider) {
        const rejectUpload = (code: number, msg: string) => {
          try { fs.unlinkSync(req.file.path); } catch { /* arquivo já sumiu */ }
          return res.status(code).json({ error: msg });
        };
        if (!PROVIDER_EDIT_STATUSES.has(instance.status)) {
          return rejectUpload(409, `status ${instance.status} não permite anexar evidência`);
        }
        if (questionId) {
          const { rows: cur } = await query(
            `SELECT evidence_status,
                    EXISTS(SELECT 1 FROM eval_answer_iterations it
                            WHERE it.answer_id = eval_answers.id AND it.action = 'solicitou_reanalise') AS ever_reanalise
               FROM eval_answers WHERE instance_id = $1 AND question_id = $2`,
            [instanceId, questionId]
          );
          if (!providerCanEditCriterion(instance.status, cur[0]?.evidence_status ?? null, cur[0]?.ever_reanalise ?? false)) {
            return rejectUpload(403, 'critério não está liberado para reanálise');
          }
        }
      }

      // Cada evidência é um row novo (permite múltiplos anexos por questão).
      const { rows: docRows } = await query(`
        INSERT INTO documents (provider_id, type, issue_date, status, file_url, uploaded_by, reference_id, question_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [providerId, 'qualificacao_evidencia', new Date().toISOString(), 'valido', fileUrl, req.user.id, instanceId, questionId]);

      // Reanálise: anexar nova evidência CONTA como resposta do prestador — sem isso
      // o critério fica 'aguardando_reanalise' (o save só reseta quando a resposta
      // muda) e o reenvio trava no submit. Reset + iteração na primeira evidência.
      if (isProvider && questionId) {
        const { rows: flipped } = await query(
          `UPDATE eval_answers SET evidence_status = 'pendente'
            WHERE instance_id = $1 AND question_id = $2 AND evidence_status = 'aguardando_reanalise'
            RETURNING id, answer_value, score_obtained`,
          [instanceId, questionId]);
        if (flipped.length) {
          const a = flipped[0];
          const { rows: [{ n }] } = await query(
            'SELECT COALESCE(MAX(iteration_number), 0) + 1 AS n FROM eval_answer_iterations WHERE answer_id = $1', [a.id]);
          await query(`
            INSERT INTO eval_answer_iterations
              (answer_id, iteration_number, actor_id, actor_role, action, answer_value, score_obtained, evidence_url, observation)
            VALUES ($1, $2, $3, 'prestador', 'respondeu', $4, $5, $6, 'Nova evidência anexada na reanálise')`,
            [a.id, n, req.user.id, a.answer_value, a.score_obtained, fileUrl]);
        }
      }

      // Mantém eval_answers.evidence_url apontando p/ o último anexo (compat com consumidores legados).
      if (questionId) {
        await query(`
          INSERT INTO eval_answers (instance_id, question_id, evidence_url, evidence_status)
          VALUES ($1, $2, $3, 'pendente')
          ON CONFLICT (instance_id, question_id) DO UPDATE SET
            evidence_url = excluded.evidence_url,
            evidence_status = 'pendente'
        `, [instanceId, questionId, fileUrl]);
      }

      res.json({ id: docRows[0].id, url: fileUrl, question_id: questionId });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Remove uma evidência específica da instância. Prestador só apaga o próprio anexo
  // e apenas enquanto a avaliação ainda não foi finalizada.
  app.delete('/api/eval/instances/:id/evidence/:docId', authenticate, async (req: any, res) => {
    try {
      const instance = await loadInstanceForWrite(req, res);
      if (!instance) return;
      if (instance.status === 'finalizado' || instance.status === 'aprovado' || instance.status === 'reprovado') {
        return res.status(400).json({ error: 'Avaliação já foi finalizada; não é possível remover evidências.' });
      }
      const { rowCount } = await query(
        `DELETE FROM documents
          WHERE id = $1 AND type = 'qualificacao_evidencia' AND reference_id = $2`,
        [req.params.docId, req.params.id],
      );
      if (rowCount === 0) return res.status(404).json({ error: 'Evidência não encontrada.' });
      res.json({ success: true });
    } catch (err: any) {
      console.error('DELETE /eval/instances/:id/evidence/:docId:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eval/dashboard', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      // Filtro opcional por ciclo (null = todos os ciclos). $1 em todas as queries.
      const cycleId = Number.isFinite(Number(req.query.cycle_id)) ? Number(req.query.cycle_id) : null;

      const { rows: totalRows } = await query(
        'SELECT COUNT(*) as count FROM eval_instances WHERE ($1::bigint IS NULL OR cycle_id = $1)', [cycleId]);
      // Qualificados = prestadores únicos com pelo menos 1 unidade finalizada com selo
      // (uma unidade não conta 3× se o prestador tem 3 unidades avaliadas).
      const { rows: approvedRows } = await query(
        "SELECT COUNT(DISTINCT provider_id) as count FROM eval_instances WHERE status IN ('finalizado','aprovado') AND seal IS NOT NULL AND ($1::bigint IS NULL OR cycle_id = $1)", [cycleId]);
      const { rows: evaluatedProvidersRows } = await query(
        'SELECT COUNT(DISTINCT provider_id)::int AS count FROM eval_instances WHERE ($1::bigint IS NULL OR cycle_id = $1)', [cycleId]);
      const { rows: avgRows } = await query(
        "SELECT AVG(percentual) as avg FROM eval_instances WHERE status IN ('finalizado','aprovado') AND ($1::bigint IS NULL OR cycle_id = $1)", [cycleId]);

      const { rows: instancesByStatus } = await query(
        "SELECT status, COUNT(*) as count FROM eval_instances WHERE ($1::bigint IS NULL OR cycle_id = $1) GROUP BY status", [cycleId]);

      const { rows: ncRows } = await query(
        `SELECT COUNT(*)::int AS count FROM eval_answers ea
           JOIN eval_instances ei ON ei.id = ea.instance_id
          WHERE ea.is_non_compliant = true AND ($1::bigint IS NULL OR ei.cycle_id = $1)`, [cycleId]);

      const { rows: sealRows } = await query(`
        SELECT COALESCE(seal, 'Não Qualificado') AS name, COUNT(*)::int AS value
        FROM eval_instances WHERE status IN ('finalizado','aprovado') AND ($1::bigint IS NULL OR cycle_id = $1)
        GROUP BY COALESCE(seal, 'Não Qualificado')
      `, [cycleId]);

      const { rows: rankingRows } = await query(`
        SELECT p.name AS provider,
               ROUND(ei.percentual)::int AS score, ei.seal,
               COALESCE(NULLIF(pl.logradouro, ''), pl.label, pl.cidade) AS location_label
        FROM eval_instances ei
        JOIN providers p ON p.id = ei.provider_id
        LEFT JOIN provider_locations pl ON pl.id = ei.location_id
        WHERE ei.status IN ('finalizado','aprovado') AND ($1::bigint IS NULL OR ei.cycle_id = $1)
        ORDER BY ei.percentual DESC
        LIMIT 10
      `, [cycleId]);

      const { rows: evoRows } = await query(`
        SELECT to_char(date_trunc('month', completed_at), 'YYYY-MM') AS name,
               ROUND(AVG(percentual))::int AS media
        FROM eval_instances
        WHERE status IN ('finalizado','aprovado') AND completed_at IS NOT NULL AND ($1::bigint IS NULL OR cycle_id = $1)
        GROUP BY 1 ORDER BY 1
      `, [cycleId]);

      // Denominador da cobertura: endereços comerciais de prestadores com roteiro (independe de ciclo).
      const { rows: netRows } = await query(`
        SELECT COUNT(*)::int AS count
          FROM provider_locations pl
          JOIN providers p ON p.id = pl.provider_id
         WHERE p.eval_script_id IS NOT NULL
           AND COALESCE(pl.label,'') NOT ILIKE 'residencial%'
           AND COALESCE(pl.sgu_location_code,'') !~ '-RES$'`);
      // Numeradores na granularidade de endereço (endereços distintos avaliados / com selo).
      const { rows: addrEvalRows } = await query(
        "SELECT COUNT(DISTINCT ei.location_id)::int AS count FROM eval_instances ei WHERE ei.location_id IS NOT NULL AND ($1::bigint IS NULL OR ei.cycle_id = $1)", [cycleId]);
      const { rows: addrQualRows } = await query(
        "SELECT COUNT(DISTINCT ei.location_id)::int AS count FROM eval_instances ei WHERE ei.location_id IS NOT NULL AND ei.seal IS NOT NULL AND ei.status IN ('finalizado','aprovado') AND ($1::bigint IS NULL OR ei.cycle_id = $1)", [cycleId]);

      // Não-conformidade por dimensão (DL consolida em Segurança).
      const { rows: dimRows } = await query(`
        SELECT CASE WHEN eq.dimension IN ('Segurança','Documento Legal') THEN 'Segurança' ELSE eq.dimension END AS dimension,
               COUNT(*) FILTER (WHERE ea.is_non_compliant)::int AS nc,
               COUNT(*)::int AS total
          FROM eval_answers ea
          JOIN eval_questions eq ON eq.id = ea.question_id
          JOIN eval_instances ei ON ei.id = ea.instance_id
         WHERE eq.dimension IS NOT NULL AND ($1::bigint IS NULL OR ei.cycle_id = $1)
         GROUP BY 1
         ORDER BY nc DESC
      `, [cycleId]);

      // Top critérios mais reprovados na rede.
      const { rows: topNcRows } = await query(`
        SELECT eq.code AS question_code, eq.text AS question_text, COUNT(*)::int AS count
          FROM eval_answers ea
          JOIN eval_questions eq ON eq.id = ea.question_id
          JOIN eval_instances ei ON ei.id = ea.instance_id
         WHERE ea.is_non_compliant AND ($1::bigint IS NULL OR ei.cycle_id = $1)
         GROUP BY eq.code, eq.text
         ORDER BY count DESC
         LIMIT 8
      `, [cycleId]);

      // Saúde dos planos de ação (reusa computePlanStatus).
      const { rows: planAggRows } = await query(`
        SELECT p.id, p.closed_without_completion,
               COALESCE(json_agg(json_build_object('status', i.status, 'due_date', i.due_date))
                        FILTER (WHERE i.id IS NOT NULL), '[]') AS items,
               EXISTS (SELECT 1 FROM eval_action_events e JOIN eval_action_items ii ON ii.id = e.item_id
                        WHERE ii.plan_id = p.id AND e.actor_role = 'prestador') AS has_provider_interaction
          FROM eval_action_plans p
          LEFT JOIN eval_action_items i ON i.plan_id = p.id
         WHERE ($1::bigint IS NULL OR p.cycle_id = $1)
         GROUP BY p.id
      `, [cycleId]);
      const { computePlanStatus } = await import('./src/lib/actionPlan.js');
      const nowDash = new Date();
      let apOpen = 0, apOverdue = 0, apConcluded = 0;
      for (const r of planAggRows as any[]) {
        const st = computePlanStatus({
          items: r.items, hasProviderInteraction: r.has_provider_interaction,
          closedWithoutCompletion: r.closed_without_completion, now: nowDash,
        });
        if (st === 'concluido') apConcluded++;
        else if (st !== 'encerrado_sem_conclusao') { apOpen++; if (st === 'atrasado') apOverdue++; }
      }

      // Engajamento na Pesquisa de Satisfação (reusa computeSurveyStats).
      const { rows: availRows } = await query(
        "SELECT COUNT(*)::int AS count FROM eval_instances WHERE submitted_at IS NOT NULL AND ($1::bigint IS NULL OR cycle_id = $1)", [cycleId]);
      const { rows: srRows } = await query(`
        SELECT sr.q1_clareza, sr.q2_portal, sr.q3_documentos, sr.q4_dificuldade,
               sr.q5_geral, sr.q6_nps, sr.within_deadline
          FROM eval_survey_responses sr
          JOIN eval_instances ei ON ei.id = sr.instance_id
         WHERE ($1::bigint IS NULL OR ei.cycle_id = $1)
      `, [cycleId]);
      const { computeSurveyStats } = await import('./src/lib/surveyStats.js');
      const sstats = computeSurveyStats(srRows as any[]);
      const surveyAvailable = (availRows[0] as any).count;
      const surveyResponded = srRows.length;
      const surveyWithinDeadline = (srRows as any[]).filter(r => r.within_deadline).length;

      // Histograma de scores das avaliações concluídas (substitui a evolução no dashboard).
      const HIST_BUCKETS = ['<60', '60–69', '70–79', '80–89', '90–100'];
      const { rows: histRows } = await query(`
        SELECT CASE
                 WHEN percentual < 60 THEN '<60'
                 WHEN percentual < 70 THEN '60–69'
                 WHEN percentual < 80 THEN '70–79'
                 WHEN percentual < 90 THEN '80–89'
                 ELSE '90–100' END AS bucket,
               COUNT(*)::int AS count
          FROM eval_instances
         WHERE status IN ('finalizado','aprovado') AND percentual IS NOT NULL
           AND ($1::bigint IS NULL OR cycle_id = $1)
         GROUP BY 1
      `, [cycleId]);
      const histMap = new Map((histRows as any[]).map(r => [r.bucket, r.count]));

      // Comparativo por ciclo (sempre todos os ciclos, independe do filtro) — observar a evolução.
      const { rows: cmpRows } = await query(`
        SELECT c.id, c.label, c.active,
               COUNT(ei.id)::int AS evaluations,
               COUNT(DISTINCT ei.location_id) FILTER (WHERE ei.location_id IS NOT NULL)::int AS addresses_evaluated,
               COUNT(DISTINCT ei.location_id) FILTER (WHERE ei.location_id IS NOT NULL AND ei.seal IS NOT NULL
                                                        AND ei.status IN ('finalizado','aprovado'))::int AS qualified,
               ROUND(AVG(ei.percentual) FILTER (WHERE ei.status IN ('finalizado','aprovado')))::int AS avg_score
          FROM eval_cycles c
          LEFT JOIN eval_instances ei ON ei.cycle_id = c.id
         GROUP BY c.id, c.label, c.active, c.start_date
         ORDER BY c.start_date, c.id
      `);

      res.json({
        total: (totalRows[0] as any).count,
        approved: (approvedRows[0] as any).count,
        providers_evaluated: (evaluatedProvidersRows[0] as any).count,
        avg_score: (avgRows[0] as any).avg || 0,
        by_status: instancesByStatus,
        non_conformities: (ncRows[0] as any).count,
        seal_distribution: sealRows,
        ranking: rankingRows,
        evolution: evoRows,
        score_histogram: HIST_BUCKETS.map(b => ({ bucket: b, count: histMap.get(b) || 0 })),
        cycles_comparison: cmpRows,
        network_total: (netRows[0] as any).count,
        addresses_evaluated: (addrEvalRows[0] as any).count,
        addresses_qualified: (addrQualRows[0] as any).count,
        by_dimension_nc: (dimRows as any[]).map(r => ({
          dimension: r.dimension, nc: r.nc, total: r.total,
          rate: r.total ? Math.round((r.nc / r.total) * 100) : 0,
        })),
        top_nc_criteria: topNcRows,
        action_plans: { open: apOpen, overdue: apOverdue, concluded: apConcluded },
        survey_engagement: {
          available: surveyAvailable,
          responded: surveyResponded,
          response_rate: surveyAvailable ? Math.round((surveyResponded / surveyAvailable) * 100) : 0,
          within_deadline_rate: surveyResponded ? Math.round((surveyWithinDeadline / surveyResponded) * 100) : 0,
          nps: sstats.nps.score,
          csat: sstats.csat.q5,
        },
      });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================================================
  // Ciclos de qualificação (eval_cycles) — Painel do Auditor (spec 5.4.2.5)
  // ==========================================================================

  const isStaff = (role: string) => role === 'admin' || role === 'auditoria';

  app.get('/api/eval/cycles', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const { rows } = await query(`
        SELECT c.id, c.label, c.start_date, c.end_date, c.active, c.cert_valid_until,
               (SELECT COUNT(*)::int FROM eval_instances ei WHERE ei.cycle_id = c.id) AS instances_count
          FROM eval_cycles c
         ORDER BY c.active DESC, c.start_date DESC, c.id DESC
      `);
      res.json(rows);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Regra 5.4.2.1: um prestador só pode ter um ciclo ativo por exercício. Como o
  // esquema mantém partial unique WHERE active=true, isso vale sistema-wide.
  // Endpoints de criação/edição não podem "desativar por baixo" o ciclo anterior —
  // a spec exige encerramento explícito. Devolvemos 409 pra que o admin decida.
  async function findConflictingActiveCycle(excludeId?: number): Promise<number | null> {
    const { rows } = await query(
      'SELECT id FROM eval_cycles WHERE active = true' + (excludeId ? ' AND id <> $1' : ''),
      excludeId ? [excludeId] : [],
    );
    return rows.length ? Number(rows[0].id) : null;
  }

  app.post('/api/eval/cycles', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const { label, start_date, end_date, active, auto_open, auto_close, cert_valid_until } = req.body || {};
      if (!label || !start_date || !end_date) {
        return res.status(400).json({ error: 'label, start_date, end_date obrigatórios' });
      }
      if (!cert_valid_until) {
        return res.status(400).json({ error: 'cert_valid_until (validade dos certificados) obrigatório' });
      }
      if (new Date(end_date) < new Date(start_date)) {
        return res.status(400).json({ error: 'end_date < start_date' });
      }
      if (active) {
        const other = await findConflictingActiveCycle();
        if (other != null) {
          return res.status(409).json({ error: 'Existe ciclo ativo — encerre-o antes de abrir um novo.', active_cycle_id: other });
        }
      }
      const { rows } = await query(
        `INSERT INTO eval_cycles (label, start_date, end_date, active, auto_open, auto_close, cert_valid_until)
         VALUES ($1, $2, $3, COALESCE($4, false), COALESCE($5, false), COALESCE($6, false), $7) RETURNING *`,
        [label, start_date, end_date, active || false, !!auto_open, !!auto_close, cert_valid_until]
      );
      res.json(rows[0]);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/eval/cycles/:id', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const id = Number(req.params.id);
      const { label, start_date, end_date, active, auto_open, auto_close, cert_valid_until } = req.body || {};
      if (active === true) {
        const other = await findConflictingActiveCycle(id);
        if (other != null) {
          return res.status(409).json({ error: 'Existe ciclo ativo — encerre-o antes de ativar este.', active_cycle_id: other });
        }
        // Ciclo encerrado com avaliações não reativa por aqui — Reabrir/Prorrogar
        // restauram as instâncias 'ciclo_encerrado'; o PATCH deixaria tudo encerrado.
        const { rows: closedInst } = await query(
          `SELECT 1 FROM eval_cycles c
            WHERE c.id = $1 AND c.active = false
              AND EXISTS (SELECT 1 FROM eval_instances i WHERE i.cycle_id = c.id AND i.status = 'ciclo_encerrado')
            LIMIT 1`, [id]);
        if (closedInst.length) {
          return res.status(409).json({ error: 'Ciclo encerrado com avaliações — use Reabrir ou Prorrogar na lista de ciclos.' });
        }
      }
      if (cert_valid_until != null) {
        // A validade dos certificados trava assim que o ciclo é aberto (tem instâncias).
        const { rows: refs } = await query('SELECT 1 FROM eval_instances WHERE cycle_id = $1 LIMIT 1', [id]);
        if (refs.length) {
          return res.status(409).json({ error: 'Ciclo já aberto — validade dos certificados não pode ser alterada.' });
        }
      }
      const { rows } = await query(
        `UPDATE eval_cycles
            SET label      = COALESCE($1, label),
                start_date = COALESCE($2, start_date),
                end_date   = COALESCE($3, end_date),
                active     = COALESCE($4, active),
                auto_open  = COALESCE($5, auto_open),
                auto_close = COALESCE($6, auto_close),
                cert_valid_until = COALESCE($8, cert_valid_until)
          WHERE id = $7 RETURNING *`,
        [label ?? null, start_date ?? null, end_date ?? null, active ?? null,
         typeof auto_open === 'boolean' ? auto_open : null,
         typeof auto_close === 'boolean' ? auto_close : null, id, cert_valid_until ?? null]
      );
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      // Ao desativar o ciclo por PATCH, garante o mesmo efeito do /encerrar:
      // instâncias não-terminais viram 'ciclo_encerrado' (viram histórico).
      if (active === false) {
        await query(
          `UPDATE eval_instances
              SET status_before_close = status,
                  status = 'ciclo_encerrado', completed_at = COALESCE(completed_at, now())
            WHERE cycle_id = $1
              AND status NOT IN ('aprovado', 'reprovado', 'finalizado', 'ciclo_encerrado')`,
          [id]
        );
        await notifyCycleClosed(id);   // B-04: avisa quem ficou sem avaliação processada
      }
      res.json(rows[0]);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/eval/cycles/:id', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const id = Number(req.params.id);
      const { rows: refs } = await query(
        'SELECT 1 FROM eval_instances WHERE cycle_id = $1 LIMIT 1', [id]
      );
      if (refs.length) return res.status(409).json({ error: 'ciclo tem instâncias vinculadas' });
      await query('DELETE FROM eval_cycles WHERE id = $1', [id]);
      res.status(204).end();
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // ==========================================================================
  // Abertura de ciclo (spec 5.4.1.2 etapa 1 + 5.4.2.1)
  // ==========================================================================

  async function buildAperturaPreview(cycleId: number) {
    const { rows: cycleRows } = await query(
      'SELECT id, label, start_date, end_date, auto_open, auto_close FROM eval_cycles WHERE id = $1', [cycleId]
    );
    if (!cycleRows.length) return { notFound: true } as const;
    const cycle = cycleRows[0];

    // Se o admin já salvou grupos manualmente pro ciclo, respeita.
    const { rows: savedGroups } = await query(
      'SELECT provider_group, script_id FROM eval_cycle_groups WHERE cycle_id = $1', [cycleId]
    );
    const source: 'saved' | 'auto' = savedGroups.length ? 'saved' : 'auto';

    // Grupos ambíguos: provider_group com mais de um eval_script_id distinct.
    const { rows: ambigRows } = await query(`
      SELECT provider_group
        FROM providers
       WHERE provider_group IS NOT NULL AND eval_script_id IS NOT NULL
       GROUP BY provider_group
      HAVING COUNT(DISTINCT eval_script_id) > 1
    `);
    const ambiguousGroups = ambigRows.map((r: any) => r.provider_group);

    // Prestadores sem grupo.
    const { rows: noGroup } = await query(`
      SELECT id, name
        FROM providers WHERE provider_group IS NULL LIMIT 50
    `);

    // Contagem de prestadores por grupo (independente da fonte — usado pra saved e auto).
    const { rows: countsAll } = await query(`
      SELECT p.provider_group, COUNT(*)::int AS providers
        FROM providers p
       WHERE p.provider_group IS NOT NULL
       GROUP BY p.provider_group
    `);
    const countsByGroup = new Map(countsAll.map((r: any) => [r.provider_group, r.providers]));

    // Detalhe por grupo (nome, script_id, script_title, providers). `saved` sobrepõe `auto`.
    // Ambíguos aparecem com script_id=null → admin vincula manualmente (grupo ou row a row).
    const groupsMap = new Map<string, { provider_group: string; script_id: number | null; script_title: string | null; providers: number; ambiguous: boolean }>();
    if (source === 'saved') {
      const { rows } = await query(`
        SELECT ecg.provider_group, ecg.script_id, s.title AS script_title
          FROM eval_cycle_groups ecg
          LEFT JOIN eval_scripts s ON s.id = ecg.script_id
         WHERE ecg.cycle_id = $1
      `, [cycleId]);
      for (const r of rows as any[]) {
        groupsMap.set(r.provider_group, {
          provider_group: r.provider_group,
          script_id: r.script_id != null ? Number(r.script_id) : null,
          script_title: r.script_title,
          providers: Number(countsByGroup.get(r.provider_group) ?? 0),
          ambiguous: ambiguousGroups.includes(r.provider_group),
        });
      }
    } else {
      const { rows } = await query(`
        SELECT p.provider_group, MIN(p.eval_script_id)::bigint AS script_id, s.title AS script_title, COUNT(*)::int AS providers
          FROM providers p
          JOIN eval_scripts s ON s.id = p.eval_script_id
         WHERE p.provider_group IS NOT NULL AND p.eval_script_id IS NOT NULL
           AND p.provider_group <> ALL($1::text[])
         GROUP BY p.provider_group, s.title
      `, [ambiguousGroups.length ? ambiguousGroups : ['__none__']]);
      for (const r of rows as any[]) {
        groupsMap.set(r.provider_group, {
          provider_group: r.provider_group,
          script_id: Number(r.script_id),
          script_title: r.script_title,
          providers: Number(r.providers),
          ambiguous: false,
        });
      }
    }
    // Quando ainda não há grupos salvos (source=auto), completa com os que ficaram
    // fora da sugestão (ambíguos ou sem eval_script_id nos providers) — assim o admin
    // enxerga TODOS os grupos e decide caso a caso. Se já é 'saved', respeita a
    // exclusão explícita (grupo que não está em eval_cycle_groups foi tirado do ciclo).
    if (source === 'auto') {
      for (const [pg, count] of countsByGroup.entries()) {
        if (groupsMap.has(pg)) continue;
        groupsMap.set(pg, {
          provider_group: pg,
          script_id: null,
          script_title: null,
          providers: Number(count),
          ambiguous: ambiguousGroups.includes(pg),
        });
      }
    }
    const groupsDetail = Array.from(groupsMap.values()).sort((a, b) => a.provider_group.localeCompare(b.provider_group));

    // Unidades no guia médico com roteiro definido — grupo direto OU override.
    // Só conta grupos com script vinculado; ambíguos sem mapa só entram via override.
    const groupList = groupsDetail.filter(g => g.script_id != null).map(g => g.provider_group);
    const { rows: instRows } = await query(`
      SELECT COUNT(*)::int AS n
        FROM provider_locations pl
        JOIN providers p ON p.id = pl.provider_id
        LEFT JOIN eval_cycle_overrides ov
          ON ov.cycle_id = $2 AND ov.provider_id = p.id AND ov.location_id = pl.id
       WHERE pl.in_medical_guide = true
         AND (p.provider_group = ANY($1::text[]) OR ov.script_id IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM eval_cycle_exclusions x
                          WHERE x.cycle_id = $2 AND x.provider_id = p.id AND x.location_id = pl.id)
    `, [groupList.length ? groupList : ['__none__'], cycleId]);

    // DL bypass — usa o roteiro EFETIVO por grupo (respeita saved). Junta providers ao script do grupo.
    // Ambíguos sem script vinculado ficam de fora do cálculo aqui (viriam via override em outro momento).
    const groupScriptPairs = groupsDetail
      .filter(g => g.script_id != null)
      .map(g => [g.provider_group, g.script_id as number]);
    const { rows: bypassRows } = groupScriptPairs.length ? await query(`
      SELECT COUNT(*)::int AS n
        FROM providers p
        JOIN (SELECT UNNEST($1::text[]) AS grp, UNNEST($2::bigint[]) AS sid) map
             ON map.grp = p.provider_group
        JOIN eval_sections sc ON sc.script_id = map.sid
        JOIN eval_questions eq ON eq.section_id = sc.id AND eq.document_type IS NOT NULL
        JOIN documents d ON d.provider_id = p.id AND d.type = eq.document_type
                        AND d.status = 'valido'
                        AND (d.expiry_date IS NULL OR d.expiry_date >= CURRENT_DATE)
    `, [groupScriptPairs.map(p => p[0]), groupScriptPairs.map(p => p[1])])
    : { rows: [{ n: 0 }] };

    // Se o ciclo já foi aberto, o mapeamento vira read-only na UI.
    const { rows: openedRows } = await query(
      'SELECT COUNT(*)::int AS n FROM eval_instances WHERE cycle_id = $1', [cycleId]
    );
    const alreadyOpened = Number(openedRows[0]?.n ?? 0) > 0;

    return {
      cycle: {
        id: Number(cycle.id), label: cycle.label,
        start_date: cycle.start_date instanceof Date ? cycle.start_date.toISOString().slice(0, 10) : String(cycle.start_date),
        end_date: cycle.end_date instanceof Date ? cycle.end_date.toISOString().slice(0, 10) : String(cycle.end_date),
        auto_open: !!cycle.auto_open,
        auto_close: !!cycle.auto_close,
      },
      source,
      already_opened: alreadyOpened,
      groups: groupsDetail,
      would_create: {
        groups: groupsDetail.filter(g => g.script_id != null).length,
        instances: instRows[0].n,
        dl_bypass: bypassRows[0].n,
      },
      excluded: {
        providers_without_group: noGroup.map((r: any) => ({ id: Number(r.id), name: r.name })),
        groups_without_script_mapping: ambiguousGroups,
      },
    };
  }

  app.get('/api/eval/cycles/:id/abertura-preview', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const preview = await buildAperturaPreview(Number(req.params.id));
      if ('notFound' in preview) return res.status(404).json({ error: 'ciclo não encontrado' });
      res.json(preview);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Retorna os script_ids de entrada que NÃO são vigentes (maior versão por
  // source_file). Roteiros sem source_file são sempre considerados vigentes.
  async function findInactiveScriptIds(scriptIds: number[]): Promise<number[]> {
    if (!scriptIds.length) return [];
    const { rows } = await query(`
      WITH candidatos AS (
        SELECT id, source_file, version FROM eval_scripts WHERE id = ANY($1::bigint[])
      ),
      max_por_source AS (
        SELECT source_file, MAX(version) AS max_version
          FROM eval_scripts WHERE source_file IS NOT NULL GROUP BY source_file
      )
      SELECT c.id
        FROM candidatos c
        LEFT JOIN max_por_source m ON m.source_file = c.source_file
       WHERE c.source_file IS NOT NULL AND c.version <> m.max_version
    `, [scriptIds]);
    return rows.map((r: any) => Number(r.id));
  }

  // Substitui a lista de grupos participantes do ciclo (spec 5.4.2.1). Só permitido
  // antes de abrir o ciclo — depois existem instâncias vinculadas ao mapeamento.
  app.put('/api/eval/cycles/:id/groups', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const cycleId = Number(req.params.id);
      const groups = Array.isArray(req.body?.groups) ? req.body.groups : null;
      if (!groups) return res.status(400).json({ error: 'body.groups (array) obrigatório' });

      const { rows: cy } = await query('SELECT id, active FROM eval_cycles WHERE id = $1', [cycleId]);
      if (!cy.length) return res.status(404).json({ error: 'ciclo não encontrado' });

      const { rows: hasInst } = await query('SELECT 1 FROM eval_instances WHERE cycle_id = $1 LIMIT 1', [cycleId]);
      if (hasInst.length) return res.status(409).json({ error: 'ciclo já foi aberto — mapeamento é imutável' });

      // Só permite grupo apontando pra roteiro vigente.
      const uniqueScriptIds = Array.from(new Set((groups as any[]).map(g => Number(g.script_id)).filter(Boolean)));
      if (uniqueScriptIds.length) {
        const inactive = await findInactiveScriptIds(uniqueScriptIds);
        if (inactive.length) return res.status(409).json({ error: `Roteiro(s) não vigente(s): ${inactive.join(', ')}` });
      }

      // Normaliza e valida. script_id null = grupo participa mas roteiro vem por override.
      const norm: Array<{ provider_group: string; script_id: number | null }> = [];
      const seen = new Set<string>();
      for (const g of groups) {
        const pg = (g.provider_group ?? '').trim();
        const rawSid = g.script_id;
        const sid = rawSid == null || rawSid === 0 || rawSid === '' ? null : Number(rawSid);
        if (!pg || (sid !== null && (!Number.isFinite(sid) || sid <= 0))) {
          return res.status(400).json({ error: `linha inválida: ${JSON.stringify(g)}` });
        }
        if (seen.has(pg)) return res.status(400).json({ error: `grupo duplicado: ${pg}` });
        seen.add(pg);
        norm.push({ provider_group: pg, script_id: sid });
      }

      await withTransaction(async (c) => {
        await c.query('DELETE FROM eval_cycle_groups WHERE cycle_id = $1', [cycleId]);
        for (const g of norm) {
          await c.query(
            'INSERT INTO eval_cycle_groups (cycle_id, provider_group, script_id) VALUES ($1, $2, $3)',
            [cycleId, g.provider_group, g.script_id]
          );
        }
        // Overrides de prestadores cujo grupo saiu da lista viram lixo — apaga.
        const kept = norm.map(g => g.provider_group);
        await c.query(
          `DELETE FROM eval_cycle_overrides
            WHERE cycle_id = $1
              AND provider_id IN (
                SELECT id FROM providers
                 WHERE provider_group IS NULL
                    OR provider_group <> ALL($2::text[])
              )`,
          [cycleId, kept.length ? kept : ['__none__']]
        );
      });

      await auditLog({
        query, userId: req.user.id, action: 'cycle_groups_updated',
        meta: { cycle_id: cycleId, count: norm.length },
        ip: hashClientIp(req),
      });
      res.json({ success: true, count: norm.length });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Detalhe por prestador × local (spec 5.4.2.1). Base para tabela editável no
  // pré-abertura: mostra roteiro efetivo (override quando existente, senão do grupo).
  app.get('/api/eval/cycles/:id/instances-preview', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const cycleId = Number(req.params.id);
      // Mapeamento efetivo grupo→roteiro: saved se existe, senão sugestão automática
      // (só grupos com relação direta: 1 único script entre os prestadores). Grupos
      // ambíguos aparecem sem default — vinculados caso a caso via override.
      const { rows } = await query(`
        WITH eff_groups AS (
          -- Fonte 1: mapeamento salvo (source='saved')
          SELECT provider_group, script_id FROM eval_cycle_groups WHERE cycle_id = $1
          UNION ALL
          -- Fonte 2: se nada salvo (source='auto'), inclui TODOS os grupos existentes.
          -- Grupo com 1 único script entre os prestadores → script sugerido.
          -- Ambíguo ou sem script → script_id NULL (prestadores aparecem pra decidir caso a caso).
          SELECT p.provider_group,
                 CASE WHEN COUNT(DISTINCT p.eval_script_id) FILTER (WHERE p.eval_script_id IS NOT NULL) = 1
                      THEN MAX(p.eval_script_id)::bigint
                      ELSE NULL::bigint
                 END AS script_id
            FROM providers p
           WHERE p.provider_group IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM eval_cycle_groups WHERE cycle_id = $1)
           GROUP BY p.provider_group
        )
        SELECT p.id AS provider_id,
               p.name AS provider_name,
               p.sgu_code AS provider_code,
               p.provider_group,
               pl.id AS location_id,
               COALESCE(NULLIF(pl.logradouro, ''), pl.label, pl.cidade) AS location_label,
               pl.cidade AS city,
               g.script_id AS default_script_id,
               s_default.title AS default_script_title,
               ov.script_id AS override_script_id,
               s_override.title AS override_script_title,
               x.id AS excluded_id,
               x.reason AS excluded_reason,
               ux.name AS excluded_by,
               x.created_at AS excluded_at
          FROM provider_locations pl
          JOIN providers p ON p.id = pl.provider_id
          LEFT JOIN eff_groups g ON g.provider_group = p.provider_group
          LEFT JOIN eval_scripts s_default ON s_default.id = g.script_id
          LEFT JOIN eval_cycle_overrides ov ON ov.cycle_id = $1 AND ov.provider_id = p.id AND ov.location_id = pl.id
          LEFT JOIN eval_scripts s_override ON s_override.id = ov.script_id
          LEFT JOIN eval_cycle_exclusions x ON x.cycle_id = $1 AND x.provider_id = p.id AND x.location_id = pl.id
          LEFT JOIN users ux ON ux.id = x.created_by
         WHERE pl.in_medical_guide = true
           AND p.provider_group IS NOT NULL
           -- Só mostra prestadores de grupos participantes (na eff_groups) OU com override
           -- explícito. Grupo excluído do ciclo → prestadores somem da tabela.
           AND (g.provider_group IS NOT NULL OR ov.provider_id IS NOT NULL)
         ORDER BY p.provider_group NULLS LAST, provider_name, pl.id
      `, [cycleId]);
      res.json({ rows });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Substitui overrides do ciclo (batch). Só permitido antes de abrir.
  app.put('/api/eval/cycles/:id/overrides', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const cycleId = Number(req.params.id);
      const overrides = Array.isArray(req.body?.overrides) ? req.body.overrides : null;
      if (!overrides) return res.status(400).json({ error: 'body.overrides (array) obrigatório' });

      const { rows: hasInst } = await query('SELECT 1 FROM eval_instances WHERE cycle_id = $1 LIMIT 1', [cycleId]);
      if (hasInst.length) return res.status(409).json({ error: 'ciclo já foi aberto — overrides são imutáveis' });

      // Só permite override apontando pra roteiro vigente (maior versão por source_file).
      const uniqueScriptIds = Array.from(new Set((overrides as any[]).map(o => Number(o.script_id)).filter(Boolean)));
      if (uniqueScriptIds.length) {
        const inactive = await findInactiveScriptIds(uniqueScriptIds);
        if (inactive.length) return res.status(409).json({ error: `Roteiro(s) não vigente(s): ${inactive.join(', ')}` });
      }

      const norm: Array<{ provider_id: number; location_id: number; script_id: number }> = [];
      const seen = new Set<string>();
      for (const o of overrides) {
        const pid = Number(o.provider_id), lid = Number(o.location_id), sid = Number(o.script_id);
        if (!Number.isFinite(pid) || !Number.isFinite(lid) || !Number.isFinite(sid)) {
          return res.status(400).json({ error: `linha inválida: ${JSON.stringify(o)}` });
        }
        const key = `${pid}:${lid}`;
        if (seen.has(key)) return res.status(400).json({ error: `override duplicado: ${key}` });
        seen.add(key);
        norm.push({ provider_id: pid, location_id: lid, script_id: sid });
      }

      await withTransaction(async (c) => {
        await c.query('DELETE FROM eval_cycle_overrides WHERE cycle_id = $1', [cycleId]);
        for (const o of norm) {
          await c.query(
            'INSERT INTO eval_cycle_overrides (cycle_id, provider_id, location_id, script_id) VALUES ($1, $2, $3, $4)',
            [cycleId, o.provider_id, o.location_id, o.script_id]
          );
        }
      });

      await auditLog({
        query, userId: req.user.id, action: 'cycle_overrides_updated',
        meta: { cycle_id: cycleId, count: norm.length },
        ip: hashClientIp(req),
      });
      res.json({ success: true, count: norm.length });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Exclui um prestador×local do ciclo com motivo (dupla checagem, spec 2026-09-11).
  // Só antes de abrir — depois o conjunto de instâncias é imutável.
  app.post('/api/eval/cycles/:id/exclusions', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const cycleId = Number(req.params.id);
      const providerId = Number(req.body?.provider_id);
      const locationId = Number(req.body?.location_id);
      const reason = String(req.body?.reason ?? '').trim();
      if (!Number.isFinite(providerId) || !Number.isFinite(locationId) || !reason) {
        return res.status(400).json({ error: 'provider_id, location_id e reason são obrigatórios' });
      }
      const { rows: cy } = await query('SELECT 1 FROM eval_cycles WHERE id = $1', [cycleId]);
      if (!cy.length) return res.status(404).json({ error: 'ciclo não encontrado' });
      const { rows: hasInst } = await query('SELECT 1 FROM eval_instances WHERE cycle_id = $1 LIMIT 1', [cycleId]);
      if (hasInst.length) return res.status(409).json({ error: 'ciclo já foi aberto — exclusões são imutáveis' });

      const { rows } = await query(
        `INSERT INTO eval_cycle_exclusions (cycle_id, provider_id, location_id, reason, created_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (cycle_id, provider_id, location_id)
         DO UPDATE SET reason = EXCLUDED.reason, created_by = EXCLUDED.created_by, created_at = now()
         RETURNING id`,
        [cycleId, providerId, locationId, reason, req.user.id]
      );
      await auditLog({
        query, userId: req.user.id, action: 'cycle_exclusion_added',
        meta: { cycle_id: cycleId, provider_id: providerId, location_id: locationId, reason },
        ip: hashClientIp(req),
      });
      res.json({ success: true, id: Number(rows[0].id) });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Reinclui (desfaz a exclusão). Só antes de abrir.
  app.delete('/api/eval/cycles/:id/exclusions/:exclusionId', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const cycleId = Number(req.params.id);
      const exclusionId = Number(req.params.exclusionId);
      const { rows: hasInst } = await query('SELECT 1 FROM eval_instances WHERE cycle_id = $1 LIMIT 1', [cycleId]);
      if (hasInst.length) return res.status(409).json({ error: 'ciclo já foi aberto — exclusões são imutáveis' });

      const { rows } = await query(
        'DELETE FROM eval_cycle_exclusions WHERE id = $1 AND cycle_id = $2 RETURNING provider_id, location_id',
        [exclusionId, cycleId]
      );
      if (!rows.length) return res.status(404).json({ error: 'exclusão não encontrada' });
      await auditLog({
        query, userId: req.user.id, action: 'cycle_exclusion_removed',
        meta: { cycle_id: cycleId, provider_id: Number(rows[0].provider_id), location_id: Number(rows[0].location_id) },
        ip: hashClientIp(req),
      });
      res.json({ success: true });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // === Inclusão avulsa no ciclo aberto (spec 2026-09-15) — espelho das exclusões ===
  // Fila derivada: pares prestador×unidade comercial no guia médico SEM instância no
  // ciclo e não excluídos, com roteiro resolvido pela cascata override → grupo do
  // ciclo → match da carga (providers.eval_script_id). NULL = "pendente de roteiro".
  app.get('/api/eval/cycles/:id/inclusion-candidates', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const cycleId = Number(req.params.id);
      const { rows } = await query(`
        SELECT p.id AS provider_id, p.name AS provider_name, p.sgu_code AS provider_code,
               p.provider_group,
               pl.id AS location_id,
               COALESCE(NULLIF(pl.logradouro, ''), pl.label, pl.cidade) AS location_label,
               pl.cidade AS city,
               COALESCE(ov.script_id, ecg.script_id, p.eval_script_id) AS resolved_script_id,
               s.title AS resolved_script_title
          FROM provider_locations pl
          JOIN providers p ON p.id = pl.provider_id
          LEFT JOIN eval_cycle_groups ecg ON ecg.cycle_id = $1 AND ecg.provider_group = p.provider_group
          LEFT JOIN eval_cycle_overrides ov ON ov.cycle_id = $1 AND ov.provider_id = p.id AND ov.location_id = pl.id
          LEFT JOIN eval_scripts s ON s.id = COALESCE(ov.script_id, ecg.script_id, p.eval_script_id)
         WHERE pl.in_medical_guide = true
           AND NOT EXISTS (SELECT 1 FROM eval_instances ei
                            WHERE ei.cycle_id = $1 AND ei.provider_id = p.id AND ei.location_id = pl.id)
           AND NOT EXISTS (SELECT 1 FROM eval_cycle_exclusions x
                            WHERE x.cycle_id = $1 AND x.provider_id = p.id AND x.location_id = pl.id)
         ORDER BY p.name, pl.id
      `, [cycleId]);
      res.json({ rows });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Atos de inclusão do ciclo (lista "Incluídos").
  app.get('/api/eval/cycles/:id/inclusions', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const { rows } = await query(`
        SELECT i.id, i.provider_id, i.location_id, i.instance_id, i.reason, i.created_at,
               p.name AS provider_name, p.sgu_code AS provider_code,
               COALESCE(NULLIF(pl.logradouro, ''), pl.label, pl.cidade) AS location_label,
               u.name AS created_by_name,
               s.title AS script_title
          FROM eval_cycle_inclusions i
          JOIN providers p ON p.id = i.provider_id
          JOIN provider_locations pl ON pl.id = i.location_id
          LEFT JOIN users u ON u.id = i.created_by
          LEFT JOIN eval_instances ei ON ei.id = i.instance_id
          LEFT JOIN eval_scripts s ON s.id = ei.script_id
         WHERE i.cycle_id = $1
         ORDER BY i.created_at DESC
      `, [Number(req.params.id)]);
      res.json({ rows });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Inclui um prestador×local num ciclo JÁ ABERTO: cria a instância com o roteiro da
  // cascata (body.script_id só cobre o caso "pendente de roteiro"), roda o DL bypass
  // e registra o ato com motivo. Só admin (proposta da spec; auditoria só visualiza).
  app.post('/api/eval/cycles/:id/inclusions', authenticate, async (req: any, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores.' });
      const cycleId = Number(req.params.id);
      const providerId = Number(req.body?.provider_id);
      const locationId = Number(req.body?.location_id);
      const reason = String(req.body?.reason ?? '').trim();
      if (!Number.isFinite(providerId) || !Number.isFinite(locationId) || !reason) {
        return res.status(400).json({ error: 'provider_id, location_id e reason são obrigatórios' });
      }
      const { rows: cy } = await query('SELECT id, label, active, end_date FROM eval_cycles WHERE id = $1', [cycleId]);
      if (!cy.length) return res.status(404).json({ error: 'ciclo não encontrado' });
      if (!cy[0].active) return res.status(400).json({ error: 'ciclo não está ativo' });
      const { rows: opened } = await query('SELECT 1 FROM eval_instances WHERE cycle_id = $1 LIMIT 1', [cycleId]);
      if (!opened.length) return res.status(409).json({ error: 'ciclo ainda não foi aberto — inclua pela abertura' });

      const { rows: pair } = await query(`
        SELECT pl.in_medical_guide,
               COALESCE(ov.script_id, ecg.script_id, p.eval_script_id) AS resolved_script_id,
               EXISTS (SELECT 1 FROM eval_instances ei
                        WHERE ei.cycle_id = $1 AND ei.provider_id = p.id AND ei.location_id = pl.id) AS has_instance,
               EXISTS (SELECT 1 FROM eval_cycle_exclusions x
                        WHERE x.cycle_id = $1 AND x.provider_id = p.id AND x.location_id = pl.id) AS is_excluded
          FROM provider_locations pl
          JOIN providers p ON p.id = pl.provider_id
          LEFT JOIN eval_cycle_groups ecg ON ecg.cycle_id = $1 AND ecg.provider_group = p.provider_group
          LEFT JOIN eval_cycle_overrides ov ON ov.cycle_id = $1 AND ov.provider_id = p.id AND ov.location_id = pl.id
         WHERE p.id = $2 AND pl.id = $3
      `, [cycleId, providerId, locationId]);
      if (!pair.length) return res.status(404).json({ error: 'prestador/unidade não encontrado' });
      if (!pair[0].in_medical_guide) return res.status(400).json({ error: 'unidade fora do guia médico' });
      if (pair[0].has_instance) return res.status(409).json({ error: 'par já tem avaliação neste ciclo' });
      if (pair[0].is_excluded) return res.status(409).json({ error: 'par foi excluído na abertura do ciclo' });

      // Cascata: override → grupo do ciclo → match da carga → script_id manual do body.
      let scriptId = pair[0].resolved_script_id != null ? Number(pair[0].resolved_script_id) : null;
      if (scriptId == null && req.body?.script_id) {
        const manual = Number(req.body.script_id);
        const inactive = await findInactiveScriptIds([manual]);
        if (inactive.length) return res.status(409).json({ error: `Roteiro não vigente: ${manual}` });
        scriptId = manual;
      }
      if (scriptId == null) {
        return res.status(422).json({ error: 'sem roteiro resolvido — informe script_id' });
      }

      const result = await withTransaction(async (c) => {
        const { rows: inst } = await c.query(
          `INSERT INTO eval_instances (script_id, provider_id, location_id, status, cycle_id, started_at)
           VALUES ($1, $2, $3, 'pendente', $4, now()) RETURNING id`,
          [scriptId, providerId, locationId, cycleId]);
        const instanceId = Number(inst[0].id);

        // DL bypass — mesma regra da abertura, restrita à instância criada.
        const { rows: bypass } = await c.query(`
          INSERT INTO eval_answers (instance_id, question_id, answer_value, score_obtained,
                                    evidence_url, evidence_status, auditor_observation, is_non_compliant)
          SELECT ei.id, eq.id, 'sim', eq.max_score, d.file_url, 'aprovado',
                 'Aprovado via cadastro (DL bypass)', false
            FROM eval_instances ei
            JOIN eval_sections sc ON sc.script_id = ei.script_id
            JOIN eval_questions eq ON eq.section_id = sc.id AND eq.document_type IS NOT NULL
            JOIN LATERAL (
              SELECT file_url FROM documents
               WHERE provider_id = ei.provider_id AND type = eq.document_type
                 AND status = 'valido'
                 AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
               ORDER BY issue_date DESC NULLS LAST LIMIT 1
            ) d ON true
           WHERE ei.id = $1
          RETURNING id, score_obtained, evidence_url
        `, [instanceId]);
        for (const a of bypass) {
          await c.query(
            `INSERT INTO eval_answer_iterations
             (answer_id, iteration_number, actor_id, actor_role, action, answer_value, score_obtained, evidence_url, observation)
             VALUES ($1, 1, NULL, 'auditor', 'aprovou', 'sim', $2, $3, 'Aprovado via cadastro (DL bypass)')`,
            [a.id, a.score_obtained, a.evidence_url]);
        }

        const { rows: incl } = await c.query(
          `INSERT INTO eval_cycle_inclusions (cycle_id, provider_id, location_id, instance_id, reason, created_by)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [cycleId, providerId, locationId, instanceId, reason, req.user.id]);
        return { instanceId, inclusionId: Number(incl[0].id), dlBypass: bypass.length };
      });

      await auditLog({
        query, userId: req.user.id, action: 'cycle_inclusion_added',
        meta: { cycle_id: cycleId, provider_id: providerId, location_id: locationId, instance_id: result.instanceId, reason },
        ip: hashClientIp(req),
      });
      void (async () => {
        await notifyEvent('ciclo_aberto', { cycle_label: cy[0].label, end_date: cy[0].end_date, has_manual: await providerHasManual(providerId, cycleId) },
          await prestadorRecipients(providerId, locationId), { providerId });
      })().catch((e) => console.error('[notify] inclusão avulsa:', e));

      res.json({ success: true, ...result });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Executa a abertura de um ciclo (mesma lógica do endpoint /abrir). Retorna
  // { ok, code, error?, created? } — reutilizada tanto pelo POST manual quanto pelo
  // job automático (5.4.1.1 abertura em data definida).
  async function openCycleCore(cycleId: number): Promise<{ ok: boolean; code?: number; error?: string; created?: { groups: number; instances: number; dl_bypass: number } }> {
    const { rows: cy } = await query('SELECT id, label, active, end_date FROM eval_cycles WHERE id = $1', [cycleId]);
    if (!cy.length) return { ok: false, code: 404, error: 'ciclo não encontrado' };
    if (!cy[0].active) return { ok: false, code: 400, error: 'ciclo não está ativo' };
    const { rows: existInst } = await query('SELECT 1 FROM eval_instances WHERE cycle_id = $1 LIMIT 1', [cycleId]);
    if (existInst.length) return { ok: false, code: 409, error: 'ciclo já tem instâncias' };

    let cycleProviderIds: number[] = [];
    const created = await withTransaction(async (client) => {
        // 1. Popula eval_cycle_groups — SÓ SE ainda não houver mapeamento salvo pro ciclo.
        //    Se o admin gravou via PUT /cycles/:id/groups, respeita e não sobrescreve.
        const { rows: existGroups } = await client.query(
          'SELECT id, provider_group, script_id FROM eval_cycle_groups WHERE cycle_id = $1', [cycleId]
        );
        const groups = existGroups.length ? existGroups : (await client.query(`
          INSERT INTO eval_cycle_groups (cycle_id, provider_group, script_id)
          SELECT $1, p.provider_group, MIN(p.eval_script_id)::bigint
            FROM providers p
           WHERE p.provider_group IS NOT NULL AND p.eval_script_id IS NOT NULL
             AND p.provider_group NOT IN (
               SELECT provider_group FROM providers
                WHERE provider_group IS NOT NULL AND eval_script_id IS NOT NULL
                GROUP BY provider_group HAVING COUNT(DISTINCT eval_script_id) > 1
             )
           GROUP BY p.provider_group
          RETURNING id, provider_group, script_id
        `, [cycleId])).rows;

        // 2. Cria eval_instances (1 por unidade no guia médico cujo grupo caiu no ciclo).
        //    Roteiro: override por prestador×local quando existente, senão o do grupo.
        //    Prestadores de grupos ambíguos (sem eval_cycle_groups) só entram via override.
        const { rows: instances } = await client.query(`
          INSERT INTO eval_instances (script_id, provider_id, location_id, status, cycle_id, started_at)
          SELECT COALESCE(ov.script_id, ecg.script_id), p.id, pl.id, 'pendente', $1, now()
            FROM provider_locations pl
            JOIN providers p ON p.id = pl.provider_id
            LEFT JOIN eval_cycle_groups ecg ON ecg.cycle_id = $1 AND ecg.provider_group = p.provider_group
            LEFT JOIN eval_cycle_overrides ov
              ON ov.cycle_id = $1 AND ov.provider_id = p.id AND ov.location_id = pl.id
           WHERE pl.in_medical_guide = true
             AND COALESCE(ov.script_id, ecg.script_id) IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM eval_cycle_exclusions x
                              WHERE x.cycle_id = $1 AND x.provider_id = p.id AND x.location_id = pl.id)
          RETURNING id, provider_id, script_id
        `, [cycleId]);
        cycleProviderIds = [...new Set(instances.map((r: any) => Number(r.provider_id)))];

        // 3. DL bypass em lote — para cada instância, cria answer 'aprovado' para os critérios DL
        //    que têm documento válido no cadastro do prestador.
        //    Uma passada de INSERT ... SELECT.
        const { rows: bypassAnswers } = await client.query(`
          INSERT INTO eval_answers (instance_id, question_id, answer_value, score_obtained,
                                    evidence_url, evidence_status, auditor_observation, is_non_compliant)
          SELECT ei.id, eq.id, 'sim', eq.max_score, d.file_url, 'aprovado',
                 'Aprovado via cadastro (DL bypass)', false
            FROM eval_instances ei
            JOIN eval_sections sc ON sc.script_id = ei.script_id
            JOIN eval_questions eq ON eq.section_id = sc.id AND eq.document_type IS NOT NULL
            JOIN LATERAL (
              SELECT file_url FROM documents
               WHERE provider_id = ei.provider_id AND type = eq.document_type
                 AND status = 'valido'
                 AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
               ORDER BY issue_date DESC NULLS LAST LIMIT 1
            ) d ON true
           WHERE ei.cycle_id = $1
          RETURNING id, instance_id, question_id, score_obtained, evidence_url
        `, [cycleId]);

        // 3.1. Registra iteration 1 (action='aprovou', actor=sistema/NULL) para cada bypass.
        //      5 valores por linha (answer_id, answer_value, score, evidence_url, observation);
        //      iteration_number=1, actor_id=NULL, actor_role='auditor', action='aprovou' são literais.
        if (bypassAnswers.length) {
          const placeholders = bypassAnswers.map((_, i) => {
            const b = i * 5;
            return `($${b+1}, 1, NULL, 'auditor', 'aprovou', $${b+2}, $${b+3}, $${b+4}, $${b+5})`;
          }).join(',');
          const params: any[] = [];
          for (const a of bypassAnswers) {
            params.push(a.id, 'sim', a.score_obtained, a.evidence_url, 'Aprovado via cadastro (DL bypass)');
          }
          await client.query(
            `INSERT INTO eval_answer_iterations
             (answer_id, iteration_number, actor_id, actor_role, action, answer_value, score_obtained, evidence_url, observation)
             VALUES ${placeholders}`,
            params
          );
        }

        return { groups: groups.length, instances: instances.length, dl_bypass: bypassAnswers.length };
      });

      // Notifica os prestadores do ciclo (fire-and-forget; não atrasa a resposta).
      void (async () => {
        for (const pid of cycleProviderIds) {
          await notifyEvent('ciclo_aberto', { cycle_label: cy[0].label, end_date: cy[0].end_date, has_manual: await providerHasManual(pid, cycleId) },
            await prestadorRecipients(pid), { providerId: pid });
        }
      })();

      return { ok: true, created };
  }

  app.post('/api/eval/cycles/:id/abrir', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const cycleId = Number(req.params.id);

      // "Confirmar abertura" ativa o ciclo no mesmo passo. Se estiver inativo e não
      // houver conflito (regra 1-ativo, spec 5.4.2.1), ativa antes de abrir. Se já
      // existe outro ativo, devolve mensagem clara em vez do genérico 'não está ativo'.
      const { rows: cy } = await query('SELECT active FROM eval_cycles WHERE id = $1', [cycleId]);
      if (!cy.length) return res.status(404).json({ error: 'ciclo não encontrado' });
      if (!cy[0].active) {
        const other = await findConflictingActiveCycle(cycleId);
        if (other != null) {
          return res.status(409).json({ error: 'Existe outro ciclo ativo — encerre-o antes de abrir este.', active_cycle_id: other });
        }
        await query('UPDATE eval_cycles SET active = true WHERE id = $1', [cycleId]);
      }

      const result = await openCycleCore(cycleId);
      if (!result.ok) return res.status(result.code || 500).json({ error: result.error });

      await auditLog({
        query, userId: req.user.id, action: 'cycle_opened',
        meta: { cycle_id: cycleId, ...result.created },
        ip: hashClientIp(req),
      });
      res.json({ cycle_id: cycleId, created: result.created });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Encerra o ciclo (spec 5.4.2.1). Por padrão barra se houver instâncias inconclusivas
  // — só terminais (aprovado/reprovado/finalizado) contam como fechadas. Com {force:true}
  // encerra mesmo assim e registra quantas ficaram órfãs no auditLog.
  app.post('/api/eval/cycles/:id/encerrar', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const cycleId = Number(req.params.id);
      const force = !!req.body?.force;

      const result = await closeCycleCore(cycleId, force);
      if (!result.ok) return res.status(result.code || 500).json({ error: result.error, inconclusive: result.inconclusive });

      await auditLog({
        query, userId: req.user.id, action: 'cycle_closed',
        meta: { cycle_id: cycleId, forced: force, inconclusive: result.inconclusive },
        ip: hashClientIp(req),
      });
      res.json({ success: true, cycle_id: cycleId, inconclusive: result.inconclusive });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Estados em que o prestador ainda precisa agir (= EDITABLE_STATES da PrestadorView).
  const REOPEN_NOTIFY_STATES = ['pendente', 'em_andamento', 'aguardando_evidencia'];

  // Reabre/prorroga um ciclo encerrado (spec 2026-09-11). body.end_date = prorrogação.
  app.post('/api/eval/cycles/:id/reabrir', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const cycleId = Number(req.params.id);
      const rawEnd = req.body?.end_date;
      const newEndDate = rawEnd ? String(rawEnd).slice(0, 10) : null;
      if (newEndDate && !/^\d{4}-\d{2}-\d{2}$/.test(newEndDate)) {
        return res.status(400).json({ error: 'end_date inválida (use YYYY-MM-DD)' });
      }

      const result = await reopenCycleCore(cycleId, newEndDate);
      if (!result.ok) return res.status(result.code || 500).json({ error: result.error });

      await auditLog({
        query, userId: req.user.id, action: 'cycle_reopened',
        meta: { cycle_id: cycleId, restored: result.restored, end_date: result.endDate, prorrogado: !!newEndDate },
        ip: hashClientIp(req),
      });
      // Avisa os prestadores restaurados (fire-and-forget; dedupe por instância).
      void (async () => {
        // Só quem ainda tem o roteiro em aberto (não enviado) — pedido do cliente, 2026-09-24.
        // Instância restaurada em análise já foi enviada: prorrogação não muda nada para ela.
        for (const inst of (result.reopened ?? []).filter(i => REOPEN_NOTIFY_STATES.includes(i.status))) {
          await notifyEvent('ciclo_reaberto', { cycle_label: result.label, end_date: result.endDate, prorrogado: !!newEndDate },
            await prestadorRecipients(inst.provider_id, inst.location_id),
            { providerId: inst.provider_id, dedupeRef: `reopen:${inst.id}:${result.endDate}` });
        }
      })();
      res.json({ success: true, cycle_id: cycleId, restored: result.restored, end_date: result.endDate });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  async function closeCycleCore(cycleId: number, force: boolean): Promise<{ ok: boolean; code?: number; error?: string; inconclusive: number }> {
    const { rows: cy } = await query('SELECT id, label, active FROM eval_cycles WHERE id = $1', [cycleId]);
    if (!cy.length) return { ok: false, code: 404, error: 'ciclo não encontrado', inconclusive: 0 };
    if (!cy[0].active) return { ok: false, code: 409, error: 'ciclo já está encerrado', inconclusive: 0 };

    const { rows: pending } = await query(
      `SELECT COUNT(*)::int AS n FROM eval_instances
        WHERE cycle_id = $1 AND status NOT IN ('aprovado', 'reprovado', 'finalizado')`,
      [cycleId]
    );
    const inconclusive = Number(pending[0]?.n ?? 0);
    if (inconclusive > 0 && !force) {
      return { ok: false, code: 409, error: `${inconclusive} instância(s) ainda em andamento — informe force:true para encerrar mesmo assim`, inconclusive };
    }
    await withTransaction(async (c) => {
      // Instâncias não-terminais vão pro 'ciclo_encerrado' — viram histórico do
      // prestador (spec: quando o ciclo fecha, avaliações inconclusas ficam
      // registradas com esse marcador em vez de sumir).
      await c.query(
        `UPDATE eval_instances
            SET status_before_close = status,
                status = 'ciclo_encerrado', completed_at = COALESCE(completed_at, now())
          WHERE cycle_id = $1
            AND status NOT IN ('aprovado', 'reprovado', 'finalizado')`,
        [cycleId]
      );
      await c.query('UPDATE eval_cycles SET active = false WHERE id = $1', [cycleId]);

      // Planos com itens abertos viram 'encerrado sem conclusão' (spec 5.4.4.4/5.4.4.7)
      await c.query(`
        UPDATE eval_action_plans p
           SET closed_without_completion = true
         WHERE p.cycle_id = $1
           AND NOT p.closed_without_completion
           AND EXISTS (SELECT 1 FROM eval_action_items i
                        WHERE i.plan_id = p.id AND i.status <> 'concluida')
      `, [cycleId]);
    });
    await notifyCycleClosed(cycleId);
    return { ok: true, inconclusive };
  }

  // Notifica cada prestador cuja instância terminou em 'ciclo_encerrado' (sem parecer
  // emitido) que o ciclo encerrou sem avaliação processada (B-04). Dedupe por instância.
  async function notifyCycleClosed(cycleId: number) {
    const { rows } = await query(`
      SELECT ei.id, ei.provider_id, ei.location_id, c.label
        FROM eval_instances ei
        JOIN eval_cycles c ON c.id = ei.cycle_id
       WHERE ei.cycle_id = $1 AND ei.status = 'ciclo_encerrado'
         -- Só quem não tinha enviado o roteiro (pedido do cliente, 2026-09-24): em análise no
         -- encerramento já foi entregue, não é "avaliação não concluída".
         AND ei.status_before_close = ANY($2::text[])`, [cycleId, REOPEN_NOTIFY_STATES]);
    for (const inst of rows) {
      await notifyEvent('ciclo_encerrado_sem_avaliacao', { cycle_label: inst.label },
        await prestadorRecipients(Number(inst.provider_id), inst.location_id ?? null),
        { providerId: Number(inst.provider_id), dedupeRef: `close:${inst.id}` });
    }
  }

  // Reabre um ciclo encerrado (spec 2026-09-11): reativa e restaura as instâncias
  // 'ciclo_encerrado' ao status anterior. newEndDate presente = prorrogação.
  async function reopenCycleCore(cycleId: number, newEndDate: string | null): Promise<{ ok: boolean; code?: number; error?: string; restored?: number; endDate?: string; label?: string; reopened?: Array<{ id: number; provider_id: number; location_id: number | null; status: string }> }> {
    const { rows: cy } = await query('SELECT id, label, active, start_date, end_date FROM eval_cycles WHERE id = $1', [cycleId]);
    if (!cy.length) return { ok: false, code: 404, error: 'ciclo não encontrado' };
    if (cy[0].active) return { ok: false, code: 409, error: 'ciclo já está ativo — para prorrogar, edite a data fim' };
    const other = await findConflictingActiveCycle(cycleId);
    if (other != null) return { ok: false, code: 409, error: 'Existe outro ciclo ativo — encerre-o antes de reabrir este.' };

    const toISO = (v: any) => v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
    const effectiveEnd = newEndDate ?? toISO(cy[0].end_date);
    const today = new Date().toISOString().slice(0, 10);
    if (effectiveEnd < today) {
      return { ok: false, code: 409, error: 'O prazo do ciclo está no passado — informe uma nova data fim (prorrogação).' };
    }
    if (newEndDate && newEndDate < toISO(cy[0].start_date)) {
      return { ok: false, code: 400, error: 'A nova data fim não pode ser anterior ao início do ciclo.' };
    }

    let reopened: Array<{ id: number; provider_id: number; location_id: number | null; status: string }> = [];
    await withTransaction(async (c) => {
      await c.query('UPDATE eval_cycles SET active = true, end_date = COALESCE($2, end_date) WHERE id = $1', [cycleId, newEndDate]);
      const { rows } = await c.query(`
        UPDATE eval_instances ei
           SET status = COALESCE(ei.status_before_close,
                 CASE WHEN EXISTS (
                        SELECT 1 FROM eval_answers a
                          JOIN eval_answer_iterations it ON it.answer_id = a.id
                         WHERE a.instance_id = ei.id AND it.actor_role = 'prestador')
                      THEN 'em_andamento' ELSE 'pendente' END),
               status_before_close = NULL,
               completed_at = NULL
         WHERE ei.cycle_id = $1 AND ei.status = 'ciclo_encerrado'
         RETURNING ei.id, ei.provider_id, ei.location_id, ei.status`, [cycleId]);
      reopened = rows.map((r: any) => ({ id: Number(r.id), provider_id: Number(r.provider_id), location_id: r.location_id ?? null, status: String(r.status) }));

      // Espelho do closeCycleCore: planos marcados 'encerrado sem conclusão' pelo
      // encerramento deste ciclo voltam ao acompanhamento normal.
      await c.query(`
        UPDATE eval_action_plans p
           SET closed_without_completion = false
         WHERE p.cycle_id = $1
           AND p.closed_without_completion
           AND EXISTS (SELECT 1 FROM eval_action_items i
                        WHERE i.plan_id = p.id AND i.status <> 'concluida')
      `, [cycleId]);
    });

    return { ok: true, restored: reopened.length, endDate: effectiveEnd, label: cy[0].label, reopened };
  }

  // Fim do ciclo da instância = prazo máximo de resposta (envio do roteiro / reenvio
  // de reanálise). null se a instância não tiver ciclo. Usado nas notificações (E-03).
  async function instanceCycleEnd(instanceId: number): Promise<string | null> {
    const { rows } = await query(
      `SELECT c.end_date FROM eval_instances ei JOIN eval_cycles c ON c.id = ei.cycle_id WHERE ei.id = $1`,
      [instanceId]);
    return rows[0]?.end_date ?? null;
  }

  // ==========================================================================
  // Ações do auditor por critério (spec 5.4.1.2 etapa 4)
  // ==========================================================================

  async function loadAnswerForAuditor(answerId: number) {
    const { rows } = await query(`
      SELECT ea.id, ea.instance_id, ea.question_id, ea.answer_value, ea.score_obtained,
             ea.evidence_url, ea.evidence_status,
             ei.status AS instance_status, ei.provider_id, ei.location_id
        FROM eval_answers ea
        JOIN eval_instances ei ON ei.id = ea.instance_id
       WHERE ea.id = $1
    `, [answerId]);
    return rows[0] || null;
  }

  async function nextIterationNumber(client: any, answerId: number) {
    const { rows } = await client.query(
      'SELECT COALESCE(MAX(iteration_number), 0) + 1 AS n FROM eval_answer_iterations WHERE answer_id = $1',
      [answerId]
    );
    return Number(rows[0].n);
  }

  async function auditorAction(
    req: any, res: any,
    action: 'aprovou' | 'reprovou' | 'solicitou_reanalise' | 'marcou_na',
    observationRequired: boolean
  ) {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const answerId = Number(req.params.id);
      const observation = (req.body?.observation ?? '').trim();
      const ans = await loadAnswerForAuditor(answerId);
      if (!ans) return res.status(404).json({ error: 'answer not found' });
      if (!['em_analise', 'aguardando_evidencia'].includes(ans.instance_status)) {
        return res.status(409).json({ error: `instância em status ${ans.instance_status}, não aceita ação` });
      }
      // Critério em reanálise: a bola está com o prestador — aprovar/N.A. burlaria o
      // fluxo. REPROVAR é permitido (spec 2026-09-11): resposta válida, score 0, e
      // destrava o parecer quando o prestador não responde.
      if (ans.evidence_status === 'aguardando_reanalise' && !['solicitou_reanalise', 'reprovou'].includes(action)) {
        return res.status(409).json({ error: 'critério aguardando reenvio do prestador — reprove ou ajuste a orientação de reanálise' });
      }
      // Revisão de decisão: se já havia veredito terminal, exigir justificativa em
      // qualquer nova ação — inclusive Aprovar. Trilha fica em eval_answer_iterations.
      const isRevision = ['aprovado', 'reprovado', 'nao_se_aplica'].includes(ans.evidence_status);
      if ((observationRequired || isRevision) && !observation) {
        return res.status(400).json({ error: isRevision ? 'justificativa obrigatória para revisar a decisão' : 'observação obrigatória' });
      }

      // marcou_na: o auditor declara "não se aplica" — é uma DECISÃO DE EVIDÊNCIA
      // (evidence_status='nao_se_aplica'), sai do cálculo e não é eliminatório. NÃO
      // sobrescreve a resposta do prestador (answer_value fica como ele respondeu).
      const newEvidenceStatus =
        action === 'aprovou' ? 'aprovado' :
        action === 'reprovou' ? 'reprovado' :
        action === 'marcou_na' ? 'nao_se_aplica' : 'aguardando_reanalise';
      const newScore = action === 'reprovou' || action === 'marcou_na' ? 0 : Number(ans.score_obtained ?? 0);
      const isNonCompliant = action === 'reprovou';
      const newAnswerValue = ans.answer_value;

      await withTransaction(async (client) => {
        await client.query(`
          UPDATE eval_answers
             SET evidence_status = $1,
                 score_obtained  = $2,
                 auditor_observation = $3,
                 is_non_compliant = $4,
                 answer_value = $5
           WHERE id = $6
        `, [newEvidenceStatus, newScore, observation || null, isNonCompliant, newAnswerValue, answerId]);

        const n = await nextIterationNumber(client, answerId);
        await client.query(`
          INSERT INTO eval_answer_iterations
            (answer_id, iteration_number, actor_id, actor_role, action, answer_value, score_obtained, evidence_url, observation)
          VALUES ($1, $2, $3, 'auditor', $4, $5, $6, $7, $8)
        `, [answerId, n, req.user.id, action, newAnswerValue, newScore, ans.evidence_url, observation || null]);

        // Reanálise agora é rascunho (spec 2026-09-11): o flip da instância e a
        // notificação acontecem de uma vez no POST /instances/:id/enviar-reanalise.
      });

      await auditLog({
        query, userId: req.user.id, action: `answer_${action}`,
        meta: {
          provider_id: Number(ans.provider_id),
          instance_id: Number(ans.instance_id),
          location_id: ans.location_id ?? null,
          question_id: Number(ans.question_id),
        },
        ip: hashClientIp(req),
      });

      res.json({ success: true, evidence_status: newEvidenceStatus });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  }

  app.post('/api/eval/answers/:id/aprovar',              authenticate, (req, res) => auditorAction(req, res, 'aprovou', false));
  app.post('/api/eval/answers/:id/reprovar',             authenticate, (req, res) => auditorAction(req, res, 'reprovou', true));
  app.post('/api/eval/answers/:id/solicitar-reanalise',  authenticate, (req, res) => auditorAction(req, res, 'solicitou_reanalise', true));
  app.post('/api/eval/answers/:id/nao-aplica',           authenticate, (req, res) => auditorAction(req, res, 'marcou_na', true));

  // Devolve ao prestador, DE UMA VEZ, todos os critérios marcados para reanálise
  // (spec 2026-09-11): flipa a instância e envia uma única notificação com a lista.
  app.post('/api/eval/instances/:id/enviar-reanalise', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const id = Number(req.params.id);
      const { rows: [inst] } = await query(
        'SELECT id, status, provider_id, location_id FROM eval_instances WHERE id = $1', [id]);
      if (!inst) return res.status(404).json({ error: 'instance not found' });
      if (inst.status !== 'em_analise') {
        return res.status(409).json({ error: `status ${inst.status} não permite devolver para reanálise` });
      }
      const { rows: marked } = await query(`
        SELECT eq.code, eq.text
          FROM eval_answers ea
          JOIN eval_questions eq ON eq.id = ea.question_id
         WHERE ea.instance_id = $1 AND ea.evidence_status = 'aguardando_reanalise'
         ORDER BY eq.code
      `, [id]);
      if (!marked.length) return res.status(409).json({ error: 'nenhum critério marcado para reanálise' });

      await query(`UPDATE eval_instances SET status = 'aguardando_evidencia' WHERE id = $1`, [id]);

      await auditLog({
        query, userId: req.user.id, action: 'reanalise_enviada',
        meta: { instance_id: id, provider_id: Number(inst.provider_id), location_id: inst.location_id ?? null, count: marked.length },
        ip: hashClientIp(req),
      });

      void (async () => {
        const items = marked.map((m: any) => ({ code: m.code, text: questionOnly(m.text ?? '') }));
        await notifyEvent('reanalise_solicitada',
          { items, instance_id: id, end_date: await instanceCycleEnd(id) },
          await prestadorRecipients(Number(inst.provider_id), inst.location_id ?? null),
          { providerId: Number(inst.provider_id), dedupeRef: `reanalise-lote:${id}:${Date.now()}` });
      })().catch((e) => console.error('[notify] site reanalise_solicitada (lote):', e));

      res.json({ success: true, sent: marked.length });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Candidatos a plano de ação (não conformes) da instância — usado no modal do parecer
  app.get('/api/eval/instances/:id/plano-candidatos', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const id = Number(req.params.id);
      const { rows: [exists] } = await query('SELECT id FROM eval_instances WHERE id = $1', [id]);
      if (!exists) return res.status(404).json({ error: 'instance not found' });

      const { rows } = await query(`
        SELECT ea.id, eq.code AS question_code, eq.text AS question_text,
               eq.legislation, eq.dimension, eq.guidance, eq.is_eliminatory,
               ea.answer_value, ea.score_obtained, eq.max_score
          FROM eval_answers ea
          JOIN eval_questions eq ON eq.id = ea.question_id
         WHERE ea.instance_id = $1
           AND ${COUNTS_IN_SCORE_SQL}
           AND COALESCE(ea.score_obtained, 0) < eq.max_score
         ORDER BY eq.dimension, eq.code
      `, [id]);

      const { rows: [seg] } = await query(`
        SELECT COALESCE(SUM(ea.score_obtained) FILTER (WHERE ${COUNTS_IN_SCORE_SQL}), 0)::numeric AS score,
               COALESCE(SUM(eq.max_score)      FILTER (WHERE ${COUNTS_IN_SCORE_SQL}), 0)::numeric AS max
          FROM eval_answers ea
          JOIN eval_questions eq ON eq.id = ea.question_id
         WHERE ea.instance_id = $1 AND eq.dimension IN ('Segurança','Documento Legal')
      `, [id]);
      const segurancaPct = Number(seg.max) > 0 ? Math.round(Number(seg.score) / Number(seg.max) * 10000) / 100 : 100;

      const { buildAutoItems } = await import('./src/lib/actionPlan.js');
      res.json({ seguranca_pct: segurancaPct, items: buildAutoItems(rows as any, { segurancaPct }) });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Plano de ação de OUTRO ciclo (anterior/avulso) ainda aberto para o par
  // prestador×local: aberto = não encerrado sem conclusão e com item não concluído.
  // has_elim marca item de critério ELIMINATÓRIO (marcação atual do roteiro; sem
  // answer_id cai em Documento Legal) — item 18 da homologação 09/2026 + spec
  // 2026-09-21: com eliminatório pendente, o selo do ciclo seguinte trava em Bronze.
  async function pendingPrevPlan(providerId: number, locationId: number | null, cycleId: number | null) {
    const { rows: [r] } = await query(`
      SELECT BOOL_OR(${PLAN_ITEM_ELIMINATORY_SQL}) AS has_elim
        FROM eval_action_plans ap
        JOIN eval_action_items it ON it.plan_id = ap.id AND it.status <> 'concluida'
        ${PLAN_ITEM_QUESTION_JOIN_SQL}
       WHERE ap.provider_id = $1
         AND (ap.location_id IS NULL OR ap.location_id = $2)
         AND ap.closed_without_completion = false
         AND ap.cycle_id IS DISTINCT FROM $3
    `, [providerId, locationId, cycleId]);
    return { pending: r?.has_elim != null, hasEliminatory: !!r?.has_elim };
  }

  // Critérios recorrentes: question_codes com item de plano de ciclos anteriores do mesmo prestador
  app.get('/api/eval/instances/:id/recorrencias', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const id = Number(req.params.id);
      const { rows: [exists] } = await query('SELECT id FROM eval_instances WHERE id = $1', [id]);
      if (!exists) return res.status(404).json({ error: 'not found' });
      const { rows } = await query(`
        SELECT DISTINCT i.question_code, i.question_text, i.status,
               c.label AS cycle_label
          FROM eval_instances cur
          JOIN eval_action_plans p ON p.provider_id = cur.provider_id
               AND (p.cycle_id IS DISTINCT FROM cur.cycle_id)
          JOIN eval_action_items i ON i.plan_id = p.id AND i.question_code IS NOT NULL
          LEFT JOIN eval_cycles c ON c.id = p.cycle_id
         WHERE cur.id = $1
      `, [id]);
      res.json(rows);
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  app.post('/api/eval/instances/:id/parecer', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const id = Number(req.params.id);

      const { rows: [inst] } = await query(`
        SELECT ei.id, ei.status, ei.provider_id, ei.location_id, ei.cycle_id,
               c.cert_valid_until
          FROM eval_instances ei
          LEFT JOIN eval_cycles c ON c.id = ei.cycle_id
         WHERE ei.id = $1
      `, [id]);
      if (!inst) return res.status(404).json({ error: 'instance not found' });
      // aguardando_evidencia também emite (spec 2026-09-11): a trava real é "todos os
      // critérios terminais" (abaixo) — decididos, nada resta editável pelo prestador.
      if (!['em_analise', 'aguardando_evidencia'].includes(inst.status)) {
        return res.status(409).json({ error: `status ${inst.status} não permite parecer` });
      }

      // Bloqueio da pesquisa (spec 5.4.6): só emite parecer quando a pesquisa foi
      // respondida OU o prazo de 7 dias venceu.
      const { rows: [survey] } = await query(
        'SELECT within_deadline, bonus_points FROM eval_survey_responses WHERE instance_id = $1', [id]);
      if (!survey) {
        const { rows: [sub] } = await query('SELECT submitted_at FROM eval_instances WHERE id = $1', [id]);
        const { surveyDeadline } = await import('./src/lib/surveyBonus.js');
        if (sub?.submitted_at && Date.now() <= surveyDeadline(new Date(sub.submitted_at)).getTime()) {
          return res.status(409).json({ error: 'aguardando pesquisa de satisfação ou fim do prazo' });
        }
      }

      const { rows: pending } = await query(`
        SELECT ea.id FROM eval_answers ea
         WHERE ea.instance_id = $1 AND ${PENDING_ANSWER_SQL}
      `, [id]);
      if (pending.length) {
        return res.status(409).json({ error: 'critérios sem decisão terminal', pending_answer_ids: pending.map((r: any) => Number(r.id)) });
      }

      // Mesma regra da memória de cálculo (fonte única em scoreMemory.ts).
      const { rows: memRows } = await query(`
        SELECT ea.question_id, eq.code, eq.dimension, eq.is_eliminatory, eq.max_score,
               ea.answer_value, ea.score_obtained, ea.evidence_status
          FROM eval_answers ea
          JOIN eval_questions eq ON eq.id = ea.question_id
         WHERE ea.instance_id = $1
      `, [id]);
      const mem = buildScoreMemory(
        memRows.map((r: any) => ({
          question_id: Number(r.question_id), code: r.code, dimension: r.dimension,
          is_eliminatory: !!r.is_eliminatory, max_score: Number(r.max_score),
          answer_value: r.answer_value, score_obtained: r.score_obtained,
          evidence_status: r.evidence_status,
        })),
        survey?.within_deadline != null ? { within_deadline: !!survey.within_deadline } : null,
      );
      const score = mem.totals.obtained;
      const maxPossible = mem.totals.max;
      const hasEliminatoryFailed = mem.eliminatory_failed;
      const percentual = mem.final_pct;
      // Item 18 (homologação 09/2026): plano de ciclo anterior com item de
      // critério eliminatório pendente trava o selo em Bronze.
      const prevPlan = await pendingPrevPlan(
        Number(inst.provider_id), inst.location_id != null ? Number(inst.location_id) : null,
        inst.cycle_id != null ? Number(inst.cycle_id) : null);
      const seal = prevPlan.hasEliminatory ? 'Bronze' : mem.seal;

      // ---- Plano de Ação 5W2H (spec 5.4.4.1): leituras puras ANTES do UPDATE —
      // status ainda é 'em_analise' aqui, seguro ler. O resultado (chosen/origin)
      // é gravado na MESMA transação do UPDATE abaixo, pra não perder o plano
      // obrigatório se o parecer for aprovado mas a geração falhar.
      const { rows: candRows } = await query(`
        SELECT ea.id, eq.code AS question_code, eq.text AS question_text,
               eq.legislation, eq.dimension, eq.guidance, eq.is_eliminatory,
               ea.answer_value, ea.score_obtained, eq.max_score
          FROM eval_answers ea
          JOIN eval_questions eq ON eq.id = ea.question_id
         WHERE ea.instance_id = $1
           AND ${COUNTS_IN_SCORE_SQL}
           AND COALESCE(ea.score_obtained, 0) < eq.max_score
      `, [id]);

      const { buildAutoItems, ITEM_DEFAULT_TERM_DAYS } = await import('./src/lib/actionPlan.js');
      let chosen: ReturnType<typeof buildAutoItems> = [];
      let origin: 'automatica' | 'semiautomatica' = 'automatica';
      let segurancaPct = 100;
      if (candRows.length) {
        const { rows: [segT] } = await query(`
          SELECT COALESCE(SUM(ea.score_obtained) FILTER (WHERE ${COUNTS_IN_SCORE_SQL}), 0)::numeric AS score,
                 COALESCE(SUM(eq.max_score)      FILTER (WHERE ${COUNTS_IN_SCORE_SQL}), 0)::numeric AS max
            FROM eval_answers ea
            JOIN eval_questions eq ON eq.id = ea.question_id
           WHERE ea.instance_id = $1 AND eq.dimension IN ('Segurança','Documento Legal')
        `, [id]);
        segurancaPct = Number(segT.max) > 0
          ? Math.round(Number(segT.score) / Number(segT.max) * 10000) / 100 : 100;

        const auto = buildAutoItems(candRows as any, { segurancaPct });
        const selected = Array.isArray(req.body?.plan_answer_ids)
          ? new Set(req.body.plan_answer_ids.map(Number)) : null;
        // obrigatórios entram SEMPRE (spec: "sem possibilidade de omissão")
        chosen = auto.filter(i => i.is_mandatory || !selected || selected.has(i.answer_id));
        origin = selected ? 'semiautomatica' : 'automatica';
      }

      // ---- Certificado (spec 5.4.5): emitido na mesma transação do parecer ----
      // Validade = data definida na criação do ciclo (eval_cycles.cert_valid_until),
      // congelada aqui na emissão. Não há mais regra automática.
      const { randomBytes } = await import('node:crypto');
      const validUntil: string | null = inst.cert_valid_until
        ? String(inst.cert_valid_until).slice(0, 10)
        : null;
      if (!validUntil) {
        return res.status(409).json({ error: 'Ciclo sem data de validade de certificado definida.' });
      }
      const verifyCode = randomBytes(16).toString('hex');

      // ---- UPDATE do parecer + geração do plano numa única transação ----
      let planId: number | null = null;
      let certificateId: number | null = null;
      await withTransaction(async (client) => {
        await client.query(`
          UPDATE eval_instances
             SET status = 'aprovado',
                 score = $1, max_possible_score = $2, percentual = $3, seal = $4,
                 completed_at = now()
           WHERE id = $5
        `, [score, maxPossible, percentual, seal, id]);

        const { rows: [cert] } = await client.query(`
          INSERT INTO eval_certificates (instance_id, verify_code, valid_until)
          VALUES ($1, $2, $3)
          ON CONFLICT (instance_id) DO NOTHING
          RETURNING id
        `, [id, verifyCode, validUntil]);
        certificateId = cert ? Number(cert.id) : null;

        if (!chosen.length) return;

        const { rows: [plan] } = await client.query(`
          INSERT INTO eval_action_plans (cycle_id, instance_id, provider_id, location_id, origin, created_by)
          SELECT cycle_id, id, provider_id, location_id, $2, $3 FROM eval_instances WHERE id = $1
          ON CONFLICT (instance_id) WHERE instance_id IS NOT NULL DO NOTHING
          RETURNING id
        `, [id, origin, req.user.id]);
        if (!plan) return; // parecer re-executado: plano já existe, não duplica (commit normal)
        planId = Number(plan.id);
        for (const it of chosen) {
          const { rows: [item] } = await client.query(`
            INSERT INTO eval_action_items
              (plan_id, answer_id, question_code, question_text, dimension, is_mandatory,
               what, why, how, start_date, due_date)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CURRENT_DATE,
                    CURRENT_DATE + ($10 || ' days')::interval)
            RETURNING id
          `, [planId, it.answer_id, it.question_code, it.question_text, it.dimension,
              it.is_mandatory, it.what, it.why, it.how, ITEM_DEFAULT_TERM_DAYS]);
          await client.query(`
            INSERT INTO eval_action_events (item_id, actor_id, actor_name, actor_role, action)
            VALUES ($1, $2, $3, 'auditor', 'criou')
          `, [item.id, req.user.id, req.user.name]);
        }
      });

      // auditLog fica FORA da transação (roda após commit; falhas de log não revertem o parecer).
      await auditLog({
        query, userId: req.user.id, action: 'evaluation_finalized',
        meta: {
          provider_id: Number(inst.provider_id),
          instance_id: id,
          location_id: inst.location_id ?? null,
          seal, percentual, has_eliminatory_failed: hasEliminatoryFailed,
        },
        ip: hashClientIp(req),
      });
      if (planId) {
        await auditLog({
          query, userId: req.user.id, action: 'action_plan_generated',
          meta: { provider_id: Number(inst.provider_id), instance_id: id, plan_id: planId,
                  origin, items: chosen.length, seguranca_pct: segurancaPct },
          ip: hashClientIp(req),
        });
      }
      if (certificateId) {
        await auditLog({
          query, userId: req.user.id, action: 'certificate_issued',
          meta: { provider_id: Number(inst.provider_id), instance_id: id,
                  certificate_id: certificateId, seal, valid_until: validUntil },
          ip: hashClientIp(req),
        });
      }

      void (async () => {
        const provRecipients = await prestadorRecipients(Number(inst.provider_id), inst.location_id ?? null);
        const { rows: [pvName] } = await query('SELECT name FROM providers WHERE id = $1', [inst.provider_id]);
        // Decisão da rodada de aprovação dos modelos (2026-08-19): reprovado e
        // certificado emitido não vão por e-mail — só notificação no portal.
        await notifyEvent(seal ? 'parecer_aprovado' : 'parecer_reprovado',
          { seal, percentual, has_certificate: !!certificateId, valid_until: certificateId ? validUntil : null },
          provRecipients, { providerId: Number(inst.provider_id), email: !!seal });
        if (certificateId) {
          await notifyEvent('certificado_emitido', { valid_until: validUntil },
            provRecipients, { providerId: Number(inst.provider_id) });
        }
        if (planId) {
          const planoCtx = { provider_name: pvName?.name ?? '', items: chosen.length };
          // Prestador recebe a versão dele (texto do cliente); auditoria, a genérica com o nome.
          await notifyEvent('plano_gerado', { ...planoCtx, audience: 'prestador' }, provRecipients,
            { providerId: Number(inst.provider_id) });
          await notifyEvent('plano_gerado', planoCtx, await auditoriaRecipients(),
            { providerId: Number(inst.provider_id) });
        }
      })().catch((e) => console.error('[notify] site parecer:', e));

      res.json({ status: 'aprovado', percentual, seal, hasEliminatoryFailed, plan_id: planId, certificate_id: certificateId });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Memória de cálculo detalhada (auditor) — mesma regra do parecer, sem gravar nada.
  app.get('/api/eval/instances/:id/memoria-calculo', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const id = Number(req.params.id);
      const { rows: [inst] } = await query(
        'SELECT id, status, script_id, percentual, seal, provider_id, location_id, cycle_id FROM eval_instances WHERE id = $1', [id]);
      if (!inst) return res.status(404).json({ error: 'instance not found' });

      const { rows: [survey] } = await query(
        'SELECT within_deadline FROM eval_survey_responses WHERE instance_id = $1', [id]);

      // LEFT JOIN a partir das questões do roteiro: questões nunca respondidas
      // aparecem como 'sem_resposta'. buildScoreMemory é agnóstico a linha faltante.
      const { rows: memRows } = await query(`
        SELECT eq.id AS question_id, eq.code, eq.dimension, eq.is_eliminatory, eq.max_score,
               ea.answer_value, ea.score_obtained, ea.evidence_status
          FROM eval_questions eq
          JOIN eval_sections sc ON sc.id = eq.section_id
          LEFT JOIN eval_answers ea ON ea.instance_id = $1 AND ea.question_id = eq.id
         WHERE sc.script_id = $2
         ORDER BY eq.dimension NULLS LAST, eq.code
      `, [id, inst.script_id]);

      const mem = buildScoreMemory(
        memRows.map((r: any) => ({
          question_id: Number(r.question_id), code: r.code, dimension: r.dimension,
          is_eliminatory: !!r.is_eliminatory, max_score: Number(r.max_score),
          answer_value: r.answer_value, score_obtained: r.score_obtained,
          evidence_status: r.evidence_status,
        })),
        survey ? { within_deadline: !!survey.within_deadline } : null,
      );

      const CLOSED = ['aprovado', 'reprovado', 'finalizado', 'ciclo_encerrado'];
      const payload: any = { ...mem };
      // Item 18: mesma trava do parecer — memória mostra o selo que será gravado.
      const prevPlan = await pendingPrevPlan(
        Number(inst.provider_id), inst.location_id != null ? Number(inst.location_id) : null,
        inst.cycle_id != null ? Number(inst.cycle_id) : null);
      if (prevPlan.hasEliminatory && payload.seal !== 'Bronze') {
        payload.seal = 'Bronze';
        // ponytail: o identificador guarda "dl" por contrato com o front; hoje significa "eliminatório".
        payload.seal_cap = 'plano_dl_ciclo_anterior';
      }
      if (CLOSED.includes(inst.status)) {
        payload.stored = { percentual: Number(inst.percentual) || 0, seal: inst.seal };
      }
      res.json(payload);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // -----------------------------------------------------------------------
  // Plano de Ação 5W2H — board, detalhe, CRUD e validação (spec 5.4.4)
  // -----------------------------------------------------------------------

  // Pesquisa de Satisfação — listagem para o Dashboard de Indicadores (spec 5.4.6).
  app.get('/api/eval/surveys', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const cycleId = Number.isFinite(Number(req.query.cycle_id)) ? Number(req.query.cycle_id) : null;
      // Todos os roteiros enviados (submitted_at) LEFT JOIN respostas, com status
      // calculado: respondida | pendente (no prazo de 7d) | expirada (prazo vencido).
      const { rows } = await query(`
        SELECT ei.id AS instance_id, ei.provider_id, ei.cycle_id,
               ei.submitted_at,
               p.name AS provider_name, p.sgu_code AS provider_code,
               c.label AS cycle_label,
               sr.q1_clareza, sr.q2_portal, sr.q3_documentos, sr.q4_dificuldade, sr.q4_texto,
               sr.q5_geral, sr.q6_nps, sr.comentarios, sr.within_deadline, sr.bonus_points,
               sr.submitted_at AS response_submitted_at,
               CASE
                 WHEN sr.id IS NOT NULL THEN 'respondida'
                 WHEN now() <= ei.submitted_at + interval '7 days' THEN 'pendente'
                 ELSE 'expirada'
               END AS status
          FROM eval_instances ei
          JOIN providers p ON p.id = ei.provider_id
          LEFT JOIN eval_survey_responses sr ON sr.instance_id = ei.id
          LEFT JOIN eval_cycles c ON c.id = ei.cycle_id
         WHERE ei.submitted_at IS NOT NULL AND ($1::bigint IS NULL OR ei.cycle_id = $1)
         ORDER BY (sr.id IS NOT NULL) DESC, ei.submitted_at DESC
      `, [cycleId]);
      res.json(rows);
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Pesquisa de Satisfação — resumo/funil por ciclo (spec 5.4.6). Base: roteiros
  // enviados (eval_instances.submitted_at). 4 baldes que somam os enviados.
  app.get('/api/eval/surveys/summary', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const cycleId = Number.isFinite(Number(req.query.cycle_id)) ? Number(req.query.cycle_id) : null;
      const { rows: [s] } = await query(`
        SELECT
          count(*)::int AS enviados,
          count(sr.id)::int AS preenchidas,
          count(sr.id) FILTER (WHERE sr.within_deadline)::int AS respondidas_no_prazo,
          count(sr.id) FILTER (WHERE NOT sr.within_deadline)::int AS respondidas_fora,
          count(*) FILTER (WHERE sr.id IS NULL AND now() <= ei.submitted_at + interval '7 days')::int AS pendentes_no_prazo,
          count(*) FILTER (WHERE sr.id IS NULL AND now() >  ei.submitted_at + interval '7 days')::int AS pendentes_expiradas,
          count(sr.id) FILTER (WHERE COALESCE(sr.comentarios,'') <> '' OR COALESCE(sr.q4_texto,'') <> '')::int AS com_comentario,
          AVG(EXTRACT(EPOCH FROM (sr.submitted_at - ei.submitted_at)) / 86400.0) AS tempo_medio_dias
        FROM eval_instances ei
        LEFT JOIN eval_survey_responses sr ON sr.instance_id = ei.id
        WHERE ei.submitted_at IS NOT NULL AND ($1::bigint IS NULL OR ei.cycle_id = $1)
      `, [cycleId]);
      res.json({
        ...s,
        tempo_medio_dias: s.tempo_medio_dias != null ? Math.round(Number(s.tempo_medio_dias) * 10) / 10 : null,
      });
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Lista planos do ciclo com agregados p/ o Kanban (spec 5.4.4.5)
  app.get('/api/eval/action-plans', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const cycleId = req.query.cycle_id ? Number(req.query.cycle_id) : null;
      const { rows } = await query(`
        SELECT p.id, p.cycle_id, p.instance_id, p.provider_id, p.location_id,
               p.origin, p.closed_without_completion, p.created_at,
               pr.name AS provider_name,
               pr.sgu_code AS provider_code, pl.cidade AS city, pl.uf AS location_uf,
               COALESCE(NULLIF(pl.logradouro, ''), pl.label, pl.cidade) AS location_label,
               COALESCE(json_agg(json_build_object('status', i.status, 'due_date', i.due_date))
                        FILTER (WHERE i.id IS NOT NULL), '[]') AS items,
               EXISTS (SELECT 1 FROM eval_action_events e
                        JOIN eval_action_items ii ON ii.id = e.item_id
                       WHERE ii.plan_id = p.id AND e.actor_role = 'prestador') AS has_provider_interaction
          FROM eval_action_plans p
          JOIN providers pr ON pr.id = p.provider_id
          LEFT JOIN provider_locations pl ON pl.id = p.location_id
          LEFT JOIN eval_action_items i ON i.plan_id = p.id
         WHERE ($1::bigint IS NULL OR p.cycle_id = $1)
         GROUP BY p.id, pr.name, pr.sgu_code, pl.cidade, pl.uf, pl.logradouro, pl.label
         ORDER BY p.created_at DESC
      `, [cycleId]);

      const { computePlanStatus, planColor } = await import('./src/lib/actionPlan.js');
      const now = new Date();
      res.json(rows.map((r: any) => {
        const status = computePlanStatus({
          items: r.items, hasProviderInteraction: r.has_provider_interaction,
          closedWithoutCompletion: r.closed_without_completion, now,
        });
        return { ...r, status, color: planColor(status) };
      }));
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Plano avulso (spec 5.4.4.1 - Manual). Body: { provider_id, location_id?, cycle_id? }
  // Prestadores + endereços elegíveis para plano de ação manual: só os que têm
  // avaliação CONCLUÍDA (parecer emitido) no ciclo. 'ciclo_encerrado' é fechamento
  // forçado, não conclusão — fica de fora. Uma linha por (prestador, endereço).
  const CONCLUDED_STATUSES = ['aprovado', 'reprovado', 'finalizado'];
  app.get('/api/eval/plan-eligible', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const cycleId = req.query.cycle_id ? Number(req.query.cycle_id) : null;
      const { rows } = await query(`
        SELECT DISTINCT p.id AS provider_id, p.name AS provider_name, p.sgu_code AS provider_code,
               ei.location_id,
               COALESCE(NULLIF(pl.logradouro, ''), pl.label, pl.cidade) AS location_label,
               pl.cidade AS location_cidade, pl.uf AS location_uf
          FROM eval_instances ei
          JOIN providers p ON p.id = ei.provider_id
          LEFT JOIN provider_locations pl ON pl.id = ei.location_id
         WHERE ei.status = ANY($1)
           AND ($2::bigint IS NULL OR ei.cycle_id = $2)
         ORDER BY p.name, location_label
      `, [CONCLUDED_STATUSES, cycleId]);
      res.json(rows);
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  app.post('/api/eval/action-plans', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const { provider_id, cycle_id } = req.body || {};
      if (!provider_id) return res.status(400).json({ error: 'provider_id obrigatório' });
      // Plano é por unidade de atendimento (mesma regra do eval_instances). Sem
      // location_id no body e com exatamente 1 unidade comercial, resolve automático;
      // com 0 ou >1 sem escolha, fica NULL.
      let locationId: number | null = req.body.location_id ? Number(req.body.location_id) : null;
      if (locationId == null) {
        const { rows: locs } = await query(
          `SELECT id FROM provider_locations
            WHERE provider_id = $1
              AND COALESCE(label,'') NOT ILIKE 'residencial%'
              AND COALESCE(sgu_location_code,'') !~ '-RES$'`,
          [provider_id],
        );
        if (locs.length === 1) locationId = Number(locs[0].id);
      }
      // Regra: plano manual só para prestador/endereço com avaliação concluída no
      // ciclo (mesma fonte do GET /plan-eligible). Defesa no servidor — não confia só na UI.
      const { rows: elig } = await query(`
        SELECT 1 FROM eval_instances
         WHERE provider_id = $1
           AND status = ANY($2)
           AND ($3::bigint IS NULL OR cycle_id = $3)
           AND ($4::bigint IS NULL OR location_id = ANY(ARRAY[$4]::bigint[]))
         LIMIT 1
      `, [provider_id, CONCLUDED_STATUSES, cycle_id ?? null, locationId]);
      if (elig.length === 0) {
        return res.status(409).json({ error: 'Prestador/endereço sem avaliação concluída neste ciclo.' });
      }
      const { rows: [plan] } = await query(`
        INSERT INTO eval_action_plans (cycle_id, provider_id, location_id, origin, created_by)
        VALUES ($1,$2,$3,'manual',$4) RETURNING *
      `, [cycle_id ?? null, provider_id, locationId, req.user.id]);
      await auditLog({ query, userId: req.user.id, action: 'action_plan_generated',
        meta: { provider_id: Number(provider_id), plan_id: Number(plan.id), origin: 'manual', location_id: locationId },
        ip: hashClientIp(req) });
      void (async () => {
        const { rows: [pvManual] } = await query('SELECT name FROM providers WHERE id = $1', [provider_id]);
        await notifyEvent('plano_gerado', { provider_name: pvManual?.name ?? '', audience: 'prestador' },
          await prestadorRecipients(Number(provider_id), locationId ?? null), { providerId: Number(provider_id) });
        await notifyEvent('plano_gerado', { provider_name: pvManual?.name ?? '' },
          await auditoriaRecipients(), { providerId: Number(provider_id) });
      })().catch((e) => console.error('[notify] site plano_gerado (manual):', e));
      res.status(201).json(plan);
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Detalhe do plano: itens + histórico + janelas (spec 5.4.4). Prestador só vê o próprio plano.
  app.get('/api/eval/action-plans/:id', authenticate, async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      const { rows: [plan] } = await query(`
        SELECT p.*, pr.name AS provider_name, pr.sgu_code AS provider_code,
               COALESCE(NULLIF(pl.logradouro, ''), pl.label, pl.cidade) AS location_label,
               pl.cidade AS location_cidade, pl.uf AS location_uf
          FROM eval_action_plans p
          JOIN providers pr ON pr.id = p.provider_id
          LEFT JOIN provider_locations pl ON pl.id = p.location_id
         WHERE p.id = $1
      `, [id]);
      if (!plan) return res.status(404).json({ error: 'not found' });
      const planLocationIds = await userLocationIds(req);
      if (!isStaff(req.user.role) && (Number(plan.provider_id) !== Number(req.user.provider_id)
          || !planLocationIds.includes(Number(plan.location_id)))) {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      const { rows: items } = await query(`
        SELECT * FROM eval_action_items WHERE plan_id = $1 ORDER BY is_mandatory DESC, id
      `, [id]);
      const { rows: events } = await query(`
        SELECT e.*, d.file_url AS document_url, d.type AS document_title
          FROM eval_action_events e
          LEFT JOIN documents d ON d.id = e.document_id
         WHERE e.item_id = ANY($1::bigint[])
         ORDER BY e.created_at
      `, [items.map((i: any) => i.id)]);

      const { computeWindows, computePlanStatus, planColor } = await import('./src/lib/actionPlan.js');
      const status = computePlanStatus({
        items, hasProviderInteraction: events.some((e: any) => e.actor_role === 'prestador'),
        closedWithoutCompletion: plan.closed_without_completion, now: new Date(),
      });
      // Limite do plano = início do próximo ciclo (D-01): lá o prestador é reavaliado,
      // então as janelas não podem ultrapassá-lo. Sem próximo ciclo, fica sem limite.
      const { rows: [nextCycle] } = await query(`
        SELECT start_date FROM eval_cycles
         WHERE start_date > (SELECT start_date FROM eval_cycles WHERE id = $1)
         ORDER BY start_date ASC, id ASC LIMIT 1
      `, [plan.cycle_id]);
      res.json({
        ...plan, status, color: planColor(status),
        windows: computeWindows(new Date(plan.created_at),
          nextCycle?.start_date ? new Date(nextCycle.start_date) : null),
        items: items.map((i: any) => ({ ...i, events: events.filter((e: any) => Number(e.item_id) === Number(i.id)) })),
      });
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Adicionar item 5W2H. Body: what (obrig.), why, who_name, who_role, start_date, due_date, how, how_much
  app.post('/api/eval/action-plans/:id/items', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const planId = Number(req.params.id);
      const b = req.body || {};
      if (!b.what?.trim()) return res.status(400).json({ error: 'Campo "O quê?" é obrigatório' });
      const { rows: [plan] } = await query('SELECT id FROM eval_action_plans WHERE id = $1', [planId]);
      if (!plan) return res.status(404).json({ error: 'plano não encontrado' });
      const { rows: [item] } = await query(`
        INSERT INTO eval_action_items
          (plan_id, what, why, who_name, who_role, start_date, due_date, how, how_much)
        VALUES ($1,$2,$3,$4,$5,
                COALESCE($6::date, CURRENT_DATE),
                COALESCE($7::date, COALESCE($6::date, CURRENT_DATE) + interval '90 days'),
                $8,$9)
        RETURNING *
      `, [planId, b.what.trim(), b.why ?? null, b.who_name ?? null, b.who_role ?? null,
          b.start_date ?? null, b.due_date ?? null, b.how ?? null, b.how_much ?? null]);
      await query(`
        INSERT INTO eval_action_events (item_id, actor_id, actor_name, actor_role, action)
        VALUES ($1,$2,$3,'auditor','criou')
      `, [item.id, req.user.id, req.user.name]);
      res.status(201).json(item);
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Editar campos 5W2H (staff; prestador NUNCA edita descrições - spec 5.4.4.6)
  app.patch('/api/eval/action-items/:id', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const id = Number(req.params.id);
      const allowed = ['what','why','who_name','who_role','start_date','due_date','how','how_much'] as const;
      const sets: string[] = []; const vals: any[] = [];
      for (const k of allowed) if (k in (req.body || {})) { vals.push(req.body[k]); sets.push(`${k} = $${vals.length}`); }
      if (!sets.length) return res.status(400).json({ error: 'nada para atualizar' });
      vals.push(id);
      const { rows: [item] } = await query(
        `UPDATE eval_action_items SET ${sets.join(', ')} WHERE id = $${vals.length} AND status <> 'concluida' RETURNING *`, vals);
      if (!item) {
        const { rows: [existing] } = await query('SELECT status FROM eval_action_items WHERE id = $1', [id]);
        if (!existing) return res.status(404).json({ error: 'not found' });
        return res.status(409).json({ error: 'item concluído não pode ser editado' });
      }
      await query(`
        INSERT INTO eval_action_events (item_id, actor_id, actor_name, actor_role, action)
        VALUES ($1,$2,$3,'auditor','editou')
      `, [id, req.user.id, req.user.name]);
      res.json(item);
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Validação do auditor (Concluir | Solicitar revisão | Reprovar — spec 5.4.4.3)
  // Body: { decisao: 'concluir'|'solicitar_revisao'|'reprovar', observacao? }
  // observacao obrigatória para solicitar_revisao/reprovar e para qualquer revisão
  // de decisão terminal (Rever decisão — concluida/reprovada).
  app.post('/api/eval/action-items/:id/validar', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const id = Number(req.params.id);
      const { decisao, observacao } = req.body || {};
      const map: Record<string, { status: string; action: string }> = {
        concluir:          { status: 'concluida',          action: 'concluiu' },
        solicitar_revisao: { status: 'solicitada_revisao', action: 'solicitou_revisao' },
        reprovar:          { status: 'reprovada',          action: 'reprovou' },
      };
      const m = map[decisao];
      if (!m) return res.status(400).json({ error: 'decisao inválida' });

      // Auditor age quando o item aguarda validação; ou revê uma decisão terminal já registrada.
      const REVISABLE = ['aguardando_revisao', 'concluida', 'reprovada'];
      const { rows: [cur] } = await query('SELECT status FROM eval_action_items WHERE id = $1', [id]);
      if (!cur) return res.status(404).json({ error: 'not found' });
      if (!REVISABLE.includes(cur.status)) {
        return res.status(409).json({ error: 'item não está aguardando revisão' });
      }
      const isRevision = cur.status !== 'aguardando_revisao';
      if ((decisao !== 'concluir' || isRevision) && !observacao?.trim()) {
        return res.status(400).json({ error: 'observação obrigatória' });
      }
      // Guarda contra corrida: só transiciona se o status não mudou desde a leitura.
      const { rows: [item] } = await query(`
        UPDATE eval_action_items
           SET status = $1::text,
               validated_by = CASE WHEN $1::text = 'concluida' THEN $2::bigint ELSE validated_by END,
               validated_at = CASE WHEN $1::text = 'concluida' THEN now() ELSE validated_at END
         WHERE id = $3 AND status = $4
         RETURNING *
      `, [m.status, req.user.id, id, cur.status]);
      if (!item) return res.status(409).json({ error: 'item não está aguardando revisão' });
      await query(`
        INSERT INTO eval_action_events (item_id, actor_id, actor_name, actor_role, action, comment)
        VALUES ($1,$2,$3,'auditor',$4,$5)
      `, [id, req.user.id, req.user.name, m.action, observacao ?? null]);
      await auditLog({ query, userId: req.user.id, action: 'action_item_validated',
        meta: { item_id: id, decisao, revision: isRevision }, ip: hashClientIp(req) });
      res.json(item);
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // -----------------------------------------------------------------------
  // Plano de Ação 5W2H — rotas do prestador (spec 5.4.4.6). Anti-IDOR: o
  // prestador é sempre escopado por req.user.provider_id, nunca pelo body.
  // -----------------------------------------------------------------------

  // Carrega item + plano garantindo que pertence ao prestador logado
  const loadItemForProvider = async (itemId: number, providerId: number, locationIds: number[] = []) => {
    const { rows: [row] } = await query(`
      SELECT i.*, p.provider_id, p.location_id, p.closed_without_completion
        FROM eval_action_items i JOIN eval_action_plans p ON p.id = i.plan_id
       WHERE i.id = $1
    `, [itemId]);
    if (!row || Number(row.provider_id) !== Number(providerId)) return null;
    if (!locationIds.includes(Number(row.location_id))) return null;
    return row;
  };

  // Pesquisa de Satisfação — visão do prestador (spec 5.4.6). Escopo anti-IDOR
  // sempre por req.user.provider_id. Uma pesquisa POR endereço enviado
  // (eval_instances com submitted_at), identificada pela unidade.
  app.get('/api/me/survey', authenticate, async (req: any, res) => {
    try {
      const providerId = req.user.provider_id;
      if (!providerId) return res.status(403).json({ error: 'Unauthorized' });
      const { rows } = await query(`
        SELECT ei.id AS instance_id, ei.submitted_at,
               s.title AS script_title,
               c.label AS cycle_label,
               COALESCE(NULLIF(pl.logradouro, ''), pl.label, pl.cidade) AS location_label,
               pl.cidade AS location_cidade, pl.uf AS location_uf,
               sr.id AS response_id, sr.q1_clareza, sr.q2_portal, sr.q3_documentos,
               sr.q4_dificuldade, sr.q4_texto, sr.q5_geral, sr.q6_nps, sr.comentarios,
               sr.within_deadline, sr.bonus_points, sr.submitted_at AS response_submitted_at
          FROM eval_instances ei
          JOIN eval_scripts s ON s.id = ei.script_id
          LEFT JOIN eval_cycles c ON c.id = ei.cycle_id
          LEFT JOIN provider_locations pl ON pl.id = ei.location_id
          LEFT JOIN eval_survey_responses sr ON sr.instance_id = ei.id
         WHERE ei.provider_id = $1 AND ei.submitted_at IS NOT NULL
           AND ei.location_id = ANY($2::bigint[])
         ORDER BY ei.submitted_at DESC
      `, [providerId, await userLocationIds(req)]);
      const { surveyDeadline } = await import('./src/lib/surveyBonus.js');
      const surveys = rows.map((r: any) => {
        const base = {
          instance_id: Number(r.instance_id),
          script_title: r.script_title,
          cycle_label: r.cycle_label,
          location_label: r.location_label,
          location_cidade: r.location_cidade,
          location_uf: r.location_uf,
          submitted_at: r.submitted_at,
        };
        if (r.response_id) {
          return { ...base, state: 'respondida', response: {
            q1_clareza: r.q1_clareza, q2_portal: r.q2_portal, q3_documentos: r.q3_documentos,
            q4_dificuldade: r.q4_dificuldade, q4_texto: r.q4_texto, q5_geral: r.q5_geral,
            q6_nps: r.q6_nps, comentarios: r.comentarios, within_deadline: r.within_deadline,
            bonus_points: r.bonus_points, submitted_at: r.response_submitted_at,
          } };
        }
        const deadline = surveyDeadline(new Date(r.submitted_at));
        return { ...base, state: 'disponivel', deadline: deadline.toISOString(),
                 expired: Date.now() > deadline.getTime() };
      });
      res.json({ surveys });
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  app.post('/api/me/survey', authenticate, async (req: any, res) => {
    try {
      const providerId = req.user.provider_id;
      if (!providerId) return res.status(403).json({ error: 'Unauthorized' });
      const instanceId = Number(req.body?.instance_id);
      if (!Number.isInteger(instanceId)) return res.status(400).json({ error: 'instance_id obrigatório' });
      // Valida posse + que a pesquisa daquele endereço ainda está pendente.
      const { rows: [inst] } = await query(`
        SELECT ei.id, ei.submitted_at
          FROM eval_instances ei
         WHERE ei.id = $1 AND ei.provider_id = $2 AND ei.submitted_at IS NOT NULL
           AND ei.location_id = ANY($3::bigint[])
           AND NOT EXISTS (SELECT 1 FROM eval_survey_responses sr WHERE sr.instance_id = ei.id)
      `, [instanceId, providerId, await userLocationIds(req)]);
      if (!inst) return res.status(409).json({ error: 'nenhuma pesquisa pendente para este endereço' });

      const b = req.body || {};
      // Faixa validada no servidor: fora do intervalo vira null (não polui NPS/CSAT
      // nem estoura smallint num POST forjado — o client já restringe as opções).
      const num = (v: any, min: number, max: number): number | null => {
        if (v == null || v === '') return null;
        const n = Number(v);
        return Number.isInteger(n) && n >= min && n <= max ? n : null;
      };
      const Q3 = ['sim_totalmente', 'sim_parcialmente', 'neutro', 'nao_precisei_ajuda', 'nao_insuficientes'];
      const q3 = b.q3_documentos || null;
      if (q3 && !Q3.includes(q3)) {
        return res.status(400).json({ error: 'q3_documentos inválido' });
      }

      const { isWithinDeadline, bonusPoints } = await import('./src/lib/surveyBonus.js');
      const within = isWithinDeadline(new Date(inst.submitted_at), new Date());
      const bonus = bonusPoints(within);

      try {
        const { rows: [resp] } = await query(`
          INSERT INTO eval_survey_responses
            (instance_id, q1_clareza, q2_portal, q3_documentos, q4_dificuldade, q4_texto,
             q5_geral, q6_nps, comentarios, within_deadline, bonus_points)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          RETURNING within_deadline, bonus_points
        `, [inst.id, num(b.q1_clareza, 1, 5), num(b.q2_portal, 1, 5), q3,
            typeof b.q4_dificuldade === 'boolean' ? b.q4_dificuldade : null,
            b.q4_texto?.trim() || null, num(b.q5_geral, 1, 5), num(b.q6_nps, 0, 10),
            b.comentarios?.trim() || null, within, bonus]);
        await auditLog({ query, userId: req.user.id, action: 'satisfaction_survey_submitted',
          meta: { instance_id: Number(inst.id), within_deadline: within }, ip: hashClientIp(req) });
        res.status(201).json({ ok: true, within_deadline: resp.within_deadline, bonus_points: resp.bonus_points });
      } catch (err: any) {
        if (err?.code === '23505') return res.status(409).json({ error: 'pesquisa já respondida' });
        throw err;
      }
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Meus planos (spec 5.4.4.5 — visão do prestador)
  app.get('/api/me/action-plans', authenticate, async (req: any, res) => {
    try {
      const providerId = req.user.provider_id;
      if (!providerId) return res.status(403).json({ error: 'Unauthorized' });
      const { rows } = await query(`
        SELECT p.id, p.cycle_id, c.label AS cycle_label, p.created_at, p.closed_without_completion,
               COALESCE(NULLIF(pl.logradouro, ''), pl.label, pl.cidade) AS location_label,
               pl.cidade AS location_cidade, pl.uf AS location_uf,
               (NOT p.closed_without_completion AND EXISTS (
                  SELECT 1 FROM eval_action_items ai
                   WHERE ai.plan_id = p.id
                     AND ai.status IN ('nao_iniciada','em_andamento','solicitada_revisao','reprovada')
               )) AS pending,
               COALESCE(json_agg(json_build_object('status', i.status, 'due_date', i.due_date))
                        FILTER (WHERE i.id IS NOT NULL), '[]') AS items,
               EXISTS (SELECT 1 FROM eval_action_events e
                        JOIN eval_action_items ii ON ii.id = e.item_id
                       WHERE ii.plan_id = p.id AND e.actor_role = 'prestador') AS has_provider_interaction
          FROM eval_action_plans p
          LEFT JOIN eval_cycles c ON c.id = p.cycle_id
          LEFT JOIN provider_locations pl ON pl.id = p.location_id
          LEFT JOIN eval_action_items i ON i.plan_id = p.id
         WHERE p.provider_id = $1 AND p.location_id = ANY($2::bigint[])
         GROUP BY p.id, c.label, pl.logradouro, pl.label, pl.cidade, pl.uf
         ORDER BY p.created_at DESC
      `, [providerId, await userLocationIds(req)]);
      const { computePlanStatus, planColor } = await import('./src/lib/actionPlan.js');
      const now = new Date();
      res.json(rows.map((r: any) => {
        const status = computePlanStatus({
          items: r.items, hasProviderInteraction: r.has_provider_interaction,
          closedWithoutCompletion: r.closed_without_completion, now,
        });
        return {
          ...r, status, color: planColor(status),
          items_total: r.items.length,
          items_done: r.items.filter((it: any) => it.status === 'concluida').length,
        };
      }));
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Carrega certificados no shape do diploma/CertificadosTab por um filtro.
  // whereSql é literal fixo (nunca input do usuário); $1 é o único parâmetro.
  const loadCertificates = async (whereSql: string, params: any[]) => {
      const { rows: certs } = await query(`
        SELECT ec.id, ec.verify_code, ec.issued_at, ec.valid_until, ec.first_viewed_at,
               ei.id AS instance_id, ei.provider_id, ei.seal, ei.percentual,
               c.id AS cycle_id, c.label AS cycle_label, c.active AS cycle_active,
               p.name AS provider_name,
               COALESCE(NULLIF(pl.logradouro, ''), NULLIF(fpl.logradouro, ''), pl.label, fpl.label) AS location_label,
               COALESCE(pl.logradouro, fpl.logradouro) AS logradouro,
               COALESCE(pl.numero, fpl.numero) AS numero,
               COALESCE(pl.bairro, fpl.bairro) AS bairro,
               COALESCE(pl.cidade, fpl.cidade) AS cidade,
               COALESCE(pl.uf, fpl.uf) AS uf
          FROM eval_certificates ec
          JOIN eval_instances ei ON ei.id = ec.instance_id
          JOIN providers p ON p.id = ei.provider_id
          LEFT JOIN provider_locations pl ON pl.id = ei.location_id
          -- Fallback: unidade comercial principal do prestador quando a avaliação não tem unidade.
          LEFT JOIN LATERAL (
            SELECT label, logradouro, numero, bairro, cidade, uf
              FROM provider_locations fp
             WHERE fp.provider_id = p.id
               AND COALESCE(fp.label,'') NOT ILIKE 'residencial%'
               AND COALESCE(fp.sgu_location_code,'') !~ '-RES$'
             ORDER BY fp.is_primary DESC NULLS LAST, fp.id ASC
             LIMIT 1
          ) fpl ON ei.location_id IS NULL
          LEFT JOIN eval_cycles c ON c.id = ei.cycle_id
         WHERE ${whereSql}
         ORDER BY ec.issued_at DESC, ec.id DESC
      `, params);

      // Desempenho por dimensão (mesma consolidação DL→Segurança do painel).
      const ids = certs.map((r: any) => Number(r.instance_id));
      const dimByInstance = new Map<number, { dimension: string; pct: number }[]>();
      if (ids.length) {
        const { rows: dims } = await query(`
          SELECT ea.instance_id,
                 CASE WHEN eq.dimension IN ('Segurança','Documento Legal') THEN 'Segurança' ELSE eq.dimension END AS dimension,
                 (SUM(ea.score_obtained) / NULLIF(SUM(eq.max_score), 0)) * 100 AS pct
            FROM eval_answers ea
            JOIN eval_questions eq ON eq.id = ea.question_id
           WHERE ea.instance_id = ANY($1)
             AND ${COUNTS_IN_SCORE_SQL}
             AND eq.dimension IS NOT NULL
           GROUP BY ea.instance_id,
                    CASE WHEN eq.dimension IN ('Segurança','Documento Legal') THEN 'Segurança' ELSE eq.dimension END
           ORDER BY 2
        `, [ids]);
        for (const d of dims) {
          const k = Number(d.instance_id);
          if (!dimByInstance.has(k)) dimByInstance.set(k, []);
          dimByInstance.get(k)!.push({ dimension: d.dimension, pct: Math.round(Number(d.pct) * 10) / 10 });
        }
      }

      return certs.map((r: any) => {
        const endereco = [
          [r.logradouro, r.numero].filter(Boolean).join(', '),
          r.bairro, r.cidade,
        ].filter(Boolean).join(', ') || null;
        return {
          id: Number(r.id),
          provider_id: Number(r.provider_id),
          verify_code: r.verify_code,
          issued_at: r.issued_at,
          valid_until: r.valid_until,
          seen: r.first_viewed_at != null,
          seal: r.seal,
          percentual: Number(r.percentual) || 0,
          cycle_id: r.cycle_id != null ? Number(r.cycle_id) : null,
          cycle_label: r.cycle_label,
          cycle_active: !!r.cycle_active,
          provider_name: r.provider_name,
          location_label: r.location_label,
          location_address: endereco,
          dimensions: dimByInstance.get(Number(r.instance_id)) ?? [],
        };
      });
  };

  // Meus certificados (spec 5.4.5 — visão do prestador).
  app.get('/api/me/certificates', authenticate, async (req: any, res) => {
    try {
      const providerId = req.user.provider_id;
      if (!providerId) return res.status(403).json({ error: 'Unauthorized' });
      res.json(await loadCertificates('ei.provider_id = $1 AND ei.location_id = ANY($2::bigint[])',
        [providerId, await userLocationIds(req)]));
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Marca o certificado como aberto pela 1ª vez (spec 2026-08-13, estado #6):
  // some do mural de Início e continua acessível em Certificados. Idempotente.
  app.post('/api/me/certificates/:id/seen', authenticate, async (req: any, res) => {
    try {
      const providerId = req.user.provider_id;
      if (!providerId) return res.status(403).json({ error: 'Unauthorized' });
      const { rowCount } = await query(`
        UPDATE eval_certificates ec
           SET first_viewed_at = now()
          FROM eval_instances ei
         WHERE ec.id = $1
           AND ei.id = ec.instance_id
           AND ei.provider_id = $2
           AND ei.location_id = ANY($3::bigint[])
           AND ec.first_viewed_at IS NULL
      `, [Number(req.params.id), providerId, await userLocationIds(req)]);
      res.json({ ok: true, updated: rowCount });
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Certificado por id — staff (auditoria/admin) ou o próprio prestador dono.
  // Alvo do diploma imprimível (CertificadoPrint) e do botão do painel do auditor.
  app.get('/api/eval/certificates/:id', authenticate, async (req: any, res) => {
    try {
      const [cert] = await loadCertificates('ec.id = $1', [Number(req.params.id)]);
      if (!cert) return res.status(404).json({ error: 'certificado não encontrado' });
      if (!isStaff(req.user.role) && String(cert.provider_id) !== String(req.user.provider_id)) {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      res.json(cert);
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Verificação pública de autenticidade (spec 5.4.5) — alvo do QR code.
  // Sem login. Rate-limited por IP (hasheado) e audit-logado; a mesma action
  // alimenta a contagem do rate-limit.
  app.get('/api/certificados/verificar/:code', async (req: any, res) => {
    try {
      const code = String(req.params.code || '').toLowerCase();
      const ipHashed = hashClientIp(req) ?? '';
      const allowed = await checkRateLimit('', ipHashed, 'certificate_verify', 15, 30);
      if (!allowed) {
        return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
      }
      await auditLog({
        query, action: 'certificate_verify',
        meta: { code_prefix: code.slice(0, 8) },
        ip: ipHashed,
      });

      // Formato inválido nem toca o banco. Resposta idêntica à de código
      // inexistente — não vazar distinção.
      if (!/^[0-9a-f]{32}$/.test(code)) return res.json({ valido: false });

      const { rows: [cert] } = await query(`
        SELECT ec.issued_at, ec.valid_until, ei.seal, ei.percentual,
               c.label AS cycle_label,
               p.name AS provider_name,
               COALESCE(pl.logradouro, fpl.logradouro) AS logradouro,
               COALESCE(pl.numero, fpl.numero) AS numero,
               COALESCE(pl.bairro, fpl.bairro) AS bairro,
               COALESCE(pl.cidade, fpl.cidade) AS cidade
          FROM eval_certificates ec
          JOIN eval_instances ei ON ei.id = ec.instance_id
          JOIN providers p ON p.id = ei.provider_id
          LEFT JOIN provider_locations pl ON pl.id = ei.location_id
          -- Fallback: unidade comercial principal do prestador quando a avaliação não tem unidade.
          LEFT JOIN LATERAL (
            SELECT logradouro, numero, bairro, cidade
              FROM provider_locations fp
             WHERE fp.provider_id = p.id
               AND COALESCE(fp.label,'') NOT ILIKE 'residencial%'
               AND COALESCE(fp.sgu_location_code,'') !~ '-RES$'
             ORDER BY fp.is_primary DESC NULLS LAST, fp.id ASC
             LIMIT 1
          ) fpl ON ei.location_id IS NULL
          LEFT JOIN eval_cycles c ON c.id = ei.cycle_id
         WHERE ec.verify_code = $1
      `, [code]);
      if (!cert) return res.json({ valido: false });

      const expirado = new Date(cert.valid_until) < new Date();
      const endereco = [
        [cert.logradouro, cert.numero].filter(Boolean).join(', '),
        cert.bairro, cert.cidade,
      ].filter(Boolean).join(', ') || null;
      res.json({
        valido: true,
        expirado,
        seal: cert.seal,
        percentual: Number(cert.percentual) || 0,
        provider_name: cert.provider_name,
        location_address: endereco,
        cycle_label: cert.cycle_label,
        issued_at: cert.issued_at,
        valid_until: cert.valid_until,
      });
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // "Iniciar ação" (mockup 5.4.4.6)
  app.post('/api/eval/action-items/:id/iniciar', authenticate, async (req: any, res) => {
    try {
      const item = await loadItemForProvider(Number(req.params.id), req.user.provider_id, await userLocationIds(req));
      if (!item) return res.status(403).json({ error: 'Unauthorized' });
      if (item.status !== 'nao_iniciada') return res.status(409).json({ error: 'ação já iniciada' });
      if (item.closed_without_completion) return res.status(409).json({ error: 'plano encerrado' });
      // Guarda de status na própria UPDATE — evita corrida com uma validação
      // do auditor concorrente (mesmo idioma do /validar: WHERE ... AND status = ...).
      const { rows: updated } = await query(
        `UPDATE eval_action_items SET status = 'em_andamento' WHERE id = $1 AND status = 'nao_iniciada' RETURNING id`,
        [item.id]
      );
      if (!updated.length) return res.status(409).json({ error: 'ação já iniciada' });
      await query(`
        INSERT INTO eval_action_events (item_id, actor_id, actor_name, actor_role, action)
        VALUES ($1,$2,$3,'prestador','iniciou')
      `, [item.id, req.user.id, req.user.name]);
      res.json({ ok: true });
    } catch (err: any) { console.error(err); res.status(500).json({ error: err.message }); }
  });

  // Responder: multipart (campo file opcional) + comment + conclude ('true'/'false')
  // Estados válidos: em_andamento | solicitada_revisao | reprovada (re-tentativa) | nao_iniciada (auto-inicia)
  app.post('/api/eval/action-items/:id/responder', authenticate, upload.single('file'), async (req: any, res) => {
    try {
      const item = await loadItemForProvider(Number(req.params.id), req.user.provider_id, await userLocationIds(req));
      if (!item) return res.status(403).json({ error: 'Unauthorized' });
      if (item.closed_without_completion) return res.status(409).json({ error: 'plano encerrado' });
      if (['aguardando_revisao','concluida'].includes(item.status)) {
        return res.status(409).json({ error: 'ação em revisão ou concluída' });
      }
      const comment = (req.body?.comment || '').trim() || null;
      const conclude = req.body?.conclude === 'true';
      if (!req.file && !comment && !conclude) {
        return res.status(400).json({ error: 'envie evidência, comentário ou marque conclusão' });
      }

      const newStatus = conclude ? 'aguardando_revisao' : 'em_andamento';
      await withTransaction(async (client) => {
        // Guarda a UPDATE primeiro e dentro da transação: se um /validar do
        // auditor correu enquanto este request estava em voo, a linha já não
        // bate mais no predicado e a resposta inteira (doc + eventos) rola back
        // em vez de sobrescrever/anexar depois da decisão do auditor.
        const { rows: updated } = await client.query(`
          UPDATE eval_action_items
             SET status = $1::text,
                 completed_at = CASE WHEN $1::text = 'aguardando_revisao' THEN now() ELSE completed_at END
           WHERE id = $2 AND status NOT IN ('aguardando_revisao','concluida')
           RETURNING id
        `, [newStatus, item.id]);
        if (!updated.length) throw new Error('action_item_conflict');

        let documentId: number | null = null;
        if (req.file) {
          const fileUrl = '/uploads/' + req.file.filename;
          const { rows: [doc] } = await client.query(`
            INSERT INTO documents (provider_id, type, issue_date, status, file_url, uploaded_by, reference_id)
            VALUES ($1,'plano_acao_evidencia',$2,'valido',$3,$4,$5) RETURNING id
          `, [req.user.provider_id, new Date().toISOString(), fileUrl, req.user.id, item.plan_id]);
          documentId = Number(doc.id);
          await client.query(`
            INSERT INTO eval_action_events (item_id, actor_id, actor_name, actor_role, action, comment, document_id)
            VALUES ($1,$2,$3,'prestador','anexou_evidencia',$4,$5)
          `, [item.id, req.user.id, req.user.name, comment, documentId]);
        } else if (comment) {
          await client.query(`
            INSERT INTO eval_action_events (item_id, actor_id, actor_name, actor_role, action, comment)
            VALUES ($1,$2,$3,'prestador','comentou',$4)
          `, [item.id, req.user.id, req.user.name, comment]);
        }
        if (conclude) {
          await client.query(`
            INSERT INTO eval_action_events (item_id, actor_id, actor_name, actor_role, action)
            VALUES ($1,$2,$3,'prestador','marcou_concluida')
          `, [item.id, req.user.id, req.user.name]);
        }
      });

      if (conclude) {
        void (async () => {
          const { rows: [pvResp] } = await query('SELECT name FROM providers WHERE id = $1', [req.user.provider_id]);
          await notifyEvent('acao_aguardando_validacao',
            { provider_name: pvResp?.name ?? '', what: item.what },
            await auditoriaRecipients(),
            { providerId: Number(req.user.provider_id) });
        })().catch((e) => console.error('[notify] site acao_aguardando_validacao:', e));
      }

      await auditLog({ query, userId: req.user.id, action: 'action_item_responded',
        meta: { item_id: Number(item.id), conclude, has_file: !!req.file }, ip: hashClientIp(req) });
      res.json({ status: newStatus });
    } catch (err: any) {
      if (err?.message === 'action_item_conflict') {
        return res.status(409).json({ error: 'ação em revisão ou concluída' });
      }
      console.error(err); res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eval/dashboard/auditor', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });

      const cycleIdParam = req.query.cycle_id ? Number(req.query.cycle_id) : null;
      const { rows: cycleRows } = cycleIdParam
        ? await query('SELECT id, label, start_date, end_date FROM eval_cycles WHERE id = $1', [cycleIdParam])
        : await query('SELECT id, label, start_date, end_date FROM eval_cycles WHERE active = true');
      if (!cycleRows.length) {
        return res.status(cycleIdParam ? 404 : 400).json({
          error: cycleIdParam ? 'ciclo não encontrado' : 'nenhum ciclo ativo — informe cycle_id',
        });
      }
      const cycle = cycleRows[0];

      // Pontuação parcial em tempo real (spec 5.4.2.5): score/max sobre as answers
      // já registradas, ignorando 'NA' — mesma fórmula do /parecer. Assim antes do
      // parecer o painel mostra o progresso ao invés de sempre 0.
      const { rows: instances } = await query(`
        SELECT ei.id, ei.provider_id, ei.location_id,
               p.name AS provider_name,
               p.sgu_code AS provider_code,
               pl.cidade AS city,
               NULLIF(pl.logradouro, '') AS unidade,
               p.provider_group,
               ei.status, ei.seal,
               -- Finalizadas: nota oficial gravada no parecer (base + bônus).
               -- Antes do parecer: parcial ao vivo pra mostrar progresso (spec 5.4.2.5).
               CASE WHEN ei.status IN ('aprovado','reprovado','finalizado')
                    THEN ei.percentual
                    ELSE COALESCE(partial.pct, 0) END AS percentual,
               (ec.id IS NOT NULL) AS has_certificate,
               ec.id AS certificate_id,
               ei.submitted_at,
               ei.completed_at,
               (esr.id IS NOT NULL) AS has_survey_response,
               (SELECT count(*)::int FROM eval_answers ea
                 WHERE ea.instance_id = ei.id AND ${PENDING_ANSWER_SQL}) AS pending_count,
               -- Item 18: plano de outro ciclo ainda aberto p/ o par (has_dl = item eliminatório pendente → trava selo em Bronze).
               (prev_plan.has_dl IS NOT NULL) AS prev_plan_pending,
               COALESCE(prev_plan.has_dl, false) AS prev_plan_dl
          FROM eval_instances ei
          JOIN providers p ON p.id = ei.provider_id
          LEFT JOIN provider_locations pl ON pl.id = ei.location_id
          LEFT JOIN eval_certificates ec ON ec.instance_id = ei.id
          LEFT JOIN eval_survey_responses esr ON esr.instance_id = ei.id
          LEFT JOIN LATERAL (
            SELECT BOOL_OR(${PLAN_ITEM_ELIMINATORY_SQL}) AS has_dl
              FROM eval_action_plans ap
              JOIN eval_action_items it ON it.plan_id = ap.id AND it.status <> 'concluida'
              ${PLAN_ITEM_QUESTION_JOIN_SQL}
             WHERE ap.provider_id = ei.provider_id
               AND (ap.location_id IS NULL OR ap.location_id = ei.location_id)
               AND ap.closed_without_completion = false
               AND ap.cycle_id IS DISTINCT FROM ei.cycle_id
          ) prev_plan ON true
          LEFT JOIN (
            SELECT ea.instance_id,
                   (SUM(CASE WHEN ${COUNTS_IN_SCORE_SQL} THEN COALESCE(ea.score_obtained, 0) ELSE 0 END)
                    / NULLIF(SUM(CASE WHEN ${COUNTS_IN_SCORE_SQL} THEN eq.max_score ELSE 0 END), 0)) * 100 AS pct
              FROM eval_answers ea
              JOIN eval_questions eq ON eq.id = ea.question_id
              JOIN eval_instances ei2 ON ei2.id = ea.instance_id AND ei2.cycle_id = $1
             GROUP BY ea.instance_id
          ) partial ON partial.instance_id = ei.id
         WHERE ei.cycle_id = $1
         ORDER BY ei.id
      `, [cycle.id]);
      // ponytail: cidade só quando location_id existe; instâncias "prestador inteiro"
      // ficam com city=null. Add when fallback para local primário for pedido.

      const { rows: dimPct } = await query(`
        SELECT ea.instance_id,
               CASE WHEN eq.dimension IN ('Segurança','Documento Legal') THEN 'Segurança' ELSE eq.dimension END AS dimension,
               (SUM(ea.score_obtained) / NULLIF(SUM(eq.max_score), 0)) * 100 AS pct
          FROM eval_answers ea
          JOIN eval_questions eq ON eq.id = ea.question_id
          JOIN eval_instances ei ON ei.id = ea.instance_id
         WHERE ei.cycle_id = $1
           AND ${COUNTS_IN_SCORE_SQL}
           AND eq.dimension IS NOT NULL
         GROUP BY ea.instance_id,
                  CASE WHEN eq.dimension IN ('Segurança','Documento Legal') THEN 'Segurança' ELSE eq.dimension END
      `, [cycle.id]);

      const { buildAuditorDashboard } = await import('./src/lib/auditorDashboard.js');
      const payload = buildAuditorDashboard(
        {
          id: Number(cycle.id),
          label: cycle.label,
          start_date: cycle.start_date instanceof Date ? cycle.start_date.toISOString().slice(0, 10) : String(cycle.start_date),
          end_date: cycle.end_date instanceof Date ? cycle.end_date.toISOString().slice(0, 10) : String(cycle.end_date),
        },
        instances.map((r: any) => ({
          id: Number(r.id), provider_id: Number(r.provider_id),
          location_id: r.location_id != null ? Number(r.location_id) : null,
          provider_name: r.provider_name, provider_code: r.provider_code,
          city: r.city, unidade: r.unidade, provider_group: r.provider_group,
          status: r.status, percentual: Number(r.percentual) || 0, seal: r.seal,
          has_certificate: !!r.has_certificate,
          certificate_id: r.certificate_id != null ? Number(r.certificate_id) : null,
          submitted_at: r.submitted_at != null ? new Date(r.submitted_at).toISOString() : null,
          completed_at: r.completed_at != null ? new Date(r.completed_at).toISOString() : null,
          has_survey_response: !!r.has_survey_response,
          pending_count: r.pending_count != null ? Number(r.pending_count) : null,
          prev_plan_pending: !!r.prev_plan_pending,
          prev_plan_dl: !!r.prev_plan_dl,
        })),
        dimPct.map((r: any) => ({
          instance_id: Number(r.instance_id), dimension: r.dimension, pct: Number(r.pct) || 0,
        })),
      );
      res.json(payload);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eval/dashboard/auditor.xlsx', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });

      const cycleIdParam = req.query.cycle_id ? Number(req.query.cycle_id) : null;
      const { rows: cycleRows } = cycleIdParam
        ? await query('SELECT id, label FROM eval_cycles WHERE id = $1', [cycleIdParam])
        : await query('SELECT id, label FROM eval_cycles WHERE active = true');
      if (!cycleRows.length) return res.status(404).json({ error: 'ciclo não encontrado' });
      const cycle = cycleRows[0];

      const { rows: instances } = await query(`
        SELECT ei.id,
               p.name AS provider_name,
               p.sgu_code AS provider_code,
               pl.cidade AS city,
               NULLIF(TRIM(CONCAT_WS(', ',
                 NULLIF(pl.logradouro, ''),
                 NULLIF(pl.numero, ''),
                 NULLIF(pl.bairro, '')
               )), '') AS address,
               ei.percentual, ei.seal, ei.status,
               to_char(ei.started_at, 'YYYY-MM-DD') AS started_at,
               to_char(ei.completed_at, 'YYYY-MM-DD') AS completed_at
          FROM eval_instances ei
          JOIN providers p ON p.id = ei.provider_id
          LEFT JOIN provider_locations pl ON pl.id = ei.location_id
         WHERE ei.cycle_id = $1
         ORDER BY pl.cidade NULLS LAST, ei.id
      `, [cycle.id]);

      const { rows: dimRows } = await query(`
        SELECT ea.instance_id,
               CASE WHEN eq.dimension IN ('Segurança','Documento Legal') THEN 'Segurança' ELSE eq.dimension END AS dimension,
               ROUND((SUM(ea.score_obtained) / NULLIF(SUM(eq.max_score), 0)) * 100)::int AS pct
          FROM eval_answers ea
          JOIN eval_questions eq ON eq.id = ea.question_id
          JOIN eval_instances ei ON ei.id = ea.instance_id
         WHERE ei.cycle_id = $1
           AND ${COUNTS_IN_SCORE_SQL}
           AND eq.dimension IS NOT NULL
         GROUP BY ea.instance_id,
                  CASE WHEN eq.dimension IN ('Segurança','Documento Legal') THEN 'Segurança' ELSE eq.dimension END
      `, [cycle.id]);

      const dimByInst: Record<number, Record<string, number>> = {};
      for (const d of dimRows) {
        const k = Number(d.instance_id);
        if (!dimByInst[k]) dimByInst[k] = {};
        dimByInst[k][d.dimension] = Number(d.pct);
      }

      const { buildAuditorXlsxRows, serializeAuditorXlsx } = await import('./src/lib/auditorXlsx.js');
      const rows = buildAuditorXlsxRows(instances.map((r: any) => ({
        id: Number(r.id),
        provider_name: r.provider_name,
        provider_code: r.provider_code,
        city: r.city, address: r.address,
        percentual: Number(r.percentual) || 0,
        seal: r.seal, status: r.status,
        started_at: r.started_at, completed_at: r.completed_at,
      })), dimByInst);
      const buf = serializeAuditorXlsx(rows);

      const slug = cycle.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="painel-ciclo-${slug}-${stamp}.xlsx"`);
      res.send(buf);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  if (process.env.RETENTION_AUTO_PURGE !== 'false') {
    try {
      const { rows } = await query("SELECT value FROM settings WHERE key = 'data_retention_last_run_at'");
      const raw = rows[0]?.value;
      const parsed = raw ? new Date(raw) : null;
      const last = parsed && !isNaN(parsed.getTime()) ? parsed : new Date(0);
      const hours = (Date.now() - last.getTime()) / 3_600_000;
      if (hours > 24) {
        purgeExpiredLogs(query)
          .then(r => console.log('[retention] expurgo concluído', r))
          .catch(e => console.error('[retention] falhou', e));
      }
    } catch (e) {
      console.error('[retention] não pôde decidir se deve rodar:', e);
    }
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Job automático de abertura/encerramento de ciclos (spec 5.4.1.1).
  // Roda 1× no boot + a cada 1h. Idempotente: openCycleCore/closeCycleCore checam
  // estado antes de agir. Sem retries agressivos — se falhar, próximo tick tenta.
  async function runAutoCycleJobs() {
    try {
      const { rows: toOpen } = await query(`
        SELECT c.id, c.label FROM eval_cycles c
         WHERE c.auto_open = true
           AND c.active = true
           AND c.start_date <= CURRENT_DATE
           AND NOT EXISTS (SELECT 1 FROM eval_instances WHERE cycle_id = c.id)
           AND EXISTS (SELECT 1 FROM eval_cycle_groups WHERE cycle_id = c.id)
      `);
      for (const c of toOpen) {
        const r = await openCycleCore(Number(c.id));
        if (r.ok) {
          console.log(`[auto] ciclo ${c.label} aberto: ${JSON.stringify(r.created)}`);
          await auditLog({ query, userId: null as any, action: 'cycle_opened', meta: { cycle_id: Number(c.id), auto: true, ...r.created }, ip: null as any });
        } else {
          console.warn(`[auto] falha ao abrir ${c.label}: ${r.error}`);
        }
      }

      const { rows: toClose } = await query(`
        SELECT c.id, c.label FROM eval_cycles c
         WHERE c.auto_close = true AND c.active = true AND c.end_date < CURRENT_DATE
      `);
      for (const c of toClose) {
        const r = await closeCycleCore(Number(c.id), true);
        if (r.ok) {
          console.log(`[auto] ciclo ${c.label} encerrado (inconclusive=${r.inconclusive})`);
          await auditLog({ query, userId: null as any, action: 'cycle_closed', meta: { cycle_id: Number(c.id), auto: true, inconclusive: r.inconclusive }, ip: null as any });
        } else {
          console.warn(`[auto] falha ao encerrar ${c.label}: ${r.error}`);
        }
      }
    } catch (e) {
      console.error('[auto] erro no job de ciclos:', e);
    }
  }
  runAutoCycleJobs();
  setInterval(runAutoCycleJobs, 60 * 60 * 1000);

  // Job de notificações (spec 5.4.7): varre condições de prazo (disparo único via
  // dedupe_key) e re-tenta e-mails pendentes/falhos. Idempotente por construção.
  async function runNotificationJobs() {
    try {
      // 1) Ação a vencer em até 15 dias — prestador.
      //    Exclui 'aguardando_revisao': item já concluído pelo prestador e à espera
      //    de validação do auditor não pode receber aviso de vencimento/atraso.
      const { rows: vencendo } = await query(`
        SELECT it.id, it.what, it.due_date, ap.provider_id, ap.location_id
          FROM eval_action_items it
          JOIN eval_action_plans ap ON ap.id = it.plan_id
         WHERE it.status NOT IN ('concluida','aguardando_revisao')
           AND COALESCE(ap.closed_without_completion, false) = false
           AND it.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 15`);
      for (const it of vencendo) {
        await notifyEvent('acao_vencendo', { what: it.what, due_date: it.due_date },
          await prestadorRecipients(Number(it.provider_id), it.location_id ?? null),
          { providerId: Number(it.provider_id), dedupeRef: `item:${it.id}` });
      }

      // 2) Ação em atraso — prestador + auditoria.
      //    Exclui 'aguardando_revisao' pelo mesmo motivo do item (1) acima.
      const { rows: atrasadas } = await query(`
        SELECT it.id, it.what, it.due_date, ap.provider_id, ap.location_id, p.name AS provider_name
          FROM eval_action_items it
          JOIN eval_action_plans ap ON ap.id = it.plan_id
          JOIN providers p ON p.id = ap.provider_id
         WHERE it.status NOT IN ('concluida','aguardando_revisao')
           AND COALESCE(ap.closed_without_completion, false) = false
           AND it.due_date < CURRENT_DATE`);
      for (const it of atrasadas) {
        await notifyEvent('acao_atrasada',
          { what: it.what, due_date: it.due_date, provider_name: it.provider_name },
          [...await prestadorRecipients(Number(it.provider_id), it.location_id ?? null), ...await auditoriaRecipients()],
          { providerId: Number(it.provider_id), dedupeRef: `item:${it.id}` });
      }

      // 3) Roteiro pendente — SÓ E-MAIL (spec). Avisos por marco temporal: 30 dias,
      //    7 dias e no fim do ciclo. Cada marco dispara UMA vez (dedupe por marco);
      //    o fim (days_left <= 0) ainda pega o último dia, pois o auto-close só encerra
      //    em end_date < hoje. Prestador: individual. Auditoria: resumo por ciclo.
      const { rows: pendentes } = await query(`
        SELECT ei.id, ei.provider_id, ei.location_id, c.id AS cycle_id, c.label, c.end_date,
               (c.end_date - CURRENT_DATE) AS days_left
          FROM eval_instances ei
          JOIN eval_cycles c ON c.id = ei.cycle_id
         WHERE ei.status IN ('pendente', 'em_andamento')
           AND c.active = true
           AND c.end_date - 30 <= CURRENT_DATE`);
      for (const inst of pendentes) {
        const marco = roteiroReminderMarco(Number(inst.days_left));
        if (!marco) continue;
        await notifyEvent('roteiro_pendente', { end_date: inst.end_date, marco },
          await prestadorRecipients(Number(inst.provider_id), inst.location_id ?? null),
          { providerId: Number(inst.provider_id), dedupeRef: `inst:${inst.id}:${marco}`, portal: false });
      }
      const byCycle = new Map<number, { label: string; end_date: string; count: number }>();
      for (const inst of pendentes) {
        const c = byCycle.get(Number(inst.cycle_id)) ?? { label: inst.label, end_date: inst.end_date, count: 0 };
        c.count++; byCycle.set(Number(inst.cycle_id), c);
      }
      for (const [cycleId, c] of byCycle) {
        await notifyEvent('roteiro_pendente',
          { digest: true, count: c.count, cycle_label: c.label, end_date: c.end_date },
          await auditoriaRecipients(), { dedupeRef: `cycle:${cycleId}`, portal: false });
      }

      // 4) Certificado a vencer em até 30 dias — prestador.
      const { rows: certs } = await query(`
        SELECT ec.id, ec.valid_until, ei.provider_id, ei.location_id
          FROM eval_certificates ec
          JOIN eval_instances ei ON ei.id = ec.instance_id
         WHERE ec.valid_until - 30 <= CURRENT_DATE AND ec.valid_until >= CURRENT_DATE`);
      for (const ct of certs) {
        await notifyEvent('certificado_vencendo', { valid_until: ct.valid_until },
          await prestadorRecipients(Number(ct.provider_id), ct.location_id ?? null),
          { providerId: Number(ct.provider_id), dedupeRef: `cert:${ct.id}` });
      }

      // 5) Retry do outbox de e-mail (o claim em sendNotificationEmail evita corrida).
      const { rows: retry } = await query(`
        SELECT n.id, n.type, n.ctx, n.email_to, n.body, n.link, ${RECIPIENT_NAME_SQL} AS user_name
          FROM notifications n LEFT JOIN users u ON u.id = n.user_id
         WHERE n.email_status IN ('pendente','falhou') AND n.email_attempts < 3 AND n.email_to IS NOT NULL
         ORDER BY n.id LIMIT 50`);
      for (const n of retry) {
        // Remonta o e-mail completo (card, próximos passos, nome) a partir do ctx gravado —
        // antes o retry usava só título/corpo e saía sem nome e com a data no título.
        const appUrl = notifyAppUrl();
        const link = n.link ?? '/qualificacao';
        const { subject, html } = renderNotificationEmail(n.type, n.ctx ?? {}, appUrl, n.user_name ?? undefined);
        await sendNotificationEmail(Number(n.id), n.email_to, subject,
          `${n.body ?? ''}\n\nAcesse: ${appUrl}${link}`, html);
      }
    } catch (e) {
      console.error('[notify] job de notificações falhou:', e);
    }
  }
  runNotificationJobs();
  setInterval(runNotificationJobs, 60 * 60 * 1000);

  console.log("=== ROUTES REGISTERED ===");
  // Se existe build do cliente (dist/index.html), serve-o estaticamente — caminho de produção.
  // Independe de NODE_ENV e nunca carrega o Vite em produção (import dinâmico só no dev).
  const distIndex = path.join(process.cwd(), 'dist', 'index.html');
  if (fs.existsSync(distIndex)) {
    app.use(express.static('dist'));
    app.get('*', (req, res) => {
      res.sendFile('index.html', { root: 'dist' });
    });
    console.log("Servindo cliente a partir de dist/ (build de produção).");
  } else {
    // Desenvolvimento: sem build, sobe o Vite em middleware mode (carregado sob demanda).
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Servindo cliente via Vite dev middleware.");
  }
}

startServer().catch((err) => {
  console.error('Falha ao iniciar o servidor:', err);
  process.exit(1);
});
