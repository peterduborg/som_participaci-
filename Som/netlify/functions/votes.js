const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.NETLIFY_DATABASE_URL);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

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

  // Body parsen
  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid JSON' })
    };
  }

  const { action } = body || {};

  try {
    // -------------------------------
    // 1) Einzelnen Vote setzen/ändern
    // -------------------------------
    if (action === 'setVote') {
      const { email, proposalId, value } = body;

      if (!email || !proposalId || typeof value !== 'number') {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'Missing email, proposalId or value'
          })
        };
      }

      await sql`
        INSERT INTO votes (user_email, proposal_id, points)
        VALUES (${email}, ${proposalId}, ${value})
        ON CONFLICT (user_email, proposal_id)
        DO UPDATE SET
          points = EXCLUDED.points,
          updated_at = now()
      `;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true })
      };
    }

    // ----------------------------------------
    // 2) Alle Votes eines Users zurückgeben
    // ----------------------------------------
    if (action === 'getUserVotes') {
      const { email } = body;

      if (!email) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing email' })
        };
      }

      const rows = await sql`
        SELECT proposal_id, points
        FROM votes
        WHERE user_email = ${email}
      `;

      const votes = {};
      rows.forEach(r => {
        votes[r.proposal_id] = r.points;
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, votes })
      };
    }

    // ----------------------------------------
    // 3) Globale Scores pro Proposal
    // ----------------------------------------
    if (action === 'getScores') {
      const rows = await sql`
        SELECT
          proposal_id,
          COALESCE(SUM(points), 0)::int AS total_points
        FROM votes
        GROUP BY proposal_id
        ORDER BY total_points DESC
      `;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          scores: rows
        })
      };
    }

    // Unbekannte Action
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Unknown action' })
    };

  } catch (err) {
    console.error('votes function error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Server error',
        details: String(err)
      })
    };
  }
};
