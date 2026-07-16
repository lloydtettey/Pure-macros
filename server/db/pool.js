const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — copy .env.example to .env and fill in your Supabase connection string');
}

// Supabase's certificate chain isn't in Node's default trusted CA bundle, so
// rejectUnauthorized: false is needed to avoid a self-signed-cert error —
// the connection itself is still encrypted, this only skips CA verification.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.on('error', (err) => {
  // Fires for errors on idle clients in the pool (e.g. a connection dropped
  // by the server) — must be handled or an unrelated later request crashes
  // the whole process the next time Node surfaces the unhandled rejection.
  console.error('Unexpected Postgres pool error', err);
});

module.exports = pool;
