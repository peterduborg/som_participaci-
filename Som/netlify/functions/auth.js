// netlify/functions/auth.js

const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// DB-Verbindung – nimmt NETLIFY_DATABASE_URL, fällt sonst auf DATABASE_URL zurück
const connectionString =
  process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;

if (!connectionString) {
  console.error('No database URL configured (NETLIFY_DATABASE_URL / DATABASE_URL)');
}

const sql = neon(connectionString);

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    is_admin: row.is_admin,
    is_active: row.is_active,
    requiresPasswordChange: row.requires_password_change,
    created_at: row.created_at
  };
}

async function requireAdmin(userId) {
  const result = await sql`
    SELECT * FROM users
    WHERE id = ${userId} AND is_active = TRUE
    LIMIT 1
  `;
  const admin = result[0];
  if (!admin || !admin.is_admin) {
    const err = new Error('No tens permisos d’administrador');
    err.statusCode = 403;
    throw err;
  }
  return admin;
}

exports.handler = async (event) => {
  // CORS Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  let body;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch (e) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Cos de la petició no és JSON vàlid' })
    };
  }

  const { action } = body || {};
  if (!action) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Acció requerida' })
    };
  }

  try {
    // ------------------------------------------------------------------
    // LOGIN
    // ------------------------------------------------------------------
    if (action === 'login') {
      const { email, password } = body;

      if (!email || !password) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Cal correu i contrasenya' })
        };
      }

      const result = await sql`
        SELECT * FROM users
        WHERE email = ${email.toLowerCase()}
        LIMIT 1
      `;

      const userRow = result[0];

      if (!userRow) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'Credencials incorrectes' })
        };
      }

      if (!userRow.is_active) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: 'Usuari desactivat' })
        };
      }

      const ok = await bcrypt.compare(password, userRow.password);
      if (!ok) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'Credencials incorrectes' })
        };
      }

      await sql`
        UPDATE users
        SET last_login = NOW()
        WHERE id = ${userRow.id}
      `;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          user: sanitizeUser(userRow)
        })
      };
    }

    // ------------------------------------------------------------------
    // CANVI DE CONTRASENYA (des del modal obligatori)
    // ------------------------------------------------------------------
    if (action === 'changePassword') {
      const { userId, password, newPassword } = body;

      if (!userId || !password || !newPassword) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Falten camps obligatoris' })
        };
      }

      if (newPassword.length < 8) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'La contrasenya ha de tenir mínim 8 caràcters'
          })
        };
      }

      const result = await sql`
        SELECT * FROM users
        WHERE id = ${userId} AND is_active = TRUE
        LIMIT 1
      `;
      const userRow = result[0];

      if (!userRow) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Usuari no trobat' })
        };
      }

      const ok = await bcrypt.compare(password, userRow.password);
      if (!ok) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'Contrasenya actual incorrecta' })
        };
      }

      const hashed = await bcrypt.hash(newPassword, 10);

      await sql`
        UPDATE users
        SET password = ${hashed},
            requires_password_change = FALSE
        WHERE id = ${userId}
      `;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Contrasenya canviada correctament'
        })
      };
    }

    // ------------------------------------------------------------------
    // ADMIN: NOU USUARI
    // ------------------------------------------------------------------
    if (action === 'adminCreateUser') {
      const { userId, email, adminPassword } = body;

      if (!userId || !email || !adminPassword) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Falten camps obligatoris' })
        };
      }

      const admin = await requireAdmin(userId);

      const adminPwOk = await bcrypt.compare(adminPassword, admin.password);
      if (!adminPwOk) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'Contrasenya d’administrador incorrecta' })
        };
      }

      const emailLower = email.toLowerCase();

      const existing = await sql`
        SELECT id FROM users WHERE email = ${emailLower} LIMIT 1
      `;
      if (existing.length > 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Ja existeix un usuari amb aquest correu' })
        };
      }

      const username = emailLower.split('@')[0] || 'usuari';
      const temporaryPassword = crypto.randomBytes(4).toString('hex'); // 8 Zeichen
      const hashed = await bcrypt.hash(temporaryPassword, 10);

      const inserted = await sql`
        INSERT INTO users (username, email, password, is_admin, is_active,
                           requires_password_change, created_by)
        VALUES (${username}, ${emailLower}, ${hashed}, FALSE, TRUE, TRUE, ${admin.id})
        RETURNING id, username, email, is_admin, is_active, requires_password_change, created_at
      `;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          user: sanitizeUser(inserted[0]),
          temporaryPassword
        })
      };
    }

    // ------------------------------------------------------------------
    // ADMIN: LLISTAR USUARIS
    // ------------------------------------------------------------------
    if (action === 'adminListUsers') {
      const { userId } = body;
      if (!userId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Falta userId' })
        };
      }

      await requireAdmin(userId);

      const rows = await sql`
        SELECT id, username, email, is_admin, is_active,
               requires_password_change, created_at
        FROM users
        ORDER BY created_at ASC, id ASC
      `;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          users: rows.map(sanitizeUser)
        })
      };
    }

    // ------------------------------------------------------------------
    // ADMIN: RESET PASSWORD PER USUARI
    // ------------------------------------------------------------------
    if (action === 'adminResetPassword') {
      const { userId, email } = body;

      if (!userId || !email) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Falten camps obligatoris' })
        };
      }

      await requireAdmin(userId);

      const emailLower = email.toLowerCase();
      const rows = await sql`
        SELECT id FROM users WHERE email = ${emailLower} LIMIT 1
      `;
      const userRow = rows[0];

      if (!userRow) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Usuari no trobat' })
        };
      }

      const temporaryPassword = crypto.randomBytes(4).toString('hex');
      const hashed = await bcrypt.hash(temporaryPassword, 10);

      await sql`
        UPDATE users
        SET password = ${hashed},
            requires_password_change = TRUE
        WHERE id = ${userRow.id}
      `;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          temporaryPassword
        })
      };
    }

    // ------------------------------------------------------------------
    // ADMIN: ACTIVAR / DESACTIVAR USUARI
    // ------------------------------------------------------------------
    if (action === 'adminToggleUser') {
      const { userId, targetUserId } = body;

      if (!userId || !targetUserId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Falten camps obligatoris' })
        };
      }

      await requireAdmin(userId);

      const updated = await sql`
        UPDATE users
        SET is_active = NOT is_active
        WHERE id = ${targetUserId}
        RETURNING id, username, email, is_admin, is_active,
                  requires_password_change, created_at
      `;

      if (updated.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Usuari no trobat' })
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          user: sanitizeUser(updated[0])
        })
      };
    }

    // ------------------------------------------------------------------
    // Default: Unbekannte Action
    // ------------------------------------------------------------------
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Acció no vàlida' })
    };

  } catch (error) {
    console.error('Auth error:', error);
    const status = error.statusCode || 500;
    return {
      statusCode: status,
      headers,
      body: JSON.stringify({
        error: error.message || 'Error intern del servidor'
      })
    };
  }
};
