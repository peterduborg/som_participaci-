const { Pool } = require('pg');

const connectionString =
  process.env.DATABASE_URL ||
  process.env.Database_URL ||
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED;

if (!connectionString) {
  throw new Error('DATABASE_URL not set');
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

exports.handler = async (event) => {
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

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Invalid JSON' })
    };
  }

  const action = data.action;
  const adminEmail = String(data.adminEmail || '').trim().toLowerCase();

  try {
    // Admin-Check
    if (!adminEmail) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'adminEmail erforderlich' }) };
    }

    const adminRes = await pool.query(
      'SELECT is_admin FROM app_users WHERE LOWER(email) = LOWER($1)',
      [adminEmail]
    );

    if (adminRes.rowCount === 0 || !adminRes.rows[0].is_admin) {
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ error: 'No autoritzat' }) };
    }

    // ========== LIST USERS ==========
    if (action === 'listUsers') {
      const query = `
        SELECT 
          u.id,
          u.email,
          u.username,
          u.is_admin,
          u.created_at,
          u.updated_at,
          (SELECT COUNT(*) FROM proposals p WHERE LOWER(p.email) = LOWER(u.email)) AS proposals_count,
          (SELECT COALESCE(SUM(v.points), 0) FROM votes v WHERE LOWER(v.user_email) = LOWER(u.email)) AS points_total,
          (SELECT COUNT(*) FROM comments c WHERE LOWER(c.user_email) = LOWER(u.email)) AS comments_count,
          (SELECT COUNT(*) FROM comment_votes cv WHERE LOWER(cv.user_email) = LOWER(u.email) AND cv.value > 0) AS likes_count,
          u.last_login_at
        FROM app_users u
        ORDER BY u.created_at DESC
      `;
      const res = await pool.query(query);

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, users: res.rows })
      };
    }

    // ========== UPDATE USER ==========
    if (action === 'updateUser') {
      const userId = data.id;
      const email = String(data.email || '').trim().toLowerCase();
      const username = String(data.username || '').trim();
      const is_admin = !!data.is_admin;

      if (!userId || !email || !username) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Falten camps' }) };
      }

      await pool.query(
        `UPDATE app_users 
         SET email = $1, username = $2, is_admin = $3, updated_at = NOW()
         WHERE id = $4`,
        [email, username, is_admin, userId]
      );

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true })
      };
    }

    // ========== DELETE USER ==========
    if (action === 'deleteUser') {
      const userId = data.id;

      if (!userId) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'User ID fehlt' }) };
      }

      const userRes = await pool.query('SELECT email FROM app_users WHERE id = $1', [userId]);
      if (userRes.rowCount > 0) {
        const userEmail = String(userRes.rows[0].email || '').toLowerCase();
        if (userEmail === adminEmail) {
          return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'No pots esborrar el teu propi compte' }) };
        }
      }

      await pool.query('DELETE FROM app_users WHERE id = $1', [userId]);

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true })
      };
    }

    // ========== RESET PASSWORD (GENAU app_users.password überschreiben) ==========
    if (action === 'resetPassword') {
      const userId = data.id;
      const tempPassword = String(data.tempPassword || '').trim();

      if (!userId || !tempPassword) {
        return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'id i tempPassword obligatoris' }) };
      }

      // optional: self-reset verhindern
      const uRes = await pool.query('SELECT email FROM app_users WHERE id = $1', [userId]);
      if (uRes.rowCount > 0) {
        const uEmail = String(uRes.rows[0].email || '').toLowerCase();
        if (uEmail === adminEmail) {
          return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'No pots resetejar la teva pròpia contrasenya aquí' }) };
        }
      }

      await pool.query(
        `UPDATE app_users
         SET password = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [tempPassword, userId]
      );

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true })
      };
    }

    // ========== RECALC POINTS ==========
    if (action === 'recalcPoints') {
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, message: 'Punts es calculen automàticament' })
      };
    }

    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Acció desconeguda' }) };

  } catch (err) {
    console.error('Error in userAdmin:', err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Internal Server Error' })
    };
  }
};
