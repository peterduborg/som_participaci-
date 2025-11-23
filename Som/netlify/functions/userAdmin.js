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
  const adminEmail = (data.adminEmail || '').trim().toLowerCase();

  try {
    // Admin-Check
    if (!adminEmail) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'adminEmail erforderlich' })
      };
    }

    const adminRes = await pool.query(
      'SELECT is_admin FROM app_users WHERE LOWER(email) = LOWER($1)',
      [adminEmail]
    );

    if (adminRes.rowCount === 0 || !adminRes.rows[0].is_admin) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'No autoritzat' })
      };
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
          
          -- Anzahl Propostes
          COUNT(DISTINCT p.id) AS proposals_count,
          
          -- Gesamtpunkte (Summe aller proposal_votes dieses Users)
          COALESCE(SUM(pv.value), 0)::INTEGER AS points_total,
          
          -- Anzahl Kommentare
          COUNT(DISTINCT c.id) AS comments_count,
          
          -- Anzahl Likes (comment_votes mit value > 0)
          COUNT(DISTINCT CASE WHEN cv.value > 0 THEN cv.comment_id END) AS likes_count,
          
          -- Letzter Login (falls vorhanden)
          NULL::TIMESTAMPTZ AS last_login_at

        FROM app_users u
        LEFT JOIN proposals p ON LOWER(p.email) = LOWER(u.email)
        LEFT JOIN proposal_votes pv ON LOWER(pv.email) = LOWER(u.email)
        LEFT JOIN comments c ON LOWER(c.user_email) = LOWER(u.email)
        LEFT JOIN comment_votes cv ON LOWER(cv.user_email) = LOWER(u.email)

        GROUP BY u.id, u.email, u.username, u.is_admin, u.created_at, u.updated_at
        ORDER BY u.created_at DESC
      `;

      const res = await pool.query(query);

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          users: res.rows
        })
      };
    }

    // ========== UPDATE USER ==========
    if (action === 'updateUser') {
      const userId = data.id;
      const email = (data.email || '').trim().toLowerCase();
      const username = (data.username || '').trim();
      const is_admin = !!data.is_admin;

      if (!userId || !email || !username) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Falten camps' })
        };
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
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'User ID fehlt' })
        };
      }

      // Prüfen, ob User sich selbst löschen will
      const userRes = await pool.query(
        'SELECT email FROM app_users WHERE id = $1',
        [userId]
      );

      if (userRes.rowCount > 0) {
        const userEmail = userRes.rows[0].email.toLowerCase();
        if (userEmail === adminEmail) {
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ error: 'No pots esborrar el teu propi compte' })
          };
        }
      }

      // Lösche User
      await pool.query('DELETE FROM app_users WHERE id = $1', [userId]);

      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true })
      };
    }

    // ========== RECALC POINTS (optional) ==========
    if (action === 'recalcPoints') {
      // Hier könntest du z.B. die points_total in app_users aktualisieren
      // Falls du die Spalte hinzufügst. Aktuell wird sie bei listUsers berechnet.
      
      return {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          ok: true, 
          message: 'Punts es calculen automàticament' 
        })
      };
    }

    // ========== UNKNOWN ACTION ==========
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Acció desconeguda' })
    };

  } catch (err) {
    console.error('Error in userAdmin:', err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Internal Server Error' })
    };
  }
};
