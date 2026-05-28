import express from 'express';
import { createServer as createViteServer } from 'vite';
import cors from 'cors';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-unimed-mvp';

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

// Initialize Database
const db = new Database('unimed_mvp.db');
db.pragma('journal_mode = WAL');

// Setup Database Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL, -- 'prestador', 'admin', 'auditoria'
    provider_id INTEGER
  );

  CREATE TABLE IF NOT EXISTS providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    cnpj TEXT UNIQUE NOT NULL,
    code TEXT,
    provider_group TEXT,
    qualification_level TEXT,
    status TEXT
  );
`);

try {
  db.exec('ALTER TABLE providers ADD COLUMN code TEXT');
} catch (e) {
  // Ignore error if column already exists
}

try {
  db.exec('ALTER TABLE documents ADD COLUMN upload_date TEXT');
  db.exec('ALTER TABLE documents ADD COLUMN uploaded_by INTEGER');
} catch (e) {
  // Ignore error if column already exists
}

try {
  db.exec('ALTER TABLE documents ADD COLUMN rejection_reason TEXT');
} catch (e) {
  // Ignore error if column already exists
}

try {
  db.exec('ALTER TABLE qualification_items ADD COLUMN type TEXT DEFAULT "file"');
  db.exec('ALTER TABLE qualification_items ADD COLUMN na_allowed BOOLEAN DEFAULT 1');
} catch (e) {
  // Ignore error if column already exists
}

try {
  db.exec('ALTER TABLE qualification_submission_items ADD COLUMN text_answer TEXT');
  db.exec('ALTER TABLE qualification_submission_items ADD COLUMN justification TEXT');
  db.exec('ALTER TABLE qualification_submission_items ADD COLUMN is_na BOOLEAN DEFAULT 0');
} catch (e) {
  // Ignore error if column already exists
}

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    issue_date TEXT,
    expiry_date TEXT,
    status TEXT NOT NULL, -- 'valido', 'pendente', 'reprovado', 'vencido', 'historico'
    file_url TEXT,
    upload_date TEXT,
    uploaded_by INTEGER,
    rejection_reason TEXT,
    FOREIGN KEY (provider_id) REFERENCES providers(id),
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    priority TEXT NOT NULL,
    status TEXT NOT NULL, -- 'aberto', 'em_analise', 'respondido', 'encerrado'
    created_at TEXT NOT NULL,
    response TEXT,
    FOREIGN KEY (provider_id) REFERENCES providers(id)
  );

  CREATE TABLE IF NOT EXISTS ticket_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    role TEXT NOT NULL,
    message TEXT NOT NULL,
    is_status_change BOOLEAN DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (ticket_id) REFERENCES tickets(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Migrate existing responses to ticket_messages
try {
  const existingTicketsWithResponse = db.prepare('SELECT id, response FROM tickets WHERE response IS NOT NULL AND response != ""').all();
  if (existingTicketsWithResponse.length > 0) {
    const insertMsg = db.prepare('INSERT INTO ticket_messages (ticket_id, user_id, user_name, role, message, is_status_change, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const clearResponse = db.prepare('UPDATE tickets SET response = NULL WHERE id = ?');
    
    // Assuming user_id 1 is an admin for the migration
    const adminUser = db.prepare('SELECT id, name, role FROM users WHERE role = "admin" LIMIT 1').get() as any;
    
    if (adminUser) {
      for (const t of existingTicketsWithResponse) {
        insertMsg.run(t.id, adminUser.id, adminUser.name, adminUser.role, t.response, 0, new Date().toISOString());
        clearResponse.run(t.id);
      }
    }
  }
} catch (e) {
  // Ignore migration errors
}

db.exec(`
  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    image_url TEXT,
    date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trainings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    video_url TEXT,
    pdf_url TEXT,
    validity_days INTEGER,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS provider_trainings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL,
    training_id INTEGER NOT NULL,
    status TEXT NOT NULL, -- 'pendente', 'em_andamento', 'concluido'
    completed_at TEXT,
    FOREIGN KEY (provider_id) REFERENCES providers(id),
    FOREIGN KEY (training_id) REFERENCES trainings(id)
  );

  CREATE TABLE IF NOT EXISTS financials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL,
    competence TEXT NOT NULL,
    gross_value REAL NOT NULL,
    glosa_value REAL NOT NULL,
    net_value REAL NOT NULL,
    status TEXT,
    FOREIGN KEY (provider_id) REFERENCES providers(id)
  );

  CREATE TABLE IF NOT EXISTS audits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL,
    scheduled_date TEXT NOT NULL,
    status TEXT NOT NULL, -- 'programada', 'realizada'
    evaluation TEXT,
    FOREIGN KEY (provider_id) REFERENCES providers(id)
  );

  CREATE TABLE IF NOT EXISTS contracts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    file_url TEXT NOT NULL,
    status TEXT NOT NULL, -- 'pendente', 'ativo', 'vencido'
    signed_at TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (provider_id) REFERENCES providers(id)
  );
  CREATE TABLE IF NOT EXISTS qualifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL,
    cycle TEXT NOT NULL,
    score INTEGER,
    status TEXT NOT NULL, -- 'pendente', 'em_andamento', 'concluida'
    seal TEXT, -- 'Ouro', 'Prata', 'Bronze', null
    created_at TEXT NOT NULL,
    FOREIGN KEY (provider_id) REFERENCES providers(id)
  );

  CREATE TABLE IF NOT EXISTS qualification_cycles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    active BOOLEAN DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS qualification_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cycle_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    is_required BOOLEAN DEFAULT 1,
    FOREIGN KEY (cycle_id) REFERENCES qualification_cycles(id)
  );

  CREATE TABLE IF NOT EXISTS qualification_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL,
    cycle_id INTEGER NOT NULL,
    status TEXT NOT NULL, -- 'rascunho', 'enviado', 'em_analise', 'aprovado', 'reprovado', 'parcial'
    submitted_at TEXT,
    evaluated_at TEXT,
    evaluated_by INTEGER,
    final_observations TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (provider_id) REFERENCES providers(id),
    FOREIGN KEY (cycle_id) REFERENCES qualification_cycles(id),
    FOREIGN KEY (evaluated_by) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS qualification_submission_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    is_compliant BOOLEAN,
    evidence_url TEXT,
    auditor_status TEXT, -- 'aprovado', 'reprovado', 'pendente'
    auditor_observation TEXT,
    FOREIGN KEY (submission_id) REFERENCES qualification_submissions(id),
    FOREIGN KEY (item_id) REFERENCES qualification_items(id)
  );

  CREATE TABLE IF NOT EXISTS action_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    deadline TEXT NOT NULL,
    status TEXT NOT NULL, -- 'pendente', 'em_andamento', 'concluido'
    created_at TEXT NOT NULL,
    FOREIGN KEY (provider_id) REFERENCES providers(id)
  );

  CREATE TABLE IF NOT EXISTS price_tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER, -- null if general
    title TEXT NOT NULL,
    code TEXT NOT NULL,
    version TEXT NOT NULL,
    status TEXT NOT NULL, -- 'vigente', 'futura', 'historico'
    effective_date TEXT NOT NULL,
    file_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (provider_id) REFERENCES providers(id)
  );

  CREATE TABLE IF NOT EXISTS credentialing_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    specialty TEXT NOT NULL,
    file_url TEXT,
    status TEXT NOT NULL DEFAULT 'pendente',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS qualification_scripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    items TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS survey_responses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider_id INTEGER NOT NULL,
    atendimento TEXT NOT NULL,
    comunicacao TEXT NOT NULL,
    sugestoes TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(provider_id) REFERENCES providers(id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- NOVO MOTOR DE ROTEIROS DE QUALIFICACAO (RN 630)
  CREATE TABLE IF NOT EXISTS eval_scripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    version TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS eval_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    script_id INTEGER NOT NULL,
    parent_section_id INTEGER,
    name TEXT NOT NULL,
    order_index INTEGER NOT NULL,
    FOREIGN KEY(script_id) REFERENCES eval_scripts(id),
    FOREIGN KEY(parent_section_id) REFERENCES eval_sections(id)
  );

  CREATE TABLE IF NOT EXISTS eval_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL,
    code TEXT,
    text TEXT NOT NULL,
    legislation TEXT,
    type TEXT NOT NULL, -- 'sim_nao', 'multipla_escolha', 'texto', 'numerico', 'data', 'upload', 'checklist'
    options TEXT, -- JSON array of options if multiple choice or checklist
    weight INTEGER DEFAULT 1,
    max_score INTEGER DEFAULT 0,
    evidence_required BOOLEAN DEFAULT 0,
    is_eliminatory BOOLEAN DEFAULT 0,
    order_index INTEGER NOT NULL,
    FOREIGN KEY(section_id) REFERENCES eval_sections(id)
  );

  CREATE TABLE IF NOT EXISTS eval_instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    script_id INTEGER NOT NULL,
    provider_id INTEGER NOT NULL,
    auditor_id INTEGER,
    status TEXT NOT NULL, -- 'em_andamento', 'pendente', 'em_analise', 'aguardando_evidencia', 'reprovado', 'aprovado', 'finalizado'
    score INTEGER DEFAULT 0,
    max_possible_score INTEGER DEFAULT 0,
    percentual REAL DEFAULT 0,
    seal TEXT, -- 'Bronze', 'Prata', 'Ouro', null
    started_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY(script_id) REFERENCES eval_scripts(id),
    FOREIGN KEY(provider_id) REFERENCES providers(id),
    FOREIGN KEY(auditor_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS eval_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    answer_value TEXT, -- The selected option or value or 'NA'
    score_obtained INTEGER,
    evidence_url TEXT,
    provider_observation TEXT,
    auditor_observation TEXT,
    is_non_compliant BOOLEAN DEFAULT 0,
    evidence_status TEXT, -- 'pendente', 'aprovado', 'reprovado'
    FOREIGN KEY(instance_id) REFERENCES eval_instances(id),
    FOREIGN KEY(question_id) REFERENCES eval_questions(id)
  );
