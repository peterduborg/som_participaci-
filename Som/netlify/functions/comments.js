// netlify/functions/comments.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.NEON_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const { action } = payload || {};
  if (!action) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing action' }),
    };
  }

  try {
    if (action === 'list') {
      // ------------------------------------------------
      // Kommentare zu einem Proposal laden
      // ------------------------------------------------
      const { proposalId } = payload;
      if (!proposalId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Missing proposalId' }),
        };
      }

      const { rows } = await pool.query(
        `
          SELECT
            id,
            proposal_id,
            user_email AS email,
            author,
            text,
            created_at
          FROM comments
          WHERE proposal_id = $1
          ORDER BY created_at ASC
        `,
        [proposalId]
      );

      return {
        statusCode: 200,
        body: JSON.stringify({ comments: rows }),
      };
    }

    if (action === 'add') {
      // ------------------------------------------------
      // Neuen Kommentar anlegen
      // ------------------------------------------------
      const { proposalId, email, author, text } = payload;

      if (!proposalId || !email || !author || !text) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Missing proposalId, email, author or text' }),
        };
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

      return {
        statusCode: 200,
        body: JSON.stringify({ comment: insert.rows[0] }),
      };
    }

    if (action === 'vote') {
      // ------------------------------------------------
      // Like / Dislike für einen Kommentar setzen
      // ------------------------------------------------
      const { commentId, email, value } = payload;

      if (!commentId || !email || typeof value !== 'number') {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Missing commentId, email or value' }),
        };
      }

      const v = Math.max(-1, Math.min(1, value)); // auf -1..1 begrenzen

      if (v === 0) {
        // 0 = Stimme zurückziehen → Eintrag löschen
        await pool.query(
          `DELETE FROM comment_votes WHERE comment_id = $1 AND user_email = $2`,
          [commentId, email.toLowerCase()]
        );
      } else {
        // upsert
        await pool.query(
          `
            INSERT INTO comment_votes (comment_id, user_email, value)
            VALUES ($1, $2, $3)
            ON CONFLICT (comment_id, user_email)
            DO UPDATE SET
              value = EXCLUDED.value,
              updated_at = now()
          `,
          [commentId, email.toLowerCase(), v]
        );
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true }),
      };
    }

    // --------------------------------------------------
    // Unbekannte Action
    // --------------------------------------------------
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid action' }),
    };
  } catch (err) {
    console.error('comments function error', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', details: String(err) }),
    };
  }
};
