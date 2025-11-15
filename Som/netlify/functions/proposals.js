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
      const proposals = await sql`
        SELECT * FROM proposals ORDER BY created_at DESC
      `;

      for (let prop of proposals) {
        // Kommentare mit Usernamen laden
        const comments = await sql`
          SELECT c.*, u.username AS author
          FROM comments c
          JOIN users u ON c.user_id = u.email
          WHERE c.proposal_id = ${prop.id}
          ORDER BY c.likes DESC, c.created_at DESC
        `;

        // Likes pro Kommentar
        for (let comment of comments) {
          const likes = await sql`
            SELECT user_email FROM comment_likes WHERE comment_id = ${comment.id}
          `;
          comment.likedBy = likes.map(l => l.user_email);
        }

        // Bewertungswert (Mittelwert aus proposal_votes)
        const avgResult = await sql`
          SELECT COALESCE(ROUND(AVG(value), 1), 0) AS average FROM proposal_votes WHERE proposal_id = ${prop.id}
        `;
        prop.average = avgResult[0].average;

        prop.comments = comments;
      }

      return { statusCode: 200, headers, body: JSON.stringify(proposals) };
    }

    if (event.httpMethod === 'POST') {
      const { title, description, author, email, category } = JSON.parse(event.body);

      const result = await sql`
        INSERT INTO proposals (id, title, description, author, email, category)
        VALUES (gen_random_uuid(), ${title}, ${description}, ${author}, ${email}, ${category})
        RETURNING *
      `;

      return { statusCode: 200, headers, body: JSON.stringify(result[0]) };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (error) {
    console.error('Proposals error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
