require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../config/db');

(async function () {
  try {
    var sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await db.query(sql);
    console.log('Tables are ready.');
  } catch (err) {
    console.error('Could not set up the database:', err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();