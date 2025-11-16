// netlify/functions/auth.js
//
// Voraussetzungen:
//   npm install pg bcryptjs
//   In Netlify: Umgebungsvariable DATABASE_URL setzen (Neon-Connection-String)

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

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

  // CORS-Preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Mètode no permès' })
    };
  }

  if (!event.body) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Cos de la petició buit' })
    };
  }

  let data;
  try {
    data = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Cos JSON no vàlid' })
    };
  }

  const action = data.action;

  try {
    // ----------------------------------------------------
    // 1) LOGIN
    // ----------------------------------------------------
    if (action === 'login') {
      const rawEmail = (data.email || '').trim().toLowerCase();
      const password = (data.password || '').trim();

      if (!rawEmail || !password) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Cal indicar correu i contrasenya' })
        };
      }

      // Spezialfall: fester Admin-User tim@gmail.com / 12341234
      if (rawEmail === 'tim@gmail.com' && password === '12341234') {
        const username = 'tim';

        // Sicherstellen, dass tim in der Tabelle steht und Admin ist
        await pool.query(
          `
          INSERT INTO app_users (email, username, password_hash, is_admin)
          VALUES ($1, $2, $3, TRUE)
          ON CONFLICT (email)
          DO UPDATE SET is_admin = TRUE
          `,
          [
            rawEmail,
            username,
            // Dummy-Hash, wird nie für die Prüfung verwendet
            await bcrypt.hash('DUMMY_ADMIN_PASSWORD_IGNORE', 10)
          ]
        );

        return {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            success: true,
            email: rawEmail,
            username,
            isAdmin: true
          })
        };
      }

      // Normale User: aus DB holen
      const { rows } = await pool.query(
        `SELECT id, email, username, password_hash, is_admin
         FROM app_users
         WHERE email = $1`,
        [rawEmail]
      );

      if (rows.length === 0) {
        return {
          statusCode: 401,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Credencials incorrectes' })
        };
      }

      const user = rows[0];
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        return {
          statusCode: 401,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Credencials incorrectes' })
        };
      }

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          email: user.email,
          username: user.username,
          isAdmin: user.is_admin
        })
      };
    }

    // ----------------------------------------------------
    // 2) REGISTER – neuen User anlegen
    // Nur erlaubt, wenn:
    //   a) adminEmail/adminPassword = tim/12341234  ODER
    //   b) adminEmail/adminPassword = existierender is_admin-User in DB
    // ----------------------------------------------------
    if (action === 'register') {
      const adminEmail = (data.adminEmail || '').trim().toLowerCase();
      const adminPassword = (data.adminPassword || '').trim();

      const newEmail = (data.newEmail || '').trim().toLowerCase();
      const newName = (data.newName || '').trim();
      const newPassword = (data.newPassword || '').trim();

      if (!adminEmail || !adminPassword) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Falten credencials d\'administrador' })
        };
      }

      if (!newEmail || !newName || !newPassword) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Cal indicar correu, nom i contrasenya del nou usuari' })
        };
      }

      let adminOk = false;

      // a) tim@gmail.com / 12341234 darf immer
      if (adminEmail === 'tim@gmail.com' && adminPassword === '12341234') {
        adminOk = true;
      } else {
        // b) anderer Admin aus DB
        const { rows } = await pool.query(
          `SELECT email, password_hash, is_admin
           FROM app_users
           WHERE email = $1`,
          [adminEmail]
        );
        if (rows.length > 0 && rows[0].is_admin) {
          const pwOk = await bcrypt.compare(adminPassword, rows[0].password_hash);
          if (pwOk) adminOk = true;
        }
      }

      if (!adminOk) {
        return {
          statusCode: 403,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'No tens permisos per crear usuaris' })
        };
      }

      const hash = await bcrypt.hash(newPassword, 10);

      const result = await pool.query(
        `
        INSERT INTO app_users (email, username, password_hash, is_admin)
        VALUES ($1, $2, $3, FALSE)
        ON CONFLICT (email)
        DO UPDATE SET
          username = EXCLUDED.username,
          password_hash = EXCLUDED.password_hash
        RETURNING id, email, username, is_admin, created_at
        `,
        [newEmail, newName, hash]
      );

      const user = result.rows[0];

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: true,
          user
        })
      };
    }

    // ----------------------------------------------------
    // Unbekannte Action
    // ----------------------------------------------------
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
