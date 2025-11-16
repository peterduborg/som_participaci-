// netlify/functions/auth.js
const { Pool } = require('pg');

// --------- DB-Verbindung sauber initialisieren ----------
const connectionString =
  process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || '';

console.log(
  'AUTH FUNCTION START, connectionString prefix:',
  connectionString ? connectionString.slice(0, 40) : 'EMPTY'
);

let pool = null;
if (connectionString) {
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
}

// --------------------------------------------------------
// HTTPS-Handler
exports.handler = async (event, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  if (!event.body) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing body' }),
    };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  // Falls ENV nicht gesetzt → NICHT versuchen auf 127.0.0.1 zu gehen
  if (!connectionString || !pool) {
    console.error('AUTH: No DATABASE_URL / NEON_DATABASE_URL set!');
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        ok: false,
        error: 'DATABASE_URL / NEON_DATABASE_URL not set on server',
      }),
    };
  }

  const action = data.action;

  try {
    // Tabelle anlegen (Schema mit password_hash)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        id           SERIAL PRIMARY KEY,
        email        TEXT UNIQUE NOT NULL,
        username     TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin     BOOLEAN NOT NULL DEFAULT false,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // Default-Admin Tim
    const defaultEmail = 'tim@gmail.com';
    const defaultPass  = '12341234';
    const defaultUser  = 'Tim';

    await pool.query(
      `INSERT INTO app_users (email, username, password_hash, is_admin)
       VALUES ($1,$2,$3,true)
       ON CONFLICT (email) DO NOTHING`,
      [defaultEmail, defaultUser, defaultPass]
    );

    // -------------- LOGIN ----------------
    if (action === 'login') {
      const email = (data.email || '').trim().toLowerCase();
      const password = (data.password || '').trim();

      if (!email || !password) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            ok: false,
            error: 'Email i contrasenya requerits',
          }),
        };
      }

      const res = await pool.query(
        `SELECT email, username, password_hash, is_admin
           FROM app_users
          WHERE email = $1`,
        [email]
      );

      if (res.rowCount === 0) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'Usuari no trobat' }),
        };
      }

      const row = res.rows[0];

      // Momentan Klartext-Vergleich – später Hashing verbessern
      if (row.password_hash !== password) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'Contrasenya incorrecta' }),
        };
      }

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          user: {
            email: row.email,
            username: row.username,
            is_admin: row.is_admin,
          },
        }),
      };
    }

    // -------------- USER ANLEGEN (nur Admin) ---------
    if (action === 'createUser') {
      const adminEmail = (data.adminEmail || '').trim().toLowerCase();
      const email = (data.email || '').trim().toLowerCase();
      const username = (data.username || '').trim();
      const password = (data.password || '').trim();

      if (!adminEmail || !email || !username || !password) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Falten camps' }),
        };
      }

      const adminRes = await pool.query(
        'SELECT is_admin FROM app_users WHERE email = $1',
        [adminEmail]
      );
      if (adminRes.rowCount === 0 || !adminRes.rows[0].is_admin) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'No autoritzat' }),
        };
      }

      try {
        await pool.query(
          `INSERT INTO app_users (email, username, password_hash, is_admin)
           VALUES ($1,$2,$3,false)`,
          [email, username, password]
        );
      } catch (e) {
        if (e.code === '23505') {
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ ok: false, error: 'Usuari ja existent' }),
          };
        }
        throw e;
      }

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true }),
      };
    }

    // Unbekannte Action
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Acció no vàlida' }),
    };
  } catch (err) {
    console.error('Error in auth function:', err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message || 'Internal Server Error' }),
    };
  }
};
