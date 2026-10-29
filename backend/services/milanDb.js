'use strict';

const { Pool } = require('pg');
const connectionString =
  process.env.MILAN_DATABASE_URL ||
  process.env.DATABASE_URL ||
  '';

if (!connectionString) {
  throw new Error('MILAN_DATABASE_URL is required for the MILAN PostgreSQL database.');
}

const pool = new Pool({
  connectionString,
  max: 5,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000
});

pool.on('error', err => {
  console.error('[milan-db] PostgreSQL connection error:', err.message);
});

module.exports = pool;
