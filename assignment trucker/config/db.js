const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined
});

pool.on('error', function (err) {
  console.error('Unexpected PostgreSQL connection error:', err.message);
});

module.exports = { pool: pool, query: function () { return pool.query.apply(pool, arguments); } };