import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { query, pool, withTransaction } from './db/db.js';
import { parseWorkbook } from './db/roteiro-parser.js';
import { generateOtpCode, hashOtp, verifyOtp, isOtpExpired, OTP_TTL_MS, OTP_MAX_ATTEMPTS, isTestMasterOtp } from './auth/otp.js';
import { generateDeviceSecret, hashDeviceSecret, deviceLabelFromUserAgent, isTrustedDeviceValid, TRUSTED_DEVICE_TTL_MS } from './auth/trustedDevice.js';
import { isRateLimited, checkRateLimit, PASSWORD_MAX_FAILURES, PASSWORD_WINDOW_MS } from './auth/rateLimit.js';
import { createMailer } from './auth/mailer.js';
import { generateToken, hashToken, verifyToken, expirationFor } from './auth/setupToken.js';
import { validatePassword } from './auth/passwordPolicy.js';
import { auditLog } from './auth/auditLog.js';
import { hashIp } from './auth/ipHash.js';
import { purgeExpiredLogs } from './db/purgeExpiredLogs.js';

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

// Critérios que, por definição, NÃO têm evidência e portanto não devem disparar
// o aviso "sem evidência" no preview. Hoje só existe um: a participação na
// pesquisa de satisfação da qualificação da rede (coletada automaticamente
// alguns dias após a visita — não é um documento que o prestador apresenta).
const isEvidenceExempt = (text: string): boolean =>
  /pesquisa de satisfa[çc][ãa]o da qualifica[çc][ãa]o da rede/i.test(text || '');

