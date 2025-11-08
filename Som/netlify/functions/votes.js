const { neon } = require('@neondatabase/serverless');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const sql = neon(process.env.NETLIFY_DATABASE_URL);

  try {
    if (event.httpMethod === 'POST') {
      const { userId, votes } = JSON.parse(event.body);

      // Alle Votes für diesen User updaten
      for (const [proposalId, points] of Object.entries(votes)) {
        await sql`
          INSERT INTO votes (user_id, proposal_id, points)
          VALUES (${userId}, ${proposalId}, ${points})
          ON CONFLICT (user_id, proposal_id)
          DO UPDATE SET points = ${points}
        `;
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    if (event.httpMethod === 'GET') {
      // Aggregierte Ergebnisse berechnen
      const results = await sql`
        SELECT 
          p.id,
          p.title,
          COALESCE(SUM(v.points), 0) as total_points
        FROM proposals p
        LEFT JOIN votes v ON p.id = v.proposal_id
        GROUP BY p.id, p.title
        ORDER BY total_points DESC
      `;

      return { statusCode: 200, headers, body: JSON.stringify(results) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (error) {
    console.error('Votes error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};