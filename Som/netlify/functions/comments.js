const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.NETLIFY_DATABASE_URL);

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { action, proposalId, userId, text, commentId, userEmail } = JSON.parse(event.body);

  try {
    // ✅ Kommentar hinzufügen
    if (action === 'add') {
      const result = await sql`
        INSERT INTO comments (proposal_id, user_id, text)
        VALUES (${proposalId}, ${userId}, ${text})
        RETURNING *
      `;
      return { statusCode: 200, headers, body: JSON.stringify(result[0]) };
    }

    // ✅ Kommentare abrufen
    if (action === 'get') {
      const rows = await sql`
        SELECT 
          c.id, c.proposal_id, c.user_id, c.text, c.created_at,
          COUNT(cl.user_email) AS likes
        FROM comments c
        LEFT JOIN comment_likes cl ON c.id = cl.comment_id
        WHERE c.proposal_id = ${proposalId}
        GROUP BY c.id
        ORDER BY c.created_at ASC
      `;
      return { statusCode: 200, headers, body: JSON.stringify(rows) };
    }

    // ✅ Like/Unlike logik
    if (action === 'like') {
      const existing = await sql`
        SELECT 1 FROM comment_likes 
        WHERE comment_id = ${commentId} AND user_email = ${userEmail}
      `;

      if (existing.length > 0) {
        await sql`DELETE FROM comment_likes WHERE comment_id = ${commentId} AND user_email = ${userEmail}`;
      } else {
        await sql`INSERT INTO comment_likes (comment_id, user_email) VALUES (${commentId}, ${userEmail})`;
      }

      const count = await sql`
        SELECT COUNT(*)::int AS likes 
        FROM comment_likes 
        WHERE comment_id = ${commentId}
      `;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ likes: count[0].likes, liked: existing.length === 0 })
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) };

  } catch (error) {
    console.error('Comments error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
