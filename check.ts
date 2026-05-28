import Database from 'better-sqlite3';
const db = new Database('database.sqlite');
const cycles = db.prepare('SELECT * FROM qualification_cycles').all();
console.log(JSON.stringify(cycles, null, 2));
