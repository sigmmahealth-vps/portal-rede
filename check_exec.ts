import Database from 'better-sqlite3';
const db = new Database('unimed_mvp.db');
try {
  db.exec(`
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
  `);
  console.log("Success");
} catch (e) {
  console.error(e);
}