`);

// Seed initial data if empty
try {
  // Try to add response column if it doesn't exist (for existing DBs)
  db.exec('ALTER TABLE tickets ADD COLUMN response TEXT;');
} catch (e) {
  // Column might already exist, ignore
}

try {
  db.exec('ALTER TABLE trainings ADD COLUMN created_at TEXT;');
} catch (e) {
  // Column might already exist, ignore
}

try {
  db.exec('ALTER TABLE providers ADD COLUMN provider_group TEXT;');
} catch (e) {
  // Column might already exist, ignore
}

try {
  db.exec('ALTER TABLE announcements ADD COLUMN image_url TEXT;');
} catch (e) {
  // Column might already exist, ignore
}

try {
  db.exec('ALTER TABLE announcements ADD COLUMN target_type TEXT DEFAULT "geral";');
  db.exec('ALTER TABLE announcements ADD COLUMN target_group TEXT;');
  db.exec('ALTER TABLE announcements ADD COLUMN target_provider_id INTEGER;');
} catch (e) {
  // Columns might already exist, ignore
}

try {
  db.exec('ALTER TABLE trainings ADD COLUMN target_type TEXT DEFAULT "geral";');
  db.exec('ALTER TABLE trainings ADD COLUMN target_group TEXT;');
  db.exec('ALTER TABLE trainings ADD COLUMN target_provider_id INTEGER;');
} catch (e) {
  // Columns might already exist, ignore
}

// Fix cooperado provider_id if missing
try {
  const cooperado = db.prepare("SELECT id FROM users WHERE role = 'cooperado' AND provider_id IS NULL").get() as { id: number };
  if (cooperado) {
    const insertProvider = db.prepare("INSERT INTO providers (name, cnpj, code, provider_group, qualification_level, status) VALUES (?, ?, ?, ?, ?, ?)");
    const providerResult = insertProvider.run('Consultório Dra. Ana Souza', '98.765.432/0001-10', '12345', 'Cardiologia', 'A', 'Ativo');
    db.prepare("UPDATE users SET provider_id = ? WHERE id = ?").run(providerResult.lastInsertRowid, cooperado.id);
  }
} catch (e) {
  console.error("Error fixing cooperado:", e);
}

try {
  const settingsCount = db.prepare('SELECT COUNT(*) as count FROM settings').get() as { count: number };
  if (settingsCount.count === 0) {
    const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    insertSetting.run('current_competence', '2025-10');
    
    // Calculate a default payment date (e.g., 15th of next month)
    const today = new Date();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 15);
    insertSetting.run('payment_date', nextMonth.toISOString().split('T')[0]);
  }
} catch (e) {
  console.error("Error seeding settings:", e);
}

const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
if (userCount.count === 0) {
  const hash = bcrypt.hashSync('senha123', 10);
  
  // Insert Provider
  const insertProvider = db.prepare('INSERT INTO providers (name, cnpj, qualification_level, status) VALUES (?, ?, ?, ?)');
  const providerResult = insertProvider.run('Clínica Saúde Total', '12.345.678/0001-90', 'A', 'Ativo');
  const providerId = providerResult.lastInsertRowid;

  // Insert Users
  const insertUser = db.prepare('INSERT INTO users (name, email, password, role, provider_id) VALUES (?, ?, ?, ?, ?)');
  insertUser.run('Dr. João Silva', 'prestador@unimed.com', hash, 'prestador', providerId);
  insertUser.run('Admin Unimed', 'admin@unimed.com', hash, 'admin', null);
  insertUser.run('Auditor Carlos', 'auditoria@unimed.com', hash, 'auditoria', null);
  insertUser.run('Dra. Ana Souza', 'cooperado@unimed.com', hash, 'cooperado', null);

  // Insert Documents
  const insertDoc = db.prepare('INSERT INTO documents (provider_id, type, issue_date, expiry_date, status, file_url) VALUES (?, ?, ?, ?, ?, ?)');
  insertDoc.run(providerId, 'Alvará Sanitário', '2023-01-10', '2024-01-10', 'vencido', '/docs/alvara.pdf');
  insertDoc.run(providerId, 'CNES', '2023-05-20', '2024-05-20', 'valido', '/docs/cnes.pdf');
  insertDoc.run(providerId, 'Contrato Social', '2020-01-01', '2030-01-01', 'valido', '/docs/contrato.pdf');

  // Insert Tickets
  const insertTicket = db.prepare('INSERT INTO tickets (provider_id, title, description, category, priority, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insertTicket.run(providerId, 'Dúvida sobre Glosa', 'Gostaria de entender o motivo da glosa na fatura 123.', 'Financeiro', 'Média', 'aberto', new Date().toISOString());
  insertTicket.run(providerId, 'Atualização de Endereço', 'Mudamos de endereço, segue comprovante.', 'Cadastro', 'Baixa', 'encerrado', new Date(Date.now() - 86400000 * 5).toISOString());

  // Insert Announcements
  const insertAnnouncement = db.prepare('INSERT INTO announcements (title, description, category, date) VALUES (?, ?, ?, ?)');
  insertAnnouncement.run('Nova Tabela de Honorários', 'A tabela de honorários foi atualizada para 2024.', 'Financeiro', new Date().toISOString());
  insertAnnouncement.run('Campanha de Vacinação', 'Participem da campanha de vacinação contra a gripe.', 'Geral', new Date(Date.now() - 86400000 * 2).toISOString());

  // Insert Trainings
  const insertTraining = db.prepare('INSERT INTO trainings (title, description, video_url, pdf_url, validity_days) VALUES (?, ?, ?, ?, ?)');
  const t1 = insertTraining.run('Boas Práticas de Faturamento', 'Aprenda a evitar glosas.', 'https://example.com/video1', 'https://example.com/pdf1', 365);
  const t2 = insertTraining.run('LGPD na Saúde', 'Treinamento obrigatório sobre proteção de dados.', 'https://example.com/video2', 'https://example.com/pdf2', 365);

  // Insert Provider Trainings
  const insertProvTraining = db.prepare('INSERT INTO provider_trainings (provider_id, training_id, status, completed_at) VALUES (?, ?, ?, ?)');
  insertProvTraining.run(providerId, t1.lastInsertRowid, 'pendente', null);
  insertProvTraining.run(providerId, t2.lastInsertRowid, 'concluido', new Date().toISOString());

  // Insert Financials
  const insertFinancial = db.prepare('INSERT INTO financials (provider_id, competence, gross_value, glosa_value, net_value, status) VALUES (?, ?, ?, ?, ?, ?)');
  insertFinancial.run(providerId, '01/2024', 50000.00, 2500.00, 47500.00, 'Pago');
  insertFinancial.run(providerId, '02/2024', 45000.00, 1000.00, 44000.00, 'Pago');
  insertFinancial.run(providerId, '03/2024', 55000.00, 5000.00, 50000.00, 'Aberto');

  // Insert Audits
  const insertAudit = db.prepare('INSERT INTO audits (provider_id, scheduled_date, status, evaluation) VALUES (?, ?, ?, ?)');
  insertAudit.run(providerId, new Date(Date.now() + 86400000 * 15).toISOString(), 'programada', null);
  insertAudit.run(providerId, new Date(Date.now() - 86400000 * 60).toISOString(), 'realizada', 'Aprovado com ressalvas');

  // Insert Qualifications
  const insertQual = db.prepare('INSERT INTO qualifications (provider_id, cycle, score, status, seal, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  insertQual.run(providerId, '2024-2025', 92, 'concluida', 'Ouro', new Date().toISOString());

  // Insert Action Plans
  const insertActionPlan = db.prepare('INSERT INTO action_plans (provider_id, title, description, deadline, status, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  insertActionPlan.run(providerId, 'Melhoria no tempo de espera', 'Reduzir o tempo de espera na recepção para menos de 15 minutos.', new Date(Date.now() + 86400000 * 30).toISOString(), 'em_andamento', new Date().toISOString());

  // Insert Price Tables
  const insertPriceTable = db.prepare('INSERT INTO price_tables (provider_id, title, code, version, status, effective_date, file_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  insertPriceTable.run(providerId, 'Tabela de Honorários Médicos', 'THM-2024', 'v1.0', 'vigente', new Date('2024-01-01').toISOString(), '/docs/thm-2024.pdf', new Date().toISOString());
  insertPriceTable.run(providerId, 'Tabela de Materiais e Medicamentos', 'TMM-2024', 'v1.2', 'vigente', new Date('2024-03-01').toISOString(), '/docs/tmm-2024.pdf', new Date().toISOString());
  insertPriceTable.run(null, 'Tabela TUSS Padrão', 'TUSS-2024', 'v2.0', 'vigente', new Date('2024-01-01').toISOString(), '/docs/tuss-2024.pdf', new Date().toISOString());
}

async function startServer() {
  console.log("=== STARTING THE SERVER ===");
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json());
  app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

  // --- API Routes ---

  // Auth Middleware
  const authenticate = (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token provided' });
    
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };

  const cycleCount = db.prepare('SELECT COUNT(*) as count FROM qualification_cycles').get() as { count: number };
  if (cycleCount.count === 0) {
    const insertCycle = db.prepare('INSERT INTO qualification_cycles (title, description, active, created_at) VALUES (?, ?, ?, ?)');
    const cycleResult = insertCycle.run('Qualificação Anual 2026', 'Ciclo de qualificação obrigatório para todos os prestadores da rede.', 1, new Date().toISOString());
    const cycleId = cycleResult.lastInsertRowid;

    const insertItem = db.prepare('INSERT INTO qualification_items (cycle_id, title, description, is_required) VALUES (?, ?, ?, ?)');
    insertItem.run(cycleId, 'Alvará (Localização, Sanitário ou Bombeiros)', 'Cópia do alvará vigente.', 1);
    insertItem.run(cycleId, 'CNES Ativo', 'Comprovante de inscrição no Cadastro Nacional de Estabelecimentos de Saúde.', 1);
    insertItem.run(cycleId, 'Relação do Corpo Clínico', 'Lista atualizada dos profissionais com seus respectivos registros (CRM, COREN, etc).', 1);
    insertItem.run(cycleId, 'PGRSS', 'Plano de Gerenciamento de Resíduos de Serviços de Saúde.', 1);
    insertItem.run(cycleId, 'Certificado de Regularidade Técnica', 'Certificado emitido pelo conselho de classe.', 1);
    insertItem.run(cycleId, 'ART - Anotação de Responsabilidade Técnica', 'Documento de Anotação de Responsabilidade Técnica (ART).', 1);
    insertItem.run(cycleId, 'RQE', 'Registro de Qualificação de Especialista.', 0);
    insertItem.run(cycleId, 'Certificados/diplomas', 'Cópias dos certificados ou diplomas.', 0);
    insertItem.run(cycleId, 'Optante pelo Simples Nacional', 'Comprovante de opção pelo Simples Nacional (se aplicável).', 0);
  }

  // Login
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as any;
    
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user.id, name: user.name, role: user.role, provider_id: user.provider_id }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, provider_id: user.provider_id } });
  });

  // Dashboard Data
  app.get('/api/dashboard', authenticate, (req: any, res) => {
    let { provider_id, role, id: user_id } = req.user;
    
    if (!provider_id && role !== 'admin' && role !== 'auditoria') {
      const dbUser = db.prepare('SELECT provider_id FROM users WHERE id = ?').get(user_id) as any;
      if (dbUser && dbUser.provider_id) {
        provider_id = dbUser.provider_id;
      }
    }
    
    if (role === 'admin' || role === 'auditoria') {
      // Admin/Auditor dashboard data
      const providersCount = db.prepare('SELECT COUNT(*) as count FROM providers').get();
      const openTicketsCount = db.prepare('SELECT COUNT(*) as count FROM tickets WHERE status = ?').get('aberto');
      const pendingDocsCount = db.prepare('SELECT COUNT(*) as count FROM documents WHERE status = ?').get('pendente');
      const pendingCredentialingCount = db.prepare('SELECT COUNT(*) as count FROM credentialing_requests WHERE status = ?').get('pendente');
      
      const recentPendingDocs = db.prepare('SELECT d.*, p.name as provider_name FROM documents d JOIN providers p ON d.provider_id = p.id WHERE d.status = ? ORDER BY d.id DESC LIMIT 5').all('pendente');
      const recentOpenTickets = db.prepare('SELECT t.*, p.name as provider_name FROM tickets t JOIN providers p ON t.provider_id = p.id WHERE t.status = ? ORDER BY t.created_at DESC LIMIT 5').all('aberto');

      res.json({
        providersCount,
        openTicketsCount,
        pendingDocsCount,
        pendingCredentialingCount,
        recentPendingDocs,
        recentOpenTickets
      });
    } else if (provider_id) {
      const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(provider_id);
      const docs = db.prepare('SELECT * FROM documents WHERE provider_id = ?').all(provider_id);
      const tickets = db.prepare('SELECT * FROM tickets WHERE provider_id = ?').all(provider_id);
      const trainings = db.prepare('SELECT pt.*, t.title FROM provider_trainings pt JOIN trainings t ON pt.training_id = t.id WHERE pt.provider_id = ?').all(provider_id);
      const audits = db.prepare('SELECT * FROM audits WHERE provider_id = ?').all(provider_id);
      const financials = db.prepare('SELECT * FROM financials WHERE provider_id = ? ORDER BY competence DESC LIMIT 3').all(provider_id);
      const announcements = db.prepare('SELECT * FROM announcements ORDER BY date DESC LIMIT 5').all();

      res.json({
        provider,
        documents: docs,
        tickets: tickets,
        trainings: trainings,
        audits: audits,
        financials: financials,
        announcements: announcements
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
  });

  // Settings
  app.get('/api/settings', authenticate, (req: any, res) => {
    const settings = db.prepare('SELECT * FROM settings').all();
    const result = settings.reduce((acc: any, curr: any) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});
    res.json(result);
  });

  app.post('/api/settings', authenticate, (req: any, res) => {
    const { role } = req.user;
    if (role !== 'admin' && role !== 'auditoria') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const { current_competence, payment_date } = req.body;
    try {
      const update = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
      if (current_competence) update.run(current_competence, 'current_competence');
      if (payment_date) update.run(payment_date, 'payment_date');
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Providers
  app.get('/api/providers', authenticate, (req: any, res) => {
    const { role } = req.user;
    if (role === 'admin' || role === 'auditoria') {
      const providers = db.prepare('SELECT id, name, cnpj, code, provider_group, qualification_level, status FROM providers ORDER BY name ASC').all();
      res.json(providers);
    } else {
      res.status(403).json({ error: 'Unauthorized' });
    }
  });

  app.post('/api/providers', authenticate, (req: any, res) => {
    const { role } = req.user;
    if (role !== 'admin' && role !== 'auditoria') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const { name, cnpj, code, provider_group, qualification_level, status } = req.body;
    if (!name || !cnpj) {
      return res.status(400).json({ error: 'Name and CNPJ are required' });
    }
    try {
      const insert = db.prepare('INSERT INTO providers (name, cnpj, code, provider_group, qualification_level, status) VALUES (?, ?, ?, ?, ?, ?)');
      const info = insert.run(name, cnpj, code || null, provider_group || null, qualification_level || null, status || 'Ativo');
      res.json({ id: info.lastInsertRowid, name, cnpj, code, provider_group, qualification_level, status });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Qualification Scripts
  app.get('/api/qualification-scripts', authenticate, (req: any, res) => {
    const scripts = db.prepare('SELECT * FROM qualification_scripts ORDER BY created_at DESC').all();
    res.json(scripts.map(s => ({ ...s, items: JSON.parse(s.items) })));
  });

  app.post('/api/qualification-scripts', authenticate, (req: any, res) => {
    const { role } = req.user;
    if (role !== 'admin' && role !== 'auditoria') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const { title, items } = req.body;
    if (!title || !items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Title and items array are required' });
    }
    try {
      const insert = db.prepare('INSERT INTO qualification_scripts (title, items, created_at) VALUES (?, ?, ?)');
      const info = insert.run(title, JSON.stringify(items), new Date().toISOString());
      res.json({ id: info.lastInsertRowid, title, items });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/qualification-scripts/:id', authenticate, (req: any, res) => {
    const { role } = req.user;
    if (role !== 'admin' && role !== 'auditoria') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
      db.prepare('DELETE FROM qualification_scripts WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Documents
  app.get('/api/documents', authenticate, (req: any, res) => {
    const { provider_id, role } = req.user;
    if (role === 'admin' || role === 'auditoria') {
      const docs = db.prepare('SELECT d.*, p.name as provider_name, u.name as uploaded_by_name FROM documents d JOIN providers p ON d.provider_id = p.id LEFT JOIN users u ON d.uploaded_by = u.id ORDER BY d.id DESC').all();
      res.json(docs);
    } else if (provider_id) {
      const docs = db.prepare('SELECT d.*, u.name as uploaded_by_name FROM documents d LEFT JOIN users u ON d.uploaded_by = u.id WHERE d.provider_id = ? ORDER BY d.id DESC').all(provider_id);
      res.json(docs);
    } else {
      res.json([]);
    }
  });

  app.post('/api/documents', authenticate, upload.single('file'), (req: any, res) => {
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
    db.prepare("UPDATE documents SET status = 'historico' WHERE provider_id = ? AND type = ? AND status != 'historico'").run(targetProviderId, type);

    const insertDoc = db.prepare('INSERT INTO documents (provider_id, type, issue_date, expiry_date, status, file_url, upload_date, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const info = insertDoc.run(targetProviderId, type, issue_date || null, expiry_date || null, status, file_url, upload_date, user_id);
    
    const newDoc = db.prepare('SELECT * FROM documents WHERE id = ?').get(info.lastInsertRowid);
    res.json(newDoc);
  });

  app.put('/api/documents/:id', authenticate, upload.single('file'), (req: any, res) => {
    const { role, provider_id } = req.user;
    const { id } = req.params;
    const { type, issue_date, expiry_date } = req.body;

    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
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

    const updateDoc = db.prepare('UPDATE documents SET type = ?, issue_date = ?, expiry_date = ?, file_url = ? WHERE id = ?');
    updateDoc.run(type, issue_date || null, expiry_date || null, file_url, id);

    const updatedDoc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    res.json(updatedDoc);
  });

  app.delete('/api/documents/:id', authenticate, (req: any, res) => {
    const { role, provider_id } = req.user;
    const { id } = req.params;

    const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    if (role === 'prestador' && doc.provider_id !== provider_id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (doc.status !== 'pendente') {
      return res.status(400).json({ error: 'Only pending documents can be deleted' });
    }

    db.prepare('DELETE FROM documents WHERE id = ?').run(id);
    res.json({ success: true });
  });

  app.put('/api/documents/:id/status', authenticate, (req: any, res) => {
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
      const updateDoc = db.prepare('UPDATE documents SET status = ?, issue_date = ?, expiry_date = ?, rejection_reason = ? WHERE id = ?');
      updateDoc.run(status, issue_date || null, expiry_date || null, rejection_reason || null, id);
    } else {
      const updateDoc = db.prepare('UPDATE documents SET status = ? WHERE id = ?');
      updateDoc.run(status, id);
    }

    const updatedDoc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
    res.json(updatedDoc);
  });

  // Tickets
  app.get('/api/tickets', authenticate, (req: any, res) => {
    let { provider_id, role, id: user_id } = req.user;
    
    if (!provider_id && role !== 'admin' && role !== 'auditoria') {
      const dbUser = db.prepare('SELECT provider_id FROM users WHERE id = ?').get(user_id) as any;
      if (dbUser && dbUser.provider_id) {
        provider_id = dbUser.provider_id;
      }
    }

    if (role === 'admin' || role === 'auditoria') {
      const tickets = db.prepare('SELECT t.*, p.name as provider_name FROM tickets t JOIN providers p ON t.provider_id = p.id ORDER BY created_at DESC').all();
      res.json(tickets);
    } else if (provider_id) {
      const tickets = db.prepare('SELECT * FROM tickets WHERE provider_id = ? ORDER BY created_at DESC').all(provider_id);
      res.json(tickets);
    } else {
      res.json([]);
    }
  });

  app.post('/api/tickets', authenticate, (req: any, res) => {
    let { provider_id, id: user_id, name: user_name, role } = req.user;
    
    if (!provider_id && role !== 'admin' && role !== 'auditoria') {
      const dbUser = db.prepare('SELECT provider_id FROM users WHERE id = ?').get(user_id) as any;
      if (dbUser && dbUser.provider_id) {
        provider_id = dbUser.provider_id;
      }
    }

    if (!user_name) {
      const user = db.prepare('SELECT name FROM users WHERE id = ?').get(user_id) as any;
      user_name = user?.name || 'Usuário';
    }
    const { title, description, category, priority } = req.body;
    const created_at = new Date().toISOString();
    
    if (!provider_id) {
      return res.status(400).json({ error: 'Prestador não encontrado para este usuário.' });
    }
    
    const insert = db.prepare('INSERT INTO tickets (provider_id, title, description, category, priority, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const info = insert.run(provider_id, title, description, category, priority, 'aberto', created_at);
    
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(info.lastInsertRowid);
    res.json(ticket);
  });

  app.get('/api/tickets/:id/messages', authenticate, (req: any, res) => {
    let { role, provider_id, id: user_id } = req.user;
    const { id } = req.params;
    
    if (!provider_id && role !== 'admin' && role !== 'auditoria') {
      const dbUser = db.prepare('SELECT provider_id FROM users WHERE id = ?').get(user_id) as any;
      if (dbUser && dbUser.provider_id) {
        provider_id = dbUser.provider_id;
      }
    }
    
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    
    if (role !== 'admin' && role !== 'auditoria' && ticket.provider_id !== provider_id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const messages = db.prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC').all(id);
    res.json(messages);
  });

  app.post('/api/tickets/:id/messages', authenticate, (req: any, res) => {
    let { role, provider_id, id: user_id, name: user_name } = req.user;
    
    if (!provider_id && role !== 'admin' && role !== 'auditoria') {
      const dbUser = db.prepare('SELECT provider_id FROM users WHERE id = ?').get(user_id) as any;
      if (dbUser && dbUser.provider_id) {
        provider_id = dbUser.provider_id;
      }
    }

    if (!user_name) {
      const user = db.prepare('SELECT name FROM users WHERE id = ?').get(user_id) as any;
      user_name = user?.name || 'Usuário';
    }
    const { id } = req.params;
    const { message } = req.body;
    
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    
    if (role !== 'admin' && role !== 'auditoria' && ticket.provider_id !== provider_id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const created_at = new Date().toISOString();
    const insertMsg = db.prepare('INSERT INTO ticket_messages (ticket_id, user_id, user_name, role, message, is_status_change, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    const info = insertMsg.run(id, user_id, user_name, role, message, 0, created_at);
    
    // Auto-reopen if provider sends a message and ticket is not 'aberto'
    if (role !== 'admin' && role !== 'auditoria' && ticket.status !== 'aberto') {
      db.prepare('UPDATE tickets SET status = ? WHERE id = ?').run('aberto', id);
      const insertStatusMsg = db.prepare('INSERT INTO ticket_messages (ticket_id, user_id, user_name, role, message, is_status_change, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      insertStatusMsg.run(id, user_id, user_name, role, 'Status alterado para: Aberto', 1, new Date(Date.now() + 1000).toISOString());
    }
    
    const newMsg = db.prepare('SELECT * FROM ticket_messages WHERE id = ?').get(info.lastInsertRowid);
    res.json(newMsg);
  });

  app.put('/api/tickets/:id', authenticate, (req: any, res) => {
    let { role, provider_id, id: user_id, name: user_name } = req.user;
    
    if (!provider_id && role !== 'admin' && role !== 'auditoria') {
      const dbUser = db.prepare('SELECT provider_id FROM users WHERE id = ?').get(user_id) as any;
      if (dbUser && dbUser.provider_id) {
        provider_id = dbUser.provider_id;
      }
    }

    if (!user_name) {
      const user = db.prepare('SELECT name FROM users WHERE id = ?').get(user_id) as any;
      user_name = user?.name || 'Usuário';
    }
    const { id } = req.params;
    const { status, response } = req.body;

    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as any;
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
      const updateTicket = db.prepare('UPDATE tickets SET status = ? WHERE id = ?');
      updateTicket.run(status, id);
      
      if (ticket.status !== status) {
        const insertMsg = db.prepare('INSERT INTO ticket_messages (ticket_id, user_id, user_name, role, message, is_status_change, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        insertMsg.run(id, user_id, user_name, role, `Status alterado para: Aberto`, 1, created_at);
      }
    } else {
      const updateTicket = db.prepare('UPDATE tickets SET status = ? WHERE id = ?');
      updateTicket.run(status, id);
      
      if (ticket.status !== status) {
        const insertMsg = db.prepare('INSERT INTO ticket_messages (ticket_id, user_id, user_name, role, message, is_status_change, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
        insertMsg.run(id, user_id, user_name, role, `Status alterado para: ${status}`, 1, created_at);
      }
    }

    const updatedTicket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(id);
    res.json(updatedTicket);
  });

  // Trainings
  app.get('/api/trainings', authenticate, (req: any, res) => {
    const { provider_id, role } = req.user;
    if (role === 'admin' || role === 'auditoria') {
      const trainings = db.prepare('SELECT * FROM trainings ORDER BY created_at DESC').all();
      res.json(trainings);
    } else if (provider_id) {
      const provider = db.prepare('SELECT provider_group FROM providers WHERE id = ?').get(provider_id) as any;
      const providerGroup = provider?.provider_group || null;

      const trainings = db.prepare(`
        SELECT t.*, pt.status, pt.completed_at 
        FROM trainings t 
        LEFT JOIN provider_trainings pt ON t.id = pt.training_id AND pt.provider_id = ?
        WHERE t.target_type = 'geral'
           OR t.target_type IS NULL
           OR (t.target_type = 'grupo' AND t.target_group = ?)
           OR (t.target_type = 'especifico' AND t.target_provider_id = ?)
        ORDER BY t.created_at DESC
      `).all(provider_id, providerGroup, provider_id);
      res.json(trainings);
    } else {
      res.json([]);
    }
  });

  app.post('/api/trainings', authenticate, (req: any, res) => {
    const { role } = req.user;
    if (role !== 'admin' && role !== 'auditoria') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const { title, description, video_url, pdf_url, target_type, target_group, target_provider_id } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    try {
      const insert = db.prepare('INSERT INTO trainings (title, description, video_url, pdf_url, created_at, target_type, target_group, target_provider_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const info = insert.run(title, description || null, video_url || null, pdf_url || null, new Date().toISOString(), target_type || 'geral', target_group || null, target_provider_id || null);
      res.json({ id: info.lastInsertRowid, title, description, video_url, pdf_url, target_type: target_type || 'geral', target_group, target_provider_id });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/trainings/:id', authenticate, (req: any, res) => {
    const { role } = req.user;
    if (role !== 'admin' && role !== 'auditoria') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
      db.prepare('DELETE FROM trainings WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Financials
  app.get('/api/financials', authenticate, (req: any, res) => {
    const { provider_id, role } = req.user;
    if (role === 'admin' || role === 'auditoria') {
      const financials = db.prepare('SELECT f.*, p.name as provider_name FROM financials f JOIN providers p ON f.provider_id = p.id ORDER BY competence DESC').all();
      res.json(financials);
    } else if (provider_id) {
      const financials = db.prepare('SELECT * FROM financials WHERE provider_id = ? ORDER BY competence DESC').all(provider_id);
      res.json(financials);
    } else {
      res.json([]);
    }
  });

  // Surveys
  app.get('/api/surveys', authenticate, (req: any, res) => {
    let { role, provider_id, id: user_id } = req.user;
    
    // Fallback to check DB if token is stale
    if (!provider_id && role !== 'admin' && role !== 'auditoria') {
      const dbUser = db.prepare('SELECT provider_id FROM users WHERE id = ?').get(user_id) as any;
      if (dbUser && dbUser.provider_id) {
        provider_id = dbUser.provider_id;
      }
    }

    if (role === 'admin' || role === 'auditoria') {
      const surveys = db.prepare(`
        SELECT s.*, p.name as provider_name, p.cnpj as provider_cnpj 
        FROM survey_responses s 
        JOIN providers p ON s.provider_id = p.id 
        ORDER BY s.created_at DESC
      `).all();
      res.json(surveys);
    } else if (provider_id) {
      const surveys = db.prepare('SELECT * FROM survey_responses WHERE provider_id = ? ORDER BY created_at DESC').all(provider_id);
      res.json(surveys);
    } else {
      res.json([]);
    }
  });

  app.post('/api/surveys', authenticate, (req: any, res) => {
    let { provider_id, id: user_id } = req.user;
    
    // Fallback to check DB if token is stale
    if (!provider_id) {
      const dbUser = db.prepare('SELECT provider_id FROM users WHERE id = ?').get(user_id) as any;
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
      const insert = db.prepare('INSERT INTO survey_responses (provider_id, atendimento, comunicacao, sugestoes, created_at) VALUES (?, ?, ?, ?, ?)');
      const info = insert.run(provider_id, atendimento, comunicacao, sugestoes || null, new Date().toISOString());
      res.json({ id: info.lastInsertRowid, success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Announcements
  app.get('/api/announcements', authenticate, (req: any, res) => {
    const { role, provider_id } = req.user;
    if (role === 'admin' || role === 'auditoria') {
      const announcements = db.prepare('SELECT * FROM announcements ORDER BY date DESC').all();
      res.json(announcements);
    } else if (provider_id) {
      const provider = db.prepare('SELECT provider_group FROM providers WHERE id = ?').get(provider_id) as any;
      const providerGroup = provider?.provider_group || null;
      
      const announcements = db.prepare(`
        SELECT * FROM announcements 
        WHERE target_type = 'geral' 
           OR target_type IS NULL
           OR (target_type = 'grupo' AND target_group = ?)
           OR (target_type = 'especifico' AND target_provider_id = ?)
        ORDER BY date DESC
      `).all(providerGroup, provider_id);
      res.json(announcements);
    } else {
      res.json([]);
    }
  });

  app.post('/api/announcements', authenticate, (req: any, res) => {
    const { role } = req.user;
    if (role !== 'admin' && role !== 'auditoria') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const { title, description, category, image_url, date, target_type, target_group, target_provider_id } = req.body;
    if (!title || !description || !category || !date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    try {
      const insert = db.prepare('INSERT INTO announcements (title, description, category, image_url, date, target_type, target_group, target_provider_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const info = insert.run(title, description, category, image_url || null, date, target_type || 'geral', target_group || null, target_provider_id || null);
      res.json({ id: info.lastInsertRowid, title, description, category, image_url, date, target_type: target_type || 'geral', target_group, target_provider_id });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Audits
  app.get('/api/audits', authenticate, (req: any, res) => {
    const { provider_id, role } = req.user;
    if (role === 'admin' || role === 'auditoria') {
      const audits = db.prepare('SELECT a.*, p.name as provider_name FROM audits a JOIN providers p ON a.provider_id = p.id ORDER BY scheduled_date DESC').all();
      res.json(audits);
    } else if (provider_id) {
      const audits = db.prepare('SELECT * FROM audits WHERE provider_id = ? ORDER BY scheduled_date DESC').all(provider_id);
      res.json(audits);
    } else {
      res.json([]);
    }
  });

  // Contracts
  app.get('/api/contracts', authenticate, (req: any, res) => {
    let { provider_id, role, id: user_id } = req.user;
    
    if (!provider_id && role !== 'admin' && role !== 'auditoria') {
      const dbUser = db.prepare('SELECT provider_id FROM users WHERE id = ?').get(user_id) as any;
      if (dbUser && dbUser.provider_id) {
        provider_id = dbUser.provider_id;
      }
    }

    if (role === 'admin' || role === 'auditoria') {
      const contracts = db.prepare('SELECT c.*, p.name as provider_name FROM contracts c JOIN providers p ON c.provider_id = p.id ORDER BY created_at DESC').all();
      res.json(contracts);
    } else if (provider_id) {
      const contracts = db.prepare('SELECT * FROM contracts WHERE provider_id = ? ORDER BY created_at DESC').all(provider_id);
      res.json(contracts);
    } else {
      res.json([]);
    }
  });

  app.post('/api/contracts', authenticate, upload.single('file'), (req: any, res) => {
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
    const insert = db.prepare('INSERT INTO contracts (provider_id, title, file_url, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    const info = insert.run(provider_id, title, file_url, 'pendente', expires_at || null, new Date().toISOString());
    
    const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(info.lastInsertRowid);
    res.json(contract);
  });

  app.put('/api/contracts/:id/sign', authenticate, (req: any, res) => {
    let { provider_id, role, id: user_id } = req.user;
    const { id } = req.params;

    if (!provider_id && role !== 'admin' && role !== 'auditoria') {
      const dbUser = db.prepare('SELECT provider_id FROM users WHERE id = ?').get(user_id) as any;
      if (dbUser && dbUser.provider_id) {
        provider_id = dbUser.provider_id;
      }
    }

    const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(id) as any;
    
    if (!contract) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    if (role !== 'admin' && role !== 'auditoria' && contract.provider_id !== provider_id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (contract.status !== 'pendente') {
      return res.status(400).json({ error: 'Contract already signed or expired' });
    }

    const update = db.prepare('UPDATE contracts SET status = ?, signed_at = ? WHERE id = ?');
    update.run('ativo', new Date().toISOString(), id);

    const updatedContract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(id);
    res.json(updatedContract);
  });

  app.get('/api/contracts/:id/download', authenticate, (req: any, res) => {
    const { provider_id, role } = req.user;
    const { id } = req.params;

    const contract = db.prepare('SELECT * FROM contracts WHERE id = ?').get(id) as any;
    
    if (!contract) {
      return res.status(404).json({ error: 'Contract not found' });
    }

    if (role !== 'admin' && role !== 'auditoria' && contract.provider_id !== provider_id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const filePath = path.join(__dirname, contract.file_url);
    res.download(filePath);
  });

  // Qualifications
  // Qualifications
  app.get('/api/qualifications/cycles', authenticate, (req: any, res) => {
    const cycles = db.prepare('SELECT * FROM qualification_cycles ORDER BY id DESC').all();
    const items = db.prepare('SELECT * FROM qualification_items').all();
    
    const cyclesWithItems = cycles.map((c: any) => ({
      ...c,
      items: items.filter((i: any) => i.cycle_id === c.id)
    }));
    
    res.json(cyclesWithItems);
  });

  app.get('/api/qualifications/submissions', authenticate, (req: any, res) => {
    const { provider_id, role } = req.user;
    let submissions;
    
    if (role === 'admin' || role === 'auditoria') {
      submissions = db.prepare(`
        SELECT s.*, p.name as provider_name, c.title as cycle_title 
        FROM qualification_submissions s 
        JOIN providers p ON s.provider_id = p.id 
        JOIN qualification_cycles c ON s.cycle_id = c.id
        ORDER BY s.created_at DESC
      `).all();
    } else if (provider_id) {
      submissions = db.prepare(`
        SELECT s.*, c.title as cycle_title 
        FROM qualification_submissions s 
        JOIN qualification_cycles c ON s.cycle_id = c.id
        WHERE s.provider_id = ? 
        ORDER BY s.created_at DESC
      `).all(provider_id);
    } else {
      return res.json([]);
    }
    
    res.json(submissions);
  });

  app.get('/api/qualifications/submissions/:id', authenticate, (req: any, res) => {
    const { id } = req.params;
    const { provider_id, role } = req.user;
    
    const submission = db.prepare(`
      SELECT s.*, p.name as provider_name, c.title as cycle_title 
      FROM qualification_submissions s 
      JOIN providers p ON s.provider_id = p.id 
      JOIN qualification_cycles c ON s.cycle_id = c.id
      WHERE s.id = ?
    `).get(id) as any;
    
    if (!submission) return res.status(404).json({ error: 'Submission not found' });
    
    if (role === 'prestador' && submission.provider_id !== provider_id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const items = db.prepare(`
      SELECT si.*, i.title, i.description, i.is_required 
      FROM qualification_submission_items si 
      JOIN qualification_items i ON si.item_id = i.id 
      WHERE si.submission_id = ?
    `).all(id);
    
    submission.items = items;
    res.json(submission);
  });

  app.post('/api/qualifications/submissions', authenticate, upload.any(), (req: any, res) => {
    const { provider_id, role } = req.user;
    const { cycle_id, items } = req.body; // items is a JSON string mapping item_id to details
    
    const targetProviderId = role === 'prestador' ? provider_id : req.body.provider_id;
    
    if (!targetProviderId) return res.status(400).json({ error: 'Provider ID required' });
    
    const parsedItems = JSON.parse(items || '{}');
    
    const insertSub = db.prepare('INSERT INTO qualification_submissions (provider_id, cycle_id, status, submitted_at, created_at) VALUES (?, ?, ?, ?, ?)');
    const subInfo = insertSub.run(targetProviderId, cycle_id, 'em_analise', new Date().toISOString(), new Date().toISOString());
    const submissionId = subInfo.lastInsertRowid;
    
    const insertItem = db.prepare('INSERT INTO qualification_submission_items (submission_id, item_id, is_compliant, evidence_url, auditor_status, text_answer, justification, is_na) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    
    // req.files contains the uploaded files. Field name is like `evidence_${itemId}`
    const files = req.files as Express.Multer.File[];
    
    for (const [itemIdStr, details] of Object.entries(parsedItems)) {
      const itemId = parseInt(itemIdStr);
      const itemDetails: any = details;
      const file = files?.find(f => f.fieldname === `evidence_${itemId}`);
      const fileUrl = file ? `/uploads/${file.filename}` : null;
      
      insertItem.run(
        submissionId, 
        itemId, 
        itemDetails.is_compliant ? 1 : 0, 
        fileUrl, 
        'pendente',
        itemDetails.text_answer || null,
        itemDetails.justification || null,
        itemDetails.is_na ? 1 : 0
      );
    }
    
    res.json({ id: submissionId, message: 'Submission created successfully' });
  });

  app.put('/api/qualifications/submissions/:id/evaluate', authenticate, (req: any, res) => {
    const { role, id: user_id } = req.user;
    const { id } = req.params;
    const { final_status, final_observations, item_evaluations } = req.body;
    
    if (role !== 'admin' && role !== 'auditoria') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const updateSub = db.prepare('UPDATE qualification_submissions SET status = ?, evaluated_at = ?, evaluated_by = ?, final_observations = ? WHERE id = ?');
    updateSub.run(final_status, new Date().toISOString(), user_id, final_observations || null, id);
    
    const updateItem = db.prepare('UPDATE qualification_submission_items SET auditor_status = ?, auditor_observation = ? WHERE submission_id = ? AND item_id = ?');
    
    if (item_evaluations) {
      for (const [itemIdStr, evalData] of Object.entries(item_evaluations as Record<string, any>)) {
        updateItem.run(evalData.status, evalData.observation || null, id, parseInt(itemIdStr));
      }
    }
    
    res.json({ message: 'Evaluation saved successfully' });
  });

  // Credentialing Requests
  app.post('/api/credentialing-requests', upload.single('file'), (req: any, res) => {
    const { name, email, phone, specialty } = req.body;
    const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;
    
    try {
      const insert = db.prepare('INSERT INTO credentialing_requests (name, email, phone, specialty, file_url, created_at) VALUES (?, ?, ?, ?, ?, ?)');
      const info = insert.run(name, email, phone, specialty, fileUrl, new Date().toISOString());
      
      const request = db.prepare('SELECT * FROM credentialing_requests WHERE id = ?').get(info.lastInsertRowid);
      res.json(request);
    } catch (error) {
      console.error('Error creating credentialing request:', error);
      res.status(500).json({ error: 'Failed to create credentialing request' });
    }
  });

  app.get('/api/credentialing-requests', authenticate, (req: any, res) => {
    const { role } = req.user;
    if (role !== 'admin' && role !== 'auditoria') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const requests = db.prepare('SELECT * FROM credentialing_requests ORDER BY created_at DESC').all();
    res.json(requests);
  });

  app.put('/api/credentialing-requests/:id/status', authenticate, (req: any, res) => {
    const { role } = req.user;
    const { id } = req.params;
    const { status } = req.body;
    
    if (role !== 'admin' && role !== 'auditoria') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    const update = db.prepare('UPDATE credentialing_requests SET status = ? WHERE id = ?');
    update.run(status, id);
    
    res.json({ message: 'Status updated successfully' });
  });

  // Action Plans
  app.get('/api/action-plans', authenticate, (req: any, res) => {
    const { provider_id, role } = req.user;
    if (role === 'admin' || role === 'auditoria') {
      const plans = db.prepare('SELECT a.*, p.name as provider_name FROM action_plans a JOIN providers p ON a.provider_id = p.id ORDER BY created_at DESC').all();
      res.json(plans);
    } else if (provider_id) {
      const plans = db.prepare('SELECT * FROM action_plans WHERE provider_id = ? ORDER BY created_at DESC').all(provider_id);
      res.json(plans);
    } else {
      res.json([]);
    }
  });

  app.post('/api/action-plans', authenticate, (req: any, res) => {
    const { provider_id } = req.user;
    const { title, description, deadline } = req.body;
    
    const insert = db.prepare('INSERT INTO action_plans (provider_id, title, description, deadline, status, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    const info = insert.run(provider_id, title, description, deadline, 'pendente', new Date().toISOString());
    
    const plan = db.prepare('SELECT * FROM action_plans WHERE id = ?').get(info.lastInsertRowid);
    res.json(plan);
  });

  app.put('/api/action-plans/:id/status', authenticate, (req: any, res) => {
    const { id } = req.params;
    const { status } = req.body;
    
    const update = db.prepare('UPDATE action_plans SET status = ? WHERE id = ?');
    update.run(status, id);
    
    const plan = db.prepare('SELECT * FROM action_plans WHERE id = ?').get(id);
    res.json(plan);
  });

  // Price Tables
  app.get('/api/price-tables', authenticate, (req: any, res) => {
    const { provider_id, role } = req.user;
    if (role === 'admin' || role === 'auditoria') {
      const tables = db.prepare('SELECT pt.*, p.name as provider_name FROM price_tables pt LEFT JOIN providers p ON pt.provider_id = p.id ORDER BY effective_date DESC').all();
      res.json(tables);
    } else if (provider_id) {
      // Get provider specific tables and general tables
      const tables = db.prepare('SELECT * FROM price_tables WHERE provider_id = ? OR provider_id IS NULL ORDER BY effective_date DESC').all(provider_id);
      res.json(tables);
    } else {
      res.json([]);
    }
  });

  app.get('/api/price-tables/:id/download', authenticate, (req: any, res) => {
    const { provider_id, role } = req.user;
    const { id } = req.params;

    const table = db.prepare('SELECT * FROM price_tables WHERE id = ?').get(id) as any;
    
    if (!table) {
      return res.status(404).json({ error: 'Table not found' });
    }

    if (role !== 'admin' && role !== 'auditoria' && table.provider_id !== provider_id && table.provider_id !== null) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // In a real app, this would send the actual file. For now, we'll just send a dummy response or the path.
    // res.download(path.join(__dirname, table.file_url));
    res.json({ message: 'Download initiated', url: table.file_url });
  });

  // ---------------------------------------------------------
  // NEW EVAL (QUALIFICATION) ENGINE APIs
  // ---------------------------------------------------------

  app.post('/api/eval/scripts', authenticate, (req: any, res) => {
    const { role } = req.user;
    if (role !== 'admin' && role !== 'auditoria') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const { title, description, items } = req.body;
    if (!title || !items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Title and items array are required' });
    }
    try {
      db.exec('BEGIN TRANSACTION');
      const insertScript = db.prepare('INSERT INTO eval_scripts (title, description, version, created_at) VALUES (?, ?, ?, ?)');
      const scriptInfo = insertScript.run(title, description || '', '1.0', new Date().toISOString());
      const scriptId = scriptInfo.lastInsertRowid;

      const insertSection = db.prepare('INSERT INTO eval_sections (script_id, name, order_index) VALUES (?, ?, ?)');
      const secInfo = insertSection.run(scriptId, 'Geral', 1);
      const sectionId = secInfo.lastInsertRowid;

      const insertQuestion = db.prepare(`INSERT INTO eval_questions (section_id, text, type, weight, max_score, evidence_required, is_eliminatory, order_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      
      items.forEach((item: any, index: number) => {
        insertQuestion.run(sectionId, item.title, 'sim_nao', 10, 10, 1, 0, index + 1);
      });

      db.exec('COMMIT');
      res.json({ id: scriptId, title, items });
    } catch (err: any) {
      db.exec('ROLLBACK');
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/eval/scripts/:id', authenticate, (req: any, res) => {
    const { role } = req.user;
    if (role !== 'admin' && role !== 'auditoria') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    try {
      db.exec('BEGIN TRANSACTION');
      const scriptId = req.params.id;
      // get sections
      const sections = db.prepare('SELECT id FROM eval_sections WHERE script_id = ?').all(scriptId) as any[];
      for (const sec of sections) {
        db.prepare('DELETE FROM eval_questions WHERE section_id = ?').run(sec.id);
      }
      db.prepare('DELETE FROM eval_sections WHERE script_id = ?').run(scriptId);
      db.prepare('DELETE FROM eval_scripts WHERE id = ?').run(scriptId);
      db.exec('COMMIT');
      res.json({ success: true });
    } catch (err: any) {
      db.exec('ROLLBACK');
      res.status(400).json({ error: err.message });
    }
  });

  app.get('/api/eval/scripts', authenticate, (req: any, res) => {
    try {
      const scripts = db.prepare('SELECT * FROM eval_scripts ORDER BY created_at DESC').all() as any[];
      const scriptsWithItems = scripts.map((script) => {
        const questions = db.prepare(`
          SELECT eq.id, eq.text as title FROM eval_questions eq
          JOIN eval_sections es ON eq.section_id = es.id
          WHERE es.script_id = ?
          ORDER BY eq.order_index ASC
        `).all(script.id);
        return { ...script, items: questions };
      });
      res.json(scriptsWithItems);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eval/scripts/:id', authenticate, (req: any, res) => {
    try {
      const script = db.prepare('SELECT * FROM eval_scripts WHERE id = ?').get(req.params.id);
      if (!script) return res.status(404).json({ error: 'Script not found' });
      
      const sections = db.prepare('SELECT * FROM eval_sections WHERE script_id = ? ORDER BY order_index ASC').all(req.params.id);
      
      const questionsSql = `
        SELECT eq.* FROM eval_questions eq
        JOIN eval_sections es ON eq.section_id = es.id
        WHERE es.script_id = ?
        ORDER BY eq.order_index ASC
      `;
      const questions = db.prepare(questionsSql).all(req.params.id);

      res.json({ ...script, sections, questions });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/eval/instances', authenticate, (req: any, res) => {
    const { role } = req.user;
    if (role !== 'admin' && role !== 'auditoria') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    const { script_id, provider_id } = req.body;
    try {
      const dbInsert = db.prepare(`
        INSERT INTO eval_instances (script_id, provider_id, status, started_at) 
        VALUES (?, ?, 'em_andamento', ?)
      `);
      const info = dbInsert.run(script_id, provider_id, new Date().toISOString());
      res.json({ success: true, id: info.lastInsertRowid });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eval/instances', authenticate, (req: any, res) => {
    const { provider_id, role } = req.user;
    try {
      let query = `
        SELECT ei.*, s.title as script_title, p.name as provider_name 
        FROM eval_instances ei
        JOIN eval_scripts s ON ei.script_id = s.id
        JOIN providers p ON ei.provider_id = p.id
      `;
      let instances;
      if (role === 'admin' || role === 'auditoria') {
        instances = db.prepare(query + ' ORDER BY ei.started_at DESC').all();
      } else {
        instances = db.prepare(query + ' WHERE ei.provider_id = ? ORDER BY ei.started_at DESC').all(provider_id);
      }
      res.json(instances);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/eval/instances/:id', authenticate, (req: any, res) => {
    try {
      const instance = db.prepare(`
        SELECT ei.*, s.title as script_title, p.name as provider_name 
        FROM eval_instances ei
        JOIN eval_scripts s ON ei.script_id = s.id
        JOIN providers p ON ei.provider_id = p.id
        WHERE ei.id = ?
      `).get(req.params.id);
      
      if (!instance) return res.status(404).json({ error: 'Instance not found' });
      
      const answers = db.prepare('SELECT * FROM eval_answers WHERE instance_id = ?').all(req.params.id);
      
      // Need to add reference_id gracefully if it doesn't exist
      try { db.exec('ALTER TABLE documents ADD COLUMN reference_id INTEGER;'); } catch(e){}
      
      const evidences = db.prepare('SELECT * FROM documents WHERE type = ? AND reference_id = ?').all('qualificacao_evidencia', req.params.id);

      res.json({ ...instance, answers, evidences });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/eval/instances/:id/answers', authenticate, (req: any, res) => {
    const instanceId = req.params.id;
    const { answers } = req.body; 
    
    try {
      // Create unique index safely
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_eval_answers_unique ON eval_answers(instance_id, question_id)');
      
      const upsert = db.prepare(`
        INSERT INTO eval_answers (instance_id, question_id, answer_value, score_obtained, provider_observation, is_non_compliant)
        VALUES (@instance_id, @question_id, @answer_value, @score_obtained, @provider_observation, @is_non_compliant)
        ON CONFLICT(instance_id, question_id) DO UPDATE SET 
          answer_value = excluded.answer_value,
          score_obtained = excluded.score_obtained,
          provider_observation = excluded.provider_observation,
          is_non_compliant = excluded.is_non_compliant
      `);
      
      const transaction = db.transaction((ansList: any[]) => {
        for (const ans of ansList) {
          upsert.run({
            instance_id: instanceId,
            question_id: ans.question_id,
            answer_value: ans.answer_value || null,
            score_obtained: ans.score_obtained || 0,
            provider_observation: ans.provider_observation || null,
            is_non_compliant: ans.is_non_compliant || 0
          });
        }
      });
      transaction(answers);
      
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/eval/instances/:id/status', authenticate, (req: any, res) => {
    const { status, score, percentual, max_possible_score, seal } = req.body;
    try {
      const update = db.prepare(`
        UPDATE eval_instances 
        SET status = ?, score = ?, max_possible_score = ?, percentual = ?, seal = ?, completed_at = CASE WHEN ? = 'finalizado' THEN ? ELSE completed_at END
        WHERE id = ?
      `);
      
      const now = new Date().toISOString();
      update.run(status, score || 0, max_possible_score || 0, percentual || 0, seal || null, status, now, req.params.id);
      
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/eval/instances/:id/evidence', authenticate, upload.single('file'), (req: any, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Add reference column if not exist
    try { db.exec('ALTER TABLE documents ADD COLUMN reference_id INTEGER;'); } catch(e){}
    
    const instanceId = req.params.id;
    const providerId = req.user.provider_id || (req.body.provider_id ? parseInt(req.body.provider_id) : 1);
    const fileUrl = '/uploads/' + req.file.filename;

    try {
      const insertDoc = db.prepare(`
        INSERT INTO documents (provider_id, type, issue_date, status, file_url, uploaded_by, reference_id) 
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insertDoc.run(providerId, 'qualificacao_evidencia', new Date().toISOString(), 'valido', fileUrl, req.user.id, instanceId);
      
      res.json({ success: true, url: fileUrl });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
  
  app.get('/api/eval/dashboard', authenticate, (req: any, res) => {
    const { role } = req.user;
    if (role !== 'admin' && role !== 'auditoria') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    try {
      const totalInstances = db.prepare('SELECT COUNT(*) as count FROM eval_instances').get() as any;
      const approvedInstances = db.prepare("SELECT COUNT(*) as count FROM eval_instances WHERE status = 'finalizado' AND seal IS NOT NULL").get() as any;
      const avgPercentual = db.prepare("SELECT AVG(percentual) as avg FROM eval_instances WHERE status = 'finalizado'").get() as any;
      
      const instancesByStatus = db.prepare("SELECT status, COUNT(*) as count FROM eval_instances GROUP BY status").all();
      
      res.json({
        total: totalInstances.count,
        approved: approvedInstances.count,
        avg_score: avgPercentual.avg || 0,
        by_status: instancesByStatus
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });


  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  
  console.log("=== ROUTES REGISTERED ===");
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (req, res) => {
      res.sendFile('index.html', { root: 'dist' });
    });
  }

  // Ensure all required roles exist
  try {
    const hash = bcrypt.hashSync('senha123', 10);
    const insertUserIfNotExists = db.prepare('INSERT OR IGNORE INTO users (name, email, password, role, provider_id) VALUES (?, ?, ?, ?, ?)');
    insertUserIfNotExists.run('Dra. Ana Souza', 'cooperado@unimed.com', hash, 'cooperado', null);
  } catch (e) {
    console.error('Error ensuring users:', e);
  }

}

startServer();
