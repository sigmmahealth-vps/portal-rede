import Database from 'better-sqlite3';
const db = new Database('unimed_mvp.db');
const users = db.prepare('SELECT id, name, email, role FROM users').all();
console.log(JSON.stringify(users, null, 2));
