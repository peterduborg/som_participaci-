// netlify/functions/auth.js
const { Pool } = require('pg');
const bcrypt = require('bcryptjs'); // in package.json als dependency eintragen

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

exports.handler = async (event, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  if (!event.body) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Missing body' })
    };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid JSON' })
    };
  }

  const action = data.action;

  try {
    // 1) Tabelle sicherstellen
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        id          SERIAL PRIMARY KEY,
        email       TEXT UNIQUE NOT NULL,
        username    TEXT NOT NULL,
        password    TEXT NOT NULL,
        is_admin    BOOLEAN NOT NULL DEFAULT false,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // 2) Default-User tim@gmail.com anlegen (falls nicht vorhanden)
    const defaultEmail = 'tim@gmail.com';
    const defaultPass  = '12341234';
    const defaultUser  = 'Tim';

    const existing = await pool.query(
      'SELECT id FROM app_users WHERE email = $1',
      [defaultEmail]
    );
    if (existing.rowCount === 0) {
      const hash = await bcrypt.hash(defaultPass, 10);
      await pool.query(
        `INSERT INTO app_users (email, username, password, is_admin)
         VALUES ($1,$2,$3,true)`,
        [defaultEmail, defaultUser, hash]
      );
    }

    // --------- LOGIN ----------
    if (action === 'login') {
      const email = (data.email || '').trim().toLowerCase();
      const password = (data.password || '').trim();

      if (!email || !password) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'Email i contrasenya requerits' })
        };
      }

      const res = await pool.query(
        'SELECT id, email, username, password, is_admin FROM app_users WHERE email = $1',
        [email]
      );
      if (res.rowCount === 0) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'Usuari no trobat' })
        };
      }

      const row = res.rows[0];
      const match = await bcrypt.compare(password, row.password);
      if (!match) {
        return {
          statusCode: 200,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'Contrasenya incorrecta' })
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
            is_admin: row.is_admin
          }
        })
      };
    }

    // --------- USER ANLEGEN (nur für Tim/Admin) ----------
    if (action === 'createUser') {
      const adminEmail = (data.adminEmail || '').trim().toLowerCase();
      const email = (data.email || '').trim().toLowerCase();
      const username = (data.username || '').trim();
      const password = (data.password || '').trim();

      if (!adminEmail || !email || !username || !password) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Falten camps' })
        };
      }

      // prüfen, ob adminEmail admin ist
      const adminRes = await pool.query(
        'SELECT is_admin FROM app_users WHERE email = $1',
        [adminEmail]
      );
      if (adminRes.rowCount === 0 || !adminRes.rows[0].is_admin) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'No autoritzat' })
        };
      }

      const hash = await bcrypt.hash(password, 10);
      try {
        await pool.query(
          `INSERT INTO app_users (email, username, password, is_admin)
           VALUES ($1,$2,$3,false)`,
          [email, username, hash]
        );
      } catch (e) {
        if (e.code === '23505') { // unique_violation
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ ok: false, error: 'Usuari ja existent' })
          };
        }
        throw e;
      }

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true })
      };
    }

    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Acció no vàlida' })
    };

  } catch (err) {
    console.error('Error in auth function:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
      body: JSON.stringify({ error: err.message || 'Internal Server Error' })
    };
  }
};
