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
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  let body;
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
    // 1) Ein einzelnes Rating speichern / updaten
    if (action === 'saveRating') {
      const { email, category, value } = body;

      if (!email || !category || typeof value !== 'number') {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing email, category or value' })
        };
      }

      await sql`
        INSERT INTO satisfaction (user_email, category, value)
        VALUES (${email}, ${category}, ${value})
        ON CONFLICT (user_email, category)
        DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = now()
      `;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true })
      };
    }

    // 2) Alle Ratings eines Users holen
    if (action === 'getUserRatings') {
      const { email } = body;

      if (!email) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Missing email' })
        };
      }

      const rows = await sql`
        SELECT category, value
        FROM satisfaction
        WHERE user_email = ${email}
      `;

      const ratings = {};
      rows.forEach(r => {
        ratings[r.category] = r.value;
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, ratings })
      };
    }

    // 3) Durchschnittswerte über alle User
    if (action === 'getAverages') {
      const rows = await sql`
        SELECT
          category,
          AVG(value)::float AS avg_value,
          COUNT(*)::int AS count
        FROM satisfaction
        GROUP BY category
      `;

      const averages = {};
      rows.forEach(r => {
        averages[r.category] = r.avg_value;
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ ok: true, averages })
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Unknown action' })
    };

  } catch (err) {
    console.error('satisfaction function error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', details: String(err) })
    };
  }
};
