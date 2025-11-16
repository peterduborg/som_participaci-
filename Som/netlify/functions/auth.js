// netlify/functions/auth.js
const { Pool } = require('pg');

console.log('AUTH FUNCTION START, DATABASE_URL prefix:',
  (process.env.DATABASE_URL || 'UNDEFINED').slice(0, 40)
);

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
    // Tabelle für User (Passwort aktuell im Klartext – für Demo, später besser hashen)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        id         SERIAL PRIMARY KEY,
        email      TEXT UNIQUE NOT NULL,
        username   TEXT NOT NULL,
        password   TEXT NOT NULL,
        is_admin   BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // Default-Admin tim@gmail.com / 12341234 anlegen (falls nicht existiert)
    const defaultEmail = 'tim@gmail.com';
    const defaultPass  = '12341234';
    const defaultUser  = 'Tim';

    const existing = await pool.query(
      'SELECT id FROM app_users WHERE email = $1',
      [defaultEmail]
    );
    if (existing.rowCount === 0) {
      await pool.query(
        `INSERT INTO app_users (email, username, password, is_admin)
         VALUES ($1,$2,$3,true)`,
        [defaultEmail, defaultUser, defaultPass]
      );
    }

    // ---------- LOGIN ----------
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
        'SELECT email, username, password, is_admin FROM app_users WHERE email = $1',
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
      if (row.password !== password) {
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

    // ---------- NEUEN USER ANLEGEN (nur für Admin, z.B. Tim) ----------
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

      // Prüfen, ob Admin
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

      try {
        await pool.query(
          `INSERT INTO app_users (email, username, password, is_admin)
           VALUES ($1,$2,$3,false)`,
          [email, username, password]
        );
      } catch (e) {
        if (e.code === '23505') {
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

    // Unbekannte Action
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Acció no vàlida' })
    };

  } catch (err) {
    console.error('Error in auth function:', err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Internal Server Error' })
    };
  }
};
