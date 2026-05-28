import Database from 'better-sqlite3';
const db = new Database('unimed_mvp.db');
const cycles = db.prepare('SELECT * FROM qualification_cycles').all();
console.log(JSON.stringify(cycles, null, 2));
