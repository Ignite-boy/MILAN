'use strict';

const { Pool } = require('pg');
const fs = require('fs');
const os = require('os');
const path = require('path');

const localUrlPath = path.join(os.homedir(), '.config', 'milan', 'voroa-app-db-url');
const connectionString =
  process.env.MILAN_DATABASE_URL ||
  process.env.DATABASE_URL ||
  (fs.existsSync(localUrlPath)
    ? fs.readFileSync(localUrlPath, 'utf8').trim()
    : '');

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
