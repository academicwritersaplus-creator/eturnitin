'use strict';
const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
});

pool.on('error', err => console.error('[db] idle client error', err.message));

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
