import Database from 'better-sqlite3';
const db = new Database('unimed_mvp.db');
const users = db.prepare('SELECT * FROM users WHERE email = ?').all('luannawebdesign@gmail.com');
console.log(JSON.stringify(users, null, 2));
