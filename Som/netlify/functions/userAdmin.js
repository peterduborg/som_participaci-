// netlify/functions/userAdmin.js
const { Pool } = require('pg');

const connectionString =
  process.env.DATABASE_URL ||
  process.env.Database_URL ||
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED;

console.log(
  'USERADMIN FUNCTION START, connectionString prefix:',
  (connectionString || 'UNDEFINED').slice(0, 40)
);

if (!connectionString) {
  throw new Error('DATABASE_URL / Database_URL / NETLIFY_DATABASE_URL not set');
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

exports.handler = async (event, context) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS'
  };

  // CORS Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: 'Method not allowed' })
    };
  }

  if (!event.body) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: 'Missing body' })
    };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: 'Invalid JSON' })
    };
  }

  const action = data.action;
  const adminEmail = (data.adminEmail || '').trim().toLowerCase();

  if (!action) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: 'Missing action' })
    };
  }

  if (!adminEmail) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: 'Missing adminEmail' })
    };
  }

  try {
    // Gleiche Tabelle wie in auth.js, plus updated_at
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

    await pool.query(`
      ALTER TABLE app_users
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
    `);

    // Admin prüfen
    const adminRes = await pool.query(
      'SELECT is_admin FROM app_users WHERE LOWER(email) = LOWER($1)',
      [adminEmail]
    );
    if (adminRes.rowCount === 0 || !adminRes.rows[0].is_admin) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: 'Not an admin' })
      };
    }

    // ---------- listUsers ----------
    if (action === 'listUsers') {
      const result = await pool.query(
        `SELECT id, email, username, is_admin, created_at, updated_at
         FROM app_users
         ORDER BY email ASC`
      );
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, users: result.rows })
      };
    }

    // ---------- updateUser ----------
    if (action === 'updateUser') {
      const { id, email, username, is_admin } = data;

      if (!id) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'Missing user id' })
        };
      }

      const fields = [];
      const values = [];
      let idx = 1;

      if (email != null) {
        fields.push(`email = $${idx++}`);
        values.push(String(email).trim().toLowerCase());
      }
      if (username != null) {
        fields.push(`username = $${idx++}`);
        values.push(String(username).trim());
      }
      if (typeof is_admin === 'boolean') {
        fields.push(`is_admin = $${idx++}`);
        values.push(is_admin);
      }

      if (!fields.length) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'No fields to update' })
        };
      }

      fields.push(`updated_at = NOW()`); // immer aktualisieren
      const sql =
        `UPDATE app_users
         SET ${fields.join(', ')}
         WHERE id = $${idx}
         RETURNING id, email, username, is_admin, created_at, updated_at`;

      values.push(id);

      const updRes = await pool.query(sql, values);

      if (updRes.rowCount === 0) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'User not found' })
        };
      }

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, user: updRes.rows[0] })
      };
    }

    // ---------- deleteUser ----------
    if (action === 'deleteUser') {
      const { id } = data;
      if (!id) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'Missing user id' })
        };
      }

      // eigenen Admin-Account nicht löschen
      const selfRes = await pool.query(
        'SELECT id FROM app_users WHERE LOWER(email) = LOWER($1) LIMIT 1',
        [adminEmail]
      );
      if (selfRes.rowCount && String(selfRes.rows[0].id) === String(id)) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: 'Admin cannot delete themselves' })
        };
      }

      const delRes = await pool.query(
        'DELETE FROM app_users WHERE id = $1',
        [id]
      );

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, deleted: delRes.rowCount })
      };
    }

    // ---------- Unbekannte Action ----------
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: 'Unknown action' })
    };

  } catch (err) {
    console.error('userAdmin error:', err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'Server error', details: err.message })
    };
  }
};
