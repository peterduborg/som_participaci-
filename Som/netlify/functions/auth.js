const { neon } = require('@neondatabase/serverless');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  // CORS Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  const connectionString =
    process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('No database URL configured');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Database connection not configured',
      }),
    };
  }

  const sql = neon(connectionString);

  const {
    action,
    email,
    password,
    newPassword,
    token,              // (momentan unbenutzt, aber lassen wir drin)
    userId,
    adminPassword,
    targetUserId,       // für adminToggleUser
  } = JSON.parse(event.body || '{}');

  try {
    // -------------------------------------------------------------------
    // LOGIN
    // -------------------------------------------------------------------
    if (action === 'login') {
      const users = await sql`
        SELECT id, username, email, password, is_admin, is_active, requires_password_change
        FROM users 
        WHERE email = ${email.toLowerCase()} AND is_active = TRUE
      `;

      if (users.length === 0) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({
            error: 'Correu o contrasenya incorrectes',
          }),
        };
      }

      const user = users[0];
      const validPassword = await bcrypt.compare(password, user.password);

      if (!validPassword) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({
            error: 'Correu o contrasenya incorrectes',
          }),
        };
      }

      // last_login aktualisieren
      await sql`UPDATE users SET last_login = NOW() WHERE id = ${user.id}`;

      // Stimmen laden
      const votes = await sql`
        SELECT proposal_id, points
        FROM votes
        WHERE user_id = ${user.id}
      `;
      const votesObj = {};
      votes.forEach((v) => {
        votesObj[v.proposal_id] = v.points;
      });

      // Zufriedenheit nach Kategorien laden
      const satisfaction = await sql`
        SELECT category, value
        FROM satisfaction
        WHERE user_id = ${user.id}
      `;
      const satisfactionObj = {};
      satisfaction.forEach((s) => {
        satisfactionObj[s.category] = s.value;
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            isAdmin: user.is_admin,
            requiresPasswordChange: user.requires_password_change,
            votes: votesObj,
            satisfaction: satisfactionObj,
          },
        }),
      };
    }

    // -------------------------------------------------------------------
    // CANVIAR CONTRASENYA (vom Zwangs-Modal oder Profil-Tab)
    // -------------------------------------------------------------------
    if (action === 'changePassword') {
      if (!newPassword || newPassword.length < 8) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'La contrasenya ha de tenir mínim 8 caràcters',
          }),
        };
      }

      // Aktuelles Passwort prüfen
      const users = await sql`
        SELECT password
        FROM users
        WHERE id = ${userId}
      `;

      if (users.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Usuari no trobat' }),
        };
      }

      const validPassword = await bcrypt.compare(password, users[0].password);
      if (!validPassword) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({
            error: 'Contrasenya actual incorrecta',
          }),
        };
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await sql`
        UPDATE users 
        SET password = ${hashedPassword},
            requires_password_change = FALSE
        WHERE id = ${userId}
      `;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'Contrasenya canviada correctament',
        }),
      };
    }

    // -------------------------------------------------------------------
    // ADMIN: NEUEN USER ANLEGEN
    // -------------------------------------------------------------------
    if (action === 'adminCreateUser') {
      // prüfen, ob der Anfragende Admin ist
      const admins = await sql`
        SELECT password
        FROM users
        WHERE id = ${userId} AND is_admin = TRUE
      `;
      if (admins.length === 0) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: 'No autoritzat' }),
        };
      }

      const validAdminPassword = await bcrypt.compare(
        adminPassword,
        admins[0].password
      );
      if (!validAdminPassword) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({
            error: "Contrasenya d'admin incorrecta",
          }),
        };
      }

      const emailLower = email.toLowerCase();

      // gibt es die E-Mail schon?
      const existing = await sql`
        SELECT id FROM users WHERE email = ${emailLower}
      `;
      if (existing.length > 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'Aquest correu ja està registrat',
          }),
        };
      }

      // temporäres Passwort erzeugen
      const tempPassword = crypto.randomBytes(6).toString('hex');
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      const result = await sql`
        INSERT INTO users (username, email, password, created_by, requires_password_change)
        VALUES (${emailLower.split('@')[0]}, ${emailLower}, ${hashedPassword}, ${userId}, TRUE)
        RETURNING id, username, email, is_admin, is_active, requires_password_change, created_at
      `;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          user: result[0],
          temporaryPassword: tempPassword,
          message:
            'Usuari creat. Comparteix aquesta contrasenya temporal de forma segura.',
        }),
      };
    }

    // -------------------------------------------------------------------
    // ADMIN: PASSWORT ZURÜCKSETZEN
    // -------------------------------------------------------------------
    if (action === 'adminResetPassword') {
      const admins = await sql`
        SELECT id
        FROM users
        WHERE id = ${userId} AND is_admin = TRUE
      `;
      if (admins.length === 0) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: 'No autoritzat' }),
        };
      }

      const emailLower = email.toLowerCase();

      const targetUsers = await sql`
        SELECT id
        FROM users
        WHERE email = ${emailLower}
      `;
      if (targetUsers.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: 'Usuari no trobat' }),
        };
      }

      const tempPassword = crypto.randomBytes(6).toString('hex');
      const hashedPassword = await bcrypt.hash(tempPassword, 10);

      await sql`
        UPDATE users 
        SET password = ${hashedPassword},
            requires_password_change = TRUE
        WHERE email = ${emailLower}
      `;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          temporaryPassword: tempPassword,
          message: 'Contrasenya restablerta',
        }),
      };
    }

    // -------------------------------------------------------------------
    // ADMIN: USER-LISTE LADEN
    // -------------------------------------------------------------------
    if (action === 'adminListUsers') {
      const admins = await sql`
        SELECT id
        FROM users
        WHERE id = ${userId} AND is_admin = TRUE
      `;
      if (admins.length === 0) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: 'No autoritzat' }),
        };
      }

      const users = await sql`
        SELECT id,
               username,
               email,
               is_admin,
               is_active,
               requires_password_change,
               last_login,
               created_at
        FROM users
        ORDER BY created_at DESC
      `;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          users,
        }),
      };
    }

    // -------------------------------------------------------------------
    // ADMIN: USER AKTIV / INAKTIV SCHALTEN
    // -------------------------------------------------------------------
    if (action === 'adminToggleUser') {
      const admins = await sql`
        SELECT id
        FROM users
        WHERE id = ${userId} AND is_admin = TRUE
      `;
      if (admins.length === 0) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: 'No autoritzat' }),
        };
      }

      const idToToggle = targetUserId;

      await sql`
        UPDATE users
        SET is_active = NOT is_active
        WHERE id = ${idToToggle}
      `;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true }),
      };
    }

    // Unbekannte Action
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Acció no vàlida' }),
    };
  } catch (error) {
    console.error('Auth error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
