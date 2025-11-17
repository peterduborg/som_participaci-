// netlify/functions/comments.js
const { Pool } = require('pg');

// >>> Gleiches Verbindungs-Setup wie in proposals.js <<<
const connectionString =
  process.env.DATABASE_URL ||
  process.env.Database_URL ||
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL_UNPOOLED;

console.log(
  'COMMENTS FUNCTION START, connectionString prefix:',
  (connectionString || 'UNDEFINED').slice(0, 40)
);

if (!connectionString) {
  throw new Error('DATABASE_URL / Database_URL / NETLIFY_DATABASE_URL not set');
}

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

// Hilfsfunktion für Standard-JSON-Response
function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj)
  };
}

exports.handler = async (event) => {
  // Nur POST zulassen (Frontend nutzt apiRequest → POST)
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { action } = payload || {};
  if (!action) {
    return json(400, { error: 'Missing action' });
  }

  try {
    // ----------------------------------------------------
    // ACTION: list  → Kommentare zu einem Proposal laden
    // Erwartet: proposalId, optional email (für user_vote)
    // ----------------------------------------------------
    if (action === 'list') {
      const { proposalId, email } = payload;
      if (!proposalId) {
        return json(400, { error: 'Missing proposalId' });
      }

      const userEmail = (email || '').toLowerCase() || null;

      const { rows } = await pool.query(
        `
          SELECT
            c.id,
            c.proposal_id,
            c.user_email AS email,
            c.author,
            c.text,
            c.created_at,
            COALESCE(SUM(CASE WHEN v.value = 1 THEN 1 ELSE 0 END), 0)  AS likes,
            COALESCE(SUM(CASE WHEN v.value = -1 THEN 1 ELSE 0 END), 0) AS dislikes,
            COALESCE(
              MAX(CASE WHEN v.user_email = $2 THEN v.value END),
              0
            ) AS user_vote
          FROM comments c
          LEFT JOIN comment_votes v
            ON v.comment_id = c.id
          WHERE c.proposal_id = $1
          GROUP BY c.id
          ORDER BY c.created_at ASC
        `,
        [proposalId, userEmail]
      );

      return json(200, { comments: rows });
    }

    // ----------------------------------------------------
    // ACTION: add  → neuen Kommentar anlegen
    // Erwartet: proposalId, email, author, text
    // ----------------------------------------------------
    if (action === 'add') {
      const { proposalId, email, author, text } = payload;

      if (!proposalId || !email || !author || !text) {
        return json(400, {
          error: 'Missing proposalId, email, author or text'
        });
      }

      const insert = await pool.query(
        `
          INSERT INTO comments (proposal_id, user_email, author, text)
          VALUES ($1, $2, $3, $4)
          RETURNING
            id,
            proposal_id,
            user_email AS email,
            author,
            text,
            created_at
        `,
        [proposalId, email.toLowerCase(), author, text]
      );

      return json(200, { comment: insert.rows[0] });
    }

    // ----------------------------------------------------
    // ACTION: vote  → Like/Dislike für Kommentar setzen
    // Erwartet: commentId, email, value (-1, 0, 1)
    // ----------------------------------------------------
    if (action === 'vote') {
      const { commentId, email, value } = payload;

      if (!commentId || !email || typeof value === 'undefined') {
        return json(400, { error: 'Missing commentId, email or value' });
      }

      // value auf -1..1 begrenzen
      let v = Number(value) || 0;
      if (v > 1) v = 1;
      if (v < -1) v = -1;

      const userEmail = email.toLowerCase();

      if (v === 0) {
        // 0 = Stimme zurückziehen → Eintrag löschen
        await pool.query(
          `
            DELETE FROM comment_votes
             WHERE comment_id = $1
               AND user_email = $2
          `,
          [commentId, userEmail]
        );
      } else {
        // -1 oder 1 → upsert
        await pool.query(
          `
            INSERT INTO comment_votes (comment_id, user_email, value)
            VALUES ($1, $2, $3)
            ON CONFLICT (comment_id, user_email)
            DO UPDATE
               SET value = EXCLUDED.value,
                   updated_at = now()
          `,
          [commentId, userEmail, v]
        );
      }

      return json(200, { ok: true });
    }

    // ----------------------------------------------------
    // Unbekannte Action
    // ----------------------------------------------------
    return json(400, { error: 'Invalid action' });
  } catch (err) {
    console.error('comments function error', err);
    return json(500, {
      error: 'Server error',
      details: String(err)
    });
  }
};
