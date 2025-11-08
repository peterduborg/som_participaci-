const { neon } = require('@neondatabase/serverless');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const sql = neon(process.env.NETLIFY_DATABASE_URL);

  try {
    if (event.httpMethod === 'GET') {
      // Alle Proposals mit Kommentaren laden
      const proposals = await sql`
        SELECT p.*, u.username as author_name
        FROM proposals p
        LEFT JOIN users u ON p.author_id = u.id
        ORDER BY p.id ASC
      `;

      // Für jedes Proposal die Kommentare laden
      for (let prop of proposals) {
        const comments = await sql`
          SELECT c.*, u.username as author
          FROM comments c
          JOIN users u ON c.user_id = u.id
          WHERE c.proposal_id = ${prop.id}
          ORDER BY c.likes DESC, c.created_at DESC
        `;

        // Für jeden Kommentar die Likes laden
        for (let comment of comments) {
          const likes = await sql`
            SELECT user_email FROM comment_likes WHERE comment_id = ${comment.id}
          `;
          comment.likedBy = likes.map(l => l.user_email);
        }

        prop.comments = comments;
        prop.author = prop.author_name || 'Sistema';
        prop.date = prop.created_at;
      }

      return { statusCode: 200, headers, body: JSON.stringify(proposals) };
    }

    if (event.httpMethod === 'POST') {
      const { title, description, userId } = JSON.parse(event.body);

      const result = await sql`
        INSERT INTO proposals (title, description, author_id)
        VALUES (${title}, ${description}, ${userId})
        RETURNING *
      `;

      // Für alle User Votes mit 0 Punkten erstellen
      const users = await sql`SELECT id FROM users`;
      for (const user of users) {
        await sql`INSERT INTO votes (user_id, proposal_id, points) VALUES (${user.id}, ${result[0].id}, 0)`;
      }

      return { statusCode: 200, headers, body: JSON.stringify(result[0]) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (error) {
    console.error('Proposals error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};