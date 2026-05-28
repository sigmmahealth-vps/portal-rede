import Database from 'better-sqlite3';

const db = new Database('unimed_mvp.db');

try {
  const insert = db.prepare('INSERT INTO credentialing_requests (name, email, phone, specialty, file_url, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const info = insert.run('Test Clinic', 'test@test.com', '123', 'Clinica', null, new Date().toISOString());
  console.log('Inserted ID:', info.lastInsertRowid);
  
  const requests = db.prepare('SELECT * FROM credentialing_requests').all();
  console.log('All requests:', requests);
} catch (e) {
  console.error(e);
}
