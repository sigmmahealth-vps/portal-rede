const Database = require('better-sqlite3');
const db = new Database('unimed_mvp.db');

console.log(db.prepare('SELECT * FROM eval_scripts').all());
console.log(db.prepare('SELECT * FROM eval_sections').all());
console.log(db.prepare('SELECT * FROM eval_questions').all());