// Critérios opcionais — não bloqueiam /submit nem contam como pendente. Mesmo
// alvo do isEvidenceExempt: a pesquisa de satisfação é preenchida pela Unimed
// após a visita, então o prestador não é obrigado a responder pra enviar.
const isOptionalQuestion = (text: string): boolean =>
  /pesquisa de satisfa[çc][ãa]o da qualifica[çc][ãa]o da rede/i.test(text || '');

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

  const { rows: userCountRows } = await query('SELECT COUNT(*) as count FROM users');
  if (Number(userCountRows[0].count) === 0) {
    const hash = bcrypt.hashSync('senha123', 10);

    // Insert Provider
    const { rows: providerRows } = await query(
      'INSERT INTO providers (name, cnpj, qualification_level, status) VALUES ($1, $2, $3, $4) RETURNING id',
      ['Clínica Saúde Total', '12.345.678/0001-90', 'A', 'Ativo']
    );
    const providerId = providerRows[0].id;

    // Insert Users
    await query('INSERT INTO users (name, email, password, role, provider_id) VALUES ($1, $2, $3, $4, $5)', ['Dr. João Silva', 'prestador@unimed.com', hash, 'prestador', providerId]);
    await query('INSERT INTO users (name, email, password, role, provider_id) VALUES ($1, $2, $3, $4, $5)', ['Admin Unimed', 'admin@unimed.com', hash, 'admin', null]);
    await query('INSERT INTO users (name, email, password, role, provider_id) VALUES ($1, $2, $3, $4, $5)', ['Auditor Carlos', 'auditoria@unimed.com', hash, 'auditoria', null]);
    await query('INSERT INTO users (name, email, password, role, provider_id) VALUES ($1, $2, $3, $4, $5)', ['Dra. Ana Souza', 'cooperado@unimed.com', hash, 'cooperado', null]);

    // Insert Documents
    const insertDocSql = 'INSERT INTO documents (provider_id, type, issue_date, expiry_date, status, file_url) VALUES ($1, $2, $3, $4, $5, $6)';
    await query(insertDocSql, [providerId, 'Alvará Sanitário', '2023-01-10', '2024-01-10', 'vencido', '/docs/alvara.pdf']);
    await query(insertDocSql, [providerId, 'CNES', '2023-05-20', '2024-05-20', 'valido', '/docs/cnes.pdf']);
    await query(insertDocSql, [providerId, 'Contrato Social', '2020-01-01', '2030-01-01', 'valido', '/docs/contrato.pdf']);

    // Insert Tickets
    const insertTicketSql = 'INSERT INTO tickets (provider_id, title, description, category, priority, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)';
    await query(insertTicketSql, [providerId, 'Dúvida sobre Glosa', 'Gostaria de entender o motivo da glosa na fatura 123.', 'Financeiro', 'Média', 'aberto', new Date().toISOString()]);
    await query(insertTicketSql, [providerId, 'Atualização de Endereço', 'Mudamos de endereço, segue comprovante.', 'Cadastro', 'Baixa', 'encerrado', new Date(Date.now() - 86400000 * 5).toISOString()]);

    // Insert Announcements
    const insertAnnouncementSql = 'INSERT INTO announcements (title, description, category, date) VALUES ($1, $2, $3, $4)';
    await query(insertAnnouncementSql, ['Nova Tabela de Honorários', 'A tabela de honorários foi atualizada para 2024.', 'Financeiro', new Date().toISOString()]);
    await query(insertAnnouncementSql, ['Campanha de Vacinação', 'Participem da campanha de vacinação contra a gripe.', 'Geral', new Date(Date.now() - 86400000 * 2).toISOString()]);

    // Insert Trainings
    const insertTrainingSql = 'INSERT INTO trainings (title, description, video_url, pdf_url, validity_days) VALUES ($1, $2, $3, $4, $5) RETURNING id';
    const { rows: t1Rows } = await query(insertTrainingSql, ['Boas Práticas de Faturamento', 'Aprenda a evitar glosas.', 'https://example.com/video1', 'https://example.com/pdf1', 365]);
    const { rows: t2Rows } = await query(insertTrainingSql, ['LGPD na Saúde', 'Treinamento obrigatório sobre proteção de dados.', 'https://example.com/video2', 'https://example.com/pdf2', 365]);

    // Insert Provider Trainings
    const insertProvTrainingSql = 'INSERT INTO provider_trainings (provider_id, training_id, status, completed_at) VALUES ($1, $2, $3, $4)';
    await query(insertProvTrainingSql, [providerId, t1Rows[0].id, 'pendente', null]);
    await query(insertProvTrainingSql, [providerId, t2Rows[0].id, 'concluido', new Date().toISOString()]);

    // Insert Financials
    const insertFinancialSql = 'INSERT INTO financials (provider_id, competence, gross_value, glosa_value, net_value, status) VALUES ($1, $2, $3, $4, $5, $6)';
    await query(insertFinancialSql, [providerId, '01/2024', 50000.00, 2500.00, 47500.00, 'Pago']);
    await query(insertFinancialSql, [providerId, '02/2024', 45000.00, 1000.00, 44000.00, 'Pago']);
    await query(insertFinancialSql, [providerId, '03/2024', 55000.00, 5000.00, 50000.00, 'Aberto']);

    // Insert Audits
    const insertAuditSql = 'INSERT INTO audits (provider_id, scheduled_date, status, evaluation) VALUES ($1, $2, $3, $4)';
    await query(insertAuditSql, [providerId, new Date(Date.now() + 86400000 * 15).toISOString(), 'programada', null]);
    await query(insertAuditSql, [providerId, new Date(Date.now() - 86400000 * 60).toISOString(), 'realizada', 'Aprovado com ressalvas']);

    // Insert Qualifications
    await query('INSERT INTO qualifications (provider_id, cycle, score, status, seal, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [providerId, '2024-2025', 92, 'concluida', 'Ouro', new Date().toISOString()]);

    // Insert Action Plans
    await query('INSERT INTO action_plans (provider_id, title, description, deadline, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [providerId, 'Melhoria no tempo de espera', 'Reduzir o tempo de espera na recepção para menos de 15 minutos.', new Date(Date.now() + 86400000 * 30).toISOString(), 'em_andamento', new Date().toISOString()]);

    // Insert Price Tables
    const insertPriceTableSql = 'INSERT INTO price_tables (provider_id, title, code, version, status, effective_date, file_url, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)';
    await query(insertPriceTableSql, [providerId, 'Tabela de Honorários Médicos', 'THM-2024', 'v1.0', 'vigente', new Date('2024-01-01').toISOString(), '/docs/thm-2024.pdf', new Date().toISOString()]);
    await query(insertPriceTableSql, [providerId, 'Tabela de Materiais e Medicamentos', 'TMM-2024', 'v1.2', 'vigente', new Date('2024-03-01').toISOString(), '/docs/tmm-2024.pdf', new Date().toISOString()]);
    await query(insertPriceTableSql, [null, 'Tabela TUSS Padrão', 'TUSS-2024', 'v2.0', 'vigente', new Date('2024-01-01').toISOString(), '/docs/tuss-2024.pdf', new Date().toISOString()]);
  }

  // Seed qualification cycle + items if empty
  const { rows: cycleCountRows } = await query('SELECT COUNT(*) as count FROM qualification_cycles');
  if (Number(cycleCountRows[0].count) === 0) {
    const { rows: cycleRows } = await query(
      'INSERT INTO qualification_cycles (title, description, active, created_at) VALUES ($1, $2, $3, $4) RETURNING id',
      ['Qualificação Anual 2026', 'Ciclo de qualificação obrigatório para todos os prestadores da rede.', true, new Date().toISOString()]
    );
    const cycleId = cycleRows[0].id;

    const insertItemSql = 'INSERT INTO qualification_items (cycle_id, title, description, is_required) VALUES ($1, $2, $3, $4)';
    await query(insertItemSql, [cycleId, 'Alvará (Localização, Sanitário ou Bombeiros)', 'Cópia do alvará vigente.', true]);
    await query(insertItemSql, [cycleId, 'CNES Ativo', 'Comprovante de inscrição no Cadastro Nacional de Estabelecimentos de Saúde.', true]);
    await query(insertItemSql, [cycleId, 'Relação do Corpo Clínico', 'Lista atualizada dos profissionais com seus respectivos registros (CRM, COREN, etc).', true]);
    await query(insertItemSql, [cycleId, 'PGRSS', 'Plano de Gerenciamento de Resíduos de Serviços de Saúde.', true]);
    await query(insertItemSql, [cycleId, 'Certificado de Regularidade Técnica', 'Certificado emitido pelo conselho de classe.', true]);
    await query(insertItemSql, [cycleId, 'ART - Anotação de Responsabilidade Técnica', 'Documento de Anotação de Responsabilidade Técnica (ART).', true]);
    await query(insertItemSql, [cycleId, 'RQE', 'Registro de Qualificação de Especialista.', false]);
    await query(insertItemSql, [cycleId, 'Certificados/diplomas', 'Cópias dos certificados ou diplomas.', false]);
    await query(insertItemSql, [cycleId, 'Optante pelo Simples Nacional', 'Comprovante de opção pelo Simples Nacional (se aplicável).', false]);
  }

  // Ensure cooperado user exists (idempotent)
  try {
    const hash = bcrypt.hashSync('senha123', 10);
    await query(
      `INSERT INTO users (name, email, password, role, provider_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO NOTHING`,
      ['Dra. Ana Souza', 'cooperado@unimed.com', hash, 'cooperado', null]
    );
  } catch (e) {
    console.error('Error ensuring users:', e);
  }
}

async function startServer() {
  console.log("=== STARTING THE SERVER ===");
  const app = express();
  const mailer = createMailer();
  const PORT = Number(process.env.PORT) || 3000;

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
  app.use(express.json());
  app.use(cookieParser());
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
  // Se o arquivo não existe, retorna 404 explícito — evita cair no SPA fallback
  // (`app.get('*')`) e o React renderizar "página em construção" no lugar do anexo.
  app.use('/uploads', (_req, res) => res.status(404).type('text').send('Arquivo não encontrado'));

  // Seed/init data BEFORE routes are registered.
  await initData();

  // --- API Routes ---

  // Auth Middleware — sessão por cookie httpOnly; mantém fallback ao header Authorization
  // para compatibilidade durante a transição (clientes antigos com token no localStorage).
  const authenticate = (req: any, res: any, next: any) => {
    const fromCookie = req.cookies?.session;
    const authHeader = req.headers.authorization;
    const token = fromCookie || (authHeader ? authHeader.split(' ')[1] : null);
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
      req.user = jwt.verify(token, JWT_SECRET as string);
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };

  const requireAdmin = (req: any, res: any, next: any) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Apenas administradores.' });
    next();
  };

  // Consolida IP_HASH_SECRET num único call-site — todos os auditLog usam este helper.
  const hashClientIp = (req: any): string | null => hashIp(req.ip, IP_HASH_SECRET as string);

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

  const isProd = process.env.NODE_ENV === 'production';

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
    const isCooperado = /^MEDICOS COOPERADOS(\s+ARARANGUA)?$/i.test(String(providerGroup ?? '').trim());
    const token = jwt.sign(
      { id: user.id, name: user.name, role: user.role, provider_id: user.provider_id },
      JWT_SECRET as string,
      { expiresIn: '24h' },
    );
    res.cookie('session', token, {
      httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000,
    });
    return {
      user: {
        id: user.id, name: user.name, email: user.email, role: user.role,
        provider_id: user.provider_id, provider_person_type: providerPersonType,
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
  const findValidTrustedDevice = async (userId: number, secret: string | undefined) => {
    if (!secret) return null;
    const hash = hashDeviceSecret(secret);
    const { rows } = await query(
      'SELECT * FROM trusted_devices WHERE user_id = $1 AND token_hash = $2',
      [userId, hash],
    );
    const device = rows[0] as any;
    if (!device) return null;
    return isTrustedDeviceValid({ expiresAt: device.expires_at, revokedAt: device.revoked_at }, new Date())
      ? device : null;
  };

  // Cria um desafio OTP, envia o e-mail e devolve o id do desafio.
  const createOtpChallenge = async (user: any, req: any): Promise<number> => {
    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    const { rows } = await query(
      'INSERT INTO otp_codes (user_id, code_hash, expires_at, ip) VALUES ($1, $2, $3, $4) RETURNING id',
      [user.id, hashOtp(code), expiresAt, req.ip],
    );
    await mailer.sendOtp(user.email, code);
    return rows[0].id;
  };

  // Bloqueio por excesso de falhas recentes (conta na trilha access_logs).
  const isLoginBlocked = async (email: string): Promise<boolean> => {
    const { rows } = await query(
      `SELECT created_at FROM access_logs
        WHERE email = $1 AND success = false
          AND created_at > now() - interval '15 minutes'`,
      [email],
    );
    return isRateLimited(rows.map((r: any) => r.created_at), new Date(), PASSWORD_WINDOW_MS, PASSWORD_MAX_FAILURES);
  };

  // Login — etapa 1: senha. Emite sessão se o dispositivo for confiável; senão, dispara OTP.
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (email && await isLoginBlocked(email)) {
        return res.status(429).json({ error: 'Muitas tentativas. Tente novamente em alguns minutos.' });
      }
      const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
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
      const device = await findValidTrustedDevice(user.id, req.cookies?.trusted_device);
      if (device) {
        await query('UPDATE trusted_devices SET last_used_at = now(), last_ip = $1 WHERE id = $2',
          [req.ip, device.id]);
        const previousLoginAt = await finalizeLogin(user, req);
        return res.json(await issueSession(res, user, previousLoginAt));
      }
      try {
        const challengeId = await createOtpChallenge(user, req);
        return res.json({ needs_otp: true, challenge_id: challengeId });
      } catch (mailErr: any) {
        console.error('Falha ao enviar OTP:', mailErr);
        return res.status(502).json({ error: 'Não foi possível enviar o código por e-mail. Tente novamente.' });
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
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
      const { rows: userRows } = await query('SELECT email FROM users WHERE id = $1', [challenge.user_id]);
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
        await mailer.sendOtp(user.email, code);
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

  // Esqueci a senha — sempre responde { ok: true } para evitar enumeração de e-mails.
  // Rate-limit duplo (IP e e-mail) usa access_logs como fonte de verdade.
  app.post('/api/auth/forgot-password', async (req: any, res) => {
    try {
      const { email } = req.body ?? {};
      if (typeof email !== 'string') return res.json({ ok: true });

      const emailLc = email.trim().toLowerCase();

      const ipOk = await checkRateLimit('', req.ip ?? '', 'password_reset_requested', 60, 10);
      const emailOk = await checkRateLimit(emailLc, '', 'password_reset_requested', 60, 5);
      if (!ipOk || !emailOk) return res.json({ ok: true });

      const { rows } = await query(
        'SELECT id, email FROM users WHERE LOWER(email) = $1 AND is_active = true',
        [emailLc],
      );
      const user = rows[0] as any;

      await auditLog({
        query, action: 'password_reset_requested',
        meta: { exists: !!user },
        ip: hashClientIp(req),
      });

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
      await mailer.sendPasswordReset(user.email, link);

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

      const ipOk = await checkRateLimit('', req.ip ?? '', 'redeem_token', 60, 10);
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
          `UPDATE users SET password = $1, invite_status = 'accepted' WHERE id = $2`,
          [pwHash, matched.user_id],
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

  // Logout — limpa apenas o cookie de sessão (trusted_device segue valendo).
  app.post('/api/auth/logout', (_req, res) => {
    res.clearCookie('session');
    res.json({ ok: true });
  });

  // Dados do usuário autenticado (substitui leitura do localStorage no frontend).
  app.get('/api/auth/me', authenticate, async (req: any, res) => {
    const { rows } = await query(
      'SELECT id, name, email, role, provider_id, last_login_at FROM users WHERE id = $1',
      [req.user.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json({ user: rows[0] });
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
      await mailer.sendInvite(newUser.email, newUser.name, link);

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
        `SELECT id, name, email, role, is_active, invite_status, last_login_at, created_at
         FROM users
         ORDER BY created_at DESC`
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

      const { rows: targetRows } = await query('SELECT id, role, is_active FROM users WHERE id = $1', [targetId]);
      const target = targetRows[0];
      if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });

      const { role: newRole, is_active: newActive } = req.body ?? {};

      if (typeof newRole !== 'undefined') {
        if (newRole !== 'admin' && newRole !== 'auditoria' && newRole !== 'prestador' && newRole !== 'cooperado') {
          return res.status(400).json({ error: 'Role inválida.' });
        }
        if (targetId === req.user.id && target.role === 'admin' && newRole !== 'admin') {
          return res.status(400).json({ error: 'Você não pode rebaixar a própria conta.' });
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

      if (updates.length === 0) {
        const { rows } = await query('SELECT id, name, email, role, is_active, invite_status, last_login_at FROM users WHERE id = $1', [targetId]);
        return res.json(rows[0]);
      }

      params.push(targetId);
      const { rows } = await query(
        `UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length}
         RETURNING id, name, email, role, is_active, invite_status, last_login_at`,
        params
      );

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

      const { rows: targetRows } = await query('SELECT id, name, email, invite_status FROM users WHERE id = $1', [targetId]);
      const target = targetRows[0];
      if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
      if (target.invite_status === 'accepted') {
        return res.status(409).json({ error: 'Usuário já definiu senha. Oriente-o a usar "Esqueci minha senha".' });
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
      await mailer.sendInvite(target.email, target.name, link);

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

        // Distribuição de selos: por prestador, considera a avaliação finalizada mais recente.
        const { rows: sealDistribution } = await query(
          `SELECT seal, COUNT(*)::int AS count
             FROM (
               SELECT DISTINCT ON (provider_id) provider_id, seal
                 FROM eval_instances
                WHERE seal IS NOT NULL AND status IN ('finalizado','aprovado')
                ORDER BY provider_id, completed_at DESC NULLS LAST, started_at DESC
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
                   (SELECT jsonb_agg(jsonb_build_object('cidade', x.cidade, 'uf', x.uf))
                      FROM (SELECT DISTINCT cidade, uf FROM provider_locations
                             WHERE provider_id = p.id AND cidade IS NOT NULL AND cidade <> ''
                             ORDER BY cidade) x),
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
      const { rows: lastSubmissionRows } = await query(
        `SELECT qs.id, qs.status, qs.created_at, qc.title AS cycle_title
           FROM qualification_submissions qs
           JOIN qualification_cycles qc ON qc.id = qs.cycle_id
          WHERE qs.provider_id = $1
          ORDER BY qs.created_at DESC
          LIMIT 1`,
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
          last_qualification_submission: lastSubmissionRows[0]
            ? {
                id: lastSubmissionRows[0].id,
                cycle_title: lastSubmissionRows[0].cycle_title,
                status: lastSubmissionRows[0].status,
                created_at: lastSubmissionRows[0].created_at,
              }
            : null,
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

  // === Gestão de Acessos do prestador (Tela 4 da spec) — acesso único, foco LGPD ===
  const PROVIDER_ACCESS_ROLES = ['prestador', 'cooperado'];

  async function findProviderUser(providerId: string) {
    const { rows } = await query(
      `SELECT id, name, email, role, is_active, last_login_at, last_login_ip, invite_status
         FROM users
        WHERE provider_id = $1 AND role = ANY($2)
        ORDER BY id ASC LIMIT 1`,
      [providerId, PROVIDER_ACCESS_ROLES],
    );
    return rows[0] ?? null;
  }

  app.get('/api/providers/:id/access', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      const { rows: provRows } = await query('SELECT id, name FROM providers WHERE id = $1', [req.params.id]);
      if (!provRows[0]) return res.status(404).json({ error: 'Prestador não encontrado' });
      const user = await findProviderUser(req.params.id);
      res.json({ exists: !!user, provider_name: provRows[0].name, user });
    } catch (err: any) {
      console.error('GET /providers/:id/access:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Cria (se não existe) ou atualiza o acesso único do prestador. Só admin.
  app.post('/api/providers/:id/access', authenticate, requireAdmin, async (req: any, res) => {
    try {
      const providerId = req.params.id;
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ error: 'E-mail inválido.' });
      }
      if (password && password.length < 8) {
        return res.status(400).json({ error: 'A senha deve ter ao menos 8 caracteres.' });
      }
      const { rows: provRows } = await query('SELECT id, name FROM providers WHERE id = $1', [providerId]);
      if (!provRows[0]) return res.status(404).json({ error: 'Prestador não encontrado' });

      const existing = await findProviderUser(providerId);
      try {
        if (existing) {
          if (password) {
            const pwHash = await bcrypt.hash(password, 10);
            await query(`UPDATE users SET email = $1, password = $2, invite_status = 'accepted' WHERE id = $3`, [email, pwHash, existing.id]);
          } else {
            await query('UPDATE users SET email = $1 WHERE id = $2', [email, existing.id]);
          }
          await auditLog({
            query, userId: req.user.id, action: 'provider_access_updated',
            meta: { provider_id: Number(providerId), user_id: existing.id, password_changed: !!password },
            ip: hashClientIp(req),
          });
        } else {
          if (!password) return res.status(400).json({ error: 'Defina uma senha para criar o acesso do prestador.' });
          const pwHash = await bcrypt.hash(password, 10);
          const { rows: created } = await query(
            `INSERT INTO users (name, email, password, role, provider_id, is_active, invite_status)
             VALUES ($1, $2, $3, 'prestador', $4, true, 'accepted') RETURNING id`,
            [provRows[0].name, email, pwHash, providerId],
          );
          await auditLog({
            query, userId: req.user.id, action: 'provider_access_created',
            meta: { provider_id: Number(providerId), user_id: created[0].id },
            ip: hashClientIp(req),
          });
        }
      } catch (e: any) {
        if (e?.code === '23505') return res.status(409).json({ error: 'Este e-mail já está em uso por outro usuário.' });
        throw e;
      }
      const user = await findProviderUser(providerId);
      res.json({ exists: !!user, user });
    } catch (err: any) {
      console.error('POST /providers/:id/access:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Dispara e-mail de redefinição de senha para o acesso do prestador. Só admin.
  app.post('/api/providers/:id/access/send-reset', authenticate, requireAdmin, async (req: any, res) => {
    try {
      const user = await findProviderUser(req.params.id);
      if (!user) return res.status(404).json({ error: 'Este prestador ainda não tem acesso cadastrado.' });
      if (!user.is_active) return res.status(400).json({ error: 'Usuário inativo.' });

      await query(`UPDATE password_setup_tokens SET used_at = now() WHERE user_id = $1 AND kind = 'reset' AND used_at IS NULL`, [user.id]);
      const token = generateToken();
      const tokenHash = await hashToken(token);
      const expiresAt = expirationFor('reset');
      await query(`INSERT INTO password_setup_tokens (user_id, token_hash, kind, expires_at) VALUES ($1, $2, 'reset', $3)`, [user.id, tokenHash, expiresAt]);
      const appUrl = process.env.APP_URL ?? `${req.protocol}://${req.get('host')}`;
      await mailer.sendPasswordReset(user.email, `${appUrl}/definir-senha?token=${token}`);
      await auditLog({
        query, userId: req.user.id, action: 'password_reset_requested',
        meta: { provider_id: Number(req.params.id), user_id: user.id, by_admin: true },
        ip: hashClientIp(req),
      });
      res.json({ ok: true });
    } catch (err: any) {
      console.error('POST /providers/:id/access/send-reset:', err);
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
      // Enriquece com al.meta e junta o rótulo da unidade quando meta.location_id existe
      // (avaliações por unidade). Evento de outra natureza segue com location_label null.
      const { rows: events } = await query(
        `SELECT al.id, al.action, al.success, al.ip_hash, al.created_at, al.meta,
                u.name AS actor_name, u.email AS actor_email,
                COALESCE(pl.label, pl.cidade) AS location_label
           FROM access_logs al
           LEFT JOIN users u ON u.id = al.user_id
           LEFT JOIN provider_locations pl
                  ON pl.id = NULLIF(al.meta->>'location_id','')::int
          WHERE al.user_id = ANY($1::int[])
             OR al.meta->>'provider_id' = $2
          ORDER BY al.created_at DESC
          LIMIT 100`,
        [userIds.length ? userIds : [-1], String(req.params.id)],
      );
      res.json({ events });
    } catch (err: any) {
      console.error('GET /providers/:id/audit:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Qualification Scripts
  app.get('/api/qualification-scripts', authenticate, async (req: any, res) => {
    try {
      const { rows: scripts } = await query('SELECT * FROM qualification_scripts ORDER BY created_at DESC');
      res.json(scripts);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/qualification-scripts', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      const { title, items } = req.body;
      if (!title || !items || !Array.isArray(items)) {
        return res.status(400).json({ error: 'Title and items array are required' });
      }
      try {
        const { rows } = await query(
          'INSERT INTO qualification_scripts (title, items, created_at) VALUES ($1, $2, $3) RETURNING id',
          [title, JSON.stringify(items), new Date().toISOString()]
        );
        res.json({ id: rows[0].id, title, items });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/qualification-scripts/:id', authenticate, async (req: any, res) => {
    try {
      const { role } = req.user;
      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }
      try {
        await query('DELETE FROM qualification_scripts WHERE id = $1', [req.params.id]);
        res.json({ success: true });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
    } catch (err: any) {
      console.error(err);
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

  // Surveys
  app.get('/api/surveys', authenticate, async (req: any, res) => {
    try {
      let { role, provider_id, id: user_id } = req.user;

      // Fallback to check DB if token is stale
      if (!provider_id && role !== 'admin' && role !== 'auditoria') {
        const { rows } = await query('SELECT provider_id FROM users WHERE id = $1', [user_id]);
        const dbUser = rows[0] as any;
        if (dbUser && dbUser.provider_id) {
          provider_id = dbUser.provider_id;
        }
      }

      if (role === 'admin' || role === 'auditoria') {
        const { rows: surveys } = await query(`
          SELECT s.*, p.name as provider_name, p.cnpj as provider_cnpj
          FROM survey_responses s
          JOIN providers p ON s.provider_id = p.id
          ORDER BY s.created_at DESC
        `);
        res.json(surveys);
      } else if (provider_id) {
        const { rows: surveys } = await query('SELECT * FROM survey_responses WHERE provider_id = $1 ORDER BY created_at DESC', [provider_id]);
        res.json(surveys);
      } else {
        res.json([]);
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/surveys', authenticate, async (req: any, res) => {
    try {
      let { provider_id, id: user_id } = req.user;

      // Fallback to check DB if token is stale
      if (!provider_id) {
        const { rows } = await query('SELECT provider_id FROM users WHERE id = $1', [user_id]);
        const dbUser = rows[0] as any;
        if (dbUser && dbUser.provider_id) {
          provider_id = dbUser.provider_id;
        }
      }

      if (!provider_id) {
        return res.status(403).json({ error: 'Apenas prestadores podem responder pesquisas' });
      }
      const { atendimento, comunicacao, sugestoes } = req.body;
      if (!atendimento || !comunicacao) {
        return res.status(400).json({ error: 'Campos obrigatórios faltando' });
      }
      try {
        const { rows } = await query(
          'INSERT INTO survey_responses (provider_id, atendimento, comunicacao, sugestoes, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [provider_id, atendimento, comunicacao, sugestoes || null, new Date().toISOString()]
        );
        await auditLog({
          query, userId: user_id, action: 'survey_submitted',
          meta: { provider_id: Number(provider_id), survey_id: rows[0].id },
          ip: hashClientIp(req),
        });
        res.json({ id: rows[0].id, success: true });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
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

  // Qualifications
  app.get('/api/qualifications/cycles', authenticate, async (req: any, res) => {
    try {
      const { rows: cycles } = await query('SELECT * FROM qualification_cycles ORDER BY id DESC');
      const { rows: items } = await query('SELECT * FROM qualification_items');

      const cyclesWithItems = cycles.map((c: any) => ({
        ...c,
        items: items.filter((i: any) => i.cycle_id === c.id)
      }));

      res.json(cyclesWithItems);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/qualifications/submissions', authenticate, async (req: any, res) => {
    try {
      const { provider_id, role } = req.user;
      let submissions;

      if (role === 'admin' || role === 'auditoria') {
        const result = await query(`
          SELECT s.*, p.name as provider_name, c.title as cycle_title
          FROM qualification_submissions s
          JOIN providers p ON s.provider_id = p.id
          JOIN qualification_cycles c ON s.cycle_id = c.id
          ORDER BY s.created_at DESC
        `);
        submissions = result.rows;
      } else if (provider_id) {
        const result = await query(`
          SELECT s.*, c.title as cycle_title
          FROM qualification_submissions s
          JOIN qualification_cycles c ON s.cycle_id = c.id
          WHERE s.provider_id = $1
          ORDER BY s.created_at DESC
        `, [provider_id]);
        submissions = result.rows;
      } else {
        return res.json([]);
      }

      res.json(submissions);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/qualifications/submissions/:id', authenticate, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { provider_id, role } = req.user;

      const { rows: subRows } = await query(`
        SELECT s.*, p.name as provider_name, c.title as cycle_title
        FROM qualification_submissions s
        JOIN providers p ON s.provider_id = p.id
        JOIN qualification_cycles c ON s.cycle_id = c.id
        WHERE s.id = $1
      `, [id]);
      const submission = subRows[0] as any;

      if (!submission) return res.status(404).json({ error: 'Submission not found' });

      if (role === 'prestador' && submission.provider_id !== provider_id) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const { rows: items } = await query(`
        SELECT si.*, i.title, i.description, i.is_required
        FROM qualification_submission_items si
        JOIN qualification_items i ON si.item_id = i.id
        WHERE si.submission_id = $1
      `, [id]);

      submission.items = items;
      res.json(submission);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/qualifications/submissions', authenticate, upload.any(), async (req: any, res) => {
    try {
      const { provider_id, role } = req.user;
      const { cycle_id, items } = req.body; // items is a JSON string mapping item_id to details

      const targetProviderId = role === 'prestador' ? provider_id : req.body.provider_id;

      if (!targetProviderId) return res.status(400).json({ error: 'Provider ID required' });

      const parsedItems = JSON.parse(items || '{}');
      const files = req.files as Express.Multer.File[];

      const submissionId = await withTransaction(async (client) => {
        const { rows: subRows } = await client.query(
          'INSERT INTO qualification_submissions (provider_id, cycle_id, status, submitted_at, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [targetProviderId, cycle_id, 'em_analise', new Date().toISOString(), new Date().toISOString()]
        );
        const subId = subRows[0].id;

        for (const [itemIdStr, details] of Object.entries(parsedItems)) {
          const itemId = parseInt(itemIdStr);
          const itemDetails: any = details;
          const file = files?.find(f => f.fieldname === `evidence_${itemId}`);
          const fileUrl = file ? `/uploads/${file.filename}` : null;

          await client.query(
            'INSERT INTO qualification_submission_items (submission_id, item_id, is_compliant, evidence_url, auditor_status, text_answer, justification, is_na) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [
              subId,
              itemId,
              itemDetails.is_compliant ? true : false,
              fileUrl,
              'pendente',
              itemDetails.text_answer || null,
              itemDetails.justification || null,
              itemDetails.is_na ? true : false
            ]
          );
        }

        return subId;
      });

      await auditLog({
        query, userId: req.user.id, action: 'qualification_submitted',
        meta: { provider_id: Number(targetProviderId), submission_id: submissionId, cycle_id: Number(cycle_id) },
        ip: hashClientIp(req),
      });
      res.json({ id: submissionId, message: 'Submission created successfully' });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/qualifications/submissions/:id/evaluate', authenticate, async (req: any, res) => {
    try {
      const { role, id: user_id } = req.user;
      const { id } = req.params;
      const { final_status, final_observations, item_evaluations } = req.body;

      if (role !== 'admin' && role !== 'auditoria') {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const subProviderId = await withTransaction(async (client) => {
        const { rows: subRows } = await client.query(
          'UPDATE qualification_submissions SET status = $1, evaluated_at = $2, evaluated_by = $3, final_observations = $4 WHERE id = $5 RETURNING provider_id',
          [final_status, new Date().toISOString(), user_id, final_observations || null, id]
        );

        if (item_evaluations) {
          for (const [itemIdStr, evalData] of Object.entries(item_evaluations as Record<string, any>)) {
            await client.query(
              'UPDATE qualification_submission_items SET auditor_status = $1, auditor_observation = $2 WHERE submission_id = $3 AND item_id = $4',
              [evalData.status, evalData.observation || null, id, parseInt(itemIdStr)]
            );
          }
        }
        return subRows[0]?.provider_id ?? null;
      });

      if (subProviderId != null) {
        await auditLog({
          query, userId: user_id, action: 'qualification_evaluated',
          meta: { provider_id: Number(subProviderId), submission_id: Number(id), final_status },
          ip: hashClientIp(req),
        });
      }
      res.json({ message: 'Evaluation saved successfully' });
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

      const errors: string[] = [];
      if (!parsed.version) errors.push('A planilha não informa o número da revisão.');
      if (!parsed.revisaoDate) errors.push('A planilha não informa a data da revisão.');
      if (!parsed.implantacaoDate) errors.push('A planilha não informa a data de implantação.');
      if (parsed.version || parsed.revisaoDate) {
        const { rows: dupRows } = await query(
          'SELECT version, revisao_date FROM eval_scripts WHERE source_file = $1',
          [parsed.sourceFile],
        );
        if (parsed.version && (dupRows as any[]).some((r) => String(r.version) === parsed.version)) {
          errors.push(`Já existe uma versão com a revisão ${parsed.version} para este roteiro.`);
        }
        if (parsed.revisaoDate && (dupRows as any[]).some((r) => String(r.revisao_date).slice(0, 10) === parsed.revisaoDate)) {
          errors.push(`Já existe uma versão com a data de revisão ${isoToBR(parsed.revisaoDate)} para este roteiro.`);
        }
      }

      res.json({
        title: parsed.title,
        version: parsed.version,
        revisaoDate: parsed.revisaoDate,
        implantacaoDate: parsed.implantacaoDate,
        sourceFile: parsed.sourceFile,
        sectionCount: parsed.sections.length,
        questionCount: parsed.questions.length,
        totalMaxScore,
        dimensions,
        warnings: {
          orphans: parsed.orphans,
          noWeight: parsed.questions.filter((q) => !q.maxScore).length,
          noEvidence: parsed.questions.filter((q) => !q.guidance && !isEvidenceExempt(q.text)).length,
          noHeader,
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
      if (!parsed.version) return res.status(422).json({ error: 'A planilha não informa o número da revisão.' });
      if (!parsed.revisaoDate) return res.status(422).json({ error: 'A planilha não informa a data da revisão.' });
      if (!parsed.implantacaoDate) return res.status(422).json({ error: 'A planilha não informa a data de implantação.' });

      const { rows: dupRows } = await query(
        'SELECT version, revisao_date FROM eval_scripts WHERE source_file = $1',
        [parsed.sourceFile],
      );
      if ((dupRows as any[]).some((r) => String(r.version) === parsed.version)) {
        return res.status(409).json({ error: `Já existe uma versão com a revisão ${parsed.version} para este roteiro.` });
      }
      if ((dupRows as any[]).some((r) => String(r.revisao_date).slice(0, 10) === parsed.revisaoDate)) {
        return res.status(409).json({ error: `Já existe uma versão com a data de revisão ${isoToBR(parsed.revisaoDate)} para este roteiro.` });
      }

      try {
        const result = await withTransaction(async (client) => {
          const { rows: sr } = await client.query(
            `INSERT INTO eval_scripts (title, description, version, source_file, revisao_date, implantacao_date, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING id`,
            [parsed.title, parsed.description, parsed.version, parsed.sourceFile, parsed.revisaoDate, parsed.implantacaoDate],
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
          for (const q of parsed.questions) {
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
               q.dimension, q.documentType, q.guidance, q.evidenceRequired, q.isEliminatory, q.order],
            );
          }
          return { id: scriptId, version: parsed.version };
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
        res.json({ success: true });
      } catch (err: any) {
        res.status(400).json({ error: err.message });
      }
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
      const scripts = (role === 'prestador' || role === 'cooperado')
        ? (await query(
            `SELECT s.* FROM eval_scripts s
             JOIN providers p ON p.eval_script_id = s.id
             WHERE p.id = $1
             ORDER BY s.created_at DESC`, [provider_id])).rows
        : (await query('SELECT * FROM eval_scripts ORDER BY created_at DESC')).rows;

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
          SELECT eq.id, eq.text as title, eq.code, eq.evidence_required, eq.max_score
          FROM eval_questions eq
          JOIN eval_sections es ON eq.section_id = es.id
          WHERE es.script_id = $1
          ORDER BY eq.order_index ASC
        `, [script.id]);
        const semEvidencia = (questions as any[])
          .filter((q) => !q.evidence_required && !isEvidenceExempt(q.title))
          .map((q) => ({ code: q.code, text: q.title }));
        const semPeso = (questions as any[])
          .filter((q) => !Number(q.max_score)) // numeric chega como string; "0"/null/NaN → sem peso
          .map((q) => ({ code: q.code, text: q.title }));
        const isCurrent = !script.source_file
          || scriptVersionNum(script.version) === maxBySource.get(script.source_file);
        const { rows: usage } = await query('SELECT count(*)::int AS n FROM eval_instances WHERE script_id = $1', [script.id]);
        const usageCount = (usage[0] as any)?.n ?? 0;
        scriptsWithItems.push({ ...script, items: questions, is_current: isCurrent, alerts: { semEvidencia, semPeso }, usage_count: usageCount });
      }
      res.json(scriptsWithItems);
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eval/scripts/:id', authenticate, async (req: any, res) => {
    try {
      const { rows: scriptRows } = await query('SELECT * FROM eval_scripts WHERE id = $1', [req.params.id]);
      const script = scriptRows[0] as any;
      if (!script) return res.status(404).json({ error: 'Script not found' });

      const { rows: sections } = await query('SELECT * FROM eval_sections WHERE script_id = $1 ORDER BY order_index ASC', [req.params.id]);

      const { rows: questions } = await query(`
        SELECT eq.* FROM eval_questions eq
        JOIN eval_sections es ON eq.section_id = es.id
        WHERE es.script_id = $1
        ORDER BY eq.order_index ASC
      `, [req.params.id]);

      res.json({ ...script, sections, questions });
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
      const { rows } = await query(`
        INSERT INTO eval_instances (script_id, provider_id, location_id, status, started_at)
        VALUES ($1, $2, $3, 'em_andamento', $4) RETURNING id
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
        'SELECT id, name, trade_name, person_type, provider_group, eval_script_id FROM providers WHERE id = $1',
        [provider_id],
      );
      const provider = rows[0];
      if (!provider) return res.json(null);
      // Unidades comerciais (exclui residencial) para permitir avaliação por local.
      const { rows: locations } = await query(
        `SELECT id, label, cidade, uf, logradouro, numero, bairro
           FROM provider_locations
          WHERE provider_id = $1
            AND COALESCE(label,'') NOT ILIKE 'residencial%'
            AND COALESCE(sgu_location_code,'') !~ '-RES$'
          ORDER BY is_primary DESC NULLS LAST, id ASC`,
        [provider_id],
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
          COALESCE(pl.label, pl.cidade) AS location_label,
          pl.cidade AS location_cidade, pl.uf AS location_uf,
          (SELECT count(*)::int FROM eval_questions eq
             JOIN eval_sections es ON eq.section_id = es.id
            WHERE es.script_id = ei.script_id) AS total_questions,
          (SELECT count(*)::int FROM eval_answers ea
            WHERE ea.instance_id = ei.id AND ea.answer_value IS NOT NULL) AS answered_count
        FROM eval_instances ei
        JOIN eval_scripts s ON ei.script_id = s.id
        JOIN providers p ON ei.provider_id = p.id
        LEFT JOIN provider_locations pl ON pl.id = ei.location_id
      `;
      let instances;
      if (role === 'admin' || role === 'auditoria') {
        const result = await query(baseQuery + ' ORDER BY ei.started_at DESC');
        instances = result.rows;
      } else {
        const result = await query(baseQuery + ' WHERE ei.provider_id = $1 ORDER BY ei.started_at DESC', [provider_id]);
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
               COALESCE(pl.label, pl.cidade) AS location_label,
               pl.cidade AS location_cidade, pl.uf AS location_uf
        FROM eval_instances ei
        JOIN eval_scripts s ON ei.script_id = s.id
        JOIN providers p ON ei.provider_id = p.id
        LEFT JOIN provider_locations pl ON pl.id = ei.location_id
        WHERE ei.id = $1
      `, [req.params.id]);
      const instance = instanceRows[0] as any;

      if (!instance) return res.status(404).json({ error: 'Instance not found' });

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

      res.json({ ...instance, answers, evidences, iterations });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  // Carrega a instância garantindo posse (anti-IDOR). Prestador só acessa a própria;
  // admin/auditoria acessam qualquer uma. Responde 404/403 e retorna null se negado.
  const loadInstanceForWrite = async (req: any, res: any): Promise<any | null> => {
    const { rows } = await query('SELECT id, provider_id, location_id, status, script_id FROM eval_instances WHERE id = $1', [req.params.id]);
    const instance = rows[0] as any;
    if (!instance) {
      res.status(404).json({ error: 'Avaliação não encontrada' });
      return null;
    }
    const { role, provider_id } = req.user;
    const isStaff = role === 'admin' || role === 'auditoria';
    if (!isStaff && String(instance.provider_id) !== String(provider_id)) {
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

      const actorRole = req.user.role === 'prestador' || req.user.role === 'cooperado' ? 'prestador' : 'auditor';
      await withTransaction(async (client) => {
        // Ao primeiro save, sai de 'pendente' pra 'em_andamento' (5.4.2.2).
        if (instance.status === 'pendente') {
          await client.query(`UPDATE eval_instances SET status = 'em_andamento' WHERE id = $1 AND status = 'pendente'`, [instanceId]);
        }
        for (const ans of answers as any[]) {
          // Lê o valor anterior pra decidir se grava iteration (só quando de fato mudou).
          const { rows: prevRows } = await client.query(
            `SELECT id, answer_value, score_obtained, provider_observation
               FROM eval_answers WHERE instance_id = $1 AND question_id = $2`,
            [instanceId, ans.question_id]
          );
          const prev = prevRows[0];
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

  app.post('/api/eval/instances/:id/submit', authenticate, async (req: any, res) => {
    try {
      const instance = await loadInstanceForWrite(req, res);
      if (!instance) return;
      if (!['em_andamento', 'aguardando_evidencia'].includes(instance.status)) {
        return res.status(409).json({ error: `status ${instance.status} não permite submit` });
      }

      // Completude: toda eval_questions do script precisa ter answer com answer_value não vazio.
      // Opcionais (isOptionalQuestion) ficam de fora — a pesquisa de satisfação é coletada
      // pela Unimed após a visita, não bloqueia o envio.
      const { rows: missingRaw } = await query(`
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
      const missing = missingRaw.filter((r: any) => !isOptionalQuestion(r.text));
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

      await query(`UPDATE eval_instances SET status = 'em_analise' WHERE id = $1`, [req.params.id]);

      await auditLog({
        query, userId: req.user.id, action: 'evaluation_submitted',
        meta: {
          provider_id: Number(instance.provider_id),
          instance_id: Number(req.params.id),
          location_id: instance.location_id ?? null,
        },
        ip: hashClientIp(req),
      });
      res.json({ success: true });
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
      const { rows } = await query(
        `UPDATE eval_instances SET status = 'aguardando_evidencia'
          WHERE id = $1 RETURNING id, provider_id, location_id, status`,
        [id]
      );
      if (!rows.length) return res.status(404).json({ error: 'instance not found' });

      await auditLog({
        query, userId: req.user.id, action: 'evaluation_reopened',
        meta: {
          provider_id: Number(rows[0].provider_id),
          instance_id: id,
          location_id: rows[0].location_id ?? null,
        },
        ip: hashClientIp(req),
      });
      res.json({ success: true, new_status: rows[0].status });
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

      // Cada evidência é um row novo (permite múltiplos anexos por questão).
      const { rows: docRows } = await query(`
        INSERT INTO documents (provider_id, type, issue_date, status, file_url, uploaded_by, reference_id, question_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [providerId, 'qualificacao_evidencia', new Date().toISOString(), 'valido', fileUrl, req.user.id, instanceId, questionId]);

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

      const { rows: totalRows } = await query('SELECT COUNT(*) as count FROM eval_instances');
      // Qualificados = prestadores únicos com pelo menos 1 unidade finalizada com selo
      // (uma unidade não conta 3× se o prestador tem 3 unidades avaliadas).
      const { rows: approvedRows } = await query(
        "SELECT COUNT(DISTINCT provider_id) as count FROM eval_instances WHERE status = 'finalizado' AND seal IS NOT NULL"
      );
      const { rows: evaluatedProvidersRows } = await query(
        'SELECT COUNT(DISTINCT provider_id)::int AS count FROM eval_instances'
      );
      const { rows: avgRows } = await query("SELECT AVG(percentual) as avg FROM eval_instances WHERE status = 'finalizado'");

      const { rows: instancesByStatus } = await query("SELECT status, COUNT(*) as count FROM eval_instances GROUP BY status");

      const { rows: ncRows } = await query(
        'SELECT COUNT(*)::int AS count FROM eval_answers WHERE is_non_compliant = true'
      );

      const { rows: sealRows } = await query(`
        SELECT COALESCE(seal, 'Não Qualificado') AS name, COUNT(*)::int AS value
        FROM eval_instances WHERE status = 'finalizado'
        GROUP BY COALESCE(seal, 'Não Qualificado')
      `);

      const { rows: rankingRows } = await query(`
        SELECT COALESCE(p.trade_name, p.name) AS provider,
               ROUND(ei.percentual)::int AS score, ei.seal,
               COALESCE(pl.label, pl.cidade) AS location_label
        FROM eval_instances ei
        JOIN providers p ON p.id = ei.provider_id
        LEFT JOIN provider_locations pl ON pl.id = ei.location_id
        WHERE ei.status = 'finalizado'
        ORDER BY ei.percentual DESC
        LIMIT 10
      `);

      const { rows: evoRows } = await query(`
        SELECT to_char(date_trunc('month', completed_at), 'YYYY-MM') AS name,
               ROUND(AVG(percentual))::int AS media
        FROM eval_instances
        WHERE status = 'finalizado' AND completed_at IS NOT NULL
        GROUP BY 1 ORDER BY 1
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
        evolution: evoRows
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
        SELECT c.id, c.label, c.start_date, c.end_date, c.active,
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
      const { label, start_date, end_date, active, auto_open, auto_close } = req.body || {};
      if (!label || !start_date || !end_date) {
        return res.status(400).json({ error: 'label, start_date, end_date obrigatórios' });
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
        `INSERT INTO eval_cycles (label, start_date, end_date, active, auto_open, auto_close)
         VALUES ($1, $2, $3, COALESCE($4, false), COALESCE($5, false), COALESCE($6, false)) RETURNING *`,
        [label, start_date, end_date, active || false, !!auto_open, !!auto_close]
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
      const { label, start_date, end_date, active, auto_open, auto_close } = req.body || {};
      if (active === true) {
        const other = await findConflictingActiveCycle(id);
        if (other != null) {
          return res.status(409).json({ error: 'Existe ciclo ativo — encerre-o antes de ativar este.', active_cycle_id: other });
        }
      }
      const { rows } = await query(
        `UPDATE eval_cycles
            SET label      = COALESCE($1, label),
                start_date = COALESCE($2, start_date),
                end_date   = COALESCE($3, end_date),
                active     = COALESCE($4, active),
                auto_open  = COALESCE($5, auto_open),
                auto_close = COALESCE($6, auto_close)
          WHERE id = $7 RETURNING *`,
        [label ?? null, start_date ?? null, end_date ?? null, active ?? null,
         typeof auto_open === 'boolean' ? auto_open : null,
         typeof auto_close === 'boolean' ? auto_close : null, id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      // Ao desativar o ciclo por PATCH, garante o mesmo efeito do /encerrar:
      // instâncias não-terminais viram 'ciclo_encerrado' (viram histórico).
      if (active === false) {
        await query(
          `UPDATE eval_instances
              SET status = 'ciclo_encerrado', completed_at = COALESCE(completed_at, now())
            WHERE cycle_id = $1
              AND status NOT IN ('aprovado', 'reprovado', 'finalizado', 'ciclo_encerrado')`,
          [id]
        );
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
      SELECT id, COALESCE(trade_name, name) AS name
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
               COALESCE(p.trade_name, p.name) AS provider_name,
               p.sgu_code AS provider_code,
               p.provider_group,
               pl.id AS location_id,
               COALESCE(pl.label, pl.cidade) AS location_label,
               pl.cidade AS city,
               g.script_id AS default_script_id,
               s_default.title AS default_script_title,
               ov.script_id AS override_script_id,
               s_override.title AS override_script_title
          FROM provider_locations pl
          JOIN providers p ON p.id = pl.provider_id
          LEFT JOIN eff_groups g ON g.provider_group = p.provider_group
          LEFT JOIN eval_scripts s_default ON s_default.id = g.script_id
          LEFT JOIN eval_cycle_overrides ov ON ov.cycle_id = $1 AND ov.provider_id = p.id AND ov.location_id = pl.id
          LEFT JOIN eval_scripts s_override ON s_override.id = ov.script_id
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

  // Executa a abertura de um ciclo (mesma lógica do endpoint /abrir). Retorna
  // { ok, code, error?, created? } — reutilizada tanto pelo POST manual quanto pelo
  // job automático (5.4.1.1 abertura em data definida).
  async function openCycleCore(cycleId: number): Promise<{ ok: boolean; code?: number; error?: string; created?: { groups: number; instances: number; dl_bypass: number } }> {
    const { rows: cy } = await query('SELECT id, label, active FROM eval_cycles WHERE id = $1', [cycleId]);
    if (!cy.length) return { ok: false, code: 404, error: 'ciclo não encontrado' };
    if (!cy[0].active) return { ok: false, code: 400, error: 'ciclo não está ativo' };
    const { rows: existInst } = await query('SELECT 1 FROM eval_instances WHERE cycle_id = $1 LIMIT 1', [cycleId]);
    if (existInst.length) return { ok: false, code: 409, error: 'ciclo já tem instâncias' };

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
          RETURNING id, provider_id, script_id
        `, [cycleId]);

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

      return { ok: true, created };
  }

  app.post('/api/eval/cycles/:id/abrir', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const cycleId = Number(req.params.id);
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
            SET status = 'ciclo_encerrado', completed_at = COALESCE(completed_at, now())
          WHERE cycle_id = $1
            AND status NOT IN ('aprovado', 'reprovado', 'finalizado')`,
        [cycleId]
      );
      await c.query('UPDATE eval_cycles SET active = false WHERE id = $1', [cycleId]);
    });
    return { ok: true, inconclusive };
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
    action: 'aprovou' | 'reprovou' | 'solicitou_reanalise',
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
      // Aprovar/reprovar critério em reanálise burla o fluxo: o auditor devolveu ao
      // prestador e a bola está com ele. Só nova reanálise pode ajustar a orientação.
      if (ans.evidence_status === 'aguardando_reanalise' && action !== 'solicitou_reanalise') {
        return res.status(409).json({ error: 'critério aguardando reenvio do prestador — só é possível ajustar a orientação de reanálise' });
      }
      // Revisão de decisão: se já havia veredito terminal, exigir justificativa em
      // qualquer nova ação — inclusive Aprovar. Trilha fica em eval_answer_iterations.
      const isRevision = ans.evidence_status === 'aprovado' || ans.evidence_status === 'reprovado';
      if ((observationRequired || isRevision) && !observation) {
        return res.status(400).json({ error: isRevision ? 'justificativa obrigatória para revisar a decisão' : 'observação obrigatória' });
      }

      const newEvidenceStatus =
        action === 'aprovou' ? 'aprovado' :
        action === 'reprovou' ? 'reprovado' : 'aguardando_reanalise';
      const newScore =
        action === 'reprovou' ? 0 :
        action === 'aprovou'  ? Number(ans.score_obtained ?? 0) : Number(ans.score_obtained ?? 0);
      const isNonCompliant = action === 'reprovou';

      await withTransaction(async (client) => {
        await client.query(`
          UPDATE eval_answers
             SET evidence_status = $1,
                 score_obtained  = $2,
                 auditor_observation = $3,
                 is_non_compliant = $4
           WHERE id = $5
        `, [newEvidenceStatus, newScore, observation || null, isNonCompliant, answerId]);

        const n = await nextIterationNumber(client, answerId);
        await client.query(`
          INSERT INTO eval_answer_iterations
            (answer_id, iteration_number, actor_id, actor_role, action, answer_value, score_obtained, evidence_url, observation)
          VALUES ($1, $2, $3, 'auditor', $4, $5, $6, $7, $8)
        `, [answerId, n, req.user.id, action, ans.answer_value, newScore, ans.evidence_url, observation || null]);

        if (action === 'solicitou_reanalise' && ans.instance_status === 'em_analise') {
          await client.query(
            `UPDATE eval_instances SET status = 'aguardando_evidencia' WHERE id = $1`,
            [ans.instance_id]
          );
        }
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

  app.post('/api/eval/instances/:id/parecer', authenticate, async (req: any, res) => {
    try {
      if (!isStaff(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
      const id = Number(req.params.id);

      const { rows: [inst] } = await query(`
        SELECT id, status, provider_id, location_id FROM eval_instances WHERE id = $1
      `, [id]);
      if (!inst) return res.status(404).json({ error: 'instance not found' });
      if (inst.status !== 'em_analise') {
        return res.status(409).json({ error: `status ${inst.status} não permite parecer` });
      }

      const { rows: pending } = await query(`
        SELECT id FROM eval_answers
         WHERE instance_id = $1 AND evidence_status NOT IN ('aprovado','reprovado')
      `, [id]);
      if (pending.length) {
        return res.status(409).json({ error: 'critérios sem decisão terminal', pending_answer_ids: pending.map((r: any) => Number(r.id)) });
      }

      const { rows: [totals] } = await query(`
        SELECT
          COALESCE(SUM(ea.score_obtained) FILTER (WHERE ea.answer_value <> 'NA'), 0)::numeric AS score,
          COALESCE(SUM(eq.max_score)      FILTER (WHERE ea.answer_value <> 'NA'), 0)::numeric AS max_possible,
          COALESCE(BOOL_OR(ea.evidence_status = 'reprovado' AND eq.is_eliminatory), false) AS elim_fail
        FROM eval_answers ea
        JOIN eval_questions eq ON eq.id = ea.question_id
        WHERE ea.instance_id = $1
      `, [id]);

      const score = Number(totals.score);
      const maxPossible = Number(totals.max_possible);
      const percentual = maxPossible > 0 ? Math.round((score / maxPossible) * 10000) / 100 : 0;
      const hasEliminatoryFailed = !!totals.elim_fail;

      const { computeSeal } = await import('./src/lib/computeSeal.js');
      const seal = computeSeal(percentual, hasEliminatoryFailed);

      await query(`
        UPDATE eval_instances
           SET status = 'aprovado',
               score = $1, max_possible_score = $2, percentual = $3, seal = $4,
               completed_at = now()
         WHERE id = $5
      `, [score, maxPossible, percentual, seal, id]);

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

      res.json({ status: 'aprovado', percentual, seal, hasEliminatoryFailed });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message });
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
               COALESCE(p.trade_name, p.name) AS provider_name,
               p.sgu_code AS provider_code,
               pl.cidade AS city,
               p.provider_group,
               ei.status, ei.seal,
               COALESCE(partial.pct, 0) AS percentual,
               false AS has_certificate
          FROM eval_instances ei
          JOIN providers p ON p.id = ei.provider_id
          LEFT JOIN provider_locations pl ON pl.id = ei.location_id
          LEFT JOIN (
            SELECT ea.instance_id,
                   (SUM(CASE WHEN LOWER(COALESCE(ea.answer_value,'')) <> 'na' THEN COALESCE(ea.score_obtained, 0) ELSE 0 END)
                    / NULLIF(SUM(CASE WHEN LOWER(COALESCE(ea.answer_value,'')) <> 'na' THEN eq.max_score ELSE 0 END), 0)) * 100 AS pct
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
           AND (ea.answer_value IS NULL OR ea.answer_value <> 'NA')
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
          city: r.city, provider_group: r.provider_group,
          status: r.status, percentual: Number(r.percentual) || 0, seal: r.seal,
          has_certificate: false,
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
               COALESCE(p.trade_name, p.name) AS provider_name,
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
           AND (ea.answer_value IS NULL OR ea.answer_value <> 'NA')
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
